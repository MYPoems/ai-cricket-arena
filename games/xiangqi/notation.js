// 中文记谱：着法 ↔「炮二平五」这样的写法。
// 红方列号用中文数字（从红方右侧数起），黑方用全角阿拉伯数字（从黑方右侧数起）。

import { RED, sideOf, fileOf, rankOf, legalMoves, moveToIccs } from './rules.js';

const NAMES = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
};
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const AR = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];

const num = (side, n) => (side === RED ? CN[n] : AR[n]);
const colOf = (side, s) => (side === RED ? 9 - fileOf(s) : fileOf(s) + 1);

export const pieceName = (p) => NAMES[p];

/** 着法的中文记谱；pos 为走之前的局面 */
export function moveToChinese(pos, m) {
  const p = pos.board[m.from];
  const side = sideOf(p);
  const type = p.toUpperCase();
  const dir = side === RED ? 1 : -1;
  const dr = (rankOf(m.to) - rankOf(m.from)) * dir;
  const action = dr > 0 ? '进' : dr < 0 ? '退' : '平';
  const straight = 'KRCP'.includes(type);
  const target = !straight || dr === 0 ? num(side, colOf(side, m.to)) : num(side, Math.abs(dr));

  // 同一列有多个同类棋子时用「前、后」等区分（仕相不需要）
  let head = NAMES[p] + num(side, colOf(side, m.from));
  if (!'AB'.includes(type)) {
    const same = [];
    for (let s = fileOf(m.from); s < pos.board.length; s += 9) {
      if (pos.board[s] === p) same.push(s);
    }
    if (same.length > 1) {
      // 按「在前」排序：红方行号大的在前，黑方行号小的在前
      same.sort((a, b) => (rankOf(b) - rankOf(a)) * dir);
      const i = same.indexOf(m.from);
      const labels = same.length === 2 ? ['前', '后'] : same.length === 3 ? ['前', '中', '后'] : CN.slice(1);
      head = labels[i] + NAMES[p];
    }
  }
  return head + action + target;
}

// ---------- 解析 ----------

const CANON = new Map([
  ...'帅将帥將'.split('').map((c) => [c, 'K']),
  ...'仕士'.split('').map((c) => [c, 'A']),
  ...'相象'.split('').map((c) => [c, 'B']),
  ...'马馬傌'.split('').map((c) => [c, 'N']),
  ...'车車俥'.split('').map((c) => [c, 'R']),
  ...'炮砲包'.split('').map((c) => [c, 'C']),
  ...'兵卒'.split('').map((c) => [c, 'P']),
  ...CN.slice(1).map((c, i) => [c, String(i + 1)]),
  ...AR.slice(1).map((c, i) => [c, String(i + 1)]),
  ['进', '+'], ['進', '+'], ['退', '-'], ['平', '='],
  ['前', 'F'], ['中', 'M'], ['后', 'B'], ['後', 'B'],
]);

/** 把各种写法统一成可比较的形式 */
function canon(text) {
  let out = '';
  for (const ch of String(text).trim()) {
    if (CANON.has(ch)) out += CANON.get(ch);
    else if (/[0-9]/.test(ch)) out += ch;
  }
  return out;
}

/** 从中文记谱找到对应的合法着法，找不到返回 null */
export function chineseToMove(pos, text) {
  const want = canon(text);
  if (want.length < 4) return null;
  for (const m of legalMoves(pos)) {
    if (canon(moveToChinese(pos, m)) === want) return m;
  }
  return null;
}

/** 合法着法列表：[{ iccs, cn }] */
export function legalMoveList(pos) {
  return legalMoves(pos).map((m) => ({ iccs: moveToIccs(m), cn: moveToChinese(pos, m), from: m.from, to: m.to }));
}
