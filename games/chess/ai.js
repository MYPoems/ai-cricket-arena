// 国际象棋内置 AI：Alpha-Beta + 静态搜索（只算吃子和升变）+ 子力分和位置表，迭代加深并限时。

import { pseudoMoves, makeMove, unmakeMove, isAttacked, kingSquare, opponent, clonePos, posKey, legalMoves, WHITE } from './rules.js';

const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
const V = {};
for (const [k, v] of Object.entries(VAL)) { V[k] = v; V[k.toLowerCase()] = v; }
const MATE = 100000;
const INF = 1e9;

// 位置表：按白方视角书写，第一行是第 8 行
const PST_SRC = {
  P: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0],
  N: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50],
  B: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20],
  R: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0],
  Q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20],
  K: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20],
  KE: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50],
};
// 转成按格子编号（a1 = 0）索引：白方 PST_W[type][sq]，黑方镜像
const PST_W = {}, PST_B = {};
for (const [t, tab] of Object.entries(PST_SRC)) {
  PST_W[t] = new Array(64); PST_B[t] = new Array(64);
  for (let s = 0; s < 64; s++) {
    const f = s & 7, r = s >> 3;
    PST_W[t][s] = tab[(7 - r) * 8 + f];
    PST_B[t][s] = tab[r * 8 + f];
  }
}

/** 静态评估，走棋方视角（厘兵） */
export function evaluate(pos) {
  const b = pos.board;
  let mat = 0, pst = 0, nonPawn = 0, wb = 0, bb = 0, wk = -1, bk = -1;
  for (let s = 0; s < 64; s++) {
    const p = b[s];
    if (!p) continue;
    if (p === 'K') { wk = s; continue; }
    if (p === 'k') { bk = s; continue; }
    const w = p < 'a';
    const t = w ? p : p.toUpperCase();
    const v = VAL[t];
    if (t !== 'P') nonPawn += v;
    if (t === 'B') { if (w) wb++; else bb++; }
    if (w) { mat += v; pst += PST_W[t][s]; } else { mat -= v; pst -= PST_B[t][s]; }
  }
  // 残局：双方大子少时王要走向中心
  const endgame = nonPawn <= 1300;
  const kt = endgame ? 'KE' : 'K';
  if (wk >= 0) pst += PST_W[kt][wk];
  if (bk >= 0) pst -= PST_B[kt][bk];
  let score = mat + pst + (wb >= 2 ? 30 : 0) - (bb >= 2 ? 30 : 0);
  // 残局里子力占优的一方：把对方王逼到边上、自己的王靠近
  if (endgame && Math.abs(mat) >= 300 && wk >= 0 && bk >= 0) {
    const loser = mat > 0 ? bk : wk;
    const cd = Math.max(3 - (loser & 7), (loser & 7) - 4) + Math.max(3 - (loser >> 3), (loser >> 3) - 4);
    const kd = Math.abs((wk & 7) - (bk & 7)) + Math.abs((wk >> 3) - (bk >> 3));
    const bonus = cd * 10 + (14 - kd) * 4;
    score += mat > 0 ? bonus : -bonus;
  }
  return pos.side === WHITE ? score : -score;
}

/** 着法排序分：吃子按 MVV-LVA，升变优先，杀手着法其次 */
function orderScore(m, killers) {
  let s = 0;
  if (m.captured) s += 10000 + V[m.captured] * 10 - V[m.piece];
  if (m.promo) s += 9000 + V[m.promo];
  if (killers && !m.captured && killers.some((k) => k && k.from === m.from && k.to === m.to)) s += 5000;
  return s;
}

const sameMove = (a, b) => a && b && a.from === b.from && a.to === b.to && a.promo === b.promo;

class Stop extends Error {}

class Searcher {
  constructor(pos, deadline) {
    this.pos = pos;
    this.deadline = deadline;
    this.nodes = 0;
    this.killers = [];
  }

  tick() {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) throw new Stop();
  }

  quiesce(alpha, beta, qply) {
    this.tick();
    const pos = this.pos;
    const stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qply > 8) return stand;
    const side = pos.side, opp = opponent(side);
    const moves = pseudoMoves(pos, true);
    moves.sort((a, b) => orderScore(b) - orderScore(a));
    const king = kingSquare(pos.board, side);
    for (const m of moves) {
      // 增量剪枝：吃到也追不回 alpha 的就不算
      if (!m.promo && stand + V[m.captured] + 200 < alpha) continue;
      const u = makeMove(pos, m);
      const k = m.piece === 'K' || m.piece === 'k' ? m.to : king;
      if (isAttacked(pos.board, k, opp)) { unmakeMove(pos, m, u); continue; }
      const sc = -this.quiesce(-beta, -alpha, qply + 1);
      unmakeMove(pos, m, u);
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  search(depth, alpha, beta, ply) {
    const pos = this.pos;
    if (pos.halfmove >= 100) return 0;
    const side = pos.side, opp = opponent(side);
    const king = kingSquare(pos.board, side);
    const checked = isAttacked(pos.board, king, opp);
    if (checked && ply < 12) depth++; // 被将军时延伸一层
    if (depth <= 0) return this.quiesce(alpha, beta, 0);
    this.tick();
    const killers = this.killers[ply] || (this.killers[ply] = [null, null]);
    const moves = pseudoMoves(pos);
    moves.sort((a, b) => orderScore(b, killers) - orderScore(a, killers));
    let legal = 0;
    let best = -INF;
    for (const m of moves) {
      const u = makeMove(pos, m);
      const k = m.piece === 'K' || m.piece === 'k' ? m.to : king;
      if (isAttacked(pos.board, k, opp)) { unmakeMove(pos, m, u); continue; }
      legal++;
      const sc = -this.search(depth - 1, -beta, -alpha, ply + 1);
      unmakeMove(pos, m, u);
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if (!m.captured && !sameMove(killers[0], m)) { killers[1] = killers[0]; killers[0] = m; }
        break;
      }
    }
    if (!legal) return checked ? -MATE + ply : 0;
    return best;
  }
}

/**
 * 选一步棋。history：对局里出现过的局面键（判断走后是否构成三次重复）。
 * 返回 { move, score, depth }；没有合法着法时返回 null。
 */
export function chooseMove(pos0, { depth = 3, timeMs = 1500, noise = 0, history = [] } = {}) {
  const pos = clonePos(pos0);
  const moves = legalMoves(pos);
  if (!moves.length) return null;
  if (moves.length === 1) return { move: moves[0], score: 0, depth: 0 };
  const deadline = Date.now() + timeMs;
  const s = new Searcher(pos, deadline);
  // 走后立即和棋（三次重复、50 回合）的着法直接按 0 分计
  const counts = new Map();
  for (const k of history) counts.set(k, (counts.get(k) || 0) + 1);
  const drawAfter = moves.map((m) => {
    const u = makeMove(pos, m);
    // 走后将死对方时不算和棋（将死优先）
    const d = ((counts.get(posKey(pos)) || 0) >= 2 || pos.halfmove >= 100) && legalMoves(pos).length > 0;
    unmakeMove(pos, m, u);
    return d;
  });
  const order = moves.map((m, i) => ({ m, i, o: orderScore(m) })).sort((a, b) => b.o - a.o);
  let result = null;
  for (let d = 1; d <= depth; d++) {
    try {
      let alpha = -INF;
      let iterBest = null;
      const scored = [];
      for (const it of order) {
        let sc;
        if (drawAfter[it.i]) sc = 0;
        else {
          const u = makeMove(pos, it.m);
          try {
            sc = -s.search(d - 1, -INF, -(alpha - noise - 1), 1);
          } finally { unmakeMove(pos, it.m, u); }
        }
        const noisy = sc + (noise ? Math.random() * noise : 0);
        scored.push({ it, sc });
        if (!iterBest || noisy > iterBest.noisy) iterBest = { it, sc, noisy };
        if (sc > alpha) alpha = sc;
      }
      result = { move: iterBest.it.m, score: iterBest.sc, depth: d };
      // 下一轮先算这一轮分数高的
      scored.sort((a, b) => b.sc - a.sc);
      order.splice(0, order.length, iterBest.it, ...scored.map((x) => x.it).filter((x) => x !== iterBest.it));
      if (Math.abs(iterBest.sc) > MATE - 100) break; // 找到杀棋
    } catch (e) {
      if (e instanceof Stop) break;
      throw e;
    }
  }
  if (!result) result = { move: order[0].m, score: 0, depth: 0 };
  return result;
}

/** 走棋方的期望得分（0–1），由厘兵分换算 */
export const expectedScore = (cp) => (Math.abs(cp) > MATE - 1000 ? (cp > 0 ? 1 : 0) : 1 / (1 + Math.exp(-cp / 250)));
