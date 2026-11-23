// 德州扑克（无限注，2–6 人，固定手数）。实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。
// 座位 p1…p6 按顺时针排列；每手庄位顺时针轮转，两人时庄位是小盲、翻牌前先行动。
// 行动 id：fold、check、call、raise:<本轮加注到的总额>（第一次下注也用它）、allin。

import {
  code, cardText, cardsText, evaluate, handName, bestFive, equity, equityVsRandom, chen,
  makeRng, hashSeed, shuffledDeck,
} from './cards.js';

const MAX = 6;
const STREET_CN = ['翻牌前', '翻牌', '转牌', '河牌', '摊牌'];
const STREET_ID = ['preflop', 'flop', 'turn', 'river', 'showdown'];
const EQUITY_SIMS = 400;

const seatId = (i) => `p${i + 1}`;
export function seatIdx(seat) {
  const m = /^p([1-6])$/.exec(String(seat));
  return m ? Number(m[1]) - 1 : -1;
}
const nameOf = (i) => `${i + 1} 号位`;

// ---------- 小工具 ----------

/** 从 from 之后顺时针找第一个满足条件的座位，找不到返回 -1 */
function nextIdx(n, from, pred) {
  for (let k = 1; k <= n; k++) {
    const j = (from + k) % n;
    if (pred(j)) return j;
  }
  return -1;
}
const live = (h) => h.inHand.map((x, j) => (x && !h.folded[j] ? j : -1)).filter((j) => j >= 0);
const canAct = (h, j) => h.inHand[j] && !h.folded[j] && !h.allin[j];
const othersCanAct = (h, i) => h.inHand.some((_, j) => j !== i && canAct(h, j));
const potTotal = (h) => h.contrib.reduce((a, b) => a + b, 0);

/** 这个座位现在是否还需要行动 */
function needsAction(h, j) {
  if (!canAct(h, j)) return false;
  if (h.bet[j] < h.currentBet) return true;
  return !h.acted[j] && othersCanAct(h, j);
}

/** 某座位当前的合法范围 */
export function legal(s, i) {
  const h = s.hand;
  const stack = s.stacks[i];
  const owe = Math.max(0, h.currentBet - h.bet[i]);
  const toCall = Math.min(owe, stack);
  const maxTo = h.bet[i] + stack;
  const others = othersCanAct(h, i);
  // 加注是否对他重新开放：本轮还没行动过，或者他上次行动后累计的加注幅度达到一次完整加注
  const open = !h.acted[i] || h.currentBet - h.faced[i] >= h.minRaise;
  const canRaise = open && others && stack > owe;
  const minTo = Math.min(h.currentBet + h.minRaise, maxTo);
  return { stack, owe, toCall, maxTo, minTo, canRaise, raiseOpen: open, othersCanAct: others, canCheck: owe === 0, pot: potTotal(h), currentBet: h.currentBet };
}

/** 底池拆分：按投入额分层；未全下的在局玩家可以参与所有层（还能继续补齐） */
export function buildPots(h) {
  const levels = [...new Set(h.contrib.filter((c) => c > 0))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const L of levels) {
    let amount = 0;
    for (const c of h.contrib) amount += Math.max(0, Math.min(c, L) - prev);
    const eligible = live(h).filter((j) => (h.allin[j] ? h.contrib[j] >= L : true));
    prev = L;
    if (!amount) continue;
    const last = pots[pots.length - 1];
    if (!eligible.length) {
      if (last) last.amount += amount; else pots.push({ amount, eligible: live(h) });
    } else if (last && last.eligible.length === eligible.length && last.eligible.every((j, k) => j === eligible[k])) last.amount += amount;
    else pots.push({ amount, eligible });
  }
  return pots;
}

/** 把行动 id 解析成 { kind, to } */
function parseId(action) {
  const a = String(action || '').trim().toLowerCase();
  if (a === 'fold' || a === 'check' || a === 'call' || a === 'allin') return { kind: a };
  const m = /^raise:(\d+)$/.exec(a);
  if (m) return { kind: 'raise', to: Number(m[1]) };
  return null;
}

// ---------- 状态推进（以下函数都直接修改传入的 s，调用方负责先复制） ----------

function post(s, i, amount) {
  const h = s.hand;
  const amt = Math.min(amount, s.stacks[i]);
  s.stacks[i] -= amt;
  h.bet[i] += amt;
  h.contrib[i] += amt;
  if (s.stacks[i] === 0) h.allin[i] = true;
  return amt;
}

function log(s, i, kind, amount, text) {
  const h = s.hand;
  h.log.push({ i, st: h.street, kind, amount, to: h.bet[i], text: h.allin[i] && kind !== 'fold' && kind !== 'check' ? `${text}（全下）` : text });
}

function startHand(s) {
  const { n, cfg } = s;
  const has = (j) => s.stacks[j] > 0;
  const button = s.button < 0 ? nextIdx(n, n - 1, has) : nextIdx(n, s.button, has);
  const active = s.stacks.map((v, j) => (v > 0 ? j : -1)).filter((j) => j >= 0);
  const heads = active.length === 2;
  const sb = heads ? button : nextIdx(n, button, has);
  const bb = nextIdx(n, sb, has);
  s.button = button;
  s.handNo++;
  // 种子随机数（mulberry32）的状态存在 s.rng 里，每次取数推进一步
  const rand = () => { const r = makeRng(s.rng)(); s.rng = (s.rng + 0x6d2b79f5) >>> 0; return r; };
  const deck = shuffledDeck(rand);
  const fill = (v) => new Array(n).fill(v);
  const h = {
    no: s.handNo, button, sb, bb, deck, pos: 0,
    hole: fill(null), board: [], street: 0,
    inHand: s.stacks.map((v) => v > 0), folded: fill(false), allin: fill(false),
    bet: fill(0), contrib: fill(0), acted: fill(false), faced: fill(0),
    currentBet: 0, minRaise: cfg.bb, toAct: -1, log: [], done: false, result: null,
  };
  s.hand = h;
  for (const j of active) s.played[j]++;
  // 从小盲开始顺时针每人发一张，发两轮
  for (let round = 0; round < 2; round++) {
    let j = sb;
    for (let k = 0; k < active.length; k++) {
      (h.hole[j] ||= []).push(deck[h.pos++]);
      j = nextIdx(n, j, (x) => h.inHand[x]);
    }
  }
  log(s, sb, 'sb', post(s, sb, cfg.sb), `小盲 ${h.contrib[sb]}`);
  log(s, bb, 'bb', post(s, bb, cfg.bb), `大盲 ${h.contrib[bb]}`);
  h.currentBet = cfg.bb;
  h.minRaise = cfg.bb;
  const first = nextIdx(n, bb, (j) => needsAction(h, j));
  if (first >= 0) h.toAct = first;
  else endStreet(s);
}

/** 一条街结束：发下一条街；能行动的人不足两个时直接发完到摊牌 */
function endStreet(s) {
  const h = s.hand;
  h.toAct = -1;
  while (true) {
    if (h.street >= 3) return showdown(s);
    h.street++;
    const k = h.street === 1 ? 3 : 1;
    for (let t = 0; t < k; t++) h.board.push(h.deck[h.pos++]);
    h.bet.fill(0); h.acted.fill(false); h.faced.fill(0);
    h.currentBet = 0;
    h.minRaise = s.cfg.bb;
    const first = nextIdx(s.n, h.button, (j) => needsAction(h, j));
    if (first >= 0) { h.toAct = first; return; }
  }
}

/** 赢家按庄位左侧第一位开始的顺时针顺序排列 */
const clockwiseFromButton = (s, list) => list.slice().sort((a, b) => ((a - s.hand.button - 1 + s.n) % s.n) - ((b - s.hand.button - 1 + s.n) % s.n));

function showdown(s) {
  const h = s.hand;
  h.street = 4;
  const lv = live(h);
  const scores = {};
  for (const j of lv) scores[j] = evaluate([...h.hole[j], ...h.board]);
  const payouts = new Array(s.n).fill(0);
  const pots = [];
  for (const p of buildPots(h)) {
    const best = Math.max(...p.eligible.map((j) => scores[j]));
    const winners = clockwiseFromButton(s, p.eligible.filter((j) => scores[j] === best));
    const share = Math.floor(p.amount / winners.length);
    for (const w of winners) payouts[w] += share;
    payouts[winners[0]] += p.amount - share * winners.length; // 余数给庄位左侧第一位赢家
    pots.push({ amount: p.amount, winners, eligible: p.eligible, hand: p.eligible.length > 1 ? handName(best) : null });
  }
  const hands = {};
  for (const j of lv) hands[j] = { name: handName(scores[j]), best: bestFive([...h.hole[j], ...h.board]) };
  h.result = { showdown: true, pots, shown: lv, hands, payouts };
  finishHand(s, payouts);
}

function winUncontested(s, w) {
  const h = s.hand;
  const payouts = new Array(s.n).fill(0);
  payouts[w] = potTotal(h);
  h.result = { showdown: false, pots: [{ amount: payouts[w], winners: [w], eligible: [w], hand: null }], shown: [], hands: {}, payouts };
  finishHand(s, payouts);
}

/** 一手牌的文字小结，例如「3 号位 两对 A 和 8 赢下 86」 */
function handSummary(s, h) {
  const r = h.result;
  if (!r.showdown) return `其他人弃牌，${nameOf(r.pots[0].winners[0])}赢下 ${r.pots[0].amount}`;
  const parts = [];
  r.pots.forEach((p, k) => {
    const label = r.pots.length > 1 ? (k === 0 ? '主池' : `边池 ${k}`) : '底池';
    if (p.eligible.length === 1) { parts.push(`${nameOf(p.winners[0])}收回未被跟注的 ${p.amount}`); return; }
    const who = p.winners.map(nameOf).join('、');
    const sp = /[0-9A-Z]$/.test(p.hand) ? ' ' : '';
    parts.push(`${who}以${p.hand}${sp}${p.winners.length > 1 ? '平分' : '赢下'}${label} ${p.amount}`);
  });
  return parts.join('；');
}

function finishHand(s, payouts) {
  const h = s.hand;
  for (let j = 0; j < s.n; j++) s.stacks[j] += payouts[j];
  h.done = true;
  h.toAct = -1;
  h.result.net = h.contrib.map((c, j) => (h.inHand[j] ? payouts[j] - c : 0));
  h.result.text = handSummary(s, h);
  s.bb100 = s.stacks.map((v, j) => (s.played[j] ? Math.round(((v - s.cfg.stack) / s.cfg.bb / s.played[j]) * 1000) / 10 : 0));
  s.last = {
    no: h.no, button: h.button, board: h.board.slice(), showdown: h.result.showdown,
    shown: Object.fromEntries(h.result.shown.map((j) => [j, h.hole[j].slice()])),
    hands: Object.fromEntries(Object.entries(h.result.hands).map(([j, v]) => [j, v.name])),
    net: h.result.net.slice(), text: h.result.text,
  };
  const alive = s.stacks.filter((v) => v > 0).length;
  if (s.handNo >= s.cfg.hands || alive < 2) {
    s.over = true;
    return;
  }
  startHand(s);
}

function afterAction(s, i) {
  const h = s.hand;
  const lv = live(h);
  if (lv.length === 1) return winUncontested(s, lv[0]);
  const j = nextIdx(s.n, i, (k) => needsAction(h, k));
  if (j >= 0) { h.toAct = j; return; }
  endStreet(s);
}

function raiseTo(s, i, X) {
  const h = s.hand;
  const verb = h.currentBet === 0 ? '下注' : '加注到';
  const inc = X - h.currentBet;
  post(s, i, X - h.bet[i]);
  if (inc >= h.minRaise) h.minRaise = inc; // 完整加注才更新最小加注幅度；不足的全下不重新开放加注
  h.currentBet = X;
  h.acted[i] = true;
  h.faced[i] = X;
  log(s, i, 'raise', X, `${verb} ${X}`);
}

/** 执行一个行动（不推进轮次）；不合法时抛出说明合法范围的错误 */
function doAction(s, i, act) {
  const h = s.hand;
  const L = legal(s, i);
  const range = () => (L.minTo < L.maxTo ? `可以加注到 ${L.minTo}–${L.maxTo}（${L.maxTo} 即全下）` : `筹码只够全下（${L.maxTo}）`);
  const noRaise = () => {
    if (L.stack <= L.owe) return `你的筹码不够加注，只能跟注（全下 ${L.maxTo}）或弃牌`;
    if (!L.othersCanAct) return '其他玩家都已全下，不能再加注，只能跟注或弃牌';
    return '对手的全下不足最小加注，没有重新开放加注，你只能跟注或弃牌';
  };
  switch (act.kind) {
    case 'fold':
      h.folded[i] = true;
      h.acted[i] = true;
      log(s, i, 'fold', 0, '弃牌');
      return;
    case 'check':
      if (L.owe > 0) throw new Error(`现在需要跟注 ${L.toCall}，不能过牌（可以弃牌、跟注${L.canRaise ? '、加注' : ''}或全下）`);
      h.acted[i] = true;
      h.faced[i] = h.currentBet;
      log(s, i, 'check', 0, '过牌');
      return;
    case 'call':
      if (L.owe === 0) return doAction(s, i, { kind: 'check' });
      post(s, i, L.toCall);
      h.acted[i] = true;
      h.faced[i] = h.currentBet;
      log(s, i, 'call', L.toCall, `跟注 ${L.toCall}`);
      return;
    case 'allin':
      if (L.stack <= L.owe) return doAction(s, i, { kind: 'call' });
      if (!L.canRaise) throw new Error(noRaise());
      return raiseTo(s, i, L.maxTo);
    case 'raise': {
      const X = act.to;
      if (!Number.isInteger(X)) throw new Error('加注额必须是整数');
      if (!L.canRaise) throw new Error(noRaise());
      if (X <= h.currentBet) throw new Error(`加注到 ${X} 不比当前最高下注 ${h.currentBet} 多；${range()}`);
      if (X > L.maxTo) throw new Error(`你最多只能加注到 ${L.maxTo}（全下）；${range()}`);
      if (X < L.minTo) throw new Error(`加注额不足：最小加注到 ${L.minTo}；${range()}`);
      return raiseTo(s, i, X);
    }
    default:
      throw new Error('无法识别的行动');
  }
}

// ---------- 展示用的文字 ----------

const pctText = (v) => `${Math.round(v * 100)}%`;
function positions(s) {
  const h = s.hand;
  const heads = h.inHand.filter(Boolean).length === 2;
  const pos = {};
  pos[h.button] = heads ? '庄位·小盲' : '庄位';
  if (!heads) pos[h.sb] = '小盲';
  pos[h.bb] = '大盲';
  return pos;
}

function boardLine(h) {
  if (!h.board.length) return '还没有发公共牌（翻牌前）';
  const names = ['翻牌', '翻牌', '翻牌', '转牌', '河牌'];
  return `${cardsText(h.board)}（已发到${names[h.board.length - 1]}）`;
}

function logLines(h) {
  const lines = [];
  for (let st = 0; st <= Math.min(h.street, 3); st++) {
    if (h.board.length < [0, 3, 4, 5][st]) break;
    const items = h.log.filter((e) => e.st === st);
    const board = st === 1 ? h.board.slice(0, 3) : st === 2 ? [h.board[3]] : st === 3 ? [h.board[4]] : [];
    const head = st === 0 ? '翻牌前' : `${STREET_CN[st]} ${cardsText(board)}`;
    lines.push(`${head}：${items.length ? items.map((e) => `${nameOf(e.i)} ${e.text}`).join('，') : '（无人行动）'}`);
  }
  return lines;
}

function actionWord(action) {
  const a = parseId(action);
  if (!a) return String(action);
  return { fold: '弃牌', check: '过牌', call: '跟注', allin: '全下' }[a.kind] || `加注到 ${a.to}`;
}

// ---------- 解析模型回答 ----------

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnToInt(t) {
  if (/^\d+$/.test(t)) return Number(t);
  let total = 0, section = 0, num = 0;
  for (const ch of t) {
    if (ch in CN_DIGIT) num = CN_DIGIT[ch];
    else if (ch === '十') { section += (num || 1) * 10; num = 0; }
    else if (ch === '百') { section += num * 100; num = 0; }
    else if (ch === '千') { section += num * 1000; num = 0; }
    else if (ch === '万') { total += (section + num) * 10000; section = 0; num = 0; }
    else return NaN;
  }
  return total + section + num;
}
const NUM = '(\\d+|[零〇一二两三四五六七八九十百千万]+)';
const RAISE_RE = new RegExp(`(?:加注到|加注至|加到|加至|加注|再加到|下注到|下注|\\bbet\\s*to|\\bbet|\\braise\\s*to|\\braise)\\s*(?:到|至|to)?\\s*${NUM}`, 'i');

/** 把一段行动文字解析成 { kind, to }；找不到返回 null，有加注词但没有金额返回 { kind: 'raise', to: null } */
export function parseActionText(text) {
  const t = String(text || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/[*`_]/g, '');
  // 去掉括号里的说明（「弃牌（对手全下，赔率不够）」），再取最先出现的行动词，避免说明里的词抢先
  const u = t.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ');
  const cands = [
    ['allin', /全下|全押|梭哈|all[\s-]*in|shove|jam/i],
    ['raise', RAISE_RE],
    ['fold', /弃牌|弃掉|盖牌|\bfold\b|^\s*弃\s*$/i],
    ['call', /跟注|\bcall\b|^\s*跟\s*$|跟进|跟\s*\d/i],
    ['check', /过牌|让牌|\bcheck\b|^\s*过\s*$|看牌/i],
    ['raise?', /加注|下注|raise|\bbet\b/i],
  ];
  let best = null;
  const found = {};
  for (const [kind, re] of cands) {
    // 跳过被否定的词：「不加注，跟注」是跟注
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m;
    while ((m = g.exec(u))) {
      if (!/[不别没]\s*$/.test(u.slice(Math.max(0, m.index - 2), m.index))) break;
      if (!m[0].length) g.lastIndex++;
    }
    if (m) found[kind] = m;
    if (m && (!best || m.index < best.m.index)) best = { kind, m };
  }
  if (!best) return null;
  if (best.kind === 'raise') return { kind: 'raise', to: cnToInt(best.m[1]) };
  if (best.kind === 'raise?') return found.allin ? { kind: 'allin' } : { kind: 'raise', to: null }; // 「加注全下」「加注到全下」
  return { kind: best.kind };
}

// ---------- 胜率（上帝视角） ----------

function liveEquity(s) {
  const h = s.hand;
  if (h.done) return null;
  const lv = live(h);
  const dead = [];
  h.inHand.forEach((x, j) => { if (x && h.folded[j]) dead.push(...h.hole[j]); });
  const rand = makeRng(hashSeed(s.seed, h.no, h.board.length, h.log.length));
  const eq = equity(lv.map((j) => h.hole[j]), h.board, dead, { sims: EQUITY_SIMS, rand });
  const out = {};
  lv.forEach((j, k) => { out[j] = Math.round(eq[k] * 1000) / 1000; });
  return out;
}

// ---------- 游戏定义 ----------

const game = {
  id: 'poker',
  name: '德州扑克',
  players: { min: 2, max: MAX, default: 6 },
  features: { hidden: true, winbar: false, draw: false },
  noun: '行动',
  rankedSeries: { legs: 2, sameSeed: true },

  seats: (n = MAX) => Array.from({ length: n }, (_, i) => seatId(i)),
  seatName: (seat) => nameOf(seatIdx(seat)),

  /** setup：{ hands = 20, stack = 200, sb = 1, bb = 2, stacks?: 每个座位的起始筹码（测试用） } */
  create({ players = 6, seed = 1, setup = {} } = {}) {
    const n = Number(players);
    if (!Number.isInteger(n) || n < 2 || n > MAX) throw new Error(`德州扑克需要 2–${MAX} 人`);
    const hands = setup.hands ?? 20;
    if (!Number.isInteger(hands) || hands < 1 || hands > 1000) throw new Error('手数必须是 1–1000 的整数');
    const stack = setup.stack ?? 200, sb = setup.sb ?? 1, bb = setup.bb ?? 2;
    if (![stack, sb, bb].every((v) => Number.isInteger(v) && v > 0) || sb > bb || bb > stack) throw new Error('筹码和盲注必须是正整数，且小盲 ≤ 大盲 ≤ 起始筹码');
    const stacks = Array.isArray(setup.stacks) ? setup.stacks.slice(0, n) : new Array(n).fill(stack);
    if (stacks.length !== n || !stacks.every((v) => Number.isInteger(v) && v >= 0) || stacks.filter((v) => v > 0).length < 2) throw new Error('起始筹码不合法');
    const s = {
      n, seed: (Number(seed) || 0) >>> 0, rng: (Number(seed) || 0) >>> 0,
      cfg: { hands, stack, sb, bb }, stacks, played: new Array(n).fill(0), bb100: new Array(n).fill(0),
      handNo: 0, button: -1, hand: null, last: null, over: false,
    };
    startHand(s);
    return s;
  },

  pending(state) {
    if (state.over || state.hand.toAct < 0) return [];
    return [seatId(state.hand.toAct)];
  },

  actions(state, seat) {
    const i = seatIdx(seat);
    if (state.over || i !== state.hand.toAct) return [];
    const h = state.hand;
    const L = legal(state, i);
    const out = [];
    if (!L.canCheck) out.push({ id: 'fold', label: '弃牌' });
    if (L.canCheck) out.push({ id: 'check', label: '过牌' });
    else if (L.stack > L.owe) out.push({ id: 'call', label: `跟注 ${L.toCall}` });
    if (L.canRaise) {
      const verb = h.currentBet === 0 ? '下注' : '加注到';
      const base = L.pot + L.owe; // 跟注之后的底池
      const sizes = [['最小', L.minTo], ['½ 池', h.currentBet + base / 2], ['⅔ 池', h.currentBet + (base * 2) / 3], ['满池', h.currentBet + base], ['2 倍池', h.currentBet + base * 2]];
      const seen = new Set();
      for (const [hint, v0] of sizes) {
        const v = Math.round(v0);
        if (v < L.minTo || v >= L.maxTo || seen.has(v)) continue;
        seen.add(v);
        out.push({ id: `raise:${v}`, label: `${verb} ${v}`, hint });
      }
    }
    if (L.canRaise || L.stack <= L.owe) out.push({ id: 'allin', label: `全下 ${L.maxTo}` });
    return out;
  },

  apply(state, seat, action) {
    if (state.over) throw new Error('对局已经结束');
    const i = seatIdx(seat);
    if (i < 0 || i !== state.hand.toAct) throw new Error(`现在不是${i < 0 ? seat : nameOf(i)}行动`);
    const act = parseId(action);
    if (!act) throw new Error(`无法识别的行动：${action}`);
    const s = structuredClone(state);
    doAction(s, i, act);
    afterAction(s, i);
    return s;
  },

  outcome(state) {
    if (!state.over) return { over: false };
    const order = state.stacks.map((v, j) => [j, v]).sort((a, b) => b[1] - a[1]);
    const ranks = {};
    for (const [j, v] of order) ranks[seatId(j)] = 1 + state.stacks.filter((x) => x > v).length;
    const top = order.filter(([, v]) => v === order[0][1]).map(([j]) => j);
    const alive = state.stacks.filter((v) => v > 0).length;
    const topText = top.length > 1 ? `${top.map(nameOf).join('、')}并列第一（各 ${order[0][1]} 筹码）` : `${nameOf(top[0])} ${order[0][1]} 筹码第一`;
    const reason = alive < 2 ? `打到第 ${state.handNo} 手只剩 ${nameOf(top[0])}有筹码：${topText}` : `${state.handNo} 手结束：${topText}`;
    return { over: true, ranks, winner: top.length === 1 ? seatId(top[0]) : null, reason };
  },

  forfeit(state, seat, reason) {
    const i = seatIdx(seat);
    const h = state.hand;
    // 犯规者垫底；其余按当前筹码（含本手已投入）排名
    const worth = state.stacks.map((v, j) => v + (h && !h.done ? h.contrib[j] : 0));
    const others = worth.map((v, j) => [j, v]).filter(([j]) => j !== i);
    const ranks = { [seat]: state.n };
    for (const [j, v] of others) ranks[seatId(j)] = 1 + others.filter(([, x]) => x > v).length;
    const tops = others.filter(([j]) => ranks[seatId(j)] === 1);
    return { over: true, ranks, winner: tops.length === 1 ? seatId(tops[0][0]) : null, reason };
  },

  label(state, seat, action) {
    try {
      const i = seatIdx(seat);
      const s = structuredClone(state);
      doAction(s, i, parseId(action));
      return s.hand.log[s.hand.log.length - 1].text;
    } catch {
      return actionWord(action);
    }
  },

  // ---------- 给模型 ----------
  systemPrompt(seat, { style = '', players, state } = {}) {
    const cfg = state?.cfg || { hands: 20, stack: 200, sb: 1, bb: 2 };
    const n = state?.n || players || 6;
    return [
      `你是一名德州扑克牌手，坐在${game.seatName(seat)}。这是一场 ${n} 人无限注德州扑克，目标是这场结束时筹码最多。`,
      '',
      `【规则】每人起始 ${cfg.stack} 筹码，小盲 ${cfg.sb}、大盲 ${cfg.bb}，共打 ${cfg.hands} 手；只剩一人有筹码时提前结束。最后按筹码从多到少排名，输光筹码的人出局。`,
      '庄位每手顺时针轮转，庄位左边依次是小盲、大盲；翻牌前从大盲左边开始行动，翻牌后从庄位左边第一位还在局的人开始。两人对局时庄位就是小盲，翻牌前先行动、翻牌后后行动。',
      '每人两张底牌，公共牌依次发翻牌 3 张、转牌 1 张、河牌 1 张，每条街一轮下注。摊牌时每人用两张底牌和五张公共牌里最好的 5 张比大小：同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌。',
      '有人全下时多出来的部分组成边池，只在有资格的人之间比牌；平分底池时零头给庄位左侧第一位赢家。',
      `【行动】弃牌；过牌（没有要跟的注时）；跟注；加注到某个金额（写本轮你下注的总额，第一次下注也这样写）；全下。加注到的总额至少是「当前最高下注 + 上一次加注的幅度」（至少一个大盲 ${cfg.bb}），最多是你的全部筹码；筹码不够最小加注时只能全下。别人全下但不足最小加注时，已经行动过的人只能跟注或弃牌。`,
      '【牌的写法】点数 A K Q J 10 9 … 2，花色 ♠♥♦♣，例如 A♠ K♥。',
      '',
      '【输出格式】每次只简短回答，用中文，除行动外合计不超过 80 字，严格按下面五行：',
      '判断：一句话说明你的牌力和局面',
      '推断：一句话推断对手可能的牌力',
      '理由：一句话说明你为什么这样做',
      '胜率：你估计自己赢下这手牌的概率，写成 0–100 的整数加 %',
      '行动：只写一种，例如「行动：跟注」「行动：加注到 60」「行动：弃牌」「行动：过牌」「行动：全下」',
      style ? `\n【你的风格】${style}\n（风格只影响你的打法，不能改变上面的规则和输出格式。）` : '',
    ].join('\n');
  },

  turnPrompt(state, seat) {
    const s = state, h = s.hand, i = seatIdx(seat);
    const L = legal(s, i);
    const pos = positions(s);
    const lines = [
      `第 ${h.no} 手（本场共 ${s.cfg.hands} 手，之前已打完 ${h.no - 1} 手，算上这手还剩 ${s.cfg.hands - h.no + 1} 手）。现在是${STREET_CN[h.street]}，轮到你（${nameOf(i)}${pos[i] ? `，${pos[i]}` : ''}）行动。`,
      `你的底牌：${cardsText(h.hole[i])}`,
      `公共牌：${boardLine(h)}`,
      '',
      '各家筹码（剩余筹码 / 本手已投入）：',
    ];
    for (let j = 0; j < s.n; j++) {
      const tag = [];
      if (pos[j]) tag.push(pos[j]);
      if (j === i) tag.push('你');
      let st = '';
      if (!h.inHand[j]) st = '已出局';
      else if (h.folded[j]) st = '已弃牌';
      else if (h.allin[j]) st = '已全下';
      lines.push(`  ${nameOf(j)}${tag.length ? `（${tag.join('，')}）` : ''}：${h.inHand[j] ? `${s.stacks[j]} / ${h.contrib[j]}${h.bet[j] ? `（本轮 ${h.bet[j]}）` : ''}` : '0'}${st ? ` ${st}` : ''}`);
    }
    const pots = buildPots(h).filter((p) => p.eligible.length > 1);
    lines.push('', `底池：${L.pot}${pots.length > 1 ? `（${pots.map((p, k) => `${k ? `边池 ${k}` : '主池'} ${p.amount}`).join('，')}）` : ''}`);
    lines.push(L.owe > 0
      ? `当前最高下注 ${h.currentBet}，你本轮已下 ${h.bet[i]}，需要跟 ${L.toCall}${L.stack <= L.owe ? '（就是你的全部筹码）' : ''}。`
      : `当前没有要跟的注${h.currentBet ? `（最高下注 ${h.currentBet} 你已跟上）` : ''}，可以过牌。`);
    if (L.canRaise) lines.push(L.minTo < L.maxTo ? `可以${h.currentBet ? '加注' : '下注'}到 ${L.minTo}–${L.maxTo}（最小加注到 ${L.minTo}，${L.maxTo} 即全下）。` : `筹码不够最小加注，加注只能全下（${L.maxTo}）。`);
    else if (L.stack > L.owe) lines.push(L.othersCanAct ? '对手的全下不足最小加注，你不能再加注。' : '其他人都已全下，你不能再加注。');
    lines.push('', '本手行动记录：', ...logLines(h).map((l) => `  ${l}`));
    if (s.last) lines.push('', `上一手（第 ${s.last.no} 手）：${s.last.text}${Object.keys(s.last.shown).length ? `。摊牌：${Object.entries(s.last.shown).map(([j, c]) => `${nameOf(Number(j))} ${cardsText(c)}（${s.last.hands[j]}）`).join('，')}` : ''}`);
    const acts = game.actions(s, seat).filter((a) => !a.id.startsWith('raise:')).map((a) => a.label);
    if (L.canRaise && L.minTo < L.maxTo) acts.splice(acts.length - 1, 0, `${h.currentBet ? '加注' : '下注'}到 ${L.minTo}–${L.maxTo}`);
    lines.push('', `可选行动：${acts.join('、')}`);
    return lines.join('\n');
  },

  retryPrompt: (reason, attempt, max) => `你上一个回答的行动无效：${reason}。请重新决定（这是第 ${attempt} 次重来，最多 ${max} 次，再无效判负），仍按五行格式回答，最后一行写「行动：……」。`,

  parseReply(state, seat, text) {
    const t = String(text || '');
    const win = /胜率\s*[:：]\s*(\d{1,3})/.exec(t);
    const winrate = win ? Math.min(100, Number(win[1])) : null;
    const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const tagged = [...t.matchAll(/(?:行动|动作|决定|action)\s*[:：]\s*([^\n]+)/gi)].pop();
    let act = tagged ? parseActionText(tagged[1]) : null;
    if (!act && lines.length) act = parseActionText(lines[lines.length - 1]);
    if (!act) return { action: null, attempted: null, winrate, error: '没有找到行动（最后一行应为「行动：跟注」「行动：加注到 60」「行动：弃牌」「行动：过牌」或「行动：全下」）' };
    const i = seatIdx(seat);
    const L = legal(state, i);
    let id;
    if (act.kind === 'raise') {
      if (act.to === null || !Number.isFinite(act.to)) {
        return { action: null, attempted: '加注', winrate, error: `加注要写明加注到的总额，例如「行动：加注到 ${L.minTo}」${L.canRaise ? `；可以加注到 ${L.minTo}–${L.maxTo}` : ''}` };
      }
      id = act.to === L.maxTo ? 'allin' : `raise:${act.to}`;
    } else if (act.kind === 'call' && L.owe === 0) id = 'check';
    else if (act.kind === 'call' && L.stack <= L.owe) id = 'allin';
    else id = act.kind;
    const attempted = game.label(state, seat, id);
    try {
      doAction(structuredClone(state), i, parseId(id));
    } catch (e) {
      return { action: null, attempted, winrate, error: e.message };
    }
    return { action: id, attempted, winrate, error: null };
  },

  mockReply(state, seat, action) {
    const h = state.hand, i = seatIdx(seat);
    const hole = h.hole[i];
    const opp = Math.max(1, live(h).length - 1);
    const eq = h.board.length ? equityVsRandom(hole, h.board, opp, { sims: 80 }) : equityVsRandom(hole, [], opp, { sims: 80 });
    const made = h.board.length ? handName(evaluate([...hole, ...h.board])) : `起手 ${cardsText(hole)}`;
    return [
      `判断：${made}，${eq > 0.6 ? '牌力不错' : eq > 0.35 ? '牌力一般' : '牌力偏弱'}。`,
      `推断：${h.currentBet > state.cfg.bb ? '对手有下注，范围偏强' : '对手范围还很宽'}。`,
      `理由：${{ fold: '赔率不够，放弃', check: '先控制底池', call: '赔率合适，跟一下', allin: '施压到底' }[parseId(action)?.kind] || '价值下注'}。`,
      `胜率：${Math.round(eq * 100)}%`,
      `行动：${actionWord(action)}`,
    ].join('\n');
  },

  // ---------- 内置 AI ----------
  builtinMove(state, seat, { level = 2, random = false } = {}) {
    const acts = game.actions(state, seat);
    if (!acts.length) throw new Error('现在不该这个座位行动');
    if (random) return acts[Math.floor(Math.random() * acts.length)].id;
    const s = state, h = s.hand, i = seatIdx(seat);
    const L = legal(s, i);
    const bb = s.cfg.bb;
    const lv = Math.max(1, Math.min(3, Math.round(level)));
    const noise = [0, 0.12, 0.06, 0.02][lv];
    const jitter = () => (Math.random() * 2 - 1) * noise;
    const passive = () => (L.canCheck ? 'check' : 'fold');
    const call = () => (L.canCheck ? 'check' : L.stack <= L.owe ? 'allin' : 'call');
    const raise = (to) => {
      if (!L.canRaise) return call();
      const x = Math.max(L.minTo, Math.round(to));
      return x >= L.maxTo || x >= L.maxTo * 0.7 ? 'allin' : `raise:${x}`;
    };
    const hole = h.hole[i];
    if (h.street === 0) {
      const c = chen(hole[0], hole[1]) + jitter() * 25;
      const raised = h.currentBet > bb;
      const callBB = L.owe / bb;
      const shallow = L.maxTo <= 12 * bb;
      if (c >= 11 || (c >= 10 && !raised)) return shallow ? raise(L.maxTo) : raise(raised ? h.currentBet * 3 : 3 * bb + bb * h.log.filter((e) => e.kind === 'call').length);
      if (c >= 9) return raised ? (callBB <= 12 ? call() : passive()) : raise(3 * bb);
      if (c >= 7) return callBB <= (raised ? 4 : 1) ? call() : passive();
      if (c >= 5) return callBB <= 0.5 || L.canCheck ? call() : passive();
      return passive();
    }
    const opp = Math.min(5, live(h).length - 1);
    const sims = [0, 60, 120, 250][lv];
    const eq = equityVsRandom(hole, h.board, opp, { sims }) + jitter();
    const pot = L.pot;
    if (L.canCheck) {
      if (eq > 0.75) return raise(pot * 0.75);
      if (eq > 0.55 && Math.random() < 0.7) return raise(pot * 0.5);
      if (Math.random() < 0.04 * (4 - lv)) return raise(pot * 0.5); // 偶尔诈唬
      return 'check';
    }
    const odds = L.owe / (pot + L.owe);
    if (eq > 0.85) return raise(h.currentBet + pot + L.owe);
    if (eq > 0.7 && Math.random() < 0.5) return raise(h.currentBet * 2.5);
    if (eq > odds + 0.05) return call();
    return 'fold';
  },

  // ---------- 浏览器数据 ----------
  view(state, viewer = null) {
    const s = state, h = s.hand;
    const vi = viewer ? seatIdx(viewer) : -1;
    const god = !viewer;
    const shown = new Set(h.done && h.result?.showdown ? h.result.shown : []);
    const eq = god ? liveEquity(s) : null;
    const pos = positions(s);
    const out = [];
    const players = [];
    for (let j = 0; j < s.n; j++) {
      const isOut = s.stacks[j] === 0 && !(h.inHand[j] && !h.done);
      if (isOut) out.push(seatId(j));
      const visible = h.inHand[j] && (god || vi === j || shown.has(j));
      const mine = h.log.filter((e) => e.i === j);
      const lastAct = mine.length ? mine[mine.length - 1] : null;
      players.push({
        seat: seatId(j), name: nameOf(j), stack: s.stacks[j], bet: h.done ? 0 : h.bet[j], contrib: h.contrib[j],
        inHand: h.inHand[j], folded: h.folded[j], allin: h.allin[j], out: isOut,
        cards: visible ? h.hole[j].map(code) : null,
        best: visible && shown.has(j) ? h.result.hands[j].best.map(code) : null,
        handName: shown.has(j) ? h.result.hands[j].name : null,
        equity: eq && eq[j] !== undefined ? eq[j] : null,
        last: lastAct && (h.done || lastAct.st === h.street) ? lastAct.text : null,
        won: h.done && h.result ? h.result.payouts[j] : 0,
        net: s.stacks[j] - s.cfg.stack + (h.done ? 0 : h.contrib[j]),
        played: s.played[j], bb100: s.bb100[j],
        position: pos[j] || null,
      });
    }
    const L = !h.done && h.toAct >= 0 ? legal(s, h.toAct) : null;
    const lastHand = s.last && s.last.no !== h.no ? {
      no: s.last.no, text: s.last.text, board: s.last.board.map(code),
      shown: Object.fromEntries(Object.entries(s.last.shown).map(([j, c]) => [seatId(Number(j)), c.map(code)])),
      hands: Object.fromEntries(Object.entries(s.last.hands).map(([j, v]) => [seatId(Number(j)), v])),
    } : null;
    const roles = {};
    for (const [j, p] of Object.entries(pos)) if (!s.over) roles[seatId(Number(j))] = p;
    return {
      n: s.n, viewer: viewer || null, handNo: h.no, hands: s.cfg.hands, blinds: { sb: s.cfg.sb, bb: s.cfg.bb }, startStack: s.cfg.stack,
      button: seatId(h.button), sbSeat: seatId(h.sb), bbSeat: seatId(h.bb),
      street: STREET_ID[h.street], streetName: h.done && !h.result.showdown ? '结束' : STREET_CN[h.street],
      board: h.board.map(code), pot: potTotal(h),
      pots: buildPots(h).filter((p) => p.eligible.length > 1).map((p) => ({ amount: p.amount, seats: p.eligible.map(seatId) })),
      toAct: h.toAct >= 0 ? seatId(h.toAct) : null, currentBet: h.currentBet,
      legal: L ? { toCall: L.toCall, owe: L.owe, minTo: L.minTo, maxTo: L.maxTo, canRaise: L.canRaise, canCheck: L.canCheck, bet: h.bet[h.toAct] } : null,
      players,
      log: h.log.map((e) => ({ seat: seatId(e.i), street: STREET_ID[e.st], text: e.text })),
      result: h.done ? { text: h.result.text, showdown: h.result.showdown, winners: [...new Set(h.result.pots.flatMap((p) => p.winners))].map(seatId) } : null,
      last: lastHand,
      over: s.over,
      roles, out,
    };
  },
};

export default game;
export { cardText };
