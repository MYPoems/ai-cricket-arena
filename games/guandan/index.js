// 掼蛋（4 人两队：1、3 号位一队，2、4 号位一队，对家是队友）。实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。
// 一场打 setup.hands 盘（默认 3，1–13），两队从 2 打起，按名次升级、进贡还贡；某队打过 A 或打满盘数结束，级数高的队赢。
// 行动 id：出牌为「牌（牌力从小到大）=组法」，例如「♠5 ♣5 ♦5 ♠8 ♥7=fullhouse:5」；不出为「pass」；还贡为「还贡 ♣5」。
// apply、parseReply 也接受只写牌的文字（「5 5 5 8 8」「红桃7 黑桃8 …」），逢人配有几种组法时：跟牌取能压过上家的最小组法，领出取最强组法。

import {
  SUITS, SJ, BJ, rankOf, suitOf, isWild, power, cardName, cardOf, rankName, deal, mulberry32, sortByPower,
  interpret, pickInterp, beats, isBomb, legalPlays, hintSort, playId, playText, typeText, keyText, layout,
  resolvePlay, resolveOne, removeCards, parseTokens, fxDuration, FX,
} from './rules.js';
import { choosePlay, chooseBack } from './ai.js';

const SEATS = ['p1', 'p2', 'p3', 'p4'];
const SEAT_NAMES = { p1: '1 号位', p2: '2 号位', p3: '3 号位', p4: '4 号位' };
const TEAM_NAMES = { A: '1·3 队', B: '2·4 队' };
const POS_NAMES = ['头游', '二游', '三游', '末游'];
const PASS = 'pass';
const BACK = '还贡';
const HISTORY_TRICKS = 3; // 提示词里列最近几轮
const UP = { 2: 3, 3: 2, 4: 1 }; // 队友名次 → 升几级

const seatName = (seat) => SEAT_NAMES[seat] || seat;
const teamOf = (seat) => (seat === 'p1' || seat === 'p3' ? 'A' : 'B');
const otherTeam = (t) => (t === 'A' ? 'B' : 'A');
const partnerOf = (seat) => SEATS[(SEATS.indexOf(seat) + 2) % 4];
const teamSeats = (t) => (t === 'A' ? ['p1', 'p3'] : ['p2', 'p4']);
const clone = (s) => JSON.parse(JSON.stringify(s));
const names = (cards) => cards.map(cardName);
const activeSeats = (s) => SEATS.filter((x) => !s.order.includes(x));
function nextActive(s, seat) {
  for (let k = 1; k <= 4; k++) {
    const x = SEATS[(SEATS.indexOf(seat) + k) % 4];
    if (!s.order.includes(x)) return x;
  }
  return null;
}

// ---------- 状态 ----------

function handSeed(seed, k) {
  return (seed ^ Math.imul(k, 0x9e3779b1)) >>> 0;
}

/** 一盘开始：定级、发牌、进贡（自动：除逢人配外最大的一张）、等还贡 */
function startHand(s) {
  s.handNo += 1;
  const prev = s.history.at(-1) || null;
  s.levelTeam = prev ? prev.team : null;
  s.level = prev ? s.levels[s.levelTeam] : 2;
  const custom = s.handNo === 1 && s.custom;
  const hs = custom ? s.custom : deal(handSeed(s.seed, s.handNo));
  s.cards = Object.fromEntries(SEATS.map((x, i) => [x, hs[i].slice().sort((a, b) => a - b)]));
  delete s.custom;
  s.order = [];
  s.plays = [];
  s.tribute = null;
  let leader;
  if (!prev) {
    leader = s.firstLeader;
  } else {
    const o = prev.order;
    const double = teamOf(o[0]) === teamOf(o[1]);
    const payers = double ? [o[2], o[3]] : [o[3]];
    const takers = double ? [o[0], o[1]] : [o[0]];
    const bigJokers = payers.reduce((n, x) => n + s.cards[x].filter((c) => c === BJ).length, 0);
    if (bigJokers >= 2) {
      // 抗贡：进贡方手里合计有两张大王，不进贡，头游先出
      s.tribute = { anti: true, antiBy: payers.filter((x) => s.cards[x].includes(BJ)), pays: [], backs: [], leader: o[0] };
      leader = o[0];
    } else {
      const top = (x) => sortByPower(s.cards[x].filter((c) => !isWild(c, s.level)), s.level)[0];
      const gifts = payers.map((x) => ({ from: x, card: top(x) }));
      const pw = (g) => power(rankOf(g.card), s.level);
      let pays;
      if (!double) {
        pays = [{ from: o[3], to: o[0], card: gifts[0].card }];
        leader = o[3];
      } else if (pw(gifts[0]) !== pw(gifts[1])) {
        const [big, small] = pw(gifts[0]) > pw(gifts[1]) ? gifts : [gifts[1], gifts[0]];
        pays = [{ from: big.from, to: o[0], card: big.card }, { from: small.from, to: o[1], card: small.card }];
        leader = big.from;
      } else {
        // 两张一样大：各自进贡给下家（顺时针），头游的下家先出
        pays = gifts.map((g) => ({ from: g.from, to: takers.find((t) => t === nextSeat(g.from)) || takers.find((t) => t !== g.from), card: g.card }));
        if (pays[0].to === pays[1].to) pays[1].to = takers.find((t) => t !== pays[0].to);
        leader = nextSeat(o[0]);
      }
      for (const p of pays) {
        s.cards[p.from] = removeCards(s.cards[p.from], [p.card]);
        s.cards[p.to] = [...s.cards[p.to], p.card].sort((a, b) => a - b);
      }
      s.tribute = { anti: false, antiBy: [], pays, backs: pays.map((p) => ({ from: p.to, to: p.from, card: null })), leader };
    }
  }
  s.trick = { n: 1, leader, last: null, passes: 0, wind: false };
  if (s.tribute && !s.tribute.anti) {
    s.phase = 'back';
    s.turn = null;
  } else {
    s.phase = 'play';
    s.turn = leader;
  }
}
const nextSeat = (seat) => SEATS[(SEATS.indexOf(seat) + 1) % 4];

/** setup.deal（测试、残局用）：{ p1: '♠5 ♥7 …', … }，只用于第一盘；setup.level 指定第一盘级数，setup.first 首出 */
function customDeal(setup) {
  return SEATS.map((x) => {
    const t = parseTokens(setup.deal[x] || '');
    if (t.error && String(setup.deal[x] || '').trim()) throw new Error(`${seatName(x)}：${t.error}`);
    return (t.tokens || []).map((tk) => (tk.wild ? cardOf(Number(setup.level) || 2, 1) : cardOf(tk.rank, tk.suit ?? 0)));
  });
}

function newState(seed = 0, setup = {}) {
  const total = Math.max(1, Math.min(13, Math.floor(Number(setup.hands) || 3)));
  const s = {
    rules: 1,
    seed: Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : 0,
    total,
    handNo: 0,
    levels: { A: 2, B: 2 },
    aFails: { A: 0, B: 0 },
    levelTeam: null,
    level: 2,
    phase: 'play',
    cards: null, order: [], turn: null, trick: null, plays: [], tribute: null,
    history: [],
    winner: null,
    passA: false,
    firstLeader: SEATS[Math.floor(mulberry32((Number(seed) ^ 0x51ed27) >>> 0)() * 4)],
  };
  if (setup.levels) for (const t of ['A', 'B']) if (Number(setup.levels[t]) >= 2 && Number(setup.levels[t]) <= 14) s.levels[t] = Number(setup.levels[t]);
  // 残局、测试用：第一盘指定打哪队的级（setup.levelTeam）或直接指定级数（setup.level）
  const lt = setup.levelTeam === 'A' || setup.levelTeam === 'B' ? setup.levelTeam : null;
  const lv0 = lt ? s.levels[lt] : Number(setup.level) >= 2 && Number(setup.level) <= 14 ? Number(setup.level) : 2;
  if (setup.deal) {
    s.custom = customDeal({ ...setup, level: lv0 });
    if (setup.first && SEATS.includes(setup.first)) s.firstLeader = setup.first;
  }
  startHand(s);
  s.levelTeam = lt;
  s.level = lv0;
  return s;
}

/** 一盘打完：名次、升级（双下 3 级、1·3 名 2 级、1·4 名 1 级，不能越过 A）、过 A、下一盘 */
function endHand(s) {
  const rest = SEATS.filter((x) => !s.order.includes(x))
    .sort((a, b) => s.cards[a].length - s.cards[b].length || SEATS.indexOf(a) - SEATS.indexOf(b));
  const order = [...s.order, ...rest];
  const head = order[0];
  const T = teamOf(head);
  const mPos = order.indexOf(partnerOf(head)) + 1;
  const before = { ...s.levels };
  let passA = false, aFail = null, reset = null;
  if (s.levelTeam === T && s.levels[T] === 14) {
    // 打自己的 A：头游 + 队友不是末游才算过 A
    if (mPos <= 3) passA = true;
    else aFail = T;
  } else {
    s.levels[T] = Math.min(14, s.levels[T] + UP[mPos]);
  }
  if (s.levelTeam && s.levelTeam !== T && s.levels[s.levelTeam] === 14) aFail = s.levelTeam;
  if (aFail) {
    s.aFails[aFail] += 1;
    if (s.aFails[aFail] >= 3) { s.levels[aFail] = 2; s.aFails[aFail] = 0; reset = aFail; }
  }
  const last = s.trick.last;
  s.history.push({
    hand: s.handNo, level: s.level, levelTeam: s.levelTeam, order, team: T, partnerPos: mPos,
    up: s.levels[T] - before[T], before, after: { ...s.levels }, passA, aFail, reset,
    left: Object.fromEntries(SEATS.map((x) => [x, s.cards[x].length])),
    last: last ? { seat: last.seat, cards: last.cards, type: last.type, key: last.key, n: last.n } : null,
  });
  if (passA || s.handNo >= s.total) {
    s.phase = 'over';
    s.turn = null;
    s.passA = passA;
    s.winner = passA ? T : s.levels.A > s.levels.B ? 'A' : s.levels.B > s.levels.A ? 'B' : T;
    return;
  }
  startHand(s);
}

// ---------- 合法行动 ----------

function backChoices(s, seat) {
  const hand = s.cards[seat];
  let ok = hand.filter((c) => c < 52 && rankOf(c) <= 10);
  if (!ok.length) {
    const sorted = sortByPower(hand, s.level);
    const low = power(rankOf(sorted.at(-1)), s.level);
    ok = hand.filter((c) => power(rankOf(c), s.level) === low);
  }
  return [...new Set(ok)].sort((a, b) => a - b);
}

const LEAD_LIMIT = { single: 8, pair: 6, triple: 4, fullhouse: 5, tube: 3, plate: 3, straight: 4 };

/** 精简的候选出法（按「提示」顺序） */
function candidatePlays(s, seat) {
  const hand = s.cards[seat];
  const last = s.trick.last;
  const sorted = hintSort(legalPlays(hand, s.level, last), hand, s.level, !last);
  const out = [];
  const per = {};
  const seenFull = new Set();
  let bombs = 0;
  for (const p of sorted) {
    if (isBomb(p)) { if (bombs++ < (last ? 8 : 6)) out.push(p); continue; }
    if (p.type === 'fullhouse') { if (seenFull.has(p.key)) continue; seenFull.add(p.key); }
    per[p.type] = (per[p.type] || 0) + 1;
    if (last ? out.length - Math.min(bombs, 8) >= 24 : per[p.type] > (LEAD_LIMIT[p.type] || 4)) continue;
    out.push(p);
  }
  // 能一手出完的一定列上
  const finish = sorted.find((p) => p.cards.length === hand.length);
  if (finish && !out.includes(finish)) out.unshift(finish);
  return out;
}

// ---------- 给模型的文字 ----------

/** 手牌：大王×2 小王 | 7(级)♣ 逢人配×2 | A♠♦♦ | … */
function handText(cards, level) {
  if (!cards.length) return '（无）';
  const groups = [];
  let wild = 0;
  for (const c of sortByPower(cards, level)) {
    if (isWild(c, level)) { wild++; continue; }
    const r = rankOf(c);
    let g = groups.at(-1);
    if (!g || g.r !== r) { g = { r, suits: [] }; groups.push(g); }
    g.suits.push(c >= 52 ? '' : SUITS[suitOf(c)]);
  }
  const parts = groups.map((g) => (g.r >= 15 ? `${rankName(g.r)}${g.suits.length > 1 ? `×${g.suits.length}` : ''}` : `${rankName(g.r)}${g.r === level ? '(级)' : ''}${g.suits.join('')}`));
  if (wild) parts.push(`逢人配♥${rankName(level)}×${wild}`);
  return parts.join(' ');
}

const comboText = (x, level) => playText(x.cards, x, level);

function tricksText(s, seat) {
  const by = new Map();
  for (const p of s.plays) {
    if (!by.has(p.trick)) by.set(p.trick, []);
    by.get(p.trick).push(p);
  }
  const ns = [...by.keys()].slice(-HISTORY_TRICKS);
  return ns.map((n) => `第 ${n} 轮：${by.get(n).map((p) => `${who(p.seat, seat)} ${p.cards ? comboText(p, s.level) : '不出'}`).join(' → ')}`);
}
function who(x, me) {
  if (x === me) return '你';
  return `${seatName(x)}${x === partnerOf(me) ? '(队友)' : ''}`;
}

function tributeText(s, seat) {
  const t = s.tribute;
  if (!t) return null;
  if (t.anti) return `本盘抗贡：${t.antiBy.map(seatName).join('、')}手里有大王，进贡方合计两张大王，不进贡。`;
  const pays = t.pays.map((p) => `${seatName(p.from)}→${seatName(p.to)} ${cardName(p.card)}`).join('；');
  const backs = t.backs.filter((b) => b.card !== null && (b.from === seat || b.to === seat)).map((b) => `${who(b.from, seat)}还给${who(b.to, seat)} ${cardName(b.card)}`);
  return `本盘进贡：${pays}${backs.length ? `；还贡：${backs.join('；')}` : ''}。`;
}

/** 别家还可能有的大牌（王、级牌、逢人配、A） */
function bigUnseen(s, seat) {
  const known = [...s.cards[seat]];
  for (const p of s.plays) if (p.cards) known.push(...p.cards);
  const total = { 大王: 2, 小王: 2, 逢人配: 2, [`级牌${rankName(s.level)}`]: 6, A: s.level === 14 ? 0 : 8 };
  const minus = { 大王: 0, 小王: 0, 逢人配: 0, [`级牌${rankName(s.level)}`]: 0, A: 0 };
  for (const c of known) {
    if (c === BJ) minus.大王++;
    else if (c === SJ) minus.小王++;
    else if (isWild(c, s.level)) minus.逢人配++;
    else if (rankOf(c) === s.level) minus[`级牌${rankName(s.level)}`]++;
    else if (rankOf(c) === 14) minus.A++;
  }
  return Object.keys(total).filter((k) => total[k]).map((k) => `${k}×${Math.max(0, total[k] - minus[k])}`).join(' ');
}

const FORMAT_LINES = [
  '【输出格式】每次只简短回答，用中文，除最后一行外合计不超过 80 字，严格按五行：',
  '判断：一句话说明局面（谁快走完、关键大牌在哪）',
  '推断：一句话推断别家可能还有什么牌',
  '理由：一句话说明为什么这样出（配合队友、留炸弹等）',
  '胜率：你估计本队赢下这一盘的概率，写成 0–100 的整数加 %',
  '最后一行：出牌阶段写「出牌：」加要出的牌，牌之间用空格分开，可以只写点数（「出牌：5 5 5 8 8」），要指定花色或用逢人配时写花色（「出牌：♠10 ♠J ♠Q ♠K ♠A」「出牌：♥7 5 5 8 8」），逢人配有几种当法时可写「♥7当5」，不出写「出牌：不出」；还贡阶段写「还贡：♣5」。',
];

// ---------- 游戏定义 ----------

const game = {
  id: 'guandan',
  name: '掼蛋',
  players: { min: 4, max: 4, default: 4 },
  features: { hidden: true, winbar: false, draw: false },
  noun: '出牌',

  seats: (n = 4) => SEATS.slice(0, n),
  seatName,

  create({ seed = 0, setup = {} } = {}) {
    return newState(seed, setup || {});
  },

  pending(state) {
    if (state.phase === 'over') return [];
    if (state.phase === 'back') return state.tribute.backs.filter((b) => b.card === null).map((b) => b.from);
    return [state.turn];
  },

  /** 每家出牌后至少停多久（毫秒） */
  turnPause: 1200,

  /** 画面特效要求的停顿：开局发牌、一盘结束的结算卡、进贡还贡、炸弹 */
  interlude(prev, next) {
    const d = fxDuration(fxSummary(prev), fxSummary(next));
    return d ? Math.max(game.turnPause, d + 300) : 0;
  },

  /** 要不起（手里没有能压过上家的牌）时不问选手，直接「不出」——省一次模型调用，真人也不用点 */
  autoAction(state, seat) {
    if (state.phase !== 'play' || state.turn !== seat || !state.trick.last) return null;
    return legalPlays(state.cards[seat], state.level, state.trick.last).length ? null : PASS;
  },

  /** 还贡是私密行动（还的牌只有双方知道） */
  secret(state) {
    return state.phase === 'back';
  },

  actions(state, seat) {
    if (state.phase === 'over') return [];
    if (state.phase === 'back') {
      const b = state.tribute.backs.find((x) => x.from === seat && x.card === null);
      if (!b) return [];
      return backChoices(state, seat).map((c) => ({ id: `${BACK} ${cardName(c)}`, label: `还贡 ${cardName(c)}` }));
    }
    if (seat !== state.turn) return [];
    const out = candidatePlays(state, seat).map((p) => ({ id: playId(p.cards, p, state.level), label: comboText(p, state.level) }));
    if (state.trick.last) out.push({ id: PASS, label: '不出' });
    return out;
  },

  apply(state, seat, action) {
    if (state.phase === 'over') throw new Error('对局已经结束');
    const a = String(action ?? '').trim();
    const s = clone(state);
    if (s.phase === 'back') {
      const b = s.tribute.backs.find((x) => x.from === seat && x.card === null);
      if (!b) throw new Error(`现在不是${seatName(seat)}还贡`);
      const m = /^(?:还贡|还)\s*[:：]?\s*(.+)$/.exec(a);
      const r = resolveOne(m ? m[1] : a, s.cards[seat], s.level);
      if (r.error) throw new Error(r.error);
      if (!backChoices(s, seat).includes(r.card)) throw new Error(`只能还点数不超过 10 的牌（全都大于 10 时还最小的一张）：${cardName(r.card)} 不行`);
      b.card = r.card;
      s.cards[seat] = removeCards(s.cards[seat], [r.card]);
      s.cards[b.to] = [...s.cards[b.to], r.card].sort((x, y) => x - y);
      if (s.tribute.backs.every((x) => x.card !== null)) {
        s.phase = 'play';
        s.turn = s.tribute.leader;
      }
      return s;
    }
    if (seat !== s.turn) throw new Error(`现在不是${seatName(seat)}出牌`);
    const last = s.trick.last;
    if (a === PASS || a === '不出') {
      if (!last) throw new Error('这一轮由你领出，不能不出');
      s.plays.push({ seat, cards: null, type: null, key: null, n: 0, trick: s.trick.n });
      s.trick.passes += 1;
      const active = activeSeats(s);
      const need = active.length - (active.includes(last.seat) ? 1 : 0);
      if (s.trick.passes >= need) {
        const wind = !active.includes(last.seat);
        const leader = wind ? partnerOf(last.seat) : last.seat;
        s.trick = { n: s.trick.n + 1, leader, last: null, passes: 0, wind };
        s.turn = leader;
      } else s.turn = nextActive(s, seat);
      return s;
    }
    const r = resolvePlay(a, s.cards[seat], s.level, last);
    if (r.error) throw new Error(r.error);
    const { cards, combo } = r;
    s.cards[seat] = removeCards(s.cards[seat], cards);
    const rec = { seat, cards, type: combo.type, key: combo.key, n: combo.n };
    s.plays.push({ ...rec, trick: s.trick.n });
    s.trick.last = rec;
    s.trick.passes = 0;
    if (!s.cards[seat].length) {
      s.order.push(seat);
      const head = s.order[0];
      const oppsOut = teamSeats(otherTeam(teamOf(head))).every((x) => s.order.includes(x));
      if (s.order.includes(partnerOf(head)) || oppsOut || activeSeats(s).length <= 1) {
        endHand(s);
        return s;
      }
    }
    s.turn = nextActive(s, seat);
    return s;
  },

  outcome(state) {
    if (state.phase !== 'over') return { over: false };
    const W = state.winner;
    const ranks = Object.fromEntries(SEATS.map((x) => [x, teamOf(x) === W ? 1 : 2]));
    const last = state.history.at(-1);
    const winner = teamOf(last.order[0]) === W ? last.order[0] : teamSeats(W)[0];
    const lv = (t) => rankName(state.levels[t]);
    let reason;
    if (state.passA) reason = `${TEAM_NAMES[W]}第 ${last.hand} 盘打过 A（${POS_NAMES[0]} + ${POS_NAMES[last.partnerPos - 1]}）`;
    else {
      const tie = state.levels.A === state.levels.B;
      reason = `打满 ${state.total} 盘：${TEAM_NAMES.A}打到 ${lv('A')}，${TEAM_NAMES.B}打到 ${lv('B')}${tie ? `，同级看最后一盘头游` : ''}`;
    }
    return { over: true, winner, winnerTeam: TEAM_NAMES[W], ranks, teams: { [TEAM_NAMES.A]: teamSeats('A'), [TEAM_NAMES.B]: teamSeats('B') }, reason };
  },

  forfeit(state, seat, reason) {
    const lose = teamOf(seat);
    const ranks = Object.fromEntries(SEATS.map((x) => [x, teamOf(x) === lose ? 2 : 1]));
    return { over: true, winner: SEATS.find((x) => ranks[x] === 1), winnerTeam: TEAM_NAMES[otherTeam(lose)], ranks, teams: { [TEAM_NAMES.A]: teamSeats('A'), [TEAM_NAMES.B]: teamSeats('B') }, reason };
  },

  label(state, seat, action) {
    const a = String(action ?? '').trim();
    if (a === PASS || a === '不出') return '不出';
    if (state.phase === 'back') {
      const m = /^(?:还贡|还)\s*[:：]?\s*(.+)$/.exec(a);
      const r = resolveOne(m ? m[1] : a, state.cards[seat] || [], state.level);
      return r.error ? a : `还贡 ${cardName(r.card)}`;
    }
    if (state.phase === 'play' && state.cards?.[seat]) {
      const r = resolvePlay(a, state.cards[seat], state.level, state.trick.last);
      if (!r.error) return comboText({ ...r.combo, cards: r.cards }, state.level);
    }
    return a;
  },

  // ---------- 给模型 ----------
  systemPrompt(seat, { style = '' } = {}) {
    return [
      `你在玩掼蛋（4 人两队），坐在${seatName(seat)}。1、3 号位一队，2、4 号位一队，对家是队友，出牌顺序 1→2→3→4。`,
      '',
      '【牌】两副牌 108 张，每人 27 张。每盘有「级牌」（点数等于本盘级数）：单张、对子、三张、三带二、炸弹里级牌大于 A、小于小王；在顺子、三连对、钢板、同花顺里按本来位置。红桃级牌叫「逢人配」，可以当除大小王以外的任意牌。大小：2 < 3 < … < K < A < 级牌 < 小王 < 大王；顺子类里 A 可以当 1（A2345）。',
      '【牌型】单张；对子；三张；三带二（三张 + 一对，只比三张）；顺子（正好 5 张连续）；三连对（3 个连续对子，如 556677）；钢板（2 个连续三张，如 555666）；炸弹（4–10 张同点数，张数多的大，同张数比点数）；同花顺（同花色 5 张连续）；四大天王（两张小王 + 两张大王，最大）。',
      '【压牌】跟牌要出同牌型、更大的牌，或出炸弹类。炸弹类从小到大：4 张炸弹 < 5 张炸弹 < 同花顺 < 6 张炸弹 < 7 张 < 8 张 … < 四大天王。别人都不出时最后出牌的人重新领出；他已出完时由他的队友接风领出。领出时不能不出。',
      '【名次与升级】先出完的是头游，依次二游、三游、末游。头游一队升级：队友二游（双下）升 3 级，三游升 2 级，末游升 1 级，不能越过 A。两队从 2 打起，每盘打头游一队的级。打 A 的队拿头游且队友不是末游，就打过 A、赢下整场；打 A 三次没过退回 2。',
      '【进贡】从第二盘起，末游把除逢人配外最大的一张牌贡给头游，头游还一张点数不超过 10 的牌（没有就还最小的），进贡的人先出；双下时两人都进贡，大的给头游；进贡方合计有两张大王可以抗贡（不进贡，头游先出）。',
      '【整场】打满规定盘数或有一队打过 A 时结束，级数高的队赢。',
      '【手牌写法】点数后面跟这几张的花色，例如「A♠♦♦」是三张 A（一张黑桃、两张方块），「小王×2」是两张小王。',
      '',
      ...FORMAT_LINES,
      style ? `\n【你的风格】${style}\n（风格只影响你的打法取向，不能改变上面的规则和输出格式。）` : '',
    ].join('\n');
  },

  turnPrompt(state, seat, { showLegal = false } = {}) {
    const s = state;
    const T = teamOf(seat);
    const lv = rankName(s.level);
    const head = `【第 ${s.handNo}/${s.total} 盘${s.phase === 'back' ? ' · 还贡' : ` · 第 ${s.trick.n} 轮`}】你是${seatName(seat)}（${TEAM_NAMES[T]}，队友${seatName(partnerOf(seat))}坐你对面）。`;
    const levels = `级数：${TEAM_NAMES.A} ${rankName(s.levels.A)}，${TEAM_NAMES.B} ${rankName(s.levels.B)}；本盘打 ${lv}${s.levelTeam ? `（${TEAM_NAMES[s.levelTeam]}的级${s.levels[s.levelTeam] === 14 ? `，打 A 第 ${s.aFails[s.levelTeam] + 1} 次` : ''}）` : ''}。级牌 ${lv}，逢人配 ♥${lv}。`;
    const hand = `你的手牌（${s.cards[seat].length} 张，从大到小）：${handText(s.cards[seat], s.level)}`;
    if (s.phase === 'back') {
      const b = s.tribute.backs.find((x) => x.from === seat);
      const pay = s.tribute.pays.find((p) => p.to === seat);
      const prev = s.history.at(-1);
      return [
        head, levels,
        `上一盘名次：${prev.order.map((x, i) => `${seatName(x)}${POS_NAMES[i]}`).join('、')}。`,
        `${seatName(pay.from)}向你进贡了 ${cardName(pay.card)}。你要还给${seatName(b.to)}一张牌：只能还点数不超过 10 的牌（全都大于 10 时还最小的一张）。`,
        hand,
        `可以还：${backChoices(s, seat).map(cardName).join(' ')}`,
        '',
        `请按五行格式回答，最后一行写「还贡：…」，例如「还贡：${cardName(backChoices(s, seat)[0])}」。`,
      ].join('\n');
    }
    const last = s.trick.last;
    const others = SEATS.filter((x) => x !== seat).map((x) => {
      const pos = s.order.indexOf(x);
      const n = s.cards[x].length;
      return `${who(x, seat)}${pos >= 0 ? ` 已出完（${POS_NAMES[pos]}）` : ` ${n} 张${n <= 10 ? '（报牌）' : ''}`}`;
    });
    const lines = [head, levels, hand, `各家剩余：${others.join('；')}`];
    if (s.order.length) lines.push(`本盘已出完：${s.order.map((x, i) => `${who(x, seat)}${POS_NAMES[i]}`).join('、')}`);
    const tt = s.plays.length < 12 ? tributeText(s, seat) : null;
    if (tt) lines.push(tt);
    lines.push(`别家还可能有的大牌：${bigUnseen(s, seat)}`);
    const hist = tricksText(s, seat);
    if (hist.length) lines.push(`最近的出牌：\n${hist.map((h) => `  ${h}`).join('\n')}`);
    if (!last) lines.push(`本轮由你领出${s.trick.wind ? '（队友出完了，你接风）' : ''}，可以出任意牌型，不能不出。`);
    else lines.push(`本轮要压的牌：${who(last.seat, seat)}出的 ${comboText(last, s.level)}。你可以出同牌型更大的，或炸弹类，或者「出牌：不出」。`);
    if (showLegal) {
      const acts = game.actions(s, seat).filter((x) => x.id !== PASS).slice(0, 30);
      lines.push(`可以考虑的出法（部分）：${acts.map((x) => x.label).join('；')}`);
    }
    lines.push('', '请按五行格式回答，最后一行写「出牌：…」。');
    return lines.join('\n');
  },

  retryPrompt: (reason, attempt, max) => `你上一个回答无效：${reason}。请重新回答（这是第 ${attempt} 次重来，最多 ${max} 次，再无效判负），仍按五行格式回答。`,

  parseReply(state, seat, text) {
    const t = String(text || '').normalize('NFKC').replace(/[*`#]/g, '');
    const win = /胜率\s*[:：]\s*(\d{1,3})/.exec(t);
    const winrate = win ? Math.min(100, Number(win[1])) : null;
    const res = (r) => ({ action: r.error ? null : r.action, attempted: r.attempted ?? null, winrate, error: r.error || null });
    if (state.phase === 'over') return res({ error: '对局已经结束' });
    if (!game.pending(state).includes(seat)) return res({ error: `现在不是${seatName(seat)}行动` });
    if (state.phase === 'back') {
      const line = [...t.matchAll(/还(?:贡|牌)?\s*[:：]\s*([^\n]*)/g)].pop();
      if (!line) return res({ error: '现在是还贡阶段，最后一行应写「还贡：♣5」这样的格式（一张点数不超过 10 的牌）' });
      const raw = line[1].trim().replace(/[。.！!]+$/, '');
      const r = resolveOne(raw, state.cards[seat], state.level);
      if (r.error) return res({ attempted: raw.slice(0, 20), error: `${r.error}，请写一张能还的牌：${backChoices(state, seat).map(cardName).join(' ')}` });
      const id = `${BACK} ${cardName(r.card)}`;
      try { game.apply(state, seat, id); } catch (e) { return res({ attempted: id, error: `${e.message}，能还的牌：${backChoices(state, seat).map(cardName).join(' ')}` }); }
      return res({ action: id, attempted: id });
    }
    const line = [...t.matchAll(/出牌\s*[:：]\s*([^\n]*)/g)].pop();
    if (!line) return res({ error: '没有找到出牌（最后一行应为「出牌：5 5 5 8 8」或「出牌：不出」这样的格式）' });
    const raw = line[1].trim().replace(/[。.！!]+$/, '');
    const last = state.trick.last;
    if (/^(不出|不要|要不起|过|pass)/i.test(raw)) {
      if (!last) return res({ attempted: '不出', error: '这一轮由你领出，不能不出，必须出一手牌' });
      return res({ action: PASS, attempted: '不出' });
    }
    const r = resolvePlay(raw, state.cards[seat], state.level, last);
    if (r.error) return res({ attempted: raw.slice(0, 40), error: `${r.error}。请按点数写出每张牌并用空格分开，例如「出牌：5 5 5 8 8」，要用逢人配或凑同花顺时写花色` });
    return res({ action: playId(r.cards, r.combo, state.level), attempted: comboText({ ...r.combo, cards: r.cards }, state.level) });
  },

  mockReply(state, seat, action) {
    if (state.phase === 'back') return `判断：要还一张小牌。\n推断：对方手里大牌不少。\n理由：还最没用的单张。\n胜率：50%\n还贡：${String(action).replace(/^还贡\s*/, '')}`;
    const pass = action === PASS;
    // 逢人配写成「♥7当5」，组法不会被认成别的
    let cardsPart = pass ? '不出' : String(action).split('=')[0];
    const r = pass ? null : resolvePlay(String(action), state.cards[seat], state.level, state.trick.last);
    if (r && !r.error) cardsPart = layout(r.cards, r.combo, state.level).map((x) => `${cardName(x.c)}${x.as ? `当${rankName(x.as)}` : ''}`).join(' ');
    return `判断：局面胶着。\n推断：对手还握着炸弹。\n理由：${pass ? '这手不值得压' : '先把这手牌走掉'}。\n胜率：50%\n出牌：${cardsPart}`;
  },

  // ---------- 内置 AI ----------
  builtinMove(state, seat, { level = 2, random = false } = {}) {
    const acts = game.actions(state, seat);
    if (!acts.length) throw new Error('没有可行的行动');
    if (random || level <= 1) return acts[Math.floor(Math.random() * acts.length)].id;
    if (state.phase === 'back') {
      const c = chooseBack(state.cards[seat], state.level, backChoices(state, seat));
      return `${BACK} ${cardName(c)}`;
    }
    const known = [...state.cards[seat]];
    for (const p of state.plays) if (p.cards) known.push(...p.cards);
    const p = choosePlay({
      hand: state.cards[seat], level: state.level, last: state.trick.last, lastSeat: state.trick.last?.seat || null,
      seat, partner: partnerOf(seat), counts: Object.fromEntries(SEATS.map((x) => [x, state.cards[x].length])),
      active: activeSeats(state), known, ai: level >= 3 ? 3 : 2,
    });
    if (!p) return state.trick.last ? PASS : acts[0].id;
    return playId(p.cards, p, state.level);
  },

  // ---------- 浏览器数据 ----------
  view(state, viewer = null) {
    const s = state;
    const over = s.phase === 'over';
    const god = viewer === null || viewer === undefined;
    const see = (x) => god || over || viewer === x;
    const lv = s.level;
    const showPlay = (p) => {
      const lay = layout(p.cards, p, lv);
      return { cards: lay.map((x) => cardName(x.c)), as: lay.map((x) => (x.as ? rankName(x.as) : '')), type: typeText(p), key: keyText(p, lv), bomb: isBomb(p) };
    };
    const trickPlays = (n) => {
      const m = {};
      for (const p of s.plays) if (p.trick === n) m[p.seat] = p.cards ? showPlay(p) : { pass: true };
      return m;
    };
    let table = trickPlays(s.trick.n), stale = false;
    if (!Object.keys(table).length && s.trick.n > 1) { table = trickPlays(s.trick.n - 1); stale = true; }
    const t = s.tribute;
    const tribute = t ? {
      anti: t.anti, antiBy: t.antiBy.slice(), leader: t.leader,
      pays: t.pays.map((p) => ({ from: p.from, to: p.to, card: cardName(p.card) })),
      backs: t.backs.map((b) => ({ from: b.from, to: b.to, done: b.card !== null, card: b.card !== null && (god || over || viewer === b.from || viewer === b.to) ? cardName(b.card) : null })),
    } : null;
    const hist = s.history.map((h) => ({
      hand: h.hand, level: rankName(h.level), levelTeam: h.levelTeam, order: h.order.slice(), team: h.team, partnerPos: h.partnerPos,
      up: h.up, before: { A: rankName(h.before.A), B: rankName(h.before.B) }, after: { A: rankName(h.after.A), B: rankName(h.after.B) },
      passA: h.passA, aFail: h.aFail, reset: h.reset, left: { ...h.left },
      last: h.last ? { seat: h.last.seat, ...showPlay({ ...h.last }), } : null,
    }));
    const lead = s.trick.last ? { seat: s.trick.last.seat, ...showPlay(s.trick.last), combo: { type: s.trick.last.type, key: s.trick.last.key, n: s.trick.last.n } } : null;
    return {
      phase: s.phase,
      over,
      viewer: viewer ?? null,
      seats: SEATS,
      seatNames: SEAT_NAMES,
      teamOf: Object.fromEntries(SEATS.map((x) => [x, teamOf(x)])),
      teamNames: TEAM_NAMES,
      handNo: s.handNo,
      total: s.total,
      level: rankName(lv),
      levelRank: lv,
      levelTeam: s.levelTeam,
      levels: { A: rankName(s.levels.A), B: rankName(s.levels.B) },
      aFails: { ...s.aFails },
      hands: Object.fromEntries(SEATS.map((x) => [x, see(x) ? names(sortByPower(s.cards[x], lv)) : null])),
      counts: Object.fromEntries(SEATS.map((x) => [x, s.cards[x].length])),
      finished: s.order.slice(),
      turn: over ? null : s.turn,
      pending: game.pending(s),
      lead,
      table, stale,
      trickNo: s.trick.n,
      wind: s.trick.wind && !s.trick.last ? s.trick.leader : null,
      plays: s.plays.map((p) => ({ seat: p.seat, trick: p.trick, ...(p.cards ? showPlay(p) : { cards: null }) })),
      tribute,
      history: hist,
      roles: Object.fromEntries(s.order.map((x, i) => [x, POS_NAMES[i]])),
      out: [],
      result: over ? { winnerTeam: s.winner, passA: s.passA, levels: { A: rankName(s.levels.A), B: rankName(s.levels.B) }, hands: s.history.length, total: s.total, last: hist.at(-1) } : null,
    };
  },
};

/** 给 fxDuration 的局面摘要 */
function fxSummary(s) {
  if (!s) return null;
  const lp = s.plays.at(-1);
  return { hand: s.handNo, phase: s.phase, plays: s.plays.length, bomb: !!(lp && lp.cards && isBomb(lp)), over: s.phase === 'over' };
}

export { FX, TEAM_NAMES, teamOf, partnerOf, handText, interpret, pickInterp, beats, suitOf };
export default game;
