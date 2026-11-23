// 德州每一手开始、结束时的停顿（毫秒）。服务端按它停下来等，牌桌按它演结算和开局提示，回放、录制也按它等，三边对得上。
//
// 一手结束：先把没发完的公共牌一条街一条街翻完（每条街 STREET），组成牌型的五张牌抬起，再弹出结算卡停 HOLD；
// 新一手：开局提示（第几手、盲注、庄位）停 DEAL，同时发牌。

export const T = {
  RUNOUT_AT: 450, // 结算开始后多久翻第一张没发完的牌
  STREET: 750, // 每条街的间隔
  LIFT: 150, // 翻完到五张牌抬起
  CARD_AT: 300, // 抬起后多久弹出结算卡
  HOLD_SHOWDOWN: 3200, // 摊牌：结算卡（亮出的底牌、牌型、输赢）停留
  HOLD_FOLD: 2400, // 其他人弃牌：结算卡停留
  DEAL: 2000, // 新一手：开局提示停留（发牌同时进行）
  TURN: 1500, // 每个人出手后停一下，再轮到下一位
};

/** 结算阶段：翻完没发的牌、抬牌之后，结算卡什么时候出现（相对结算开始） */
export function cardAt({ showdown, streets }) {
  return showdown ? T.RUNOUT_AT + streets * T.STREET + T.LIFT + T.CARD_AT : 300;
}

/** 一手结束的整段时长（不含新一手的开局提示） */
export function endDur({ showdown, streets }) {
  return cardAt({ showdown, streets }) + (showdown ? T.HOLD_SHOWDOWN : T.HOLD_FOLD);
}

/** 从这条街（公共牌张数 from）发到 to 张要翻几条街 */
export function streetsBetween(from, to) {
  return (from < 3 && to >= 3 ? 1 : 0) + (from < 4 && to >= 4 ? 1 : 0) + (from < 5 && to >= 5 ? 1 : 0);
}

/**
 * 两个局面之间要停多久：prev 为 null 表示开局（第一手的开局提示）。
 * 用的是浏览器数据（game.view）里也有的字段，服务端、牌桌、回放算出来一样。
 * a：{ handNo, boardLen }；b：{ handNo, over, last: { no, showdown, boardLen } | null }
 */
export function pauseBetween(a, b) {
  if (!b) return 0;
  if (!a) return b.over ? 0 : T.DEAL;
  const ended = b.handNo !== a.handNo || (b.over && !a.over);
  if (!ended) return 0;
  const showdown = b.handNo !== a.handNo ? !!b.last?.showdown : !!b.showdown;
  const to = b.handNo !== a.handNo ? b.last?.boardLen ?? a.boardLen : b.boardLen;
  const streets = showdown ? streetsBetween(a.boardLen, to) : 0;
  return endDur({ showdown, streets }) + (b.over ? 0 : T.DEAL);
}
