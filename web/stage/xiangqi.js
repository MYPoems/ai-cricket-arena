// 中国象棋画面：朱漆托盘 + 榧木棋盘 + 立体木棋（见 ../js/board.js）。

import { Board, XQ_SIZE } from '../js/board.js';

export default {
  aspect: XQ_SIZE,
  seatColor: (seat) => (seat === 'r' ? 'var(--red)' : 'var(--black-side)'),
  /** 玩家执黑时棋盘翻转，让自己在下方 */
  flipFor: (seat) => seat === 'b',

  createStage({ onAction }) {
    const board = new Board({ onMove: (iccs) => onAction(iccs) });
    return {
      el: board.el,
      setFlipped: (v) => board.setFlipped(v),
      render(view, { movable = null, arrows = [], animate = true } = {}) {
        const last = view.moves?.[view.moves.length - 1];
        board.render({ board: view.board, side: view.side, lastMove: last?.iccs || null, inCheck: view.inCheck, movable, arrows }, { animate });
      },
    };
  },

  moveList: (view) => (view.moves || []).map((m) => ({ seat: m.side, label: m.cn })),
};
