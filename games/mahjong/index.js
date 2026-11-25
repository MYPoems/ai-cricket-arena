// 麻将（四川麻将 · 血战到底，4 人）。实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。
// 108 张（万条筒各 1–9 各四张），不能吃，可以碰、杠；开局四家同时定缺，手里还有缺的那门牌时只能先打它，也不能胡；
// 一家胡了不结束，其余继续打，直到三家胡了或牌墙摸完（流局时查花猪、查大叫、退税）。一场打 setup.hands 盘，按累计分排名。
// 行动 id：que:m|s|p（定缺）、discard:5m（打牌）、zimo（自摸）、angang:5m、bugang:5m、hu、peng、gang、pass（响应别人打的牌 / 抢杠）。

import {
  SUITS, SUIT_CODE, suitOf, rankOf, tileName, tileCode, fromCode, sortTiles, toCounts, compactText,
  parseTile, parseSuit, shuffledWall, rngStep, isWin, waitsOf, scoreHand, pauseBetween, FX, DEFAULT_CAP,
} from './rules.js';
import { chooseQue, chooseTurn, chooseReact } from './ai.js';

const N = 4;
const SEATS = ['p1', 'p2', 'p3', 'p4'];
const seatIdx = (seat) => SEATS.indexOf(seat);
const nameOf = (i) => `${i + 1} 号位`;
const seatName = (seat) => (seatIdx(seat) >= 0 ? nameOf(seatIdx(seat)) : String(seat));
const GANG_PAY = { ming: 2, bu: 1, an: 2 }; // 刮风下雨：明杠放杠的人给 2；补杠、暗杠每家未胡的给 1 / 2
const clone = (s) => JSON.parse(JSON.stringify(s));
const sgn = (v) => (v > 0 ? `+${v}` : String(v));

// ---------- 状态推进（以下函数直接修改传入的 s） ----------

function rand(s) {
  const [r, a] = rngStep(s.rng);
  s.rng = a;
  return r;
}

function startHand(s) {
  s.handNo++;
  const dealer = (s.firstDealer + s.handNo - 1) % N;
  const { wall, rng } = shuffledWall(s.rng);
  s.rng = rng;
  const hands = [[], [], [], []];
  let ptr = 0;
  for (let k = 0; k < 13; k++) for (let j = 0; j < N; j++) hands[(dealer + j) % N].push(wall[ptr++]);
  const first = wall[ptr++];
  hands[dealer].push(first);
  s.hand = {
    no: s.handNo, dealer, wall, ptr,
    hands: hands.map(sortTiles),
    melds: [[], [], [], []],
    river: [[], [], [], []],
    que: [null, null, null, null],
    won: [null, null, null, null],
    wins: 0, calls: 0,
    phase: 'que', turn: dealer, drawn: first, kong: false,
    react: null,
    played: [false, false, false, false], // 各家是否已经打过牌（天胡、地胡）
    log: [], pays: [], delta: [0, 0, 0, 0],
    ev: null, seq: 0,
    end: null,
  };
}

const H = (s) => s.hand;
const alive = (h) => [0, 1, 2, 3].filter((j) => !h.won[j]);
const wallLeft = (h) => h.wall.length - h.ptr;
const countsOf = (h, i) => toCounts(h.hands[i]);
const hasQueTiles = (h, i) => h.que[i] !== null && h.hands[i].some((t) => suitOf(t) === h.que[i]);

function event(h, e) {
  h.seq++;
  h.ev = { n: h.seq, ...e };
}

function pay(s, from, to, amt, kind, text) {
  const h = H(s);
  if (!amt || from === to) return;
  h.delta[from] -= amt;
  h.delta[to] += amt;
  h.pays.push({ kind, from, to, amt, text });
}

/** 从 from 之后找下一家没胡的 */
function nextAlive(h, from) {
  for (let k = 1; k <= N; k++) {
    const j = (from + k) % N;
    if (!h.won[j]) return j;
  }
  return -1;
}

function draw(s, i, kong = false) {
  const h = H(s);
  if (!wallLeft(h)) return endHand(s, 'wall');
  const t = h.wall[h.ptr++];
  h.hands[i] = sortTiles([...h.hands[i], t]);
  h.drawn = t;
  h.kong = kong;
  h.phase = 'turn';
  h.turn = i;
  h.react = null;
}

function nextTurn(s, from) {
  const h = H(s);
  if (alive(h).length <= 1) return endHand(s, 'hu');
  draw(s, nextAlive(h, from));
}

/** 记一条行动（本盘记录；open 为真时别人暂时看不到内容，响应窗口结算后公开） */
function logIt(h, i, text, open = false) {
  h.log.push({ seat: i, text, ...(open ? { open: true } : {}) });
}

/** 胡牌结算：from 为点炮（或被抢杠）的人，-1 为自摸 */
function settleHu(s, i, t, from, flags) {
  const h = H(s);
  const c = countsOf(h, i);
  if (from >= 0) c[t]++;
  const sc = scoreHand(c, h.melds[i], flags, s.cfg.cap);
  const pts = 2 ** sc.fan;
  h.wins++;
  const payers = from >= 0 ? [from] : alive(h).filter((j) => j !== i);
  const each = pts + (from < 0 ? 1 : 0); // 自摸加底
  const how = from < 0 ? '自摸' : flags.qiang ? `抢${nameOf(from)}的杠` : `${nameOf(from)}点炮`;
  for (const j of payers) pay(s, j, i, each, from < 0 ? 'zimo' : 'hu', `${how} ${sc.title} ${sc.fan} 番`);
  h.won[i] = { t, from, order: h.wins, fan: sc.fan, raw: sc.raw, items: sc.items, title: sc.title, pts: each, zimo: from < 0 };
  if (from >= 0) h.hands[i] = sortTiles([...h.hands[i], t]);
}

function endHand(s, reason) {
  const h = H(s);
  h.phase = 'done';
  h.react = null;
  h.turn = -1;
  const notes = [[], [], [], []];
  const status = [null, null, null, null]; // 'pig' | 'ting' | 'noting'（流局时没胡的人）
  const waits = [[], [], [], []];
  const left = alive(h);
  if (reason === 'wall' && left.length >= 2) {
    const cap = 2 ** s.cfg.cap;
    const maxFan = {};
    for (const j of left) {
      if (hasQueTiles(h, j)) { status[j] = 'pig'; continue; }
      const c = countsOf(h, j);
      const w = waitsOf(c, h.melds[j].length, h.que[j]);
      waits[j] = w;
      if (w.length) {
        status[j] = 'ting';
        maxFan[j] = Math.max(...w.map((t) => { const d = c.slice(); d[t]++; return scoreHand(d, h.melds[j], {}, s.cfg.cap).fan; }));
      } else status[j] = 'noting';
    }
    // 查花猪：手里还有三门牌的赔每家不是花猪的（没胡的）封顶
    for (const p of left.filter((j) => status[j] === 'pig')) {
      for (const q of left.filter((j) => status[j] !== 'pig')) pay(s, p, q, cap, 'pig', '查花猪');
    }
    // 查大叫：没听牌的赔听牌的人他可能胡的最大番
    for (const q of left.filter((j) => status[j] === 'noting')) {
      for (const r of left.filter((j) => status[j] === 'ting')) pay(s, q, r, 2 ** maxFan[r], 'jiao', `查大叫 ${maxFan[r]} 番`);
    }
    // 退税：没听牌（含花猪）的人退回这一盘杠牌收的钱
    for (const q of left.filter((j) => status[j] !== 'ting')) {
      for (const p of h.pays.filter((x) => x.kind === 'gang' && x.to === q)) pay(s, q, p.from, p.amt, 'tax', '退税');
    }
    for (const j of left) notes[j].push(status[j] === 'pig' ? '花猪' : status[j] === 'ting' ? `听牌 ${maxFan[j]} 番` : '没听牌');
  }
  for (let j = 0; j < N; j++) s.totals[j] += h.delta[j];
  h.end = { reason: left.length <= 1 ? 'hu' : 'wall', status, waits: waits.map((w) => w.map(tileCode)) };
  s.history.push(h.delta.slice());
  s.last = {
    no: h.no, dealer: h.dealer, end: h.end.reason,
    seats: [0, 1, 2, 3].map((j) => ({
      hand: h.hands[j].map(tileCode), melds: h.melds[j].map((m) => ({ k: m.k, t: tileCode(m.t) })), que: h.que[j] === null ? null : SUITS[h.que[j]],
      won: h.won[j] ? { t: tileCode(h.won[j].t), from: h.won[j].from >= 0 ? SEATS[h.won[j].from] : null, order: h.won[j].order, fan: h.won[j].fan, title: h.won[j].title, items: h.won[j].items, zimo: h.won[j].zimo } : null,
      status: status[j], waits: waits[j].map(tileCode), delta: h.delta[j], total: s.totals[j],
      gang: h.pays.filter((p) => p.kind === 'gang').reduce((a, p) => a + (p.to === j ? p.amt : p.from === j ? -p.amt : 0), 0),
    })),
    pays: h.pays.map((p) => ({ kind: p.kind, from: SEATS[p.from], to: SEATS[p.to], amt: p.amt, text: p.text })),
  };
  event(h, { type: 'end', reason: h.end.reason });
  if (s.handNo >= s.cfg.hands) { s.over = true; return; }
  startHand(s);
}

/** 打出一张后：看谁能胡、碰、杠；没人能响应就直接下一家摸牌 */
function afterDiscard(s, i, t) {
  const h = H(s);
  const opts = {};
  for (const j of alive(h)) {
    if (j === i) continue;
    const c = countsOf(h, j);
    const q = h.que[j];
    const o = [];
    if (suitOf(t) !== q) {
      c[t]++;
      if (isWin(c, h.melds[j].length, q)) o.push('hu');
      c[t]--;
      if (c[t] === 3 && wallLeft(h) > 0) o.push('gang');
      if (c[t] >= 2) o.push('peng');
    }
    if (o.length) opts[j] = [...o, 'pass'];
  }
  if (Object.keys(opts).length) {
    h.phase = 'react';
    h.react = { kind: 'discard', t, from: i, opts, ans: {}, kong: h.kong, haidi: wallLeft(h) === 0 };
    h.drawn = null;
    return;
  }
  nextTurn(s, i);
}

/** 响应窗口里所有人都答了：胡优先（可以一炮多响），其次杠、碰，都过就照常往下 */
function resolveReact(s) {
  const h = H(s);
  const r = h.react;
  const order = [1, 2, 3].map((k) => (r.from + k) % N).filter((j) => r.ans[j] !== undefined);
  const hus = order.filter((j) => r.ans[j] === 'hu');
  // 喊了碰、杠却被胡（或上家的杠）截走的，记录里写明没成，免得看着像碰成了
  const gw = hus.length ? undefined : order.find((j) => r.ans[j] === 'gang');
  const taken = hus.length || gw !== undefined;
  for (const e of h.log) {
    if (!e.open) continue;
    delete e.open;
    const a = r.ans[e.seat];
    if (taken && (a === 'peng' || (a === 'gang' && e.seat !== gw))) e.text += hus.length ? '（被胡截走）' : '（被杠截走）';
  }
  const markGone = () => { const rv = h.river[r.from]; if (r.kind === 'discard' && rv.length) rv[rv.length - 1].gone = true; };
  if (hus.length) {
    markGone();
    if (r.kind === 'rob') h.hands[r.from] = removeOne(h.hands[r.from], r.t); // 补杠的那张被抢走，碰的那组还在
    for (const j of hus) settleHu(s, j, r.t, r.from, { gangPao: r.kind === 'discard' && r.kong, qiang: r.kind === 'rob', haidi: r.kind === 'discard' && r.haidi });
    event(h, { type: 'hu', seats: hus.map((j) => SEATS[j]), from: SEATS[r.from], t: tileCode(r.t), rob: r.kind === 'rob' });
    h.react = null;
    return nextTurn(s, hus[hus.length - 1]);
  }
  if (r.kind === 'rob') { h.react = null; return doBugang(s, r.from, r.t); }
  const g = order.find((j) => r.ans[j] === 'gang');
  const p = order.find((j) => r.ans[j] === 'peng');
  if (g !== undefined) {
    markGone();
    h.hands[g] = h.hands[g].filter((x) => x !== r.t);
    h.melds[g].push({ k: 'ming', t: r.t, from: r.from });
    h.calls++;
    pay(s, r.from, g, GANG_PAY.ming, 'gang', `明杠 ${tileName(r.t)}`);
    event(h, { type: 'gang', seat: SEATS[g], from: SEATS[r.from], t: tileCode(r.t), k: 'ming' });
    h.react = null;
    return draw(s, g, true);
  }
  if (p !== undefined) {
    markGone();
    h.hands[p] = removeOne(removeOne(h.hands[p], r.t), r.t);
    h.melds[p].push({ k: 'peng', t: r.t, from: r.from });
    h.calls++;
    event(h, { type: 'peng', seat: SEATS[p], from: SEATS[r.from], t: tileCode(r.t) });
    h.react = null;
    h.phase = 'turn';
    h.turn = p;
    h.drawn = null;
    h.kong = false;
    return;
  }
  h.react = null;
  nextTurn(s, r.from);
}

function removeOne(arr, t) {
  const k = arr.indexOf(t);
  if (k < 0) throw new Error(`手里没有 ${tileName(t)}`);
  return [...arr.slice(0, k), ...arr.slice(k + 1)];
}

function doBugang(s, i, t) {
  const h = H(s);
  h.hands[i] = removeOne(h.hands[i], t);
  const m = h.melds[i].find((x) => x.k === 'peng' && x.t === t);
  m.k = 'bu';
  h.calls++;
  for (const j of alive(h)) if (j !== i) pay(s, j, i, GANG_PAY.bu, 'gang', `补杠 ${tileName(t)}`);
  event(h, { type: 'gang', seat: SEATS[i], t: tileCode(t), k: 'bu' });
  draw(s, i, true);
}

// ---------- 合法行动 ----------

function turnOptions(h, i) {
  const c = countsOf(h, i);
  const q = h.que[i];
  const out = { zimo: false, angang: [], bugang: [], discard: [] };
  if (h.drawn !== null && isWin(c, h.melds[i].length, q)) out.zimo = true;
  if (wallLeft(h) > 0) {
    for (let t = 0; t < 27; t++) if (c[t] === 4 && suitOf(t) !== q) out.angang.push(t);
    for (const m of h.melds[i]) if (m.k === 'peng' && c[m.t] > 0) out.bugang.push(m.t);
  }
  const queTiles = h.hands[i].filter((t) => suitOf(t) === q);
  out.discard = [...new Set(queTiles.length ? queTiles : h.hands[i])];
  return out;
}

function pendingOf(s) {
  if (s.over) return [];
  const h = H(s);
  if (h.phase === 'que') return SEATS.filter((_, j) => h.que[j] === null);
  if (h.phase === 'turn') return [SEATS[h.turn]];
  if (h.phase === 'react') return Object.keys(h.react.opts).map(Number).filter((j) => h.react.ans[j] === undefined).sort((a, b) => ((a - h.react.from + N) % N) - ((b - h.react.from + N) % N)).map((j) => SEATS[j]);
  return [];
}

const REACT_LABEL = { hu: '胡', gang: '杠', peng: '碰', pass: '过' };

function actionList(s, seat) {
  if (!pendingOf(s).includes(seat)) return [];
  const h = H(s);
  const i = seatIdx(seat);
  if (h.phase === 'que') return [0, 1, 2].map((k) => ({ id: `que:${SUIT_CODE[k]}`, label: `缺${SUITS[k]}` }));
  if (h.phase === 'react') {
    const t = tileName(h.react.t);
    return h.react.opts[i].map((a) => ({ id: a, label: a === 'pass' ? '过' : `${REACT_LABEL[a]} ${t}` }));
  }
  const o = turnOptions(h, i);
  const out = [];
  if (o.zimo) out.push({ id: 'zimo', label: '自摸' });
  for (const t of o.angang) out.push({ id: `angang:${tileCode(t)}`, label: `暗杠 ${tileName(t)}` });
  for (const t of o.bugang) out.push({ id: `bugang:${tileCode(t)}`, label: `补杠 ${tileName(t)}` });
  for (const t of o.discard) out.push({ id: `discard:${tileCode(t)}`, label: `打 ${tileName(t)}` });
  return out;
}

// ---------- 给模型的文字 ----------

const meldText = (m, mine) => (m.k === 'an' && !mine ? '暗杠一组' : `${{ peng: '碰', ming: '明杠', bu: '补杠', an: '暗杠' }[m.k]} ${tileName(m.t)}`);

/** 自己看不到的每种牌还剩几张（扣掉自己手牌、所有牌河、明的副露、已胡的牌） */
export function unseenFor(h, i) {
  const left = new Array(27).fill(4);
  for (const t of h.hands[i]) left[t]--;
  for (let j = 0; j < N; j++) {
    for (const r of h.river[j]) if (!r.gone) left[r.t]--;
    for (const m of h.melds[j]) if (m.k !== 'an' || j === i) left[m.t] -= m.k === 'peng' ? 3 : 4;
    if (h.won[j] && j !== i) left[h.won[j].t]--; // 胡的那张是亮出来的
  }
  return left.map((x) => Math.max(0, x));
}

/** 打哪张能听牌、听什么、还剩几张（听牌提示） */
function tingHints(h, i) {
  const c = countsOf(h, i);
  const melds = h.melds[i].length;
  const q = h.que[i];
  const left = unseenFor(h, i);
  const out = [];
  for (let t = 0; t < 27; t++) {
    if (!c[t]) continue;
    c[t]--;
    const w = waitsOf(c, melds, q);
    c[t]++;
    if (w.length) out.push({ t, waits: w, left: w.reduce((a, x) => a + left[x], 0) });
  }
  return out;
}

function tableLines(s, i) {
  const h = H(s);
  const lines = [];
  for (let j = 0; j < N; j++) {
    const parts = [`${nameOf(j)}${j === i ? '（你）' : ''}${j === h.dealer ? ' 庄' : ''}`];
    parts.push(h.que[j] !== null ? `缺${SUITS[h.que[j]]}` : '未定缺');
    if (h.won[j]) parts.push(`已胡（第 ${h.won[j].order} 个，${h.won[j].zimo ? '自摸' : `${nameOf(h.won[j].from)}点炮`} ${tileName(h.won[j].t)} ${h.won[j].title}）`);
    else parts.push(`手牌 ${h.hands[j].length} 张`);
    if (h.melds[j].length) parts.push(`副露：${h.melds[j].map((m) => meldText(m, j === i)).join('、')}`);
    const rv = h.river[j].filter((r) => !r.gone).map((r) => tileName(r.t));
    parts.push(`牌河：${rv.length ? rv.join(' ') : '（无）'}`);
    lines.push(`  ${parts.join(' · ')}`);
  }
  return lines;
}

const FORMAT_LINES = [
  '【输出格式】每次只简短回答，用中文，除最后一行外合计不超过 80 字，严格按五行：',
  '判断：一句话说明你的手牌（几向听、往什么番型做）',
  '推断：一句话推断别家（谁可能听牌、要什么牌）',
  '理由：一句话说明这样做的原因',
  '胜率：你估计自己这一盘能胡的概率，写成 0–100 的整数加 %',
  '最后一行：定缺时写「定缺：条」；轮到你出牌时写「出牌：5万」，或「行动：自摸」「行动：暗杠 5万」「行动：补杠 5万」；别人打出牌你可以响应时写「行动：胡」「行动：杠」「行动：碰」或「行动：过」。',
];

// ---------- 解析模型回答 ----------

function lastField(t, keys) {
  const re = new RegExp(`(${keys})\\s*[:：]\\s*([^\\n]*)`, 'g');
  const all = [...t.matchAll(re)];
  return all.length ? { key: all.at(-1)[1], val: all.at(-1)[2].trim().replace(/[。.！!]+$/, '') } : null;
}

function parseQue(t) {
  const f = lastField(t, '定缺|缺|行动');
  if (!f && /出牌\s*[:：]/.test(t)) return { error: '现在是定缺阶段，最后一行应写「定缺：万」「定缺：条」或「定缺：筒」' };
  const src = f ? f.val : (t.trim().split(/\n/).pop() || '');
  const k = parseSuit(src);
  if (k < 0) return { error: f ? `无法识别定缺「${src.slice(0, 10)}」，请写「定缺：万」「定缺：条」或「定缺：筒」` : '没有找到定缺（最后一行应为「定缺：条」这样的格式）' };
  return { action: `que:${SUIT_CODE[k]}`, attempted: `缺${SUITS[k]}` };
}

function parseTurn(s, i, t) {
  const h = H(s);
  const f = lastField(t, '出牌|打出|打牌|行动|动作');
  if (!f) return { error: '没有找到出牌（最后一行应为「出牌：5万」，或「行动：自摸」「行动：暗杠 5万」）' };
  const o = turnOptions(h, i);
  const v = f.val;
  if (/自摸|胡|和牌/.test(v) && !/不胡/.test(v)) {
    if (o.zimo) return { action: 'zimo', attempted: '自摸' };
    return { attempted: '自摸', error: hasQueTiles(h, i) ? `你手里还有缺的${SUITS[h.que[i]]}，不能胡` : '你的手牌还没有胡，不能自摸，请出一张牌' };
  }
  const tile = parseTile(v);
  if (/杠/.test(v)) {
    const ang = /暗杠/.test(v), bu = /补杠|加杠|巴杠|弯杠/.test(v);
    let cand = [...o.angang.map((x) => ['angang', x]), ...o.bugang.map((x) => ['bugang', x])];
    if (ang) cand = cand.filter((c) => c[0] === 'angang');
    if (bu) cand = cand.filter((c) => c[0] === 'bugang');
    if (tile >= 0) cand = cand.filter((c) => c[1] === tile);
    if (cand.length === 1) return { action: `${cand[0][0]}:${tileCode(cand[0][1])}`, attempted: `${cand[0][0] === 'angang' ? '暗杠' : '补杠'} ${tileName(cand[0][1])}` };
    if (!cand.length) return { attempted: v.slice(0, 12), error: `现在不能这样杠${tile >= 0 ? ` ${tileName(tile)}` : ''}（暗杠要手里有四张，补杠要已经碰过、手里有第四张，牌墙摸完不能杠）` };
    return { attempted: v.slice(0, 12), error: '能杠的不止一种，请写明杠哪张，例如「行动：暗杠 5万」' };
  }
  if (tile < 0) {
    if (/^(过|pass|不要)/i.test(v)) return { attempted: '过', error: '轮到你出牌，不能过，必须打出一张牌' };
    return { attempted: v.slice(0, 12), error: `无法识别「${v.slice(0, 12)}」，请写「出牌：5万」这样的格式（点数加万 / 条 / 筒）` };
  }
  if (!h.hands[i].includes(tile)) return { attempted: `打 ${tileName(tile)}`, error: `你手里没有 ${tileName(tile)}` };
  if (!o.discard.includes(tile)) return { attempted: `打 ${tileName(tile)}`, error: `你定缺${SUITS[h.que[i]]}，手里还有${SUITS[h.que[i]]}，必须先打${SUITS[h.que[i]]}（可以打：${o.discard.map(tileName).join(' ')}）` };
  return { action: `discard:${tileCode(tile)}`, attempted: `打 ${tileName(tile)}` };
}

function parseReact(s, i, t) {
  const h = H(s);
  const opts = h.react.opts[i];
  const f = lastField(t, '行动|动作|响应|决定');
  const src = f ? f.val : (t.trim().split(/\n/).pop() || '');
  let a = null;
  if (/过|pass|不要|放弃|不碰|不杠|不胡|跳过/i.test(src)) a = 'pass';
  else if (/胡|和|点炮|抢杠/.test(src)) a = 'hu';
  else if (/杠/.test(src)) a = 'gang';
  else if (/碰/.test(src)) a = 'peng';
  const list = opts.map((x) => REACT_LABEL[x]).join('、');
  if (!a) return { error: f ? `无法识别「${src.slice(0, 10)}」，请写「行动：${list.split('、').join('」「行动：')}」之一` : `没有找到行动（最后一行应为「行动：${opts.includes('peng') ? '碰' : '胡'}」或「行动：过」）` };
  if (!opts.includes(a)) return { attempted: REACT_LABEL[a], error: `现在不能${REACT_LABEL[a]}，你可以：${list}` };
  return { action: a, attempted: REACT_LABEL[a] };
}

// ---------- 游戏定义 ----------

const summary = (s) => s && {
  handNo: s.hand.no, que: s.hand.que.every((q) => q !== null), wins: s.hand.wins, calls: s.hand.calls, over: !!s.over,
  end: s.last && s.last.no !== s.hand.no ? s.last.end : s.over ? s.last?.end : null,
};

const game = {
  id: 'mahjong',
  name: '麻将',
  players: { min: 4, max: 4, default: 4 },
  features: { hidden: true, winbar: false, draw: false },
  noun: '出牌',

  seats: (n = N) => SEATS.slice(0, n),
  seatName,

  /** setup：{ hands = 4（打几盘，1–16）, cap = 4（封顶番数，2–6） } */
  create({ players = N, seed = 1, setup = {} } = {}) {
    if (Number(players) !== N) throw new Error('麻将需要 4 人');
    const hands = setup?.hands ?? 4;
    if (!Number.isInteger(hands) || hands < 1 || hands > 16) throw new Error('盘数必须是 1–16 的整数');
    const cap = setup?.cap ?? DEFAULT_CAP;
    if (!Number.isInteger(cap) || cap < 2 || cap > 6) throw new Error('封顶番数必须是 2–6 的整数');
    const s = {
      seed: (Number(seed) || 0) >>> 0, rng: (Number(seed) || 0) >>> 0,
      cfg: { hands, cap }, handNo: 0, firstDealer: 0, totals: [0, 0, 0, 0], history: [], over: false, hand: null, last: null,
    };
    s.firstDealer = Math.floor(rand(s) * N);
    startHand(s);
    return s;
  },

  pending: (state) => pendingOf(state),
  actions: (state, seat) => actionList(state, seat),

  apply(state, seat, action) {
    if (state.over) throw new Error('对局已经结束');
    if (!pendingOf(state).includes(seat)) throw new Error(`现在不是${seatName(seat)}行动`);
    const s = clone(state);
    const h = H(s);
    const i = seatIdx(seat);
    const a = String(action ?? '').trim();
    if (h.phase === 'que') {
      const m = /^que:([msp])$/.exec(a);
      if (!m) throw new Error(`定缺阶段的行动应为 que:m / que:s / que:p：${a}`);
      h.que[i] = SUIT_CODE.indexOf(m[1]);
      logIt(h, i, `定缺 ${SUITS[h.que[i]]}`, true);
      if (h.que.every((q) => q !== null)) {
        for (const e of h.log) delete e.open;
        h.phase = 'turn';
        h.turn = h.dealer;
        event(h, { type: 'que' });
      }
      return s;
    }
    if (h.phase === 'react') {
      if (!h.react.opts[i].includes(a)) throw new Error(`现在不能${REACT_LABEL[a] || a}，可以：${h.react.opts[i].map((x) => REACT_LABEL[x]).join('、')}`);
      h.react.ans[i] = a;
      logIt(h, i, a === 'pass' ? '过' : `${REACT_LABEL[a]} ${tileName(h.react.t)}`, true);
      if (pendingOf(s).length === 0) resolveReact(s);
      return s;
    }
    // 轮到自己：自摸、暗杠、补杠、打牌
    const o = turnOptions(h, i);
    const [kind, code] = a.split(':');
    const t = code ? fromCode(code) : -1;
    if (kind === 'zimo') {
      if (!o.zimo) throw new Error('现在不能自摸');
      const drawn = h.drawn;
      // 天胡：庄家起手 14 张就胡；地胡：闲家第一次摸牌就自摸（之前没人碰杠）
      const first = !h.played[i] && h.calls === 0;
      const flags = { zimo: true, gangHua: h.kong, haidi: wallLeft(h) === 0, tian: first && i === h.dealer, di: first && i !== h.dealer };
      logIt(h, i, `自摸 ${tileName(drawn)}`);
      settleHu(s, i, drawn, -1, flags);
      event(h, { type: 'zimo', seat, t: tileCode(drawn) });
      h.drawn = null;
      nextTurn(s, i);
      return s;
    }
    if (kind === 'angang') {
      if (!o.angang.includes(t)) throw new Error('现在不能这样暗杠');
      h.hands[i] = h.hands[i].filter((x) => x !== t);
      h.melds[i].push({ k: 'an', t, from: i });
      h.calls++;
      for (const j of alive(h)) if (j !== i) pay(s, j, i, GANG_PAY.an, 'gang', `暗杠 ${tileName(t)}`);
      logIt(h, i, `暗杠 ${tileName(t)}`);
      event(h, { type: 'gang', seat, t: tileCode(t), k: 'an' });
      draw(s, i, true);
      return s;
    }
    if (kind === 'bugang') {
      if (!o.bugang.includes(t)) throw new Error('现在不能这样补杠');
      logIt(h, i, `补杠 ${tileName(t)}`);
      // 抢杠胡：别家能胡这张就先问他们
      const opts = {};
      for (const j of alive(h)) {
        if (j === i || suitOf(t) === h.que[j]) continue;
        const c = countsOf(h, j);
        c[t]++;
        if (isWin(c, h.melds[j].length, h.que[j])) opts[j] = ['hu', 'pass'];
      }
      if (Object.keys(opts).length) {
        h.phase = 'react';
        h.react = { kind: 'rob', t, from: i, opts, ans: {}, kong: false, haidi: false };
        h.drawn = null;
        return s;
      }
      doBugang(s, i, t);
      return s;
    }
    if (kind === 'discard') {
      if (t < 0 || !h.hands[i].includes(t)) throw new Error(`手里没有这张牌：${code}`);
      if (!o.discard.includes(t)) throw new Error(`定缺${SUITS[h.que[i]]}，必须先打${SUITS[h.que[i]]}`);
      h.hands[i] = removeOne(h.hands[i], t);
      h.river[i].push({ t });
      h.played[i] = true;
      logIt(h, i, `打 ${tileName(t)}`);
      event(h, { type: 'discard', seat, t: tileCode(t) });
      afterDiscard(s, i, t);
      return s;
    }
    throw new Error(`无法识别的行动：${a}`);
  },

  outcome(state) {
    if (!state.over) return { over: false };
    const ranks = {};
    SEATS.forEach((x, j) => { ranks[x] = 1 + state.totals.filter((v) => v > state.totals[j]).length; });
    const top = Math.max(...state.totals);
    const tops = SEATS.filter((_, j) => state.totals[j] === top);
    const board = SEATS.map((_, j) => `${nameOf(j)} ${sgn(state.totals[j])}`).join('，');
    return {
      over: true, ranks, winner: tops.length === 1 ? tops[0] : null,
      reason: `${state.handNo} 盘结束：${tops.length > 1 ? `${tops.map(seatName).join('、')}并列第一` : `${seatName(tops[0])}第一`}（${board}）`,
    };
  },

  forfeit(state, seat, reason) {
    const i = seatIdx(seat);
    const others = [0, 1, 2, 3].filter((j) => j !== i);
    const v = (j) => state.totals[j] + (state.hand && !state.over ? state.hand.delta[j] : 0);
    const ranks = { [seat]: N };
    for (const j of others) ranks[SEATS[j]] = 1 + others.filter((k) => v(k) > v(j)).length;
    const tops = others.filter((j) => ranks[SEATS[j]] === 1);
    return { over: true, ranks, winner: tops.length === 1 ? SEATS[tops[0]] : null, reason };
  },

  label(state, seat, action) {
    const a = String(action ?? '');
    const [kind, code] = a.split(':');
    const t = code ? fromCode(code) : -1;
    const tn = t >= 0 ? tileName(t) : '';
    if (kind === 'que') return `定缺 ${SUITS[SUIT_CODE.indexOf(code)] || code}`;
    if (kind === 'discard') return `打 ${tn}`;
    if (kind === 'angang') return `暗杠 ${tn}`;
    if (kind === 'bugang') return `补杠 ${tn}`;
    if (kind === 'zimo') return state.hand?.drawn !== null && state.hand?.drawn !== undefined ? `自摸 ${tileName(state.hand.drawn)}` : '自摸';
    if (REACT_LABEL[kind]) return kind === 'pass' ? '过' : `${REACT_LABEL[kind]}${state.hand?.react ? ` ${tileName(state.hand.react.t)}` : ''}`;
    return a;
  },

  // 每一步之后至少停多久；胡、碰杠、一盘结束另有停顿（interlude）
  turnPause: FX.TURN,
  interlude: (prev, next) => pauseBetween(summary(prev), summary(next)),

  // ---------- 给模型 ----------
  systemPrompt(seat, { style = '', state } = {}) {
    const cfg = state?.cfg || { hands: 4, cap: DEFAULT_CAP };
    return [
      `你在打四川麻将（血战到底，4 人），坐在${seatName(seat)}。一场打 ${cfg.hands} 盘，按累计得分排名。`,
      '',
      '【牌】108 张，只有万、条、筒三门，每门 1–9 各四张。不能吃，只能碰、杠。每人 13 张，庄家 14 张先出。',
      '【定缺】开局四家同时选一门「缺」。手里还有缺的那门牌时只能先打它，也不能胡；缺的那门牌不能碰、杠、胡。',
      '【胡牌】四组面子（顺子或刻子）加一对将，或七对（四张相同算两对）。别人打出的牌能胡就可以胡（几家同时胡叫一炮多响），自己摸到叫自摸。',
      '【血战到底】一家胡了这一盘不结束，其余人继续打，直到三家胡了或牌墙摸完。胡了的人不再摸牌出牌。',
      '【碰杠】别人打出的牌，手里有两张可以碰（碰后打一张），有三张可以明杠；自己摸到四张可以暗杠；碰过的牌摸到第四张可以补杠（别人能胡这张时可以抢杠胡）。杠后从牌墙补一张。牌墙摸完就不能杠。',
      `【番数】平胡 0 番；对对胡 1；清一色 2；七对 2；带幺九 2；将对（全是 2/5/8 的对对胡）再加 2；金钩钓（四组副露单钓）再加 1；每个「根」（四张相同，含杠）加 1；杠上花、杠上炮、抢杠胡、海底捞月、海底炮各加 1；天胡、地胡直接封顶。番数可以叠加，${cfg.cap} 番封顶。得分 = 2 的番数次方：点炮由打出那张的人付，自摸由每家没胡的付，并且每家多付 1（自摸加底）。`,
      '【刮风下雨】明杠放杠的人付 2；补杠每家没胡的付 1；暗杠每家没胡的付 2。',
      `【流局】牌墙摸完还有两家以上没胡：手里仍有三门牌的是花猪，赔给每家不是花猪的没胡玩家 ${2 ** cfg.cap} 分；没听牌的赔给听牌的人「他能胡的最大番」；没听牌的人退回这一盘杠牌收的钱。`,
      '【牌的写法】点数加花色：5万、3条、9筒；手牌按花色连写，例如「1123万 456条」表示 1万 1万 2万 3万 4条 5条 6条。',
      '',
      ...FORMAT_LINES,
      style ? `\n【你的风格】${style}\n（风格只影响你的打法取向，不能改变上面的规则和输出格式。）` : '',
    ].join('\n');
  },

  turnPrompt(state, seat) {
    const s = state, h = H(s), i = seatIdx(seat);
    const head = `第 ${h.no}/${s.cfg.hands} 盘 · 你是${nameOf(i)}${i === h.dealer ? '（庄家）' : `，庄家是${nameOf(h.dealer)}`} · 牌墙剩 ${wallLeft(h)} 张`;
    const totals = `累计分：${SEATS.map((_, j) => `${nameOf(j)}${j === i ? '（你）' : ''} ${sgn(s.totals[j] + h.delta[j])}`).join('，')}（含本盘已结算的杠分）`;
    const hand = `你的手牌（${h.hands[i].length} 张）：${compactText(h.hands[i])}`;
    const mine = h.melds[i].length ? `你的副露：${h.melds[i].map((m) => meldText(m, true)).join('、')}` : null;
    if (h.phase === 'que') {
      const cnt = [0, 1, 2].map((k) => `${SUITS[k]} ${h.hands[i].filter((t) => suitOf(t) === k).length} 张`).join('、');
      return [`【定缺】${head}`, totals, hand, `各门张数：${cnt}`, '', '四家同时定缺，请选一门不要的牌。最后一行写「定缺：万」「定缺：条」或「定缺：筒」。'].filter(Boolean).join('\n');
    }
    const lines = [`【${h.phase === 'react' ? '响应' : '出牌'}】${head}`, totals, '各家（按座位）：', ...tableLines(s, i), hand];
    if (mine) lines.push(mine);
    if (h.phase === 'react') {
      const r = h.react;
      const what = r.kind === 'rob' ? `${nameOf(r.from)}要补杠 ${tileName(r.t)}，你能抢杠胡` : `${nameOf(r.from)}打出 ${tileName(r.t)}`;
      const c = countsOf(h, i);
      const w = waitsOf(c, h.melds[i].length, h.que[i]);
      if (w.length) lines.push(`你现在听：${w.map(tileName).join(' ')}`);
      lines.push('', `${what}。你可以：${r.opts[i].map((x) => REACT_LABEL[x]).join('、')}。最后一行写「行动：${REACT_LABEL[r.opts[i][0]]}」或「行动：过」。`);
      return lines.join('\n');
    }
    const o = turnOptions(h, i);
    if (h.drawn !== null) lines.push(`刚摸到：${tileName(h.drawn)}${h.kong ? '（杠后补牌）' : ''}`);
    else lines.push('你刚碰了牌，现在打一张。');
    if (hasQueTiles(h, i)) lines.push(`你定缺${SUITS[h.que[i]]}，手里还有${SUITS[h.que[i]]}，只能先打：${o.discard.map(tileName).join(' ')}`);
    else {
      const hints = tingHints(h, i);
      if (hints.length) lines.push(`听牌提示：${hints.slice(0, 6).map((x) => `打 ${tileName(x.t)} 听 ${x.waits.map(tileName).join(' ')}（剩 ${x.left} 张）`).join('；')}`);
    }
    const acts = [];
    if (o.zimo) acts.push('行动：自摸');
    for (const t of o.angang) acts.push(`行动：暗杠 ${tileName(t)}`);
    for (const t of o.bugang) acts.push(`行动：补杠 ${tileName(t)}`);
    lines.push('', `可以打：${o.discard.map(tileName).join(' ')}${acts.length ? `；也可以：${acts.join('、')}` : ''}`);
    lines.push('最后一行写「出牌：X」或上面列出的行动。');
    return lines.join('\n');
  },

  retryPrompt: (reason, attempt, max) => `你上一个回答无效：${reason}。请重新回答（这是第 ${attempt} 次重来，最多 ${max} 次，再无效判负），仍按五行格式回答。`,

  parseReply(state, seat, text) {
    const t = String(text || '').normalize('NFKC').replace(/[*`_]/g, '');
    const win = /胜率\s*[:：]\s*(\d{1,3})/.exec(t);
    const winrate = win ? Math.min(100, Number(win[1])) : null;
    if (state.over) return { action: null, attempted: null, winrate, error: '对局已经结束' };
    if (!pendingOf(state).includes(seat)) return { action: null, attempted: null, winrate, error: `现在不是${seatName(seat)}行动` };
    const h = H(state), i = seatIdx(seat);
    const r = h.phase === 'que' ? parseQue(t) : h.phase === 'react' ? parseReact(state, i, t) : parseTurn(state, i, t);
    return { action: r.error ? null : r.action, attempted: r.attempted ?? null, winrate, error: r.error || null };
  },

  mockReply(state, seat, action) {
    const h = H(state);
    const a = String(action);
    const last = a.startsWith('que:') ? `定缺：${SUITS[SUIT_CODE.indexOf(a.slice(4))]}`
      : a.startsWith('discard:') ? `出牌：${tileName(fromCode(a.slice(8)))}`
        : `行动：${game.label(state, seat, a)}`;
    return `判断：手牌${h.phase === 'que' ? '刚发下来' : '还在整理'}，先把形状做好。\n推断：别家暂时看不出听牌。\n理由：${a === 'pass' ? '这张不值得要' : '按牌效走'}。\n胜率：${h.phase === 'que' ? 25 : 30}%\n${last}`;
  },

  // ---------- 内置 AI ----------
  builtinMove(state, seat, { level = 2, random = false } = {}) {
    const acts = actionList(state, seat);
    if (!acts.length) throw new Error('现在不该这个座位行动');
    if (random) return acts[Math.floor(Math.random() * acts.length)].id;
    const h = H(state), i = seatIdx(seat);
    const lv = Math.max(1, Math.min(3, Math.round(level)));
    const ctx = { h, i, lv, unseen: unseenFor(h, i), wallLeft: wallLeft(h) };
    if (h.phase === 'que') return `que:${SUIT_CODE[chooseQue(h.hands[i], lv)]}`;
    if (h.phase === 'react') return chooseReact(ctx, h.react.opts[i]);
    return chooseTurn(ctx, turnOptions(h, i));
  },

  // ---------- 浏览器数据 ----------
  view(state, viewer = null) {
    const s = state, h = H(s);
    const god = viewer === null || viewer === undefined;
    const vi = god ? -1 : seatIdx(viewer);
    const queDone = h.que.every((q) => q !== null);
    const players = [0, 1, 2, 3].map((j) => {
      const see = god || vi === j;
      const w = h.won[j];
      const c = countsOf(h, j);
      const ting = see && !w && h.phase !== 'que' && h.hands[j].length % 3 === 1 ? waitsOf(c, h.melds[j].length, h.que[j]).map(tileCode) : null;
      return {
        seat: SEATS[j], name: nameOf(j),
        hand: see ? h.hands[j].map(tileCode) : null,
        count: h.hands[j].length,
        drawn: see && h.phase === 'turn' && h.turn === j && h.drawn !== null ? tileCode(h.drawn) : null,
        melds: h.melds[j].map((m) => ({ k: m.k, t: m.k === 'an' && !see ? null : tileCode(m.t), from: SEATS[m.from] })),
        river: h.river[j].map((r) => ({ t: tileCode(r.t), ...(r.gone ? { gone: true } : {}) })),
        que: h.que[j] !== null && (queDone || see) ? SUIT_CODE[h.que[j]] : null,
        queing: h.phase === 'que' && h.que[j] === null,
        won: w ? { t: tileCode(w.t), from: w.from >= 0 ? SEATS[w.from] : null, order: w.order, fan: w.fan, title: w.title, items: w.items, zimo: w.zimo, pts: w.pts } : null,
        dealer: j === h.dealer,
        total: s.totals[j] + (h.phase === 'done' ? 0 : h.delta[j]),
        delta: h.phase === 'done' ? 0 : h.delta[j],
        ting,
      };
    });
    const r = h.react;
    const lastDiscard = (() => {
      if (r && r.kind === 'discard') return { seat: SEATS[r.from], t: tileCode(r.t) };
      const e = h.ev;
      return e && e.type === 'discard' ? { seat: e.seat, t: e.t } : null;
    })();
    // 听牌提示：轮到玩家本人出牌时，打哪张能听、听什么、剩几张
    let hints = null;
    if (vi >= 0 && h.phase === 'turn' && h.turn === vi && !hasQueTiles(h, vi)) {
      hints = Object.fromEntries(tingHints(h, vi).map((x) => [tileCode(x.t), { waits: x.waits.map(tileCode), left: x.left }]));
    }
    const log = h.log.map((e) => ({ seat: SEATS[e.seat], text: e.open && !god && e.seat !== vi ? (h.phase === 'que' ? '已定缺' : '已决定') : e.text }));
    return {
      viewer: god ? null : viewer,
      seats: SEATS,
      handNo: h.no, hands: s.cfg.hands, cap: s.cfg.cap,
      phase: h.phase, turn: h.phase === 'turn' ? SEATS[h.turn] : null,
      dealer: SEATS[h.dealer], wall: wallLeft(h), queDone, wins: h.wins, calls: h.calls,
      react: r ? { kind: r.kind, t: tileCode(r.t), from: SEATS[r.from] } : null,
      lastDiscard,
      ev: h.ev,
      players,
      hints,
      log,
      last: s.last,
      over: s.over,
      totals: Object.fromEntries(SEATS.map((x, j) => [x, s.totals[j]])),
      history: s.history.map((d) => d.slice()),
      roles: Object.fromEntries(SEATS.map((x, j) => [x, [j === h.dealer && !s.over ? '庄' : null, h.que[j] !== null && (queDone || god || vi === j) && !s.over ? `缺${SUITS[h.que[j]]}` : null, h.won[j] && !s.over ? '已胡' : null].filter(Boolean).join(' · ')]).filter(([, v]) => v)),
      out: [],
    };
  },
};

export default game;
export { SEATS, tingHints };
