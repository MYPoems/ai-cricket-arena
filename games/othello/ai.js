// 黑白棋内置 AI 与局面评估：Alpha-Beta（Negamax）+ 迭代加深 + 残局精确计算。
// 评估：位置权重表（角、边加分，X 格、C 格在角空着时扣分）+ 行动力；残局加子数。
// 棋盘在搜索里用 Int8Array：0 空，1 黑，2 白。

import { SIZE, DIRS } from './rules.js';

const N = SIZE * SIZE;
const WIN = 100000; // 终局分：WIN + 子数差（赢）、-WIN + 子数差（输）
const ABORT = Symbol('abort');

const WEIGHTS = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, -1, -1, -1, -1, -2, 10,
  5, -2, -1, -1, -1, -1, -2, 5,
  5, -2, -1, -1, -1, -1, -2, 5,
  10, -2, -1, -1, -1, -1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];
// 四个角及其相邻的 C 格、X 格：角被占后这些格子不再危险
const CORNERS = [
  [0, [1, 8, 9]], [7, [6, 15, 14]], [56, [57, 48, 49]], [63, [62, 55, 54]],
];
// 每个格子沿 8 个方向的射线（不含自身）
const RAYS = Array.from({ length: N }, (_, i) => DIRS.map(([dx, dy]) => {
  const out = [];
  let x = (i % SIZE) + dx, y = Math.floor(i / SIZE) + dy;
  while (x >= 0 && x < SIZE && y >= 0 && y < SIZE) { out.push(y * SIZE + x); x += dx; y += dy; }
  return out;
}).filter((r) => r.length >= 2));
// 静态走法顺序：权重高的格子先试
const ORDER = Array.from({ length: N }, (_, i) => i).sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);

export const toCells = (board) => Int8Array.from(board, (c) => (c === 'b' ? 1 : c === 'w' ? 2 : 0));
export const colorOf = (seat) => (seat === 'b' ? 1 : 2);

function canFlip(b, i, me, op) {
  for (const ray of RAYS[i]) {
    if (b[ray[0]] !== op) continue;
    for (let k = 1; k < ray.length; k++) {
      const v = b[ray[k]];
      if (v === me) return true;
      if (v !== op) break;
    }
  }
  return false;
}

function moveList(b, me) {
  const op = 3 - me;
  const out = [];
  for (const i of ORDER) if (!b[i] && canFlip(b, i, me, op)) out.push(i);
  return out;
}

function mobility(b, me) {
  const op = 3 - me;
  let n = 0;
  for (let i = 0; i < N; i++) if (!b[i] && canFlip(b, i, me, op)) n++;
  return n;
}

/** 落子并翻转，返回被翻转的格子（用于撤销） */
function play(b, i, me) {
  const op = 3 - me;
  const flipped = [];
  for (const ray of RAYS[i]) {
    if (b[ray[0]] !== op) continue;
    let k = 1;
    while (k < ray.length && b[ray[k]] === op) k++;
    if (k < ray.length && b[ray[k]] === me) for (let j = 0; j < k; j++) { b[ray[j]] = me; flipped.push(ray[j]); }
  }
  b[i] = me;
  return flipped;
}

function undo(b, i, flipped, me) {
  const op = 3 - me;
  b[i] = 0;
  for (const f of flipped) b[f] = op;
}

function discDiff(b, me) {
  let d = 0;
  for (let i = 0; i < N; i++) if (b[i]) d += b[i] === me ? 1 : -1;
  return d;
}

function finalScore(b, me) {
  const d = discDiff(b, me);
  return d > 0 ? WIN + d : d < 0 ? -WIN + d : 0;
}

/** 静态评估（走棋方 me 的视角） */
export function evaluateCells(b, me, myMob = mobility(b, me)) {
  const op = 3 - me;
  let pos = 0, empties = 0;
  for (let i = 0; i < N; i++) {
    const v = b[i];
    if (v === me) pos += WEIGHTS[i];
    else if (v === op) pos -= WEIGHTS[i];
    else empties++;
  }
  for (const [c, adj] of CORNERS) {
    if (!b[c]) continue;
    for (const a of adj) if (b[a]) pos += (b[a] === me ? 1 : -1) * (5 - WEIGHTS[a]);
  }
  const opMob = mobility(b, op);
  let score = pos + Math.round((60 * (myMob - opMob)) / (myMob + opMob + 2));
  if (empties <= 12) score += 4 * discDiff(b, me);
  return score;
}

function negamax(ctx, b, me, depth, alpha, beta, passed) {
  if ((++ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) throw ABORT;
  const moves = moveList(b, me);
  if (!moves.length) {
    if (passed) return finalScore(b, me); // 双方都无子：终局
    return -negamax(ctx, b, 3 - me, depth, -beta, -alpha, true);
  }
  if (depth <= 0) return evaluateCells(b, me, moves.length);
  let best = -Infinity;
  for (const i of moves) {
    const fl = play(b, i, me);
    const v = -negamax(ctx, b, 3 - me, depth - 1, -beta, -alpha, false);
    undo(b, i, fl, me);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** 根节点：在给定深度和窗口下给每个走法打分，返回 { best, score } */
function rootSearch(ctx, b, me, moves, depth, alpha, beta) {
  let best = moves[0], bestScore = -Infinity;
  for (const i of moves) {
    const fl = play(b, i, me);
    const v = -negamax(ctx, b, 3 - me, depth - 1, -beta, -Math.max(alpha, bestScore), false);
    undo(b, i, fl, me);
    if (v > bestScore) { bestScore = v; best = i; }
    if (bestScore >= beta) break;
  }
  return { best, score: bestScore };
}

/**
 * 搜索。board 为规则里的数组，side 为 'b' / 'w'。
 * opts: { maxDepth, timeMs, exactEmpties: 空格不多于此数时先尝试算到终局, wld: 终局只分胜负和（更快）, noise: 根节点随机扰动 }
 * 返回 { best: 格子编号 | null, score, depth, exact }（score 为 side 视角）
 */
export function search(board, side, { maxDepth = 4, timeMs = 200, exactEmpties = 0, wld = false, noise = 0 } = {}) {
  const b = toCells(board);
  const me = colorOf(side);
  const start = Date.now();
  const deadline = start + timeMs;
  let moves = moveList(b, me);
  if (!moves.length) return { best: null, score: 0, depth: 0, exact: false };
  let empties = 0;
  for (let i = 0; i < N; i++) if (!b[i]) empties++;
  const ctx = { nodes: 0, deadline: start + Math.round(timeMs * 0.6) }; // 残局精确计算最多用六成时间，算不完再迭代加深

  // 残局：直接算到终局
  if (exactEmpties && empties <= exactEmpties) {
    try {
      const r = wld ? rootSearch(ctx, b, me, moves, 64, -1, 1) : rootSearch(ctx, b, me, moves, 64, -Infinity, Infinity);
      return { best: r.best, score: r.score, depth: empties, exact: true };
    } catch (e) {
      if (e !== ABORT) throw e;
      // 计算不完：棋盘可能停在中途，重新拷贝
      b.set(toCells(board));
    }
  }

  let result = null;
  const top = Math.max(1, Math.min(maxDepth, empties));
  for (let d = 1; d <= top; d++) {
    ctx.deadline = d === 1 ? Infinity : deadline;
    try {
      let r;
      if (noise && d === top) {
        // 随机扰动：每个走法单独全窗口打分，再加噪声
        let best = null, bestScore = -Infinity;
        for (const i of moves) {
          const fl = play(b, i, me);
          const v = -negamax(ctx, b, 3 - me, d - 1, -Infinity, Infinity, false) + Math.random() * noise;
          undo(b, i, fl, me);
          if (v > bestScore) { bestScore = v; best = i; }
        }
        r = { best, score: bestScore };
      } else r = rootSearch(ctx, b, me, moves, d, -Infinity, Infinity);
      result = { best: r.best, score: r.score, depth: d, exact: d >= empties || Math.abs(r.score) >= WIN };
      if (result.exact) break;
      moves = [r.best, ...moves.filter((m) => m !== r.best)]; // 上一轮的最佳先算
    } catch (e) {
      if (e !== ABORT) throw e;
      b.set(toCells(board));
      break;
    }
  }
  return result;
}

/** 分数换算成走棋方期望得分 */
export function scoreToE(r) {
  if (r.exact || Math.abs(r.score) >= WIN) return r.score > 0 ? 1 : r.score < 0 ? 0 : 0.5;
  return 1 / (1 + Math.exp(-r.score / 60));
}
