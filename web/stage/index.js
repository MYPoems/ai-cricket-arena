// 各游戏的画面模块。每个模块导出：
//   aspect: [宽, 高]                       舞台区域的宽高比，对局页据此算一屏布局
//   seatColor(seat, index) → CSS 颜色         阵营色
//   createStage({ onAction }) → { el, render(view, opts), setFlipped?(v) }
//     opts: { movable: 座位或 null（玩家本人可操作时）, actions: 合法行动, arrows, replay: 是否回放中 }
//   moveList?(view) → [{ seat, label }]       着法列表；没有时用每步记录的 label

const LOADERS = {
  xiangqi: () => import('./xiangqi.js'),
  gomoku: () => import('./gomoku.js'),
  chess: () => import('./chess.js'),
  doudizhu: () => import('./doudizhu.js'),
  undercover: () => import('./undercover.js'),
  poker: () => import('./poker.js'),
  dilemma: () => import('./dilemma.js'),
  othello: () => import('./othello.js'),
  connect4: () => import('./connect4.js'),
};

export async function loadRenderer(gameId) {
  const load = LOADERS[gameId];
  if (!load) throw new Error(`没有 ${gameId} 的画面模块`);
  return (await load()).default;
}

/** 多人游戏的阵营色：朱红、墨、靛、赭、青、紫 */
export const PALETTE = ['var(--red)', 'var(--black-side)', '#3559b5', '#9a5d24', '#2f7a70', '#7d3c98', '#a17a12', '#6b6b6b'];
