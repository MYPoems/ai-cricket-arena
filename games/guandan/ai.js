// 掼蛋内置 AI。
// level 2（规则型）：估算「剩下的牌还要几手出完」，出让手数最少、用牌最小的一手；不拆炸弹、少用逢人配；
//   队友出的牌不压；对手快走完（≤6 张）才动炸弹。
// level 3：再加记牌（算出别家还可能有的牌，判断一手单张/对子/三张是不是「最大」）和残局计算：
//   剩两手且其中一手没人管得住时先出它；对手报牌时领出避开他那个张数；队友报单时领小单张送他走。

import {
  rankOf, isWild, power, allPlays, beats, isBomb, bombValue, hintSort, removeCards, SJ, BJ,
} from './rules.js';

const chainRank = (x) => (x === 1 ? 14 : x);

// ---------- 手数估算 ----------

/** 去掉链类以后的散牌手数：三张可以带走一个对子 */
function looseHands(c) {
  let t = 0, p = 0, s = 0;
  for (let r = 2; r <= 16; r++) {
    if (c[r] === 3) t++;
    else if (c[r] === 2) p++;
    else if (c[r] === 1) s++;
  }
  return t + Math.max(0, p - t) + s;
}

function chainSearch(c, memo, depth = 0) {
  const key = c.join(',');
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let best = looseHands(c);
  if (depth < 6 && best > 1) {
    const tryPat = (s, len, per) => {
      for (let i = 0; i < len; i++) if (c[chainRank(s + i)] < per) return;
      const d = c.slice();
      for (let i = 0; i < len; i++) d[chainRank(s + i)] -= per;
      const v = 1 + chainSearch(d, memo, depth + 1);
      if (v < best) best = v;
    };
    for (let s = 1; s <= 13; s++) tryPat(s, 2, 3); // 钢板
    for (let s = 1; s <= 12; s++) tryPat(s, 3, 2); // 三连对
    for (let s = 1; s <= 10; s++) tryPat(s, 5, 1); // 顺子
  }
  memo.set(key, best);
  return best;
}

/** 一手牌大约还要几手出完（炸弹、四大天王各算一手不拆；逢人配每张约省 0.7 手） */
export function handCount(cards, level, memo = new Map()) {
  const c = new Array(17).fill(0);
  let w = 0;
  for (const x of cards) {
    if (isWild(x, level)) w++;
    else c[rankOf(x)]++;
  }
  let n = 0;
  if (c[15] === 2 && c[16] === 2) { n++; c[15] = 0; c[16] = 0; }
  for (let r = 2; r <= 14; r++) if (c[r] >= 4) { n++; c[r] = 0; }
  return n + chainSearch(c, memo) - 0.7 * w;
}

// ---------- 记牌 ----------

/**
 * 别家手里可能还有的牌（按点数计数，逢人配单独计）：两副牌减去自己手里的、已经出过的、自己知道去向的（进贡还贡）
 */
export function unseenCounts(known, level) {
  const c = new Array(17).fill(0);
  for (let r = 2; r <= 14; r++) c[r] = 8;
  c[15] = 2; c[16] = 2;
  let w = 2;
  c[level] -= 2; // 两张红桃级牌是逢人配，单独计
  for (const x of known) {
    if (isWild(x, level)) w--;
    else c[rankOf(x)]--;
  }
  return { c: c.map((v) => Math.max(0, v)), w: Math.max(0, w) };
}

/** 一手牌有没有可能被别家用同牌型压住（不算炸弹类）；un 为 unseenCounts 的结果 */
export function canBeBeaten(p, un, level) {
  const has = (r, k) => un.c[r] + (r <= 14 ? un.w : 0) >= k;
  const need = { single: 1, pair: 2, triple: 3, fullhouse: 3 }[p.type];
  if (need) {
    for (let r = 2; r <= 16; r++) if (power(r, level) > p.key && (need < 3 || r <= 14) && has(r, need)) return true;
    return false;
  }
  const chain = { straight: [5, 1, 10], tube: [3, 2, 12], plate: [2, 3, 13] }[p.type];
  if (!chain) return true;
  const [len, per, maxS] = chain;
  for (let s = p.key + 1; s <= maxS; s++) {
    let miss = 0;
    for (let i = 0; i < len; i++) miss += Math.max(0, per - un.c[chainRank(s + i)]);
    if (miss <= un.w) return true;
  }
  return false;
}

// ---------- 出牌选择 ----------

const bigOf = (p, level) => p.cards.filter((x) => !isWild(x, level) && power(rankOf(x), level) >= 15).length;

/**
 * 选出牌。ctx: { hand, level, last, lastSeat, seat, partner, counts: {座位: 剩余张数}, active: [仍在出牌的座位],
 *   known: [自己已知去向的牌（出过的、自己的）], ai: 2 | 3, rand }
 * 返回出法（allPlays 的一项）或 null（不出）
 */
export function choosePlay(ctx) {
  const { hand, level, last, seat, partner } = ctx;
  const ai = ctx.ai || 2;
  const plays = allPlays(hand, level).filter((p) => beats(p, last));
  if (!plays.length) return null;
  const finish = plays.find((p) => p.cards.length === hand.length);
  if (finish) return finish;

  const memo = new Map();
  const before = handCount(hand, level, memo);
  const cache = new Map();
  const after = (p) => {
    const k = p.cards.join(',');
    if (!cache.has(k)) cache.set(k, handCount(removeCards(hand, p.cards), level, memo));
    return cache.get(k);
  };
  const opps = (ctx.active || []).filter((s) => s !== seat && s !== partner);
  const oppMin = opps.length ? Math.min(...opps.map((s) => ctx.counts[s])) : Infinity;
  const mateLeft = ctx.active?.includes(partner) ? ctx.counts[partner] : 0;
  const un = ai >= 3 ? unseenCounts(ctx.known || hand, level) : null;

  const score = (p) => {
    let v = after(p) + p.key / 40 + p.wild * 0.9 + (bigOf(p, level) && !isBomb(p) ? 0.35 * bigOf(p, level) : 0);
    if (isBomb(p)) v += 2.5 + bombValue(p) / 2000;
    if (ctx.rand) v += ctx.rand() * 0.5;
    return v;
  };

  if (!last) {
    // 队友只剩一两张：领最小的单张 / 对子送他走（level 3）
    if (ai >= 3 && mateLeft && mateLeft <= 2) {
      const want = mateLeft === 1 ? 'single' : 'pair';
      const small = plays.filter((p) => p.type === want && !p.wild).sort((a, b) => a.key - b.key)[0];
      if (small && small.key <= 10) return small;
    }
    let cands = plays.filter((p) => !isBomb(p));
    if (!cands.length) cands = plays;
    // 残局：剩两手、其中一手没人管得住，先出管不住的那手
    if (ai >= 3) {
      const boss = cands.filter((p) => !canBeBeaten(p, un, level));
      const fin = boss.find((p) => after(p) <= 1.01);
      if (fin) return fin;
    }
    const lead = (p) => {
      let v = score(p);
      // 对手报牌：别领他正好能接的张数（单张、对子），领了也尽量大
      if (oppMin <= 2 && p.n === oppMin && (p.type === 'single' || p.type === 'pair')) v += 3 - p.key / 10;
      if (ai >= 3 && oppMin <= 5 && p.n === oppMin) v += 1.5;
      return v;
    };
    return best(cands, lead);
  }

  // 跟牌：队友出的不压（除非对手马上要走完、队友这手很小，level 3 才考虑）
  if (ctx.lastSeat === partner) {
    if (!(ai >= 3 && oppMin <= 2 && !isBomb(last) && last.key <= 8)) return null;
    const small = plays.filter((p) => !isBomb(p)).sort((a, b) => score(a) - score(b))[0];
    return small && after(small) <= before ? small : null;
  }
  const normal = plays.filter((p) => !isBomb(p));
  if (normal.length) {
    const pick = best(normal, score);
    // level 3：管得住、出完只剩一两手，直接压
    if (ai >= 3 && after(pick) <= 2.01 && !canBeBeaten(pick, un, level)) return pick;
    const big = bigOf(pick, level) + pick.wild;
    // 出了不推进手数、还得动用级牌/王/逢人配、对手离走完还远：先不出
    if (after(pick) > before + 0.2 && big && oppMin > 8) return null;
    if (pick.wild && oppMin > 10 && after(pick) >= before) return null;
    return pick;
  }
  const bombs = plays.filter(isBomb);
  const lastBy = ctx.lastSeat;
  const danger = oppMin <= 6 || (ai >= 3 && ctx.counts[lastBy] <= 10 && !isBomb(last) && last.n >= 5);
  const smallest = bombs.slice().sort((a, b) => bombValue(a) - bombValue(b))[0];
  if (smallest && (danger || after(smallest) <= 1.5)) return smallest;
  return null;
}

function best(list, f) {
  let b = null, bv = Infinity;
  for (const x of list) {
    const v = f(x);
    if (v < bv) { bv = v; b = x; }
  }
  return b;
}

/**
 * 还贡：挑一张点数不超过 10 的牌（没有就最小的一张）。挑「最没用」的：单张优先，不拆对子、炸弹、顺子。
 */
export function chooseBack(hand, level, eligible) {
  const memo = new Map();
  let bestC = eligible[0], bv = Infinity;
  for (const c of eligible) {
    if (isWild(c, level)) continue;
    const v = handCount(removeCards(hand, [c]), level, memo) + power(rankOf(c), level) / 40;
    if (v < bv) { bv = v; bestC = c; }
  }
  return bestC;
}

export { hintSort, SJ, BJ };
