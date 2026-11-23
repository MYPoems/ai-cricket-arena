// 中国象棋画面：复用印刷棋谱样式的 SVG 棋盘。

import { Board } from '../js/board.js';

export default {
  aspect: [572, 632],
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
