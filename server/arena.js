// 电子斗蛐蛐核心：创建对局、向该出手的座位要行动（可以多个座位同时行动）、推送实时事件、结算积分。
// 游戏规则全部由 games/ 下的游戏定义负责，这里只负责调度。

import { getGame, replay } from '../games/index.js';
import { newId, now } from './db.js';
import { callModel } from './providers/index.js';
import { getCharacter, canRank, engineGameName } from './characters.js';
import { applyResult, PLACEMENT_GAMES, ratingKey } from './ladder/rating.js';
import { moveQuality } from './evaluator.js';
import { HttpError } from './http.js';
import { setPuzzleBank } from '../games/turtlesoup/index.js';
import { PUZZLES as SOUP_PUZZLES } from './puzzles/turtlesoup.js';
import { setWordBank } from '../games/undercover/index.js';
import { PAIRS as UC_PAIRS, HINTS as UC_HINTS } from './words/undercover.js';

setPuzzleBank(SOUP_PUZZLES);
setWordBank({ PAIRS: UC_PAIRS, HINTS: UC_HINTS });

export const MAX_RETRIES = 3; // 无效行动最多重来 3 次，仍无效判负
export const MAX_LIVE = 200; // 全站同时进行的对局上限（手动开局、组局）
export const MAX_LIVE_PER_USER = 10; // 一个用户同时开着的对局上限
const NOTES_IN_PROMPT = 5;

class Abort extends Error {}

// ---------- 提和（只用于支持提和的两人棋类游戏） ----------
// 任一方在走棋时可以附带提出和棋；对方下一步可以接受（对局以和棋结束），照常走棋即视为拒绝。
// 被拒后同一方 20 步（各 10 回合）内再提会被忽略，避免反复提和。
export const DRAW_COOLDOWN_PLIES = 20;
/** 提和规则说明，按各游戏的行动叫法（着法 / 落子）写 */
export const drawRule = (noun = '着法') => `【提和】如果你判断局面已经是和棋、继续下去只是浪费步数，可以在回答最后多写一行「求和：是」向对方提出和棋（这一步的${noun}照常写）。对方向你提和时我会告诉你：接受就把${noun}那一行写成「${noun}：接受和棋」，不接受就照常走。提和被拒后，10 个回合内不能再提。`;
export const DRAW_RULE = drawRule('着法');
const OFFER_RE = /求和[:：]\s*(是|提出|要)/;
const ACCEPT_RE = /(着法|落子|行动)[:：]\s*(接受和棋|同意和棋|接受求和|和棋)/;

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
/**
 * 去掉模型回答里的 Markdown 标记再交给游戏解析：「**出牌**：`3 3`」「1. 合作」这类写法很常见，
 * 各游戏的格式都是「键：值」，加粗、反引号、行首列表编号没有意义。
 */
export function plainReply(text) {
  return String(text || '')
    .replace(/\*\*|__|`/g, '')
    // 「键：「值」」去掉值外面的引号（发言里的引号保留，各游戏自己处理）
    .replace(/^([^\n：:]{1,8}[：:]\s*)[「『“"]([^」』”"\n]{1,12})[」』”"]\s*$/gm, '$1$2')
    .replace(/^[ \t]*(?:[-*>•]|\d{1,2}[.、)])[ \t]+(?=[^\n]*[：:])/gm, '');
}

/** 接口偶发失败（网络、限流、5xx、超时）时退避重试；密钥错、参数错之类直接抛出 */
const RETRY_WAITS = [5000, 20000, 60000];
async function withRetry(fn, signal, onRetry) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const st = err?.status ?? err?.statusCode;
      // 没有状态码时只把网络类错误当偶发（连接断开、超时、流中断）；代码异常、拒答、配置错误直接抛出
      const network = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|terminated|timeout|超时|连接/i.test(`${err?.code || ''} ${err?.name || ''} ${err?.message || ''}`);
      const transient = !signal?.aborted && !err?.refusal
        && (st === undefined ? network : st === 408 || st === 409 || st === 429 || st >= 500);
      if (!transient || i >= RETRY_WAITS.length) throw err;
      onRetry?.(err, i + 1, RETRY_WAITS[i]);
      await new Promise((resolve) => {
        const onAbort = () => { clearTimeout(t); resolve(); };
        const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, RETRY_WAITS[i]);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      if (signal?.aborted) throw err;
    }
  }
}

/**
 * 有真人玩家的隐藏信息对局里，这一步是不是私密行动（夜间行动等；game.secret 由游戏提供）。
 * 私密行动不进公共事件流；每位玩家刷新对局详情时，只看得到自己座位的私密行动。
 */
export function isSecret(game, state, seat, action, humans) {
  if (!humans?.length || !game.features?.hidden || !game.secret) return false;
  try { return !!game.secret(state, seat, action); } catch { return true; }
}

/** 逐步重放，标出对这位观看者（viewer 座位；null 为观众）要隐藏的步（ply 从 1 开始） */
export function secretPlies(game, record, viewer, humans = [viewer]) {
  const out = new Set();
  const hs = (humans || []).filter(Boolean);
  if (!hs.length || !game.secret || !game.features?.hidden) return out;
  let state = game.create({ players: record.players, seed: record.seed, setup: record.setup });
  (record.actions || []).forEach((a, i) => {
    const seat = typeof a === 'string' ? game.pending(state)[0] : a.seat;
    const action = typeof a === 'string' ? a : a.action;
    if (seat !== viewer && isSecret(game, state, seat, action, hs)) out.add(i + 1);
    state = game.apply(state, seat, action);
  });
  return out;
}

/** 公共视角：传给 game.view 的「不是任何座位」的观看者——谁的底牌、身份、夜间行动都看不到（null 是上帝视角） */
export const PUBLIC_VIEWER = '*';

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
    this.agentTurns = new Map(); // 自带 agent：characterId → 等它来领的回合列表
    this.agentWaiters = new Map(); // characterId → 正在长轮询的请求
    // 断线：账号最后一条连接断开的时间。过了宽限期还没回来，牌类游戏转系统托管，回来自动取消（见 #offlineCheck）
    this.offlineSince = new Map();
    hub.onPresence?.((uid, on) => this.#presenceChanged(uid, on));
  }

  // ---------- 托管、断线 ----------

  /** 打开 / 关掉某个真人座位的托管；reason：manual（本人点的）、timeout（超时）、offline（断线），null 为取消 */
  #setAuto(matchId, rt, seat, reason) {
    if ((rt.auto[seat] || null) === (reason || null)) return;
    if (reason) rt.auto[seat] = reason; else delete rt.auto[seat];
    this.hub.emit(`match:${matchId}`, { type: 'auto', seat, on: !!reason, reason: reason || null, auto: { ...rt.auto } });
    rt.humans[seat]?.autoChanged?.();
  }

  /** 这个账号坐在哪些进行中的对局里（真人座位） */
  liveSeatsOf(userId) {
    const out = [];
    for (const [matchId, rt] of this.live) {
      if (!rt.m) continue;
      const seat = this.seatOf(rt.m, userId);
      if (seat) out.push({ matchId, game: rt.m.game, seat, auto: rt.auto[seat] || null, myTurn: !!rt.humans[seat] });
    }
    return out;
  }

  #presenceChanged(uid, on) {
    if (on) {
      this.offlineSince.delete(uid);
      // 回来了：断线转的托管自动取消（本人点的、超时转的托管要本人取消）
      for (const { matchId, seat, auto } of this.liveSeatsOf(uid)) if (auto === 'offline') this.#setAuto(matchId, this.live.get(matchId), seat, null);
      return;
    }
    this.offlineSince.set(uid, Date.now());
    setTimeout(() => this.#offlineCheck(uid), OFFLINE_GRACE_MS + 50).unref?.();
    setTimeout(() => this.#offlineCheck(uid), OFFLINE_SLOW_MS + 50).unref?.();
  }

  /** 断线超过宽限期：牌类（有出牌限时的游戏）转托管；其他三人以上的游戏，断线 90 秒后正等着他的这一步由系统代打；两人对局不因断线判负，照常按每步限时 */
  #offlineCheck(uid) {
    const since = this.offlineSince.get(uid);
    if (since === undefined || this.hub.online?.(uid)) return;
    const gone = Date.now() - since;
    for (const { matchId, seat } of this.liveSeatsOf(uid)) {
      const rt = this.live.get(matchId);
      const game = getGame(rt.m.game);
      if (game.features?.turnLimit) {
        if (gone >= OFFLINE_GRACE_MS && !rt.auto[seat]) this.#setAuto(matchId, rt, seat, 'offline');
      } else if (gone >= OFFLINE_SLOW_MS && Object.keys(rt.m.seats).length > 2) rt.humans[seat]?.takeover?.('offline');
    }
  }

  // ---------- 自带 agent 选手 ----------

  /** 这名 agent 选手现在等着的回合（最早的一个） */
  agentPending(characterId) {
    return (this.agentTurns.get(characterId) || [])[0] || null;
  }

  /** 长轮询：等到有回合或超时；返回回合或 null */
  agentWait(characterId, ms, signal) {
    const now0 = this.agentPending(characterId);
    if (now0 || ms <= 0) return Promise.resolve(now0);
    return new Promise((resolve) => {
      const set = this.agentWaiters.get(characterId) || new Set();
      this.agentWaiters.set(characterId, set);
      const done = () => { clearTimeout(t); set.delete(wake); resolve(this.agentPending(characterId)); };
      const wake = () => done();
      const t = setTimeout(done, ms);
      set.add(wake);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  agentTurn(characterId, turnId) {
    return (this.agentTurns.get(characterId) || []).find((t) => t.id === turnId) || null;
  }

  #publishAgentTurn(turn) {
    const list = this.agentTurns.get(turn.characterId) || [];
    list.push(turn);
    this.agentTurns.set(turn.characterId, list);
    for (const wake of this.agentWaiters.get(turn.characterId) || []) wake();
  }

  #dropAgentTurn(turn) {
    const list = (this.agentTurns.get(turn.characterId) || []).filter((t) => t !== turn);
    if (list.length) this.agentTurns.set(turn.characterId, list);
    else this.agentTurns.delete(turn.characterId);
  }

  // ---------- 创建 ----------

  /**
   * seats: { seat: characterId }，座位数决定人数；mode: casual / ranked
   * options: { showLegal, delayMs, fen, setup, seed, hideThoughts, series }
   */
  /** origin：auto 自动匹配 / room 组局 / manual 手动开局；每日主动对局上限只算 auto。createdBy：开局的用户 */
  createMatch({ game: gameId = 'xiangqi', seats, mode = 'casual', options = {}, challenge = null, origin = 'manual', createdBy = null }) {
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
    if (new Set(humans.map((c) => c.id)).size < humans.length) throw new HttpError(400, '同一位真人玩家不能占两个座位');
    const agents = Object.values(chars).filter((c) => c.kind === 'agent');
    const outsiders = humans.length + agents.length;
    // game.newSetup：新开的对局默认带上的开局参数（例如规则版本；旧记录没有它，重放时按旧规则）
    let setup = { ...(game.newSetup || {}), ...(options.setup || {}), ...(options.fen ? { fen: options.fen } : {}) };
    if (mode === 'ranked') {
      const bad = Object.values(chars).filter((c) => !canRank(this.db, c));
      if (bad.length) throw new HttpError(400, `${bad.map((c) => c.name).join('、')} 不能参加排位赛（本机订阅和自定义接口只能下娱乐赛）`);
      // 自带 agent 在单独的天梯：排位里只能和 agent、内置 AI、引擎、随机同场，不和 API 模型选手混排
      const all = Object.values(chars);
      if (all.some((c) => c.kind === 'agent') && all.some((c) => c.kind === 'model' || c.kind === 'human')) {
        throw new HttpError(400, 'Agent 选手的排位在单独的 Agent 天梯：不能和 API 模型选手或玩家本人同场排位（娱乐赛可以）');
      }
      if (setup.fen) throw new HttpError(400, '排位赛只能从标准开局开始');
      const ids = Object.values(seats);
      const system = new Set(this.db.all('SELECT id FROM characters WHERE system = 1').map((r) => r.id));
      if (new Set(ids.filter((id) => !system.has(id))).size < ids.filter((id) => !system.has(id)).length) throw new HttpError(400, '排位赛里同一名选手不能占多个座位');
    }
    const seed = Number.isInteger(options.seed) ? options.seed : Math.floor(Math.random() * 2 ** 31);
    // 排位赛按游戏规定自动成为系列赛：五子棋等交换先后手，斗地主、德州复式轮换座位（同一副牌）
    if (mode === 'ranked' && game.rankedSeries && !options.series) {
      options = { ...options, series: { id: `s_${Date.now().toString(36)}`, leg: 1, of: game.rankedSeries.legs, seed } };
    }
    let state;
    try {
      // game.prepareSetup：开局时由服务端补全开局参数（例如海龟汤把选中的整道谜题写进去，题库只在服务端）
      if (game.prepareSetup) setup = game.prepareSetup(setup, seed);
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
        // 隐藏信息游戏里有玩家本人或自带 agent 时强制隐藏思考（模型会在思考里写自己的牌、词、身份；agent 和它的主人能看对局页）。
        // 有 agent 的排位赛也隐藏：对手的思考实时公开等于把计划告诉 agent。都在对局结束后公开
        hideThoughts: (outsiders > 0 && game.features?.hidden) || (agents.length > 0 && mode === 'ranked') ? true : options.hideThoughts ?? humans.length > 0,
        ...(options.series ? { series: options.series } : {}),
        // 真人每步限时（秒）：不给就按游戏的默认（牌类 features.turnLimit，其他 10 分钟）
        ...(Number(options.humanTimeout) > 0 ? { humanTimeout: Math.min(game.features?.clock ? 1800 : 600, Number(options.humanTimeout)) } : {}),
        // 两人棋类：超时几次判负
        ...(game.features?.clock && Number(options.timeoutLoss) > 0 ? { timeoutLoss: Math.min(10, Math.max(1, Math.round(Number(options.timeoutLoss)))) } : {}),
      },
      seats: Object.fromEntries(seatIds.map((s) => [s, seats[s]])),
      actions: [],
      challenge,
      conversations: {},
      origin: ['auto', 'room', 'manual'].includes(origin) ? origin : 'manual',
      created_by: createdBy,
      created_at: now(),
      started_at: now(),
    };
    this.db.insert('matches', m);
    this.hub.emit('lobby', { type: 'match_created', match: this.summary(m.id) });
    // 天梯给真人玩家匹配到了对局：发到他的私人频道，页面弹提示带他进对局
    if (m.origin === 'auto') for (const c of humans) this.hub.emit(`user:${c.owner_id}`, { type: 'invite', matchId: m.id, game: game.name, mode: m.mode });
    this.run(m.id);
    return m.id;
  }

  /**
   * 手动开局、组局开局的上限：全站同时进行的对局数，和一个用户同时开着的对局数（庄家不限；自动匹配另有并发设置）。
   * 每盘对局都占着内置 AI / 引擎的算力和一条循环，不设上限的话一个账号就能把服务拖垮
   */
  checkCapacity(user) {
    if (!user || user.role === 'admin') return;
    if (this.live.size >= MAX_LIVE) throw new HttpError(429, '现在进行中的对局太多了，等几盘结束再开');
    const mine = this.db.get("SELECT COUNT(*) AS n FROM matches WHERE status = 'running' AND created_by = ?", user.id).n;
    if (mine >= MAX_LIVE_PER_USER) throw new HttpError(429, `你同时开着 ${mine} 盘对局（最多 ${MAX_LIVE_PER_USER} 盘），等几盘结束再开`);
  }

  played(characterId, gameId) {
    return this.db.get('SELECT played FROM ratings WHERE character_id = ? AND game = ?', characterId, gameId)?.played || 0;
  }

  /** 真人玩家的座位（可以有多位，各自是不同账号） */
  humanSeats(m) {
    return Object.entries(m.seats).filter(([, cid]) => this.db.get('SELECT kind FROM characters WHERE id = ?', cid)?.kind === 'human').map(([seat]) => seat);
  }

  /**
   * 能自己打开网页、请求公开接口的座位：真人，和自带 agent（agent 是外面的程序，它和它的主人都能请求对局详情和事件流）。
   * 隐藏信息对局里只要有这样的座位，进行中就不对外给上帝视角、种子、别人的思考和私密行动；
   * 有引擎评估的棋类里，进行中也不对外给评估（里面有引擎推荐的最佳着法）。
   */
  outsideSeats(m) {
    return Object.entries(m.seats).filter(([, cid]) => ['human', 'agent'].includes(this.db.get('SELECT kind FROM characters WHERE id = ?', cid)?.kind)).map(([seat]) => seat);
  }

  /** 这个账号在这盘里坐的真人座位 */
  seatOf(m, userId) {
    if (!userId) return null;
    for (const [seat, cid] of Object.entries(m.seats)) {
      const c = this.db.get('SELECT kind, owner_id FROM characters WHERE id = ?', cid);
      if (c?.kind === 'human' && c.owner_id === userId) return seat;
    }
    return null;
  }

  // ---------- 运行 ----------

  run(matchId) {
    if (this.live.has(matchId)) return;
    const m = this.db.get('SELECT * FROM matches WHERE id = ?', matchId);
    if (!m || m.status !== 'running') return;
    const rt = { m, paused: false, step: false, abort: new AbortController(), humans: {}, partials: {}, wake: null, auto: {}, timeouts: {} };
    this.live.set(matchId, rt);
    this.#loop(m, rt)
      .catch((err) => {
        if (err instanceof Abort || rt.abort.signal.aborted) this.#finish(m, rt, null, rt.abortReason || '对局已中止');
        else {
          console.error(`[对局 ${matchId}]`, err);
          this.#finish(m, rt, null, `接口错误：${err.message}`);
        }
      })
      .finally(() => {
        this.live.delete(matchId);
        // 对局已经结束：还挂着的真人等待（限时器）、agent 回合、停顿都随之取消，不留到超时才清
        rt.abort.abort();
      });
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
    const humans = this.outsideSeats(m); // 真人和自带 agent：对它们要保密的对局
    const publicView = () => (hidden && humans.length ? null : game.view(state, null)); // 有真人（或 agent）时不广播局面，各自刷新详情
    // 进行中不对外给引擎评估（含最佳着法）：真人和 agent 都能从事件流里读到，等于开着引擎下棋；评估照常入库，结束后公开
    const evalPublic = !humans.length;

    if (!m.options.startEval && game.evalSpec) {
      const ev = await this.#evaluate(game, state, seatIds);
      if (ev) {
        m.options.startEval = { e: ev.raw.e, best: ev.raw.best, source: ev.raw.source, e0: ev.e0, redE: ev.e0 };
        this.db.update('matches', { id: m.id }, { options: m.options });
        if (evalPublic) this.hub.emit(channel, { type: 'eval', ply: 0, eval: m.options.startEval });
      }
    }
    let prevEval = null;
    if (game.evalSpec) {
      const last = m.actions.length ? this.db.get('SELECT eval FROM turns WHERE match_id = ? AND eval IS NOT NULL ORDER BY ply DESC LIMIT 1', m.id) : null;
      prevEval = last?.eval ? { raw: last.eval.raw, persp: last.eval.persp } : m.options.startEval ? { raw: { e: m.options.startEval.e, best: m.options.startEval.best }, persp: game.evalSpec(state)?.persp } : null;
    }

    // 开局停顿（例如德州第一手的开局提示）
    if (!m.actions.length && game.interlude) await sleep((game.interlude(null, state) || 0) * pauseScale(), rt);

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
        // 代答步（游戏说这一步不需要真的问该座位，例如狼人杀里已出局的狼）：不问选手，见 #getMove
        const auto = game.autoAction?.(state, seat) ?? null;
        rt.partials[seat] = { ply, seat, characterId: ch.id, text: '', reasoning: '', attempts: [], secret: isSecret(game, state, seat, null, humans), at: Date.now() };
        if (!rt.partials[seat].secret) this.hub.emit(channel, { type: 'turn_start', ply, seat, characterId: ch.id, kind: ch.kind, simultaneous: pend.length > 1 });
        else if (ch.kind !== 'human' || auto !== null) this.hub.emit(channel, { type: 'human_turn', seat: null }); // 真人的由 #humanMove 发；代答步不进 #humanMove，这里照样发一条
        const offer = game.features?.draw ? pendingOfferTo(m, seat) : null;
        const t0 = Date.now();
        return this.#getMove({ m, rt, game, state, seat, ch, channel, offer, ply, auto })
          .then((res) => ({ seat, ch, ply, offer, res, latency: Date.now() - t0 }));
      });
      const results = await Promise.all(jobs);
      const before = state;

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
        const secret = isSecret(game, state, seat, res.action, humans);
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
        const hideModel = m.options.hideThoughts && (ch.kind === 'model' || ch.kind === 'agent');
        if (secret) this.hub.emit(channel, { type: 'move', ply, seat: null, characterId: null, action: null, label: null, analysis: null, view: null, secret: true });
        else this.hub.emit(channel, {
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
            if (evalPublic) this.hub.emit(channel, { type: 'eval', ply, eval: ev });
            prevEval = after;
          }
        }
      }
      // 游戏要求的停顿（德州每手结束演结算、新一手弹开局提示），画面按同一份时长演完再继续
      const pause = game.interlude ? game.interlude(before, state) || 0 : 0;
      // 否则每一步之后至少停 turnPause（牌桌游戏：看清刚才那一手，再轮到下一位），开局设的间隔更长时按开局的
      // 取最长的：特效、开局设的间隔、游戏要求的停顿（测试里只缩游戏要求的，开局设的间隔照旧）
      const gap = Math.max(pause * pauseScale(), m.options.delayMs || 0, (game.turnPause || 0) * pauseScale());
      if (gap) await sleep(gap, rt);
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
    const { ch, game, state, seat, offer, rt, auto } = ctx;
    // 代答步：不调模型、不提示真人，直接交代答行动。私密步要像真的一样停一会儿（1.5–5 秒随机），
    // 旁人收到的事件和真的私密行动一样（human_turn 占位 + 私密 move），从时间上也分不出来
    const secret = !!rt.partials[seat]?.secret;
    const pad = AUTO_DELAY_MS[0] + Math.random() * (AUTO_DELAY_MS[1] - AUTO_DELAY_MS[0]);
    if (auto !== null && auto !== undefined) {
      if (secret) await sleep(pad, rt);
      if (rt.abort.signal.aborted) throw new Abort();
      return { action: auto };
    }
    // 真的私密行动（夜里）：内置 AI、随机选手瞬间就答完，而代答步要停 1.5–5 秒——旁人掐表就能分出哪一步真有人在行动
    //（比如预言家还活着没有）。所以不是真人的私密步也至少停这么久再交；模型、agent 想得更久就按实际的
    if (secret && ch.kind !== 'human') {
      const t0 = Date.now();
      const res = await this.#askMove(ctx);
      const left = pad - (Date.now() - t0);
      if (left > 0) await sleep(left, rt);
      if (rt.abort.signal.aborted) throw new Abort();
      return res;
    }
    return this.#askMove(ctx);
  }

  /** 真的去问这个座位的选手要行动 */
  async #askMove(ctx) {
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
      case 'agent': // 自带 agent 走同一套对话、重试、提和流程，只是不调模型接口，而是等 agent 来领回合、提交回答
        return this.#modelMove(ctx);
      default:
        throw new Error(`未知选手类型：${ch.kind}`);
    }
  }

  #humanMove({ m, rt, game, state, seat, offer }) {
    const secret = !!rt.partials[seat]?.secret;
    // 牌类游戏（features.turnLimit）：每步限时几十秒，超时由系统接管这一步并转托管；托管中系统直接代打
    const autoOk = !!game.features?.turnLimit;
    const limit = turnLimitMs(m, game);
    // 两人棋类：超时累计到次数判负
    const clock = game.features?.clock ? { max: timeoutLossOf(m) } : null;
    return new Promise((resolve, reject) => {
      let timer = null, autoTimer = null;
      const clear = () => { clearTimeout(timer); clearTimeout(autoTimer); };
      const onAbort = () => { clear(); reject(new Abort()); };
      const done = (v) => { clear(); rt.abort.signal.removeEventListener('abort', onAbort); delete rt.humans[seat]; resolve(v); };
      /** 系统接管这一步：why = auto（托管中）、timeout（超时）、offline（断线） */
      const takeover = async (why) => {
        if (rt.humans[seat] !== handle || handle.taking) return;
        handle.taking = true;
        if (why === 'timeout' && clock) {
          // 两人棋类：超时累计（整盘，存进对局选项，重启后接着数）；到达次数判负，没到就由系统代走一步
          const n = (m.options.timeouts?.[seat] || 0) + 1;
          m.options.timeouts = { ...(m.options.timeouts || {}), [seat]: n };
          this.db.update('matches', { id: m.id }, { options: m.options });
          const owner = this.#ownerOf(m, seat);
          if (n >= clock.max) { done({ forfeit: `${game.seatName(seat)}超时 ${n} 次，判负` }); return; }
          if (owner) this.hub.emit(`user:${owner}`, { type: 'turn_timeout', matchId: m.id, count: n, max: clock.max, clock: true });
          this.hub.emit(`match:${m.id}`, { type: 'timeouts', timeouts: { ...m.options.timeouts } });
          const a = await clockMove(game, state, seat);
          if (rt.humans[seat] !== handle) return;
          done(a !== null ? { action: a, timeout: true, text: `（超时，系统代走一步，第 ${n}/${clock.max} 次）` } : { forfeit: `${game.seatName(seat)}超时` });
          return;
        }
        let action = autoOk ? await autoMove(game, state, seat) : null;
        if (action === null) action = await timeoutAction(game, state, seat, Object.keys(m.seats).length).catch(() => null);
        if (rt.humans[seat] !== handle) return; // 对局已中止
        if (why === 'timeout') {
          // 连续超时计数（本人自己出了一步就清零）：牌类连续两次超时才转托管，第一次只代打这一步并提醒本人
          const n = rt.timeouts[seat] = (rt.timeouts[seat] || 0) + 1;
          if (autoOk && n >= TIMEOUTS_TO_AUTO) this.#setAuto(m.id, rt, seat, 'timeout');
          else if (autoOk) {
            const owner = this.#ownerOf(m, seat);
            if (owner) this.hub.emit(`user:${owner}`, { type: 'turn_timeout', matchId: m.id, count: n, left: TIMEOUTS_TO_AUTO - n });
          }
        }
        done(action !== null ? { action, timeout: true, text: TAKEOVER_NOTE[why] } : { forfeit: `${game.seatName(seat)}超时` });
      };
      const arm = () => {
        clearTimeout(timer);
        handle.at = Date.now();
        handle.deadline = handle.at + limit;
        timer = setTimeout(() => takeover('timeout'), limit);
      };
      const handle = {
        at: Date.now(), deadline: Date.now() + limit, limit,
        seat, offer: !!offer, takeover, taking: false,
        resolve: (action, offerDraw = false) => {
          if (handle.taking) throw new HttpError(409, '系统已经替你出了这一步');
          const acts = game.actions(state, seat);
          if (!acts || !acts.some((a) => a.id === action)) {
            // 自由文本，或不在代表性列表里的行动（例如德州的任意加注额）：交给游戏规则校验
            try { game.apply(state, seat, action); } catch (e) { throw new HttpError(400, e.message); }
          }
          rt.timeouts[seat] = 0; // 自己出了：连续超时清零
          done({ action, offerDraw });
        },
        acceptDraw: () => {
          if (!offer) throw new HttpError(409, '对方没有提出和棋');
          done({ acceptDraw: true });
        },
        resign: () => done({ forfeit: `${game.seatName(seat)}认输` }),
        // 托管开了：稍停一下就代打（像人出牌的节奏）；关了：这一步重新计时
        autoChanged: () => {
          clearTimeout(autoTimer);
          if (handle.taking) return;
          if (rt.auto[seat]) autoTimer = setTimeout(() => takeover('auto'), AUTO_PLAY_MS[0] + Math.random() * (AUTO_PLAY_MS[1] - AUTO_PLAY_MS[0]));
          else arm();
        },
      };
      rt.humans[seat] = handle;
      // 限时：挂机不能卡住整局（成熟平台都有回合计时和托管）
      arm();
      // 私密行动（夜里）不说是谁：各位玩家收到后刷新详情，只有轮到的那位能拿到自己的行动
      this.hub.emit(`match:${m.id}`, { type: 'human_turn', seat: secret ? null : seat });
      rt.abort.signal.addEventListener('abort', onAbort, { once: true });
      if (rt.auto[seat] && autoOk) handle.autoChanged();
      else {
        // 轮到时人已经断线一阵子了：按断线规则处理（见 #offlineCheck）
        const owner = this.#ownerOf(m, seat);
        const since = owner ? this.offlineSince.get(owner) : undefined;
        if (since !== undefined && !this.hub.online?.(owner) && (autoOk || Object.keys(m.seats).length > 2)) {
          const wait = (autoOk ? OFFLINE_GRACE_MS : OFFLINE_SLOW_MS) - (Date.now() - since);
          setTimeout(() => this.#offlineCheck(owner), Math.max(0, wait) + 50).unref?.();
        }
      }
    });
  }

  /** 真人座位是哪个账号的 */
  #ownerOf(m, seat) {
    const c = this.db.get('SELECT kind, owner_id FROM characters WHERE id = ?', m.seats[seat]);
    return c?.kind === 'human' ? c.owner_id : null;
  }

  /**
   * 无效行动的事件：理由里可能带着私密信息（谁是卧底「发言里不能出现你的词『奶酪』」、斗地主压不过的那手牌就是它手里的牌），
   * 所以有真人的隐藏信息对局里只告诉大家「第几次无效」，理由和原话等对局结束后从记录里看
   */
  #illegalEvent(m, game, e) {
    if (game.features?.hidden && this.outsideSeats(m).length) return { type: 'illegal', ply: e.ply, seat: e.seat, attempt: e.attempt };
    return { type: 'illegal', ...e };
  }

  /** 模型行动：整局保持一段连续的对话（模型能看到自己整局的思考） */
  async #modelMove({ m, rt, game, state, seat, ch, channel, offer }) {
    const showLegal = !!ch.show_legal && m.options.showLegal;
    let conv = m.conversations[seat];
    if (!conv) {
      // 同一副牌的系列赛：不带复盘笔记，免得把上一盘记下的牌带进这一盘
      const sameDeck = m.options.series && game.rankedSeries?.sameSeed;
      const notes = ch.memory && !sameDeck
        ? this.db.all('SELECT text FROM notes WHERE character_id = ? ORDER BY created_at DESC LIMIT ?', ch.id, NOTES_IN_PROMPT).map((n) => n.text)
        : [];
      let system = game.systemPrompt(seat, { style: ch.style, showLegal, players: Object.keys(m.seats).length, state });
      if (game.features?.draw) system += `\n\n${drawRule(game.noun)}`;
      if (notes.length) system += `\n\n【你以前对局的复盘笔记】\n${notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;
      conv = m.conversations[seat] = { system, messages: [], drawRule: !!game.features?.draw };
    }
    let turn = game.turnPrompt(state, seat, { showLegal });
    if (game.features?.draw && !conv.drawRule && !conv.system.includes('求和')) { turn = `${drawRule(game.noun)}\n\n${turn}`; conv.drawRule = true; }
    if (offer) turn = `对方提出了和棋。接受就把${game.noun || '着法'}那一行写成「${game.noun || '着法'}：接受和棋」；不接受就照常走。\n\n${turn}`;
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
    const isAgent = ch.kind === 'agent';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      partial.text = '';
      partial.reasoning = '';
      partial.attempt = attempt;
      // 旧对局（开局时还没有这条规则）里有 agent 的隐藏信息局也按隐藏处理
      const hide = m.options.hideThoughts || (!!game.features?.hidden && this.outsideSeats(m).length > 0);
      if (isAgent) {
        const retry = attempt ? attempts[attempts.length - 1].error : null;
        const res = await this.#agentCall({ m, rt, ch, game, state, seat, conv, partial, channel, hide, attempt, turn, retry, showLegal });
        if (res.offline) {
          return { forfeit: `${game.seatName(seat)}（${ch.name}）${ch.agent_timeout || 180} 秒内没有来领回合，判负（agent 不在线）`, attempts, usage, model: served };
        }
        res.text = plainReply(res.text);
        for (const k of Object.keys(usage)) usage[k] += res.usage?.[k] || 0;
        served = res.model || served;
        conv.messages.push(res.message);
        const verdict = (v) => { res.report?.(v); return v; };
        if (offer && ACCEPT_RE.test(res.text)) {
          verdict({ ok: true, accepted_draw: true });
          return { acceptDraw: true, text: res.text, reasoning: res.reasoning, winrate: game.parseReply(state, seat, res.text).winrate, attempts, usage, model: served };
        }
        const parsed = res.timeout ? { action: null, error: `超过每步限时（${ch.agent_timeout || 180} 秒）没有提交` }
          : res.directAction !== null && res.directAction !== undefined ? { action: res.directAction, winrate: res.text ? game.parseReply(state, seat, res.text).winrate : null }
            : game.parseReply(state, seat, res.text);
        if (parsed.action !== null && parsed.action !== undefined) {
          verdict({ ok: true, action: parsed.action, label: game.label(state, seat, parsed.action) });
          return { action: parsed.action, offerDraw: OFFER_RE.test(res.text), text: res.text, reasoning: res.reasoning, winrate: parsed.winrate, attempts, usage, model: served };
        }
        const error = res.timeout || res.text.trim() ? parsed.error : '回答是空的';
        attempts.push({ text: res.text, reasoning: res.reasoning, error, attempted: parsed.attempted });
        if (!partial.secret) this.hub.emit(channel, this.#illegalEvent(m, game, { ply: partial.ply, seat, attempt, error, attempted: parsed.attempted }));
        verdict({ ok: false, error, retries_left: MAX_RETRIES - attempt });
        if (attempt === MAX_RETRIES) {
          return { forfeit: `${game.seatName(seat)}连续 ${MAX_RETRIES + 1} 次给出无效${game.noun || '行动'}，判负`, text: res.text, reasoning: res.reasoning, attempts, usage, model: served };
        }
        conv.messages.push({ role: 'user', content: game.retryPrompt(error, attempt + 1, MAX_RETRIES) });
        continue;
      }
      const res = await withRetry(() => {
        partial.text = '';
        partial.reasoning = '';
        return callModel(this.db, ch, conv.system, conv.messages, (d) => {
          if (d.kind === 'text') partial.text += d.text;
          else partial.reasoning += d.text;
          if (!hide) this.hub.emit(channel, { type: 'delta', ply: partial.ply, seat, attempt, kind: d.kind, text: d.text });
        }, rt.abort.signal, { mockText });
      }, rt.abort.signal, (err, n, wait) => console.warn(`[对局 ${m.id}] ${ch.name} 接口出错（${err.message}），${wait / 1000} 秒后第 ${n} 次重试`));
      res.text = plainReply(res.text);
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
      if (!partial.secret) this.hub.emit(channel, this.#illegalEvent(m, game, { ply: partial.ply, seat, attempt, error, attempted: parsed.attempted }));
      if (attempt === MAX_RETRIES) {
        return { forfeit: `${game.seatName(seat)}连续 ${MAX_RETRIES + 1} 次给出无效${game.noun || '行动'}，判负`, text: res.text, reasoning: res.reasoning, attempts, usage, model: served };
      }
      conv.messages.push({ role: 'user', content: game.retryPrompt(error, attempt + 1, MAX_RETRIES) });
    }
    throw new Error('不可能到达');
  }

  /**
   * 自带 agent 的一次回答：发布回合，等 agent 领走并提交。
   * 返回 { text, reasoning, usage, model, message, report }；report(verdict) 把判定结果回给提交请求。
   * 限时内没来领：{ offline: true }；领了但没提交：{ timeout: true, text: '' }。
   */
  #agentCall({ m, rt, ch, game, state, seat, conv, partial, channel, hide, attempt, turn: turnText, retry, showLegal }) {
    const timeoutMs = (ch.agent_timeout || 180) * 1000;
    return new Promise((resolve, reject) => {
      const acts = showLegal ? game.actions(state, seat) : null;
      const t = {
        id: newId('turn'), characterId: ch.id, matchId: m.id, seat, ply: partial.ply, attempt,
        game: game.id, gameName: game.name, seatName: game.seatName(seat), noun: game.noun || '行动',
        system: conv.system, prompt: turnText, retry,
        actions: Array.isArray(acts) ? acts.slice(0, 500).map((a) => ({ id: a.id, label: a.label })) : null,
        createdAt: Date.now(), deadline: Date.now() + timeoutMs, fetched: false,
      };
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rt.abort.signal.removeEventListener('abort', onAbort); // 每个回合挂一个监听，回合结束就摘掉，不留到整盘结束
        this.#dropAgentTurn(t);
        resolve(value);
      };
      t.think = (text) => {
        // 一个回合里推送的思考合计最多 AGENT_THINK_MAX 字（进内存、进数据库、推给所有观众）
        const chunk = String(text || '').slice(0, Math.min(4000, Math.max(0, AGENT_THINK_MAX - partial.reasoning.length - 1)));
        if (!chunk || settled) return;
        partial.reasoning += (partial.reasoning ? '\n' : '') + chunk;
        if (!hide) this.hub.emit(channel, { type: 'delta', ply: partial.ply, seat, attempt, kind: 'reasoning', text: (partial.reasoning === chunk ? '' : '\n') + chunk });
      };
      t.submit = (reply, meta = {}) => {
        if (settled) throw new HttpError(409, '这个回合已经结束');
        const text = String(reply || '').slice(0, 8000);
        const u = meta.usage || {};
        const tok = (v) => Math.max(0, Math.min(1e7, Math.round(Number(v) || 0))); // 自报的用量封顶，免得一个离谱的数把统计冲坏
        const usage = { input: tok(u.input), output: tok(u.output) };
        return new Promise((report) => {
          finish({
            text, reasoning: partial.reasoning || null, usage,
            model: meta.model ? `自报：${String(meta.model).slice(0, 60)}` : 'agent',
            message: { role: 'assistant', content: text || `${game.noun || '行动'}：${meta.action}` }, report,
            directAction: meta.action ?? null, // 直接提交了 legal_actions 里的 id
          });
        });
      };
      const timer = setTimeout(() => {
        finish(t.fetched ? { timeout: true, text: '', reasoning: partial.reasoning || null, message: { role: 'assistant', content: '' } } : { offline: true });
      }, timeoutMs);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#dropAgentTurn(t);
        reject(new Abort());
      };
      rt.abort.signal.addEventListener('abort', onAbort, { once: true });
      this.#publishAgentTurn(t);
    });
  }

  // ---------- 结束 ----------

  #finish(m, rt, outcome, abortReason = null) {
    if (abortReason) {
      this.db.update('matches', { id: m.id }, { status: 'aborted', result: { over: true, aborted: true, reason: abortReason }, finished_at: now(), conversations: m.conversations });
    } else {
      let changes = null;
      if (m.mode !== 'casual') {
        // 有自带 agent 的排位记在单独的 Agent 天梯
        const kinds = Object.values(m.seats).map((cid) => this.db.get('SELECT kind FROM characters WHERE id = ?', cid)?.kind);
        // outcome.unrated：不参加积分的座位（例如海龟汤的汤主，只主持不比赛）
        const off = new Set(outcome.unrated || []);
        const rated = Object.fromEntries(Object.entries(m.seats).filter(([s]) => !off.has(s)));
        changes = Object.keys(rated).length >= 2 ? applyResult(this.db, ratingKey(m.game, kinds), m.id, rated, outcome.ranks) : null;
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

  /** 等某个座位的真人行动的句柄；seat 省略时取任意一位（单人对局、测试用） */
  #humanHandler(rt, seat) {
    if (seat !== undefined) return (seat && rt?.humans?.[seat]) || null;
    return Object.values(rt?.humans || {})[0] || null;
  }

  humanMove(matchId, action, offerDraw = false, seat) {
    const h = this.#humanHandler(this.live.get(matchId), seat);
    if (!h) throw new HttpError(409, '现在不是你行动');
    h.resolve(action, offerDraw);
  }

  control(matchId, op, seat) {
    const rt = this.live.get(matchId);
    if (!rt) throw new HttpError(409, '对局不在进行中');
    const h = this.#humanHandler(rt, seat);
    if (op === 'auto_on' || op === 'auto_off') {
      if (!seat) throw new HttpError(403, '你不在这盘对局里');
      if (!getGame(rt.m.game).features?.turnLimit) throw new HttpError(400, '这个游戏没有托管');
      if (op === 'auto_off') rt.timeouts[seat] = 0; // 本人收回来了：重新数连续超时
      this.#setAuto(matchId, rt, seat, op === 'auto_on' ? 'manual' : null);
      return { auto: { ...rt.auto } };
    }
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
    const m = this.db.get('SELECT id, game, mode, status, seats, result, rating_changes, challenge, created_at, finished_at, actions, options, origin, created_by FROM matches WHERE id = ?', matchId);
    if (!m) return null;
    const players = {};
    for (const [seat, cid] of Object.entries(m.seats)) {
      // owner：这只蛐蛐是谁的（组局里显示「谁带来的」）
      players[seat] = this.db.get('SELECT c.id, c.name, c.avatar, c.kind, c.provider, c.model, c.level, c.owner_id, c.system, u.name AS owner FROM characters c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?', cid);
      // 真人角色在别人眼里显示账号名（庄家的真人角色叫「我」，别人看到「我」会以为是自己）
      if (players[seat]?.kind === 'human' && players[seat].owner) players[seat].name = players[seat].owner;
    }
    let game = null;
    try { game = getGame(m.game); } catch { /* 游戏已下线 */ }
    return {
      ...m, options: undefined, series: m.options?.series ? { ...m.options.series, seed: undefined } : null, plies: m.actions.length, actions: undefined, players, live: this.live.has(m.id),
      gameName: game?.name || m.game, seatNames: Object.fromEntries(Object.keys(m.seats).map((s) => [s, game?.seatName(s) || s])),
    };
  }

  /**
   * viewer：想看的座位视角；userId：请求的账号。
   * 有真人玩家的隐藏信息对局进行中：玩家只能看自己座位的视角，观众只能看公共视角（谁的牌都看不到）。
   */
  detail(matchId, viewer = null, userId = null) {
    const m = this.db.get('SELECT * FROM matches WHERE id = ?', matchId);
    if (!m) throw new HttpError(404, '对局不存在');
    const game = getGame(m.game);
    const record = recordOf(m);
    const state = replay(game, record);
    const humans = this.outsideSeats(m); // 真人和自带 agent
    const mySeat = this.seatOf(m, userId);
    const running = m.status === 'running';
    // 进行中有真人或 agent：不给引擎评估（里面有最佳着法），结束后公开
    const evalHidden = running && humans.length > 0 && !!game.evalSpec;
    const hiddenLive = !!game.features?.hidden && humans.length > 0 && running;
    // 不剧透：没有真人的隐藏信息对局，观众可以主动选公共视角（viewer = '*'）——身份、底牌、夜间行动和思考都先不看
    const pov = !hiddenLive && running && !!game.features?.hidden && viewer === PUBLIC_VIEWER;
    const masked = hiddenLive || pov;
    let v = viewer && Object.hasOwn(m.seats, viewer) ? viewer : null;
    if (hiddenLive) v = mySeat; // 观众（null）在下面换成公共视角
    const turns = this.db.all('SELECT * FROM turns WHERE match_id = ? ORDER BY ply', matchId);
    const rt = this.live.get(matchId);
    const hide = (m.options.hideThoughts && running) || pov || hiddenLive;
    const sum = this.summary(matchId);
    const secrets = masked ? secretPlies(game, record, v, hiddenLive ? humans : [PUBLIC_VIEWER]) : new Set();
    const secretNow = (p) => (pov ? isSecret(game, state, p.seat, null, [PUBLIC_VIEWER]) : p.secret);
    const partials = Object.values(rt?.partials || {}).filter((p) => !(masked && secretNow(p)) && !rt?.humans?.[p.seat]).map((p) => ({ ...(hide ? { ...p, text: '', reasoning: '' } : p), elapsed: p.at ? Date.now() - p.at : 0 }));
    // 只告诉这位玩家自己座位在等他行动
    const humanH = this.#humanHandler(rt, mySeat);
    return {
      ...sum,
      // 系列赛的种子不给浏览器（第 1 盘的种子就是本盘种子，拿到就能算出别人的牌）
      options: { ...m.options, ...(m.options?.series ? { series: { ...m.options.series, seed: undefined } } : {}), ...(evalHidden ? { startEval: undefined } : {}) },
      // 给页面的标记：这盘进行中只有公共视角（有真人或自带 agent 的隐藏信息对局）；评估先不给
      hiddenLive, evalHidden,
      // 有玩家本人的隐藏信息对局进行中：不给记录、种子和开局参数（拿种子就能在浏览器里重放出所有人的牌）
      // 题库、词库只在服务端：旧记录的开局参数里没有题目和词时按种子补上，浏览器才能自己重放
      record: masked ? { players: record.players, actions: null } : game.prepareSetup ? { ...record, setup: game.prepareSetup(record.setup, record.seed) } : record,
      startFen: m.start_fen,
      viewer: pov ? PUBLIC_VIEWER : v,
      pov: pov ? 'public' : null,
      mySeat,
      view: game.view(state, (hiddenLive && !v) || pov ? PUBLIC_VIEWER : v),
      turns: turns.filter((t) => !secrets.has(t.ply))
        .map((t) => (hide && t.character_id && this.#isModel(t.character_id) ? { ...t, analysis: null, reasoning: null, attempts: null, self_winrate: null } : t))
        .map((t) => (evalHidden && t.eval ? { ...t, eval: null } : t)),
      partials,
      partial: partials[0] || null,
      paused: rt?.paused || false,
      waitingHuman: humanH ? humanH.seat : null,
      // 已经想了多久（毫秒）：浏览器用它接上思考计时，不依赖两边的时钟一致
      waitingElapsed: humanH ? Date.now() - humanH.at : null,
      // 这一步还剩多久（毫秒）、每步限时；托管中的座位（谁在托管大家都看得到，和成熟平台一样）
      waitingLeft: humanH ? Math.max(0, humanH.deadline - Date.now()) : null,
      turnLimit: game.features?.turnLimit || game.features?.clock ? turnLimitMs(m, game) : null,
      // 两人棋类：超时几次判负、各方已超时几次（公开）
      timeoutLoss: game.features?.clock ? timeoutLossOf(m) : null,
      timeouts: game.features?.clock ? { ...(m.options?.timeouts || {}) } : null,
      auto: { ...(rt?.auto || {}) },
      // 我已经连续超时几次（牌类再超时一次就转托管时页面提醒）
      myTimeouts: !mySeat ? 0 : game.features?.clock ? m.options?.timeouts?.[mySeat] || 0 : rt?.timeouts?.[mySeat] || 0,
      humanActions: humanH ? game.actions(state, humanH.seat) : null,
      drawOfferToHuman: humanH?.offer || false,
      seatOrder: Object.keys(m.seats),
      features: game.features || {},
    };
  }

  #isModel(cid) {
    return ['model', 'agent'].includes(this.db.get('SELECT kind FROM characters WHERE id = ?', cid)?.kind); // 会写思考的选手
  }

  /** 今天某选手已下的盘数和 token 用量 */
  todayUsage(characterId) {
    const t = localDate(new Date());
    const rows = this.db.all("SELECT id, seats, created_at, origin, mode FROM matches WHERE created_at >= ? AND status != 'aborted'", new Date(Date.now() - 2 * 864e5).toISOString())
      .filter((r) => localDate(new Date(r.created_at)) === t && Object.values(r.seats).includes(characterId));
    // 每日上限只算「主动参加」的对局（自动匹配）；被拉进组局、手动开的不算。旧数据没有 origin 时按排位赛算
    const counted = rows.filter((r) => r.origin === 'auto' || (!r.origin && r.mode !== 'casual'));
    let tokens = 0;
    for (const r of rows) {
      for (const u of this.db.all('SELECT usage FROM turns WHERE match_id = ? AND character_id = ?', r.id, characterId)) {
        tokens += (u.usage?.input || 0) + (u.usage?.output || 0);
      }
    }
    return { games: counted.length, all: rows.length, tokens, matchIds: rows.map((r) => r.id) };
  }

  busy(characterId) {
    for (const id of this.live.keys()) {
      const m = this.db.get('SELECT seats FROM matches WHERE id = ?', id);
      if (m && Object.values(m.seats).includes(characterId)) return true;
    }
    return false;
  }
}

/** 步与步之间停顿的倍数：测试时设 ARENA_PAUSE_SCALE=0（test/setup.js），整盘狼人杀不用真的等每句发言打完字 */
function pauseScale() {
  const v = Number(process.env.ARENA_PAUSE_SCALE);
  return process.env.ARENA_PAUSE_SCALE !== undefined && Number.isFinite(v) && v >= 0 ? v : 1;
}

function sleep(ms, rt) {
  return new Promise((resolve) => {
    const onAbort = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { rt.abort.signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    rt.abort.signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 私密代答步的随机停顿范围（毫秒） */
export const AUTO_DELAY_MS = [1500, 5000];

/** 真人每一步的限时（秒）：超时按默认行动（过牌、不出、不叫、弃票、弃牌）；没有默认行动时，多人局由系统代打这一步，两人局判超时负 */
const HUMAN_TIMEOUT_S = 600;
/** 每步限时（毫秒）：对局选项 humanTimeout（秒）优先，其次游戏的 features.turnLimit（牌类 60 秒）；两人棋类（features.clock）默认 5 分钟，其他 10 分钟 */
export function turnLimitMs(m, game) {
  const s = Number(m.options?.humanTimeout) || game.features?.turnLimit || (game.features?.clock ? CLOCK_DEFAULT_S : HUMAN_TIMEOUT_S);
  return Math.max(game.features?.turnLimit || game.features?.clock ? 5 : 30, s) * 1000;
}
/** 断线宽限：牌类断线 15 秒转托管；其他三人以上的游戏断线 90 秒后由系统代打正等着他的那一步 */
export const OFFLINE_GRACE_MS = Number(process.env.ARENA_OFFLINE_GRACE_MS) || 15000;
export const OFFLINE_SLOW_MS = Number(process.env.ARENA_OFFLINE_SLOW_MS) || 90000;
/** 托管时代打一步前的停顿（毫秒） */
const AUTO_PLAY_MS = [700, 1400];
/** 两人棋类：每步限时默认 5 分钟，超时 3 次判负（开局时可以改） */
export const CLOCK_DEFAULT_S = 300;
export const TIMEOUT_LOSS_DEFAULT = 3;
export const timeoutLossOf = (m) => Math.min(10, Math.max(1, Math.round(Number(m.options?.timeoutLoss)) || TIMEOUT_LOSS_DEFAULT));
/** 两人棋类超时代走：内置 AI 最低档（不送强着），不行就取第一个合法行动 */
async function clockMove(game, state, seat) {
  try {
    const a = await game.builtinMove(state, seat, { level: 1, depth: 1 });
    if (a !== null && a !== undefined) { game.apply(state, seat, a); return a; }
  } catch { /* 用下面的 */ }
  try {
    const acts = game.actions(state, seat);
    return Array.isArray(acts) && acts.length ? acts[0].id : null;
  } catch { return null; }
}
/** 牌类连续超时几次转托管 */
export const TIMEOUTS_TO_AUTO = 2;
const TAKEOVER_NOTE = { timeout: '（超时，系统代为行动）', auto: '（托管，系统代为行动）', offline: '（断线，系统代为行动）' };
/** 托管、超时接管用内置 AI 的中档；不合法或出错时返回 null（再退回 timeoutAction） */
async function autoMove(game, state, seat) {
  try {
    const a = await game.builtinMove(state, seat, { level: 2, depth: 2 });
    if (a === null || a === undefined) return null;
    game.apply(state, seat, a);
    return a;
  } catch { return null; }
}
const TIMEOUT_SAFE = ['check', '不出', '叫0', 'none', 'fold', 'pass'];
const TIMEOUT_SPEECH = ['（超时，没有发言）', '过。'];
/** 自带 agent 一个回合里推送的思考合计上限（字） */
const AGENT_THINK_MAX = 20000;

/**
 * 真人超时后的行动；返回 null 表示判超时负。
 * 有不吃亏的默认行动就用它。没有的话（狼人杀发言、预言家查验、斗地主领出、卧底投票……）：
 * 三人以上的对局里一个人挂机不该让整桌散场、队友跟着判负，由系统代打这一步——发言只说一句「超时」（不替他表态），其余用内置 AI 最低档；
 * 两人对局照旧判超时负。
 */
export async function timeoutAction(game, state, seat, seatCount) {
  let acts;
  try { acts = game.actions(state, seat); } catch { acts = []; }
  if (Array.isArray(acts)) {
    const safe = TIMEOUT_SAFE.find((id) => acts.some((a) => a.id === id));
    if (safe) return safe;
  }
  if (seatCount <= 2) return null;
  const valid = (a) => { try { game.apply(state, seat, a); return true; } catch { return false; } };
  if (acts === null) {
    const say = TIMEOUT_SPEECH.find(valid);
    if (say) return say;
  }
  const a = await game.builtinMove(state, seat, { level: 1 });
  return a !== null && a !== undefined && valid(a) ? a : null;
}
