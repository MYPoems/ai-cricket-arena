// 斗地主内置 AI：按手牌强度叫分；出牌时估算「剩下的牌还要几手出完」，选让手数最少、用牌最小的组合。

import { SJ, BJ, TWO, ACE, toCounts, legalPlays } from './rules.js';

const CHAIN = new Set(['straight', 'pairs', 'plane', 'plane1', 'plane2']);

/** 叫分强度：大王 4、小王 3、每张 2 记 2、每个炸弹 4 */
export function bidStrength(hand) {
  const c = toCounts(hand);
  let s = 0;
  if (c[BJ]) s += 4;
  if (c[SJ]) s += 3;
  s += c[TWO] * 2;
  for (let r = 0; r < TWO; r++) if (c[r] === 4) s += 4;
  return s;
}

export function chooseBid(hand, currentMax, { jitter = 0 } = {}) {
  const s = bidStrength(hand) + jitter;
  const want = s >= 9 ? 3 : s >= 6 ? 2 : s >= 4 ? 1 : 0;
  return want > currentMax ? want : 0;
}

// ---------- 手数估算 ----------

/** 去掉链类以后的散牌手数：三张可以各带走一个单张或对子 */
function looseHands(c) {
  let t = 0, p = 0, s = 0;
  for (let r = 0; r < 15; r++) {
    if (c[r] === 3) t++;
    else if (c[r] === 2) p++;
    else if (c[r] === 1) s++;
  }
  // 小王大王都在时已经在外层当王炸算掉了
  return t + Math.max(0, s + p - t);
}

function chainCandidates(c) {
  const out = [];
  const scan = (need, minLen) => {
    for (let s = 0; s <= ACE; s++) {
      let e = s;
      while (e <= ACE && c[e] >= need) e++;
      const max = e - s;
      if (max < minLen) continue;
      out.push([s, minLen, need]);
      if (max > minLen) out.push([s, max, need]);
    }
  };
  scan(3, 2);
  scan(2, 3);
  scan(1, 5);
  return out;
}

/** 估算一组点数计数还要几手出完（炸弹、王炸各算一手，不拆） */
export function handCount(counts, memo = new Map()) {
  const c = counts.slice();
  let n = 0;
  if (c[SJ] && c[BJ]) { n++; c[SJ] = 0; c[BJ] = 0; }
  for (let r = 0; r <= TWO; r++) if (c[r] === 4) { n++; c[r] = 0; }
  return n + chainSearch(c, memo);
}

function chainSearch(c, memo) {
  const key = c.join('');
  if (memo.has(key)) return memo.get(key);
  let best = looseHands(c);
  for (const [s, L, need] of chainCandidates(c)) {
    const d = c.slice();
    for (let r = s; r < s + L; r++) d[r] -= need;
    // 飞机能带走同样组数的单张
    let v = 1 + chainSearch(d, memo);
    if (need === 3) v = Math.max(1, v - Math.min(L, singlesOf(d)));
    if (v < best) best = v;
  }
  memo.set(key, best);
  return best;
}
const singlesOf = (c) => c.reduce((n, k) => n + (k === 1 ? 1 : 0), 0);

// ---------- 出牌选择 ----------

/** 这手牌是否拆了炸弹或王炸 */
function breaksBomb(play, counts) {
  if (play.type === 'bomb' || play.type === 'rocket') return false;
  const pc = toCounts(play.cards);
  for (let r = 0; r <= TWO; r++) if (counts[r] === 4 && pc[r]) return true;
  if (counts[SJ] && counts[BJ] && (pc[SJ] || pc[BJ])) return true;
  return false;
}

const bigCards = (play) => play.cards.filter((r) => r >= TWO).length;

/**
 * 选出牌。ctx: { hand, last, lastSeat, seat, landlord, counts: {seat: 剩余张数}, next, teammate, rand }
 * 返回 combo（含 id）或 null（不出）。
 */
export function choosePlay(ctx) {
  const { hand, last, seat, landlord } = ctx;
  const counts = toCounts(hand);
  const memo = new Map();
  const before = handCount(counts, memo);
  const plays = [...legalPlays(hand, last).values()];
  const after = (p) => {
    const d = counts.slice();
    for (const r of p.cards) d[r]--;
    return handCount(d, memo);
  };
  const enemies = Object.keys(ctx.counts).filter((s) => s !== seat && (seat === landlord || s === landlord));
  const enemyMin = Math.min(...enemies.map((s) => ctx.counts[s]));
  const mate = seat === landlord ? null : Object.keys(ctx.counts).find((s) => s !== seat && s !== landlord);

  // 一手能出完就直接出
  const finish = plays.find((p) => p.cards.length === hand.length);
  if (finish) return finish;

  const score = (p, a) => {
    let v = a + p.main / 100 - p.cards.length * 0.01 + (bigCards(p) && a > 1 ? 0.3 * bigCards(p) : 0);
    if (!last && CHAIN.has(p.type)) v -= 0.2;
    if (!last && p.type === 'single' && enemyMin === 1) v += 2 - p.main / 10; // 对方报单：不领小单张
    if (!last && p.type === 'pair' && enemyMin === 2) v += 1 - p.main / 20;
    if (ctx.rand) v += ctx.rand() * 0.6;
    return v;
  };

  if (!last) {
    // 农民队友只剩一张：领最小的单张给队友走
    if (mate && ctx.counts[mate] === 1 && seat !== landlord) {
      const singles = plays.filter((p) => p.type === 'single').sort((a, b) => a.main - b.main);
      if (singles.length) return singles[0];
    }
    let cands = plays.filter((p) => p.type !== 'bomb' && p.type !== 'rocket' && !breaksBomb(p, counts));
    if (!cands.length) cands = plays;
    return best(cands, (p) => score(p, after(p)));
  }

  // 跟牌：农民不压队友
  if (mate && ctx.lastSeat === mate) return null;

  const normal = plays.filter((p) => p.type !== 'bomb' && p.type !== 'rocket' && !breaksBomb(p, counts));
  if (normal.length) {
    const scored = normal.map((p) => ({ p, a: after(p) }));
    const pick = scored.sort((x, y) => score(x.p, x.a) - score(y.p, y.a))[0];
    // 不推进手数、还要动用 2 或王、对方离出完还远：先不出
    if (pick.a >= before && bigCards(pick.p) && enemyMin > 5) return null;
    return pick.p;
  }
  const danger = enemyMin <= 4;
  const bombs = plays.filter((p) => p.type === 'bomb' || p.type === 'rocket');
  if (bombs.length && (danger || after(bombs[0]) <= 1)) return best(bombs, (p) => p.main + (p.type === 'rocket' ? 100 : 0));
  if (danger) {
    const rest = plays.filter((p) => p.type !== 'bomb' && p.type !== 'rocket');
    if (rest.length) return best(rest, (p) => score(p, after(p)));
  }
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
