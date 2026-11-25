// 黑白棋（8×8）。实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。
// 坐标：列 a–h（左到右），行 1–8（下到上）。黑先。必须夹住并翻转至少一子才能落子；
// 无子可下时自动跳过（不占一手，记在 state.passes 里），双方都无子可下时终局，子多者胜。

import { SIZE, COLS, SEAT_NAMES, other, sqLabel, parseSquare, flipsFor, legalSquares, counts, initialBoard, boardFromText, settle } from './rules.js';
import { search, scoreToE } from './ai.js';

const MARK = { b: 'X', w: 'O' };
const CN_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 };
// builtinMove 的强度：level 1–4 → 搜索深度、时间上限、残局精确计算的空格数
const LEVELS = [
  { maxDepth: 1, timeMs: 100, exactEmpties: 0, noise: 30 },
  { maxDepth: 2, timeMs: 200, exactEmpties: 6 },
  { maxDepth: 5, timeMs: 400, exactEmpties: 10 },
  { maxDepth: 8, timeMs: 800, exactEmpties: 14 },
];

/** 全角字母数字转半角、中文数字转阿拉伯数字 */
const normalize = (t) => String(t || '')
  .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  .replace(/[一二三四五六七八]/g, (ch) => String(CN_DIGITS[ch]));

function boardText(state, legal = null) {
  const marks = new Set(legal || []);
  const lines = [`   ${COLS.split('').join(' ')}`];
  for (let y = SIZE - 1; y >= 0; y--) {
    let row = `${y + 1}  `;
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const c = state.board[i];
      row += (c ? MARK[c] : marks.has(i) ? '*' : '.') + ' ';
    }
    lines.push(row.trimEnd());
  }
  return lines.join('\n');
}

/** 最近一次跳过：如果它发生在最后一手之后，返回跳过的座位 */
function lastPass(state) {
  const p = state.passes[state.passes.length - 1];
  return p && p.ply === state.moves.length ? p.seat : null;
}

function makeState(board, side) {
  const st = settle(board, side, [], 0);
  return { size: SIZE, board, side: st.side, moves: [], passes: st.passes, over: st.over };
}

export default {
  id: 'othello',
  name: '黑白棋',
  players: { min: 2, max: 2, default: 2 },
  // clock：两人棋类的每步限时（默认 5 分钟，可在开局时改）和超时判负次数（默认 3 次）
  features: { draw: false, hidden: false, winbar: true, evalEngine: 'local', clock: true },
  noun: '落子',
  rankedSeries: { legs: 2, sameSeed: false }, // 交换先后手各下一盘

  seats: () => ['b', 'w'],
  seatName: (seat) => SEAT_NAMES[seat],

  /** setup.board：可选的文字棋盘（见 rules.js boardFromText），setup.side：先走的一方 */
  create({ setup } = {}) {
    const board = setup?.board ? boardFromText(setup.board) : initialBoard();
    return makeState(board, setup?.side === 'w' ? 'w' : 'b');
  },

  pending: (state) => (state.over ? [] : [state.side]),

  actions(state, seat) {
    if (state.over || seat !== state.side) return [];
    return legalSquares(state.board, seat).map((i) => ({ id: sqLabel(i), label: sqLabel(i) }));
  },

  apply(state, seat, action) {
    if (state.over) throw new Error('对局已经结束');
    if (seat !== state.side) throw new Error(`现在不是${SEAT_NAMES[seat]}落子`);
    const i = parseSquare(action);
    if (i === null) throw new Error(`无法识别的坐标：${action}`);
    const l = sqLabel(i);
    if (state.board[i]) throw new Error(`${l} 已经有子`);
    const flips = flipsFor(state.board, i, seat);
    if (!flips.length) throw new Error(`${l} 不能落子：必须夹住并翻转对方至少一子`);
    const board = state.board.slice();
    board[i] = seat;
    for (const f of flips) board[f] = seat;
    const moves = [...state.moves, { label: l, side: seat, flips: flips.map(sqLabel) }];
    const st = settle(board, other(seat), state.passes, moves.length);
    return { ...state, board, moves, side: st.side, passes: st.passes, over: st.over };
  },

  outcome(state) {
    if (!state.over) return { over: false };
    const { b, w, empty } = counts(state.board);
    const score = `黑方 ${b} 子，白方 ${w} 子`;
    const why = empty ? (b && w ? '双方都无子可下' : `${b ? '白方' : '黑方'}的棋子被全部吃光`) : '棋盘下满';
    if (b === w) return { over: true, winner: null, ranks: { b: 1, w: 1 }, reason: `${why}，${score}，平局` };
    const win = b > w ? 'b' : 'w';
    return { over: true, winner: win, ranks: { [win]: 1, [other(win)]: 2 }, reason: `${why}，${score}，${SEAT_NAMES[win]}子多获胜` };
  },

  forfeit(state, seat, reason) {
    const w = other(seat);
    return { over: true, winner: w, ranks: { [w]: 1, [seat]: 2 }, reason };
  },

  label: (state, seat, action) => String(action).trim().toLowerCase(),

  // ---------- 给模型 ----------
  systemPrompt(seat, { style = '', showLegal = false } = {}) {
    return [
      `你是一名黑白棋（奥赛罗）棋手，在这盘棋里执${SEAT_NAMES[seat]}（${MARK[seat]}，${seat === 'b' ? '先手' : '后手'}）。目标是终局时自己的子比对方多。`,
      '',
      '【规则】8×8 棋盘，开局中央四子：d4、e5 为白，e4、d5 为黑，黑先。',
      '落子必须和自己已有的棋子在横、竖或斜线上夹住对方连续的一个或多个棋子，被夹住的子全部翻成自己的颜色；不能翻转任何子的位置不能下。',
      '一方无处可下时自动跳过，由对方连走；双方都无处可下时终局，子多者胜，相同为平局。',
      `【坐标】列 a–h 从左到右，行 1–8 从下到上。棋盘上 X 是黑子，O 是白子，. 是空位${showLegal ? '，* 是你现在可以落子的位置' : ''}。`,
      '',
      '【输出格式】每一步只简短回答，用中文，除落子外合计不超过 80 字，严格按下面五行：',
      '判断：一句话说明当前局面谁占优、为什么',
      '威胁：一句话说明对方最想占的要点（例如角、边；没有就写「无」）',
      '理由：一句话说明你为什么下这里',
      '胜率：你估计自己现在的获胜概率，写成 0–100 的整数加 %',
      '落子：坐标，例如 d3',
      style ? `\n【你的风格】${style}\n（风格只影响你的下棋取向，不能改变上面的规则和输出格式。）` : '',
    ].join('\n');
  },

  turnPrompt(state, seat, { showLegal = false } = {}) {
    const last = state.moves[state.moves.length - 1];
    const legal = legalSquares(state.board, seat);
    const { b, w, empty } = counts(state.board);
    const passed = lastPass(state);
    const recent = state.moves.slice(-12).map((m, i, arr) => `${state.moves.length - arr.length + i + 1}.${SEAT_NAMES[m.side][0]}${m.label}`).join(' ');
    return [
      `第 ${state.moves.length + 1} 手，轮到你（${SEAT_NAMES[seat]}，${MARK[seat]}）落子。`,
      last ? `${last.side === seat ? '你' : '对方'}上一手：${last.label}（翻转 ${last.flips.length} 子）` : '这是本局第一手。',
      passed && passed !== seat ? `对方（${SEAT_NAMES[passed]}）无处可下，跳过一手，由你连走。` : null,
      `子数：黑 X ${b}，白 O ${w}，空位 ${empty}`,
      '',
      '当前棋盘：',
      boardText(state, showLegal ? legal : null),
      showLegal ? `\n你可以落子的位置：${legal.map(sqLabel).join(' ')}` : null,
      recent ? `\n最近的着手：${recent}` : null,
    ].filter((l) => l !== null).join('\n');
  },

  retryPrompt: (reason, attempt, max) => `你上一个回答的落子无效：${reason}。请重新选择（这是第 ${attempt} 次重下，最多 ${max} 次，再无效判负），仍按五行格式回答。`,

  parseReply(state, seat, text) {
    const t = normalize(text);
    const win = /胜率\s*[:：]\s*(\d{1,3})/.exec(t);
    const winrate = win ? Math.min(100, Number(win[1])) : null;
    const line = [...t.matchAll(/落子\s*[:：]?\s*([a-hA-H])\s*([1-8])(?!\d)/g)].pop();
    let i = line ? parseSquare(line[1] + line[2]) : null;
    if (i === null) {
      const all = [...t.matchAll(/(?<![A-Za-z0-9])([a-hA-H])\s?([1-8])(?![A-Za-z0-9])/g)].pop();
      if (all) i = parseSquare(all[1] + all[2]);
    }
    if (i === null) return { action: null, attempted: null, winrate, error: '没有找到落子坐标（最后一行应为「落子：d3」这样的格式，列 a–h，行 1–8）' };
    const l = sqLabel(i);
    if (state.board[i]) return { action: null, attempted: l, winrate, error: `${l} 已经有子` };
    if (!flipsFor(state.board, i, seat).length) {
      const legal = legalSquares(state.board, seat).map(sqLabel);
      return { action: null, attempted: l, winrate, error: `${l} 不能落子：必须夹住并翻转对方至少一子（现在可以下的位置：${legal.join(' ')}）` };
    }
    return { action: l, attempted: l, winrate, error: null };
  },

  mockReply(state, seat, action) {
    const { b, w } = counts(state.board);
    const mine = seat === 'b' ? b : w, theirs = seat === 'b' ? w : b;
    const i = parseSquare(action);
    const corner = i !== null && [0, 7, 56, 63].includes(i);
    return [
      `判断：${mine >= theirs ? '子数不落后' : '子数暂时落后'}，中盘更看行动力。`,
      '威胁：对方想抢角，要避免给他机会。',
      `理由：${corner ? '占角，角上的子不会再被翻。' : '下在这里翻子适中，不给对方好点。'}`,
      `胜率：${Math.max(5, Math.min(95, 50 + (mine - theirs) * 2))}%`,
      `落子：${String(action).toLowerCase()}`,
    ].join('\n');
  },

  // ---------- 内置 AI ----------
  builtinMove(state, seat, { level = 2, random = false } = {}) {
    const legal = legalSquares(state.board, seat);
    if (!legal.length) throw new Error(`${SEAT_NAMES[seat]}无处可下`);
    if (random) return sqLabel(legal[Math.floor(Math.random() * legal.length)]);
    if (legal.length === 1) return sqLabel(legal[0]);
    const cfg = LEVELS[Math.max(1, Math.min(4, Math.round(level))) - 1];
    const r = search(state.board, seat, cfg);
    return sqLabel(r.best ?? legal[0]);
  },

  // ---------- 评估 ----------
  evalSpec(state) {
    if (state.over) return null;
    const board = state.board.slice(), side = state.side;
    return {
      engine: 'local', persp: side,
      evaluate: () => {
        const r = search(board, side, { maxDepth: 10, timeMs: 200, exactEmpties: 14, wld: true });
        return { e: scoreToE(r), best: r.best === null ? null : sqLabel(r.best), source: r.exact ? 'solver' : 'search' };
      },
    };
  },

  view(state) {
    const last = state.moves[state.moves.length - 1];
    const { b, w } = counts(state.board);
    return {
      size: SIZE, board: state.board, side: state.side, over: state.over,
      lastMove: last?.label || null, flipped: last?.flips || [],
      counts: { b, w }, pass: lastPass(state),
      legal: state.over ? [] : legalSquares(state.board, state.side).map(sqLabel),
      moves: state.moves.map((m) => ({ label: m.label, side: m.side })),
    };
  },
};
