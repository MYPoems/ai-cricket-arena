// 电子斗蛐蛐核心：创建对局、向该出手的座位要行动（可以多个座位同时行动）、推送实时事件、结算积分。
// 游戏规则全部由 games/ 下的游戏定义负责，这里只负责调度。

import { getGame, replay } from '../games/index.js';
import { newId, now } from './db.js';
import { callModel } from './providers/index.js';
import { getCharacter, canRank, engineGameName } from './characters.js';
import { applyResult, PLACEMENT_GAMES } from './ladder/rating.js';
import { moveQuality } from './evaluator.js';
import { HttpError } from './http.js';

export const MAX_RETRIES = 3; // 无效行动最多重来 3 次，仍无效判负
const NOTES_IN_PROMPT = 5;

class Abort extends Error {}

// ---------- 提和（只用于支持提和的两人棋类游戏） ----------
// 任一方在走棋时可以附带提出和棋；对方下一步可以接受（对局以和棋结束），照常走棋即视为拒绝。
// 被拒后同一方 20 步（各 10 回合）内再提会被忽略，避免反复提和。
export const DRAW_COOLDOWN_PLIES = 20;
export const DRAW_RULE = '【提和】如果你判断局面已经是和棋、继续下去只是浪费步数，可以在回答最后多写一行「求和：是」向对方提出和棋（这一步的着法照常写、照常走）。对方向你提和时我会告诉你：接受就把着法那一行写成「着法：接受和棋」，不接受就照常走棋。提和被拒后，10 个回合内不能再提。';
const OFFER_RE = /求和[:：]\s*(是|提出|要)/;
const ACCEPT_RE = /着法[:：]\s*(接受和棋|同意和棋|接受求和|和棋)/;

function drawState(m) {
  if (!m.options.draw) m.options.draw = { offers: [] };
  return m.options.draw;
}
function pendingOfferTo(m, seat) {
  const o = drawState(m).offers.at(-1);
  return o && o.status === 'pending' && o.seat !== seat ? o : null;
}
function canOffer(m, seat, ply) {
  const last = drawState(m).offers.filter((o) => o.seat === seat && o.status !== 'ignored').at(-1);
  return !last || ply - last.ply >= DRAW_COOLDOWN_PLIES;
}

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 对局记录 → 重建用的参数；兼容只有 start_fen 的旧对局 */
export function recordOf(m) {
  const s = m.setup || {};
  return { setup: s.setup || (m.start_fen ? { fen: m.start_fen } : {}), seed: s.seed, players: s.players || Object.keys(m.seats).length, actions: m.actions };
}

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
   * seats: { seat: characterId }，座位数决定人数；mode: casual / ranked
   * options: { showLegal, delayMs, fen, setup, seed, hideThoughts, series }
   */
  createMatch({ game: gameId = 'xiangqi', seats, mode = 'casual', options = {}, challenge = null }) {
    const game = getGame(gameId);
    const n = Object.keys(seats || {}).length || game.players.default;
    if (n < game.players.min || n > game.players.max) throw new HttpError(400, `${game.name}需要 ${game.players.min}–${game.players.max} 名选手`);
    const seatIds = game.seats(n);
    const chars = {};
    for (const seat of seatIds) {
      if (!seats?.[seat]) throw new HttpError(400, `请为${game.seatName(seat)}选择选手`);
      chars[seat] = getCharacter(this.db, seats[seat]);
    }
    for (const c of Object.values(chars)) {
      if (c.kind === 'engine' && (c.provider || 'pikafish') !== game.features?.evalEngine) throw new HttpError(400, `${c.name}只会下${engineGameName(c.provider)}`);
    }
    const humans = Object.values(chars).filter((c) => c.kind === 'human');
    if (humans.length > 1) throw new HttpError(400, '目前一盘里只能有一位玩家本人');
    const setup = { ...(options.setup || {}), ...(options.fen ? { fen: options.fen } : {}) };
    if (mode === 'ranked') {
      const bad = Object.values(chars).filter((c) => !canRank(this.db, c));
      if (bad.length) throw new HttpError(400, `${bad.map((c) => c.name).join('、')} 不能参加排位赛（本机订阅和自定义接口只能下娱乐赛）`);
      if (setup.fen) throw new HttpError(400, '排位赛只能从标准开局开始');
      const ids = Object.values(seats);
      const system = new Set(this.db.all('SELECT id FROM characters WHERE system = 1').map((r) => r.id));
      if (new Set(ids.filter((id) => !system.has(id))).size < ids.filter((id) => !system.has(id)).length) throw new HttpError(400, '排位赛里同一名选手不能占多个座位');
    }
    const seed = Number.isInteger(options.seed) ? options.seed : Math.floor(Math.random() * 2 ** 31);
    let state;
    try {
      state = game.create({ players: n, seed, setup });
    } catch (e) {
      throw new HttpError(400, `开局参数不合法：${e.message}`);
    }
    const placement = mode === 'ranked' && Object.values(chars).some((c) => !c.system && this.played(c.id, gameId) < PLACEMENT_GAMES);
    const m = {
      id: newId('m'),
      game: gameId,
      mode: mode === 'ranked' ? (placement ? 'placement' : 'ranked') : 'casual',
      status: 'running',
      start_fen: setup.fen || (game.fen ? game.fen(state) : null),
      setup: { setup, seed, players: n },
      options: {
        showLegal: options.showLegal !== false,
        delayMs: Math.max(0, Math.min(10000, Number(options.delayMs ?? (mode === 'casual' ? 600 : 0)))),
        hideThoughts: options.hideThoughts ?? humans.length > 0,
        ...(options.series ? { series: options.series } : {}),
      },
      seats: Object.fromEntries(seatIds.map((s) => [s, seats[s]])),
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

  humanSeat(m) {
    for (const [seat, cid] of Object.entries(m.seats)) {
      if (this.db.get('SELECT kind FROM characters WHERE id = ?', cid)?.kind === 'human') return seat;
    }
    return null;
  }

  // ---------- 运行 ----------

  run(matchId) {
    if (this.live.has(matchId)) return;
    const m = this.db.get('SELECT * FROM matches WHERE id = ?', matchId);
    if (!m || m.status !== 'running') return;
    const rt = { paused: false, step: false, abort: new AbortController(), humans: {}, partials: {}, wake: null };
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

  /** 局面评估（有引擎的游戏）；返回 { raw, e0 }，e0 为第一个座位的期望得分 */
  async #evaluate(game, state, seatIds) {
    if (!game.evalSpec) return null;
    const spec = game.evalSpec(state);
    if (!spec) return null;
    const ev = await this.evaluator.evaluate(spec).catch(() => null);
    if (!ev) return null;
    const e0 = spec.persp === seatIds[0] ? ev.e : 1 - ev.e;
    return { raw: ev, e0, persp: spec.persp };
  }

  async #loop(m, rt) {
    const game = getGame(m.game);
    const seatIds = Object.keys(m.seats);
    let state = replay(game, recordOf(m));
    const channel = `match:${m.id}`;
    const hidden = !!game.features?.hidden;
    const human = this.humanSeat(m);
    const publicView = () => (hidden && human ? null : game.view(state, null));

    if (!m.options.startEval && game.evalSpec) {
      const ev = await this.#evaluate(game, state, seatIds);
      if (ev) {
        m.options.startEval = { e: ev.raw.e, best: ev.raw.best, source: ev.raw.source, e0: ev.e0, redE: ev.e0 };
        this.db.update('matches', { id: m.id }, { options: m.options });
        this.hub.emit(channel, { type: 'eval', ply: 0, eval: m.options.startEval });
      }
    }
    let prevEval = null;
    if (game.evalSpec) {
      const last = m.actions.length ? this.db.get('SELECT eval FROM turns WHERE match_id = ? AND eval IS NOT NULL ORDER BY ply DESC LIMIT 1', m.id) : null;
      prevEval = last?.eval ? { raw: last.eval.raw, persp: last.eval.persp } : m.options.startEval ? { raw: { e: m.options.startEval.e, best: m.options.startEval.best }, persp: game.evalSpec(state)?.persp } : null;
    }

    while (true) {
      const out = game.outcome(state);
      if (out.over) return this.#finish(m, rt, out);
      await this.#waitIfPaused(rt);
      if (rt.abort.signal.aborted) throw new Abort();

      const pend = game.pending(state);
      if (!pend.length) throw new Error('游戏没有结束，但没有座位需要行动');
      const base = m.actions.length;
      const jobs = pend.map((seat, i) => {
        const ch = getCharacter(this.db, m.seats[seat]);
        const ply = base + i + 1;
        rt.partials[seat] = { ply, seat, characterId: ch.id, text: '', reasoning: '', attempts: [] };
        this.hub.emit(channel, { type: 'turn_start', ply, seat, characterId: ch.id, kind: ch.kind, simultaneous: pend.length > 1 });
        const offer = game.features?.draw ? pendingOfferTo(m, seat) : null;
        const t0 = Date.now();
        return this.#getMove({ m, rt, game, state, seat, ch, channel, offer, ply })
          .then((res) => ({ seat, ch, ply, offer, res, latency: Date.now() - t0 }));
      });
      const results = await Promise.all(jobs);

      for (const r of results) {
        const { seat, ch, ply, offer, res, latency } = r;
        if (res.acceptDraw && offer) {
          offer.status = 'accepted';
          offer.answerPly = ply;
          this.db.update('matches', { id: m.id }, { options: m.options, conversations: m.conversations });
          this.#saveTurn(m, { ply, seat, ch, res, latency, action: null, label: '接受和棋' });
          this.hub.emit(channel, { type: 'draw', draw: m.options.draw });
          return this.#finish(m, rt, { over: true, winner: null, ranks: Object.fromEntries(seatIds.map((s) => [s, 1])), reason: '双方同意和棋' });
        }
        if (res.forfeit) {
          this.#saveTurn(m, { ply, seat, ch, res, latency, action: null });
          return this.#finish(m, rt, game.forfeit(state, seat, res.forfeit));
        }
      }

      for (const r of results) {
        const { seat, ch, ply, offer, res, latency } = r;
        const label = game.label(state, seat, res.action);
        state = game.apply(state, seat, res.action);
        m.actions.push({ seat, action: res.action });
        let drawChanged = false;
        if (offer) { offer.status = 'declined'; offer.answerPly = ply; drawChanged = true; }
        if (res.offerDraw && game.features?.draw) {
          drawState(m).offers.push({ ply, seat, status: canOffer(m, seat, ply) ? 'pending' : 'ignored' });
          drawChanged = true;
        }
        this.db.update('matches', { id: m.id }, { actions: m.actions, conversations: m.conversations, options: m.options });
        this.#saveTurn(m, { ply, seat, ch, res, latency, action: res.action, label });
        delete rt.partials[seat];
        const hideModel = m.options.hideThoughts && ch.kind === 'model';
        this.hub.emit(channel, {
          type: 'move', ply, seat, characterId: ch.id, action: res.action, label,
          analysis: hideModel ? null : res.text || null,
          selfWinrate: hideModel ? null : res.winrate ?? null, latency, usage: res.usage || null, view: publicView(),
        });
        if (drawChanged) this.hub.emit(channel, { type: 'draw', draw: m.options.draw });

        // 评估走后局面、计算这步的质量（顺序执行，保证走前评估可用）
        if (game.evalSpec) {
          const after = await this.#evaluate(game, state, seatIds);
          if (after) {
            let quality = null;
            if (prevEval?.raw && prevEval.persp === seat && after.persp !== seat) quality = moveQuality(prevEval.raw, after.raw, res.action);
            const ev = { raw: after.raw, persp: after.persp, e0: after.e0, redE: after.e0, source: after.raw.source, ...(quality ? { quality } : {}) };
            this.db.update('turns', { match_id: m.id, ply }, { eval: ev });
            this.hub.emit(channel, { type: 'eval', ply, eval: ev });
            prevEval = after;
          }
        }
      }
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
    const { ch, game, state, seat, offer } = ctx;
    // 内置 AI 和引擎：自己不占优（期望得分低于 55%）就接受和棋；随机走子不接受
    if (offer && (ch.kind === 'builtin' || ch.kind === 'engine') && game.evalSpec) {
      const spec = game.evalSpec(state);
      const ev = spec ? await this.evaluator.evaluate(spec).catch(() => null) : null;
      if (ev && (spec.persp === seat ? ev.e : 1 - ev.e) < 0.55) return { acceptDraw: true };
    }
    switch (ch.kind) {
      case 'human':
        return this.#humanMove(ctx);
      case 'random': {
        const acts = game.actions(state, seat);
        if (acts?.length) return { action: acts[Math.floor(Math.random() * acts.length)].id };
        return { action: await game.builtinMove(state, seat, { level: 1, random: true }) };
      }
      case 'builtin': {
        if (game.id === 'xiangqi') return { action: (await this.aiPool.run('move', game.fen(state), ch.level || 3)).move };
        return { action: await game.builtinMove(state, seat, { level: ch.level || 2, depth: ch.level || 2 }) };
      }
      case 'engine': {
        const spec = game.evalSpec?.(state);
        if (!spec) throw new Error(`${game.name}没有可用的引擎`);
        return { action: await this.evaluator.bestMove(spec, ch.level || 200) };
      }
      case 'model':
        return this.#modelMove(ctx);
      default:
        throw new Error(`未知选手类型：${ch.kind}`);
    }
  }

  #humanMove({ m, rt, game, state, seat, offer }) {
    return new Promise((resolve, reject) => {
      rt.humans[seat] = {
        seat, offer: !!offer,
        resolve: (action, offerDraw = false) => {
          const acts = game.actions(state, seat);
          if (acts && !acts.some((a) => a.id === action)) throw new HttpError(400, `不合法的行动：${action}`);
          if (!acts) game.apply(state, seat, action); // 自由文本：用 apply 校验，不合法会抛错
          delete rt.humans[seat];
          resolve({ action, offerDraw });
        },
        acceptDraw: () => {
          if (!offer) throw new HttpError(409, '对方没有提出和棋');
          delete rt.humans[seat];
          resolve({ acceptDraw: true });
        },
        resign: () => { delete rt.humans[seat]; resolve({ forfeit: `${game.seatName(seat)}认输` }); },
      };
      this.hub.emit(`match:${m.id}`, { type: 'human_turn', seat });
      rt.abort.signal.addEventListener('abort', () => reject(new Abort()), { once: true });
    });
  }

  /** 模型行动：整局保持一段连续的对话（模型能看到自己整局的思考） */
  async #modelMove({ m, rt, game, state, seat, ch, channel, offer }) {
    const showLegal = !!ch.show_legal && m.options.showLegal;
    let conv = m.conversations[seat];
    if (!conv) {
      const notes = ch.memory
        ? this.db.all('SELECT text FROM notes WHERE character_id = ? ORDER BY created_at DESC LIMIT ?', ch.id, NOTES_IN_PROMPT).map((n) => n.text)
        : [];
      let system = game.systemPrompt(seat, { style: ch.style, showLegal, players: Object.keys(m.seats).length, state });
      if (game.features?.draw) system += `\n\n${DRAW_RULE}`;
      if (notes.length) system += `\n\n【你以前对局的复盘笔记】\n${notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;
      conv = m.conversations[seat] = { system, messages: [], drawRule: !!game.features?.draw };
    }
    let turn = game.turnPrompt(state, seat, { showLegal });
    if (game.features?.draw && !conv.drawRule && !conv.system.includes('求和')) { turn = `${DRAW_RULE}\n\n${turn}`; conv.drawRule = true; }
    if (offer) turn = `对方提出了和棋。接受就把着法那一行写成「着法：接受和棋」；不接受就照常走棋。\n\n${turn}`;
    conv.messages.push({ role: 'user', content: turn });

    const attempts = [];
    const usage = { input: 0, output: 0, cached: 0, reasoning: 0 };
    let served = null;
    const partial = rt.partials[seat];
    // 模拟模型（开发和测试用）：先用内置 AI 选一步，再按游戏自己的格式写成回答
    let mockText = null;
    if (ch.provider === 'mock' && game.id !== 'xiangqi') {
      const act = await game.builtinMove(state, seat, { level: 1 });
      mockText = game.mockReply ? game.mockReply(state, seat, act) : `判断：局面复杂。
威胁：无
理由：试一试。
胜率：50%
${game.noun || '行动'}：${act}`;
    }
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      partial.text = '';
      partial.reasoning = '';
      partial.attempt = attempt;
      const hide = m.options.hideThoughts;
      const res = await callModel(this.db, ch, conv.system, conv.messages, (d) => {
        if (d.kind === 'text') partial.text += d.text;
        else partial.reasoning += d.text;
        if (!hide) this.hub.emit(channel, { type: 'delta', ply: partial.ply, seat, attempt, kind: d.kind, text: d.text });
      }, rt.abort.signal, { mockText });
      for (const k of Object.keys(usage)) usage[k] += res.usage?.[k] || 0;
      served = res.model;
      conv.messages.push(res.message);
      if (offer && ACCEPT_RE.test(res.text)) {
        return { acceptDraw: true, text: res.text, reasoning: res.reasoning, winrate: game.parseReply(state, seat, res.text).winrate, attempts, usage, model: served };
      }
      const parsed = game.parseReply(state, seat, res.text);
      if (parsed.action !== null && parsed.action !== undefined) {
        return { action: parsed.action, offerDraw: OFFER_RE.test(res.text), text: res.text, reasoning: res.reasoning, winrate: parsed.winrate, attempts, usage, model: served };
      }
      const error = res.text.trim() ? parsed.error : '只有思考、没有给出回答（可能用完了输出长度上限）';
      attempts.push({ text: res.text, reasoning: res.reasoning, error, attempted: parsed.attempted });
      this.hub.emit(channel, { type: 'illegal', ply: partial.ply, seat, attempt, error, attempted: parsed.attempted });
      if (attempt === MAX_RETRIES) {
        return { forfeit: `${game.seatName(seat)}连续 ${MAX_RETRIES + 1} 次给出无效${game.noun || '行动'}，判负`, text: res.text, reasoning: res.reasoning, attempts, usage, model: served };
      }
      conv.messages.push({ role: 'user', content: game.retryPrompt(error, attempt + 1, MAX_RETRIES) });
    }
    throw new Error('不可能到达');
  }

  // ---------- 结束 ----------

  #finish(m, rt, outcome, abortReason = null) {
    if (abortReason) {
      this.db.update('matches', { id: m.id }, { status: 'aborted', result: { over: true, aborted: true, reason: abortReason }, finished_at: now(), conversations: m.conversations });
    } else {
      let changes = null;
      if (m.mode !== 'casual') changes = applyResult(this.db, m.game, m.id, m.seats, outcome.ranks);
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
    const ranks = outcome.ranks || {};
    const best = Math.min(...Object.values(ranks));
    const allSame = Object.values(ranks).every((r) => r === best);
    for (const seat of Object.keys(m.seats)) {
      const ch = getCharacter(this.db, m.seats[seat]);
      const conv = m.conversations[seat];
      if (ch.kind !== 'model' || !ch.memory || !conv) continue;
      const res = allSame ? '平局' : ranks[seat] === best ? '你赢了' : '你输了';
      const messages = [...conv.messages, { role: 'user', content: `对局结束：${res}（${outcome.reason}）。请用一句话（不超过 60 字）总结这盘最值得记住的教训，供你以后的对局参考。只输出这句话。` }];
      const r = await callModel(this.db, ch, conv.system, messages);
      const text = r.text.trim().split('\n').filter(Boolean).pop()?.slice(0, 120);
      if (text) this.db.insert('notes', { character_id: ch.id, match_id: m.id, text, created_at: now() });
    }
  }

  // ---------- 控制 ----------

  #humanHandler(rt) {
    const hs = Object.values(rt?.humans || {});
    return hs[0] || null;
  }

  humanMove(matchId, action, offerDraw = false) {
    const h = this.#humanHandler(this.live.get(matchId));
    if (!h) throw new HttpError(409, '现在不是你行动');
    h.resolve(action, offerDraw);
  }

  control(matchId, op) {
    const rt = this.live.get(matchId);
    if (!rt) throw new HttpError(409, '对局不在进行中');
    const h = this.#humanHandler(rt);
    if (op === 'pause') rt.paused = true;
    else if (op === 'resume') { rt.paused = false; rt.wake?.(); }
    else if (op === 'step') { rt.step = true; rt.wake?.(); }
    else if (op === 'accept_draw') {
      if (!h) throw new HttpError(409, '只有轮到你走时才能接受和棋');
      h.acceptDraw();
    } else if (op === 'resign') {
      if (!h) throw new HttpError(409, '只有轮到你行动时才能认输');
      h.resign();
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

  resumeAll() {
    for (const m of this.db.all("SELECT id FROM matches WHERE status = 'running'")) this.run(m.id);
  }

  // ---------- 查询 ----------

  summary(matchId) {
    const m = this.db.get('SELECT id, game, mode, status, seats, result, rating_changes, challenge, created_at, finished_at, actions, options FROM matches WHERE id = ?', matchId);
    if (!m) return null;
    const players = {};
    for (const [seat, cid] of Object.entries(m.seats)) {
      players[seat] = this.db.get('SELECT id, name, avatar, kind, provider, model, level FROM characters WHERE id = ?', cid);
    }
    let game = null;
    try { game = getGame(m.game); } catch { /* 游戏已下线 */ }
    return {
      ...m, options: undefined, series: m.options?.series || null, plies: m.actions.length, actions: undefined, players, live: this.live.has(m.id),
      gameName: game?.name || m.game, seatNames: Object.fromEntries(Object.keys(m.seats).map((s) => [s, game?.seatName(s) || s])),
    };
  }

  /** viewer：观看者的座位；有玩家本人且游戏有隐藏信息时，进行中只给玩家自己的视角 */
  detail(matchId, viewer = null) {
    const m = this.db.get('SELECT * FROM matches WHERE id = ?', matchId);
    if (!m) throw new HttpError(404, '对局不存在');
    const game = getGame(m.game);
    const record = recordOf(m);
    const state = replay(game, record);
    const human = this.humanSeat(m);
    const running = m.status === 'running';
    let v = viewer && m.seats[viewer] ? viewer : null;
    if (game.features?.hidden && human && running) v = human;
    const turns = this.db.all('SELECT * FROM turns WHERE match_id = ? ORDER BY ply', matchId);
    const rt = this.live.get(matchId);
    const hide = m.options.hideThoughts && running;
    const sum = this.summary(matchId);
    const partials = Object.values(rt?.partials || {}).map((p) => (hide ? { ...p, text: '', reasoning: '' } : p));
    const humanH = this.#humanHandler(rt);
    return {
      ...sum,
      options: m.options,
      record: { ...record, actions: (game.features?.hidden && human && running) ? null : record.actions },
      startFen: m.start_fen,
      viewer: v,
      view: game.view(state, v),
      turns: turns.map((t) => (hide && t.character_id && this.#isModel(t.character_id) ? { ...t, analysis: null, reasoning: null, attempts: null, self_winrate: null } : t)),
      partials,
      partial: partials[0] || null,
      paused: rt?.paused || false,
      waitingHuman: humanH ? humanH.seat : null,
      humanActions: humanH ? game.actions(state, humanH.seat) : null,
      drawOfferToHuman: humanH?.offer || false,
      seatOrder: Object.keys(m.seats),
      features: game.features || {},
    };
  }

  #isModel(cid) {
    return this.db.get('SELECT kind FROM characters WHERE id = ?', cid)?.kind === 'model';
  }

  /** 今天某选手已下的盘数和 token 用量 */
  todayUsage(characterId) {
    const t = localDate(new Date());
    const rows = this.db.all("SELECT id, seats, created_at FROM matches WHERE created_at >= ? AND status != 'aborted'", new Date(Date.now() - 2 * 864e5).toISOString())
      .filter((r) => localDate(new Date(r.created_at)) === t && Object.values(r.seats).includes(characterId));
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
