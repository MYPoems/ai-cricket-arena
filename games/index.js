// 电子斗蛐蛐的游戏注册表。
//
// 每个游戏实现同一套接口：
//   id, name, seats, seatNames
//   create(options) → state                   新对局
//   toMove(state) → seat                       轮到谁
//   actions(state) → [{ id, label }]           当前方的合法行动
//   apply(state, id) → state                   执行行动（不合法时抛错，不修改原状态）
//   outcome(state) → { over, winner, ranks, reason }   ranks 为每个座位的名次，供积分计算
//   forfeit(state, seat, reason) → outcome     某座位犯规判负
//   systemPrompt(seat, opts) / turnPrompt(state, seat, opts) / retryPrompt(...) / parseReply(state, text)
//   builtinMove(state, opts) → id              内置 AI
//   view(state) → 发给浏览器的数据；replay(start, ids) → 由记录重建对局
//
// 以后加入信息不对称的游戏时，turnPrompt 只描述该座位能看到的信息，view 按观众身份裁剪。

import xiangqi from './xiangqi/index.js';

export const GAMES = { [xiangqi.id]: xiangqi };

export function getGame(id) {
  const g = GAMES[id];
  if (!g) throw new Error(`未知游戏：${id}`);
  return g;
}

export const gameList = () => Object.values(GAMES).map((g) => ({ id: g.id, name: g.name, seats: g.seats, seatNames: g.seatNames }));
