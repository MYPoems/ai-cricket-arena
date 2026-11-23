// 对弈场核心：创建对局、轮流向各座位的玩家要着法、推送实时事件、结算积分。

import { getGame } from '../games/index.js';
import { newId, now } from './db.js';
import { callModel } from './providers/index.js';
import { getCharacter, canRank } from './characters.js';
import { applyResult, PLACEMENT_GAMES } from './ladder/rating.js';
import { moveQuality } from './evaluator.js';
import { HttpError } from './http.js';

export const MAX_RETRIES = 3; // 不合法着法最多重走 3 次，仍不合法判负
const NOTES_IN_PROMPT = 5;

class Abort extends Error {}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const localDate = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export class Arena {
  constructor({ db, hub, aiPool, evaluator, ownerId = 'local' }) {
    this.db = db;
    this.hub = hub;
    this.aiPool = aiPool;
    this.evaluator = evaluator;
    this.ownerId = ownerId;
    this.live = new Map(); // matchId → 运行时状态
  }

  // ---------- 创建 ----------

  /**
   * seats: { seat: characterId }；mode: casual / ranked
   * options: { showLegal, delayMs, fen }
   */
  createMatch({ game: gameId = 'xiangqi', seats, mode = 'casual', options = {}, challenge = null }) {
    const game = getGame(gameId);
    const chars = {};
    for (const seat of game.seats) {
      if (!seats?.[seat]) throw new HttpError(400, `请为${game.seatNames[seat]}选择选手`);
      chars[seat] = getCharacter(this.db, seats[seat]);
    }
    const humans = Object.values(chars).filter((c) => c.kind === 'human');
    if (mode === 'ranked') {
      const bad = Object.values(chars).filter((c) => !canRank(this.db, c));
      if (bad.length) throw new HttpError(400, `${bad.map((c) => c.name).join('、')} 不能参加排位赛（本地模型和自定义接口只能下娱乐赛）`);
      if (options.fen) throw new HttpError(400, '排位赛只能从标准开局开始');
      if (new Set(Object.values(seats)).size < game.seats.length) throw new HttpError(400, '排位赛不能自己对自己');
    }
    if (humans.length && options.fen) {
      // 允许玩家从任意局面开始娱乐赛
    }
    const state = game.create({ fen: options.fen });
    const placement = mode === 'ranked' && Object.values(chars).some((c) => this.played(c.id, gameId) < PLACEMENT_GAMES);
    const m = {
      id: newId('m'),
      game: gameId,
      mode: mode === 'ranked' ? (placement ? 'placement' : 'ranked') : 'casual',
      status: 'running',
      start_fen: state.startFen,
      options: {
        showLegal: options.showLegal !== false,
        delayMs: Math.max(0, Math.min(10000, Number(options.delayMs ?? (mode === 'casual' ? 600 : 0)))),
        hideThoughts: options.hideThoughts ?? humans.length > 0,
      },
      seats,
      actions: [],
      challenge,
      conversations: {},
      created_at: now(),
      started_at: now(),
    };
    this.db.insert('matches', m);
    this.hub.emit('lobby', { type: 'match_created', match: this.summary(m.id) });
    this.run(m.id);
    return m.id;
  }

  played(characterId, gameId) {
    return this.db.get('SELECT played FROM ratings WHERE character_id = ? AND game = ?', characterId, gameId)?.played || 0;
  }

  // ---------- 运行 ----------

  /** 启动或恢复一盘对局 */
  run(matchId) {
    if (this.live.has(matchId)) return;
    const m = this.db.get('SELECT * FROM matches WHERE id = ?', matchId);
    if (!m || m.status !== 'running') return;
    const rt = {
      paused: false, step: false, abort: new AbortController(), human: null,
      partial: null, wake: null, evalChain: Promise.resolve(),
    };
    this.live.set(matchId, rt);
    this.#loop(m, rt)
      .catch((err) => {
        if (err instanceof Abort || rt.abort.signal.aborted) this.#finish(m, rt, null, rt.abortReason || '对局已中止');
        else {
          console.error(`[对局 ${matchId}]`, err);
          this.#finish(m, rt, null, `接口错误：${err.message}`);
        }
      })
      .finally(() => this.live.delete(matchId));
  }

  async #loop(m, rt) {
    const game = getGame(m.game);
    let state = game.replay(m.start_fen, m.actions);
    const channel = `match:${m.id}`;
    // 起始局面评估（胜率条的第一个点）
    if (!m.options.startEval) {
      const ev = await this.evaluator.evaluate(game.fen(state)).catch(() => null);
      if (ev) {
        m.options.startEval = { e: ev.e, best: ev.best, source: ev.source, redE: state.pos.side === 'r' ? ev.e : 1 - ev.e };
        this.db.update('matches', { id: m.id }, { options: m.options });
        this.hub.emit(channel, { type: 'eval', ply: 0, eval: m.options.startEval });
      }
    }
    let prevEval = m.options.startEval || null;
    if (m.actions.length) {
      const last = this.db.get('SELECT eval FROM turns WHERE match_id = ? ORDER BY ply DESC LIMIT 1', m.id);
      prevEval = last?.eval?.raw || prevEval;
    }

    while (true) {
      const out = game.outcome(state);
      if (out.over) return this.#finish(m, rt, out);
      await this.#waitIfPaused(rt);
      if (rt.abort.signal.aborted) throw new Abort();

      const seat = game.toMove(state);
      const ch = getCharacter(this.db, m.seats[seat]);
      const ply = m.actions.length + 1;
      rt.partial = { ply, seat, characterId: ch.id, text: '', reasoning: '', attempts: [] };
      this.hub.emit(channel, { type: 'turn_start', ply, seat, characterId: ch.id, kind: ch.kind });

      const t0 = Date.now();
      const res = await this.#getMove({ m, rt, game, state, seat, ch, channel });
      const latency = Date.now() - t0;
      if (res.forfeit) {
        this.#saveTurn(m, { ply, seat, ch, res, latency, action: null });
        return this.#finish(m, rt, game.forfeit(state, seat, res.forfeit));
      }

      const label = game.label(state, res.action);
      const before = state;
      state = game.apply(state, res.action);
      m.actions.push(res.action);
      this.db.update('matches', { id: m.id }, { actions: m.actions, conversations: m.conversations });
      this.#saveTurn(m, { ply, seat, ch, res, latency, action: res.action, label });
      rt.partial = null;
      this.hub.emit(channel, {
        type: 'move', ply, seat, characterId: ch.id, action: res.action, label,
        analysis: m.options.hideThoughts && ch.kind === 'model' ? null : res.text || null,
        selfWinrate: m.options.hideThoughts && ch.kind === 'model' ? null : res.winrate ?? null, latency, usage: res.usage || null, view: game.view(state),
      });

      // 评估走后局面，计算这步棋的质量（异步，不挡住对局）
      const evBefore = prevEval;
      const fenAfter = game.fen(state);
      const sideAfter = state.pos.side;
      const evalP = this.evaluator.evaluate(fenAfter).then((after) => {
        const q = evBefore ? moveQuality(evBefore, after, res.action) : null;
        const ev = { raw: after, redE: sideAfter === 'r' ? after.e : 1 - after.e, source: after.source, ...(q ? { quality: q } : {}) };
        this.db.update('turns', { match_id: m.id, ply }, { eval: ev });
        this.hub.emit(channel, { type: 'eval', ply, eval: ev });
        return after;
      }).catch(() => null);
      prevEval = await evalP; // 顺序评估，保证走前评估可用
      void before;

      if (m.options.delayMs) await sleep(m.options.delayMs, rt);
    }
  }

  async #waitIfPaused(rt) {
    while (rt.paused && !rt.step && !rt.abort.signal.aborted) {
      await new Promise((r) => { rt.wake = r; });
    }
    rt.step = false;
  }

  #saveTurn(m, { ply, seat, ch, res, latency, action, label = null }) {
    this.db.run('DELETE FROM turns WHERE match_id = ? AND ply = ?', m.id, ply);
    this.db.insert('turns', {
      match_id: m.id, ply, seat, character_id: ch.id, action, label,
      analysis: res.text || null, reasoning: res.reasoning || null, self_winrate: res.winrate ?? null,
      eval: null, attempts: res.attempts?.length ? res.attempts : null, usage: res.usage || null,
      latency_ms: latency, model_served: res.model || null, created_at: now(),
    });
  }

  // ---------- 各类玩家 ----------

  async #getMove(ctx) {
    const { ch, game, state } = ctx;
    switch (ch.kind) {
      case 'human':
        return this.#humanMove(ctx);
      case 'random': {
        const acts = game.actions(state);
        return { action: acts[Math.floor(Math.random() * acts.length)].id };
      }
      case 'builtin': {
        const r = await this.aiPool.run('move', game.fen(state), ch.level || 3);
        return { action: r.move };
      }
      case 'engine': {
        const best = await this.evaluator.bestMove(game.fen(state), ch.level || 200);
        return { action: best };
      }
      case 'model':
        return this.#modelMove(ctx);
      default:
        throw new Error(`未知选手类型：${ch.kind}`);
    }
  }

  #humanMove({ m, rt, game, state, seat }) {
    return new Promise((resolve, reject) => {
      rt.human = { seat, resolve: (action) => {
        if (!game.actions(state).some((a) => a.id === action)) throw new HttpError(400, `不合法的着法：${action}`);
        rt.human = null;
        resolve({ action });
      }, resign: () => { rt.human = null; resolve({ forfeit: `${game.seatNames[seat]}认输` }); } };
      rt.abort.signal.addEventListener('abort', () => reject(new Abort()), { once: true });
      void m;
    });
  }

  /** 模型走棋：整局保持一段连续的对话（模型能看到自己整局的思考） */
  async #modelMove({ m, rt, game, state, seat, ch, channel }) {
    let conv = m.conversations[seat];
    if (!conv) {
      const notes = ch.memory
        ? this.db.all('SELECT text FROM notes WHERE character_id = ? ORDER BY created_at DESC LIMIT ?', ch.id, NOTES_IN_PROMPT).map((n) => n.text)
        : [];
      let system = game.systemPrompt(seat, { style: ch.style, showLegal: !!ch.show_legal && m.options.showLegal });
      if (notes.length) system += `\n\n【你以前对局的复盘笔记】\n${notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;
      conv = m.conversations[seat] = { system, messages: [] };
    }
    conv.messages.push({ role: 'user', content: game.turnPrompt(state, seat, { showLegal: !!ch.show_legal && m.options.showLegal }) });

    const attempts = [];
    const usage = { input: 0, output: 0, cached: 0, reasoning: 0 };
    let served = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const partial = rt.partial;
      partial.text = '';
      partial.reasoning = '';
      partial.attempt = attempt;
      const hide = m.options.hideThoughts;
      const res = await callModel(this.db, ch, conv.system, conv.messages, (d) => {
        if (d.kind === 'text') partial.text += d.text;
        else partial.reasoning += d.text;
        if (!hide) this.hub.emit(channel, { type: 'delta', ply: partial.ply, seat, attempt, kind: d.kind, text: d.text });
      }, rt.abort.signal);
      for (const k of Object.keys(usage)) usage[k] += res.usage?.[k] || 0;
      served = res.model;
      conv.messages.push(res.message);
      const parsed = game.parseReply(state, res.text);
      if (parsed.action) {
        return { action: parsed.action, text: res.text, reasoning: res.reasoning, winrate: parsed.winrate, attempts, usage, model: served };
      }
      attempts.push({ text: res.text, reasoning: res.reasoning, error: parsed.error, attempted: parsed.attempted });
      this.hub.emit(channel, { type: 'illegal', ply: partial.ply, seat, attempt, error: parsed.error, attempted: parsed.attempted });
      if (attempt === MAX_RETRIES) {
        return { forfeit: `${game.seatNames[seat]}连续 ${MAX_RETRIES + 1} 次给出无效着法，判负`, text: res.text, reasoning: res.reasoning, attempts, usage, model: served };
      }
      conv.messages.push({ role: 'user', content: game.retryPrompt(parsed.error, attempt + 1, MAX_RETRIES) });
    }
    throw new Error('不可能到达');
  }

  // ---------- 结束 ----------

  #finish(m, rt, outcome, abortReason = null) {
    const game = getGame(m.game);
    if (abortReason) {
      this.db.update('matches', { id: m.id }, { status: 'aborted', result: { over: true, aborted: true, reason: abortReason }, finished_at: now(), conversations: m.conversations });
    } else {
      let changes = null;
      if (m.mode !== 'casual') {
        const seats = Object.fromEntries(game.seats.map((s) => [s, m.seats[s]]));
        changes = applyResult(this.db, m.game, m.id, seats, outcome.ranks);
      }
      this.db.update('matches', { id: m.id }, { status: 'finished', result: outcome, rating_changes: changes, finished_at: now(), conversations: m.conversations });
      this.#writeNotes(m, outcome).catch((e) => console.error('写复盘笔记失败：', e.message));
    }
    const sum = this.summary(m.id);
    this.hub.emit(`match:${m.id}`, { type: 'end', match: sum });
    this.hub.emit('lobby', { type: 'match_finished', match: sum });
    this.onFinish?.(sum);
  }

  /** 跨局记忆：对局结束后让开启记忆的选手写一条复盘笔记 */
  async #writeNotes(m, outcome) {
    const game = getGame(m.game);
    for (const seat of game.seats) {
      const ch = getCharacter(this.db, m.seats[seat]);
      const conv = m.conversations[seat];
      if (ch.kind !== 'model' || !ch.memory || !conv) continue;
      const res = outcome.winner === seat ? '你赢了' : outcome.winner ? '你输了' : '和棋';
      const messages = [...conv.messages, { role: 'user', content: `对局结束：${res}（${outcome.reason}）。请用一句话（不超过 60 字）总结这盘棋最值得记住的教训，供你以后的对局参考。只输出这句话。` }];
      const r = await callModel(this.db, ch, conv.system, messages);
      const text = r.text.trim().split('\n').filter(Boolean).pop()?.slice(0, 120);
      if (text) this.db.insert('notes', { character_id: ch.id, match_id: m.id, text, created_at: now() });
    }
  }

  // ---------- 控制 ----------

  humanMove(matchId, action) {
    const rt = this.live.get(matchId);
    if (!rt?.human) throw new HttpError(409, '现在不是你走棋');
    rt.human.resolve(action);
  }

  control(matchId, op) {
    const rt = this.live.get(matchId);
    if (!rt) throw new HttpError(409, '对局不在进行中');
    if (op === 'pause') rt.paused = true;
    else if (op === 'resume') { rt.paused = false; rt.wake?.(); }
    else if (op === 'step') { rt.step = true; rt.wake?.(); }
    else if (op === 'resign') {
      if (!rt.human) throw new HttpError(409, '只有轮到你走时才能认输');
      rt.human.resign();
    } else if (op === 'abort') {
      const m = this.db.get('SELECT mode FROM matches WHERE id = ?', matchId);
      if (m.mode !== 'casual') throw new HttpError(400, '排位赛不能中止');
      rt.abortReason = '已手动中止';
      rt.abort.abort();
      rt.wake?.();
    } else throw new HttpError(400, '未知操作');
    this.hub.emit(`match:${matchId}`, { type: 'control', op, paused: rt.paused });
    return { paused: rt.paused };
  }

  /** 服务启动时恢复未下完的对局 */
  resumeAll() {
    for (const m of this.db.all("SELECT id FROM matches WHERE status = 'running'")) this.run(m.id);
  }

  // ---------- 查询 ----------

  summary(matchId) {
    const m = this.db.get('SELECT id, game, mode, status, seats, result, rating_changes, challenge, created_at, finished_at, actions FROM matches WHERE id = ?', matchId);
    if (!m) return null;
    const names = {};
    for (const [seat, cid] of Object.entries(m.seats)) {
      const c = this.db.get('SELECT id, name, avatar, kind, provider, model FROM characters WHERE id = ?', cid);
      names[seat] = c;
    }
    return { ...m, plies: m.actions.length, actions: undefined, players: names, live: this.live.has(m.id) };
  }

  detail(matchId) {
    const m = this.db.get('SELECT * FROM matches WHERE id = ?', matchId);
    if (!m) throw new HttpError(404, '对局不存在');
    const game = getGame(m.game);
    const state = game.replay(m.start_fen, m.actions);
    const turns = this.db.all('SELECT * FROM turns WHERE match_id = ? ORDER BY ply', matchId);
    const rt = this.live.get(matchId);
    const hide = m.options.hideThoughts && m.status === 'running';
    const sum = this.summary(matchId);
    return {
      ...sum,
      options: m.options,
      startFen: m.start_fen,
      view: game.view(state),
      turns: turns.map((t) => (hide && t.character_id && this.#isModel(t.character_id) ? { ...t, analysis: null, reasoning: null, attempts: null, self_winrate: null } : t)),
      partial: rt?.partial && !hide ? rt.partial : rt?.partial ? { ...rt.partial, text: '', reasoning: '' } : null,
      paused: rt?.paused || false,
      waitingHuman: rt?.human ? rt.human.seat : null,
      seatNames: game.seatNames,
    };
  }

  #isModel(cid) {
    return this.db.get('SELECT kind FROM characters WHERE id = ?', cid)?.kind === 'model';
  }

  /** 今天某选手已下的盘数和 token 用量 */
  todayUsage(characterId) {
    const t = today();
    const rows = this.db.all("SELECT id, seats, created_at FROM matches WHERE created_at >= ? AND status != 'aborted'", new Date(Date.now() - 2 * 864e5).toISOString())
      .filter((r) => localDate(r.created_at) === t && Object.values(r.seats).includes(characterId));
    let tokens = 0;
    for (const r of rows) {
      for (const u of this.db.all('SELECT usage FROM turns WHERE match_id = ? AND character_id = ?', r.id, characterId)) {
        tokens += (u.usage?.input || 0) + (u.usage?.output || 0);
      }
    }
    return { games: rows.length, tokens, matchIds: rows.map((r) => r.id) };
  }

  busy(characterId) {
    for (const id of this.live.keys()) {
      const m = this.db.get('SELECT seats FROM matches WHERE id = ?', id);
      if (m && Object.values(m.seats).includes(characterId)) return true;
    }
    return false;
  }
}

function sleep(ms, rt) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    rt.abort.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
