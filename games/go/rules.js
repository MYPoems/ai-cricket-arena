// 围棋规则：中国规则数子法、禁止自杀、全局同形禁着（positional superko）、双方连续虚手终局。
// 棋盘数组下标 i = y * size + x，x 列从左到右、y 行从下到上；值为 'b' / 'w' / null。
// 坐标用 GTP 惯例：列字母 A–T 跳过 I，行号自下而上 1–19（例如 D4、Q16）。
// 这里的函数都用朴素的洪水填充，写得直白好核对；内置 AI 用 engine.js 的快速棋盘。

import { FastBoard, ownership, seedOf, rng32 } from './engine.js';

export const COLS = 'ABCDEFGHJKLMNOPQRST';
export const SIZES = [9, 13, 19];
export const SEAT_NAMES = { b: '黑方', w: '白方' };
export const other = (s) => (s === 'b' ? 'w' : 'b');

export const label = (i, size) => `${COLS[i % size]}${Math.floor(i / size) + 1}`;

/** 'D4' → 下标；不合法返回 null */
export function parseCoord(text, size) {
  const m = /^\s*([A-Za-z])\s*(\d{1,2})\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const x = COLS.indexOf(m[1].toUpperCase()), y = Number(m[2]) - 1;
  if (x < 0 || x >= size || y < 0 || y >= size) return null;
  return y * size + x;
}

export function neighbors(i, size) {
  const x = i % size, y = (i - x) / size;
  const out = [];
  if (x > 0) out.push(i - 1);
  if (x < size - 1) out.push(i + 1);
  if (y > 0) out.push(i - size);
  if (y < size - 1) out.push(i + size);
  return out;
}

/** i 所在的棋串及其气 */
export function groupAt(board, size, i) {
  const c = board[i];
  const stones = [i], libs = new Set(), seen = new Set([i]);
  for (let k = 0; k < stones.length; k++) {
    for (const n of neighbors(stones[k], size)) {
      if (board[n] === null) libs.add(n);
      else if (board[n] === c && !seen.has(n)) { seen.add(n); stones.push(n); }
    }
  }
  return { color: c, stones, libs };
}

/** 星位（下标） */
export function starPoints(size) {
  const e = size >= 13 ? 3 : 2, m = (size - 1) / 2, f = size - 1 - e;
  const pts = size >= 13 ? [[e, e], [m, e], [f, e], [e, m], [m, m], [f, m], [e, f], [m, f], [f, f]] : [[e, e], [f, e], [m, m], [e, f], [f, f]];
  return pts.map(([x, y]) => y * size + x);
}

// ---------- 局面哈希（Zobrist，固定种子生成，两段 32 位） ----------
const ZOB = (() => {
  const r = rng32(20261125);
  const t = new Uint32Array(19 * 19 * 2 * 2);
  for (let k = 0; k < t.length; k++) t[k] = Math.floor(r() * 4294967296) >>> 0;
  return t;
})();
const zIdx = (i, c) => ((i * 2) + (c === 'b' ? 0 : 1)) * 2;

/** 哈希用 [hi, lo] 两段，存进 state 时写成字符串 */
export const hashKey = (h) => `${h[0].toString(36)}.${h[1].toString(36)}`;
export function hashBoard(board) {
  const h = [0, 0];
  for (let i = 0; i < board.length; i++) if (board[i]) { const z = zIdx(i, board[i]); h[0] ^= ZOB[z]; h[1] ^= ZOB[z + 1]; }
  return [h[0] >>> 0, h[1] >>> 0];
}
function hashToggle(h, i, c) {
  const z = zIdx(i, c);
  h[0] = (h[0] ^ ZOB[z]) >>> 0;
  h[1] = (h[1] ^ ZOB[z + 1]) >>> 0;
}
export const parseHash = (s) => s.split('.').map((x) => parseInt(x, 36) >>> 0);

/**
 * c 方在 i 落子：返回 { board, captured: [下标], hash } 或 { error: 'occupied' | 'suicide' | 'superko' }。
 * seen：以前出现过的局面哈希集合（全局同形）；hash：当前局面的哈希 [hi, lo]
 */
export function tryPlay(board, size, i, c, hash, seen) {
  if (board[i] !== null) return { error: 'occupied' };
  const b = board.slice();
  b[i] = c;
  const h = [hash[0], hash[1]];
  hashToggle(h, i, c);
  const captured = [];
  const opp = other(c);
  for (const n of neighbors(i, size)) {
    if (b[n] !== opp) continue;
    const g = groupAt(b, size, n);
    if (g.libs.size) continue;
    for (const s of g.stones) { b[s] = null; captured.push(s); hashToggle(h, s, opp); }
  }
  if (!captured.length && !groupAt(b, size, i).libs.size) return { error: 'suicide' };
  if (seen && seen.has(hashKey(h))) return { error: 'superko' };
  return { board: b, captured, hash: h };
}

export const ERRORS = {
  occupied: (l) => `${l} 已经有子`,
  suicide: (l) => `${l} 是自杀着（落下后自己这块棋没有气，又提不掉对方的子），禁止`,
  superko: (l) => `${l} 会让全盘重现以前出现过的局面（全局同形禁着；打劫要先在别处找劫材），禁止`,
};

/** 全部合法着点（下标）；顺带返回禁着点（空点但不能下）及原因 */
export function legalPoints(state, c) {
  const seen = new Set(state.hist);
  const h = parseHash(state.hash);
  const legal = [], banned = [];
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i] !== null) continue;
    const r = tryPlay(state.board, state.size, i, c, h, seen);
    if (r.error) banned.push({ i, why: r.error });
    else legal.push(i);
  }
  return { legal, banned };
}

// ---------- 终局：Benson 无条件活棋 + 随机对局估计归属，判死子后数子 ----------

/** Benson 算法：c 方无条件活的棋串（对方连下多少手都提不掉），返回这些串的子（下标集合） */
export function bensonAlive(board, size, c) {
  const n = board.length;
  // 棋串
  const chainOf = new Int32Array(n).fill(-1);
  const chains = [];
  for (let i = 0; i < n; i++) {
    if (board[i] !== c || chainOf[i] >= 0) continue;
    const g = groupAt(board, size, i);
    for (const s of g.stones) chainOf[s] = chains.length;
    chains.push({ stones: g.stones, libs: g.libs, alive: true });
  }
  // 被 c 方围起来的区域：不是 c 子的点连成的块
  const regOf = new Int32Array(n).fill(-1);
  const regions = [];
  for (let i = 0; i < n; i++) {
    if (board[i] === c || regOf[i] >= 0) continue;
    const pts = [i];
    regOf[i] = regions.length;
    const border = new Set();
    for (let k = 0; k < pts.length; k++) {
      for (const q of neighbors(pts[k], size)) {
        if (board[q] === c) border.add(chainOf[q]);
        else if (regOf[q] < 0) { regOf[q] = regions.length; pts.push(q); }
      }
    }
    const empties = pts.filter((p) => board[p] === null);
    // 对哪些串是「要害区域」：区域里每个空点都是这串的气
    const vitalTo = [...border].filter((ci) => empties.every((p) => chains[ci].libs.has(p)));
    regions.push({ border: [...border], vitalTo, ok: true });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let ci = 0; ci < chains.length; ci++) {
      const ch = chains[ci];
      if (!ch.alive) continue;
      const vital = regions.filter((r) => r.ok && r.vitalTo.includes(ci)).length;
      if (vital < 2) { ch.alive = false; changed = true; }
    }
    for (const r of regions) {
      if (r.ok && r.border.some((ci) => !chains[ci].alive)) { r.ok = false; changed = true; }
    }
  }
  const out = new Set();
  for (const ch of chains) if (ch.alive) for (const s of ch.stones) out.add(s);
  return out;
}

/** 终局判定用的随机对局局数（局数固定，结果才确定） */
const FINAL_PLAYOUTS = { 9: 1600, 13: 800, 19: 400 };
// 随机对局里一块棋的子平均有这么高的比例归对方，就算死子（被包围、提得掉的棋）
const DEAD_AT = 0.4;
// 被围的棋：所在区域里对方的子是自己的这么多倍，而随机对局也不明显看好它，算死子（对方地里的孤子、残子）
const SWAMPED = 2;
const SWAMP_MC = 0.25;

/**
 * c 方的「势力区」：不是对方子的点连成的块（自己的子 + 空点）。返回每个点所属的块号，
 * 以及每块里 c 方的子数（own）、挨着这块空点的对方子数（opp）
 */
function areasOf(board, size, c) {
  const n = board.length, opp = other(c);
  const id = new Int32Array(n).fill(-1);
  const list = [];
  for (let i = 0; i < n; i++) {
    if (board[i] === opp || id[i] >= 0) continue;
    const pts = [i];
    id[i] = list.length;
    let own = 0;
    const touch = new Set();
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      if (board[p] === c) own++;
      for (const q of neighbors(p, size)) {
        if (board[q] === opp) { if (board[p] === null) touch.add(q); } else if (id[q] < 0) { id[q] = list.length; pts.push(q); }
      }
    }
    list.push({ own, opp: touch.size });
  }
  return { id, list };
}

/**
 * 终局数子。先判死子：
 * 1. Benson 无条件活的棋串不动；
 * 2. 带种子的随机对局（黑先、白先各一半）估计每个点的归属，一串子平均归对方 ≥ DEAD_AT：死（被围住、提得掉）；
 * 3. 一串子所在的势力区（自己的子 + 空点，被对方的子围住）里，挨着这片空点的对方子数 ≥ 自己子数 × SWAMPED，
 *    且随机对局不明显看好它（平均归属 < SWAMP_MC）：死（对方地里的孤子、残子）。
 * 提掉死子后按 Tromp-Taylor 数：子 + 只挨着一方的空点。种子取自局面哈希，同样的局面永远得到同样的结果。
 */
export function scoreFinal(board, size, komi, toMove = 'b', { playouts = FINAL_PLAYOUTS[size] || 200, salt = '' } = {}) {
  const n = board.length;
  const alive = new Set([...bensonAlive(board, size, 'b'), ...bensonAlive(board, size, 'w')]);
  const fb = FastBoard.from(board, size, toMove === 'b' ? 1 : 2);
  const own = ownership(fb, playouts, seedOf(hashKey(hashBoard(board)) + size + salt));
  const areas = { b: areasOf(board, size, 'b'), w: areasOf(board, size, 'w') };
  const dead = [];
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!board[i] || seen[i]) continue;
    const g = groupAt(board, size, i);
    for (const s of g.stones) seen[s] = 1;
    if (alive.has(i)) continue;
    const c = board[i];
    const sign = c === 'b' ? 1 : -1;
    const avg = g.stones.reduce((a, s) => a + own[s], 0) / g.stones.length * sign;
    const area = areas[c].list[areas[c].id[i]];
    const swamped = area.opp >= SWAMPED * area.own && avg < SWAMP_MC;
    if (avg <= -DEAD_AT || swamped) dead.push(...g.stones);
  }
  const clean = board.slice();
  for (const d of dead) clean[d] = null;
  const area = areaOwner(clean, size);
  let b = 0, w = 0;
  for (const o of area) { if (o === 'b') b++; else if (o === 'w') w++; }
  dead.sort((a, c) => a - c);
  return { owner: area, dead, b, w, komi, margin: b - w - komi };
}

/** Tromp-Taylor 归属：子归自己；空点连成的块只挨着一方的子就归那一方，否则谁都不算 */
export function areaOwner(board, size) {
  const n = board.length;
  const out = new Array(n).fill(null);
  const reg = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (board[i]) { out[i] = board[i]; continue; }
    if (reg[i] >= 0) continue;
    const pts = [i];
    reg[i] = i;
    let tb = false, tw = false;
    for (let k = 0; k < pts.length; k++) {
      for (const q of neighbors(pts[k], size)) {
        if (board[q] === 'b') tb = true;
        else if (board[q] === 'w') tw = true;
        else if (reg[q] < 0) { reg[q] = i; pts.push(q); }
      }
    }
    const o = tb && !tw ? 'b' : tw && !tb ? 'w' : null;
    for (const p of pts) out[p] = o;
  }
  return out;
}
