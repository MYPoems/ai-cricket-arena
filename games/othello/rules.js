// 黑白棋规则核心：棋盘、合法落子、翻转、跳过与终局。浏览器和 Node 都能运行（不 import node 模块）。
// 坐标：列 a–h（左到右），行 1–8（下到上）；格子编号 i = y * 8 + x。棋盘数组元素为 null | 'b' | 'w'。

export const SIZE = 8;
export const COLS = 'abcdefgh';
export const SEAT_NAMES = { b: '黑方', w: '白方' };
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export const other = (s) => (s === 'b' ? 'w' : 'b');
export const sqLabel = (i) => `${COLS[i % SIZE]}${Math.floor(i / SIZE) + 1}`;

/** 解析坐标（不分大小写，允许中间空格），返回格子编号或 null */
export function parseSquare(text) {
  const m = /^\s*([a-hA-H])\s*([1-8])\s*$/.exec(String(text ?? ''));
  return m ? (Number(m[2]) - 1) * SIZE + COLS.indexOf(m[1].toLowerCase()) : null;
}

/** 在 i 落 c 色子会翻转的格子；不能落（有子或不翻任何子）时返回空数组 */
export function flipsFor(board, i, c) {
  if (board[i]) return [];
  const x0 = i % SIZE, y0 = Math.floor(i / SIZE);
  const op = other(c);
  const out = [];
  for (const [dx, dy] of DIRS) {
    const line = [];
    let x = x0 + dx, y = y0 + dy;
    while (x >= 0 && x < SIZE && y >= 0 && y < SIZE && board[y * SIZE + x] === op) { line.push(y * SIZE + x); x += dx; y += dy; }
    if (line.length && x >= 0 && x < SIZE && y >= 0 && y < SIZE && board[y * SIZE + x] === c) out.push(...line);
  }
  return out;
}

/** c 色所有合法落点（格子编号，按 a1, b1, … h8 的顺序） */
export function legalSquares(board, c) {
  const out = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (!board[i] && flipsFor(board, i, c).length) out.push(i);
  return out;
}

export function counts(board) {
  let b = 0, w = 0;
  for (const c of board) { if (c === 'b') b++; else if (c === 'w') w++; }
  return { b, w, empty: SIZE * SIZE - b - w };
}

export function initialBoard() {
  const board = new Array(SIZE * SIZE).fill(null);
  board[3 * SIZE + 3] = 'w'; // d4
  board[3 * SIZE + 4] = 'b'; // e4
  board[4 * SIZE + 3] = 'b'; // d5
  board[4 * SIZE + 4] = 'w'; // e5
  return board;
}

/** 从文字棋盘读入（8 行，第一行是第 8 行；X/x/b/● 黑，O/o/w/○ 白，其他为空），开发和测试用 */
export function boardFromText(text) {
  const cells = String(text).replace(/[\s|]/g, '').split('');
  if (cells.length !== SIZE * SIZE) throw new Error(`棋盘应有 64 格，实际 ${cells.length} 格`);
  const board = new Array(SIZE * SIZE).fill(null);
  cells.forEach((ch, k) => {
    const y = SIZE - 1 - Math.floor(k / SIZE), x = k % SIZE;
    board[y * SIZE + x] = /[Xxb●]/.test(ch) ? 'b' : /[Oow○]/.test(ch) ? 'w' : null;
  });
  return board;
}

/**
 * 落子后的轮转：轮到的一方无子可下就跳过（记一条 pass），双方都无子可下则终局。
 * 返回新的 { side, passes, over }。
 */
export function settle(board, side, passes, ply) {
  if (legalSquares(board, side).length) return { side, passes, over: false };
  const op = other(side);
  if (legalSquares(board, op).length) return { side: op, passes: [...passes, { seat: side, ply }], over: false };
  return { side, passes, over: true };
}
