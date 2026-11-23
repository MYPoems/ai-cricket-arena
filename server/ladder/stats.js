// 天梯的扩展统计：分数的不确定性、不对称游戏按阵营分开的胜率和阵营分、对位热力图、出手快慢和花费。
// 只读现有的表（matches、turns、ratings、characters）。重的部分按「库 + 游戏 + 榜」缓存，有新的排位对局结束才重算。

import { rating, rate } from 'openskill';
import { getGame, replay } from '../../games/index.js';
import { leaderboard, score, uncertainty, poolKey } from './rating.js';
import { modelBoard, seatOutcome } from '../stats.js';

export const ACTIVE_DAYS = 14; // 「活跃」看最近 14 天
export const ACTIVE_MIN = 5; // 14 天内至少 5 局
export const HEAT_MAX = 12; // 热力图最多 12 × 12
const HEAT_GAMES = 20; // 每个格子记最近 20 盘
const DAY = 864e5;

/** 不对称游戏的两个阵营（和 result.teams 里的名字一致）；旧记录没有 teams 时从重放出的局面里认 */
export const ROLE_SIDES = {
  werewolf: { sides: ['狼人', '好人'], of: (s, seat) => (s.roles?.[seat] === 'wolf' ? '狼人' : '好人') },
  undercover: { sides: ['卧底', '平民'], of: (s, seat) => (s.spies?.includes(seat) ? '卧底' : '平民') },
  doudizhu: { sides: ['地主', '农民'], of: (s, seat) => (!s.landlord ? null : seat === s.landlord ? '地主' : '农民') },
};

/** 对局记录 → 重放用的参数（和 arena.js 的 recordOf 相同，这里不引入整个对局引擎） */
const recordOf = (m) => {
  const s = m.setup || {};
  return { setup: s.setup || (m.start_fen ? { fen: m.start_fen } : {}), seed: s.seed, players: s.players || Object.keys(m.seats).length, actions: m.actions };
};

const replayed = new Map(); // 对局 id → { 座位: 阵营 } | null（只缓存需要重放的旧记录）

/** 一盘的座位 → 阵营；结果里带了 teams 就直接用，没有就重放对局求出 */
export function seatSides(db, m) {
  const spec = ROLE_SIDES[m.game];
  if (!spec) return null;
  const teams = m.result?.teams;
  if (teams && spec.sides.every((x) => Array.isArray(teams[x]))) {
    const out = {};
    for (const side of spec.sides) for (const seat of teams[side]) out[seat] = side;
    return out;
  }
  if (replayed.has(m.id)) return replayed.get(m.id);
  let out = null;
  try {
    const row = db.get('SELECT setup, start_fen, actions, seats FROM matches WHERE id = ?', m.id);
    const state = replay(getGame(m.game), recordOf(row));
    out = {};
    for (const seat of Object.keys(row.seats)) {
      const side = spec.of(state, seat);
      if (side) out[seat] = side;
    }
    if (!Object.keys(out).length) out = null;
  } catch {
    out = null;
  }
  replayed.set(m.id, out);
  return out;
}

/**
 * a 对 b 这一盘的结果（'w' / 'd' / 'l'）；同队不算交手返回 null。有名次就比名次，没有就看 a 的胜负。
 * sides：座位 → 阵营（旧记录结果里没有 teams 时由重放得到）
 */
export function pairOutcome(result, seatA, seatB, sides = null) {
  if (Object.values(result?.teams || {}).some((t) => t.includes(seatA) && t.includes(seatB))) return null;
  if (sides?.[seatA] && sides[seatA] === sides[seatB]) return null;
  const r = result?.ranks;
  if (r && r[seatA] !== undefined && r[seatB] !== undefined) return r[seatA] < r[seatB] ? 'w' : r[seatA] > r[seatB] ? 'l' : 'd';
  return seatOutcome(result, seatA);
}

/** 某座位的名次；结果里没有名次时，赢家算第 1、其余第 2 */
const rankOf = (result, seat) => result?.ranks?.[seat] ?? (seatOutcome(result, seat) === 'l' ? 2 : 1);

/** 榜上的一行代表谁：角色榜、Agent 榜是选手本身；模型榜把同一模型、没有风格提示词的选手合在一起 */
export const rowKey = (r, view) => (view === 'models' ? `${r.provider}/${r.model}` : r.character_id);

function keyMaker(db, view) {
  if (view !== 'models') return (cid) => cid;
  const map = new Map(db.all("SELECT id, provider, model FROM characters WHERE kind = 'model' AND (style IS NULL OR style = '')").map((c) => [c.id, `${c.provider}/${c.model}`]));
  return (cid) => map.get(cid) || null;
}

const blank = () => ({ dates: [], turns: 0, latSum: 0, latN: 0, tokens: 0, tokGames: 0, bad: 0, sides: {} });

/** 逐盘统计：每人的场次日期、对位战绩、阵营战绩和阵营分 */
function scanMatches(db, matches, keyOf) {
  const per = new Map();
  const get = (k) => { if (!per.has(k)) per.set(k, blank()); return per.get(k); };
  const pairs = new Map(); // a → b → { w, d, l, games }
  const sideR = new Map(); // `key|阵营` → OpenSkill rating
  const addPair = (a, b, o, m) => {
    if (!pairs.has(a)) pairs.set(a, new Map());
    const row = pairs.get(a);
    const c = row.get(b) || { w: 0, d: 0, l: 0, games: [] };
    c[o]++;
    c.games.push({ id: m.id, at: m.created_at, o });
    if (c.games.length > HEAT_GAMES) c.games.shift();
    row.set(b, c);
  };
  for (const m of matches) {
    if (!m.result || m.result.aborted) continue;
    // 同一个 key 占了多个座位（补位的内置 AI、同模型的两只蛐蛐）：场次和对位只按第一个座位算
    const first = new Map();
    for (const [seat, cid] of Object.entries(m.seats)) {
      const k = cid ? keyOf(cid) : null;
      if (k && !first.has(k)) first.set(k, seat);
    }
    for (const k of first.keys()) get(k).dates.push(m.created_at);
    const sides = seatSides(db, m);
    const keys = [...first.keys()];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const o = pairOutcome(m.result, first.get(keys[i]), first.get(keys[j]), sides);
        if (!o) continue;
        addPair(keys[i], keys[j], o, m);
        addPair(keys[j], keys[i], o === 'w' ? 'l' : o === 'l' ? 'w' : 'd', m);
      }
    }
    if (sides) scanSides(m, sides, keyOf, get, sideR);
  }
  return { per, pairs, sideR };
}

/** 阵营战绩，以及按阵营分队的 OpenSkill 阵营分（狼队对好人队、地主对两个农民） */
function scanSides(m, sides, keyOf, get, sideR) {
  const bySide = new Map();
  const seen = new Set();
  for (const [seat, cid] of Object.entries(m.seats)) {
    const k = cid ? keyOf(cid) : null;
    const side = sides[seat];
    if (!k || !side || seen.has(`${k}|${side}`)) continue;
    seen.add(`${k}|${side}`);
    const o = seatOutcome(m.result, seat);
    const st = (get(k).sides[side] ||= { n: 0, w: 0, d: 0, l: 0 });
    st.n++;
    st[o]++;
    if (!bySide.has(side)) bySide.set(side, { keys: [], rank: rankOf(m.result, seat) });
    bySide.get(side).keys.push(k);
  }
  if (bySide.size < 2) return;
  const list = [...bySide.entries()];
  const teams = list.map(([side, t]) => t.keys.map((k) => sideR.get(`${k}|${side}`) || rating()));
  const updated = rate(teams, { rank: list.map(([, t]) => t.rank) });
  list.forEach(([side, t], i) => t.keys.forEach((k, j) => sideR.set(`${k}|${side}`, updated[i][j])));
}

/** 每人走的步：平均用时、每局 token、犯规（有不合法尝试）的步数 */
function scanTurns(db, game, keyOf, per) {
  const rows = db.all(
    `SELECT t.character_id AS cid, t.match_id AS mid, COUNT(*) AS n, SUM(t.latency_ms) AS lat, COUNT(t.latency_ms) AS latn,
       SUM(COALESCE(json_extract(t.usage, '$.input'), 0) + COALESCE(json_extract(t.usage, '$.output'), 0)) AS tok,
       SUM(CASE WHEN t.attempts IS NOT NULL AND json_valid(t.attempts) AND json_array_length(t.attempts) > 0 THEN 1 ELSE 0 END) AS bad
     FROM turns t JOIN matches m ON m.id = t.match_id
     WHERE m.game = ? AND m.status = 'finished' AND m.mode != 'casual' AND t.character_id IS NOT NULL
     GROUP BY t.character_id, t.match_id`,
    game,
  );
  for (const r of rows) {
    const k = keyOf(r.cid);
    if (!k) continue;
    if (!per.has(k)) per.set(k, blank());
    const p = per.get(k);
    p.turns += r.n;
    p.latSum += r.lat || 0;
    p.latN += r.latn;
    p.tokens += r.tok || 0;
    p.tokGames += 1;
    p.bad += r.bad || 0;
  }
}

const caches = new WeakMap(); // db → Map(`游戏|榜` → { sig, data })

function compute(db, game, view) {
  const sig = db.get("SELECT COUNT(*) AS n, MAX(finished_at) AS f FROM matches WHERE game = ? AND status = 'finished' AND mode != 'casual'", game);
  const sigText = `${sig.n}|${sig.f}`;
  if (!caches.has(db)) caches.set(db, new Map());
  const cache = caches.get(db);
  const hit = cache.get(`${game}|${view}`);
  if (hit && hit.sig === sigText) return hit.data;
  const keyOf = keyMaker(db, view);
  const matches = db.all("SELECT id, game, seats, result, created_at FROM matches WHERE game = ? AND status = 'finished' AND mode != 'casual' ORDER BY finished_at, created_at", game);
  const data = scanMatches(db, matches, keyOf);
  scanTurns(db, game, keyOf, data.per);
  cache.set(`${game}|${view}`, { sig: sigText, data });
  return data;
}

/** 一行的出手统计；没有数据的项为 null */
export function playStats(p, since) {
  if (!p) return { recent: 0, moves: 0, avgMoveMs: null, avgTokens: null, invalidRate: null };
  return {
    recent: p.dates.filter((d) => d >= since).length,
    moves: p.turns,
    avgMoveMs: p.latN ? Math.round(p.latSum / p.latN) : null,
    avgTokens: p.tokGames && p.tokens ? Math.round(p.tokens / p.tokGames) : null,
    invalidRate: p.turns ? p.bad / p.turns : null,
  };
}

/** 一行的阵营战绩和阵营分 */
function sideStats(p, sideR, key, spec) {
  if (!spec) return null;
  return Object.fromEntries(spec.sides.map((side) => {
    const st = p?.sides[side];
    if (!st) return [side, null];
    const r = sideR.get(`${key}|${side}`);
    const decided = st.w + st.l;
    return [side, { ...st, rate: decided ? st.w / decided : null, ...(r ? { points: score(r), mid: Math.round(1000 + 40 * r.mu), pm: Math.round(40 * r.sigma) } : {}) }];
  }));
}

/**
 * 天梯一页的全部数据：榜单（加上不确定性、出手统计、阵营战绩）+ 阵营名 + 前 top 名的对位热力图。
 * view：characters 角色榜 / models 模型榜 / agents Agent 榜
 */
export function ladderBoard(db, game, view = 'characters', { now = Date.now(), top = 10 } = {}) {
  const g = getGame(game);
  const board = view === 'models' ? modelBoard(db, game) : leaderboard(db, view === 'agents' ? poolKey(game, 'agent') : game);
  const data = compute(db, game, view);
  const spec = ROLE_SIDES[game] || null;
  const since = new Date(now - ACTIVE_DAYS * DAY).toISOString();
  const rows = board.map((r) => {
    const key = rowKey(r, view);
    const p = data.per.get(key);
    return { ...r, key, unc: uncertainty(r, g.players.default), stats: playStats(p, since), sides: sideStats(p, data.sideR, key, spec) };
  });
  const ids = rows.slice(0, Math.min(top, HEAT_MAX)).map((r) => r.key);
  const cells = {};
  for (const a of ids) {
    for (const b of ids) {
      const c = a !== b && data.pairs.get(a)?.get(b);
      if (c) (cells[a] ||= {})[b] = { w: c.w, d: c.d, l: c.l, games: c.games.slice().reverse() };
    }
  }
  return { game, view, sides: spec?.sides || null, active: { days: ACTIVE_DAYS, min: ACTIVE_MIN }, rows, heat: { ids, cells } };
}

/** 路由：GET /api/ladder/board?game=&view= */
export function ladderRoutes(router, { db }) {
  router.get('/api/ladder/board', ({ query }) => ladderBoard(db, query.game || 'xiangqi', ['models', 'agents'].includes(query.view) ? query.view : 'characters'));
}
