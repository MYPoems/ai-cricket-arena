// 斗地主规则核心：点数、发牌、牌型枚举、比较大小。浏览器和 Node 都能运行（不 import node 模块）。
// 牌只记点数，用 0–14 的整数表示：3 4 5 6 7 8 9 10 J Q K A 2 小王 大王。

export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王'];
export const ACE = 11;
export const TWO = 12;
export const SJ = 13; // 小王
export const BJ = 14; // 大王

export const TYPE_NAMES = {
  single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带二',
  straight: '顺子', pairs: '连对', plane: '飞机', plane1: '飞机带单', plane2: '飞机带对',
  four2: '四带二', four4: '四带两对', bomb: '炸弹', rocket: '王炸',
};
// 同一组牌有多种解释时的优先顺序（越靠前越优先），例如 333444555666 当作 4 连飞机而不是 3 连飞机带三张
const PRIORITY = ['rocket', 'bomb', 'plane', 'pairs', 'straight', 'triple', 'pair', 'single', 'plane2', 'plane1', 'four4', 'four2', 'triple2', 'triple1'];
// 提示词里列合法出牌时的分组顺序
export const GROUP_ORDER = ['single', 'pair', 'triple', 'triple1', 'triple2', 'straight', 'pairs', 'plane', 'plane1', 'plane2', 'four2', 'four4', 'bomb', 'rocket'];

export const rankName = (r) => RANKS[r];
export const sortCards = (cards) => cards.slice().sort((a, b) => a - b);
export const cardsId = (cards) => sortCards(cards).map(rankName).join(' ');
export const namesOf = (cards) => sortCards(cards).map(rankName);

export function toCounts(cards) {
  const c = new Array(15).fill(0);
  for (const r of cards) c[r]++;
  return c;
}
export function fromCounts(c) {
  const out = [];
  for (let r = 0; r < 15; r++) for (let k = 0; k < c[r]; k++) out.push(r);
  return out;
}

// ---------- 带种子的随机与发牌 ----------

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
  for (let r = 0; r <= TWO; r++) for (let k = 0; k < 4; k++) d.push(r);
  d.push(SJ, BJ);
  return d;
}

/** 洗牌并发给 3 家：每家 17 张，剩 3 张底牌 */
export function deal(seed) {
  const rnd = mulberry32(seed);
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return { hands: [sortCards(d.slice(0, 17)), sortCards(d.slice(17, 34)), sortCards(d.slice(34, 51))], bottom: sortCards(d.slice(51)) };
}

// ---------- 解析牌面文字 ----------

const CN_DIGITS = { 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10', 二: '2' };
const TOKEN_RE = /王炸|小王|大王|小鬼|大鬼|10|[2-9]|[JQKA]/g;

/**
 * 把「3 3」「10 J Q K A」「小王 大王」「JQKA10」「三三」之类的文字解析成点数数组。
 * 返回 { cards } 或 { error }。括号里的注释会被忽略。
 */
export function parseCards(text) {
  let t = String(text || '').normalize('NFKC').toUpperCase();
  t = t.replace(/\([^)]*\)|【[^】]*】|「|」|“|”|"|'/g, ' ');
  t = t.replace(/[三四五六七八九十二]/g, (ch) => ` ${CN_DIGITS[ch]} `);
  const cards = [];
  const rest = t.replace(TOKEN_RE, (tok) => {
    if (tok === '王炸') cards.push(SJ, BJ);
    else if (tok === '小王' || tok === '小鬼') cards.push(SJ);
    else if (tok === '大王' || tok === '大鬼') cards.push(BJ);
    else cards.push(RANKS.indexOf(tok));
    return ' ';
  });
  const left = rest.replace(/[\s,，、/+;；。.和与及]/g, '');
  if (left) return { error: `无法识别「${left.slice(0, 10)}」` };
  if (!cards.length) return { error: '没有写出任何牌' };
  return { cards: sortCards(cards) };
}

// ---------- 牌型枚举 ----------

/** 从可用点数里选 n 个「单位」（可重复，每个点数最多用 max 次），返回非递减的点数数组列表 */
function multiChoose(avail, n) {
  const out = [];
  const pick = [];
  const rec = (i, left) => {
    if (left === 0) { out.push(pick.slice()); return; }
    if (i >= avail.length) return;
    const [r, max] = avail[i];
    for (let k = Math.min(max, left); k >= 0; k--) {
      for (let j = 0; j < k; j++) pick.push(r);
      rec(i + 1, left - k);
      for (let j = 0; j < k; j++) pick.pop();
    }
  };
  rec(0, n);
  return out;
}

/** 单张翅膀：不能和主体同点数，不能同时带小王和大王 */
function singleWings(c, exclude, n) {
  const avail = [];
  for (let r = 0; r < 15; r++) if (c[r] && !exclude.includes(r)) avail.push([r, c[r]]);
  return multiChoose(avail, n).filter((w) => !(w.includes(SJ) && w.includes(BJ)));
}
/** 对子翅膀：不能和主体同点数，王不能当对子 */
function pairWings(c, exclude, n) {
  const avail = [];
  for (let r = 0; r <= TWO; r++) if (c[r] >= 2 && !exclude.includes(r)) avail.push([r, Math.floor(c[r] / 2)]);
  return multiChoose(avail, n).map((w) => w.flatMap((r) => [r, r]));
}

const rep = (r, k) => new Array(k).fill(r);
const range = (s, L) => Array.from({ length: L }, (_, i) => s + i);

/**
 * 一手牌能出的全部牌型。每项 { id, type, main, len, cards }：
 * main 为主体最小点数（链类）或主体点数，len 为组数（链类）或 1。
 * 同一组牌可能有多种解释，这里全部列出（id 可能重复）。
 */
export function allCombos(hand) {
  const c = toCounts(hand);
  const out = [];
  const push = (type, main, len, cards) => {
    const s = sortCards(cards);
    out.push({ id: s.map(rankName).join(' '), type, main, len, cards: s });
  };
  for (let r = 0; r < 15; r++) if (c[r]) push('single', r, 1, [r]);
  for (let r = 0; r <= TWO; r++) {
    if (c[r] >= 2) push('pair', r, 1, rep(r, 2));
    if (c[r] >= 3) {
      push('triple', r, 1, rep(r, 3));
      for (const w of singleWings(c, [r], 1)) push('triple1', r, 1, [...rep(r, 3), ...w]);
      for (const w of pairWings(c, [r], 1)) push('triple2', r, 1, [...rep(r, 3), ...w]);
    }
    if (c[r] === 4) {
      push('bomb', r, 1, rep(r, 4));
      for (const w of singleWings(c, [r], 2)) push('four2', r, 1, [...rep(r, 4), ...w]);
      for (const w of pairWings(c, [r], 2)) push('four4', r, 1, [...rep(r, 4), ...w]);
    }
  }
  if (c[SJ] && c[BJ]) push('rocket', BJ, 1, [SJ, BJ]);
  // 链类：最大到 A
  for (let s = 0; s <= ACE; s++) {
    for (let e = s; e <= ACE && c[e] >= 1; e++) {
      const L = e - s + 1;
      if (L >= 5) push('straight', s, L, range(s, L));
    }
    for (let e = s; e <= ACE && c[e] >= 2; e++) {
      const L = e - s + 1;
      if (L >= 3) push('pairs', s, L, range(s, L).flatMap((r) => rep(r, 2)));
    }
    for (let e = s; e <= ACE && c[e] >= 3; e++) {
      const L = e - s + 1;
      if (L < 2) continue;
      const body = range(s, L).flatMap((r) => rep(r, 3));
      push('plane', s, L, body);
      const main = range(s, L);
      if (body.length + L <= 20) for (const w of singleWings(c, main, L)) push('plane1', s, L, [...body, ...w]);
      if (body.length + 2 * L <= 20) for (const w of pairWings(c, main, L)) push('plane2', s, L, [...body, ...w]);
    }
  }
  return out;
}

/** a 能否压过 b（b 为本轮要压的牌型） */
export function beats(a, b) {
  if (!b) return true;
  if (a.type === 'rocket') return true;
  if (b.type === 'rocket') return false;
  if (a.type === 'bomb' && b.type !== 'bomb') return true;
  if (a.type === 'bomb' && b.type === 'bomb') return a.main > b.main;
  if (b.type === 'bomb') return false;
  return a.type === b.type && a.cards.length === b.cards.length && a.len === b.len && a.main > b.main;
}

/** 同一组牌的多种解释里选一个：领出时按优先顺序；跟牌时只考虑能压过上家的 */
export function pickInterpretation(list, last) {
  const ok = last ? list.filter((x) => beats(x, last)) : list;
  if (!ok.length) return null;
  return ok.slice().sort((x, y) => PRIORITY.indexOf(x.type) - PRIORITY.indexOf(y.type) || y.main - x.main)[0];
}

/** 合法出牌：id → 选定的牌型解释（Map 保持枚举顺序） */
export function legalPlays(hand, last) {
  const byId = new Map();
  for (const x of allCombos(hand)) {
    if (!byId.has(x.id)) byId.set(x.id, []);
    byId.get(x.id).push(x);
  }
  const out = new Map();
  for (const [id, list] of byId) {
    const p = pickInterpretation(list, last);
    if (p) out.set(id, p);
  }
  return out;
}

/** 牌组 cards 是否是 hand 的子集 */
export function hasCards(hand, cards) {
  const h = toCounts(hand), c = toCounts(cards);
  return c.every((n, r) => n <= h[r]);
}
export function removeCards(hand, cards) {
  const c = toCounts(hand);
  for (const r of cards) c[r]--;
  return fromCounts(c);
}
/** 不管手里有没有，这组牌本身能构成什么牌型（用于给模型解释错误） */
export function classify(cards) {
  const id = cardsId(cards);
  const list = allCombos(cards).filter((x) => x.id === id);
  return pickInterpretation(list, null);
}

export const comboText = (x) => `${TYPE_NAMES[x.type]} ${cardsId(x.cards)}`;

// ---------- 摆牌顺序 ----------

const desc = (cards) => cards.slice().sort((a, b) => b - a);

/**
 * 一手牌在桌上的摆放顺序：主体在前（三张、飞机机身、四张），带的牌在后，各部分从大到小。
 * 「3 K K K」→「K K K 3」，「3 4 K K K A A A」→「A A A K K K 4 3」，顺子、连对、炸弹整体从大到小。
 * type 为牌型键（triple1、plane2 …）；认不出主体时整手从大到小。
 */
export function showOrder(cards, type) {
  const c = toCounts(cards);
  let body = [];
  if (type === 'triple' || type === 'triple1' || type === 'triple2') {
    const r = c.findIndex((n) => n >= 3);
    if (r >= 0) body = rep(r, 3);
  } else if (type === 'four2' || type === 'four4') {
    const r = c.lastIndexOf(4); // 「3333 5555」按四个 5 带两对 3 算（和比大小时的解释一致）
    if (r >= 0) body = rep(r, 4);
  } else if (type === 'plane' || type === 'plane1' || type === 'plane2') {
    const L = cards.length / (type === 'plane' ? 3 : type === 'plane1' ? 4 : 5);
    // 机身是 L 个连续、各有三张的点数（最大到 A）；有多种取法时取最大的（和比大小时的解释一致）
    for (let s = ACE - L + 1; s >= 0 && !body.length; s--) {
      if (range(s, L).every((r) => c[r] >= 3)) body = range(s, L).flatMap((r) => rep(r, 3));
    }
  }
  if (!body.length) return desc(cards);
  return [...desc(body), ...desc(removeCards(cards, body))];
}

// ---------- 画面特效的时长（服务端停顿与回放停顿共用） ----------

/** 毫秒。fly 出牌飞到桌心；handover 底牌翻开并飞给地主；lift 地主手里新牌抬起再落下；banner 春天 / 反春横幅；card 结算卡升起 */
export const FX = { fly: 460, handover: 1600, lift: 1500, plane: 1200, rocket: 1000, bomb: 1300, sweep: 600, banner: 1500, bannerDelay: 500, card: 600 };

/**
 * 两个局面之间画面特效要演多久（毫秒），没有特效为 0。
 * a、b 是局面摘要：{ landlord: 是否已定地主, plays: 出牌记录条数, last: 最后一条的牌型键（不出为 null）, over, banner: 春天或反春 }
 */
export function fxDuration(a, b) {
  if (!a || !b) return 0;
  let t = 0;
  if (!a.landlord && b.landlord) t = FX.handover + FX.lift * 0.6; // 底牌交接演完、新牌抬起看一会儿
  if (b.plays > a.plays && b.last) {
    if (/^plane/.test(b.last)) t = Math.max(t, FX.fly + FX.plane);
    else if (b.last === 'rocket') t = Math.max(t, FX.fly + FX.rocket + 300);
    else if (b.last === 'bomb') t = Math.max(t, 300 + FX.bomb);
  }
  if (!a.over && b.over && b.banner) t = Math.max(t, FX.bannerDelay + FX.banner + FX.card);
  return t;
}
