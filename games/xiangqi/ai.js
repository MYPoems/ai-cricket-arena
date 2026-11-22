// 内置简单 AI：Alpha-Beta 搜索 + 子力和位置评估。
// 不需要 API，用作陪练和积分榜的固定参照。

import {
  RED, sideOf, fileOf, rankOf, legalMoves, makeMove, unmakeMove, inCheck, clonePos,
} from './rules.js';

const VALUE = { K: 0, A: 120, B: 120, N: 270, R: 600, C: 285, P: 30 };
const MATE = 100000;

/** 位置加分：兵过河、靠近中路；马、炮、车略偏中路和前方 */
function positional(type, side, s) {
  const f = fileOf(s);
  const r = side === RED ? rankOf(s) : 9 - rankOf(s); // 统一成「己方视角」的行号
  const center = 4 - Math.abs(f - 4);
  switch (type) {
    case 'P':
      if (r <= 4) return 0;
      return 40 + (r <= 8 ? center * 6 : 0) + (r >= 6 && r <= 8 ? 20 : 0);
    case 'N':
      return center * 6 + Math.min(r, 6) * 4;
    case 'C':
      return center * 3 + (r === 2 ? 10 : 0);
    case 'R':
      return center * 2 + (r >= 5 ? 10 : 0);
    default:
      return 0;
  }
}

/** 从 side 方视角评估局面 */
export function evaluate(pos, side) {
  let score = 0;
  for (let s = 0; s < pos.board.length; s++) {
    const p = pos.board[s];
    if (!p) continue;
    const t = p.toUpperCase();
    const v = VALUE[t] + positional(t, sideOf(p), s);
    score += sideOf(p) === side ? v : -v;
  }
  return score;
}

function ordered(pos) {
  const moves = legalMoves(pos);
  // 吃子优先，按「被吃子价值 - 吃子方价值/10」排序
  return moves
    .map((m) => {
      const victim = pos.board[m.to];
      const key = victim ? VALUE[victim.toUpperCase()] * 10 - VALUE[pos.board[m.from].toUpperCase()] : -1;
      return { m, key };
    })
    .sort((a, b) => b.key - a.key)
    .map((x) => x.m);
}

function quiesce(pos, alpha, beta, depth) {
  const stand = evaluate(pos, pos.side);
  if (stand >= beta) return beta;
  if (alpha < stand) alpha = stand;
  if (depth <= 0) return alpha;
  for (const m of ordered(pos)) {
    if (!pos.board[m.to]) break; // 只看吃子
    const u = makeMove(pos, m);
    const score = -quiesce(pos, -beta, -alpha, depth - 1);
    unmakeMove(pos, u);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(pos, depth, alpha, beta, ply, ctx) {
  ctx.nodes++;
  const moves = ordered(pos);
  if (moves.length === 0) return -MATE + ply; // 被将死或困毙
  if (depth === 0) return quiesce(pos, alpha, beta, 4);
  let best = -Infinity;
  for (const m of moves) {
    const u = makeMove(pos, m);
    const score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, ctx);
    unmakeMove(pos, u);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * 选一步棋。depth 越大越强（2–4 比较合适）。
 * random 为 0–1 之间的随机扰动比例，让同样局面不总走同一步。
 */
export function chooseMove(pos0, { depth = 3, random = 0.1, rng = Math.random } = {}) {
  const pos = clonePos(pos0);
  const ctx = { nodes: 0 };
  const scored = [];
  for (const m of ordered(pos)) {
    const u = makeMove(pos, m);
    const score = -negamax(pos, depth - 1, -Infinity, Infinity, 1, ctx);
    unmakeMove(pos, u);
    scored.push({ m, score: score + (rng() - 0.5) * 20 * random });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return { move: scored[0].m, score: Math.round(scored[0].score), nodes: ctx.nodes, inCheck: inCheck(pos.board, pos.side) };
}
