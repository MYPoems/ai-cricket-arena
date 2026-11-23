// 德州每一手开始、结束时的停顿（毫秒）。服务端按它停下来等，牌桌按它演结算和开局提示，回放、录制也按它等，三边对得上。
//
// 一手结束（摊牌）：先把桌上的注收进底池，再按顺序一家一家亮底牌（最后加注的人先亮，没人加注从庄位左边起），
// 然后把没发完的公共牌一条街一条街翻完（大底池全下时转牌、河牌前各多停一下），组成牌型的五张牌抬起、弹出牌型徽章、输家的牌变淡，
// 接着主池、各边池依次推给各自的赢家，最后弹出结算卡停 HOLD_SHOWDOWN。
// 一手结束（其他人弃牌）：收注、底池推给赢家、结算卡停 HOLD_FOLD。
// 新一手：开局提示（第几手、盲注、庄位）停 DEAL，同时发牌。

export const T = {
  REVEAL_AT: 450, // 结算开始后多久亮第一家底牌（先把注收进底池）
  REVEAL_GAP: 500, // 一家一家亮牌的间隔
  CARD_GAP: 120, // 同一家两张底牌相隔
  FLIP: 520, // 翻一张牌
  RUNOUT_GAP: 250, // 亮完牌到翻第一张没发完的公共牌
  STREET: 750, // 每条街的间隔
  BIG_POT: 100, // 底池达到多少个大盲算大底池
  BIG_WAIT: 1000, // 大底池全下：转牌、河牌翻开前各多停
  LIFT: 150, // 翻完到五张牌抬起、牌型徽章弹出
  BADGE: 800, // 徽章弹出后多久开始分池
  PUSH: 600, // 每个池推给赢家
  CARD_AT: 250, // 分完池后多久弹出结算卡
  FOLD_PUSH: 400, // 其他人弃牌：收完注后推池
  HOLD_SHOWDOWN: 2800, // 摊牌：结算卡（亮出的底牌、牌型、输赢）停留
  HOLD_FOLD: 1800, // 其他人弃牌：结算卡停留
  DEAL: 2000, // 新一手：开局提示停留（发牌同时进行）
  TURN: 1500, // 每个人出手后停一下，再轮到下一位
};

/**
 * 一手结束的时刻表（毫秒，相对结算开始）。
 * info：{ showdown, streets（要补翻几条街）, shown（亮牌人数）, pots（分几个池）, big（大底池全下） }
 * 返回 { reveal: 每家亮牌时刻, streetAt: 每条补翻的街, liftAt, push: 每个池开始推的时刻, cardAt: 结算卡, end: 整段结束 }
 */
export function schedule({ showdown = false, streets = 0, shown = 0, pots = 1, big = false } = {}) {
  const n = Math.max(1, pots || 1);
  if (!showdown) {
    const push = [T.FOLD_PUSH];
    const cardAt = T.FOLD_PUSH + T.PUSH + T.CARD_AT;
    return { reveal: [], streetAt: [], liftAt: T.FOLD_PUSH, push, cardAt, end: cardAt + T.HOLD_FOLD };
  }
  const reveal = Array.from({ length: shown }, (_, k) => T.REVEAL_AT + k * T.REVEAL_GAP);
  let at = shown ? reveal[shown - 1] + T.CARD_GAP + T.FLIP : T.REVEAL_AT;
  const streetAt = [];
  if (streets > 0) {
    at += T.RUNOUT_GAP;
    ['flop', 'turn', 'river'].slice(3 - streets).forEach((name, k) => {
      if (k) at += T.STREET;
      if (big && name !== 'flop') at += T.BIG_WAIT;
      streetAt.push(at);
    });
    at += T.STREET;
  }
  const liftAt = at + T.LIFT;
  const push = Array.from({ length: n }, (_, k) => liftAt + T.BADGE + k * T.PUSH);
  const cardAt = liftAt + T.BADGE + n * T.PUSH + T.CARD_AT;
  return { reveal, streetAt, liftAt, push, cardAt, end: cardAt + T.HOLD_SHOWDOWN };
}

/** 结算阶段：结算卡什么时候出现（相对结算开始） */
export function cardAt(info) {
  return schedule(info).cardAt;
}

/** 一手结束的整段时长（不含新一手的开局提示） */
export function endDur(info) {
  return schedule(info).end;
}

/** 从这条街（公共牌张数 from）发到 to 张要翻几条街 */
export function streetsBetween(from, to) {
  return (from < 3 && to >= 3 ? 1 : 0) + (from < 4 && to >= 4 ? 1 : 0) + (from < 5 && to >= 5 ? 1 : 0);
}

/**
 * 一手结束时演出要用的信息。fromLen：结束前那一步的公共牌张数；end：{ showdown, boardLen, shown, pots, pot }；bb：大盲。
 * 补翻转牌、河牌而且底池 ≥ 100 个大盲时算大底池全下。
 */
export function endInfo(fromLen, end, bb) {
  if (!end) return { showdown: false, streets: 0, shown: 0, pots: 1, big: false };
  const showdown = !!end.showdown;
  const streets = showdown ? streetsBetween(fromLen, end.boardLen) : 0;
  return { showdown, streets, shown: showdown ? end.shown || 0 : 0, pots: end.pots || 1, big: showdown && streets > 0 && (end.pot || 0) >= T.BIG_POT * (bb || 1) };
}

/**
 * 两个局面之间要停多久：prev 为 null 表示开局（第一手的开局提示）。
 * 用的是浏览器数据（game.view）里也有的字段，服务端、牌桌、回放算出来一样。
 * a：{ handNo, boardLen, over }；b：{ handNo, over, bb, last: 上一手 | null, done: 这一手（已结束时）| null }，
 * last / done：{ showdown, boardLen, shown, pots, pot }
 */
export function pauseBetween(a, b) {
  if (!b) return 0;
  if (!a) return b.over ? 0 : T.DEAL;
  const newHand = b.handNo !== a.handNo;
  if (!newHand && !(b.over && !a.over)) return 0;
  const end = newHand ? b.last : b.done;
  return endDur(endInfo(a.boardLen, end, b.bb)) + (b.over ? 0 : T.DEAL);
}
