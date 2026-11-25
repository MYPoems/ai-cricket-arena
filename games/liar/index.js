// 吹牛左轮（2–4 人）：经典纸牌游戏「吹牛 / Cheat」出暗牌声称点数、下家质疑翻牌，输家对自己扣一次左轮扳机。
// 只借用公开的通用机制，拆解见 docs/拆解-liar.md。实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。
//
// 牌：20 张 = Q、K、A 各 6 张 + 鬼牌 2 张（万能，永远算桌牌）。每轮重新洗牌，每个活着的人发 5 张，翻出本轮桌牌（Q/K/A 之一）。
// 轮到的人二选一：出 1–3 张暗牌（声称都是桌牌），或质疑上一手（每轮第一手不能质疑）。手里没牌的人本轮跳过；
// 只剩一个人有牌时，他必须质疑（所以不会出现谁都没牌的局面）。质疑翻开上一手：有一张不是桌牌也不是鬼牌，出牌的人输，否则质疑的人输。
// 输家扣一次自己的左轮：6 个弹巢 1 发子弹，位置开局由种子定好、整局不重转；扣到子弹那一格出局。
// 结算后重新洗牌发牌开新一轮，输家先出（输家出局则由他的下家）。最后活着的人赢，名次按出局先后。
//
// 行动 id：质疑为「call」。出牌为「p-」加一串由种子、轮次、手数、座位和牌面算出的暗码（例如 p-3k9x0qa）：
// 出牌这一步因此可以照常进公共事件流和记录（谁出了几张、称是什么大家都看得到），牌面却只有服务端解得开。
// 旧记录里的出牌是明文牌面（「Q Q 鬼」，牌面按 Q K A 鬼 排好、空格分隔），apply 仍然接受，这种明文出牌按私密步处理。

const SEATS = ['p1', 'p2', 'p3', 'p4'];
const SEAT_NAMES = { p1: '1 号位', p2: '2 号位', p3: '3 号位', p4: '4 号位' };
const ORDER = ['Q', 'K', 'A', '鬼'];
const TABLES = ['Q', 'K', 'A'];
const JOKER = '鬼';
const CALL = 'call';
const HAND = 5;
const CHAMBERS = 6;
const DECK = [...Array(6).fill('Q'), ...Array(6).fill('K'), ...Array(6).fill('A'), JOKER, JOKER];
const TRUTHS = 8; // 每轮算「真」的牌：6 张桌牌 + 2 张鬼牌
const HISTORY_LINES = 6; // 提示词里列最近几次质疑

/**
 * 揭晓的时刻表（毫秒）。服务端按它停顿（interlude），画面按它演：
 * 质疑横幅 → 一张一张翻开上一手 → 判定（说谎 / 是真的）→ 输家举枪、转轮、屏息 → 扣扳机（咔哒 / 砰）→ 新一轮翻桌牌。
 */
export const T = {
  PLAY: 1300, // 每出一手后停一下：牌滑进牌堆、看清谁出了几张
  CALL: 900, // 「质疑！」横幅
  FLIP: 480, // 翻一张牌
  FLIP_GAP: 300, // 相邻两张牌开始翻的间隔
  VERDICT: 1400, // 判定印章停留
  AIM: 2000, // 举枪、转轮、屏息
  SHOT: 1700, // 扣扳机之后停留
  DEAD: 800, // 中弹出局多停一会儿
  DEAL: 2000, // 新一轮：翻桌牌
};

/** 一次揭晓的时刻表：n 为翻开的张数，dead 为是否中弹 */
export function revealPlan(n, dead) {
  const flipAt = T.CALL;
  const verdictAt = flipAt + Math.max(0, n - 1) * T.FLIP_GAP + T.FLIP + 150;
  const aimAt = verdictAt + T.VERDICT;
  const shotAt = aimAt + T.AIM;
  const end = shotAt + T.SHOT + (dead ? T.DEAD : 0);
  return { flipAt, verdictAt, aimAt, shotAt, end };
}

/**
 * 两个局面之间要停多久（服务端、画面、回放共用）。a / b 为 { challenges: 质疑次数, n: 最近一次翻开的张数, dead, over }；
 * a 为 null 表示开局（第一轮翻桌牌）。
 */
export function pauseBetween(a, b) {
  if (!b) return 0;
  if (!a) return b.over ? 0 : T.DEAL;
  if (b.challenges > a.challenges) return revealPlan(b.n, b.dead).end + (b.over ? 0 : T.DEAL);
  return 0;
}

const seatName = (seat) => SEAT_NAMES[seat] || seat;
const clone = (s) => JSON.parse(JSON.stringify(s));
const isTruth = (card, table) => card === table || card === JOKER;
const sortCards = (cards) => cards.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
const cardsId = (cards) => sortCards(cards).join(' ');
const CODE_RE = /^p-[0-9a-z]+$/;

// ---------- 出牌暗码 ----------

/** 53 位字符串哈希（cyrb53） */
function hash53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * 这一手所有能出的牌面 → 暗码。暗码由种子、轮次、本轮第几手、座位和牌面算出：同一个局面永远一样（能重放），
 * 不知道种子的人（对局进行中浏览器拿不到种子）看不出背后是什么牌；同一手里万一撞码，按顺序加后缀错开。
 */
function playCodes(s, seat) {
  const r = s.round;
  const out = new Map();
  const used = new Set();
  for (const c of legalPlays(handOf(s, seat))) {
    const id = cardsId(c);
    let code = `p-${hash53(`${s.seed}|${r.no}|${r.pile.length}|${seat}|${id}`).toString(36).padStart(7, '0').slice(-7)}`;
    while (used.has(code)) code += 'x';
    used.add(code);
    out.set(id, code);
  }
  return out;
}
/** 暗码 → 牌面（解不开返回 null） */
function decodePlay(s, seat, code) {
  for (const [id, c] of playCodes(s, seat)) if (c === code) return id;
  return null;
}
/** 牌面 → 暗码（不是合法出牌返回 null） */
const encodePlay = (s, seat, id) => playCodes(s, seat).get(id) ?? null;

// ---------- 带种子的随机（mulberry32，状态放在 state.rng 里） ----------

function rand(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(s, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 座位顺序 ----------

const aliveSeats = (s) => s.seats.filter((x) => s.alive[x]);
const handOf = (s, seat) => s.round.hands[seat] || [];

/** from 之后（不含 from）顺时针第一个满足条件的座位 */
function nextSeat(s, from, pred) {
  const n = s.seats.length;
  const i = s.seats.indexOf(from);
  for (let k = 1; k < n; k++) {
    const x = s.seats[(i + k) % n];
    if (pred(x)) return x;
  }
  return null;
}

/** 开新一轮：洗牌，每个活着的人发 5 张，翻桌牌 */
function deal(s, starter) {
  const deck = shuffle(s, DECK);
  const hands = {};
  const order = [];
  const n = s.seats.length;
  const i0 = s.seats.indexOf(starter);
  for (let k = 0; k < n; k++) { const x = s.seats[(i0 + k) % n]; if (s.alive[x]) order.push(x); }
  order.forEach((x, k) => { hands[x] = sortCards(deck.slice(k * HAND, k * HAND + HAND)); });
  const table = TABLES[Math.floor(rand(s) * 3)];
  s.round = { no: (s.round?.no || 0) + 1, table, hands, pile: [], turn: starter, lead: starter };
}

function newState(players, seed) {
  const n = Math.max(2, Math.min(4, Number(players) || 4));
  const s = {
    seed: Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : 0,
    rng: 0,
    seats: SEATS.slice(0, n),
    alive: {}, pulls: {}, bullets: {},
    out: [], // 出局顺序
    round: null,
    log: [], // 全部行动 [{ round, seat, kind: 'play' | 'call', cards }]
    history: [], // 每次质疑的结算（公开）
    winner: null,
  };
  s.rng = (s.seed ^ 0x4c1a2b) >>> 0;
  for (const x of s.seats) {
    s.alive[x] = true;
    s.pulls[x] = 0;
    s.bullets[x] = 1 + Math.floor(rand(s) * CHAMBERS); // 第几次扣扳机会响：只在服务端，任何视角都不给
  }
  deal(s, s.seats[Math.floor(rand(s) * n)]);
  return s;
}

/** 现在轮到的人能不能质疑、是不是只能质疑 */
function callInfo(s, seat) {
  const last = s.round.pile.at(-1) || null;
  const canCall = !!last && last.seat !== seat;
  const others = aliveSeats(s).filter((x) => x !== seat && handOf(s, x).length > 0);
  const mustCall = canCall && (handOf(s, seat).length === 0 || others.length === 0);
  return { last, canCall, mustCall };
}

/** 手里所有不同的 1–3 张组合（按牌面去重） */
function legalPlays(hand) {
  const cnt = ORDER.map((r) => hand.filter((c) => c === r).length);
  const out = [];
  for (let q = 0; q <= cnt[0]; q++) for (let k = 0; k <= cnt[1]; k++) for (let a = 0; a <= cnt[2]; a++) for (let j = 0; j <= cnt[3]; j++) {
    const t = q + k + a + j;
    if (t < 1 || t > 3) continue;
    out.push([...Array(q).fill('Q'), ...Array(k).fill('K'), ...Array(a).fill('A'), ...Array(j).fill(JOKER)]);
  }
  return out.sort((x, y) => x.length - y.length || cardsId(x).localeCompare(cardsId(y)));
}

/** 手里有没有这些牌 */
function hasCards(hand, cards) {
  const h = hand.slice();
  for (const c of cards) {
    const i = h.indexOf(c);
    if (i < 0) return false;
    h.splice(i, 1);
  }
  return true;
}
function removeCards(hand, cards) {
  const h = hand.slice();
  for (const c of cards) h.splice(h.indexOf(c), 1);
  return h;
}

// ---------- 解析牌面 ----------

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 1: 1, 2: 2, 3: 3 };

/** 把一段文字读成牌：「Q Q 鬼」「QQ」「2 张 Q」「Q×2」「Joker」都认。返回 { cards } 或 { error } */
export function parseCards(text) {
  let t = String(text ?? '').normalize('NFKC').toUpperCase();
  t = t.replace(/[（(【][^）)】]*[）)】]/g, ' ').replace(/[[\]]/g, ' '); // 括号里的补充说明不算；方括号只是包着牌
  t = t.replace(/(声称|自称|称|说是|当作|当成|假装|冒充).*$/s, ''); // 「出牌 K，称是 A」：后面说的是声称，不是牌
  t = t.replace(/JOKERS?|鬼牌|万能牌?|小丑|大王|小王/g, '鬼').replace(/皇后|王后/g, 'Q').replace(/国王/g, 'K');
  // 「2 张 Q」「两张Q」→ Q Q；「Q×2」「Q*2」「Qx2」→ Q Q
  t = t.replace(/([1-3一二两三])\s*张\s*(Q|K|A|J|鬼)/g, (_, n, r) => ` ${Array(CN_NUM[n]).fill(r).join(' ')} `);
  t = t.replace(/(Q|K|A|J|鬼)\s*[X×*]\s*([1-3])/g, (_, r, n) => ` ${Array(CN_NUM[n]).fill(r).join(' ')} `);
  t = t.replace(/[A-Z]{2,}/g, (w) => (/^[QKAJ]+$/.test(w) ? w : ' ')); // 「QQ」是牌，「PASS」「OK」这类英文词不是
  t = t.replace(/J/g, '鬼').replace(/王/g, '鬼');
  const cards = [...t.matchAll(/Q|K|A|鬼/g)].map((m) => m[0]);
  if (!cards.length) return { error: '没有认出牌面（牌只有 Q、K、A、鬼）' };
  return { cards: sortCards(cards) };
}

/** 检查一手出牌；合法返回 { action }，否则 { error } */
function checkPlay(s, seat, cards) {
  const hand = handOf(s, seat);
  const info = callInfo(s, seat);
  if (info.mustCall) return { error: hand.length ? '其他人手里都没牌了，你只能质疑上一手' : '你手里没牌了，只能质疑上一手' };
  if (cards.length < 1 || cards.length > 3) return { error: `一次只能出 1–3 张，你写了 ${cards.length} 张` };
  if (!hasCards(hand, cards)) return { error: `你手里没有「${cardsId(cards)}」（你的手牌：${hand.join(' ') || '无'}）` };
  return { action: cardsId(cards) };
}

// ---------- 结算 ----------

function resolveCall(s, seat) {
  const r = s.round;
  const last = r.pile.at(-1);
  const lie = last.cards.some((c) => !isTruth(c, r.table));
  const loser = lie ? last.seat : seat;
  s.pulls[loser] += 1;
  const dead = s.pulls[loser] >= s.bullets[loser];
  if (dead) { s.alive[loser] = false; s.out.push(loser); }
  s.history.push({
    round: r.no, table: r.table, caller: seat, accused: last.seat, cards: last.cards.slice(), lie, loser,
    pull: s.pulls[loser], dead, pile: r.pile.reduce((a, p) => a + p.cards.length, 0), plays: r.pile.length,
  });
  const alive = aliveSeats(s);
  if (alive.length <= 1) {
    s.winner = alive[0] || null;
    s.round = { ...r, turn: null };
    return;
  }
  deal(s, s.alive[loser] ? loser : nextSeat(s, loser, (x) => s.alive[x]));
}

/** 名次：活着的人第 1，之后按出局先后倒排（最后出局的第 2） */
function ranksOf(s) {
  const ranks = {};
  const alive = aliveSeats(s);
  for (const x of alive) ranks[x] = 1;
  [...s.out].reverse().forEach((x, i) => { ranks[x] = alive.length + 1 + i; });
  return ranks;
}

const danger = (pulls) => (pulls >= CHAMBERS ? 1 : 1 / (CHAMBERS - pulls)); // 下一枪中弹的概率
const fracText = (pulls) => (pulls >= CHAMBERS - 1 ? '必中' : `1/${CHAMBERS - pulls}`);

// ---------- 内置 AI ----------

function comb(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
/** 超几何：总数 N 里有 K 张「真」，抽 n 张，至少 k 张真的概率 */
function atLeast(N, K, n, k) {
  N = Math.max(0, Math.round(N)); K = Math.max(0, Math.min(N, Math.round(K))); n = Math.max(0, Math.min(N, n));
  const total = comb(N, n);
  if (!total) return 0;
  let p = 0;
  for (let x = k; x <= Math.min(K, n); x++) p += comb(K, x) * comb(N - K, n - x);
  return Math.min(1, p / total);
}

/** 估计上一手说谎的概率（level 3 额外记住自己这一轮出过的牌，并按别人前几手大概用掉的真牌折算） */
function lieChance(s, seat, level) {
  const r = s.round;
  const last = r.pile.at(-1);
  const hand = handOf(s, seat);
  let U = DECK.length - hand.length; // 自己看不到的牌
  let Tu = TRUTHS - hand.filter((c) => isTruth(c, r.table)).length; // 其中的真牌
  if (level >= 3) {
    for (const p of r.pile.slice(0, -1)) {
      U -= p.cards.length;
      Tu -= p.seat === seat ? p.cards.filter((c) => isTruth(c, r.table)).length : 0.6 * p.cards.length;
    }
  }
  const k = last.cards.length;
  const h = handOf(s, last.seat).length + k; // 出这一手之前他手里有几张
  if (Tu < k - 1e-9) return 1; // 看不到的真牌已经不够他凑出这么多张：一定说谎
  // 他手里凑得出 k 张真牌的概率；凑得出也有一成多的人照样诈唬
  return 1 - atLeast(U, Tu, h, k) * 0.85;
}

/** 下家（下一个还有牌的活人）下一枪的中弹概率：越危险越不敢质疑 */
function nextDanger(s, seat) {
  const nx = nextSeat(s, seat, (x) => s.alive[x] && handOf(s, x).length > 0);
  return nx ? danger(s.pulls[nx]) : 0;
}

function choosePlay(s, seat, level, rnd) {
  const r = s.round;
  const hand = handOf(s, seat);
  const truths = hand.filter((c) => isTruth(c, r.table)).sort((a, b) => (a === JOKER) - (b === JOKER)); // 先出桌牌，鬼牌留后
  const lies = hand.filter((c) => !isTruth(c, r.table));
  if (level <= 1) {
    const plays = legalPlays(hand);
    return cardsId(plays[Math.floor(rnd() * plays.length)]);
  }
  const pickLies = (n) => {
    const a = lies.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
  };
  const nd = level >= 3 ? nextDanger(s, seat) : 0;
  if (truths.length) {
    const n = Math.min(3, truths.length);
    let cards = truths.slice(0, n);
    // level 3 适当诈唬：下家左轮已经很危险（不太敢质疑）、自己假牌又多时，混进一张假牌借真牌的掩护甩掉
    if (level >= 3 && n < 3 && lies.length >= 2 && nd >= 1 / 3 && rnd() < 0.5) cards = [...cards, ...pickLies(1)];
    return cardsId(cards);
  }
  // 没有真牌只能说谎：一般只出一张（张数越多越可疑）；下家危险到一半以上时 level 3 多甩一张
  const n = level >= 3 && lies.length >= 3 && nd >= 1 / 2 ? 2 : 1;
  return cardsId(pickLies(Math.min(n, lies.length)));
}

function chooseMove(s, seat, level, rnd) {
  const info = callInfo(s, seat);
  if (info.mustCall || !handOf(s, seat).length) return CALL;
  if (info.canCall) {
    if (level <= 1) {
      if (rnd() < 0.3) return CALL;
    } else {
      const p = lieChance(s, seat, level);
      let th = 0.5;
      if (level >= 3) {
        // 手里还有真牌时放过他代价很小（自己接着老实出），要很有把握才质疑；手里只剩假牌时放过他就得自己说谎，门槛放低。
        // 自己的左轮越危险越不敢赌，对方的越危险越想让他扣
        const haveTruth = handOf(s, seat).some((c) => isTruth(c, s.round.table));
        th = haveTruth ? 0.8 : 0.4;
        th += 0.3 * (danger(s.pulls[seat]) - 1 / 6) - 0.15 * (danger(s.pulls[info.last.seat]) - 1 / 6);
        if (!handOf(s, info.last.seat).length) th -= 0.05; // 他出完了：这是本轮唯一能抓他的机会
        th += (rnd() - 0.5) * 0.08;
      }
      if (p >= th) return CALL;
    }
  }
  return choosePlay(s, seat, level, rnd);
}

// ---------- 给模型的文字 ----------

const FORMAT_LINES = [
  '【输出格式】用中文简短回答，除最后一行外合计不超过 80 字，严格按五行：',
  '判断：一句话说明局面（谁危险、牌堆里大概有多少假牌）',
  '推断：一句话推断上一手是真是假、别人手里大概有什么',
  '理由：一句话说明为什么这样做',
  '胜率：你估计自己活到最后的概率，写成 0–100 的整数加 %',
  '最后一行：出牌写「行动：出牌 Q Q」（写出你手里真实要打出去的 1–3 张牌，鬼牌写「鬼」，空格分开）；质疑写「行动：质疑」。',
];

function historyText(s) {
  const hs = s.history.slice(-HISTORY_LINES);
  if (!hs.length) return '之前的质疑：还没有。';
  return `之前的质疑（最近 ${hs.length} 次）：\n${hs.map((h) => `  第 ${h.round} 轮（桌牌 ${h.table}）：${seatName(h.caller)}质疑${seatName(h.accused)}，翻开 ${h.cards.join(' ')} → ${h.lie ? '说谎' : '是真的'}；${seatName(h.loser)}扣第 ${h.pull} 枪${h.dead ? '，中弹出局' : '，没响'}`).join('\n')}`;
}

const game = {
  id: 'liar',
  name: '吹牛左轮',
  players: { min: 2, max: 4, default: 4 },
  // turnLimit：真人每步限时（秒），超时由系统代打这一步，连续两次超时转托管
  features: { hidden: true, winbar: false, draw: false, turnLimit: 60 },
  noun: '出牌',

  seats: (n = 4) => SEATS.slice(0, n),
  seatName,

  create({ players = 4, seed = 0 } = {}) {
    return newState(players, seed);
  },

  pending(state) {
    return state.winner || !state.round?.turn ? [] : [state.round.turn];
  },

  /** 每出一手后至少停多久（毫秒） */
  turnPause: T.PLAY,

  /** 质疑揭晓（翻牌 + 扣扳机）和新一轮翻桌牌的停顿，画面按同一份时刻表演 */
  interlude(prev, next) {
    const pick = (s) => s && ({ challenges: s.history.length, n: s.history.at(-1)?.cards.length || 0, dead: !!s.history.at(-1)?.dead, over: !!s.winner });
    return pauseBetween(pick(prev), pick(next));
  },

  actions(state, seat) {
    if (state.winner || seat !== state.round?.turn) return [];
    const info = callInfo(state, seat);
    const out = [];
    if (!info.mustCall) {
      const codes = playCodes(state, seat);
      for (const c of legalPlays(handOf(state, seat))) {
        const id = cardsId(c);
        out.push({ id: codes.get(id), cards: id, label: `出 ${c.length} 张（${id}），称都是 ${state.round.table}` });
      }
    }
    if (info.canCall) out.push({ id: CALL, label: `质疑${seatName(info.last.seat)}` });
    return out;
  },

  apply(state, seat, action) {
    if (state.winner) throw new Error('对局已经结束');
    if (seat !== state.round.turn) throw new Error(`现在不是${seatName(seat)}行动`);
    const s = clone(state);
    const a = String(action ?? '').trim();
    const r = s.round;
    if (a === CALL) {
      const info = callInfo(s, seat);
      if (!info.canCall) throw new Error('本轮还没有人出牌，不能质疑');
      s.log.push({ round: r.no, seat, kind: 'call', accused: info.last.seat });
      resolveCall(s, seat);
      return s;
    }
    // 暗码先解成牌面；旧记录里是明文牌面，照旧认
    const plain = CODE_RE.test(a) ? decodePlay(s, seat, a) : a;
    if (plain === null) throw new Error(callInfo(s, seat).mustCall ? '你只能质疑上一手' : `无法识别的出牌：${a}`);
    const p = parseCards(plain);
    if (p.error) throw new Error(`无法识别的出牌：${a}`);
    const chk = checkPlay(s, seat, p.cards);
    if (chk.error) throw new Error(chk.error);
    r.hands[seat] = removeCards(r.hands[seat], p.cards);
    r.pile.push({ seat, cards: p.cards });
    s.log.push({ round: r.no, seat, kind: 'play', cards: p.cards });
    // 下一位：后面第一个还有牌的活人（找不到只是防御：按规则不会出现谁都没牌的局面）
    r.turn = nextSeat(s, seat, (x) => s.alive[x] && handOf(s, x).length > 0) || nextSeat(s, seat, (x) => s.alive[x]);
    return s;
  },

  /**
   * 出牌用暗码（看不出牌面），和质疑一样是公开的一步：谁出了几张、称是什么大家都看得到。
   * 只有明文牌面的出牌（旧记录、绕过界面直接提交牌面）才是私密步：有真人或自带 agent 在局时不进事件流，只有本人看得到。
   */
  secret(state, seat, action) {
    if (action === null || action === undefined) return false;
    const a = String(action).trim();
    return a !== CALL && !CODE_RE.test(a);
  },

  outcome(state) {
    if (!state.winner) return { over: false };
    const order = state.out.map(seatName).join('、');
    return { over: true, winner: state.winner, ranks: ranksOf(state), reason: `${seatName(state.winner)}活到了最后（出局顺序：${order}）` };
  },

  forfeit(state, seat, reason) {
    const others = aliveSeats(state).filter((x) => x !== seat);
    const ranks = {};
    for (const x of others) ranks[x] = 1;
    [...state.out].reverse().forEach((x, i) => { ranks[x] = others.length + 1 + i; });
    ranks[seat] = state.seats.length;
    return { over: true, winner: others.length === 1 ? others[0] : null, ranks, reason };
  },

  /** 行动的公开描述：出牌只说张数和声称的桌牌（不暴露真实牌面）；质疑不带结果（扣扳机的结果由画面揭晓） */
  label(state, seat, action) {
    const a = String(action ?? '').trim();
    if (a === CALL) {
      const last = state.round?.pile?.at(-1);
      return last ? `质疑${seatName(last.seat)}` : '质疑';
    }
    const plain = CODE_RE.test(a) ? (state.round ? decodePlay(state, seat, a) : null) : a;
    const p = plain === null ? { error: true } : parseCards(plain);
    return p.cards ? `出 ${p.cards.length} 张，称都是 ${state.round?.table || ''}` : '出牌';
  },

  // ---------- 给模型 ----------
  systemPrompt(seat, { style = '', players = 4 } = {}) {
    return [
      `你在玩「吹牛左轮」（${players} 人），坐在${seatName(seat)}。目标：活到最后。`,
      '【牌】共 20 张：Q、K、A 各 6 张，鬼牌 2 张（万能）。每轮重新洗牌，每个活着的人发 5 张，再翻出本轮「桌牌」（Q、K、A 之一）。桌牌和鬼牌算真，其余算假。',
      '【出牌】按 1→2→3→4 号顺序轮流。轮到你时二选一：①出 1–3 张暗牌，声称都是桌牌（可以说谎）；②质疑上一手（每轮第一手不能质疑）。手里没牌的人本轮跳过；其他人都没牌时你必须质疑。',
      '【质疑】翻开上一手：有一张是假牌，出牌的人输；全是真牌，质疑的人输。',
      '【左轮】每人一把 6 弹巢左轮，只装 1 发子弹，位置随机、整局不重转。输的人对自己扣一次扳机：已扣 k 次时这一枪中弹概率是 1/(6−k)。中弹出局。',
      '【换轮】质疑结算后重新洗牌发牌、翻新桌牌，由输家先出（输家出局则由他的下家）。最后活着的人获胜，名次按出局先后。',
      '',
      ...FORMAT_LINES,
      style ? `\n【你的风格】${style}\n（风格只影响你的打法取向，不能改变上面的规则和输出格式。）` : '',
    ].join('\n');
  },

  turnPrompt(state, seat, { showLegal = false } = {}) {
    const r = state.round;
    const hand = handOf(state, seat);
    const info = callInfo(state, seat);
    const pileN = r.pile.reduce((a, p) => a + p.cards.length, 0);
    const lines = [
      `【第 ${r.no} 轮】桌牌：${r.table}（${r.table} 和鬼牌算真）。你是${seatName(seat)}。`,
      `你的手牌（${hand.length} 张）：${hand.join(' ') || '（无）'}`,
    ];
    const mine = r.pile.filter((p) => p.seat === seat);
    if (mine.length) lines.push(`你本轮已出：${mine.map((p) => p.cards.join(' ')).join('；')}`);
    if (info.last) lines.push(`上一手：${seatName(info.last.seat)}出了 ${info.last.cards.length} 张，声称都是 ${r.table}（本轮牌堆共 ${pileN} 张暗牌）。`);
    else lines.push('本轮由你先出，不能质疑。');
    const others = state.seats.filter((x) => x !== seat).map((x) => (state.alive[x]
      ? `${seatName(x)} 手牌 ${handOf(state, x).length} 张，左轮已扣 ${state.pulls[x]} 次（下一枪 ${fracText(state.pulls[x])}）`
      : `${seatName(x)} 已出局`));
    lines.push(`其他人：${others.join('；')}`);
    lines.push(`你的左轮：已扣 ${state.pulls[seat]} 次（下一枪 ${fracText(state.pulls[seat])}）`);
    lines.push(historyText(state));
    if (info.mustCall) lines.push(hand.length ? '其他人手里都没牌了：你只能质疑。' : '你手里没牌了：你只能质疑。');
    if (showLegal && !info.mustCall) lines.push(`你可以出的牌：${legalPlays(hand).map(cardsId).join('、')}${info.canCall ? '；或者质疑' : ''}`);
    lines.push('', `请按五行格式回答，最后一行写${info.mustCall ? '「行动：质疑」' : info.canCall ? '「行动：出牌 …」或「行动：质疑」' : '「行动：出牌 …」'}。`);
    return lines.join('\n');
  },

  retryPrompt: (reason, attempt, max) => `你上一个回答无效：${reason}。请重新回答（这是第 ${attempt} 次重来，最多 ${max} 次，再无效判负），仍按五行格式，最后一行写「行动：出牌 …」或「行动：质疑」。`,

  parseReply(state, seat, text) {
    // 去掉 Markdown 的加粗、行首的标题号和列表符号：「**行动**：出牌 Q」也认
    const t = String(text || '').normalize('NFKC').replace(/\*\*|__|`/g, '').replace(/^[ \t]*(?:[#>]+|[-*•]\s)\s*/gm, '');
    const win = /胜率\s*[:：]\s*[^\d\n]{0,4}(\d{1,3})/.exec(t);
    const winrate = win ? Math.min(100, Number(win[1])) : null;
    const fail = (error, attempted = null) => ({ action: null, attempted, winrate, error });
    if (state.winner) return fail('对局已经结束');
    if (seat !== state.round.turn) return fail(`现在不是${seatName(seat)}行动`);
    let raw = null;
    const m = [...t.matchAll(/(?:行动|出牌)\s*[:：]\s*([^\n]*)/g)].pop();
    if (m) raw = m[1].trim();
    else {
      const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
      const lastLine = lines.at(-1) || '';
      if (/^(质疑|开牌|不信|LIAR|骗子)/i.test(lastLine) || /^出牌/.test(lastLine)) raw = lastLine;
    }
    if (raw === null) return fail('没有找到行动（最后一行应为「行动：出牌 Q Q」或「行动：质疑」）');
    raw = raw.replace(/[。.！!]+$/, '').trim();
    const info = callInfo(state, seat);
    // 「不质疑，出牌 Q」：否定的质疑不算质疑
    const kept = raw.replace(/(不|不要|先不|暂不|别|无需|不用|没必要|不必)\s*(质疑|开牌)/g, ' ');
    const segs = kept.split(/[，,。；;]/).map((x) => x.trim());
    const i0 = segs.findIndex(Boolean);
    let head = i0 < 0 ? '' : segs[i0];
    // 「出牌 K, 鬼」：逗号后面只是接着列牌的，也算进来（「，称都是 K」这类说明不算）
    for (let i = i0 + 1; i0 >= 0 && i < segs.length && /^[\s[\]（）()QKAJ鬼牌王×X*1-3一二两三张]+$/i.test(segs[i]); i++) head += ` ${segs[i]}`;
    const isCall = /^(质疑|开牌|不信|抓|喊|LIAR|骗子|说谎)/i.test(head) || (/质疑|LIAR/i.test(head) && !/出牌/.test(head));
    if (isCall) {
      if (!info.canCall) return fail('本轮由你先出，还没有上一手可以质疑，必须出 1–3 张牌', '质疑');
      return { action: CALL, attempted: '质疑', winrate, error: null };
    }
    const p = parseCards(head.replace(/^出牌\s*/, ''));
    if (p.error) return fail(`${p.error}，请写成「行动：出牌 Q Q」或「行动：质疑」`, head.slice(0, 20));
    const chk = checkPlay(state, seat, p.cards);
    const id = cardsId(p.cards);
    if (chk.error) return fail(chk.error, id);
    return { action: encodePlay(state, seat, chk.action), attempted: id, winrate, error: null };
  },

  mockReply(state, seat, action) {
    const table = state.round.table;
    if (action === CALL) {
      const last = state.round.pile.at(-1);
      return `判断：牌堆越叠越高，真牌快不够了。\n推断：${last ? seatName(last.seat) : '上家'}这手多半有假。\n理由：赌他在说谎。\n胜率：45%\n行动：质疑`;
    }
    const plain = CODE_RE.test(String(action)) ? decodePlay(state, seat, String(action)) || '' : String(action);
    const cards = plain.split(' ');
    const honest = cards.every((c) => isTruth(c, table));
    return `判断：桌牌是 ${table}，局面还算平稳。\n推断：下家未必敢质疑。\n理由：${honest ? '手里有真牌，老实出' : '没有真牌，只能硬着头皮诈一手'}。\n胜率：40%\n行动：出牌 ${plain}`;
  },

  // ---------- 内置 AI ----------
  /** level 1 随机合法；level 2 按手里的真牌数和上一手张数估算对方说谎的概率，能诚实出就诚实；level 3 再看左轮危险度、记住自己出过的牌、适当诈唬 */
  builtinMove(state, seat, { level = 2, random = false, rand: rnd = Math.random } = {}) {
    const acts = game.actions(state, seat);
    if (!acts.length) throw new Error('没有可行的行动');
    if (random) return acts[Math.floor(rnd() * acts.length)].id;
    const a = chooseMove(state, seat, Math.max(1, Math.min(3, Number(level) || 2)), rnd);
    return a === CALL ? a : encodePlay(state, seat, a);
  },

  // ---------- 浏览器数据 ----------
  /**
   * viewer：座位（只看自己的牌）、'*'（公共视角）或 null（上帝视角）。
   * 子弹位置任何视角都不给（包括上帝视角），只给每人已扣几次。
   */
  view(state, viewer = null) {
    const s = state;
    const r = s.round;
    const god = viewer === null || viewer === undefined;
    const see = (x) => god || viewer === x;
    const info = r.turn ? callInfo(s, r.turn) : { canCall: false, mustCall: false };
    return {
      viewer: viewer ?? null,
      n: s.seats.length,
      seats: s.seats.slice(),
      seatNames: Object.fromEntries(s.seats.map((x) => [x, seatName(x)])),
      round: r.no,
      table: r.table,
      lead: r.lead,
      turn: s.winner ? null : r.turn,
      canCall: !!info.canCall,
      mustCall: !!info.mustCall,
      hands: Object.fromEntries(s.seats.map((x) => [x, s.alive[x] && see(x) ? (r.hands[x] || []).slice() : null])),
      counts: Object.fromEntries(s.seats.map((x) => [x, s.alive[x] ? (r.hands[x] || []).length : 0])),
      pile: s.winner ? [] : r.pile.map((p) => ({ seat: p.seat, n: p.cards.length, cards: see(p.seat) ? p.cards.slice() : null })),
      revolvers: Object.fromEntries(s.seats.map((x) => [x, { pulls: s.pulls[x], alive: s.alive[x], chambers: CHAMBERS }])),
      alive: s.seats.filter((x) => s.alive[x]),
      out: s.out.slice(),
      roles: Object.fromEntries(s.out.map((x) => [x, '出局'])),
      // 全部行动：出牌只给张数（本人或上帝视角才有牌面）；质疑带上结算
      log: s.log.map((e) => (e.kind === 'call'
        ? { round: e.round, seat: e.seat, kind: 'call', accused: e.accused }
        : { round: e.round, seat: e.seat, kind: 'play', n: e.cards.length, cards: see(e.seat) ? e.cards.slice() : null })),
      history: s.history.map((h) => ({ ...h, cards: h.cards.slice() })),
      over: !!s.winner,
      // 终局：名次；质疑刚结算、新一轮还没人出牌时是 { settling: true }（对局页状态条据此写「结算中」，不提前报下一轮轮到谁）
      result: s.winner ? { winner: s.winner, ranks: ranksOf(s), order: s.out.slice() } : s.log.at(-1)?.kind === 'call' ? { settling: true } : null,
    };
  },
};

export default game;
export { legalPlays, cardsId, CALL, JOKER, decodePlay, encodePlay };
