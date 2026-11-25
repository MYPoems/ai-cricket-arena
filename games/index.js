// 电子斗蛐蛐的游戏注册表与通用游戏接口（第二版：支持多人、隐藏信息、同时行动、带种子的随机）。
//
// 每个游戏实现：
//   id, name, players: { min, max, default }
//   seats(n) → 座位 id 数组                     例：象棋 ['r','b']，斗地主 ['p1','p2','p3']
//   seatName(seat) → 座位名                     例：'红方'、'1 号位'
//   create({ players, seed, setup }) → state    setup 为游戏自己的开局参数（象棋的 fen 等）；state 必须能 JSON 序列化
//   pending(state) → [seat, ...]                现在需要出手的座位；多个表示同时行动（如投票）
//   actions(state, seat) → [{ id, label }] | null   该座位的合法行动；null 表示自由文本（如发言）
//   apply(state, seat, action) → 新 state        不合法时抛错，不修改原 state
//   outcome(state) → { over, ranks: { seat: 名次 }, winner, reason, teams? }   名次相同表示平局或同队
//   forfeit(state, seat, reason) → outcome       某座位犯规或认输
//   label(state, seat, action) → 行动的中文描述
//   systemPrompt(seat, opts) / turnPrompt(state, seat, opts) / retryPrompt(err, attempt, max)
//   parseReply(state, seat, text) → { action, attempted, winrate, error }
//   builtinMove(state, seat, opts) → action      内置 AI（可以返回 Promise）
//   view(state, viewer) → 浏览器数据；viewer 为座位时只含该座位能看到的信息，null 为观众的上帝视角
//   evalSpec(state) → { engine, ... , persp } | null   局面评估参数，persp 为评估结果所属的座位
//   features: { draw, hidden, evalEngine }      draw = 支持提和；hidden = 有隐藏信息
//
// 对局记录：{ setup, seed, players, actions: [{ seat, action }] }，replay(record) 由 create + 逐个 apply 得到同一局面。

import xiangqi from './xiangqi/index.js';
import gomoku from './gomoku/index.js';
import chess from './chess/index.js';
import doudizhu from './doudizhu/index.js';
import undercover from './undercover/index.js';
import poker from './poker/index.js';
import dilemma from './dilemma/index.js';
import othello from './othello/index.js';
import connect4 from './connect4/index.js';
import werewolf from './werewolf/index.js';
import turtlesoup from './turtlesoup/index.js';
import go from './go/index.js';
import liar from './liar/index.js';
import mahjong from './mahjong/index.js';
import guandan from './guandan/index.js';

export const GAMES = { [xiangqi.id]: xiangqi, [gomoku.id]: gomoku, [go.id]: go, [chess.id]: chess, [doudizhu.id]: doudizhu, [undercover.id]: undercover, [poker.id]: poker, [dilemma.id]: dilemma, [othello.id]: othello, [connect4.id]: connect4, [werewolf.id]: werewolf, [turtlesoup.id]: turtlesoup, [liar.id]: liar, [mahjong.id]: mahjong, [guandan.id]: guandan };

export function registerGame(g) {
  GAMES[g.id] = g;
}

export function getGame(id) {
  const g = typeof id === 'string' && Object.hasOwn(GAMES, id) ? GAMES[id] : null;
  if (!g) throw Object.assign(new Error(`未知游戏：${id}`), { status: 400 });
  return g;
}

/** 从对局记录重建局面。兼容旧记录：actions 里是字符串时，座位取当时该出手的座位 */
export function replay(game, record) {
  let state = game.create({ players: record.players, seed: record.seed, setup: record.setup });
  for (const a of record.actions || []) {
    const seat = typeof a === 'string' ? game.pending(state)[0] : a.seat;
    const action = typeof a === 'string' ? a : a.action;
    state = game.apply(state, seat, action);
  }
  return state;
}

export const gameList = () => Object.values(GAMES).map((g) => ({
  id: g.id, name: g.name, players: g.players, features: g.features || {},
  seats: g.seats(g.players.default), seatNames: Object.fromEntries(g.seats(g.players.max).map((s) => [s, g.seatName(s)])),
}));
