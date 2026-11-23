// 中国象棋的游戏定义，实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。

import * as R from './rules.js';
import { moveToChinese, legalMoveList } from './notation.js';
import { systemPrompt, turnPrompt, retryPrompt, parseReply, SEAT_NAMES } from './prompt.js';
import { chooseMove } from './ai.js';

const SEATS = ['r', 'b'];

export default {
  id: 'xiangqi',
  name: '中国象棋',
  players: { min: 2, max: 2, default: 2 },
  features: { draw: true, hidden: false, evalEngine: 'pikafish', winbar: true },
  noun: '着法',
  seatNames: SEAT_NAMES,

  seats: () => SEATS,
  seatName: (seat) => SEAT_NAMES[seat],

  create({ setup } = {}) {
    return R.newGame(setup?.fen || R.START_FEN);
  },

  pending(state) {
    return R.result(state).over ? [] : [state.pos.side];
  },

  toMove: (state) => state.pos.side,

  actions(state) {
    return legalMoveList(state.pos).map((m) => ({ id: m.iccs, label: m.cn }));
  },

  apply(state, seat, actionId) {
    if (seat !== state.pos.side) throw new Error(`现在不是${SEAT_NAMES[seat]}走棋`);
    const m = R.iccsToMove(actionId);
    if (!m || !R.isLegal(state.pos, m)) throw new Error(`不合法的着法：${actionId}`);
    const cn = moveToChinese(state.pos, m);
    const next = R.play(state, m);
    next.moves[next.moves.length - 1].cn = cn;
    return next;
  },

  /** { over, winner, ranks: { seat: 名次 }, reason }；和棋时双方名次相同 */
  outcome(state) {
    const res = R.result(state);
    if (!res.over) return { over: false };
    const ranks = res.winner ? { [res.winner]: 1, [R.opponent(res.winner)]: 2 } : { r: 1, b: 1 };
    return { over: true, winner: res.winner, ranks, reason: res.reason };
  },

  forfeit(state, seat, reason) {
    const winner = R.opponent(seat);
    return { over: true, winner, ranks: { [winner]: 1, [seat]: 2 }, reason };
  },

  label(state, seat, actionId) {
    const m = R.iccsToMove(actionId);
    return m ? moveToChinese(state.pos, m) : actionId;
  },

  // ---------- 给模型 ----------
  systemPrompt: (seat, opts) => systemPrompt(seat, opts),
  turnPrompt: (state, seat, opts) => turnPrompt(state, seat, opts),
  retryPrompt,
  parseReply(state, seat, text) {
    const r = parseReply(state.pos, text);
    return { action: r.move ? R.moveToIccs(r.move) : null, attempted: r.iccs || null, winrate: r.winrate, error: r.error };
  },

  // ---------- 内置 AI ----------
  builtinMove(state, seat, { depth = 3 } = {}) {
    const c = chooseMove(state.pos, { depth });
    return c ? R.moveToIccs(c.move) : null;
  },

  // ---------- 评估 ----------
  /** 引擎评估参数：评估结果是走棋方视角 */
  evalSpec: (state) => ({ engine: 'pikafish', fen: R.toFen(state.pos), persp: state.pos.side }),
  fen: (state) => R.toFen(state.pos),

  /** 发给浏览器的局面数据（象棋没有隐藏信息，viewer 无影响） */
  view(state) {
    return {
      fen: R.toFen(state.pos),
      side: state.pos.side,
      board: state.pos.board,
      inCheck: R.inCheck(state.pos.board, state.pos.side),
      moves: state.moves.map((m) => ({ iccs: m.iccs, cn: m.cn, side: m.side, check: m.check, captured: m.captured })),
    };
  },
};
