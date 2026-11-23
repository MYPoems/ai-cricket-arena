// 德州扑克的牌、牌型评估、胜率模拟。纯 JS，浏览器和 Node 都能运行。
// 牌用 0–51 的整数：rank = c >> 2（0 为 2，12 为 A），suit = c & 3（0♠ 1♥ 2♦ 3♣）。

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const SUIT_SYM = ['♠', '♥', '♦', '♣'];
const RANK_CN = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** 整数 → 两字符代码（'As'、'Th'），给浏览器用 */
export const code = (c) => RANKS[c >> 2] + SUITS[c & 3];
/** 两字符代码 → 整数，不合法返回 -1 */
export function fromCode(s) {
  const r = RANKS.indexOf(String(s)[0]?.toUpperCase());
  const u = SUITS.indexOf(String(s)[1]?.toLowerCase());
  return r < 0 || u < 0 ? -1 : r * 4 + u;
}
/** 整数 → 「A♠」「10♥」 */
export const cardText = (c) => RANK_CN[c >> 2] + SUIT_SYM[c & 3];
export const cardsText = (cs) => cs.map(cardText).join(' ');
export const rankText = (r) => RANK_CN[r];

// ---------- 随机数 ----------

/** mulberry32：返回 [0, 1) 的伪随机数生成器 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 简单的字符串/数字混合哈希，用来给胜率模拟定种子 */
export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ 0x9e37, 16777619) >>> 0;
  }
  return h;
}

export function shuffledDeck(rand) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ---------- 牌型评估 ----------
// 分数 = 牌型 × 16^5 + 依次的比较点数（每个 4 位）。分数越大越强，可以直接比较。
// 牌型：0 高牌 1 一对 2 两对 3 三条 4 顺子 5 同花 6 葫芦 7 四条 8 同花顺

const B = 1048576; // 16^5
const rc = new Int32Array(13);
const sm = new Int32Array(4);
const sc = new Int32Array(4);

const pack = (cat, a = 0, b = 0, c = 0, d = 0, e = 0) => cat * B + a * 65536 + b * 4096 + c * 256 + d * 16 + e;

/** 点数位图里最大的顺子的最高点；A 可以当 1（5 高顺子返回 3） */
function straightHigh(mask) {
  const m = (mask << 1) | ((mask >> 12) & 1);
  for (let hi = 13; hi >= 4; hi--) if (((m >> (hi - 4)) & 31) === 31) return hi - 1;
  return -1;
}

/** 从高到低取 k 个出现过的点数，跳过 ex1、ex2 */
function kickers(k, ex1 = -1, ex2 = -1) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < k; r--) if (rc[r] && r !== ex1 && r !== ex2) out.push(r);
  while (out.length < k) out.push(0);
  return out;
}

/** 5–7 张牌的最好牌型分数 */
export function evaluate(cards) {
  rc.fill(0); sm.fill(0); sc.fill(0);
  let mask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const r = c >> 2, s = c & 3;
    rc[r]++; sm[s] |= 1 << r; sc[s]++; mask |= 1 << r;
  }
  let flush = -1;
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) flush = s;
  if (flush >= 0) {
    const h = straightHigh(sm[flush]);
    if (h >= 0) return pack(8, h);
  }
  let quad = -1, trips = -1, trips2 = -1, p1 = -1, p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = rc[r];
    if (k === 4) quad = r;
    else if (k === 3) { if (trips < 0) trips = r; else if (trips2 < 0) trips2 = r; }
    else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
  }
  if (quad >= 0) return pack(7, quad, kickers(1, quad)[0]);
  if (trips >= 0 && (p1 >= 0 || trips2 >= 0)) return pack(6, trips, Math.max(p1, trips2));
  if (flush >= 0) {
    const top = [];
    for (let r = 12; r >= 0 && top.length < 5; r--) if (sm[flush] & (1 << r)) top.push(r);
    return pack(5, ...top);
  }
  const st = straightHigh(mask);
  if (st >= 0) return pack(4, st);
  if (trips >= 0) return pack(3, trips, ...kickers(2, trips));
  if (p1 >= 0 && p2 >= 0) return pack(2, p1, p2, kickers(1, p1, p2)[0]);
  if (p1 >= 0) return pack(1, p1, ...kickers(3, p1));
  return pack(0, ...kickers(5));
}

export const category = (score) => Math.floor(score / B);
const CAT_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

/** 牌型的中文名，例如「两对 A 和 8」「葫芦 Q 带 5」 */
export function handName(score) {
  const cat = category(score);
  const a = (score >> 16) & 15, b = (score >> 12) & 15;
  const R = rankText;
  switch (cat) {
    case 0: return `高牌 ${R(a)}`;
    case 1: return `一对 ${R(a)}`;
    case 2: return `两对 ${R(a)} 和 ${R(b)}`;
    case 3: return `三条 ${R(a)}`;
    case 4: return `顺子（${R(a)} 高）`;
    case 5: return `同花（${R(a)} 高）`;
    case 6: return `葫芦 ${R(a)} 带 ${R(b)}`;
    case 7: return `四条 ${R(a)}`;
    default: return a === 12 ? '皇家同花顺' : `同花顺（${R(a)} 高）`;
  }
}
export const catName = (score) => CAT_NAMES[category(score)];

/** 7 张里组成最好牌型的 5 张（摊牌展示用） */
export function bestFive(cards) {
  if (cards.length <= 5) return cards.slice();
  let best = -1, pick = null;
  const walk = (start, chosen) => {
    if (chosen.length === 5) {
      const v = evaluate(chosen);
      if (v > best) { best = v; pick = chosen.slice(); }
      return;
    }
    for (let i = start; i <= cards.length - (5 - chosen.length); i++) {
      chosen.push(cards[i]);
      walk(i + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return pick;
}

// ---------- 胜率 ----------

/**
 * 已知所有人底牌时各人的胜率（平分按份额计）。
 * holes：每位未弃牌玩家的两张底牌；dead：其他已知、不会再发出的牌（例如弃牌者的底牌）。
 * 还差 0–1 张公共牌时精确枚举，否则蒙特卡洛 sims 次。
 */
export function equity(holes, board, dead = [], { sims = 400, rand = Math.random } = {}) {
  const k = holes.length;
  const res = new Array(k).fill(0);
  if (k === 0) return res;
  if (k === 1) { res[0] = 1; return res; }
  const used = new Uint8Array(52);
  for (const h of holes) for (const c of h) used[c] = 1;
  for (const c of board) used[c] = 1;
  for (const c of dead) used[c] = 1;
  const deck = [];
  for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
  const need = 5 - board.length;
  const full = board.slice();
  const hand = new Array(7);
  const scores = new Array(k);
  const score = () => {
    let best = -1, cnt = 0;
    for (let i = 0; i < k; i++) {
      hand[0] = holes[i][0]; hand[1] = holes[i][1];
      for (let j = 0; j < 5; j++) hand[2 + j] = full[j];
      const v = evaluate(hand);
      scores[i] = v;
      if (v > best) { best = v; cnt = 1; } else if (v === best) cnt++;
    }
    for (let i = 0; i < k; i++) if (scores[i] === best) res[i] += 1 / cnt;
  };
  let total = 0;
  if (need <= 0) { score(); total = 1; }
  else if (need === 1) {
    for (const c of deck) { full[4] = c; score(); total++; }
  } else {
    for (let t = 0; t < sims; t++) {
      for (let j = 0; j < need; j++) {
        const x = j + Math.floor(rand() * (deck.length - j));
        const tmp = deck[j]; deck[j] = deck[x]; deck[x] = tmp;
        full[board.length + j] = deck[j];
      }
      score();
      total++;
    }
  }
  return res.map((v) => v / total);
}

/** 对 opp 个随机手牌的胜率（内置 AI 用） */
export function equityVsRandom(hole, board, opp, { sims = 150, rand = Math.random } = {}) {
  if (opp <= 0) return 1;
  const used = new Uint8Array(52);
  for (const c of hole) used[c] = 1;
  for (const c of board) used[c] = 1;
  const deck = [];
  for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
  const need = 5 - board.length;
  const draw = need + opp * 2;
  const full = board.slice();
  const mine = new Array(7);
  const theirs = new Array(7);
  let win = 0;
  for (let t = 0; t < sims; t++) {
    for (let j = 0; j < draw; j++) {
      const x = j + Math.floor(rand() * (deck.length - j));
      const tmp = deck[j]; deck[j] = deck[x]; deck[x] = tmp;
    }
    for (let j = 0; j < need; j++) full[board.length + j] = deck[j];
    mine[0] = hole[0]; mine[1] = hole[1];
    for (let j = 0; j < 5; j++) { mine[2 + j] = full[j]; theirs[2 + j] = full[j]; }
    const me = evaluate(mine);
    let best = 0, ties = 0, lost = false;
    for (let o = 0; o < opp; o++) {
      theirs[0] = deck[need + o * 2]; theirs[1] = deck[need + o * 2 + 1];
      const v = evaluate(theirs);
      if (v > me) { lost = true; break; }
      if (v === me) ties++;
      best = Math.max(best, v);
    }
    if (!lost) win += 1 / (ties + 1);
  }
  return win / sims;
}

/** 起手牌 Chen 分（-1 到 20），用于翻牌前分级 */
export function chen(c1, c2) {
  const r1 = c1 >> 2, r2 = c2 >> 2;
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  const base = hi === 12 ? 10 : hi === 11 ? 8 : hi === 10 ? 7 : hi === 9 ? 6 : (hi + 2) / 2;
  if (r1 === r2) return Math.max(5, Math.ceil(base * 2));
  let s = base;
  if ((c1 & 3) === (c2 & 3)) s += 2;
  const gap = hi - lo - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 10) s += 1;
  return Math.ceil(s);
}
