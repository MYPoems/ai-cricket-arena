// 围棋（9 / 13 / 19 路，默认 9 路）。实现电子斗蛐蛐的通用游戏接口（见 games/index.js）。
// 中国规则数子法，贴 7.5 目（黑贴 3¾ 子）；禁止自杀；全局同形禁着；可以虚手，双方连续虚手终局；
// 手数到上限（size² × 3）也终局。终局先判死子（见 rules.js scoreFinal），再数子。
// 行动 id：坐标大写（'D4'，GTP 惯例，列跳过 I）、'pass'（虚手）、'resign'（认输）。

import { COLS, SIZES, SEAT_NAMES, other, label as labelOf, parseCoord, tryPlay, ERRORS, legalPoints, hashBoard, hashKey, parseHash, scoreFinal, areaOwner, starPoints, groupAt } from './rules.js';
import { FastBoard, search, seedOf } from './engine.js';

const MARK = { b: 'X', w: 'O' };
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

// 内置 AI 的强度：level 2 = UCT + 吃子 / 逃子的随机对局；level 3 = 再加 RAVE、局部应对、更多时间
const LEVELS = {
  2: { time: { 9: 350, 13: 450, 19: 550 }, rave: false, prior: 10, c: 0.5, heavy: 1, expandAt: 3, urgent: 40 },
  3: { time: { 9: 900, 13: 1000, 19: 1100 }, rave: true, raveEquiv: 3000, prior: 10, c: 0.08, heavy: 2, expandAt: 2, urgent: 60 },
};
const EVAL_MS = 200;
// 一个点的平均归属绝对值到这个数就算「定了」；所有可下的点都定了，内置 AI 就虚手
const SETTLED = 0.9;

/** 全角转半角、中文数字（一到十九）转阿拉伯数字 */
function normalize(t) {
  return String(t || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[*`#]|^\s*>\s?/gm, '') // markdown 的加粗、代码、标题、引用记号
    .replace(/　/g, ' ')
    .replace(/十([一二三四五六七八九])?/g, (_, d) => String(10 + (d ? CN[d] : 0)))
    .replace(/[一二三四五六七八九]/g, (ch) => String(CN[ch]));
}

const sizeOf = (setup) => (SIZES.includes(Number(setup?.size)) ? Number(setup.size) : 9);
function komiOf(setup) {
  const k = Number(setup?.komi);
  return Number.isFinite(k) && Math.abs(k) <= 50 && setup?.komi !== null && setup?.komi !== '' && setup?.komi !== undefined ? Math.round(k * 2) / 2 : 7.5;
}
const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

function newState(size, komi) {
  const board = new Array(size * size).fill(null);
  const hash = hashKey(hashBoard(board));
  return {
    size, komi, board, side: 'b', moves: [], caps: { b: 0, w: 0 },
    hash, hist: [hash], passes: 0, maxMoves: size * size * 3,
    end: null, // null | 'pass' | 'limit' | 'resign'
    resigned: null, final: null,
  };
}

function lastOf(state) {
  return state.moves[state.moves.length - 1] || null;
}

function boardText(state) {
  const { size, board } = state;
  const cols = COLS.slice(0, size).split('').join(' ');
  const lines = [`    ${cols}`];
  for (let y = size - 1; y >= 0; y--) {
    let row = `${String(y + 1).padStart(2)}  `;
    for (let x = 0; x < size; x++) {
      const c = board[y * size + x];
      row += (c ? MARK[c] : '.') + ' ';
    }
    lines.push(`${row}${String(y + 1).padStart(2)}`);
  }
  lines.push(`    ${cols}`);
  return lines.join('\n');
}

function resultText(state) {
  const f = state.final;
  const why = state.end === 'pass' ? '双方连续虚手' : `到了 ${state.maxMoves} 手上限`;
  const head = `${why}，终局数子${f.dead.length ? `（判 ${deadSummary(state)}）` : ''}：黑 ${f.b}，白 ${f.w} + 贴目 ${fmt(f.komi)}`;
  return `${head}，${shortResult(f)}`;
}

/**
 * 「黑胜 1.5 目」：双方数子（子 + 空）之差再扣贴目。中国规则的正式说法是这个数的一半（胜 ¾ 子），
 * 但贴目是按目说的（7.5 目），差距也按目说，观众不用换算；数子法里多一个点就是多一目。
 */
function shortResult(f) {
  if (f.margin === 0) return '和棋';
  return `${f.margin > 0 ? '黑' : '白'}胜 ${fmt(Math.abs(f.margin))} 目`;
}

function deadSummary(state) {
  const n = { b: 0, w: 0 };
  for (const i of state.final.dead) n[state.board[i]]++;
  return [n.b ? `黑死子 ${n.b} 颗` : '', n.w ? `白死子 ${n.w} 颗` : ''].filter(Boolean).join('、');
}

const PASS_RE = /虚手|虚着|停[一1]手|停着|弃权|\bpass\b|放弃这?[一1]?手/i;
const RESIGN_RE = /认输|投子|认负|\bresign\b/i;
const COORD_RE = /(?<![A-Za-z])([A-Za-z])\s*[-,，、.]?\s*(\d{1,2})(?!\d)/;
// 写反的坐标（4D）：行号在前、列字母在后
const REV_RE = /(?<!\d)(\d{1,2})\s*[-,，、.]?\s*([A-Za-z])(?![A-Za-z])/;

/** 解析一个行动文字：坐标 / 虚手 / 认输，同一行里有几样时取写在最前面的；返回 { action } 或 { error } */
function parseActionText(state, text) {
  const t = text.trim();
  const max = COLS[state.size - 1];
  const range = `${state.size} 路：列 A–${max} 跳过 I，行 1–${state.size}`;
  const at = (re) => { const k = re.exec(t); return k ? k.index : Infinity; };
  let m = COORD_RE.exec(t);
  let letter = m?.[1], num = m?.[2];
  if (!m && (m = REV_RE.exec(t))) { letter = m[2]; num = m[1]; }
  const coord = () => {
    const L = letter.toUpperCase();
    if (L === 'I') return { error: `坐标没有 I 列（列字母跳过 I：A–${max}，H 的右边是 J），「${m[0]}」不对`, attempted: m[0] };
    const i = parseCoord(L + num, state.size);
    if (i === null) return { error: `「${L}${num}」超出棋盘（${range}）`, attempted: L + num };
    return { action: labelOf(i, state.size) };
  };
  const iCoord = m ? m.index : Infinity;
  const iPass = at(PASS_RE), iResign = at(RESIGN_RE), iTengen = at(/天元/);
  const first = Math.min(iCoord, iPass, iResign, iTengen);
  if (first === Infinity) {
    // 只有数字（「4 4」「44」）：告诉它缺列字母，比「不是坐标」好改
    if (/^\D*\d{1,2}\s*[-,，、. ]?\s*\d{0,2}\D*$/.test(t)) return { error: `「${t.slice(0, 12)}」缺列字母：坐标要写成列字母 + 行号，例如 D4（${range}）`, attempted: t.slice(0, 12) };
    return { error: null };
  }
  if (first === iCoord) return coord();
  // 「不认输」「不虚手」后面跟着坐标：按坐标算
  if (m && /[不别没]\s*$/.test(t.slice(0, first))) return coord();
  if (first === iResign) return { action: 'resign' };
  if (first === iPass) return { action: 'pass' };
  const c = (state.size - 1) / 2;
  return { action: labelOf(c * state.size + c, state.size) };
}

/** 只剩一两口气的棋串，按阵营分：{ b: [{ stones: [坐标], libs: [坐标] }], w: [...] }，气少的在前 */
function tightChains(state) {
  const { board, size } = state;
  const out = { b: [], w: [] };
  const seen = new Uint8Array(board.length);
  for (let i = 0; i < board.length; i++) {
    if (!board[i] || seen[i]) continue;
    const g = groupAt(board, size, i);
    for (const s of g.stones) seen[s] = 1;
    if (g.libs.size > 2) continue;
    const names = (list) => [...list].sort((a, b) => a - b).map((p) => labelOf(p, size));
    out[board[i]].push({ stones: names(g.stones), libs: names(g.libs) });
  }
  for (const c of ['b', 'w']) out[c].sort((x, y) => x.libs.length - y.libs.length);
  return out;
}

/** 现在的打劫禁着点：轮到的一方不能下的同形点里，刚被提掉一子的那个（没有就是空数组） */
function koPoints(state) {
  if (state.end) return [];
  const last = lastOf(state);
  if (!last || last.captured.length !== 1) return [];
  const i = parseCoord(last.captured[0], state.size);
  const r = tryPlay(state.board, state.size, i, state.side, parseHash(state.hash), new Set(state.hist));
  return r.error === 'superko' ? [last.captured[0]] : [];
}

/** 落子检查：返回错误文字或 null */
function moveError(state, seat, action) {
  if (action === 'pass' || action === 'resign') return null;
  const i = parseCoord(action, state.size);
  if (i === null) return `无法识别的坐标：${action}`;
  const r = tryPlay(state.board, state.size, i, seat, parseHash(state.hash), new Set(state.hist));
  return r.error ? ERRORS[r.error](labelOf(i, state.size)) : null;
}

// ---------- 内置 AI ----------

/** 对方刚虚手：如果现在终局自己能赢，就跟着虚手 */
function winsIfEndsNow(state, seat) {
  const f = scoreFinal(state.board, state.size, state.komi, state.side);
  return seat === 'b' ? f.margin > 0 : f.margin < 0;
}

function quickWins(state, seat) {
  const o = areaOwner(state.board, state.size);
  let d = 0;
  for (const c of o) d += c === 'b' ? 1 : c === 'w' ? -1 : 0;
  d -= state.komi;
  return seat === 'b' ? d > 0 : d < 0;
}

/** MCTS 搜一步：返回 { action, e } */
function think(state, seat, cfg, seed) {
  const fb = FastBoard.from(state.board, state.size, seat === 'b' ? 1 : 2);
  const legal = legalPoints(state, seat).legal.map((i) => fb.pt(i % state.size, Math.floor(i / state.size)));
  const last = lastOf(state);
  if (last && last.label !== 'pass') {
    const i = parseCoord(last.label, state.size);
    fb.last = fb.pt(i % state.size, Math.floor(i / state.size));
  }
  const res = search(fb, legal, { ...cfg, komi: state.komi, seed });
  if (!res.best) return { action: 'pass', e: res.winrate ?? (quickWins(state, seat) ? 1 : 0) };
  // 能下的点都已经定了（归属不会再变），继续下只是填自己的地或往对方地里送子：虚手
  const settled = res.kids.every((k) => Math.abs(res.own[k.mv]) >= SETTLED);
  const [x, y] = fb.xy(res.best);
  // 期望得分：一半看随机对局的胜局比例，一半看平均盘面差（折成 0–1）。只用最好那一手的胜率（还掺着先验的虚拟局数）
  // 步与步之间跳得厉害，实测强手里四成被标成缓着 / 失误；这样平滑后误报降到 1% 左右，送吃、漏提仍看得出来
  const e = 0.5 * res.rootWin + 0.5 / (1 + Math.exp(-res.meanDiff / (state.size * 2 / 3)));
  return { action: settled ? 'pass' : labelOf(y * state.size + x, state.size), e };
}

function builtin(state, seat, { level = 2, random = false, seed = null, playouts = null } = {}) {
  const last = lastOf(state);
  const oppPassed = last?.label === 'pass' && last.side !== seat;
  if (random || level <= 1) {
    // 对方虚手：现在终局自己能赢就跟着虚手。初级按正式的终局判定算（真人超时由它代走，不能把赢棋走输）；随机选手只粗数
    if (oppPassed && (random ? quickWins(state, seat) : winsIfEndsNow(state, seat))) return 'pass';
    const fb = FastBoard.from(state.board, state.size, seat === 'b' ? 1 : 2);
    const c = seat === 'b' ? 1 : 2;
    const pt = (i) => fb.pt(i % state.size, Math.floor(i / state.size));
    let cand = legalPoints(state, seat).legal.filter((i) => random || !fb.eyeish(pt(i), c));
    if (!random) {
      // 初级：不填自己的眼，也不把自己的一串子送进虎口（有别的点可下时）。它还是乱下，但不会一手葬送一块棋——
      // 真人超时由它代走一步，代走的这一步不该比虚手更糟
      const safe = cand.filter((i) => !fb.selfAtari(pt(i), c));
      if (safe.length) cand = safe;
      else if (cand.length && winsIfEndsNow(state, seat)) return 'pass';
    }
    if (!cand.length) return 'pass';
    const r = seed === null ? Math.random() : ((seedOf(`${seed}:${state.moves.length}`) % 100000) / 100000);
    return labelOf(cand[Math.floor(r * cand.length)], state.size);
  }
  if (oppPassed && winsIfEndsNow(state, seat)) return 'pass';
  const base = LEVELS[Math.min(3, Math.round(level))];
  const cfg = { ...base, timeMs: base.time[state.size] ?? 600, ...(playouts ? { maxPlayouts: playouts, timeMs: 1e9 } : {}) };
  return think(state, seat, cfg, seed === null ? undefined : seedOf(`${seed}:${state.hash}:${state.moves.length}`)).action;
}

export default {
  id: 'go',
  name: '围棋',
  players: { min: 2, max: 2, default: 2 },
  // clock：两人棋类的每步限时（默认 5 分钟）和超时判负次数（默认 3 次）
  features: { draw: false, hidden: false, winbar: true, evalEngine: 'local', clock: true },
  noun: '落子',
  rankedSeries: { legs: 2, sameSeed: false }, // 交换先后手各下一盘

  seats: () => ['b', 'w'],
  seatName: (seat) => SEAT_NAMES[seat],

  /** setup.size：9 / 13 / 19（默认 9）；setup.komi：贴目（默认 7.5） */
  create({ setup } = {}) {
    return newState(sizeOf(setup), komiOf(setup));
  },

  pending: (state) => (state.end ? [] : [state.side]),

  actions(state, seat) {
    if (state.end || seat !== state.side) return [];
    const out = legalPoints(state, seat).legal.map((i) => ({ id: labelOf(i, state.size), label: labelOf(i, state.size) }));
    out.push({ id: 'pass', label: '虚手' });
    return out;
  },

  apply(state, seat, action) {
    if (state.end) throw new Error('对局已经结束');
    if (seat !== state.side) throw new Error(`现在不是${SEAT_NAMES[seat]}落子`);
    const a = String(action ?? '').trim();
    const lower = a.toLowerCase();
    if (lower === 'resign') {
      return { ...state, moves: [...state.moves, { side: seat, label: 'resign', captured: [] }], end: 'resign', resigned: seat };
    }
    let next;
    if (lower === 'pass') {
      next = { ...state, side: other(seat), passes: state.passes + 1, moves: [...state.moves, { side: seat, label: 'pass', captured: [] }] };
    } else {
      const i = parseCoord(a, state.size);
      if (i === null) throw new Error(`无法识别的坐标：${action}`);
      const r = tryPlay(state.board, state.size, i, seat, parseHash(state.hash), new Set(state.hist));
      if (r.error) throw new Error(ERRORS[r.error](labelOf(i, state.size)));
      const hash = hashKey(r.hash);
      next = {
        ...state, board: r.board, side: other(seat), passes: 0, hash, hist: [...state.hist, hash],
        caps: { ...state.caps, [seat]: state.caps[seat] + r.captured.length },
        moves: [...state.moves, { side: seat, label: labelOf(i, state.size), captured: r.captured.map((c) => labelOf(c, state.size)) }],
      };
    }
    const end = next.passes >= 2 ? 'pass' : next.moves.length >= next.maxMoves ? 'limit' : null;
    if (end) {
      next.end = end;
      next.final = scoreFinal(next.board, next.size, next.komi, next.side);
    }
    return next;
  },

  outcome(state) {
    if (!state.end) return { over: false };
    if (state.end === 'resign') {
      const w = other(state.resigned);
      return { over: true, winner: w, ranks: { [w]: 1, [state.resigned]: 2 }, reason: `${SEAT_NAMES[state.resigned]}认输` };
    }
    const reason = resultText(state);
    const m = state.final.margin;
    if (m === 0) return { over: true, winner: null, ranks: { b: 1, w: 1 }, reason };
    const w = m > 0 ? 'b' : 'w';
    return { over: true, winner: w, ranks: { [w]: 1, [other(w)]: 2 }, reason };
  },

  forfeit(state, seat, reason) {
    const w = other(seat);
    return { over: true, winner: w, ranks: { [w]: 1, [seat]: 2 }, reason };
  },

  label(state, seat, action) {
    const a = String(action ?? '').trim().toLowerCase();
    return a === 'pass' ? '虚手' : a === 'resign' ? '认输' : a.toUpperCase();
  },

  // ---------- 给模型 ----------
  systemPrompt(seat, { style = '', showLegal = false, state = null } = {}) {
    const size = state?.size || 9;
    const komi = state?.komi ?? 7.5;
    const max = COLS[size - 1];
    return [
      `你是一名围棋棋手，在这盘棋里执${SEAT_NAMES[seat]}（棋盘上记作 ${MARK[seat]}，${seat === 'b' ? '先手' : '后手'}）。目标是赢下这盘棋。`,
      '',
      `【规则】${size} 路棋盘，黑先白后轮流落子，中国规则数子法：终局时自己的子加上自己围住的空点多者胜，黑方贴 ${fmt(komi)}（白方另加 ${fmt(komi)}）。`,
      '一块棋的气（上下左右相邻的空点）全被对方占住就被提掉。禁止自杀（落下后自己没气、又提不掉对方的子）。',
      '禁止全局同形：落子后整盘局面不能和以前出现过的任何局面相同（所以打劫时被提的一方要先在别处走一手「劫材」才能提回）。',
      `可以虚手（停一手）。双方连续虚手，或下到 ${size * size * 3} 手，对局结束：系统判定死子（无法做活的棋）提掉后数子。中途可以认输。`,
      '【什么时候虚手】只有在双方边界都封好、没有能提的子、自己也没有要补的棋时才虚手；还有大场、还能提子或还有棋被打吃时不要虚手。',
      '数子法在自己地盘里落子不亏：对方留在你地盘里的残子，拿不准死活就花几手提干净再虚手，免得被判成活棋。',
      '反过来，不要往对方已经围死的地盘里反复送子，也不要无意义地填自己的眼。对方虚手后，你确认没棋可下且不落后，就也虚手结束。',
      `【坐标】列字母 A–${max} 从左到右，注意跳过字母 I（H 的右边是 J）；行号 1–${size} 从下到上。例如左下角是 A1。`,
      `棋盘上 X 是黑子，O 是白子，. 是空点；每行左右两端都标了行号，上下都标了列字母，数格子时对着看。${showLegal ? '每一步会列出你可以落子的点。' : ''}`,
      '',
      '【输出格式】每一步只简短回答，用中文，除落子外合计不超过 80 字，严格按下面五行：',
      '判断：一句话说明局面谁好、为什么（实地、厚薄、死活）',
      '威胁：一句话说明对方的威胁或自己的弱棋（没有就写「无」）',
      '理由：一句话说明你为什么下这里',
      '胜率：你估计自己现在的获胜概率，写成 0–100 的整数加 %',
      '落子：坐标，例如 D4；要停一手写「落子：虚手」，要认输写「落子：认输」',
      style ? `\n【你的风格】${style}\n（风格只影响你的下棋取向，不能改变上面的规则和输出格式。）` : '',
    ].join('\n');
  },

  turnPrompt(state, seat, { showLegal = false } = {}) {
    const last = lastOf(state);
    const { legal, banned } = legalPoints(state, seat);
    const recent = state.moves.slice(-12).map((m, i, arr) => `${state.moves.length - arr.length + i + 1}.${SEAT_NAMES[m.side][0]}${m.label === 'pass' ? '虚手' : m.label}`).join(' ');
    let lastLine = '这是本局第一手。';
    if (last) {
      const who = last.side === seat ? '你' : '对方';
      if (last.label === 'pass') lastLine = `${who}上一手：虚手。${who === '对方' ? '你也虚手的话，对局立即结束并数子。' : ''}`;
      else lastLine = `${who}上一手：${last.label}${last.captured.length ? `（提掉 ${last.captured.length} 子：${last.captured.join(' ')}）` : ''}`;
    }
    const stones = { b: 0, w: 0 };
    for (const c of state.board) if (c) stones[c]++;
    const why = { superko: '全局同形（打劫）', suicide: '自杀' };
    const left = state.maxMoves - state.moves.length;
    // 气紧的棋串：大模型数气很差，把只剩一两口气的串直接列出来（盘面上的事实，不是建议）
    const tight = tightChains(state);
    const tightLine = (c) => tight[c].map((g) => `${g.stones.join(' ')}（${g.libs.length === 1 ? `只剩 1 气，被打吃，气在 ${g.libs[0]}` : `2 气：${g.libs.join(' ')}`}）`).join('；');
    // 盘面过半或对方虚手后，给出按现在盘面直接数的结果，方便判断要不要收兵
    let count = null;
    if (state.moves.length >= state.size * state.size / 2 || last?.label === 'pass') {
      const o = areaOwner(state.board, state.size);
      let b = 0, w = 0;
      for (const c of o) { if (c === 'b') b++; else if (c === 'w') w++; }
      count = `按现在的盘面直接数（不判死活，挨着双方的空点不算）：黑 ${b}，白 ${w} + 贴目 ${fmt(state.komi)}。`;
    }
    return [
      `第 ${state.moves.length + 1} 手（上限 ${state.maxMoves} 手${left <= 20 ? `，只剩 ${left} 手就强制终局数子` : ''}），轮到你（${SEAT_NAMES[seat]}，${MARK[seat]}）落子。`,
      lastLine,
      `盘上子数：黑 X ${stones.b}，白 O ${stones.w}。提子：黑方已提 ${state.caps.b} 子，白方已提 ${state.caps.w} 子。`,
      count,
      tight[seat].length ? `你的气紧的棋：${tightLine(seat)}` : null,
      tight[other(seat)].length ? `对方气紧的棋：${tightLine(other(seat))}` : null,
      banned.length ? `禁着点：${banned.map((b) => `${labelOf(b.i, state.size)}（${why[b.why]}）`).join('、')}` : null,
      '',
      '当前棋盘：',
      boardText(state),
      showLegal ? `\n你可以落子的点：${legal.map((i) => labelOf(i, state.size)).join(' ')}（或虚手）` : null,
      recent ? `\n最近的着手：${recent}` : null,
    ].filter((l) => l !== null).join('\n');
  },

  retryPrompt: (reason, attempt, max) => `你上一个回答的落子无效：${reason}。请重新选择（这是第 ${attempt} 次重下，最多 ${max} 次，再无效判负），仍按五行格式回答。`,

  parseReply(state, seat, text) {
    const t = normalize(text);
    const win = /胜率\s*[:：]?\s*(\d{1,3})/.exec(t);
    const winrate = win ? Math.min(100, Number(win[1])) : null;
    const lines = [...t.matchAll(/(?:落子|着法|着手|落点|行动|下法)(?:位置|坐标|点)?\s*[:：]\s*([^\n]*)/g)];
    const lineText = lines.length ? lines[lines.length - 1][1] : null;
    let r = null;
    if (lineText !== null) {
      r = parseActionText(state, lineText);
      if (!r.action && !r.error) return { action: null, attempted: lineText.trim().slice(0, 12) || null, winrate, error: `「${lineText.trim().slice(0, 12)}」不是坐标（最后一行应为「落子：D4」这样的列字母 + 行号，或「落子：虚手」）` };
    } else {
      // 没有「落子：」：最后一行单独写了虚手 / 认输，或全文最后一个坐标
      const tail = t.trim().split('\n').pop().trim();
      if (/^(我?(选择)?(虚手|停[一1]手|pass|认输|resign))[。.!！]?$/i.test(tail)) r = parseActionText(state, tail);
      else {
        const all = [...t.matchAll(/(?<![A-Za-z])([A-HJ-Ta-hj-t])\s?(1\d|[1-9])(?!\d)/g)].pop();
        if (all) r = parseActionText(state, all[1] + all[2]);
      }
      if (!r || (!r.action && !r.error)) return { action: null, attempted: null, winrate, error: '没有找到落子（最后一行应为「落子：D4」这样的格式，或「落子：虚手」）' };
    }
    if (r.error) return { action: null, attempted: r.attempted || null, winrate, error: r.error };
    const err = moveError(state, seat, r.action);
    if (err) return { action: null, attempted: r.action, winrate, error: err };
    return { action: r.action, attempted: r.action, winrate, error: null };
  },

  mockReply(state, seat, action) {
    const a = String(action);
    const move = a === 'pass' ? '虚手' : a === 'resign' ? '认输' : a.toUpperCase();
    const mine = state.caps[seat], theirs = state.caps[other(seat)];
    return [
      `判断：${mine >= theirs ? '提子不落后' : '提子暂时落后'}，盘面还要看死活和实地。`,
      '威胁：对方想破我的空，先补厚自己。',
      `理由：${a === 'pass' ? '没有要紧的地方了，停一手。' : '这里是双方都想要的要点。'}`,
      `胜率：${Math.max(5, Math.min(95, 50 + (mine - theirs) * 3))}%`,
      `落子：${move}`,
    ].join('\n');
  },

  // ---------- 内置 AI ----------
  /** opts：level 1–3；random（随机合法）；seed（固定随机，测试用）；playouts（按局数而不是时间搜，测试用） */
  builtinMove(state, seat, opts = {}) {
    if (state.end || seat !== state.side) throw new Error(`现在不是${SEAT_NAMES[seat]}落子`);
    return builtin(state, seat, opts);
  },

  // ---------- 评估 ----------
  evalSpec(state) {
    if (state.end) return null;
    const side = state.side;
    return {
      engine: 'local', persp: side,
      evaluate: () => {
        const r = think(state, side, { ...LEVELS[3], timeMs: EVAL_MS }, seedOf(`${state.hash}:${state.moves.length}`));
        return { e: Math.round((r.e ?? 0.5) * 1000) / 1000, best: r.action, source: 'mcts' };
      },
    };
  },

  view(state) {
    const last = lastOf(state);
    const f = state.final;
    return {
      size: state.size, komi: state.komi, board: state.board, side: state.side,
      over: !!state.end, end: state.end, resigned: state.resigned,
      lastMove: last && last.label !== 'pass' && last.label !== 'resign' ? last.label : null,
      lastPass: last?.label === 'pass' ? last.side : null,
      captured: last?.captured || [],
      ko: koPoints(state), // 打劫：现在不能立即提回的点（观众、回放也看得到）
      caps: state.caps, maxMoves: state.maxMoves,
      stars: starPoints(state.size).map((i) => labelOf(i, state.size)),
      moves: state.moves.map((m) => ({ side: m.side, label: m.label === 'pass' ? '虚手' : m.label === 'resign' ? '认输' : m.label })),
      final: f ? {
        owner: f.owner, dead: f.dead.map((i) => labelOf(i, state.size)), b: f.b, w: f.w, komi: f.komi, margin: f.margin,
        text: resultText(state), result: shortResult(f),
      } : null,
    };
  },
};
