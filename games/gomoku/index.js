// 五子棋（15 路，无禁手：五连或长连获胜）。实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。
// 坐标：列 A–O（左到右），行 1–15（下到上），天元为 H8。黑先。

export const SIZE = 15;
const COLS = 'ABCDEFGHIJKLMNO';
const SEAT_NAMES = { b: '黑方', w: '白方' };
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

const idx = (x, y) => y * SIZE + x; // x：列 0–14，y：行 0–14（下到上）
const inside = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;
export const label = (x, y) => `${COLS[x]}${y + 1}`;
export function parseCoord(text) {
  const m = /^\s*([A-Oa-o])\s*(1[0-5]|[1-9])\s*$/.exec(String(text));
  if (!m) return null;
  return { x: COLS.indexOf(m[1].toUpperCase()), y: Number(m[2]) - 1 };
}
const other = (s) => (s === 'b' ? 'w' : 'b');

/** 从 (x, y) 沿某方向数连续同色子 */
function run(board, x, y, dx, dy, c) {
  let n = 0;
  let cx = x + dx, cy = y + dy;
  while (inside(cx, cy) && board[idx(cx, cy)] === c) { n++; cx += dx; cy += dy; }
  return { n, openEnd: inside(cx, cy) && !board[idx(cx, cy)] };
}

/** 刚落在 (x, y) 的子是否连成五（或更多），返回连线 */
function winLineAt(board, x, y) {
  const c = board[idx(x, y)];
  for (const [dx, dy] of DIRS) {
    const a = run(board, x, y, dx, dy, c);
    const b = run(board, x, y, -dx, -dy, c);
    if (a.n + b.n + 1 >= 5) {
      const line = [];
      for (let k = -b.n; k <= a.n; k++) line.push(label(x + k * dx, y + k * dy));
      return line;
    }
  }
  return null;
}

// ---------- 棋型打分（内置 AI 与粗略评估） ----------

/** 在 (x, y) 落 c 色子能形成的棋型分数 */
function pointScore(board, x, y, c) {
  let total = 0;
  let fours = 0, threes = 0;
  for (const [dx, dy] of DIRS) {
    const a = run(board, x, y, dx, dy, c);
    const b = run(board, x, y, -dx, -dy, c);
    const n = a.n + b.n + 1;
    const open = (a.openEnd ? 1 : 0) + (b.openEnd ? 1 : 0);
    if (n >= 5) total += 1e7;
    else if (n === 4) { total += open === 2 ? 1e6 : open === 1 ? 1e4 : 0; if (open) fours++; }
    else if (n === 3) { total += open === 2 ? 5e3 : open === 1 ? 300 : 0; if (open === 2) threes++; }
    else if (n === 2) total += open === 2 ? 120 : open === 1 ? 15 : 0;
    else total += open;
  }
  if (fours >= 2 || (fours && threes)) total += 5e5; // 双四、四三
  if (threes >= 2) total += 5e4; // 双三
  return total;
}

function candidates(board) {
  const out = [];
  let any = false;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (board[idx(x, y)]) { any = true; continue; }
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (inside(x + dx, y + dy) && board[idx(x + dx, y + dy)]) { near = true; break; }
    }
    if (near) out.push({ x, y });
  }
  if (!any) out.push({ x: 7, y: 7 });
  return out;
}

/** 给每个候选点打分：进攻分 + 防守分（防守略低） */
function ranked(board, side) {
  return candidates(board)
    .map((p) => ({ ...p, s: pointScore(board, p.x, p.y, side) + 0.9 * pointScore(board, p.x, p.y, other(side)) }))
    .sort((a, b) => b.s - a.s);
}

/** 粗略胜率：比较双方最强点的分数（走棋方视角） */
function heuristic(board, side) {
  const me = Math.max(0, ...candidates(board).map((p) => pointScore(board, p.x, p.y, side)));
  const op = Math.max(0, ...candidates(board).map((p) => pointScore(board, p.x, p.y, other(side))));
  if (me >= 1e7) return 1;
  if (op >= 1e7 && me < 1e7) return 0.15; // 对方有五连点，自己必须先挡
  const d = Math.log10(me + 10) - Math.log10(op + 10);
  return 1 / (1 + Math.exp(-d * 1.6));
}

// ---------- 状态 ----------

function newState() {
  return { size: SIZE, board: new Array(SIZE * SIZE).fill(null), side: 'b', moves: [], winner: null, winLine: null };
}

function boardText(state) {
  const lines = [`    ${COLS.split('').join(' ')}`];
  for (let y = SIZE - 1; y >= 0; y--) {
    let row = `${String(y + 1).padStart(2)}  `;
    for (let x = 0; x < SIZE; x++) {
      const c = state.board[idx(x, y)];
      row += (c === 'b' ? 'X' : c === 'w' ? 'O' : '.') + ' ';
    }
    lines.push(row.trimEnd());
  }
  return lines.join('\n');
}

export default {
  id: 'gomoku',
  name: '五子棋',
  players: { min: 2, max: 2, default: 2 },
  features: { draw: true, hidden: false, evalEngine: 'rapfi', winbar: true },
  noun: '落子',
  rankedSeries: { legs: 2, sameSeed: false }, // 无禁手先手优势大，排位赛交换先后手各下一盘

  seats: () => ['b', 'w'],
  seatName: (seat) => SEAT_NAMES[seat],

  create() {
    return newState();
  },

  pending(state) {
    return state.winner || state.moves.length >= SIZE * SIZE ? [] : [state.side];
  },

  actions(state, seat) {
    if (seat !== state.side) return [];
    const out = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!state.board[idx(x, y)]) out.push({ id: label(x, y), label: label(x, y) });
    return out;
  },

  apply(state, seat, action) {
    if (state.winner) throw new Error('对局已经结束');
    if (seat !== state.side) throw new Error(`现在不是${SEAT_NAMES[seat]}落子`);
    const p = parseCoord(action);
    if (!p) throw new Error(`无法识别的坐标：${action}`);
    if (state.board[idx(p.x, p.y)]) throw new Error(`${label(p.x, p.y)} 已经有子`);
    const board = state.board.slice();
    board[idx(p.x, p.y)] = seat;
    const line = winLineAt(board, p.x, p.y);
    return {
      ...state, board, side: other(seat),
      moves: [...state.moves, { label: label(p.x, p.y), side: seat }],
      winner: line ? seat : null, winLine: line,
    };
  },

  outcome(state) {
    if (state.winner) return { over: true, winner: state.winner, ranks: { [state.winner]: 1, [other(state.winner)]: 2 }, reason: '连成五子' };
    if (state.moves.length >= SIZE * SIZE) return { over: true, winner: null, ranks: { b: 1, w: 1 }, reason: '棋盘下满判和' };
    return { over: false };
  },

  forfeit(state, seat, reason) {
    const w = other(seat);
    return { over: true, winner: w, ranks: { [w]: 1, [seat]: 2 }, reason };
  },

  label: (state, seat, action) => String(action).toUpperCase(),

  // ---------- 给模型 ----------
  systemPrompt(seat, { style = '' } = {}) {
    return [
      `你是一名五子棋棋手，在这盘棋里执${SEAT_NAMES[seat]}（${seat === 'b' ? 'X，先手' : 'O，后手'}）。目标是赢下这盘棋。`,
      '',
      '【规则】15 路棋盘，黑先白后轮流落子。无禁手：任意一方横、竖、斜连成五子或更多即获胜。棋盘下满判和。',
      '【坐标】列 A–O 从左到右，行 1–15 从下到上，天元是 H8。棋盘上 X 是黑子，O 是白子，. 是空位。',
      '可以在任意空位落子。',
      '',
      '【输出格式】每一步只简短回答，用中文，除落子外合计不超过 80 字，严格按下面五行：',
      '判断：一句话说明当前局面谁占优、为什么',
      '威胁：一句话说明对方最大的威胁（例如活三、冲四的位置；没有就写「无」）',
      '理由：一句话说明你为什么下这里',
      '胜率：你估计自己现在的获胜概率，写成 0–100 的整数加 %',
      '落子：坐标，例如 H8',
      style ? `\n【你的风格】${style}\n（风格只影响你的下棋取向，不能改变上面的规则和输出格式。）` : '',
    ].join('\n');
  },

  turnPrompt(state, seat) {
    const last = state.moves[state.moves.length - 1];
    const recent = state.moves.slice(-12).map((m, i, arr) => `${state.moves.length - arr.length + i + 1}.${SEAT_NAMES[m.side][0]}${m.label}`).join(' ');
    return [
      `第 ${state.moves.length + 1} 手，轮到你（${SEAT_NAMES[seat]}）落子。`,
      last ? `对方上一手：${last.label}` : '这是本局第一手。',
      '',
      '当前棋盘：',
      boardText(state),
      recent ? `\n最近的着手：${recent}` : '',
    ].join('\n');
  },

  retryPrompt: (reason, attempt, max) => `你上一个回答的落子无效：${reason}。请重新选择（这是第 ${attempt} 次重下，最多 ${max} 次，再无效判负），仍按五行格式回答。`,

  parseReply(state, seat, text) {
    const t = String(text || '');
    const win = /胜率[:：]\s*(\d{1,3})/.exec(t);
    const winrate = win ? Math.min(100, Number(win[1])) : null;
    const line = [...t.matchAll(/落子[:：]\s*([A-Oa-o])\s*(1[0-5]|[1-9])(?!\d)/g)].pop();
    let p = line ? parseCoord(line[1] + line[2]) : null;
    if (!p) {
      const all = [...t.matchAll(/\b([A-Oa-o])(1[0-5]|[1-9])\b/g)].pop();
      if (all) p = parseCoord(all[1] + all[2]);
    }
    if (!p) return { action: null, attempted: null, winrate, error: '没有找到落子坐标（最后一行应为「落子：H8」这样的格式）' };
    const l = label(p.x, p.y);
    if (state.board[idx(p.x, p.y)]) return { action: null, attempted: l, winrate, error: `${l} 已经有子` };
    return { action: l, attempted: l, winrate, error: null };
  },

  // ---------- 内置 AI ----------
  builtinMove(state, seat, { level = 2, random = false } = {}) {
    const list = ranked(state.board, seat);
    if (random) {
      const p = list[Math.floor(Math.random() * list.length)];
      return label(p.x, p.y);
    }
    if (level <= 1) {
      const top = list.slice(0, 5);
      const p = top[Math.floor(Math.random() * top.length)];
      return label(p.x, p.y);
    }
    if (level >= 3 && list[0].s < 1e6) {
      // 两层：选一个点，使对方最强应手的分数最低
      let best = null;
      for (const p of list.slice(0, 10)) {
        const b = state.board.slice();
        b[idx(p.x, p.y)] = seat;
        if (winLineAt(b, p.x, p.y)) return label(p.x, p.y);
        const reply = ranked(b, other(seat))[0];
        const score = p.s - 0.8 * (reply ? reply.s : 0);
        if (!best || score > best.score) best = { p, score };
      }
      return label(best.p.x, best.p.y);
    }
    return label(list[0].x, list[0].y);
  },

  // ---------- 评估 ----------
  evalSpec(state) {
    if (state.winner) return null;
    const stones = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const c = state.board[idx(x, y)];
      if (c) stones.push({ x, y: SIZE - 1 - y, c }); // Piskvork 坐标：y 从上往下
    }
    const top = ranked(state.board, state.side)[0];
    return {
      engine: 'rapfi', size: SIZE, stones, toMove: state.side, persp: state.side,
      heuristic: heuristic(state.board, state.side), heuristicBest: top ? label(top.x, top.y) : null,
      toAction: (ex, ey) => label(ex, SIZE - 1 - ey),
    };
  },

  view(state) {
    const last = state.moves[state.moves.length - 1];
    return {
      size: SIZE, board: state.board, side: state.side, lastMove: last?.label || null,
      winLine: state.winLine, moves: state.moves.map((m) => ({ label: m.label, side: m.side, cn: m.label })),
    };
  },
};
