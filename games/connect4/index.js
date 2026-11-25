// 四子棋（7 列 6 行）。实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。
// 棋子落到所选列最低的空位；横、竖、斜连成四子获胜；下满平局。朱先。
// 行动 id 为列号 '1'–'7'（左到右）。棋盘数组 idx = 行 * 7 + 列（都从 0 开始，行从下往上）。

import { solve, scoreToE, COLS, ROWS } from './ai.js';

const SEAT_NAMES = { r: '朱方', b: '金方' };
const MARK = { r: 'X', b: 'O' };
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const CN_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 零: 0 };
// builtinMove 的强度：level 越高搜索时间越长
const LEVELS = [
  { timeMs: 30, maxDepth: 2, noise: 6 },
  { timeMs: 100, maxDepth: 8 },
  { timeMs: 250 },
  { timeMs: 600 },
];

const other = (s) => (s === 'r' ? 'b' : 'r');
const height = (board, c) => { let h = 0; while (h < ROWS && board[h * COLS + c]) h++; return h; };

/** 列号（'1'–'7' 或数字）→ 0–6；不合法返回 null */
function parseCol(action) {
  const m = /^\s*([1-7])\s*$/.exec(String(action ?? ''));
  return m ? Number(m[1]) - 1 : null;
}

/** 刚落在 (c, r) 的子是否连成四（或更多），返回连线 [[列, 行], …] */
function winLineAt(board, c, r) {
  const v = board[r * COLS + c];
  const at = (x, y) => (x >= 0 && x < COLS && y >= 0 && y < ROWS ? board[y * COLS + x] : null);
  for (const [dx, dy] of DIRS) {
    let a = 0, b = 0;
    while (at(c + (a + 1) * dx, r + (a + 1) * dy) === v) a++;
    while (at(c - (b + 1) * dx, r - (b + 1) * dy) === v) b++;
    if (a + b + 1 >= 4) {
      const line = [];
      for (let k = -b; k <= a; k++) line.push([c + k * dx, r + k * dy]);
      return line;
    }
  }
  return null;
}

/** 全角转半角、中文数字转阿拉伯数字 */
const normalize = (t) => String(t || '')
  .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  .replace(/[一二三四五六七八九零]/g, (ch) => String(CN_DIGITS[ch]));

function boardText(state) {
  const lines = [` ${Array.from({ length: COLS }, (_, c) => c + 1).join(' ')}`];
  for (let r = ROWS - 1; r >= 0; r--) {
    let row = '';
    for (let c = 0; c < COLS; c++) {
      const v = state.board[r * COLS + c];
      row += ` ${v ? MARK[v] : '.'}`;
    }
    lines.push(row);
  }
  return lines.join('\n');
}

const legalCols = (state) => Array.from({ length: COLS }, (_, c) => c).filter((c) => height(state.board, c) < ROWS);

export default {
  id: 'connect4',
  name: '四子棋',
  players: { min: 2, max: 2, default: 2 },
  // clock：两人棋类的每步限时（默认 5 分钟，可在开局时改）和超时判负次数（默认 3 次）
  features: { draw: false, hidden: false, winbar: true, evalEngine: 'local', clock: true },
  noun: '落子',
  rankedSeries: { legs: 2, sameSeed: false }, // 先手优势大，交换先后手各下一盘

  seats: () => ['r', 'b'],
  seatName: (seat) => SEAT_NAMES[seat],

  create() {
    return { cols: COLS, rows: ROWS, board: new Array(COLS * ROWS).fill(null), side: 'r', moves: [], winner: null, winLine: null };
  },

  pending: (state) => (state.winner || state.moves.length >= COLS * ROWS ? [] : [state.side]),

  actions(state, seat) {
    if (seat !== state.side || state.winner) return [];
    return legalCols(state).map((c) => ({ id: String(c + 1), label: `第${c + 1}列` }));
  },

  apply(state, seat, action) {
    if (state.winner || state.moves.length >= COLS * ROWS) throw new Error('对局已经结束');
    if (seat !== state.side) throw new Error(`现在不是${SEAT_NAMES[seat]}落子`);
    const c = parseCol(action);
    if (c === null) throw new Error(`无法识别的列号：${action}（应为 1–7）`);
    const r = height(state.board, c);
    if (r >= ROWS) throw new Error(`第 ${c + 1} 列已经满了`);
    const board = state.board.slice();
    board[r * COLS + c] = seat;
    const line = winLineAt(board, c, r);
    return {
      ...state, board, side: other(seat),
      moves: [...state.moves, { col: c + 1, row: r + 1, side: seat }],
      winner: line ? seat : null, winLine: line,
    };
  },

  outcome(state) {
    if (state.winner) return { over: true, winner: state.winner, ranks: { [state.winner]: 1, [other(state.winner)]: 2 }, reason: `${SEAT_NAMES[state.winner]}连成四子` };
    if (state.moves.length >= COLS * ROWS) return { over: true, winner: null, ranks: { r: 1, b: 1 }, reason: '棋盘下满，平局' };
    return { over: false };
  },

  forfeit(state, seat, reason) {
    const w = other(seat);
    return { over: true, winner: w, ranks: { [w]: 1, [seat]: 2 }, reason };
  },

  label: (state, seat, action) => String(action).trim(),

  // ---------- 给模型 ----------
  systemPrompt(seat, { style = '', showLegal = false } = {}) {
    return [
      `你是一名四子棋（Connect Four）棋手，在这盘棋里执${SEAT_NAMES[seat]}（${MARK[seat]}，${seat === 'r' ? '先手' : '后手'}）。目标是赢下这盘棋。`,
      '',
      '【规则】棋盘竖立，7 列 6 行，朱先金后轮流落子。每次选一列，棋子落到这一列最低的空位；满了的列不能再下。',
      '任意一方横、竖或斜线连成四子即获胜；棋盘下满还没有人连成四子为平局。',
      `【棋盘】列号 1–7 从左到右写在棋盘上方，最下面一行是底。X 是朱子，O 是金子，. 是空位。${showLegal ? '每一手会列出还能下的列。' : ''}`,
      '',
      '【输出格式】每一步只简短回答，用中文，除落子外合计不超过 80 字，严格按下面五行：',
      '判断：一句话说明当前局面谁占优、为什么',
      '威胁：一句话说明对方最大的威胁（例如哪一列再下就连四；没有就写「无」）',
      '理由：一句话说明你为什么下这一列',
      '胜率：你估计自己现在的获胜概率，写成 0–100 的整数加 %',
      '落子：列号，例如 4',
      style ? `\n【你的风格】${style}\n（风格只影响你的下棋取向，不能改变上面的规则和输出格式。）` : '',
    ].join('\n');
  },

  turnPrompt(state, seat, { showLegal = false } = {}) {
    const last = state.moves[state.moves.length - 1];
    const recent = state.moves.slice(-14).map((m, i, arr) => `${state.moves.length - arr.length + i + 1}.${SEAT_NAMES[m.side][0]}${m.col}`).join(' ');
    return [
      `第 ${state.moves.length + 1} 手，轮到你（${SEAT_NAMES[seat]}，${MARK[seat]}）落子。`,
      last ? `对方上一手：第 ${last.col} 列（落在第 ${last.row} 行）` : '这是本局第一手。',
      '',
      '当前棋盘：',
      boardText(state),
      showLegal ? `\n还能下的列：${legalCols(state).map((c) => c + 1).join(' ')}` : null,
      recent ? `\n最近的着手（数字为列号）：${recent}` : null,
    ].filter((l) => l !== null).join('\n');
  },

  retryPrompt: (reason, attempt, max) => `你上一个回答的落子无效：${reason}。请重新选择（这是第 ${attempt} 次重下，最多 ${max} 次，再无效判负），仍按五行格式回答。`,

  parseReply(state, seat, text) {
    const t = normalize(text);
    const win = /胜率\s*[:：]\s*(\d{1,3})/.exec(t);
    const winrate = win ? Math.min(100, Number(win[1])) : null;
    let n = null;
    const line = [...t.matchAll(/落子\s*[:：]?\s*(?:第\s*)?(\d+)\s*(?:列)?/g)].pop();
    if (line) n = Number(line[1]);
    else {
      const col = [...t.matchAll(/(?:第\s*)?(\d+)\s*列/g)].pop();
      if (col) n = Number(col[1]);
    }
    if (n === null) return { action: null, attempted: null, winrate, error: '没有找到落子的列号（最后一行应为「落子：4」这样的格式，列号 1–7）' };
    if (n < 1 || n > COLS) return { action: null, attempted: String(n), winrate, error: `列号 ${n} 不存在，只能是 1–7` };
    if (height(state.board, n - 1) >= ROWS) {
      return { action: null, attempted: String(n), winrate, error: `第 ${n} 列已经满了（还能下的列：${legalCols(state).map((c) => c + 1).join(' ')}）` };
    }
    return { action: String(n), attempted: String(n), winrate, error: null };
  },

  mockReply(state, seat, action) {
    const c = Number(action);
    return [
      `判断：${state.moves.length < 8 ? '开局阶段，双方都在争中路' : '局面胶着，要看谁先做出双重威胁'}。`,
      '威胁：对方想在中路连成三子，要提前堵住。',
      `理由：${c === 4 ? '占中间列，能参与最多的连线。' : `第${c}列能兼顾进攻和防守。`}`,
      `胜率：${50 + ((state.moves.length * 7) % 21) - 10}%`,
      `落子：${c}`,
    ].join('\n');
  },

  // ---------- 内置 AI ----------
  builtinMove(state, seat, { level = 2, random = false } = {}) {
    const legal = legalCols(state);
    if (!legal.length) throw new Error('棋盘已满');
    if (random) return String(legal[Math.floor(Math.random() * legal.length)] + 1);
    const cfg = LEVELS[Math.max(1, Math.min(4, Math.round(level))) - 1];
    const r = solve(state.board, seat, { ...cfg, moveOnly: true });
    return String((r?.best ?? legal[0]) + 1);
  },

  // ---------- 评估 ----------
  evalSpec(state) {
    if (state.winner || state.moves.length >= COLS * ROWS) return null;
    const board = state.board.slice(), side = state.side;
    return {
      engine: 'local', persp: side,
      evaluate: () => {
        const r = solve(board, side, { timeMs: 220 });
        return { e: scoreToE(r), best: String(r.best + 1), source: r.exact ? 'solver' : 'search' };
      },
    };
  },

  view(state) {
    const last = state.moves[state.moves.length - 1];
    return {
      cols: COLS, rows: ROWS, board: state.board, side: state.side,
      lastMove: last ? { col: last.col - 1, row: last.row - 1 } : null,
      winner: state.winner, winLine: state.winLine,
      moves: state.moves.map((m) => ({ label: String(m.col), side: m.side })),
    };
  },
};
