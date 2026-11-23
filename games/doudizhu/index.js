// 斗地主（3 人：一名地主对两名农民）。实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。
// 牌只记点数。行动 id：出牌为按点数从小到大、空格分隔的牌（「3 3」「10 J Q K A」「小王 大王」），
// 不出为「不出」；叫分为「叫0」（不叫）到「叫3」。

import {
  RANKS, TYPE_NAMES, GROUP_ORDER, deal, mulberry32, parseCards, legalPlays, hasCards, removeCards,
  classify, toCounts, namesOf, cardsId, comboText, sortCards, fullDeck,
} from './rules.js';
import { chooseBid, choosePlay } from './ai.js';

const SEATS = ['p1', 'p2', 'p3'];
const SEAT_NAMES = { p1: '1 号位', p2: '2 号位', p3: '3 号位' };
const MAX_REDEALS = 5;
const PASS = '不出';
const HISTORY_TRICKS = 6; // 提示词里列最近几轮出牌
const GROUP_LIMIT = 12; // 提示词里每种牌型最多列几个
const LEGAL_LIMIT = 80; // 提示词里合法出牌总共最多列几个

const next = (seat) => SEATS[(SEATS.indexOf(seat) + 1) % 3];
const seatName = (seat) => SEAT_NAMES[seat] || seat;
const maxBid = (state) => Math.max(0, ...state.bids.map((b) => b.bid));
const playsBy = (state, seat) => state.plays.filter((p) => p.seat === seat && p.cards).length;
const roleOf = (state, seat) => (!state.landlord ? null : seat === state.landlord ? '地主' : '农民');
const teammate = (state, seat) => (state.landlord && seat !== state.landlord ? SEATS.find((s) => s !== seat && s !== state.landlord) : null);
const bidText = (b) => (b ? `叫 ${b} 分` : '不叫');

// ---------- 状态 ----------

/** 首叫位只由种子决定（重发也不变），复式同一副牌轮换座位时同一座位总是首叫 */
function firstBidder(seed) {
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  return SEATS[Math.floor(rnd() * 3)];
}

function dealInto(state) {
  const d = deal((state.seed + state.deals) >>> 0);
  state.hands = { p1: d.hands[0], p2: d.hands[1], p3: d.hands[2] };
  state.bottom = d.bottom;
}

function becomeLandlord(state, seat, bid, takeBottom = true) {
  state.landlord = seat;
  state.bid = bid;
  if (takeBottom) state.hands[seat] = sortCards([...state.hands[seat], ...state.bottom]);
  state.phase = 'play';
  state.turn = seat;
  state.trick = { n: 1, leader: seat, last: null, passes: 0 };
}

/** setup.hands 自定义发牌（测试和残局用）：{ p1: '3 3 4 …', … }，可选 bottom、first，给了 landlord 就跳过叫分（手牌视为已含底牌） */
function customState(state, setup) {
  const all = [];
  const read = (txt, what) => {
    const r = parseCards(Array.isArray(txt) ? txt.join(' ') : txt || '');
    if (r.error && String(txt || '').trim()) throw new Error(`${what}：${r.error}`);
    const cards = r.cards || [];
    all.push(...cards);
    return cards;
  };
  state.hands = Object.fromEntries(SEATS.map((s) => [s, read(setup.hands[s], seatName(s))]));
  state.bottom = read(setup.bottom, '底牌');
  const limit = toCounts(fullDeck());
  toCounts(all).forEach((n, r) => { if (n > limit[r]) throw new Error(`${RANKS[r]} 超过了一副牌的张数`); });
  if (setup.first && SEATS.includes(setup.first)) state.first = setup.first;
  state.turn = state.first;
  if (setup.landlord) {
    if (!SEATS.includes(setup.landlord)) throw new Error(`未知座位：${setup.landlord}`);
    becomeLandlord(state, setup.landlord, Math.min(3, Math.max(1, Number(setup.bid) || 1)), false);
  }
}

function newState(seed = 0, setup = {}) {
  const state = {
    seed: Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : 0,
    deals: 0, // 三家都不叫时的重发次数
    first: null,
    phase: 'bid',
    hands: null, bottom: null,
    bids: [], // 本次发牌的叫分 [{ seat, bid }]
    landlord: null, bid: 0,
    turn: null,
    trick: null, // { n: 第几轮, leader, last: { seat, id, type, main, len, cards } | null, passes }
    plays: [], // 出牌阶段的全部行动 [{ seat, cards | null, type, trick }]
    bombs: 0,
    winner: null,
  };
  state.first = firstBidder(state.seed);
  state.turn = state.first;
  if (setup?.hands) customState(state, setup);
  else dealInto(state);
  return state;
}

const clone = (s) => JSON.parse(JSON.stringify(s));

function legalFor(state, seat) {
  if (state.phase !== 'play' || seat !== state.turn) return new Map();
  return legalPlays(state.hands[seat], state.trick.last);
}

/** 出牌阶段的倍数（不含春天） */
const bombMult = (state) => 2 ** state.bombs;

function settle(state) {
  const l = state.landlord;
  const lw = state.winner === l;
  const farmers = SEATS.filter((s) => s !== l);
  const spring = lw && farmers.every((f) => playsBy(state, f) === 0);
  const anti = !lw && playsBy(state, l) === 1;
  const mult = bombMult(state) * (spring || anti ? 2 : 1);
  return { landlordWins: lw, spring, anti, multiplier: mult, score: state.bid * mult };
}

// ---------- 给模型的文字 ----------

const handText = (cards) => (cards.length ? namesOf(cards).join(' ') : '（无）');

function playText(p) {
  return p.cards ? cardsId(p.cards) : PASS;
}

function tricksText(state) {
  const byTrick = new Map();
  for (const p of state.plays) {
    if (!byTrick.has(p.trick)) byTrick.set(p.trick, []);
    byTrick.get(p.trick).push(p);
  }
  const ns = [...byTrick.keys()].slice(-HISTORY_TRICKS);
  return ns.map((n) => `第 ${n} 轮：${byTrick.get(n).map((p) => `${seatName(p.seat)} ${playText(p)}`).join(' → ')}`);
}

/** 自己看不到的牌（另外两家手里合计），按点数统计 */
function unseenText(state, seat) {
  const c = toCounts(fullDeck());
  for (const r of state.hands[seat]) c[r]--;
  for (const p of state.plays) if (p.cards) for (const r of p.cards) c[r]--;
  return c.map((n, r) => (n > 0 ? `${RANKS[r]}×${n}` : null)).filter(Boolean).join(' ') || '（无）';
}

function legalText(map, leading) {
  const groups = new Map();
  for (const p of map.values()) {
    if (!groups.has(p.type)) groups.set(p.type, []);
    groups.get(p.type).push(p.id);
  }
  const lines = [];
  let shown = 0, more = false;
  for (const t of GROUP_ORDER) {
    const ids = groups.get(t);
    if (!ids) continue;
    const room = Math.max(3, Math.min(GROUP_LIMIT, LEGAL_LIMIT - shown));
    const part = ids.slice(0, room);
    shown += part.length;
    if (part.length < ids.length) more = true;
    lines.push(`  ${TYPE_NAMES[t]}：${part.join('、')}${part.length < ids.length ? `（另有 ${ids.length - part.length} 种）` : ''}`);
  }
  if (!leading) lines.push(`  不出：${PASS}`);
  if (more) lines.push('  还有其他合法组合，上面只列出一部分。');
  return lines.join('\n');
}

const FORMAT_LINES = [
  '【输出格式】每次只简短回答，用中文，除最后一行外合计不超过 80 字，严格按五行：',
  '判断：一句话说明局面（谁占优、关键牌在哪）',
  '推断：一句话推断对手可能还有什么牌（叫分阶段可写手牌估计）',
  '理由：一句话说明为什么这样出（或这样叫）',
  '胜率：你估计自己这一方的获胜概率，写成 0–100 的整数加 %',
  '最后一行：叫分阶段写「叫分：0」到「叫分：3」（0 表示不叫）；出牌阶段写「出牌：」加要出的牌，点数之间用空格分开，例如「出牌：3 3」「出牌：10 J Q K A」「出牌：小王 大王」，不出写「出牌：不出」。',
];

// ---------- 解析 ----------

const CN_BID = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3 };

function parseBid(state, seat, t) {
  const line = [...t.matchAll(/叫分\s*[:：]\s*([^\n]*)/g)].pop();
  let raw = line ? line[1].trim() : null;
  if (raw === null) {
    const m = [...t.matchAll(/(不叫|叫\s*[0-3零一二两三]\s*分)/g)].pop();
    raw = m ? m[1] : null;
  }
  if (raw === null) {
    if (/出牌\s*[:：]/.test(t)) return { error: '现在是叫分阶段，最后一行应写「叫分：0」到「叫分：3」' };
    return { error: '没有找到叫分（最后一行应为「叫分：2」这样的格式，0 表示不叫）' };
  }
  let bid = null;
  if (/^(不叫|不|pass|过|放弃)/i.test(raw)) bid = 0;
  else {
    const m = /([0-3零一二两三])/.exec(raw.normalize('NFKC'));
    if (m) bid = /\d/.test(m[1]) ? Number(m[1]) : CN_BID[m[1]];
  }
  if (bid === null) return { attempted: raw.slice(0, 10), error: `无法识别叫分「${raw.slice(0, 10)}」，请写 0–3 的数字` };
  const cur = maxBid(state);
  if (bid && bid <= cur) return { attempted: `叫${bid}`, error: `当前最高已经是 ${cur} 分，要叫就必须叫比 ${cur} 高的分，或者写「叫分：0」不叫` };
  return { action: `叫${bid}`, attempted: `叫${bid}` };
}

function parsePlay(state, seat, t) {
  const line = [...t.matchAll(/出牌\s*[:：]\s*([^\n]*)/g)].pop();
  if (!line) {
    if (/叫分\s*[:：]/.test(t)) return { error: '叫分已经结束，现在是出牌阶段，最后一行应写「出牌：3 3」或「出牌：不出」' };
    return { error: '没有找到出牌（最后一行应为「出牌：3 3」或「出牌：不出」这样的格式）' };
  }
  const raw = line[1].trim().replace(/[。.！!]+$/, '');
  const last = state.trick.last;
  if (/^(不出|不要|要不起|过|pass)/i.test(raw)) {
    if (!last) return { attempted: PASS, error: '这一轮由你领出，不能不出，必须出一手牌' };
    return { action: PASS, attempted: PASS };
  }
  const r = parseCards(raw);
  if (r.error) return { attempted: raw.slice(0, 20), error: `${r.error}，请把每张牌按点数写出并用空格分开，例如「出牌：3 3 4 4 5 5」` };
  const id = cardsId(r.cards);
  return { ...checkPlay(state, seat, r.cards), attempted: id };
}

/** 检查一手牌是否合法；合法返回 { action }，否则 { error } */
function checkPlay(state, seat, cards) {
  const hand = state.hands[seat];
  const id = cardsId(cards);
  if (!hasCards(hand, cards)) {
    const h = toCounts(hand), need = toCounts(cards);
    const miss = need.map((n, r) => (n > h[r] ? `${RANKS[r]}（你只有 ${h[r]} 张）` : null)).filter(Boolean);
    return { error: `你手里没有这些牌：${miss.join('、')}` };
  }
  const last = state.trick.last;
  const map = legalPlays(hand, last);
  if (map.has(id)) return { action: id };
  const kind = classify(cards);
  if (!kind) return { error: `「${id}」不是合法牌型` };
  return { error: `「${id}」（${TYPE_NAMES[kind.type]}）压不过${seatName(last.seat)}的${comboText(last)}：要出同牌型、同张数、更大的牌，或者炸弹、王炸，或者不出` };
}

// ---------- 游戏定义 ----------

const game = {
  id: 'doudizhu',
  name: '斗地主',
  players: { min: 3, max: 3, default: 3 },
  features: { hidden: true, winbar: false, draw: false },
  noun: '出牌',
  rankedSeries: { legs: 3, sameSeed: true }, // 复式：同一副牌轮换座位打 3 次

  seats: (n = 3) => SEATS.slice(0, n),
  seatName,

  create({ seed = 0, setup = {} } = {}) {
    return newState(seed, setup || {});
  },

  pending(state) {
    return state.phase === 'over' ? [] : [state.turn];
  },

  actions(state, seat) {
    if (state.phase === 'over' || seat !== state.turn) return [];
    if (state.phase === 'bid') {
      const cur = maxBid(state);
      return [0, 1, 2, 3].filter((b) => b === 0 || b > cur).map((b) => ({ id: `叫${b}`, label: bidText(b) }));
    }
    const out = [...legalFor(state, seat).values()].map((p) => ({ id: p.id, label: comboText(p) }));
    if (state.trick.last) out.push({ id: PASS, label: PASS });
    return out;
  },

  apply(state, seat, action) {
    if (state.phase === 'over') throw new Error('对局已经结束');
    if (seat !== state.turn) throw new Error(`现在不是${seatName(seat)}行动`);
    const s = clone(state);
    const a = String(action ?? '').trim();
    if (s.phase === 'bid') {
      const m = /^叫([0-3])$/.exec(a);
      if (!m) throw new Error(`叫分阶段的行动应为 叫0–叫3：${a}`);
      const bid = Number(m[1]);
      const cur = maxBid(s);
      if (bid && bid <= cur) throw new Error(`必须叫比 ${cur} 高的分`);
      s.bids.push({ seat, bid });
      if (bid === 3) { becomeLandlord(s, seat, 3); return s; }
      if (s.bids.length < 3) { s.turn = next(seat); return s; }
      const top = maxBid(s);
      if (top > 0) {
        const winner = s.bids.find((b) => b.bid === top).seat;
        becomeLandlord(s, winner, top);
      } else if (s.deals < MAX_REDEALS) {
        s.deals += 1;
        s.bids = [];
        dealInto(s);
        s.turn = s.first;
      } else {
        becomeLandlord(s, s.first, 1);
      }
      return s;
    }
    // 出牌阶段
    if (a === PASS) {
      if (!s.trick.last) throw new Error('领出时不能不出');
      s.plays.push({ seat, cards: null, type: null, trick: s.trick.n });
      s.trick.passes += 1;
      if (s.trick.passes >= 2) {
        const leader = s.trick.last.seat;
        s.trick = { n: s.trick.n + 1, leader, last: null, passes: 0 };
        s.turn = leader;
      } else s.turn = next(seat);
      return s;
    }
    const r = parseCards(a);
    if (r.error) throw new Error(`无法识别的出牌：${a}`);
    const id = cardsId(r.cards);
    const chk = checkPlay(s, seat, r.cards);
    if (chk.error) throw new Error(chk.error);
    const combo = legalPlays(s.hands[seat], s.trick.last).get(id);
    s.hands[seat] = removeCards(s.hands[seat], combo.cards);
    s.plays.push({ seat, cards: combo.cards, type: combo.type, trick: s.trick.n });
    s.trick.last = { seat, id, type: combo.type, main: combo.main, len: combo.len, cards: combo.cards };
    s.trick.passes = 0;
    if (combo.type === 'bomb' || combo.type === 'rocket') s.bombs += 1;
    if (!s.hands[seat].length) {
      s.phase = 'over';
      s.winner = seat;
      s.turn = null;
    } else s.turn = next(seat);
    return s;
  },

  outcome(state) {
    if (state.phase !== 'over') return { over: false };
    const st = settle(state);
    const l = state.landlord;
    const ranks = Object.fromEntries(SEATS.map((x) => [x, (x === l) === st.landlordWins ? 1 : 2]));
    const parts = [`叫 ${state.bid} 分`];
    if (state.bombs) parts.push(state.bombs === 1 ? '炸弹 ×2' : `炸弹 ${state.bombs} 个 ×${2 ** state.bombs}`);
    if (st.spring) parts.push('春天 ×2');
    if (st.anti) parts.push('反春 ×2');
    parts.push(`共 ${st.score} 分`);
    const who = st.landlordWins ? '地主' : `农民（${seatName(state.winner)}）`;
    const teams = { 地主: [l], 农民: SEATS.filter((x) => x !== l) };
    return { over: true, winner: state.winner, ranks, teams, score: st.score, reason: `${who}出完牌获胜（${parts.join('，')}）` };
  },

  forfeit(state, seat, reason) {
    const l = state.landlord;
    let ranks;
    if (!l) ranks = Object.fromEntries(SEATS.map((x) => [x, x === seat ? 2 : 1])); // 叫分阶段还没有分队
    else {
      const loserIsLandlord = seat === l;
      ranks = Object.fromEntries(SEATS.map((x) => [x, (x === l) === loserIsLandlord ? 2 : 1]));
    }
    const winner = SEATS.find((x) => ranks[x] === 1);
    return { over: true, winner, ranks, ...(l ? { teams: { 地主: [l], 农民: SEATS.filter((x) => x !== l) } } : {}), reason };
  },

  label(state, seat, action) {
    const a = String(action);
    if (/^叫[0-3]$/.test(a)) return bidText(Number(a.slice(1)));
    if (a === PASS) return PASS;
    if (state.phase === 'play') {
      const r = parseCards(a);
      const p = r.cards && legalPlays(state.hands[seat], state.trick.last).get(cardsId(r.cards));
      if (p) return comboText(p);
    }
    return a;
  },

  // ---------- 给模型 ----------
  systemPrompt(seat, { style = '' } = {}) {
    return [
      `你在玩斗地主（3 人），坐在${seatName(seat)}。地主一人对抗两名农民，哪一方先有人出完手里的牌，哪一方获胜；两名农民是队友。`,
      '',
      '【牌】一副 54 张，不看花色，只看点数，从小到大：3 4 5 6 7 8 9 10 J Q K A 2 小王 大王。',
      '【叫分】每人 17 张，留 3 张底牌。从首叫位开始轮流叫分，每人一次机会：叫 1、2、3 分（必须比当前最高分高）或不叫。叫 3 分立即成为地主；一圈后叫分最高的人当地主；三家都不叫就重新发牌。地主拿走底牌（底牌三家都能看到）并先出牌。',
      '【牌型】单张；对子；三张；三带一；三带二（带一对）；顺子（5 张或更多连续单牌，不含 2 和王）；连对（3 对或更多连续对子，不含 2 和王）；飞机（2 组或更多连续三张，不含 2），可以带同样组数的单张或对子，带的牌不能和飞机主体同点数；四带二（带两张单牌或两对）；炸弹（四张同点数）；王炸（小王＋大王）。',
      '【出牌】一轮里领出的人可以出任意牌型，之后的人要么出同牌型、同张数且更大的牌，要么不出。三带一、飞机、四带二只比主体的大小。炸弹能压任何非炸弹牌型，大炸弹压小炸弹，王炸最大。另外两家都不出时，最后出牌的人重新领出。领出时不能不出。',
      '【计分】底分 = 叫分；每出一个炸弹或王炸翻一倍；春天（农民一张牌没出地主就出完）或反春（地主只出了第一手农民就出完）再翻一倍。',
      '',
      ...FORMAT_LINES,
      style ? `\n【你的风格】${style}\n（风格只影响你的打法取向，不能改变上面的规则和输出格式。）` : '',
    ].join('\n');
  },

  turnPrompt(state, seat, { showLegal = false } = {}) {
    const hand = state.hands[seat];
    if (state.phase === 'bid') {
      const cur = maxBid(state);
      const can = [0, 1, 2, 3].filter((b) => b === 0 || b > cur).map((b) => `叫分：${b}${b ? '' : '（不叫）'}`);
      return [
        `【叫分阶段】你是${seatName(seat)}，首叫位是${seatName(state.first)}${state.deals ? `（三家都不叫，已重新发牌 ${state.deals} 次）` : ''}。`,
        `你的手牌（${hand.length} 张）：${handText(hand)}`,
        state.bids.length ? `前面的叫分：${state.bids.map((b) => `${seatName(b.seat)} ${bidText(b.bid)}`).join('；')}` : '你是第一个叫分的人。',
        `当前最高：${cur ? `${cur} 分` : '还没有人叫'}。你可以写：${can.join('、')}。`,
        '',
        '请按五行格式回答，最后一行写「叫分：N」。',
      ].join('\n');
    }
    const l = state.landlord;
    const mate = teammate(state, seat);
    const others = SEATS.filter((x) => x !== seat);
    const last = state.trick.last;
    const map = legalFor(state, seat);
    const lines = [
      `【出牌阶段 · 第 ${state.trick.n} 轮】你是${seatName(seat)}，身份：${roleOf(state, seat)}${mate ? `（队友是${seatName(mate)}）` : '（两名农民联手对付你）'}。`,
      `地主：${seatName(l)}，叫 ${state.bid} 分，当前倍数 ×${bombMult(state)}${state.bombs ? `（已出炸弹 ${state.bombs} 个）` : ''}。`,
      `底牌（公开）：${handText(state.bottom)}`,
      `你的手牌（${hand.length} 张）：${handText(hand)}`,
      `另外两家剩余：${others.map((x) => `${seatName(x)}（${roleOf(state, x)}${x === mate ? '，队友' : ''}）${state.hands[x].length} 张`).join('；')}`,
      `你看不到的牌（另外两家手里合计）：${unseenText(state, seat)}`,
    ];
    const hist = tricksText(state);
    lines.push(hist.length ? `出牌记录（最近 ${hist.length} 轮）：\n${hist.map((h) => `  ${h}`).join('\n')}` : '出牌记录：还没有人出牌。');
    if (!last) lines.push('本轮由你领出，可以出任意牌型，不能不出。');
    else lines.push(`本轮要压过的牌：${seatName(last.seat)}${last.seat === mate ? '（队友）' : ''}出的 ${comboText(last)}。你可以出同牌型、同张数更大的牌，或炸弹、王炸，或者不出。`);
    if (showLegal) lines.push(`你现在的合法出牌（按牌型）：\n${legalText(map, !last)}`);
    lines.push('', '请按五行格式回答，最后一行写「出牌：…」。');
    return lines.join('\n');
  },

  retryPrompt: (reason, attempt, max) => `你上一个回答无效：${reason}。请重新回答（这是第 ${attempt} 次重来，最多 ${max} 次，再无效判负），仍按五行格式回答。`,

  parseReply(state, seat, text) {
    const t = String(text || '').normalize('NFKC');
    const win = /胜率\s*[:：]\s*(\d{1,3})/.exec(t);
    const winrate = win ? Math.min(100, Number(win[1])) : null;
    if (state.phase === 'over') return { action: null, attempted: null, winrate, error: '对局已经结束' };
    if (seat !== state.turn) return { action: null, attempted: null, winrate, error: `现在不是${seatName(seat)}行动` };
    const r = state.phase === 'bid' ? parseBid(state, seat, t) : parsePlay(state, seat, t);
    return { action: r.error ? null : r.action, attempted: r.attempted ?? null, winrate, error: r.error || null };
  },

  mockReply(state, seat, action) {
    if (state.phase === 'bid') {
      const b = Number(String(action).slice(1));
      return `判断：${b >= 2 ? '手里大牌不少' : '牌力一般'}。\n推断：底牌未知，其他两家牌力不明。\n理由：${b ? `叫 ${b} 分争地主` : '不值得当地主'}。\n胜率：${b ? 50 + b * 8 : 40}%\n叫分：${b}`;
    }
    const pass = action === PASS;
    return `判断：${roleOf(state, seat)}这边局面尚可。\n推断：对手大概还握着几张大牌。\n理由：${pass ? '这手不值得压' : '先把这手牌走掉'}。\n胜率：50%\n出牌：${action}`;
  },

  // ---------- 内置 AI ----------
  builtinMove(state, seat, { level = 2, random = false } = {}) {
    const acts = game.actions(state, seat);
    if (!acts.length) throw new Error('没有可行的行动');
    if (random) return acts[Math.floor(Math.random() * acts.length)].id;
    if (state.phase === 'bid') {
      const jitter = level <= 1 ? Math.floor(Math.random() * 3) - 1 : 0;
      return `叫${chooseBid(state.hands[seat], maxBid(state), { jitter })}`;
    }
    const counts = Object.fromEntries(SEATS.map((x) => [x, state.hands[x].length]));
    const p = choosePlay({
      hand: state.hands[seat], last: state.trick.last, lastSeat: state.trick.last?.seat || null,
      seat, landlord: state.landlord, counts, rand: level <= 1 ? Math.random : null,
    });
    if (!p) return PASS;
    return p.id;
  },

  // ---------- 浏览器数据 ----------
  view(state, viewer = null) {
    const over = state.phase === 'over';
    const see = (x) => viewer === null || viewer === undefined || viewer === x || over;
    const trickPlays = (n) => {
      const m = {};
      for (const p of state.plays) if (p.trick === n) m[p.seat] = p.cards ? { cards: namesOf(p.cards), type: TYPE_NAMES[p.type] } : { pass: true };
      return m;
    };
    let table = {}, stale = false;
    if (state.phase === 'bid') {
      for (const b of state.bids) table[b.seat] = { bid: b.bid, text: bidText(b.bid) };
    } else if (state.phase === 'play' || over) {
      table = trickPlays(state.trick.n);
      // 新一轮还没人出牌：先留着上一轮的牌（淡显）
      if (!Object.keys(table).length && state.trick.n > 1) { table = trickPlays(state.trick.n - 1); stale = true; }
    }
    const st = over ? settle(state) : null;
    return {
      phase: state.phase,
      viewer: viewer ?? null,
      seats: SEATS,
      seatNames: SEAT_NAMES,
      hands: Object.fromEntries(SEATS.map((x) => [x, see(x) ? namesOf(state.hands[x]) : null])),
      counts: Object.fromEntries(SEATS.map((x) => [x, state.hands[x].length])),
      bottom: state.landlord || viewer === null || viewer === undefined ? namesOf(state.bottom) : null,
      first: state.first,
      deals: state.deals,
      bids: state.bids.map((b) => ({ seat: b.seat, bid: b.bid })),
      // 出过的牌是公开信息：本局记录按轮列出
      plays: state.plays.map((p) => ({ seat: p.seat, trick: p.trick, cards: p.cards ? namesOf(p.cards) : null, type: p.cards ? TYPE_NAMES[p.type] : null })),
      landlord: state.landlord,
      bid: state.landlord ? state.bid : maxBid(state),
      multiplier: st ? st.multiplier : bombMult(state),
      bombs: state.bombs,
      turn: over ? null : state.turn,
      lead: state.trick?.last ? { seat: state.trick.last.seat, cards: namesOf(state.trick.last.cards), type: TYPE_NAMES[state.trick.last.type] } : null,
      table, stale,
      trickNo: state.trick?.n || 0,
      roles: state.landlord ? Object.fromEntries(SEATS.map((x) => [x, roleOf(state, x)])) : {},
      out: [],
      result: st ? { winner: state.winner, ...st } : null,
    };
  },
};

export default game;
