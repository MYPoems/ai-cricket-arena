// 四子棋搜索：位棋盘 + Negamax（Alpha-Beta）+ 置换表 + 中路优先排序 + 迭代加深。
// 能算到终局时给出确定的胜/和/负；否则在叶子上用启发式（双方「再落一子就连四」的空位数、中路子数）。
//
// 位棋盘布局（参考 Pascal Pons 的写法）：第 c 列第 r 行（都从 0 开始，行从下往上）的位号为 c * 7 + r，
// 每列第 7 位（r = 6）是哨兵位，永远为 0。共 49 位，拆成两个 32 位整数：
//   lo = 第 0–3 列（位 0–27），hi = 第 4–6 列（位 28–48，存为 hi 的位 0–20）。

export const COLS = 7;
export const ROWS = 6;
const CELLS = COLS * ROWS;
const M28 = 0x0FFFFFFF;
const M21 = 0x1FFFFF;
const BOT_LO = 1 | (1 << 7) | (1 << 14) | (1 << 21);
const BOT_HI = 1 | (1 << 7) | (1 << 14);
const BOARD_LO = BOT_LO * 63;
const BOARD_HI = BOT_HI * 63;
const ORDER = [3, 2, 4, 1, 5, 0, 6]; // 中路优先
const WIN_BASE = 10000; // 赢棋分：WIN_BASE + 42 - 赢之前的子数（越早赢分越高）
const ABORT = Symbol('abort');

// ---------- 49 位整数（lo, hi）的移位 ----------
const shlL = (lo, k) => (lo << k) & M28;
const shlH = (lo, hi, k) => ((hi << k) | (lo >>> (28 - k))) & M21;
const shrL = (lo, hi, k) => ((lo >>> k) | (hi << (28 - k))) & M28;
const shrH = (hi, k) => hi >>> k;

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24);
}

/** 某列某行的位（返回 [lo, hi]） */
export const cellBit = (c, r) => (c < 4 ? [1 << (c * 7 + r), 0] : [0, 1 << ((c - 4) * 7 + r)]);
const colMask = (c) => (c < 4 ? [63 << (c * 7), 0] : [0, 63 << ((c - 4) * 7)]);
const colFull = (c, mLo, mHi) => !!(c < 4 ? mLo & (32 << (c * 7)) : mHi & (32 << ((c - 4) * 7)));

// 计算结果放在模块变量里，避免每个节点分配数组
let WLO = 0, WHI = 0;

/** p（某方的子）再落一子就能连四的空位，结果写入 WLO / WHI */
function winPos(pLo, pHi, mLo, mHi) {
  // 竖：下面三个同色
  let rLo = shlL(pLo, 1) & shlL(pLo, 2) & shlL(pLo, 3);
  let rHi = shlH(pLo, pHi, 1) & shlH(pLo, pHi, 2) & shlH(pLo, pHi, 3);
  // 横（7）、两条斜线（6、8）
  for (let t = 0; t < 3; t++) {
    const s = t === 0 ? 7 : t === 1 ? 6 : 8;
    const s2 = s * 2, s3 = s * 3;
    let aLo = shlL(pLo, s) & shlL(pLo, s2);
    let aHi = shlH(pLo, pHi, s) & shlH(pLo, pHi, s2);
    rLo |= aLo & shlL(pLo, s3); rHi |= aHi & shlH(pLo, pHi, s3);
    rLo |= aLo & shrL(pLo, pHi, s); rHi |= aHi & shrH(pHi, s);
    aLo = shrL(pLo, pHi, s) & shrL(pLo, pHi, s2);
    aHi = shrH(pHi, s) & shrH(pHi, s2);
    rLo |= aLo & shlL(pLo, s); rHi |= aHi & shlH(pLo, pHi, s);
    rLo |= aLo & shrL(pLo, pHi, s3); rHi |= aHi & shrH(pHi, s3);
  }
  WLO = rLo & (BOARD_LO ^ mLo);
  WHI = rHi & (BOARD_HI ^ mHi);
}

// ---------- 置换表（懒分配，跨调用保留：键是完整局面，值带深度） ----------
const TT_BITS = 19;
const TT_SIZE = 1 << TT_BITS;
let ttLo, ttHi, ttVal, ttDepth, ttFlag, ttMove;
function ttInit() {
  if (ttLo) return;
  ttLo = new Uint32Array(TT_SIZE); ttHi = new Uint32Array(TT_SIZE);
  ttVal = new Int16Array(TT_SIZE); ttDepth = new Int8Array(TT_SIZE);
  ttFlag = new Int8Array(TT_SIZE); ttMove = new Int8Array(TT_SIZE);
}
const EXACT = 1, LOWER = 2, UPPER = 3;
const ttIndex = (kLo, kHi) => (Math.imul(kLo ^ 0x5bd1e995, 0x9E3779B1) ^ Math.imul(kHi + 0x7F4A7C15, 0x85EBCA6B)) >>> (32 - TT_BITS);

// 行的奇偶：先手的连四点在第 1、3、5 行（从 1 数）更有用，后手在第 2、4、6 行
const ODD_LO = 21 * BOT_LO, ODD_HI = 21 * BOT_HI; // 行号 0、2、4（从 0 数）
const EVEN_LO = 42 * BOT_LO, EVEN_HI = 42 * BOT_HI; // 行号 1、3、5

/** 局面的启发式分数（走棋方视角），远小于 WIN_BASE */
function heuristic(cLo, cHi, oLo, oHi, myWLo, myWHi, opWLo, opWHi, moves) {
  // 中间列（第 3 列）和次中路（第 2、4 列）的子
  const mid = popcount(cLo & (63 << 21)) - popcount(oLo & (63 << 21));
  const near = popcount(cLo & (63 << 14)) + popcount(cHi & 63) - popcount(oLo & (63 << 14)) - popcount(oHi & 63);
  const threats = popcount(myWLo) + popcount(myWHi) - popcount(opWLo) - popcount(opWHi);
  const first = (moves & 1) === 0; // 走棋方是不是先手
  const [mpLo, mpHi, opLo, opHi] = first ? [ODD_LO, ODD_HI, EVEN_LO, EVEN_HI] : [EVEN_LO, EVEN_HI, ODD_LO, ODD_HI];
  const good = popcount(myWLo & mpLo) + popcount(myWHi & mpHi) - popcount(opWLo & opLo) - popcount(opWHi & opHi);
  return 8 * threats + 6 * good + 5 * mid + 2 * near;
}

function negamax(ctx, cLo, cHi, mLo, mHi, moves, depth, alpha, beta) {
  if ((++ctx.nodes & 4095) === 0 && Date.now() > ctx.deadline) throw ABORT;
  if (moves >= CELLS) return 0;
  const pLo = (mLo + BOT_LO) & BOARD_LO, pHi = (mHi + BOT_HI) & BOARD_HI; // 每列能落的位置
  winPos(cLo, cHi, mLo, mHi);
  const myWLo = WLO, myWHi = WHI;
  if ((myWLo & pLo) | (myWHi & pHi)) return WIN_BASE + CELLS - moves; // 这一手就赢
  const oLo = cLo ^ mLo, oHi = cHi ^ mHi;
  winPos(oLo, oHi, mLo, mHi);
  const opWLo = WLO, opWHi = WHI;
  const lose = -(WIN_BASE + CELLS - moves - 1); // 对方下一手赢
  let nLo = pLo, nHi = pHi;
  const fLo = pLo & opWLo, fHi = pHi & opWHi; // 必须挡的点
  if (fLo | fHi) {
    if (popcount(fLo) + popcount(fHi) > 1) return lose;
    nLo = fLo; nHi = fHi;
  }
  // 不要下在对方连四点的正下方
  nLo &= ~shrL(opWLo, opWHi, 1); nHi &= ~shrH(opWHi, 1);
  if (!(nLo | nHi)) return lose;
  if (moves >= CELLS - 2) return 0; // 最后两手：双方都赢不了
  if (depth <= 0) return heuristic(cLo, cHi, oLo, oHi, myWLo, myWHi, opWLo, opWHi, moves);

  // 置换表
  const kLo = cLo + mLo, kHi = cHi + mHi;
  const ti = ttIndex(kLo, kHi);
  let ttBest = -1;
  if (ttFlag[ti] && ttLo[ti] === kLo && ttHi[ti] === kHi) {
    ttBest = ttMove[ti];
    if (ttDepth[ti] >= depth) {
      const v = ttVal[ti], f = ttFlag[ti];
      if (f === EXACT) return v;
      if (f === LOWER && v >= beta) return v;
      if (f === UPPER && v <= alpha) return v;
    }
  }

  // 走法排序：置换表最佳着法最先，其余按落子后自己的连四点数，同分中路优先
  const cand = ctx.cand[moves];
  const keys = ctx.keys[moves];
  let n = 0;
  for (let k = 0; k < COLS; k++) {
    const c = ORDER[k];
    const mvLo = nLo & (c < 4 ? 63 << (c * 7) : 0), mvHi = nHi & (c >= 4 ? 63 << ((c - 4) * 7) : 0);
    if (!(mvLo | mvHi)) continue;
    winPos(cLo | mvLo, cHi | mvHi, mLo | mvLo, mHi | mvHi);
    const sc = c === ttBest ? 1000 : popcount(WLO) + popcount(WHI);
    let j = n++;
    while (j > 0 && keys[j - 1] < sc) { cand[j] = cand[j - 1]; keys[j] = keys[j - 1]; j--; }
    cand[j] = c; keys[j] = sc;
  }

  const alpha0 = alpha;
  let best = -Infinity, bestCol = cand[0];
  for (let k = 0; k < n; k++) {
    const c = cand[k];
    const mvLo = nLo & (c < 4 ? 63 << (c * 7) : 0), mvHi = nHi & (c >= 4 ? 63 << ((c - 4) * 7) : 0);
    const v = -negamax(ctx, oLo, oHi, mLo | mvLo, mHi | mvHi, moves + 1, depth - 1, -beta, -alpha);
    if (v > best) { best = v; bestCol = c; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  ttLo[ti] = kLo; ttHi[ti] = kHi; ttVal[ti] = best; ttDepth[ti] = Math.min(127, depth); ttMove[ti] = bestCol;
  ttFlag[ti] = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
  return best;
}

/** 从规则的棋盘数组（idx = 行 * 7 + 列，行从下往上）得到走棋方 / 全部子的位棋盘 */
export function toBits(board, side) {
  let cLo = 0, cHi = 0, mLo = 0, mHi = 0, moves = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = board[r * COLS + c];
    if (!v) continue;
    moves++;
    const [lo, hi] = cellBit(c, r);
    mLo |= lo; mHi |= hi;
    if (v === side) { cLo |= lo; cHi |= hi; }
  }
  return { cLo, cHi, mLo, mHi, moves };
}

/**
 * 搜索。返回 { best: 列号 0–6, score, depth, exact, scores? }（score 为走棋方视角）。
 * opts: { timeMs, maxDepth, noise: >0 时根节点每个走法全窗口打分再加随机扰动（低等级用） }
 */
export function solve(board, side, { timeMs = 250, maxDepth = CELLS, noise = 0, moveOnly = false } = {}) {
  ttInit();
  const { cLo, cHi, mLo, mHi, moves } = toBits(board, side);
  const legal = ORDER.filter((c) => !colFull(c, mLo, mHi));
  if (!legal.length) return null;
  const pLo = (mLo + BOT_LO) & BOARD_LO, pHi = (mHi + BOT_HI) & BOARD_HI;
  const colOf = (lo, hi) => ORDER.find((c) => (c < 4 ? lo & colMask(c)[0] : hi & colMask(c)[1]));

  // 一步就赢
  winPos(cLo, cHi, mLo, mHi);
  const wc = colOf(WLO & pLo, WHI & pHi);
  if (wc !== undefined) return { best: wc, score: WIN_BASE + CELLS - moves, depth: 1, exact: true };
  const oLo = cLo ^ mLo, oHi = cHi ^ mHi;
  winPos(oLo, oHi, mLo, mHi);
  const opWLo = WLO, opWHi = WHI;
  const lose = -(WIN_BASE + CELLS - moves - 1);
  let nLo = pLo, nHi = pHi;
  const fLo = pLo & opWLo, fHi = pHi & opWHi;
  if (fLo | fHi) {
    // 必须挡；对方有两个以上的连四点时挡不住，挡一个了事
    if (popcount(fLo) + popcount(fHi) > 1) return { best: colOf(fLo, fHi), score: lose, depth: 1, exact: true };
    nLo = fLo; nHi = fHi;
  }
  nLo &= ~shrL(opWLo, opWHi, 1); nHi &= ~shrH(opWHi, 1);
  let rootMoves = ORDER.filter((c) => (c < 4 ? nLo & colMask(c)[0] : nHi & colMask(c)[1]));
  if (!rootMoves.length) {
    // 怎么下都输：有必须挡的点就挡，否则随便下一个能下的列
    return { best: fLo | fHi ? colOf(fLo, fHi) : legal[0], score: lose, depth: 1, exact: true };
  }
  if (moves >= CELLS - 2) return { best: rootMoves[0], score: 0, depth: CELLS - moves, exact: true };
  if (moveOnly && rootMoves.length === 1) return { best: rootMoves[0], score: 0, depth: 0, exact: false }; // 只有一步不输：不用再算

  const ctx = {
    nodes: 0, deadline: Infinity,
    cand: Array.from({ length: CELLS + 1 }, () => new Int8Array(COLS)),
    keys: Array.from({ length: CELLS + 1 }, () => new Int32Array(COLS)),
  };
  const deadline = Date.now() + timeMs;
  const empties = CELLS - moves;
  let result = null;
  for (let d = 1; d <= Math.min(maxDepth, empties); d++) {
    ctx.deadline = d === 1 ? Infinity : deadline;
    try {
      let best = rootMoves[0], bestScore = -Infinity, alpha = -Infinity;
      const scores = {};
      for (const c of rootMoves) {
        const mvLo = nLo & (c < 4 ? colMask(c)[0] : 0), mvHi = nHi & (c >= 4 ? colMask(c)[1] : 0);
        let v = -negamax(ctx, oLo, oHi, mLo | mvLo, mHi | mvHi, moves + 1, d - 1, -Infinity, noise ? Infinity : -alpha);
        scores[c] = v;
        if (noise && Math.abs(v) < WIN_BASE) v += Math.random() * noise;
        if (v > bestScore) { bestScore = v; best = c; }
        if (v > alpha) alpha = v;
      }
      result = { best, score: Math.round(bestScore), depth: d, exact: Math.abs(bestScore) >= WIN_BASE || d >= empties, scores };
      if (result.exact && Math.abs(bestScore) >= WIN_BASE && bestScore > 0) break; // 已找到必胜
      if (d >= empties) break;
      rootMoves = [best, ...rootMoves.filter((c) => c !== best)];
    } catch (e) {
      if (e !== ABORT) throw e;
      break;
    }
  }
  // 空棋盘：理论上中间列必胜，搜索深度不够时启发式未必看得出来，直接取中间列
  if (moves === 0 && !noise) result.best = 3;
  return result;
}

/** 分数换算成走棋方期望得分 */
export function scoreToE(r) {
  if (r.exact) return r.score > 0 ? 1 : r.score < 0 ? 0 : 0.5;
  return 1 / (1 + Math.exp(-r.score / 40));
}
