// 掼蛋规则核心：牌的编码、发牌、牌型识别（含逢人配）、比大小、枚举出法、解析牌面文字。浏览器和 Node 都能运行。
//
// 牌用 0–53 的整数：0–51 为 (点数 − 2) × 4 + 花色（花色 0 ♠、1 ♥、2 ♣、3 ♦），52 小王，53 大王。两副牌，每种各两张。
// 点数：2–10，J 11，Q 12，K 13，A 14，小王 15，大王 16。
// 「级牌」是点数等于本盘级数的牌：单出、对子、三张、三带二、炸弹里大于 A、小于小王；在顺子、连对、钢板、同花顺里按本来位置。
// 「逢人配」是红桃级牌（两张）：可以当除大小王以外的任意牌用。

export const SUITS = ['♠', '♥', '♣', '♦'];
export const SUIT_CN = ['黑桃', '红桃', '梅花', '方块'];
export const SJ = 52;
export const BJ = 53;
const RN = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '小王', 16: '大王' };
export const rankName = (r) => RN[r] ?? String(r);

export const rankOf = (c) => (c === SJ ? 15 : c === BJ ? 16 : (c >> 2) + 2);
export const suitOf = (c) => (c >= 52 ? -1 : c & 3);
export const cardOf = (rank, suit) => (rank === 15 ? SJ : rank === 16 ? BJ : (rank - 2) * 4 + suit);
export const isWild = (c, level) => c < 52 && (c & 3) === 1 && rankOf(c) === level;
/** 单张、对子、三张、三带二、炸弹比大小用的「牌力」：级牌 15，小王 16，大王 17，其余就是点数 */
export const power = (r, level) => (r === 15 ? 16 : r === 16 ? 17 : r === level ? 15 : r);
/** 牌名 → 牌（「♠5」「♥10」「小王」）；认不出返回 −1 */
export function cardFromName(name) {
  if (name === '小王') return SJ;
  if (name === '大王') return BJ;
  const su = SUITS.indexOf(String(name)[0]);
  const r = { J: 11, Q: 12, K: 13, A: 14 }[String(name).slice(1)] ?? Number(String(name).slice(1));
  return su >= 0 && r >= 2 && r <= 14 ? cardOf(r, su) : -1;
}
export const cardName = (c) => (c === SJ ? '小王' : c === BJ ? '大王' : SUITS[c & 3] + RN[rankOf(c)]);
/** 连牌里的点数：1 表示当 1 用的 A */
const chainRank = (x) => (x === 1 ? 14 : x);

export const TYPE_NAMES = {
  single: '单张', pair: '对子', triple: '三张', fullhouse: '三带二', straight: '顺子', tube: '三连对', plate: '钢板',
  bomb: '炸弹', sflush: '同花顺', kings: '四大天王',
};
const TYPE_KEYS = Object.keys(TYPE_NAMES);
const CHAIN_TYPES = new Set(['straight', 'tube', 'plate', 'sflush']);

// ---------- 随机与发牌 ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fullDeck() {
  const d = [];
  for (let k = 0; k < 2; k++) for (let c = 0; c < 54; c++) d.push(c);
  return d;
}

/** 洗两副牌发给 4 家，每家 27 张 */
export function deal(seed) {
  const rnd = mulberry32(seed);
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return [0, 1, 2, 3].map((k) => d.slice(k * 27, k * 27 + 27).sort((a, b) => a - b));
}

/** 手牌按「牌力从大到小、同点数按花色」排（画面、提示词用） */
export function sortByPower(cards, level) {
  return cards.slice().sort((a, b) => power(rankOf(b), level) - power(rankOf(a), level) || (isWild(a, level) ? 1 : 0) - (isWild(b, level) ? 1 : 0) || suitOf(a) - suitOf(b));
}
/** 行动 id 里的顺序：牌力从小到大 */
export function sortAsc(cards, level) {
  return cards.slice().sort((a, b) => power(rankOf(a), level) - power(rankOf(b), level) || suitOf(a) - suitOf(b) || a - b);
}

export function hasCards(hand, cards) {
  const h = new Array(54).fill(0);
  for (const c of hand) h[c]++;
  for (const c of cards) if (--h[c] < 0) return false;
  return true;
}
export function removeCards(hand, cards) {
  const out = hand.slice();
  for (const c of cards) {
    const i = out.indexOf(c);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}

// ---------- 牌型识别 ----------

/**
 * 一组牌能当作哪些牌型（逢人配可能带来多种组法）。返回 [{ type, key, n }]：
 * key 为比大小用的值：单/对/三/三带二/炸弹是牌力（三带二看三张），顺子、三连对、钢板、同花顺是最小一组的点数（A 当 1 时为 1）。
 */
export function interpret(cards, level) {
  const n = cards.length;
  const cnt = new Array(17).fill(0);
  let w = 0;
  const suits = new Set();
  for (const c of cards) {
    if (isWild(c, level)) { w++; continue; }
    cnt[rankOf(c)]++;
    suits.add(suitOf(c));
  }
  const nat = n - w;
  const jokers = cnt[15] + cnt[16];
  const out = [];
  const seen = new Set();
  const push = (type, key) => {
    const id = `${type}:${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ type, key, n });
  };
  // 全是同一个非王点数（逢人配补齐）；没有天然牌时就是级牌本身
  let same = null;
  if (!jokers) {
    const rs = [];
    for (let r = 2; r <= 14; r++) if (cnt[r]) rs.push(r);
    if (rs.length <= 1) same = rs.length ? rs[0] : level;
  }
  if (n === 1) push('single', power(cards[0] !== undefined && isWild(cards[0], level) ? level : rankOf(cards[0]), level));
  if (n === 2) {
    if (same !== null) push('pair', power(same, level));
    else if (cnt[15] === 2) push('pair', 16);
    else if (cnt[16] === 2) push('pair', 17);
  }
  if (n === 3 && same !== null) push('triple', power(same, level));
  if (n >= 4 && n <= 10 && same !== null) push('bomb', power(same, level));
  if (n === 4 && cnt[15] === 2 && cnt[16] === 2) push('kings', 0);
  if (n === 5) {
    // 三带二：三张 t + 一对 p（对子可以是一对小王或一对大王，逢人配不能当王）
    for (let t = 2; t <= 14; t++) {
      const needT = 3 - cnt[t];
      if (needT < 0) continue;
      for (let p = 2; p <= 16; p++) {
        if (p === t) continue;
        const needP = 2 - cnt[p];
        if (needP < 0 || (p >= 15 && needP > 0)) continue;
        if (cnt[t] + cnt[p] !== nat || needT + needP !== w) continue;
        push('fullhouse', power(t, level));
      }
    }
    if (!jokers) {
      for (let s = 1; s <= 10; s++) {
        let sum = 0, ok = true;
        for (let i = 0; i < 5; i++) { const k = cnt[chainRank(s + i)]; if (k > 1) { ok = false; break; } sum += k; }
        if (!ok || sum !== nat) continue;
        push('straight', s);
        if (suits.size <= 1) push('sflush', s);
      }
    }
  }
  if (n === 6 && !jokers) {
    for (let s = 1; s <= 12; s++) {
      let sum = 0, ok = true;
      for (let i = 0; i < 3; i++) { const k = cnt[chainRank(s + i)]; if (k > 2) { ok = false; break; } sum += k; }
      if (ok && sum === nat) push('tube', s);
    }
    for (let s = 1; s <= 13; s++) {
      let sum = 0, ok = true;
      for (let i = 0; i < 2; i++) { const k = cnt[chainRank(s + i)]; if (k > 3) { ok = false; break; } sum += k; }
      if (ok && sum === nat) push('plate', s);
    }
  }
  return out;
}

/** 炸弹类的大小：四大天王 > 6 张及以上炸弹（先比张数）> 同花顺 > 5 张炸弹 > 4 张炸弹；不是炸弹类返回 −1 */
export function bombValue(x) {
  if (!x) return -1;
  if (x.type === 'kings') return 100000;
  if (x.type === 'sflush') return 550 + x.key;
  if (x.type === 'bomb') return x.n * 100 + x.key; // 5 张炸弹最大 515 < 同花顺 551–560 < 6 张炸弹 602 起
  return -1;
}
export const isBomb = (x) => bombValue(x) >= 0;

/** a 能否压过 b（b 为本轮要压的那一手；没有 b 表示领出） */
export function beats(a, b) {
  if (!b) return true;
  const va = bombValue(a), vb = bombValue(b);
  if (va >= 0) return vb < 0 || va > vb;
  if (vb >= 0) return false;
  return a.type === b.type && a.key > b.key;
}

/** 牌型的强弱值（只用来在同一组牌的几种组法里挑一个） */
const strength = (x) => (isBomb(x) ? 1e6 + bombValue(x) : x.key);

/**
 * 同一组牌有几种组法时挑一种：跟牌时挑能压过上家的最小组法；领出时挑最强的组法。
 * code 指定了组法（「fullhouse:6」）时只认它。
 */
export function pickInterp(list, last, code = null) {
  let ok = last ? list.filter((x) => beats(x, last)) : list;
  if (code) ok = ok.filter((x) => codeOf(x) === code);
  if (!ok.length) return null;
  return ok.slice().sort((x, y) => (last ? strength(x) - strength(y) : strength(y) - strength(x)))[0];
}

export const codeOf = (x) => (x.type === 'bomb' ? `bomb${x.n}:${x.key}` : `${x.type}:${x.key}`);

/** 牌型的中文：「三带二」「6 张炸弹」「同花顺」 */
export function typeText(x) {
  if (x.type === 'bomb') return `${x.n} 张炸弹`;
  return TYPE_NAMES[x.type];
}

/** 牌型的大小说明：「三带二（三张 8）」「顺子 10-A」 */
export function keyText(x, level) {
  const pr = (p) => (p === 15 ? rankName(level) : p === 16 ? '小王' : p === 17 ? '大王' : rankName(p));
  if (x.type === 'kings') return '';
  if (x.type === 'straight' || x.type === 'sflush') return `${x.key === 1 ? 'A' : rankName(x.key)}-${rankName(chainRank(x.key + 4))}`;
  if (x.type === 'tube') return `${x.key === 1 ? 'A' : rankName(x.key)}${rankName(chainRank(x.key + 1))}${rankName(chainRank(x.key + 2))}`;
  if (x.type === 'plate') return `${x.key === 1 ? 'A' : rankName(x.key)}${rankName(chainRank(x.key + 1))}`;
  return pr(x.key);
}

// ---------- 摆牌：主体在前，逢人配放在它代替的位置 ----------

/**
 * 一手牌在桌上的顺序。返回 [{ c, as }]：as 为逢人配代替的点数（不是逢人配为 0）。
 * 链类按点数从小到大（A 当 1 时放最前）；三带二三张在前；其余同点数一起，逢人配放最后。
 */
export function layout(cards, combo, level) {
  const wild = cards.filter((c) => isWild(c, level));
  const nat = cards.filter((c) => !isWild(c, level));
  const byRank = (r) => nat.filter((c) => rankOf(c) === r).sort((a, b) => suitOf(a) - suitOf(b));
  const out = [];
  let wi = 0;
  const fill = (r, k) => {
    const have = byRank(r);
    for (const c of have.slice(0, k)) out.push({ c, as: 0 });
    for (let i = have.length; i < k && wi < wild.length; i++) out.push({ c: wild[wi++], as: r });
  };
  if (!combo) return sortByPower(cards, level).map((c) => ({ c, as: 0 }));
  const t = combo.type;
  if (CHAIN_TYPES.has(t)) {
    const per = t === 'tube' ? 2 : t === 'plate' ? 3 : 1;
    const len = t === 'tube' ? 3 : t === 'plate' ? 2 : 5;
    for (let i = 0; i < len; i++) fill(chainRank(combo.key + i), per);
  } else if (t === 'fullhouse') {
    const tr = rankFromPower(combo.key, level);
    fill(tr, 3);
    const rest = nat.filter((c) => rankOf(c) !== tr);
    if (rest.length) fill(rankOf(rest[0]), 2);
  } else if (t === 'kings') {
    return [SJ, SJ, BJ, BJ].map((c) => ({ c, as: 0 }));
  } else {
    const r = rankFromPower(combo.key, level);
    for (const c of sortByPower(nat, level)) out.push({ c, as: 0 });
    for (const c of wild) out.push({ c, as: r === level ? 0 : r });
    return out;
  }
  // 万一没摆完（不应发生）：剩下的放最后
  const used = out.map((x) => x.c);
  for (const c of removeCards(cards, used)) out.push({ c, as: 0 });
  return out;
}
const rankFromPower = (p, level) => (p === 15 ? level : p === 16 ? 15 : p === 17 ? 16 : p);

// ---------- 枚举一手牌的全部出法 ----------

/**
 * 手里所有能出的牌型（每种「牌型 + 大小」给出一种具体的牌：尽量少用逢人配、不拆别的同点数）。
 * 返回 [{ type, key, n, cards, wild: 用了几张逢人配 }]
 */
export function allPlays(hand, level) {
  const by = Array.from({ length: 17 }, () => []);
  const wild = [];
  for (const c of hand) {
    if (isWild(c, level)) wild.push(c);
    else by[rankOf(c)].push(c);
  }
  // 同点数里的花色顺序：先出张数多的花色（留下单张花色给同花顺的可能性小，这里只求确定）
  for (const list of by) list.sort((a, b) => suitOf(a) - suitOf(b));
  const W = wild.length;
  const out = [];
  const take = (r, k) => by[r].slice(0, k);
  const add = (type, key, cards, u) => out.push({ type, key, n: cards.length + u, cards: [...cards, ...wild.slice(0, u)], wild: u });
  const canBase = (r) => by[r].length > 0 || r === level; // 纯逢人配只当级牌用

  for (let r = 2; r <= 16; r++) if (by[r].length) add('single', power(r, level), take(r, 1), 0);
  if (W && !by[level].length) add('single', 15, [], 1);
  for (let r = 2; r <= 14; r++) {
    if (!canBase(r)) continue;
    const have = by[r].length;
    for (const k of [2, 3]) if (have + W >= k) { const u = Math.max(0, k - have); add(k === 2 ? 'pair' : 'triple', power(r, level), take(r, k - u), u); }
    for (let s = 4; s <= have + W && s <= 10; s++) { const u = Math.max(0, s - have); add('bomb', power(r, level), take(r, s - u), u); }
  }
  for (const r of [15, 16]) if (by[r].length >= 2) add('pair', power(r, level), take(r, 2), 0);
  if (by[15].length >= 2 && by[16].length >= 2) add('kings', 0, [...take(15, 2), ...take(16, 2)], 0);
  // 三带二
  for (let t = 2; t <= 14; t++) {
    if (!canBase(t)) continue;
    const ht = by[t].length;
    if (ht + W < 3) continue;
    const ut = Math.max(0, 3 - ht);
    for (let p = 2; p <= 16; p++) {
      if (p === t) continue;
      const hp = by[p].length;
      if (p >= 15) { if (hp >= 2) add('fullhouse', power(t, level), [...take(t, 3 - ut), ...take(p, 2)], ut); continue; }
      if (!hp) continue;
      const up = Math.max(0, 2 - hp);
      if (ut + up > W) continue;
      add('fullhouse', power(t, level), [...take(t, 3 - ut), ...take(p, 2 - up)], ut + up);
    }
  }
  // 链类
  const chain = (type, starts, len, per) => {
    for (let s = 1; s <= starts; s++) {
      let u = 0;
      const cs = [];
      for (let i = 0; i < len; i++) {
        const r = chainRank(s + i);
        const have = Math.min(per, by[r].length);
        u += per - have;
        cs.push(...take(r, have));
      }
      if (u <= W) add(type, s, cs, u);
    }
  };
  chain('straight', 10, 5, 1);
  chain('tube', 12, 3, 2);
  chain('plate', 13, 2, 3);
  // 同花顺：同一花色
  for (let su = 0; su < 4; su++) {
    for (let s = 1; s <= 10; s++) {
      let u = 0;
      const cs = [];
      for (let i = 0; i < 5; i++) {
        const c = cardOf(chainRank(s + i), su);
        if (!isWild(c, level) && hand.includes(c)) cs.push(c);
        else u++;
      }
      if (u <= W && u < 5) add('sflush', s, cs, u);
    }
  }
  return out;
}

/** 能压过 last 的全部出法 */
export function legalPlays(hand, level, last) {
  return allPlays(hand, level).filter((p) => beats(p, last));
}

const LEAD_ORDER = ['single', 'pair', 'triple', 'fullhouse', 'tube', 'plate', 'straight', 'bomb', 'sflush', 'kings'];

/** 拆了几个同点数的组（出这手后那个点数还剩牌） */
function breaks(p, hand, level) {
  const left = new Array(17).fill(0), used = new Array(17).fill(0);
  for (const c of hand) if (!isWild(c, level)) left[rankOf(c)]++;
  for (const c of p.cards) if (!isWild(c, level)) used[rankOf(c)]++;
  let b = 0;
  for (let r = 2; r <= 16; r++) if (used[r] && left[r] > used[r]) b += left[r] - used[r] >= 4 ? 3 : 1; // 拆炸弹罚得重
  return b;
}

/**
 * 「提示」顺序：跟牌时先普通牌型（少拆牌、少用逢人配、小的先），炸弹类最后（小的先）；
 * 领出时按牌型 单 → 对 → 三张 → 三带二 → 三连对 → 钢板 → 顺子 → 炸弹类，同牌型里少拆、小的先。
 */
export function hintSort(plays, hand, level, leading) {
  return plays.map((p) => ({ p, b: breaks(p, hand, level), bv: bombValue(p), o: LEAD_ORDER.indexOf(p.type) }))
    .sort((x, y) => (x.bv >= 0) - (y.bv >= 0) || (x.bv >= 0 && y.bv >= 0 ? x.bv - y.bv : 0)
      || (leading ? x.o - y.o : 0) || x.p.wild - y.p.wild || x.b - y.b || x.p.key - y.p.key || x.p.n - y.p.n)
    .map((x) => x.p);
}

// ---------- 文字 ↔ 牌 ----------

/** 行动 id：牌（牌力从小到大，空格分隔）+「=组法」，例如「♠5 ♣5 ♦5 ♠8 ♥7=fullhouse:5」 */
export function playId(cards, combo, level) {
  return `${sortAsc(cards, level).map(cardName).join(' ')}=${codeOf(combo)}`;
}

/** 给人看的一手牌：「三带二 5 5 5 8 8（♥7 配 8）」；同花顺带花色 */
export function playText(cards, combo, level) {
  const lay = layout(cards, combo, level);
  const show = lay.map(({ c, as }) => (as ? rankName(as) : rankName(rankOf(c))));
  const wilds = lay.filter((x) => x.as).map((x) => `♥${rankName(level)}当${rankName(x.as)}`);
  const suit = combo.type === 'sflush' ? SUITS[suitOf(lay.find((x) => !x.as && x.c < 52)?.c ?? 0)] : '';
  return `${typeText(combo)} ${suit}${show.join(' ')}${wilds.length ? `（${wilds.join('、')}）` : ''}`;
}

const SUIT_WORDS = { 黑桃: 0, '♠': 0, '♤': 0, S: 0, 红桃: 1, 红心: 1, '♥': 1, '♡': 1, H: 1, 梅花: 2, 草花: 2, '♣': 2, '♧': 2, C: 2, 方块: 3, 方片: 3, 方板: 3, '♦': 3, '♢': 3, D: 3 };
const RANK_WORDS = { J: 11, Q: 12, K: 13, A: 14, 10: 10 };
const CN_DIGITS = { 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };
const TOKEN_RE = /(大王|小王|大鬼|小鬼|逢人配|百搭|配牌|红[桃心]级牌|配)|(黑桃|红桃|红心|梅花|草花|方块|方片|方板|[♠♤♥♡♣♧♦♢]|[SHCD](?=\s*(?:10|[2-9JQKA])))?\s*(10|[2-9]|[JQKA])/g;

/**
 * 把「5 5 5 8 8」「红桃7 黑桃8」「♠10 ♠J ♠Q ♠K ♠A」「逢人配」之类解析成牌的写法。
 * 返回 { tokens: [{ rank, suit | null } | { wild: true }] } 或 { error }。括号里的注释、牌型名称会被忽略。
 */
export function parseTokens(text) {
  let t = String(text || '').normalize('NFKC').toUpperCase();
  t = t.replace(/\([^)]*\)|【[^】]*】|\[[^\]]*\]|「|」|“|”|"|'/g, ' ');
  t = t.replace(/四大天王|天王炸/g, ' 小王 小王 大王 大王 ');
  t = t.replace(/三带二|三带一对|三连对|连对|钢板|木板|飞机|同花顺|顺子|炸弹|单张|单牌|对子|三张|三条|一对|三个|四个|五个|张/g, ' ');
  t = t.replace(/[二两三四五六七八九十]/g, (ch) => ` ${CN_DIGITS[ch]} `);
  const tokens = [];
  const rest = t.replace(TOKEN_RE, (m, special, suit, rank) => {
    if (special) {
      if (special === '大王' || special === '大鬼') tokens.push({ rank: 16, suit: null });
      else if (special === '小王' || special === '小鬼') tokens.push({ rank: 15, suit: null });
      else tokens.push({ wild: true });
      return ' ';
    }
    const r = RANK_WORDS[rank] ?? Number(rank);
    tokens.push({ rank: r, suit: suit ? SUIT_WORDS[suit] : null });
    return ' ';
  });
  const left = rest.replace(/[\s,，、/+;；。.:：和与及—\-~～]/g, '');
  if (left) return { error: `无法识别「${left.slice(0, 10)}」` };
  if (!tokens.length) return { error: '没有写出任何牌' };
  return { tokens };
}

/**
 * 把牌的写法落到手里具体的牌上。只写点数的按花色 ♠♣♦♥ 的顺序挑，不够时用逢人配补；
 * 全是只写点数的 5 张不同点数时，另外试试凑成同花顺（跟牌要压炸弹时用得上）。
 * 返回 { options: [牌数组, ...] } 或 { error }
 */
export function resolveTokens(tokens, hand, level) {
  const pool = hand.slice();
  const takeCard = (c) => { const i = pool.indexOf(c); if (i < 0) return false; pool.splice(i, 1); return true; };
  const picked = [];
  // 先拿写明花色的、写明逢人配的
  for (const tk of tokens) {
    if (tk.wild) {
      const c = cardOf(level, 1);
      if (!takeCard(c)) return { error: `你手里没有逢人配（${cardName(c)}）了` };
      picked.push(c);
    } else if (tk.suit !== null || tk.rank >= 15) {
      const c = tk.rank >= 15 ? cardOf(tk.rank, 0) : cardOf(tk.rank, tk.suit);
      if (!takeCard(c)) return { error: `你手里没有${tk.rank >= 15 ? '更多的' : ''}${cardName(c)}` };
      picked.push(c);
    }
  }
  const bare = tokens.filter((tk) => !tk.wild && tk.suit === null && tk.rank < 15);
  const base = pool.slice();
  const fillBare = (order) => {
    const p = base.slice();
    const got = [];
    for (const tk of bare) {
      let c = -1;
      for (const su of order) {
        const x = cardOf(tk.rank, su);
        if (isWild(x, level)) continue;
        const i = p.indexOf(x);
        if (i >= 0) { c = x; p.splice(i, 1); break; }
      }
      if (c < 0) {
        const wi = p.indexOf(cardOf(level, 1));
        if (wi < 0) return { error: `你手里的 ${rankName(tk.rank)} 不够（写了 ${bare.filter((b) => b.rank === tk.rank).length} 张）` };
        c = p[wi];
        p.splice(wi, 1);
      }
      got.push(c);
    }
    return { cards: [...picked, ...got] };
  };
  const first = fillBare([0, 2, 3, 1]);
  if (first.error) return first;
  const options = [first.cards];
  if (!picked.length && bare.length === 5 && new Set(bare.map((b) => b.rank)).size === 5) {
    for (let su = 0; su < 4; su++) {
      const r = fillBare([su]);
      if (!r.error) options.push(r.cards);
    }
  }
  return { options };
}

/**
 * 解析一手出牌的文字（或行动 id），落到具体牌和组法上。
 * 返回 { cards, combo } 或 { error }。跟牌时多种组法取能压过上家的最小组法，领出时取最强的组法。
 */
export function resolvePlay(text, hand, level, last) {
  const raw = String(text || '').trim();
  const eq = raw.lastIndexOf('=');
  const code = eq >= 0 && /^(?:bomb\d+|[a-z]+):\d+$/.test(raw.slice(eq + 1).trim()) ? raw.slice(eq + 1).trim() : null;
  const body = code ? raw.slice(0, eq) : raw;
  const tk = parseTokens(body);
  if (tk.error) return { error: tk.error };
  const rs = resolveTokens(tk.tokens, hand, level);
  if (rs.error) return { error: rs.error };
  let bestPick = null, anyKind = null;
  for (const cards of rs.options) {
    const list = interpret(cards, level);
    if (list.length && !anyKind) anyKind = { cards, combo: pickInterp(list, null, code) || list[0] };
    const p = pickInterp(list, last, code);
    if (!p) continue;
    if (!bestPick) { bestPick = { cards, combo: p }; if (!last) break; continue; }
    if (last && strength(p) < strength(bestPick.combo)) bestPick = { cards, combo: p };
  }
  if (bestPick) return bestPick;
  const names = rs.options[0].map(cardName).join(' ');
  if (!anyKind) return { error: `「${names}」不是合法牌型` };
  if (code && !interpret(anyKind.cards, level).some((x) => codeOf(x) === code)) return { error: `「${names}」不能组成 ${code}` };
  return { error: `「${names}」（${typeText(anyKind.combo)}）压不过上家的 ${typeText(last)} ${keyText(last, level)}：要出同牌型更大的，或者炸弹类，或者不出` };
}

/** 解析一张牌（还贡用） */
export function resolveOne(text, hand, level) {
  const tk = parseTokens(text);
  if (tk.error) return { error: tk.error };
  if (tk.tokens.length !== 1) return { error: '只能写一张牌' };
  const rs = resolveTokens(tk.tokens, hand, level);
  if (rs.error) return { error: rs.error };
  return { card: rs.options[0][0] };
}

// ---------- 画面特效与停顿的时长（服务端停顿与回放共用，毫秒） ----------

export const FX = { fly: 460, settle: 4200, tribute: 2400, deal: 900, bomb: 1200 };

/**
 * 两个局面之间画面要演多久：一盘结束（结算卡）、进贡还贡（牌飞过去）、炸弹。
 * a、b 是摘要 { hand: 第几盘, phase, plays: 本盘出牌条数, bomb: 最后一手是不是炸弹类, over }
 */
export function fxDuration(a, b) {
  if (!b) return 0;
  if (!a) return FX.deal;
  let t = 0;
  if (b.hand > a.hand || (b.over && !a.over)) t = FX.settle;
  if (a.phase === 'back' && b.phase === 'play') t = Math.max(t, FX.tribute);
  if (b.hand === a.hand && b.plays > a.plays && b.bomb) t = Math.max(t, FX.fly + FX.bomb);
  return t;
}

export { TYPE_KEYS };
