// 国际象棋的游戏定义，实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。
// 行动 id 用 UCI（e2e4、e7e8q），显示用标准代数记谱 SAN（Nf3、O-O、e8=Q+）。

import * as R from './rules.js';
import { systemPrompt, turnPrompt, retryPrompt, parseReply, SEAT_NAMES } from './prompt.js';
import { chooseMove } from './ai.js';

const SEATS = ['w', 'b'];
// 内置 AI：等级对应搜索深度；低等级在根节点加一点随机扰动，避免每局一模一样
const NOISE = { 1: 40, 2: 15, 3: 6, 4: 2 };

export default {
  id: 'chess',
  name: '国际象棋',
  players: { min: 2, max: 2, default: 2 },
  // clock：两人棋类的每步限时（默认 5 分钟，可在开局时改）和超时判负次数（默认 3 次）
  features: { draw: true, hidden: false, winbar: true, evalEngine: 'stockfish', clock: true },
  noun: '着法',
  rankedSeries: { legs: 2, sameSeed: false }, // 排位赛交换先后手各下一盘
  seatNames: SEAT_NAMES,

  seats: () => SEATS,
  seatName: (seat) => SEAT_NAMES[seat],

  create({ setup } = {}) {
    return R.newGame(setup?.fen || R.START_FEN);
  },

  pending(state) {
    return state.result ? [] : [state.pos.side];
  },

  toMove: (state) => state.pos.side,

  actions(state, seat) {
    if (state.result || seat !== state.pos.side) return [];
    const pos = R.clonePos(state.pos);
    const legal = R.legalMoves(pos);
    return legal.map((m) => ({ id: R.moveToUci(m), label: R.toSan(pos, m, legal) }));
  },

  apply(state, seat, actionId) {
    if (state.result) throw new Error('对局已经结束');
    if (seat !== state.pos.side) throw new Error(`现在不是${SEAT_NAMES[seat]}走棋`);
    const m = R.uciToMove(R.clonePos(state.pos), actionId);
    if (!m) throw new Error(`不合法的着法：${actionId}`);
    return R.play(state, m);
  },

  /** { over, winner, ranks: { seat: 名次 }, reason }；和棋时双方名次相同 */
  outcome(state) {
    const res = state.result;
    if (!res) return { over: false };
    const ranks = res.winner ? { [res.winner]: 1, [R.opponent(res.winner)]: 2 } : { w: 1, b: 1 };
    return { over: true, winner: res.winner, ranks, reason: res.reason };
  },

  forfeit(state, seat, reason) {
    const winner = R.opponent(seat);
    return { over: true, winner, ranks: { [winner]: 1, [seat]: 2 }, reason };
  },

  label(state, seat, actionId) {
    const pos = R.clonePos(state.pos);
    const m = R.uciToMove(pos, actionId);
    return m ? R.toSan(pos, m) : String(actionId);
  },

  // ---------- 给模型 ----------
  systemPrompt: (seat, opts) => systemPrompt(seat, opts),
  turnPrompt: (state, seat, opts) => turnPrompt({ ...state, pos: R.clonePos(state.pos) }, seat, opts),
  retryPrompt,
  parseReply(state, seat, text) {
    const r = parseReply(R.clonePos(state.pos), text);
    return { action: r.move ? R.moveToUci(r.move) : null, attempted: r.uci || null, winrate: r.winrate, error: r.error };
  },

  /** 把一个合法行动写成符合格式的完整回答（模拟模型用） */
  mockReply(state, seat, action) {
    const pos = R.clonePos(state.pos);
    const m = R.uciToMove(pos, action);
    const san = m ? R.toSan(pos, m) : action;
    return [
      '判断：双方子力相当，局面大致均衡。',
      `威胁：${R.inCheck(pos) ? '正被将军，先应将。' : '无'}`,
      `理由：走 ${san}，改善子力位置。`,
      '胜率：50%',
      `着法：${action}`,
    ].join('\n');
  },

  // ---------- 内置 AI ----------
  builtinMove(state, seat, { level = 2, random = false } = {}) {
    const pos = R.clonePos(state.pos);
    const legal = R.legalMoves(pos);
    if (!legal.length) return null;
    if (random) return R.moveToUci(legal[Math.floor(Math.random() * legal.length)]);
    const lv = Math.max(1, Math.min(4, Math.round(Number(level) || 2)));
    const c = chooseMove(pos, { depth: lv, timeMs: 1500, noise: NOISE[lv], history: state.keys });
    return c ? R.moveToUci(c.move) : null;
  },

  // ---------- 评估 ----------
  /** 引擎评估参数：评估结果是走棋方视角；终局返回 null */
  evalSpec: (state) => (state.result ? null : { engine: 'stockfish', fen: R.toFen(state.pos), persp: state.pos.side }),
  fen: (state) => R.toFen(state.pos),

  /** 发给浏览器的局面数据（没有隐藏信息，viewer 无影响） */
  view(state) {
    const last = state.moves[state.moves.length - 1];
    return {
      fen: R.toFen(state.pos),
      side: state.pos.side,
      board: state.pos.board,
      inCheck: R.inCheck(state.pos),
      lastMove: last?.uci || null,
      moves: state.moves.map((m) => ({ uci: m.uci, san: m.san, side: m.side, check: m.check })),
    };
  },
};
