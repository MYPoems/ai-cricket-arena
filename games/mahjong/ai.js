// 麻将内置 AI。只用该座位看得到的信息：自己的手牌、各家牌河、明的副露、定缺、剩余牌数。
// level 1：随机合法（能胡就胡、定缺挑张数最少的一门）；level 2：按向听数和有效牌（进张）打牌效；
// level 3：再加防守——别家可能听牌时少打危险牌（别家缺的那门、已经现过的牌、外面没几张的牌相对安全）。

import { suitOf, rankOf, toCounts, shanten, tileCode } from './rules.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** 定缺：张数最少的一门；level 2 起再看这门里有没有对子、搭子（有的话稍微舍不得） */
export function chooseQue(hand, lv = 2) {
  const c = toCounts(hand);
  const val = [0, 1, 2].map((s) => {
    const x = c.slice(s * 9, s * 9 + 9);
    const n = x.reduce((a, b) => a + b, 0);
    if (lv <= 1) return n;
    let shape = 0;
    for (let r = 0; r < 9; r++) {
      if (x[r] >= 2) shape += 0.6;
      if (r < 8 && x[r] && x[r + 1]) shape += 0.4;
      if (r < 7 && x[r] && x[r + 2]) shape += 0.2;
    }
    return n + shape;
  });
  const min = Math.min(...val);
  const best = [0, 1, 2].filter((s) => val[s] === min);
  return lv <= 1 ? pick(best) : best[0];
}

/** 进张数：13 张（减副露）的手牌，摸到哪些牌能减少向听，外面还剩几张 */
function ukeire(c, melds, que, unseen, sh) {
  let n = 0;
  for (let t = 0; t < 27; t++) {
    if (!unseen[t] || suitOf(t) === que) continue;
    c[t]++;
    if (shanten(c, melds, que) < sh) n += unseen[t];
    c[t]--;
  }
  return n;
}

/** 别家清掉了缺门没有（打过不是缺门的牌、或者碰杠过）：没清掉的人不可能胡 */
function cleared(h, o) {
  const q = h.que[o];
  return h.melds[o].length > 0 || h.river[o].some((r) => suitOf(r.t) !== q);
}

/** 这张牌打出去有多危险（level 3）：各家听牌的可能 × 这张牌被要的可能 */
function danger(ctx, t) {
  const { h, i, unseen, wallLeft } = ctx;
  let d = 0;
  for (let o = 0; o < 4; o++) {
    if (o === i || h.won[o] || !cleared(h, o)) continue;
    if (suitOf(t) === h.que[o]) continue; // 他缺这门，胡不了
    const melds = h.melds[o];
    let threat = Math.min(0.9, 0.12 + 0.18 * melds.length + 0.6 * Math.max(0, 1 - wallLeft / 55));
    // 副露都是同一门、而且就是这张的花色：可能在做清一色
    const open = melds.filter((m) => m.k !== 'an');
    if (open.length >= 2 && open.every((m) => suitOf(m.t) === suitOf(t))) threat = Math.min(1, threat * 1.8);
    const left = unseen[t];
    let f = left === 0 ? 0.05 : 0.3 + 0.2 * left;
    const r = rankOf(t);
    if (r >= 3 && r <= 7) f *= 1.2; else if (r === 1 || r === 9) f *= 0.7;
    if (h.river[o].some((x) => x.t === t)) f *= 0.5; // 他自己打过这张
    d += threat * f;
  }
  return d;
}

/** 选一张打出：最小向听、最多进张；level 3 再扣危险度 */
function bestDiscard(ctx, cands) {
  const { h, i, lv, unseen } = ctx;
  const c = toCounts(h.hands[i]);
  const melds = h.melds[i].length;
  const que = h.que[i];
  // 手里还有缺门：只能打缺门，挑孤张、再挑安全的
  if (cands.every((t) => suitOf(t) === que)) {
    if (lv >= 3) return cands.slice().sort((a, b) => danger(ctx, a) - danger(ctx, b) || c[a] - c[b])[0];
    return cands.slice().sort((a, b) => c[a] - c[b])[0];
  }
  // 往清一色倾斜：某门（含副露）已经很多时，别的门的牌更该打
  const suitN = [0, 1, 2].map((s) => c.slice(s * 9, s * 9 + 9).reduce((a, b) => a + b, 0) + h.melds[i].filter((m) => suitOf(m.t) === s).length * 3);
  const main = suitN.indexOf(Math.max(...suitN));
  const other = [0, 1, 2].filter((s) => s !== main && s !== que).reduce((a, s) => a + suitN[s], 0);
  const qingBonus = suitN[main] >= 11 && other <= 3 ? 400 : suitN[main] >= 9 && other <= 4 ? 160 : 0;
  let best = null;
  for (const t of cands) {
    c[t]--;
    const sh = shanten(c, melds, que);
    const uk = ukeire(c, melds, que, unseen, sh);
    c[t]++;
    const r = rankOf(t);
    let score = -sh * 1000 + uk * 10 + (r === 1 || r === 9 ? 3 : r === 2 || r === 8 ? 1 : 0);
    if (qingBonus && suitOf(t) !== main) score += qingBonus;
    if (lv >= 3) {
      // 血战里点炮通常只赔一家、自摸三家都赔，弃胡不划算：只在牌效差不多时挑安全的，别家很像大牌（清一色）时才多让一些
      const w = sh >= 2 ? 160 : sh === 1 ? 70 : 25;
      score -= danger(ctx, t) * w;
    }
    if (!best || score > best.score) best = { t, score };
  }
  return best.t;
}

/** 轮到自己：自摸 > 杠（不坏牌形时）> 打牌 */
export function chooseTurn(ctx, o) {
  const { h, i, lv } = ctx;
  if (o.zimo) return 'zimo';
  if (lv <= 1) {
    const gangs = [...o.angang.map((t) => `angang:${tileCode(t)}`), ...o.bugang.map((t) => `bugang:${tileCode(t)}`)];
    if (gangs.length && Math.random() < 0.5) return pick(gangs);
    return `discard:${tileCode(pick(o.discard))}`;
  }
  const c = toCounts(h.hands[i]);
  const melds = h.melds[i].length;
  const que = h.que[i];
  for (const t of o.bugang) return `bugang:${tileCode(t)}`;
  if (o.angang.length) {
    // 打一张之后的最好向听 vs 暗杠之后的向听
    let now = 9;
    for (const t of o.discard) { c[t]--; now = Math.min(now, shanten(c, melds, que)); c[t]++; }
    for (const t of o.angang) {
      c[t] -= 4;
      const after = shanten(c, melds + 1, que);
      c[t] += 4;
      if (after <= now) return `angang:${tileCode(t)}`;
    }
  }
  return `discard:${tileCode(bestDiscard(ctx, o.discard))}`;
}

/** 别人打出的牌：能胡就胡；杠、碰要能让牌形变好才要 */
export function chooseReact(ctx, opts) {
  const { h, i, lv } = ctx;
  if (opts.includes('hu')) return 'hu';
  if (lv <= 1) return pick(opts);
  const t = h.react.t;
  const c = toCounts(h.hands[i]);
  const melds = h.melds[i].length;
  const que = h.que[i];
  const now = shanten(c, melds, que);
  if (opts.includes('gang')) {
    c[t] -= 3;
    const after = shanten(c, melds + 1, que);
    c[t] += 3;
    if (after <= now) return 'gang';
  }
  if (opts.includes('peng')) {
    c[t] -= 2;
    let after = 9;
    for (let x = 0; x < 27; x++) {
      if (!c[x]) continue;
      c[x]--;
      after = Math.min(after, shanten(c, melds + 1, que));
      c[x]++;
    }
    c[t] += 2;
    // 碰了能少一向听；level 3 在已经听牌、别家很危险时不乱碰（碰完要多打一张）
    if (after < now) return 'peng';
  }
  return 'pass';
}
