// 四川麻将（血战到底）规则核心：牌、牌墙、胡牌判定、向听数、听牌、算番、画面与服务端共用的停顿时长。
// 浏览器和 Node 都能运行（不 import node 模块）。
// 牌用 0–26 的整数：花色 = ⌊i/9⌋（0 万、1 条、2 筒），点数 = i%9 + 1。对外的行动 id 用短码「5m」「3s」「9p」。

export const SUITS = ['万', '条', '筒'];
export const SUIT_CODE = ['m', 's', 'p'];
export const suitOf = (t) => Math.floor(t / 9);
export const rankOf = (t) => (t % 9) + 1;
export const tileName = (t) => `${rankOf(t)}${SUITS[suitOf(t)]}`;
export const tileCode = (t) => `${rankOf(t)}${SUIT_CODE[suitOf(t)]}`;
export const sortTiles = (ts) => ts.slice().sort((a, b) => a - b);

export function fromCode(code) {
  const m = /^([1-9])([msp])$/.exec(String(code || '').trim());
  return m ? SUIT_CODE.indexOf(m[2]) * 9 + Number(m[1]) - 1 : -1;
}

export function toCounts(ts) {
  const c = new Array(27).fill(0);
  for (const t of ts) c[t]++;
  return c;
}

/** 紧凑写法：同花色连写，例如「1123万 456条 99筒」 */
export function compactText(ts) {
  const parts = [];
  for (let s = 0; s < 3; s++) {
    const r = sortTiles(ts).filter((t) => suitOf(t) === s).map(rankOf).join('');
    if (r) parts.push(`${r}${SUITS[s]}`);
  }
  return parts.join(' ') || '（无）';
}

// ---------- 解析牌名 ----------

const CN_RANK = { 一: 1, 幺: 1, 么: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 伍: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const SUIT_WORD = { 万: 0, 萬: 0, w: 0, m: 0, 条: 1, 條: 1, 索: 1, s: 1, t: 1, 筒: 2, 饼: 2, 餅: 2, 同: 2, p: 2, b: 2 };
export const SUIT_RE = '(万|萬|条|條|索|筒|饼|餅|w|m|s|t|p|b)';
const TILE_RE = new RegExp(`([1-9一二两三四五伍六七八九幺么])\\s*${SUIT_RE}`, 'i');
/** 花色的写法：万 / 条 / 筒（也认 萬、條、索、饼） */
export function parseSuit(txt) {
  const m = /(万|萬|条|條|索|筒|饼|餅)/.exec(String(txt || ''));
  return m ? SUIT_WORD[m[1]] : -1;
}
/** 从一段文字里找第一张牌（「5万」「五万」「5m」「七条」） */
export function parseTile(txt) {
  const m = TILE_RE.exec(String(txt || '').normalize('NFKC'));
  if (!m) return -1;
  const r = /\d/.test(m[1]) ? Number(m[1]) : CN_RANK[m[1]];
  const s = SUIT_WORD[m[2].toLowerCase()] ?? SUIT_WORD[m[2]];
  return s === undefined ? -1 : s * 9 + r - 1;
}

// ---------- 带种子的随机与牌墙 ----------

/** mulberry32 一步：传入状态，返回 [随机数 0–1, 新状态] */
export function rngStep(a) {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

export function shuffledWall(rng) {
  const w = [];
  for (let t = 0; t < 27; t++) for (let k = 0; k < 4; k++) w.push(t);
  let a = rng;
  for (let i = w.length - 1; i > 0; i--) {
    const [r, n] = rngStep(a);
    a = n;
    const j = Math.floor(r * (i + 1));
    [w[i], w[j]] = [w[j], w[i]];
  }
  return { wall: w, rng: a };
}

// ---------- 胡牌判定 ----------

/** counts 是否能全部拆成刻子和顺子（会改动 counts，调用方传副本） */
function allMelds(c) {
  for (let i = 0; i < 27; i++) {
    while (c[i] > 0) {
      if (c[i] >= 3) { c[i] -= 3; continue; } // 有三张先取刻子：三组同起点的顺子等于三个刻子，不会漏解
      const r = i % 9;
      if (r > 6 || c[i + 1] < 1 || c[i + 2] < 1) return false;
      c[i]--; c[i + 1]--; c[i + 2]--;
    }
  }
  return true;
}

const hasQue = (c, que) => que !== null && que !== undefined && que >= 0 && c.slice(que * 9, que * 9 + 9).some((x) => x > 0);
const total = (c) => c.reduce((a, b) => a + b, 0);

/** 手牌（含胡的那张）是否成胡：melds 为已副露组数；手里不能有定缺那门牌 */
export function isWin(c, melds = 0, que = null) {
  if (total(c) !== 14 - 3 * melds || hasQue(c, que)) return false;
  if (melds === 0 && c.every((x) => x % 2 === 0)) return true; // 七对（四张相同算两对）
  for (let p = 0; p < 27; p++) {
    if (c[p] < 2) continue;
    const d = c.slice();
    d[p] -= 2;
    if (allMelds(d)) return true;
  }
  return false;
}

/** 听哪些牌：13 张（减副露）的手牌，加上哪张能胡 */
export function waitsOf(c, melds = 0, que = null) {
  if (hasQue(c, que)) return [];
  const out = [];
  for (let t = 0; t < 27; t++) {
    if (que !== null && que >= 0 && suitOf(t) === que) continue;
    if (c[t] >= 4) continue;
    c[t]++;
    if (isWin(c, melds, que)) out.push(t);
    c[t]--;
  }
  return out;
}

// ---------- 向听数（AI 用） ----------

const suitMemo = new Map();
/** 一门花色的所有拆法：返回 best[h][m] = 最多的搭子数（h：这门里有没有取雀头） */
function suitTable(c9) {
  let key = 0;
  for (let i = 0; i < 9; i++) key = key * 5 + c9[i];
  const hit = suitMemo.get(key);
  if (hit) return hit;
  const best = [new Array(5).fill(-1), new Array(5).fill(-1)];
  const c = c9.slice();
  const rec = (i, m, t, h) => {
    while (i < 9 && c[i] === 0) i++;
    if (i >= 9) {
      const mm = Math.min(m, 4);
      if (t > best[h][mm]) best[h][mm] = t;
      return;
    }
    if (c[i] >= 3) { c[i] -= 3; rec(i, m + 1, t, h); c[i] += 3; }
    if (i <= 6 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; rec(i, m + 1, t, h); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!h) rec(i, m, t, 1);
      rec(i, m, t + 1, h);
      c[i] += 2;
    }
    if (i <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; rec(i, m, t + 1, h); c[i]++; c[i + 1]++; }
    if (i <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; rec(i, m, t + 1, h); c[i]++; c[i + 2]++; }
    c[i]--; rec(i, m, t, h); c[i]++; // 这张当孤张
  };
  rec(0, 0, 0, 0);
  suitMemo.set(key, best);
  return best;
}

/** 向听数：-1 已胡，0 听牌。手牌 13 或 14 张（减副露），定缺那门的牌当废牌 */
export function shanten(c, melds = 0, que = null) {
  const tabs = [0, 1, 2].map((s) => (s === que ? [[0, -1, -1, -1, -1], [-1, -1, -1, -1, -1]] : suitTable(c.slice(s * 9, s * 9 + 9))));
  let best = 8;
  // 三门花色组合：枚举每门的 (h, m)
  for (let h0 = 0; h0 < 2; h0++) for (let m0 = 0; m0 < 5; m0++) {
    const t0 = tabs[0][h0][m0];
    if (t0 < 0) continue;
    for (let h1 = 0; h1 < 2 - h0; h1++) for (let m1 = 0; m1 < 5; m1++) {
      const t1 = tabs[1][h1][m1];
      if (t1 < 0) continue;
      for (let h2 = 0; h2 < 2 - h0 - h1; h2++) for (let m2 = 0; m2 < 5; m2++) {
        const t2 = tabs[2][h2][m2];
        if (t2 < 0) continue;
        const m = Math.min(4, m0 + m1 + m2 + melds);
        const t = Math.min(t0 + t1 + t2, 4 - m);
        const s = 8 - 2 * m - t - (h0 + h1 + h2);
        if (s < best) best = s;
      }
    }
  }
  if (melds === 0) {
    let pairs = 0;
    for (let i = 0; i < 27; i++) if (que === null || suitOf(i) !== que) pairs += Math.floor(c[i] / 2);
    best = Math.min(best, 6 - Math.min(7, pairs));
  }
  return best;
}

// ---------- 算番 ----------

export const DEFAULT_CAP = 4;
export const FAN = {
  对对胡: 1, 清一色: 2, 七对: 2, 带幺九: 2, 将对: 2, 金钩钓: 1, 根: 1,
  杠上花: 1, 杠上炮: 1, 抢杠胡: 1, 海底捞月: 1, 海底炮: 1,
};

const isTerminal = (t) => rankOf(t) === 1 || rankOf(t) === 9;

/** 每门花色按「全带幺」拆：4/5/6 不能有；123 的组数 = 2 的张数 = 3 的张数，余下的 1 是刻子或没有；789 同理 */
function yaojiuSuit(c9) {
  if (c9[3] || c9[4] || c9[5]) return false;
  const a = c9[1];
  if (c9[2] !== a || ![0, 3].includes(c9[0] - a)) return false;
  const b = c9[7];
  if (c9[6] !== b || ![0, 3].includes(c9[8] - b)) return false;
  return true;
}

/**
 * 胡牌算番。c：手牌计数（含胡的那张），melds：[{ k, t }]（k 为 peng / ming / an / bu），
 * flags：{ zimo, gangHua, gangPao, qiang, haidi, tian, di }，cap：封顶番数。
 * 返回 { fan（封顶后）, raw, items: [{ name, fan }], title, capped }
 */
export function scoreHand(c, melds = [], flags = {}, cap = DEFAULT_CAP) {
  const all = c.slice();
  for (const m of melds) all[m.t] += m.k === 'peng' ? 3 : 4;
  const items = [];
  const add = (name, fan, n = 1) => { for (let i = 0; i < n; i++) items.push({ name, fan }); };
  const suits = new Set(all.map((x, i) => (x ? suitOf(i) : -1)).filter((s) => s >= 0));
  const qing = suits.size === 1;
  const gen = all.filter((x) => x === 4).length;
  const qidui = melds.length === 0 && c.every((x) => x % 2 === 0);
  let title;
  if (qidui) {
    add('七对', FAN.七对);
    title = gen ? '龙七对' : '七对';
  } else {
    // 对对胡：去掉雀头后全是刻子
    let dd = false, yj = false;
    for (let p = 0; p < 27; p++) {
      if (c[p] < 2) continue;
      const d = c.slice();
      d[p] -= 2;
      if (d.every((x) => x === 0 || x === 3)) dd = true;
      if (isTerminal(p) && melds.every((m) => isTerminal(m.t)) && [0, 1, 2].every((s) => yaojiuSuit(d.slice(s * 9, s * 9 + 9)))) {
        // 还要能拆成面子（yaojiuSuit 已保证）
        yj = true;
      }
    }
    if (dd) {
      add('对对胡', FAN.对对胡);
      const jiang = all.every((x, i) => !x || [2, 5, 8].includes(rankOf(i)));
      if (jiang) add('将对', FAN.将对);
      if (melds.length === 4) add('金钩钓', FAN.金钩钓);
      title = jiang ? '将对' : melds.length === 4 ? '金钩钓' : '对对胡';
    }
    if (yj) { add('带幺九', FAN.带幺九); title = title ? `${title}·带幺九` : '带幺九'; }
    if (!title) title = '平胡';
  }
  if (qing) { add('清一色', FAN.清一色); title = title === '平胡' ? '清一色' : `清${title === '对对胡' ? '对' : title}`; }
  if (gen) add('根', FAN.根, qidui ? gen : gen); // 龙七对的那个四张也按根算（七对 2 + 根 1 = 3 番）
  if (flags.gangHua) add('杠上花', FAN.杠上花);
  if (flags.gangPao) add('杠上炮', FAN.杠上炮);
  if (flags.qiang) add('抢杠胡', FAN.抢杠胡);
  if (flags.haidi) add(flags.zimo ? '海底捞月' : '海底炮', 1);
  let raw = items.reduce((a, b) => a + b.fan, 0);
  if (flags.tian || flags.di) { items.unshift({ name: flags.tian ? '天胡' : '地胡', fan: cap }); raw = Math.max(raw, cap); title = flags.tian ? '天胡' : '地胡'; }
  const fan = Math.min(raw, cap);
  return { fan, raw, items, title, capped: raw > cap };
}

// ---------- 停顿时长（服务端 interlude、画面 pauseAfter 共用） ----------

export const FX = {
  TURN: 900, // 每一步之后至少停一下
  QUE: 1600, // 四家定缺亮出
  CALL: 1100, // 碰、杠：喊字
  HU: 2600, // 胡：喊字、亮出胡的那张
  WALL: 1400, // 牌摸完：流局横幅
  SETTLE: 7000, // 一盘结束：结算卡停留
  DEAL: 1800, // 新一盘开局提示
};

/**
 * 两个局面摘要之间要停多久。摘要：{ handNo, que（定缺完成）, wins, calls, over, end（这一盘怎么结束：'hu' | 'wall'） }。
 * prev 为 null 是开局。
 */
export function pauseBetween(a, b) {
  if (!b) return 0;
  if (!a) return b.over ? 0 : FX.DEAL;
  if (b.handNo !== a.handNo || (b.over && !a.over)) {
    return (b.end === 'wall' ? FX.WALL : FX.HU) + FX.SETTLE + (b.over ? 0 : FX.DEAL);
  }
  if (b.wins > a.wins) return FX.HU;
  if (b.calls > a.calls) return FX.CALL;
  if (b.que && !a.que) return FX.QUE;
  return 0;
}
