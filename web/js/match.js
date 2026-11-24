// 对局页（所有游戏通用）：一屏显示。中间是游戏画面、胜率条、走势和着法，两侧是各座位的选手卡和思考。
// 回放：从对局记录在浏览器里重建每一步，可以播放、调速、拖动进度。
// 录制版式：地址带 ?record=1 时隐藏导航、自动从头播放，播完设置 window.__replayDone = true（供服务端录成视频）。

import { h, api, post, listen, toast, guard, tierBadge, fmtMs, fmtTokens, pct, MODE_NAMES, resultText, seatOutcome, modelLine, dialog, confirmDialog, icon, cleanName, coin, avatarFace, summarizeSeats } from './ui.js';
import { loadRenderer, PALETTE } from '../stage/index.js';
import { createFold } from './fold.js';
import { createSpot } from './spot.js';
import { sfx, nudgeTurn, soundOn, setSound } from './sound.js';
import { typeMs, speechPause, newSpeech } from '/games/speech.js';

const LINE_KEYS = ['判断', '威胁', '理由', '推断', '计划'];
const QUALITY_CLASS = { 最佳: 'good', 好棋: 'good', 缓着: 'warn', 失误: 'warn', 大漏着: 'bad' };
const DRAW_TAG = { pending: ['提和', 'warn'], declined: ['提和被拒', ''], accepted: ['提和', 'good'], ignored: ['提和（冷却中，未送出）', ''] };
const SPEEDS = [0.5, 1, 2, 4, 8];
// 拉丁字母的着法（e4、Qc2#、H8）不用毛笔字：加 .latin 换成无衬线、等宽数字
const latin = (s) => (/^[\x20-\x7e]+$/.test(String(s ?? '')) && /[A-Za-z0-9]/.test(String(s)) ? ' latin' : '');
/**
 * 列表滚动过时顶部淡出（不出现被切一半的一行）：滚动时给 .scrolled。
 * 只听 scroll 事件（程序里改 scrollTop 也会触发），不在改完 DOM 之后马上读 scrollTop——那会逼浏览器多排一次版
 */
function fadeTop(el) {
  let pend = 0;
  const mark = () => {
    if (pend) return;
    pend = requestAnimationFrame(() => { pend = 0; el.classList.toggle('scrolled', el.scrollTop > 2); });
  };
  el.addEventListener('scroll', mark, { passive: true });
  return mark;
}

function parseAnalysis(text) {
  if (!text) return null;
  const out = {};
  for (const k of [...LINE_KEYS, '胜率']) {
    const m = new RegExp(`${k}[:：]\\s*(.+)`).exec(text);
    if (m) out[k] = m[1].trim();
  }
  return Object.keys(out).length >= 2 ? out : null;
}

/** 单步准确率（lichess AccuracyPercent）：按这一步的胜率损失（百分点）折算成 0–100 */
function moveAccuracy(loss) {
  const d = Math.max(0, loss * 100);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * d) - 3.1669 + 1));
}
/** 整局准确率：算术平均和调和平均再取平均（调和平均让一次大漏着更显眼）；没有评估时返回 null */
function gameAccuracy(list) {
  if (!list.length) return null;
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  const harm = list.length / list.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return Math.round((mean + harm) / 2);
}

function qualityChip(q) {
  if (!q) return null;
  return h('span', { class: `chip ${QUALITY_CLASS[q.tag] || ''}`, title: `比引擎最佳着法少 ${Math.round(q.loss * 100)} 个胜率百分点` },
    q.tag, q.loss >= 0.05 ? ` −${Math.round(q.loss * 100)}%` : '');
}

export async function matchView(root, id, { characters, session }) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const recordMode = query.get('record') === '1';
  let d = await api(`/matches/${id}`);
  const renderer = await loadRenderer(d.game);
  const gameMod = (await import(`/games/${d.game}/index.js`)).default;
  const { replay } = await import('/games/index.js');

  // 编码坏掉的旧名字显示成「未命名蛐蛐」
  for (const p of Object.values(d.players || {})) if (p?.name) p.name = cleanName(p.name);
  const chars = new Map(characters.map((c) => [c.id, { ...c, name: cleanName(c.name) }]));
  const turns = new Map(d.turns.map((t) => [t.ply, t]));
  const seats = d.seatOrder;
  const two = seats.length === 2;
  const partials = new Map((d.partials || []).map((p) => [p.seat, { ...p }]));
  // null 表示跟随最新局面；录制模式从第 0 步开始，首帧不能是终局画面
  let viewPly = recordMode && d.status !== 'running' ? 0 : null;
  // 回放和录制时不剧透：着法列表、走势图只画到当前步
  const noSpoil = () => !!replaying || recordMode;
  let paused = d.paused;
  // 思考计时：每个座位这一轮从什么时候开始想（本机时钟）；接上服务端给的「已经想了多久」
  const clock = new Map();
  const resetClock = () => {
    clock.clear();
    for (const p of d.partials || []) clock.set(p.seat, Date.now() - (p.elapsed || 0));
    if (d.waitingHuman) clock.set(d.waitingHuman, Date.now() - (d.waitingElapsed || 0));
  };
  resetClock();
  let waitingHuman = d.waitingHuman;
  let offerNext = false;
  let replaying = null; // { timer }
  let speed = Number(query.get('speed')) || 1;

  const seatChar = (seat) => chars.get(d.seats[seat]) || d.players[seat];
  const seatName = (seat) => d.seatNames?.[seat] || seat;
  // 座位卡上的名字：好几位选手同一个前缀（「内置 AI · 初级」×5）时只写后半截「初级」，前缀在说明行里写一次；
  // 窄屏省略号落在名字末尾，不会切在「·」后面
  const fullName = (s) => seatChar(s)?.name || seatName(s);
  const sharedPrefix = (() => {
    const cnt = new Map();
    for (const s of seats) { const n = fullName(s); const i = n.lastIndexOf('·'); if (i > 0) { const p = n.slice(0, i).trim(); cnt.set(p, (cnt.get(p) || 0) + 1); } }
    return new Set([...cnt].filter(([, k]) => k >= 2).map(([p]) => p));
  })();
  const seatLabel = (s) => { const n = fullName(s); const i = n.lastIndexOf('·'); return i > 0 && sharedPrefix.has(n.slice(0, i).trim()) ? n.slice(i + 1).trim() : n; };
  const color = (seat) => renderer.seatColor?.(seat, seats.indexOf(seat)) || PALETTE[seats.indexOf(seat) % PALETTE.length];
  // 着法表里的阵营小棋子：用棋子本来的颜色（白子白、黑子黑、红子红），不用为文字对比度调过的阵营色
  const SIDE_DOT = { xiangqi: { r: '#c42d1e', b: '#1c1612' }, chess: { w: '#f6f0e2', b: '#1c1612' }, gomoku: { b: '#1c1612', w: '#f6f0e2' }, othello: { b: '#1c1612', w: '#f6f0e2' } };
  const sideDot = (seat) => SIDE_DOT[d.game]?.[seat] || color(seat);
  // 我自己坐的座位（一盘里可以有多位真人，各看各的）；有真人在局时不给暂停
  const humanSeat = d.mySeat || null;
  const hasHuman = seats.some((s) => seatChar(s)?.kind === 'human');
  let flipped = humanSeat ? !!renderer.flipFor?.(humanSeat) : false;
  // 真人在下棋时不给看引擎评估（胜率条、走势、着法评价、评估刻度），结束后再显示
  // 服务端给了 d.evalHidden 就以它为准（进行中、座位上有真人或自带 Agent 时为 true：这时服务端不再下发评估，
  // 不藏起来的话胜率条会一直停在开局那个数）；旧服务端没有这个字段时按「有真人在下」判断
  const evalHidden = () => (typeof d.evalHidden === 'boolean' ? d.evalHidden && d.status === 'running' : hasHuman && d.status === 'running');
  const qChip = (q) => (evalHidden() ? null : qualityChip(q));
  // 暂停、单步、中止：开局的人和庄家
  const canControl = !!session?.user && (session.user.role === 'admin' || d.created_by === session.user.id);
  const offers = () => d.options?.draw?.offers || [];
  const pendingOffer = () => { const o = offers().at(-1); return o?.status === 'pending' ? o : null; };
  const canReview = () => Array.isArray(d.record?.actions);

  const doAction = guard(async (action) => {
    await post(`/matches/${id}/move`, { action, offerDraw: offerNext });
    offerNext = false;
    waitingHuman = null;
  });
  const stage = renderer.createStage({ onAction: doAction });
  // 对称座位版式（狼人杀、谁是卧底）：游戏模块提供 duoView(view)，返回场景和每个座位的状态
  const duo = typeof renderer.duoView === 'function';
  let duoInfo = { scene: null, seats: {} };
  let focusSeat = null; // 点座位卡切换焦点；null 表示跟随当前行动者
  // 刚落地的一句发言（狼人杀、谁是卧底）：焦点区停在说话的人身上，把这句逐字打出来，打完再停一会儿才换到下一位。
  // 服务端按 games/speech.js 的同一份时长停顿；回放按倍速打。ply 记下是在哪一步演的（null 是直播），翻到别的步就不算
  let presenting = null; // { seat, text, ply, t0, typeDur, until, timer }
  let pickSel = null; // 选目标分两步：先点座位选中（pickSel），再点「确认」才提交，防误触
  // 牌桌版式（德州）：牌桌上已有每个人的名牌和动作，两侧不放选手卡；右上是聚光框（只显示轮到的人），右下是本手记录
  const hud = !duo && !!renderer.hud;
  const spot = hud ? createSpot() : null;
  const handBox = h('section', { class: 'hand-log' });
  let pinPly = null; // 在本手记录里点过的一步；null 表示聚光框跟随当前行动者
  let spotPly = null;
  stage.setFlipped?.(flipped);

  // 票型弧线的画布（狼人杀、谁是卧底），画法见下面的 drawVotes
  const SVGNS = 'http://www.w3.org/2000/svg';
  const voteSvg = document.createElementNS(SVGNS, 'svg');
  voteSvg.setAttribute('class', 'vote-arcs');
  voteSvg.setAttribute('aria-hidden', 'true');
  voteSvg.innerHTML = '<defs><marker id="vote-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs><g></g>';
  let voteState = { key: null, shown: new Set(), until: 0, links: [] };

  // ---------- 布局 ----------
  const camps = {};
  for (const seat of seats) {
    const head = h('div', { class: 'camp-head' });
    const list = h('div', { class: 'camp-thoughts' });
    const el = h('section', { class: `camp${two ? '' : ' compact'}`, style: { '--side-color': color(seat) } }, head, list);
    camps[seat] = { head, list, el, mark: fadeTop(list) };
  }
  const half = Math.ceil(seats.length / 2);
  const leftSeats = seats.slice(0, half);
  const rightSeats = seats.slice(half);
  const statusBar = h('div', { class: 'stage-bar' });
  const winbarOn = !!(d.features?.winbar && two);
  // 拔河胜率条：放在转播条里，左边是第一个座位
  const tugL = h('span'), tugR = h('span'), tugFill = h('i', { class: 'l' }), tugKnot = h('span', { class: 'knot' });
  const tug = h('div', { class: 'tug' }, tugL, h('div', { class: 'bar' }, tugFill, h('i', { class: 'r' }), tugKnot), tugR);
  const curve = h('div', { class: 'stage-curve' });
  // 着法表是一个 listbox：Tab 进来落在当前这一步，方向键逐步走（选中即跳到那一步），Home / End 到头尾
  const moves = h('div', { class: 'stage-moves', role: 'listbox', 'aria-label': '着法记录', tabindex: -1 });
  moves.addEventListener('keydown', (e) => {
    const t = e.target.closest?.('.mv');
    if (!t || e.ctrlKey || e.metaKey || e.altKey) return;
    const all = [...moves.querySelectorAll('.mv')];
    const i = all.indexOf(t);
    let to = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = all[i - 1];
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = all[i + 1];
    else if (e.key === 'Home') to = all[0];
    else if (e.key === 'End') to = all.at(-1);
    else if (e.key === 'Enter' || e.key === ' ') to = t;
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (!to) return;
    for (const x of all) x.tabIndex = x === to ? 0 : -1;
    to.focus({ preventScroll: false });
    if (canReview()) { stopReplay(); goto(Number(to.dataset.ply)); }
  });
  const [aw, ah] = renderer.aspect || [1, 1];
  const cleanups = [];
  const boardWrap = h('div', { class: 'board-wrap' }, stage.el);
  fadeTop(moves);

  const seatEls = Object.fromEntries(seats.map((s) => [s, h('div', { class: 'seat' })]));
  const sceneEl = h('div', { class: 'scene' });
  const logSum = h('span', {}, '全部记录');
  let fold = null;
  const focusEl = h('div', { class: 'focus' });
  if (duo) {
    // 全部行动记录默认收起：发言在焦点区按人看，这里只留给想逐步翻的人
    const logBox = h('details', { class: 'duo-log' }, h('summary', {}, logSum), moves);
    // data-n：每列最多几个座位，样式按它给座位卡分档（4 人局每列 2 个，9 人局左列 5 个）
    // --cols：窄屏时座位排成头像格，一行几个（5 人以内一行排完，再多分两行）
    root.replaceChildren(h('div', { class: `arena duo no-winbar g-${d.game}${recordMode ? ' recording' : ''}`, 'data-n': Math.ceil(seats.length / 2), style: { '--cols': seats.length <= 5 ? seats.length : Math.ceil(seats.length / 2) } },
      h('div', { class: 'seats' }, ...leftSeats.map((s) => seatEls[s])),
      h('section', { class: 'stage' }, statusBar,
        sharedPrefix.size ? h('div', { class: 'seat-cap' }, h('span', { class: 'label' }, '选手'), summarizeSeats(seats.map(fullName), { max: 4 })) : null,
        sceneEl, focusEl, h('div', { class: 'duo-stage' }, stage.el), logBox),
      // 单数人局右列少一个座位：补一个看不见的占位，两列的顶边对齐（窄屏头像格里不显示）
      h('div', { class: 'seats' }, ...rightSeats.map((s) => seatEls[s]), rightSeats.length < leftSeats.length ? h('div', { class: 'seat seat-ghost', 'aria-hidden': 'true' }) : null),
    ));
    // 放不下时把面板收成胶囊按钮（见 fold.js）；按钮条放在面板的位置上
    const arenaEl = root.firstElementChild;
    arenaEl.append(voteSvg);
    new ResizeObserver(() => drawVotes(null, true)).observe(arenaEl);
    fold = createFold({ arena: arenaEl, stageCol: arenaEl.querySelector('.stage'), focusEl, panelRoot: stage.el, logBox, moves, logLabel: () => logSum.textContent.replace(/^全部记录\s*·\s*/, '') });
    logBox.before(fold.el);
    // 收着的时候不滚动记录（见 renderMoves），展开时补一次
    logBox.addEventListener('toggle', () => { if (logBox.open) renderMoves(); });
  } else if (hud) {
    root.replaceChildren(h('div', { class: `arena hud g-${d.game}${recordMode ? ' recording' : ''}`, style: { '--aw': aw, '--ah': ah } },
      h('section', { class: 'stage' }, statusBar, h('div', { class: 'stage-board' }, h('div', { class: 'board-wrap' }, stage.el))),
      h('aside', { class: 'hud-col' }, spot.el, handBox)));
  } else {
    // 棋类（.plain）：桌面上棋盘是主角，按屏幕高度定大小；走势图和着法放到两侧栏的底部（见 app.css 的 .arena.plain）
    root.replaceChildren(h('div', { class: `arena plain g-${d.game}${winbarOn ? '' : ' no-winbar'}${recordMode ? ' recording' : ''}`, style: { '--aw': aw, '--ah': ah } },
      h('div', { class: 'camp-col' }, ...leftSeats.map((s) => camps[s].el)),
      h('section', { class: 'stage' },
        statusBar,
        h('div', { class: 'stage-board' }, boardWrap),
        winbarOn ? curve : null,
        moves,
      ),
      h('div', { class: 'camp-col' }, ...rightSeats.map((s) => camps[s].el)),
    ));
    // 棋盘高度 = 屏高 − 转播条（转播条按钮折行时会变高，量出来交给 CSS 的 --below）
    const arenaEl = root.firstElementChild;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!arenaEl.isConnected) return;
        const wide = matchMedia('(min-width: 1101px)').matches;
        const below = wide ? statusBar.offsetHeight + parseFloat(getComputedStyle(arenaEl).rowGap || '0') : 0;
        const cur = parseFloat(arenaEl.style.getPropertyValue('--below')) || 0;
        if (!wide) arenaEl.style.removeProperty('--below');
        else if (Math.abs(cur - below) > 1) arenaEl.style.setProperty('--below', `${Math.ceil(below)}px`);
      });
    };
    new ResizeObserver(measure).observe(statusBar);
    addEventListener('resize', measure);
    cleanups.push(() => removeEventListener('resize', measure));
  }
  if (recordMode) document.body.classList.add('record-mode');
  // 手机顶栏的「‹ 大厅 · 游戏名」
  const backG = document.getElementById('topBackGame');
  if (backG) backG.textContent = d.gameName ? ` · ${d.gameName}` : '';
  // 读屏：页面一级标题（视觉上转播条已经写着游戏名）；新的一步用 polite 播报，最快 1.5 秒一句，攒着的只报最新的
  const liveRegion = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  root.append(h('h1', { class: 'sr-only' }, `${d.gameName || '对局'} · ${summarizeSeats(seats.map((s) => seatChar(s)?.name || seatName(s)), { max: 4 })}`), liveRegion);
  let annTimer = 0, annText = '', annAt = 0;
  function announceMove(text) {
    annText = text;
    if (annTimer) return;
    annTimer = setTimeout(() => { annTimer = 0; annAt = Date.now(); liveRegion.textContent = annText; }, Math.max(0, 1500 - (Date.now() - annAt)));
  }
  cleanups.push(() => clearTimeout(annTimer));

  // 座位上的选手名和头像，画面模块可以用来画名牌
  const playerInfo = Object.fromEntries(seats.map((s) => [s, { name: seatChar(s)?.name || seatName(s), avatar: seatChar(s)?.avatar || '？', seatName: seatName(s) }]));

  // ---------- 高光大印 ----------
  // 将军、绝杀、炸弹、全下等时刻盖一枚朱印，1.6 秒后自己消失；短时间内只盖一次，不挡操作
  let lastStamp = 0;
  function stampFx(text, force = false) {
    if (!text || (!force && Date.now() - lastStamp < 1200)) return;
    lastStamp = Date.now();
    const el = h('div', { class: 'stamp-fx', 'aria-hidden': 'true' }, text);
    el.addEventListener('animationend', () => el.remove());
    document.body.append(el);
    setTimeout(() => el.remove(), 2500);
  }
  /** 棋类终局：棋盘上浮起一条结果横幅（「1-0 · 将死」「和棋」），3 秒后自己淡去；标题栏里已经有结果，不再弹提示条 */
  function resultBanner() {
    const r = d.result;
    if (!two || duo || hud || !r || r.aborted) return;
    const o0 = seatOutcome(r, seats[0]);
    const draw = o0 === 'd';
    const mine = humanSeat ? seatOutcome(r, humanSeat) : null;
    const main = draw ? '和棋' : mine ? (mine === 'w' ? '你赢了' : '你输了') : d.game === 'chess' ? (o0 === 'w' ? '1-0' : '0-1') : `${seatName(o0 === 'w' ? seats[0] : seats[1])}胜`;
    const el = h('div', { class: `stage-banner${draw ? ' draw' : ''}`, role: 'status' }, h('span', { class: 'seal', 'aria-hidden': 'true' }, draw ? '和' : mine === 'l' ? '负' : '胜'),
      h('div', { class: 'bn-t' }, h('b', { class: latin(main).trim() || null }, main), r.reason ? h('span', {}, r.reason) : null));
    boardWrap.querySelector('.stage-banner')?.remove();
    boardWrap.append(el);
    setTimeout(() => el.remove(), 3300);
  }
  /** 这一步配什么音效 */
  function soundFor(label = '', view = null) {
    const t = String(label || '');
    if (d.game === 'poker') return /弃牌|过牌/.test(t) ? 'card' : 'chip';
    if (d.game === 'doudizhu') return /炸弹|王炸/.test(t) ? 'bomb' : 'card';
    if (d.game === 'werewolf' || d.game === 'undercover' || d.game === 'dilemma') return null;
    const st = stampFor(t, view);
    if (st === '杀' || st === '将') return 'check';
    return /吃|x|×/.test(t) ? 'capture' : 'move';
  }
  function stampFor(label = '', view = null) {
    const t = String(label || '');
    // 斗地主、德州的画面自己演炸弹金光和 ALL IN 横幅，不再叠盖大印
    if (d.game === 'doudizhu' || d.game === 'poker') return /春天/.test(t) ? '春天' : null;
    if (/王炸/.test(t)) return '王炸';
    if (/炸弹/.test(t)) return '炸';
    if (/全下/i.test(t)) return '全下';
    if (/春天/.test(t)) return '春天';
    if (/#$/.test(t)) return '杀';
    if (/[+]$/.test(t) || view?.inCheck) return '将';
    return null;
  }

  // ---------- 数据 ----------
  const viewCache = new Map();
  function viewAt(ply) {
    if (!canReview()) return d.view;
    if (!viewCache.has(ply)) {
      const st = replay(gameMod, { ...d.record, actions: d.record.actions.slice(0, ply) });
      viewCache.set(ply, gameMod.view(st, d.viewer));
    }
    return viewCache.get(ply);
  }
  const totalPlies = () => (canReview() ? d.record.actions.length : Math.max(0, ...turns.keys()));

  function e0At(ply) {
    if (ply === 0) return d.options?.startEval?.e0 ?? d.options?.startEval?.redE ?? null;
    const ev = turns.get(ply)?.eval;
    return ev ? ev.e0 ?? ev.redE ?? null : null;
  }

  function seatStats(seat, whole = false) {
    const limit = whole ? Infinity : viewPly ?? Infinity;
    const ts = [...turns.values()].filter((t) => t.seat === seat && t.label && t.ply <= limit);
    const tags = { 失误: 0, 大漏着: 0 };
    let lat = 0, tok = 0, illegal = 0, last = null;
    const accs = [];
    for (const t of ts) {
      lat += t.latency_ms || 0;
      tok += (t.usage?.input || 0) + (t.usage?.output || 0);
      if (t.attempts?.length) illegal += t.attempts.length;
      const q = t.eval?.quality;
      const tag = q?.tag;
      if (tag in tags) tags[tag]++;
      if (q && typeof q.loss === 'number') accs.push(moveAccuracy(q.loss));
      if (!last || t.ply > last.ply) last = t;
    }
    return { n: ts.length, avg: ts.length ? lat / ts.length : 0, tok, illegal, tags, last, acc: gameAccuracy(accs) };
  }

  // ---------- 渲染 ----------
  const stat = (label, value, title = '') => h('div', { class: 'cs', title }, h('b', {}, value), h('small', {}, label));
  const bar = (v, cls) => h('span', { class: `gbar ${cls}` }, h('i', { style: { width: `${v === null ? 0 : Math.round(v * 100)}%` } }));

  // ---------- 对称座位版式 ----------
  /** 当前焦点：点过的座位，否则是正在行动的人，再否则是最近一步的人 */
  /** 正在演的那句发言（没有、已经演完、或画面已经翻到别的步时为 null） */
  function presentingNow() {
    const p = presenting;
    return p && p.ply === viewPly && performance.now() < p.until ? p : null;
  }
  /** 开始演一句发言：rate 是倍速（回放）；自己刚说的话不用再打一遍字 */
  function present(sp, rate = 1) {
    if (presenting?.timer) clearInterval(presenting.timer);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    const typeDur = reduce || (sp.seat === humanSeat && viewPly === null) ? 0 : typeMs(sp.text) / rate;
    const p = { seat: sp.seat, text: sp.text, ply: viewPly, t0, typeDur, until: t0 + speechPause(sp.text) / rate, timer: 0 };
    presenting = p;
    p.timer = setInterval(() => {
      if (presenting !== p) { clearInterval(p.timer); return; }
      const now = performance.now();
      const line = focusEl.querySelector('.said-list .sp.typing');
      if (line) {
        const done = now - p.t0 >= p.typeDur;
        line.querySelector('.tx').textContent = typedPart(p, now);
        if (done) line.classList.remove('typing');
        const list = line.parentElement;
        if (list) list.scrollTop = list.scrollHeight;
      }
      if (now >= p.until) {
        clearInterval(p.timer);
        presenting = null;
        // 演完了：焦点、座位高亮交还给正在行动的人
        if (p.ply === viewPly) { seats.forEach(renderSeat); renderFocus(); if (viewPly === null) renderStatus(); }
      }
    }, 70);
  }
  /** 此刻该露出来的那一截 */
  function typedPart(p, now = performance.now()) {
    if (!p.typeDur || now - p.t0 >= p.typeDur) return p.text;
    const chars = [...p.text];
    return chars.slice(0, Math.max(1, Math.ceil((chars.length * (now - p.t0)) / p.typeDur))).join('');
  }
  cleanups.push(() => { if (presenting?.timer) clearInterval(presenting.timer); presenting = null; });

  function focusOf() {
    if (focusSeat) return focusSeat;
    const pres = presentingNow();
    if (pres) return pres.seat;
    if (viewPly === null && d.status === 'running') {
      // 跟随行动者：正在发言的人；否则最新开始想的人；否则轮到的真人、还没轮上的待行动者
      const live = [...partials.keys()];
      const v = d.view || {};
      if (v.speaker && seats.includes(v.speaker) && (!live.length || live.includes(v.speaker) || waitingHuman === v.speaker)) return v.speaker;
      if (live.length) return live.at(-1);
      if (waitingHuman) return waitingHuman;
      const p = (v.pending || []).find((s) => seats.includes(s));
      if (p) return p;
    }
    const limit = viewPly ?? Infinity;
    const last = [...turns.values()].filter((t) => t.seat && t.label && t.ply <= limit).sort((a, b) => b.ply - a.ply)[0];
    return last?.seat || seats[0];
  }

  function renderSeat(seat) {
    const c = seatChar(seat);
    const info = duoInfo.seats?.[seat] || {};
    const st = String(info.state || '');
    const live = d.status === 'running' && viewPly === null;
    const thinking = live && (partials.has(seat) || waitingHuman === seat);
    const actors = live ? new Set([...partials.keys(), waitingHuman].filter(Boolean)) : new Set();
    // 单人行动（发言、夜里单人用技能）：整块亮起 + 声波；多人同时行动（投票）：每个在想的人都套一圈细金线，不一起闪
    // 刚说完的那位还在「说」（逐字打字、打完停一会儿）：亮的是他，不是下一位
    const pres = presentingNow();
    const speaking = pres ? pres.seat === seat : st.includes('speaking') || (thinking && actors.size <= 1);
    const acting = !speaking && thinking && actors.size > 1;
    // 选目标：只有合法目标能点（.pickable），其余压暗；先选中（.picked）再点「确认」
    const picking = Object.values(duoInfo.seats || {}).some((x) => x?.pick);
    const picked = !!info.pick && pickSel === seat;
    const cls = ['seat', rightSeats.includes(seat) ? 'mir' : '', st.replace('speaking', ''), speaking ? 'speaking' : '', acting ? 'acting' : '', focusOf() === seat ? 'focused' : '',
      info.pick ? 'pickable' : picking ? 'unpick' : '', picked ? 'picked' : ''].filter(Boolean).join(' ');
    const pickText = info.pickLabel || info.pickTitle || '选这个人';
    const confirm = async (e) => {
      e?.stopPropagation();
      // 毒药不可撤回，再确认一次
      if (String(info.pick).startsWith('poison:') && !(await confirmDialog({ title: info.pickTitle || '用毒药', body: '毒药只有一瓶，用了不能撤回。', okText: '用毒药', danger: true }))) return;
      pickSel = null;
      doAction(info.pick);
    };
    const el = h('div', {
      class: cls, role: 'button', tabindex: 0, 'aria-pressed': info.pick ? String(picked) : null,
      // 读屏一句话读完这张卡：「1号 初级 猎人 1票」
      'aria-label': [`${seats.indexOf(seat) + 1}号`, seatLabel(seat), info.role?.text, info.word && !info.word.back ? `词 ${info.word.text}` : null, info.votes ? `${info.votes}票` : null,
        st.includes('dead') ? '已出局' : null, speaking ? '正在发言' : null, info.pick ? (picked ? `已选中，再按确认：${pickText}` : `可选：${pickText}`) : null].filter(Boolean).join(' '),
      title: info.pick ? (picked ? `再点「确认」：${pickText}` : `${info.pickTitle || pickText}（先选中，再点确认）`) : `看 ${seats.indexOf(seat) + 1} 号的发言和想法`,
      onclick: () => {
        if (info.pick) {
          pickSel = picked ? null : seat;
          seats.forEach(renderSeat);
          if (pickSel) seatEls[seat].querySelector('.pick-ok')?.focus({ preventScroll: true });
          return;
        }
        focusSeat = focusSeat === seat ? null : seat;
        seats.forEach(renderSeat);
        renderFocus();
      },
      onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); e.currentTarget.click(); } },
    },
    info.pick ? h('span', { class: 'pick-bar' }, h('span', { class: 'pick-tag' }, pickText),
      picked ? h('button', { type: 'button', class: 'btn sm primary pick-ok', onclick: guard(confirm) }, '确认') : null) : null,
    h('span', { class: 'no' }, seats.indexOf(seat) + 1),
    coin(c, '', st.includes('dead') ? h('span', { class: 'dead-mark' }, '亡') : null),
    // 发言不再铺在座位卡上，点座位在中间焦点区看；这里只标说过几句
    h('div', { class: 'info' }, h('b', { class: 'nm', title: c?.name || null }, seatLabel(seat)), h('div', { class: 'md' }, modelLine(c)),
      info.said?.length ? h('div', { class: 'cnt' }, `发言 ${info.said.length}`) : null),
    h('div', { class: 'side' },
      info.role ? h('span', { class: 'role', style: { '--rc': info.role.color || 'var(--jade)' } }, info.role.text) : null,
      info.word ? h('span', { class: `word${info.word.back ? ' back' : ''}${info.word.spy ? ' spy' : ''}` }, info.word.back ? '' : info.word.text) : null,
      info.votes ? h('span', { class: 'votes' }, `${info.votes} 票`) : null,
      speaking && !st.includes('dead') ? h('span', { class: 'wave' }, h('i'), h('i'), h('i'), h('i')) : null));
    seatEls[seat].replaceWith(el);
    seatEls[seat] = el;
  }

  // 天黑、天亮、换阶段：场景条不硬切——昼夜切换时整条先压暗再亮起，标题从下面浮上来
  let lastScene = null;
  function renderScene() {
    const sc = duoInfo.scene;
    const kind = sc?.kind || 'day';
    const key = `${kind}|${sc?.title || ''}|${sc?.sub || ''}`;
    const prev = lastScene;
    lastScene = { kind, key };
    const fx = !prev || prev.key === key ? '' : prev.kind !== kind ? ' flip' : sc?.title !== sceneEl.querySelector('.t')?.textContent ? ' retitle' : ' resub';
    sceneEl.className = `scene ${kind}${fx}`;
    // 终局：漆面金边的匾，右侧盖一枚朱印「胜」（没有胜方时「和」）；印只在刚结束时盖下来一次
    const seal = kind === 'over' ? h('span', { class: `seal scene-seal${prev && prev.kind !== 'over' ? ' fresh' : ''}`, 'aria-hidden': 'true' }, /胜/.test(sc?.title || '') ? '胜' : '和') : null;
    sceneEl.replaceChildren(sc ? h('div', {}, h('b', { class: 't' }, sc.title), sc.sub ? h('span', { class: 's' }, sc.sub) : null) : null, seal);
  }

  // 「此刻 正在想」前面的三个跳点：焦点区流式输出时每 160ms 整块重画，动画起点按本机时钟对齐，重画后接着跳、不会每次从头来
  const spDots = () => h('span', { class: 'sp-dots', 'aria-hidden': 'true', style: { '--t0': `-${Date.now() % 1200}ms` } }, h('i'), h('i'), h('i'));
  /** 焦点区：大头像 +「说的」（公开发言、投票）+「想的」（AI 的推理，上帝视角或对局结束后才有） */
  let lastFocus = null;
  function renderFocus() {
    const seat = focusOf();
    const c = seatChar(seat);
    const info = duoInfo.seats?.[seat] || {};
    const limit = viewPly ?? Infinity;
    const live = viewPly === null && d.status === 'running' ? partials.get(seat) : null;
    const t = live || [...turns.values()].filter((x) => x.seat === seat && x.ply <= limit).sort((a, b) => b.ply - a.ply)[0];
    const hidden = (d.options?.hideThoughts || d.viewer === '*') && d.status === 'running' && (c?.kind === 'model' || c?.kind === 'agent');
    const a = t && !live ? parseAnalysis(t.analysis) : null;
    const thoughtText = hidden ? '对局结束后公开'
      : live ? (live.text || live.reasoning || '思考中…')
        : a ? LINE_KEYS.filter((k) => a[k] && k !== '发言' && k !== '投票').map((k) => `${k}：${a[k]}`).join('\n') || t?.analysis || ''
          : t?.analysis || t?.reasoning || '';
    // 「说的」：这个人全部的公开发言（按轮次），最后一步若不是发言（投票、用药）单列一行
    const said = info.said || [];
    const isSpeech = (label) => said.some((x) => label.includes(x.text) || x.text.includes(label));
    const recent = !live && t?.label && !isSpeech(t.label) ? t.label : null;
    // 轮到这个人发言、但还没开始想（两步之间服务端停顿的那一小段）：也算「此刻」，不显示成一张空纸
    const liveNow = viewPly === null && d.status === 'running';
    const upNext = liveNow && !live && !paused && d.view?.speaker === seat && waitingHuman !== seat;
    // 最后一步不是发言（投票、夜里的行动）：整局最新的一步才叫「刚才」，更早的按内容标「投票」「行动」，免得白天还挂着一行「刚才 刀 6 号」
    const lastPly = Math.max(0, ...[...turns.values()].filter((x) => x.label && x.ply <= limit).map((x) => x.ply));
    const recentTag = recent ? (t.ply === lastPly && !upNext ? '刚才' : /^投|弃票|弃权/.test(recent) ? '投票' : '行动') : '';
    // 这个人刚说的一句正在逐字打出来：最后一行跟着打字（presenting 的定时器只改这一行的字，不整块重画）
    const pres = presentingNow();
    const typingIdx = pres && pres.seat === seat && said.at(-1)?.text === pres.text ? said.length - 1 : -1;
    const lines = said.map((x, i) => i === typingIdx
      ? h('div', { class: `sp last${performance.now() - pres.t0 < pres.typeDur ? ' typing' : ''}` }, h('span', { class: 'tg' }, x.tag), h('span', { class: 'tx' }, typedPart(pres)))
      : h('div', { class: `sp${i === said.length - 1 && !recent && !live && !upNext ? ' last' : ''}` }, h('span', { class: 'tg' }, x.tag), h('span', { class: 'tx' }, x.text)));
    if (recent) lines.push(h('div', { class: `sp act${upNext ? '' : ' last'}` }, h('span', { class: 'tg' }, recentTag), h('span', { class: 'tx' }, recent)));
    if (live) lines.push(h('div', { class: 'sp live' }, h('span', { class: 'tg' }, '此刻'), h('span', { class: 'tx' }, spDots(), '正在想')));
    else if (upNext) lines.push(h('div', { class: 'sp live' }, h('span', { class: 'tg' }, '此刻'), h('span', { class: 'tx' }, spDots(), '准备发言')));
    else if (liveNow && waitingHuman === seat && seat === humanSeat) lines.push(h('div', { class: 'sp live' }, h('span', { class: 'tg' }, '此刻'), h('span', { class: 'tx' }, '轮到你')));
    const saidBox = h('div', { class: 'said-list' }, ...(lines.length ? lines : [h('div', { class: 'none' }, '还没有开口')]));
    // 前情：跟着当前行动者看时，这个人还在想（或正要开口），纸上先放别人刚说的一两句——
    // 上一位的发言在他说完的那一刻焦点就换走了，不放这一条，观众永远只看到「正在想」，看不到刚说了什么。点一下去看那个人
    const ctx = liveNow && !focusSeat && (live || upNext) && duoInfo.scene?.kind !== 'night' ? recentSpeeches(2).filter((x) => x.seat !== seat) : [];
    const ctxBox = ctx.length ? h('div', { class: 'said-ctx', role: 'group', 'aria-label': '前面的发言' },
      ...ctx.map((x) => h('button', { type: 'button', class: 'cx', title: `看 ${x.no} 号的全部发言`, onclick: () => { focusSeat = x.seat; seats.forEach(renderSeat); renderFocus(); } },
        h('b', {}, `${x.no}号 ${x.name}`), h('span', {}, x.text)))) : null;
    // 没有想法可看（内置 AI 不写想法，或真人局里 AI 的想法要等终局）：「说的」占满整行
    // 有真人在局时 AI 的想法要等终局：不再摆一个空的「想的 · 对局结束后公开」框（头像行已有一枚说明）
    // 会写想法的选手（模型、自带 Agent）在上帝视角下一直是「说的 | 想的」两栏：换人、两步之间不会一会儿一栏一会儿两栏地跳
    const writes = c?.kind === 'model' || c?.kind === 'agent';
    const solo = hidden || (!live && !thoughtText && !(writes && liveNow));
    // 换了人：焦点区内容依次浮上来，不是一下子替换
    const swapped = lastFocus !== null && lastFocus !== seat;
    lastFocus = seat;
    focusEl.className = `focus${solo ? ' solo' : ''}${swapped ? ' swap' : ''}`;
    focusEl.replaceChildren(
      // 结构：头像行（横排）+「说的」+「想的」；宽屏时说的、想的左右并排
      h('div', { class: 'who' }, coin(c, 'lg'),
        h('div', { class: 'id' }, h('b', { class: 'gold-text' }, `${seats.indexOf(seat) + 1} 号 · ${c?.name || '？'}`), h('small', {}, modelLine(c))),
        info.role ? h('span', { class: 'role', style: { '--rc': info.role.color || 'var(--jade)' } }, info.role.text) : null,
        hidden ? h('span', { class: 'chip' }, '想法对局结束后公开') : null,
        h('span', { class: 'hint' }, focusSeat ? '' : '点座位换人看'),
        focusSeat ? h('button', { class: 'btn sm ghost', onclick: () => { focusSeat = null; seats.forEach(renderSeat); renderFocus(); } }, '跟随当前') : null),
      // 宣纸右下角淡淡的座号水印：大屏上宣纸撑高时留白有个落点（宣纸矮时不显示，见 app.css）
      h('div', { class: `paper said${saidTall ? ' tall' : ''}` }, h('span', { class: 'wm-no', 'aria-hidden': 'true' }, `${seats.indexOf(seat) + 1}号`), h('span', { class: 'lab' }, said.length ? `说的 · ${said.length} 句` : '说的'), ctxBox, saidBox),
      // 光标挂在文字（.tt）末尾，不挂在整个框上（框是竖排的弹性盒，光标会掉到框底）
      solo ? null : h('div', { class: 'well thought2' }, h('span', { class: 'lab' }, d.viewer ? '想的' : '想的 · 上帝视角'),
        h('div', { class: `tt${live ? ' typing' : ''}${!live && !thoughtText ? ' idle' : ''}` }, thoughtText || (live ? '思考中…' : upNext ? '马上开始想…' : '这一步还没有想法'))));
    // 宣纸高不高（≥ 240 才露水印）、滚到最新一句：交给 ResizeObserver 在浏览器排完版之后做（新节点第一次被观察时就会回调），
    // 这里不读布局——在一串 DOM 改动中间读 scrollHeight 会逼浏览器多排一次版
    fadeTop(saidBox);
    if (saidRO) { saidRO.disconnect(); saidRO.observe(focusEl.querySelector('.said')); } else saidBox.scrollTop = saidBox.scrollHeight;
    fold?.schedule();
  }
  let saidTall = false;
  const saidRO = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => {
    for (const e of es) {
      saidTall = e.target.clientHeight >= 240;
      e.target.classList.toggle('tall', saidTall);
      const list = e.target.querySelector('.said-list');
      if (list) { list.scrollTop = list.scrollHeight; list.classList.toggle('scrolled', list.scrollTop > 2); }
    }
  }) : null;
  cleanups.push(() => saidRO?.disconnect());

  // ---------- 牌桌版式：聚光框、本手记录 ----------
  /** 聚光框看谁：本手记录里点过的那一步；否则正在想的人；否则轮到的真人；否则最近出手的人 */
  function spotFocus() {
    if (pinPly !== null && turns.get(pinPly)?.label) return { seat: turns.get(pinPly).seat, ply: pinPly, turn: turns.get(pinPly), pinned: true };
    if (viewPly === null && d.status === 'running') {
      const live = [...partials.values()][0];
      if (live) return { seat: live.seat, ply: live.ply ?? `h${live.seat}`, live };
      if (waitingHuman) return { seat: waitingHuman, ply: `h${waitingHuman}`, human: true };
    }
    const limit = viewPly ?? Infinity;
    const k = Math.max(0, ...[...turns.keys()].filter((p) => p <= limit && turns.get(p).label));
    if (k) return { seat: turns.get(k).seat, ply: k, turn: turns.get(k) };
    const view = viewPly === null ? d.view : viewAt(viewPly);
    return { seat: view?.toAct || seats[0], ply: 'idle', idle: true };
  }

  const seatNum = (seat) => String(seat).replace(/^\D+/, '') || String(seats.indexOf(seat) + 1);
  function renderSpot() {
    if (!hud) return;
    const view = viewPly === null ? d.view : viewAt(viewPly);
    const f = spotFocus();
    spotPly = f.ply;
    const seat = f.seat;
    const c = seatChar(seat);
    const isModel = c?.kind === 'model' || c?.kind === 'agent';
    const hidden = d.options?.hideThoughts && isModel && d.status === 'running';
    const t = f.live || f.turn || null;
    const mine = f.human && seat === humanSeat;
    const status = f.live ? '思考中' : f.human ? (mine ? '轮到你' : '思考中') : f.pinned ? `第 ${f.ply} 步` : f.idle ? (d.status === 'running' ? '等待开局' : '') : d.status === 'running' ? '刚出手' : '最后一手';
    const line = renderer.seatLine?.(view, seat);
    const head = [
      coin(c),
      h('div', { class: 'who' },
        h('b', {}, c?.name || seatName(seat)),
        h('span', {}, [seatName(seat), c?.kind === 'human' ? '真人' : c?.kind === 'agent' ? '自带 Agent' : c?.kind === 'model' ? c.model : modelLine(c || {})].filter(Boolean).join(' · ')),
        line ? h('span', { class: 'ln' }, line) : null),
    ];
    const tools = f.pinned ? h('button', { class: 'btn sm ghost', onclick: () => { pinPly = null; renderSpot(); renderHandLog(); } }, '跟随当前') : null;
    const body = [h('div', { class: 'spot-act' },
      h('span', { class: `st${f.live || f.human ? ' live' : ''}` }, status),
      f.turn?.label ? h('b', { class: `act${latin(f.turn.label)}` }, f.turn.label) :f.live || f.human ? h('span', { class: 'dots' }, h('i'), h('i'), h('i')) : null)];
    const scroll = h('div', { class: 'spot-scroll', 'data-stick': f.live ? 'bottom' : '' });
    // turnTip 可以是一句话，也可以是 (view) => 一句话（按当前局面给提示，例如斗地主该你叫地主还是出牌）
    let tip = null;
    try { tip = typeof renderer.turnTip === 'function' ? renderer.turnTip(view) : renderer.turnTip; } catch (err) { console.error(err); }
    if (mine) scroll.append(h('div', { class: 'spot-tip' }, tip || '轮到你了：在牌桌上出手。'));
    else if (hidden) scroll.append(h('div', { class: 'spot-tip' }, '有真人在局：模型的思考对局结束后公开，这里只显示出手。'));
    else if (c && !isModel && c.kind !== 'human') scroll.append(h('div', { class: 'spot-tip' }, f.live ? '计算中…' : `${modelLine(c)}没有文字思考。`));
    else if (t) {
      const a = !f.live ? parseAnalysis(t.analysis) : null;
      if (t.reasoning) scroll.append(h('details', { class: 'spot-reason', open: f.live && !t.text }, h('summary', {}, `原生推理 · ${t.reasoning.length} 字`), h('div', { class: 'reasoning' }, t.reasoning)));
      if (a) scroll.append(h('div', { class: 'lines' }, ...LINE_KEYS.filter((k) => a[k]).flatMap((k) => [h('b', {}, k), h('span', {}, a[k])])));
      else if (f.live ? t.text : t.analysis) scroll.append(h('div', { class: `stream${f.live ? ' typing' : ''}` }, f.live ? t.text : t.analysis));
      else if (f.live) scroll.append(h('div', { class: 'spot-tip' }, '思考中…'));
      for (const at of t.attempts || []) scroll.append(h('div', { class: 'illegal' }, `✗ ${at.attempted || '无效'}：${at.error}`));
    } else if (f.idle) scroll.append(h('div', { class: 'spot-tip' }, d.status === 'running' ? '马上开局。' : '没有记录'));
    body.push(scroll);
    const meta = f.turn ? [f.turn.latency_ms ? fmtMs(f.turn.latency_ms) : null, f.turn.usage && (f.turn.usage.input || f.turn.usage.output) ? `${fmtTokens(f.turn.usage.input + f.turn.usage.output)} tokens` : null].filter(Boolean).join(' · ') : '';
    if (meta) body.push(h('div', { class: 'spot-meta' }, meta));
    const out = view?.out || [];
    spot.show({
      key: `${seat}|${f.ply}`, index: seats.indexOf(seat), head, body, tools,
      chambers: seats.map((s) => ({ label: seatNum(s), color: color(s), out: out.includes?.(s) })),
    });
    spot.el.classList.toggle('mine', !!mine);
    spot.el.classList.toggle('thinking', !!(f.live || f.human));
  }

  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const cardChip = (cd) => h('span', { class: `cc${cd[1] === 'h' || cd[1] === 'd' ? ' r' : ''}` }, `${cd[0] === 'T' ? '10' : cd[0]}${SUIT[cd[1]] || ''}`);
  // 本手记录：表头和列表只建一次；每步只在末尾追加新的行（按行的 key 比对），前面的行原样留着，
  // 不再整块重建、也不在重建后马上读 scrollHeight（那会逼浏览器把刚改完的整页排一次版）
  const hlHead = [h('b'), h('span')];
  const hlList = h('div', { class: 'hl-list' });
  if (hud) { handBox.append(h('header', {}, ...hlHead), hlList); fadeTop(hlList); }
  let hlKeys = [];
  let hlScroll = 0;
  function renderHandLog() {
    if (!hud) return;
    const view = viewPly === null ? d.view : viewAt(viewPly);
    const L = renderer.handLog?.(view);
    if (!L) return;
    const cur = viewPly ?? totalPlies();
    const base = cur - L.count; // 本手第 k 条行动是第 base + k 步
    let k = 0;
    const rows = []; // [key, 建这一行(fresh 类名)]
    const who = (seat) => [h('span', { class: 'no', style: { '--c': color(seat) } }, seatNum(seat)), h('span', { class: 'nm' }, seatChar(seat)?.name || seatName(seat))];
    if (L.last) rows.push([`last|${L.last}`, () => h('div', { class: 'hl-last' }, L.last)]);
    for (const g of L.groups) {
      rows.push([`s|${view.handNo}|${g.street}|${g.board.join('')}`, (f) => h('div', { class: `hl-street${f}` }, h('span', {}, g.name), ...g.board.map(cardChip))]);
      for (const it of g.items) {
        if (it.blind) { rows.push([`b|${view.handNo}|${it.seat}|${it.text}`, (f) => h('div', { class: `hl-item blind${f}` }, ...who(it.seat), h('span', { class: 'tx' }, it.text))]); continue; }
        const ply = base + (++k);
        rows.push([`p|${view.handNo}|${ply}|${it.seat}|${it.text}`, (f) => h('button', { class: `hl-item${f}`, type: 'button', 'data-ply': ply, title: '在聚光框里看这一步的思考', onclick: () => { pinPly = pinPly === ply ? null : ply; renderSpot(); renderHandLog(); } },
          ...who(it.seat), h('span', { class: 'tx' }, it.text))]);
      }
    }
    if (!L.count) { const t = d.status === 'running' && viewPly === null ? '这一手还没有人行动' : '这一手没有行动'; rows.push([`e|${t}`, () => h('div', { class: 'hl-empty' }, t)]); }
    if (L.result) rows.push([`r|${view.handNo}|${L.result}`, (f) => h('div', { class: `hl-res${f}` }, L.result)]);
    setText(hlHead[0], L.label || '本手记录');
    setText(hlHead[1], `${L.title} · ${L.sub}`);
    const keys = rows.map((r) => r[0]);
    // 新出现的行滑进来；已经在的行不重播动画
    const prefix = hlList.childElementCount === hlKeys.length && keys.length >= hlKeys.length && hlKeys.every((x, i) => x === keys[i]);
    let changed = false;
    if (prefix) {
      if (keys.length > hlKeys.length) { hlList.append(...rows.slice(hlKeys.length).map(([, make]) => make(hlKeys.length ? ' fresh' : ''))); changed = true; }
    } else {
      const seen = new Set(hlKeys);
      hlList.replaceChildren(...rows.map(([key, make]) => make(seen.size && !seen.has(key) ? ' fresh' : '')));
      changed = true;
    }
    hlKeys = keys;
    for (const b of hlList.querySelectorAll('button.hl-item')) b.classList.toggle('on', Number(b.dataset.ply) === spotPly);
    // 有新行才滚到底（点某一行看思考时不跳走），放到下一帧开头做
    if (changed && !hlScroll) hlScroll = requestAnimationFrame(() => { hlScroll = 0; hlList.scrollTop = hlList.scrollHeight; });
  }

  function renderCamp(seat) {
    if (duo) { renderSeat(seat); return; }
    if (hud) return;
    const c = seatChar(seat);
    const s = seatStats(seat);
    const thinking = d.status === 'running' && (partials.has(seat) || waitingHuman === seat);
    const atEnd = viewPly === null || viewPly >= totalPlies();
    const change = atEnd ? d.rating_changes?.[d.seats[seat]] : null;
    const ranks = d.result?.ranks;
    const won = atEnd && d.status === 'finished' && ranks && ranks[seat] === Math.min(...Object.values(ranks)) && !Object.values(ranks).every((r) => r === ranks[seat]);
    const lastQ = s.last?.eval?.quality;
    const cv = atEnd ? d.view : viewAt(viewPly); // 身份、出局都按当前回放到的那一步
    const role = cv?.roles?.[seat];
    // 轮到这一方就亮（不只是「正在想」）：两步之间服务端停顿的那一小段，光圈直接从上一方移到下一方，不会两边都暗着
    const toMove = d.status === 'running' && viewPly === null && !paused && pendingSeats().includes(seat);
    camps[seat].el.classList.toggle('active', thinking || toMove);
    camps[seat].el.classList.toggle('out', !!cv?.out?.includes?.(seat));
    camps[seat].head.replaceChildren(
      h('div', { class: 'camp-id' },
        h('div', { class: `camp-avatar${avatarFace(c).ch ? ' glyph' : ''}` }, avatarFace(c).emoji || h('i', { class: 'g' }, avatarFace(c).ch), thinking ? h('i', { class: 'pulse' }) : null),
        h('div', { class: 'camp-name' },
          h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
            h('span', { class: 'side-tag', style: { background: color(seat) } }, seatName(seat)),
            h('b', {}, c?.name || '？'),
            role ? h('span', { class: 'chip' }, role) : null,
            won ? h('span', { class: 'chip good' }, '胜') : null),
          h('div', { class: 'sub' }, c?.kind === 'model' ? `${c.providerName || c.provider} · ${c.model}` : c?.kind === 'agent' ? '自带 Agent' : c?.kind === 'human' ? '玩家' : c?.name),
          two ? h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } },
            c?.tier ? tierBadge(c.tier) : null,
            change ? h('span', { class: change.delta >= 0 ? 'delta-up' : 'delta-down' }, `${change.before} → ${change.after}（${change.delta >= 0 ? '+' : ''}${change.delta}）`) : null) : null)),
      two ? (() => {
        // 真人没有 tokens、无效着法这两项：不摆两个永远是 0 的格子
        const isHuman = c?.kind === 'human';
        const cells = [
          s.acc !== null && !evalHidden() ? stat('准确率', `${s.acc}%`, '按 lichess 的算法：每步按胜率损失折算 0–100 分，整局取算术平均和调和平均的平均（一次大漏着会明显拉低）') : stat('步数', s.n),
          stat('平均用时', s.n ? fmtMs(Math.round(s.avg)) : '—'),
          isHuman ? null : stat('tokens', fmtTokens(s.tok)),
          // 没有引擎评估的游戏（囚徒困境）不摆「失误 0」
          evalHidden() || !winbarOn ? null : stat('失误', s.tags.失误 + s.tags.大漏着, s.tags.大漏着 ? `其中大漏着 ${s.tags.大漏着}` : ''),
          isHuman ? null : stat('无效', s.illegal)].filter(Boolean);
        return h('div', { class: `camp-stats n${cells.length}` }, ...cells);
      })() : h('div', { class: 'camp-mini' }, c?.kind === 'human' ? `${s.n} 步 · ${s.n ? fmtMs(Math.round(s.avg)) : '—'}${change ? ` · ${change.delta >= 0 ? '+' : ''}${change.delta}` : ''}` : `${s.n} 步 · ${s.n ? fmtMs(Math.round(s.avg)) : '—'} · ${fmtTokens(s.tok)} tokens${s.illegal ? ` · 无效 ${s.illegal}` : ''}${change ? ` · ${change.delta >= 0 ? '+' : ''}${change.delta}` : ''}`),
      two && !evalHidden() && s.last?.self_winrate !== null && s.last?.self_winrate !== undefined
        ? h('div', { class: 'camp-gauge', title: winbarOn ? '最近一步：模型自评胜率 / 引擎评估（走棋前）' : '最近一步：模型自评胜率' },
          h('span', {}, '自评'), bar(s.last.self_winrate / 100, 'self'), h('b', {}, `${s.last.self_winrate}%`),
          // 没有引擎评估的游戏只留自评一行，不摆一条永远是「—」的引擎条
          ...(winbarOn ? [h('span', {}, '引擎'), bar(lastQ ? lastQ.before : null, 'engine'), h('b', {}, lastQ ? pct(lastQ.before) : '—')] : []))
        : null,
      d.challenge?.by === d.seats[seat] && d.challenge.text ? h('div', { class: 'camp-quote' }, `「${d.challenge.text}」`) : null,
    );
  }

  let lastStatus = null;
  // 狼人杀、谁是卧底终局：场景匾上已经写着完整的结果和原因，转播条只留「狼人胜」这半句，不把同一长串写两遍
  const shortRes = (t) => (duo ? String(t || '').replace(/（[\s\S]*$/, '') : t);
  /** 局面里轮到谁：多人局看 view.pending；两人轮流走的棋，上一步不是谁走的就轮到谁（开局是第一个座位） */
  function pendingSeats() {
    const v = d.view || {};
    if (Array.isArray(v.pending)) return v.pending;
    if (duo || hud || !two) return [];
    const last = [...turns.values()].filter((t) => t.seat && t.label).sort((a, b) => b.ply - a.ply)[0];
    return last ? seats.filter((s) => s !== last.seat) : [seats[0]];
  }
  /** 我本人坐在里面时，结果写成「你赢了 · …」「你输了 · …」 */
  function myResult() {
    const r = d.result;
    if (!humanSeat || !r || r.aborted || d.status === 'running') return '';
    const o = seatOutcome(r, humanSeat);
    return `${o === 'w' ? '你赢了' : o === 'l' ? '你输了' : '和局'} · ${resultText(d, d.seatNames)}`;
  }
  /** 进行中的状态字：谁在想、谁在发言、投票进度——不再只显示「…」 */
  function liveStatus() {
    if (paused) return '已暂停';
    if (waitingHuman) return '轮到你';
    const v = d.view || {};
    const thinking = [...partials.keys()];
    const nm = (s) => (duo ? `${seats.indexOf(s) + 1} 号` : humanSeat && two && s !== humanSeat ? '对手' : seatName(s));
    if (duo) {
      // 刚说完的那句还在逐字打出来、打完停一会儿：状态条跟着焦点区写他，不提前写下一位
      const pres = presentingNow();
      if (pres) return `${nm(pres.seat)}发言中`;
      const phase = String(v.phase || '');
      if (/vote/.test(phase)) {
        const total = (v.voters || []).length;
        return total ? `投票中 · 已投 ${total - (v.pending || []).length}/${total}` : '投票中';
      }
      if (v.speaker && seats.includes(v.speaker)) return `${nm(v.speaker)}${/speak|lastword/.test(phase) ? '发言中' : '行动中'}`;
      if (duoInfo.scene?.kind === 'night') return duoInfo.scene.sub ? `夜晚 · ${duoInfo.scene.sub.split(' · ').at(-1)}` : '夜晚 · 行动中';
      if (thinking.length === 1) return `${nm(thinking[0])}行动中`;
      if (thinking.length > 1) return `${thinking.length} 人行动中`;
      return duoInfo.scene?.sub || '进行中';
    }
    if (thinking.length > 1) return `${thinking.length} 人同时思考中`;
    if (thinking.length) return `${nm(thinking[0])}思考中`;
    // 牌桌（德扑、斗地主）两步之间的停顿：写明轮到谁、或者这一手正在结算，不只是「进行中」
    if (hud) {
      if (v.result && !v.over) return d.game === 'poker' && v.handNo ? `第 ${v.handNo} 手结算` : '结算中';
      // 这一手还没人行动：牌桌上还在演上一手收场、这一手发牌，先不报「轮到谁」
      let L = null;
      try { L = renderer.handLog?.(v); } catch { /* 画面模块自己会报错，这里不重复 */ }
      if (L && !L.count) return d.game === 'poker' && v.handNo ? `第 ${v.handNo} 手 · 发牌` : '发牌';
      const act = v.toAct || v.turn;
      if (act && seats.includes(act)) return `轮到 ${seatName(act)}`;
    }
    const pend = pendingSeats().filter((s) => seats.includes(s));
    if (pend.length === 1) return humanSeat && pend[0] !== humanSeat && two ? '对手思考中' : `轮到${nm(pend[0])}`;
    if (pend.length > 1) return `${pend.length} 人同时行动`;
    return '进行中';
  }
  // 转播条：结构只建一次，之后只改文字、状态和显隐——按钮还是原来那个（键盘焦点不丢），
  // 回放中速度下拉框、进度条也不会被换掉（原来每个事件都整条重建，一步新建几百个节点）
  const copyLink = async () => {
    const url = `${location.origin}/#/match/${id}${viewPly !== null && canReview() ? `?turn=${viewPly}` : ''}`;
    try { await navigator.clipboard.writeText(url); toast('链接已复制'); } catch { toast(url); }
  };
  const record = async () => { await post(`/matches/${id}/record`, { speed }); toast(`已开始录制（${speed}×），完成后在「对局记录」里下载`); };
  const toggleSound = () => { setSound(!soundOn()); renderStatus(); };
  // 图标键：统一用 SVG 图标（icons.js），提示里写快捷键；读屏用 aria-label
  const ibtn = (ic, title, fn, cls = '') => { const b = h('button', { type: 'button', class: `icon-btn${cls ? ` ${cls}` : ''}`, title, 'aria-label': title, onclick: guard(fn) }, icon(ic)); b.dataset.ic = ic; return b; };
  const setIcon = (b, ic, title) => {
    if (b.dataset.ic !== ic) { b.dataset.ic = ic; b.replaceChildren(icon(ic)); }
    if (b.title !== title) { b.title = title; b.setAttribute('aria-label', title); }
  };
  const vis = (el, on) => { if (el && el.hidden === !!on) el.hidden = !on; };
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const sb = {};
  sb.plies = h('span', { class: 'muted small bar-plies', style: { whiteSpace: 'nowrap' } });
  sb.state = null;
  sb.info = h('div', { class: 'bar-info' }, h('span', { class: 'gname' }, d.gameName || ''), h('span', { class: 'chip' }, MODE_NAMES[d.mode]), sb.plies);
  // 回放键一组、对局键一组，中间一道竖线隔开；认输、中止写成字，不让人猜图标
  sb.play = ibtn('play', '从头回放（空格）', () => { const n = totalPlies(); return replaying ? stopReplay() : startReplay(viewPly !== null && viewPly < n ? viewPly : 0); });
  sb.speed = h('select', { class: 'speed', title: '回放速度', 'aria-label': '回放速度', onchange: (e) => { speed = Number(e.target.value); } },
    ...SPEEDS.map((s) => h('option', { value: s, selected: s === speed }, `${s}×`)));
  sb.prev = ibtn('prev', '上一步（←）', () => { stopReplay(); goto(Math.max(0, (viewPly ?? totalPlies()) - 1)); });
  sb.next = ibtn('next', '下一步（→）', () => { stopReplay(); goto(Math.min(totalPlies(), (viewPly ?? totalPlies()) + 1)); });
  sb.latest = ibtn('skip', '回到最新', () => { stopReplay(); goto(null); });
  sb.sep1 = h('span', { class: 'bar-sep', 'aria-hidden': 'true' });
  sb.pause = ibtn('pause', '暂停', () => post(`/matches/${id}/control`, { op: paused ? 'resume' : 'pause' }));
  // 不剧透：没有真人的狼人杀、谁是卧底、斗地主、德扑，观众可以只看公共信息（身份、底牌、夜间行动、思考先不看）
  sb.pov = h('button', { type: 'button', class: 'btn sm', onclick: guard(togglePov) }, '不剧透');
  sb.step = ibtn('skip', '单步', () => post(`/matches/${id}/control`, { op: 'step' }));
  sb.accept = h('button', { type: 'button', class: 'btn sm primary', onclick: guard(() => post(`/matches/${id}/control`, { op: 'accept_draw' })) }, '接受和棋');
  sb.offer = h('button', { type: 'button', class: 'btn sm', title: '走下一步时同时向对方提出和棋', onclick: () => { offerNext = !offerNext; renderStatus(); } }, '提和');
  sb.resign = h('button', { type: 'button', class: 'btn sm ghost danger', title: '认输：这盘直接判负', onclick: guard(async () => { if (await confirmDialog({ title: '认输', body: '确定认输？这盘会直接判负。', okText: '认输', danger: true })) await post(`/matches/${id}/control`, { op: 'resign' }); }) }, '认输');
  sb.abort = h('button', { type: 'button', class: 'btn sm ghost danger', title: '中止对局：不计胜负，已经下的部分保留', onclick: guard(async () => { if (await confirmDialog({ title: '中止对局', body: '中止这盘？不计胜负，已经下的部分保留。', okText: '中止', danger: true })) await post(`/matches/${id}/control`, { op: 'abort' }); }) }, '中止');
  sb.flip = stage.setFlipped ? ibtn('flip', '翻转（F）', () => { flipped = !flipped; stage.setFlipped(flipped); renderStage(false); }) : null;
  sb.report = h('button', { type: 'button', class: 'btn sm', onclick: showReport }, '战报');
  // 再来一局：同样的座位和设置（娱乐赛）；两人局还可以换边。开局的人、庄家、坐在里面的真人可用，座位上的蛐蛐都得是自己能用的
  const canRematch = () => d.status !== 'running' && (canControl || !!humanSeat) && seats.every((s) => chars.has(d.seats[s]));
  const rematch = async (swap) => {
    const ids = seats.map((s) => d.seats[s]);
    if (swap && two) ids.reverse();
    const setup = d.record?.setup && Object.keys(d.record.setup).length ? d.record.setup : undefined;
    const r = await post('/matches', { game: d.game, seats: Object.fromEntries(seats.map((s, i) => [s, ids[i]])), mode: 'casual',
      options: { showLegal: d.options?.showLegal !== false, delayMs: d.options?.delayMs ?? 600, ...(setup ? { setup } : {}) } });
    location.hash = `#/match/${r.id}`;
  };
  sb.again = h('button', { type: 'button', class: 'btn sm primary', title: '同样的座位和设置，马上再开一盘（娱乐赛）', onclick: guard(() => rematch(false)) }, '再来一局');
  sb.swap = h('button', { type: 'button', class: 'btn sm', title: '双方交换座位（先后手、红黑对调）再开一盘', onclick: guard(() => rematch(true)) }, '换边再来');
  sb.sep2 = h('span', { class: 'bar-sep', 'aria-hidden': 'true' });
  // 录像、音效、导出、链接：手机上（≤480）收进「⋯」菜单
  sb.record = ibtn('record', '录成视频（按当前回放速度）', record, 'bar-extra');
  sb.sound = ibtn('sound', '关掉音效', toggleSound, 'bar-extra');
  sb.mRecord = h('button', { type: 'button', role: 'menuitem', onclick: guard(record) }, icon('record'), '录成视频');
  sb.mSound = h('button', { type: 'button', role: 'menuitem', onclick: toggleSound });
  sb.more = h('details', { class: 'stage-more' },
    h('summary', { class: 'icon-btn', title: '更多', 'aria-label': '更多' }, icon('more')),
    h('div', { class: 'stage-more-menu', role: 'menu' },
      sb.mRecord, sb.mSound,
      h('a', { role: 'menuitem', href: `/api/matches/${id}/export` }, icon('download'), '导出记录'),
      h('button', { type: 'button', role: 'menuitem', onclick: guard(copyLink) }, icon('link'), '复制链接')));
  sb.more.addEventListener('toggle', () => {
    if (!sb.more.open) return;
    const close = (e) => { if (!sb.more.contains(e.target)) { sb.more.open = false; document.removeEventListener('pointerdown', close, true); } };
    document.addEventListener('pointerdown', close, true);
  });
  sb.ctrl = h('div', { class: 'bar-ctrl' },
    sb.play, sb.speed, sb.prev, sb.next, sb.latest, sb.sep1,
    sb.pause, sb.pov, sb.step, sb.accept, sb.offer, sb.resign, sb.abort, sb.flip, sb.report, sb.again, sb.swap, sb.sep2,
    sb.record, sb.sound,
    h('a', { class: 'icon-btn bar-extra', title: '导出记录', 'aria-label': '导出记录', href: `/api/matches/${id}/export` }, icon('download')),
    ibtn('link', '复制这一步的链接（打开就停在这一步）', copyLink, 'bar-extra'),
    sb.more);
  sb.scrub = h('input', { class: 'scrub', type: 'range', min: 0, 'aria-label': '回放进度', oninput: (e) => { stopReplay(); goto(Number(e.target.value)); } });
  statusBar.append(sb.info, sb.ctrl);

  function renderStatus() {
    const running = d.status === 'running';
    const n = totalPlies();
    const reviewing = viewPly !== null;
    // 复盘、回放时不显示「思考中」：看的是过去的局面
    const status = reviewing && viewPly < n ? (replaying ? '回放中' : '复盘中')
      : running ? liveStatus() : shortRes(myResult() || resultText(d, d.seatNames));
    const po = pendingOffer();
    const prevStatus = lastStatus;
    lastStatus = status;
    const canRecord = !running && canReview() && n;
    const rk = !!(canReview() && n);
    vis(sb.play, rk);
    setIcon(sb.play, replaying ? 'pause' : 'play', replaying ? '暂停回放（空格）' : '从头回放（空格）');
    vis(sb.speed, rk);
    if (sb.speed.value !== String(speed)) sb.speed.value = String(speed);
    vis(sb.prev, rk && reviewing);
    vis(sb.next, rk && reviewing);
    vis(sb.latest, rk && reviewing && running);
    const keys = [
      [sb.pause, running && !hasHuman && canControl],
      // hiddenLive：座位上有真人或自带 Agent，服务端已经只给公共视角，这个键按了也没有变化，不显示
      [sb.pov, running && !hasHuman && !d.hiddenLive && d.features?.hidden],
      [sb.step, running && paused && canControl],
      [sb.accept, running && waitingHuman && po && po.seat !== waitingHuman],
      [sb.offer, running && waitingHuman && d.features?.draw && !po],
      [sb.resign, running && waitingHuman],
      [sb.abort, running && d.mode === 'casual' && canControl],
      [sb.flip, true],
      [sb.report, !running && winbarOn && n],
      [sb.again, canRematch()],
      [sb.swap, canRematch() && two],
    ].filter(([el]) => el);
    for (const [el, on] of keys) vis(el, on);
    const anyMatch = keys.some(([, on]) => on);
    vis(sb.sep1, rk && anyMatch);
    vis(sb.sep2, rk || anyMatch);
    setIcon(sb.pause, paused ? 'play' : 'pause', paused ? '继续' : '暂停');
    const pov = d.viewer === '*';
    sb.pov.className = `btn sm${pov ? ' primary' : ''}`;
    sb.pov.title = pov ? '现在只看公共信息；点一下换回上帝视角' : '只看公共信息：身份、底牌、夜间行动和思考先不看，结束后再揭晓';
    setText(sb.pov, pov ? '不剧透 ✓' : '不剧透');
    sb.offer.className = `btn sm${offerNext ? ' primary' : ''}`;
    setText(sb.offer, offerNext ? '走棋时提和 ✓' : '提和');
    vis(sb.record, canRecord);
    vis(sb.mRecord, canRecord);
    const on = soundOn();
    setIcon(sb.sound, on ? 'sound' : 'mute', on ? '关掉音效' : '打开音效（走子、出牌、筹码、轮到你）');
    if (sb.mSound.dataset.on !== String(on)) { sb.mSound.dataset.on = String(on); sb.mSound.replaceChildren(icon(on ? 'sound' : 'mute'), on ? '关掉音效' : '打开音效'); }
    setText(sb.plies, reviewing ? `${replaying ? '回放' : '复盘'} ${viewPly}/${n}` : `已走 ${n} 步`);
    // 状态字：变了才换一个新节点（重播浮入动画），没变只改样式
    const stCls = `stage-state${running && !(reviewing && viewPly < n) ? '' : ' done'}`;
    if (!status) { sb.state?.remove(); sb.state = null; }
    else if (sb.state && sb.state.textContent === status) sb.state.classList.toggle('done', stCls.endsWith(' done'));
    else {
      const el = h('span', { class: `${stCls}${prevStatus !== null && prevStatus !== status ? ' swap' : ''}` }, status);
      if (sb.state) sb.state.replaceWith(el); else sb.info.append(el);
      sb.state = el;
    }
    if (winbarOn && !evalHidden()) { if (tug.parentNode !== statusBar) sb.ctrl.after(tug); } else tug.remove();
    if (reviewing && canReview() && n) {
      if (sb.scrub.max !== String(n)) sb.scrub.max = String(n);
      if (sb.scrub.value !== String(viewPly)) sb.scrub.value = String(viewPly);
      // 进度条自己画：走过的一段填金（--p），棋类的关键时刻在轨道上各立一道朱红小刻度（--ticks），拖到哪儿心里有数
      sb.scrub.style.setProperty('--p', `${(viewPly / n) * 100}%`);
      const ks = winbarOn && !evalHidden() ? keyMoments() : [];
      const tk = ks.map((p) => `linear-gradient(#e2523d, #e2523d) calc(6px + (100% - 12px) * ${(p / n).toFixed(4)} - 1px) 50% / 2px 9px no-repeat`).join(', ');
      if (sb.scrub.dataset.tk !== tk) { sb.scrub.dataset.tk = tk; if (tk) sb.scrub.style.setProperty('--ticks', tk); else sb.scrub.style.removeProperty('--ticks'); }
      if (sb.scrub.parentNode !== statusBar) statusBar.append(sb.scrub);
    } else sb.scrub.remove();
  }

  // ---------- 票型弧线（狼人杀、谁是卧底） ----------
  // 投票人座位 → 被投的人座位画一道弧（往场地中间拱），箭头指向被投的人；新的票一道一道画出来。
  // 投完后的票型只在刚揭晓时画（停不到 4 秒淡去：和出局公告差不多同时收场，不压着下一位的发言），打开页面时不补画旧的
  let voteRaf = 0;
  function drawVotes(view, relayout = false, deferred = false) {
    if (!renderer.voteLinks) return;
    const g = voteSvg.querySelector('g');
    if (!relayout && !deferred) {
      let v = null;
      try { v = view ? renderer.voteLinks(view) : null; } catch (err) { console.error(err); }
      const fresh = v && v.key !== voteState.key;
      if (fresh) {
        const first = voteState.key === null;
        voteState = { key: v.key, shown: v.live ? voteState.shown : new Set(), links: v.links, live: !!v.live, out: v.out || null, until: v.live ? Infinity : first ? 0 : Date.now() + 3900 };
        if (!v.live) setTimeout(() => drawVotes(null, true), 4000);
      } else if (!v) voteState = { key: null, shown: new Set(), until: 0, links: [] };
    }
    const show = viewPly === null && Date.now() < voteState.until;
    if (!show) { g.replaceChildren(); return; }
    // 量座位位置放到下一帧开头：重画座位卡之后马上读位置会逼浏览器多排一次版
    if (!relayout && !deferred) { cancelAnimationFrame(voteRaf); voteRaf = requestAnimationFrame(() => drawVotes(null, false, true)); return; }
    const box = voteSvg.parentElement?.getBoundingClientRect();
    if (!box?.width) { g.replaceChildren(); return; }
    voteSvg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const cx0 = box.width / 2, cy0 = box.height / 2;
    const center = (seat) => {
      const r = seatEls[seat]?.getBoundingClientRect();
      return r && r.width ? [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2, r] : null;
    };
    const kids = [];
    voteState.links.forEach((l, i) => {
      const a = center(l.from), b = center(l.to);
      if (!a || !b || l.from === l.to) return;
      // 从座位卡边上出发、到目标卡边上停：沿连线方向缩进半张卡
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const inset = (r) => Math.min(r.width, r.height) * 0.42;
      const x1 = a[0] + ux * inset(a[2]), y1 = a[1] + uy * inset(a[2]);
      const x2 = b[0] - ux * inset(b[2]), y2 = b[1] - uy * inset(b[2]);
      // 控制点：中点往场地中央方向拱出去，拱高 = 距离 × 0.3
      let nx = -uy, ny = ux;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      if ((cx0 - mx) * nx + (cy0 - my) * ny < 0) { nx = -nx; ny = -ny; }
      const k = Math.max(40, len * 0.3);
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${(mx + nx * k).toFixed(1)} ${(my + ny * k).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
      path.setAttribute('marker-end', 'url(#vote-head)');
      const id = `${l.from}>${l.to}`;
      const isNew = !relayout && !voteState.shown.has(id);
      // 揭晓时：投给出局者的票用朱红，其余的票淡金，主线一眼看清
      const hit = !voteState.live && voteState.out && l.to === voteState.out;
      path.setAttribute('class', `arc${voteState.live ? ' live' : hit ? ' hit' : ' miss'}${isNew ? ' draw' : ''}`);
      if (isNew) path.style.animationDelay = `${(voteState.live ? 0 : i) * 120}ms`;
      voteState.shown.add(id);
      kids.push(path);
    });
    g.replaceChildren(...kids);
    voteSvg.classList.toggle('fading', !voteState.live);
  }

  let lastAnnView = null;
  function showAnnounce(a) {
    const col = root.querySelector('.arena .stage');
    if (!col) return;
    col.querySelector('.announce')?.remove();
    const card = h('div', { class: `announce ${a.kind || ''}`, role: 'status' }, h('b', {}, a.title), a.sub ? h('span', {}, a.sub) : null);
    col.append(card);
    sfx('out');
    setTimeout(() => card.remove(), 2700);
  }
  // 手机上轮到自己（狼人杀、谁是卧底）：操作区钉在屏幕底部，第一次轮到时滚过去一次
  let turnSeen = null;
  /** 最近几句公开发言（按步数，最新的在最后）：轮到自己发言时钉在输入框上面，好接话 */
  function recentSpeeches(k = 3) {
    const out = [];
    for (const t of [...turns.values()].filter((x) => x.seat && x.label).sort((a, b) => b.ply - a.ply)) {
      const said = duoInfo.seats?.[t.seat]?.said || [];
      if (!said.some((x) => x.text && (x.text === t.label || t.label.includes(x.text) || x.text.includes(t.label)))) continue;
      out.push({ seat: t.seat, no: seats.indexOf(t.seat) + 1, name: seatLabel(t.seat), text: t.label });
      if (out.length >= k) break;
    }
    return out.reverse();
  }
  function syncMyTurn(movable) {
    if (!duo) return;
    const arenaEl = root.querySelector('.arena');
    const ctrl = stage.el.querySelector('.ww-ctrl, .uc-ctrl');
    const on = !!movable && !!ctrl && !ctrl.hidden;
    arenaEl?.classList.toggle('my-turn', on);
    // 轮到我发言（有输入框）：在操作区顶上放最近 2–3 句发言（手机上操作区钉在屏幕底部，看不到焦点区）
    const speaking = on && ctrl.querySelector('.ww-form:not([hidden]), .uc-form:not([hidden])');
    const old = ctrl?.querySelector(':scope > .recent-said');
    const list = speaking ? recentSpeeches(3) : [];
    if (list.length) {
      const box = h('div', { class: 'recent-said', role: 'group', 'aria-label': '最近的发言' },
        ...list.map((x) => h('div', { class: 'rs' }, h('b', {}, `${x.no}号`), h('span', { class: 'rs-nm' }, x.name), h('span', { class: 'rs-tx' }, x.text))));
      if (old) old.replaceWith(box); else ctrl.prepend(box);
    } else old?.remove();
    if (!on) { arenaEl?.style.removeProperty('--ctrl-h'); return; }
    requestAnimationFrame(() => {
      if (!ctrl.isConnected) return;
      arenaEl.style.setProperty('--ctrl-h', `${Math.ceil(ctrl.getBoundingClientRect().height)}px`);
      const key = `${totalPlies()}|${movable}`;
      if (turnSeen === key || !matchMedia('(max-width: 720px)').matches) return;
      turnSeen = key;
      // 要点座位选目标时把座位格滚进来；要打字时操作区已经钉在底部，滚到焦点区让人看到上下文
      const target = arenaEl.querySelector('.seat.pickable') || arenaEl.querySelector('.scene');
      target?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }

  let speedRaf = 0;
  function renderStage(animate = true) {
    const latest = viewPly === null;
    const ply = latest ? totalPlies() : viewPly;
    const view = latest ? d.view : viewAt(ply);
    const arrows = [];
    if (!latest && d.status !== 'running' && ply < totalPlies()) {
      const best = ply === 0 ? d.options?.startEval?.best : turns.get(ply)?.eval?.raw?.best;
      if (best) arrows.push({ iccs: best, kind: 'best' });
    }
    const movable = latest && d.status === 'running' && waitingHuman && !paused ? waitingHuman : null;
    // live：正在看实时局面（不是复盘、回放）；牌桌画面复盘时据此不显示「轮到谁」
    stage.render(view, { movable, actions: movable ? d.humanActions : null, arrows, animate, replay: !!replaying, live: latest && d.status === 'running', viewer: d.viewer, players: playerInfo, clock: latest && d.status === 'running' ? Object.fromEntries(clock) : {} });
    // 棋类快速回放：走子动画跟着倍速加快，不会一步还没走完下一步就来了（牌桌游戏的动画和停顿是对齐好的，不动）
    // 放到下一帧开头去找动画：在这里当场找会逼浏览器把刚改了一半的页面先重算一遍样式（后面还要改选手卡、着法表、思考栏）
    if (!hud && !duo && replaying && speed > 1 && !speedRaf) speedRaf = requestAnimationFrame(() => { speedRaf = 0; if (replaying) for (const a of stage.el.getAnimations?.({ subtree: true }) || []) a.playbackRate = Math.min(8, speed); });
    // 场上公告（天亮死讯、有人出局）：画面往前走了一步才弹，复盘往回翻、第一次打开时不弹
    if (renderer.announce && animate && lastAnnView && view !== lastAnnView && (latest || replaying)) {
      let a = null;
      try { a = renderer.announce(lastAnnView, view); } catch (err) { console.error(err); }
      if (a) showAnnounce(a);
    }
    lastAnnView = view;
    if (duo) {
      try { duoInfo = renderer.duoView(view, { movable, actions: movable ? d.humanActions : null, viewer: d.viewer }) || duoInfo; } catch (err) { console.error(err); }
      if (pickSel && !duoInfo.seats?.[pickSel]?.pick) pickSel = null;
      renderScene();
      seats.forEach(renderSeat);
      syncMyTurn(movable);
      fold?.update();
      drawVotes(view);
    }
    const arenaEl = root.querySelector('.arena');
    // 真人在下：引擎评估一律不显示（胜率条、走势图），棋盘占满
    if (winbarOn) arenaEl?.classList.toggle('no-winbar', evalHidden());
    if (winbarOn) {
      let e = null;
      for (let p = ply; p >= 0 && e === null; p--) e = e0At(p);
      // 和棋的终局：胜率条回到正中，不显示「96% 黑方」这种和结果对不上的数
      const atEnd = d.status !== 'running' && ply >= totalPlies();
      const drawn = atEnd && d.result && !d.result.aborted && seatOutcome(d.result, seats[0]) === 'd';
      const v = drawn ? 0.5 : e ?? 0.5;
      tugFill.style.width = `${v * 100}%`;
      tugKnot.style.left = `${v * 100}%`;
      tugL.textContent = `${seatName(seats[0])} ${Math.round(v * 100)}%`;
      tugR.textContent = `${Math.round((1 - v) * 100)}% ${seatName(seats[1])}`;
      tug.title = drawn ? '和棋' : `${seatName(seats[0])}胜率 ${Math.round(v * 100)}%（${d.options?.startEval?.source === 'builtin' ? '内置粗略' : '引擎'}评估）`;
      tug.classList.toggle('drawn', !!drawn);
    }
  }

  /** 战报（棋类）：双方准确率、失误分布、用时和 token，外加胜率波动最大的三个关键时刻（点一下跳过去） */
  function showReport() {
    const n = totalPlies();
    const swings = [];
    let prev = e0At(0);
    for (let p = 1; p <= n; p++) {
      const e = e0At(p);
      if (e === null) continue;
      if (prev !== null) swings.push({ p, d: e - prev });
      prev = e;
    }
    const top = swings.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3).sort((a, b) => a.p - b.p);
    const row = (seat) => {
      const c = seatChar(seat);
      const st = seatStats(seat, true);
      const q = { 大漏着: 0, 失误: 0, 缓着: 0 };
      for (const t of turns.values()) if (t.seat === seat && t.eval?.quality?.tag in q) q[t.eval.quality.tag]++;
      return h('div', { class: 'rp-row' },
        coin(c),
        h('div', { class: 'rp-id' }, h('b', {}, c?.name || seatName(seat)), h('small', {}, seatName(seat))),
        h('div', { class: 'rp-acc' }, h('b', {}, st.acc ?? '—'), h('small', {}, '准确率')),
        h('div', { class: 'rp-q' }, h('span', { class: 'q-大漏着' }, `大漏着 ${q.大漏着}`), h('span', { class: 'q-失误' }, `失误 ${q.失误}`), h('span', { class: 'q-缓着' }, `缓着 ${q.缓着}`)),
        h('div', { class: 'rp-meta' }, `${st.n} 步 · 平均 ${st.n ? fmtMs(Math.round(st.avg)) : '—'} · ${fmtTokens(st.tok)} tokens`));
    };
    const dlg = dialog('战报', h('div', { class: 'report' },
      h('div', { class: 'rp-res' }, resultText(d, d.seatNames)),
      ...seats.map(row),
      top.length ? h('div', { class: 'rp-keys' }, h('h4', {}, '关键时刻'), ...top.map((k) => {
        const t = turns.get(k.p);
        return h('button', { class: 'rp-key', type: 'button', onclick: () => { dlg.close(); stopReplay(); goto(k.p); } },
          h('span', { class: 'no' }, `#${k.p}`), h('b', {}, `${seatName(t?.seat)} `, t?.label ? h('span', { class: latin(t.label).trim() || null }, t.label) : ''),
          h('span', { class: k.d > 0 ? 'up' : 'dn' }, `${seatName(seats[0])}胜率 ${k.d > 0 ? '+' : '−'}${Math.round(Math.abs(k.d) * 100)}%`),
          t?.eval?.quality ? qualityChip(t.eval.quality) : null);
      })) : null));
  }

  /**
   * 关键时刻：一步之内胜率变化 ≥ 20 个百分点的步；相隔 3 步以内的几次波动并成一个（留变化最大的那步），
   * 长对局里不会冒出上百个「关键时刻」
   */
  function keyMoments() {
    const n = totalPlies();
    const upto = noSpoil() ? (viewPly ?? n) : n;
    const raw = [];
    let prev = e0At(0);
    for (let p = 1; p <= upto; p++) {
      const e = e0At(p);
      if (e === null) continue;
      if (prev !== null && Math.abs(e - prev) >= 0.2) raw.push({ p, d: Math.abs(e - prev) });
      prev = e;
    }
    const out = [];
    for (const k of raw) {
      const last = out.at(-1);
      if (last && k.p - last.end <= 3) {
        last.end = k.p;
        if (k.d > last.d) { last.p = k.p; last.d = k.d; }
      } else out.push({ ...k, end: k.p });
    }
    // 最多 5 个：留波动最大的 5 次，再按步数排回去
    return out.sort((a, b) => b.d - a.d).slice(0, 5).map((k) => k.p).sort((a, b) => a - b);
  }

  function renderCurve() {
    if (!winbarOn) return;
    if (evalHidden()) { curve.replaceChildren(); return; }
    const n = totalPlies();
    const W = 600, H = 60;
    const pts = [];
    const upto = noSpoil() ? (viewPly ?? n) : n;
    for (let p = 0; p <= upto; p++) { const e = e0At(p); if (e !== null) pts.push([p, e]); }
    // 长对局（80 步以上）的胜率线、自评线先做一遍前后双向的指数平滑（EMA，不滞后），锯齿太密时看不出走势
    const ema = (arr) => {
      if (n <= 80 || arr.length <= 8) return;
      const a = 2 / (Math.max(2, Math.min(8, Math.round(n / 50))) + 1);
      for (let i = 1; i < arr.length; i++) arr[i][1] = a * arr[i][1] + (1 - a) * arr[i - 1][1];
      for (let i = arr.length - 2; i >= 0; i--) arr[i][1] = a * arr[i][1] + (1 - a) * arr[i + 1][1];
    };
    ema(pts);
    const smooth = new Map(pts);
    const self = [];
    for (let p = 1; p <= upto; p++) {
      const t = turns.get(p);
      if (t?.self_winrate === null || t?.self_winrate === undefined) continue;
      const s = t.self_winrate / 100;
      self.push([p, t.seat === seats[0] ? s : 1 - s]);
    }
    ema(self);
    const X = (p) => (n ? (p / n) * W : 0);
    const Y = (e) => H - e * H;
    const path = (arr) => arr.map(([p, e], i) => `${i ? 'L' : 'M'} ${X(p).toFixed(1)} ${Y(e).toFixed(1)}`).join(' ');
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('class', 'curve');
    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svgEl.setAttribute('preserveAspectRatio', 'none');
    const cur = viewPly ?? n;
    svgEl.innerHTML = `
      <rect class="bk" x="0" y="0" width="${W}" height="${H / 2}"/>
      <line class="mid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>
      ${pts.length > 1 ? `<path class="area-r" d="${path(pts)} L ${X(pts[pts.length - 1][0])} ${H} L ${X(pts[0][0])} ${H} Z"/><path class="line" d="${path(pts)}"/>` : ''}
      ${self.length > 1 ? `<path class="self" d="${path(self)}"/>` : ''}
      ${n ? `<line class="cursor" x1="${X(cur)}" y1="0" x2="${X(cur)}" y2="${H}"/>` : ''}`;
    // 失误点（lichess 配色）：只标大漏着；80 步以内的短局再加上失误。太多点挤在一起就什么也看不清
    const QCOL = { 大漏着: '#db3031', 失误: '#e69d00' };
    const show = new Set(['大漏着', ...(n < 80 ? ['失误'] : [])]);
    // 曲线是拉伸的 SVG，圆点用 HTML 按百分比定位，不会被压扁；点一下跳到那一步
    const dots = [];
    let lastX = -Infinity;
    for (let p = 1; p <= upto; p++) {
      const q = turns.get(p)?.eval?.quality;
      const e = smooth.get(p) ?? null; // 点落在画出来的（平滑过的）线上
      if (!q || !show.has(q.tag) || e === null) continue;
      // 挨得太近（横向不到 1.2%）的点只画第一个，长对局里不糊成一片
      if (X(p) - lastX < W * 0.012 && p !== cur) continue;
      lastX = X(p);
      dots.push(h('i', { class: `qdot${q.tag === '大漏着' ? ' big' : ''}${p === cur ? ' on' : ''}`, style: { left: `${(X(p) / W) * 100}%`, top: `${(Y(e) / H) * 100}%`, background: QCOL[q.tag] },
        title: `第 ${p} 步 ${seatName(turns.get(p).seat)} ${turns.get(p).label || ''} · ${q.tag}（胜率 −${Math.round(q.loss * 100)}%）`,
        onclick: (ev) => { ev.stopPropagation(); if (canReview()) { stopReplay(); goto(p); } } }));
    }
    svgEl.addEventListener('click', (e) => {
      if (!n || !canReview()) return;
      const r = svgEl.getBoundingClientRect();
      stopReplay();
      goto(Math.round(((e.clientX - r.left) / r.width) * n));
    });
    // 关键时刻导航：‹ 第几个 / 共几个 ›（J / K 键同样能跳）
    const keys = keyMoments();
    const at = viewPly ?? n;
    const prevK = [...keys].reverse().find((p) => p < at);
    const nextK = keys.find((p) => p > at);
    const idx = keys.indexOf(at);
    const jump = (p) => (e) => { e.stopPropagation(); if (p && canReview()) { stopReplay(); goto(p); } };
    const nav = keys.length && canReview() ? h('div', { class: 'curve-keys' },
      h('button', { type: 'button', disabled: !prevK, title: '上一个关键时刻（J）', 'aria-label': '上一个关键时刻', onclick: jump(prevK) }, '‹'),
      h('span', { title: '胜率一步之内变化 20% 以上的时刻' }, idx >= 0 ? `关键时刻 ${idx + 1}/${keys.length}` : `关键时刻 ${keys.length}`),
      h('button', { type: 'button', disabled: !nextK, title: '下一个关键时刻（K）', 'aria-label': '下一个关键时刻', onclick: jump(nextK) }, '›')) : h('span', { class: 'curve-title' }, '走势');
    // 图例单独一行放在曲线上面，不压在线上
    curve.replaceChildren(
      h('div', { class: 'curve-head' }, nav, h('div', { class: 'curve-legend' }, h('span', { class: 'lg-engine' }, `${seatName(seats[0])}胜率`), h('span', { class: 'lg-self' }, '自评'))),
      h('div', { class: 'curve-plot' }, svgEl, ...dots));
  }

  function moveItems() {
    const list = renderer.moveList ? renderer.moveList(d.view) : null;
    if (list && list.length) return list;
    return [...turns.values()].filter((t) => t.label).sort((a, b) => a.ply - b.ply).map((t) => ({ seat: t.seat, label: t.label }));
  }

  let movesShown = null;
  // 长对局（几百步）每步重建整张着法表很慢：默认只画当前步附近的 MOVES_WIN 条，两头各给一个「显示全部」
  const MOVES_WIN = 60;
  let movesAll = false;
  let movesScroll = 0;
  function renderMoves() {
    if (hud) { renderHandLog(); return; }
    const all = moveItems();
    const items = noSpoil() && viewPly !== null ? all.slice(0, viewPly) : all;
    const cur = viewPly ?? items.length;
    const els = [];
    const cell = (j) => {
      const it = items[j];
      if (!it) return null;
      const q = evalHidden() ? null : turns.get(j + 1)?.eval?.quality;
      // 双方不再靠字色区分（浅色主题下白方的灰字对比度太低）：字一律用正文色，前面一颗阵营色小棋子
      const on = cur === j + 1;
      return h('span', { class: `mv${on ? ' on' : ''}`, role: 'option', tabindex: on ? 0 : -1, 'aria-selected': on ? 'true' : 'false', 'data-ply': j + 1,
        'aria-label': `第 ${j + 1} 步 ${seatName(it.seat)} ${it.label}${q ? ` · ${q.tag}` : ''}`,
        onclick: () => { if (canReview()) { stopReplay(); goto(j + 1); } }, title: q ? q.tag : seatName(it.seat) },
        two ? h('i', { class: 'side', style: { '--c': sideDot(it.seat) }, 'aria-hidden': 'true' }) : null,
        q ? h('i', { class: `q q-${q.tag}` }) : null, two ? '' : `${seatName(it.seat)} `, h('span', { class: `mv-l${latin(it.label)}` }, it.label));
    };
    let from = 0, to = items.length;
    if (!movesAll && items.length > MOVES_WIN + 20) {
      to = Math.min(items.length, Math.max(cur + 20, MOVES_WIN));
      from = Math.max(0, to - MOVES_WIN);
      if (two) from -= from % 2;
    }
    const more = (text) => h('button', { type: 'button', class: 'mv-more', onclick: () => { movesAll = true; renderMoves(); } }, text);
    if (from > 0) els.push(more(`前面还有 ${from} 条 · 显示全部`));
    if (two) for (let i = from; i < to; i += 2) els.push(h('span', { class: 'mvpair' }, h('em', {}, i / 2 + 1), cell(i), i + 1 < to ? cell(i + 1) : null));
    else for (let i = from; i < to; i++) els.push(h('span', { class: 'mvpair' }, h('em', {}, i + 1), cell(i)));
    if (to < items.length) els.push(more(`后面还有 ${items.length - to} 条 · 显示全部`));
    const hadFocus = moves.contains(document.activeElement) && document.activeElement.classList.contains('mv');
    moves.replaceChildren(...(els.length ? els : [h('span', { class: 'muted small' }, '还没有行动')]));
    // 键盘在着法表里走：重画之后焦点还落在当前那一步上
    if (hadFocus) moves.querySelector('.mv.on')?.focus({ preventScroll: true });
    // 新的一步弹出来
    if (viewPly === null && movesShown !== null && items.length > movesShown) {
      const cells = moves.querySelectorAll('.mv');
      for (let j = Math.max(movesShown, from); j < to; j++) cells[j - from]?.classList.add('fresh');
    }
    movesShown = items.length;
    logSum.textContent = `全部记录 · ${items.length} 条`;
    // 滚动位置放到下一帧开头再算（读 offsetTop 会逼浏览器排版，和这一帧的其他改动合在一起只排一次）
    // 多人局的记录收在没展开的 <details> 里：看不见就不滚（滚它要先排版）
    if (!movesScroll && !moves.closest('details:not([open])')) {
      movesScroll = requestAnimationFrame(() => {
        movesScroll = 0;
        if (viewPly === null) { moves.scrollTop = moves.scrollHeight; return; }
        const on = moves.querySelector('.mv.on');
        if (on) moves.scrollTop = on.offsetTop - moves.clientHeight / 2;
      });
    }
  }

  function drawChip(ply) {
    const made = offers().find((o) => o.ply === ply);
    if (made) {
      const [text, cls] = DRAW_TAG[made.status] || ['提和', ''];
      return h('span', { class: `chip ${cls}` }, text);
    }
    const answered = offers().find((o) => o.answerPly === ply);
    if (answered?.status === 'declined') return h('span', { class: 'chip' }, '拒绝和棋');
    return null;
  }

  function thoughtCard(t, isLive = false) {
    const c = chars.get(t.character_id ?? t.characterId) || seatChar(t.seat);
    const a = parseAnalysis(t.analysis ?? t.text);
    const q = evalHidden() ? null : t.eval?.quality;
    const body = [];
    if (isLive) {
      if (d.options?.hideThoughts && (c?.kind === 'model' || c?.kind === 'agent')) body.push(h('div', { class: 'stream muted' }, '思考中，对局结束后公开'));
      else {
        if (t.reasoning) body.push(h('details', { open: !t.text }, h('summary', {}, `原生推理 · ${t.reasoning.length} 字`), h('div', { class: 'reasoning' }, t.reasoning)));
        body.push(h('div', { class: 'stream typing' }, t.text || (c?.kind === 'model' || c?.kind === 'agent' ? '' : '思考中')));
      }
    } else if (a) {
      body.push(h('div', { class: 'lines' }, ...LINE_KEYS.filter((k) => a[k]).flatMap((k) => [h('b', {}, k), h('span', {}, a[k])])));
    } else if (t.analysis) {
      body.push(h('div', { class: 'stream' }, t.analysis));
    }
    if (!isLive && t.reasoning) body.push(h('details', {}, h('summary', {}, `原生推理 · ${t.reasoning.length} 字`), h('div', { class: 'reasoning' }, t.reasoning)));
    for (const at of t.attempts || []) body.push(h('div', { class: 'illegal' }, `✗ ${at.attempted || '无效'}：${at.error}`));
    const meta = [
      t.self_winrate !== null && t.self_winrate !== undefined ? `自评 ${t.self_winrate}%${q ? ` · 引擎 ${pct(q.before)}` : ''}` : null,
      t.latency_ms ? fmtMs(t.latency_ms) : null,
      t.usage && (t.usage.input || t.usage.output) ? `${fmtTokens(t.usage.input + t.usage.output)} tokens` : null,
    ].filter(Boolean).join(' · ');
    return h('article', { class: `thought${isLive ? ' live' : ''}`, 'data-ply': t.ply },
      h('header', {},
        h('span', { class: 'ply' }, `#${t.ply}`),
        h('span', { class: `move${latin(t.label)}` }, t.label || (isLive ? (d.options?.hideThoughts && (c?.kind === 'model' || c?.kind === 'agent') ? '' : '思考中') : '判负')),
        h('span', { class: 'grow' }),
        drawChip(t.ply),
        qChip(q)),
      meta ? h('div', { class: 'meta' }, meta) : null,
      ...body);
  }

  const seenCards = {};
  const THOUGHT_WIN = 8;
  const thoughtsAll = new Set();
  // 已经走完的那几步的思考卡：内容没变就接着用原来那张（不重建、不重新排字；读者点开的「原生推理」也不会每走一步就自己合上）
  const cardCache = new Map();
  function cachedCard(t) {
    const q = evalHidden() ? null : t.eval?.quality;
    const o = offers().find((x) => x.ply === t.ply || x.answerPly === t.ply);
    const sig = [t.seat, t.label, t.analysis?.length, t.reasoning?.length, q?.tag, q?.loss, q?.before, t.self_winrate, t.latency_ms, t.attempts?.length, o?.status, o?.ply].join('|');
    const hit = cardCache.get(t.ply);
    if (hit && hit.sig === sig) { hit.el.classList.remove('fresh', 'focus', 'reveal'); return hit.el; }
    const el = thoughtCard(t);
    cardCache.set(t.ply, { sig, el });
    return el;
  }
  function renderThoughts() {
    if (duo) { renderFocus(); return; }
    if (hud) { renderSpot(); renderHandLog(); return; }
    for (const seat of seats) {
      const cards = [];
      const p = partials.get(seat);
      if (p && d.status === 'running' && viewPly === null) cards.push(thoughtCard(p, true));
      const limit = viewPly ?? Infinity;
      const plies = [...turns.keys()].filter((k) => turns.get(k).seat === seat && k <= limit).sort((a, b) => b - a);
      // 长对局每走一步都把这一方几十上百张思考卡全部重建（回放到 150 步时一步要建几千个节点，4 倍降速下每步 350ms）：
      // 默认只画最近的 THOUGHT_WIN 张，更早的收在一个「显示全部」键后面
      const shown = thoughtsAll.has(seat) ? plies : plies.slice(0, THOUGHT_WIN);
      for (const k of shown) cards.push(cachedCard(turns.get(k)));
      if (plies.length > shown.length) cards.push(h('button', { type: 'button', class: 'th-more', onclick: () => { thoughtsAll.add(seat); renderThoughts(); } }, `更早的 ${plies.length - shown.length} 步 · 显示全部`));
      // 我自己的那一栏：轮到我时顶上写「轮到你」，不是「等待出手」
      const myTurnNow = seat === humanSeat && waitingHuman === seat && d.status === 'running' && viewPly === null;
      if (myTurnNow) cards.unshift(h('div', { class: 'camp-empty camp-turn' }, '轮到你'));
      if (!cards.length) cards.push(h('div', { class: 'camp-empty' }, d.status !== 'running' ? '没有记录' : seat === humanSeat ? '等对手出手' : '等待出手'));
      // 新出现的思考卡从上面滑进来（已经在的卡不重播）
      if (viewPly === null) {
        const prev = seenCards[seat];
        seenCards[seat] = new Set(cards.map((x) => x.dataset?.ply).filter(Boolean));
        if (prev) for (const x of cards) if (x.dataset?.ply && !prev.has(x.dataset.ply)) x.classList.add('fresh');
      }
      const list = camps[seat].list;
      list.replaceChildren(...cards);
      if (viewPly !== null) {
        const el = list.querySelector(`[data-ply="${viewPly}"]`);
        if (el) {
          el.classList.add('focus');
          if (replaying) { el.classList.add('reveal'); el.style.setProperty('--reveal', `${Math.max(0.4, 1.6 / speed)}s`); }
        }
        list.scrollTo({ top: 0, behavior: replaying ? 'auto' : 'smooth' });
      } else list.scrollTop = 0; // 每次都回顶：列表有滚动吸附，顶上插进新卡时浏览器会跟着原来吸住的那张卡往下滚，新卡反而被挤出视野
    }
  }

  function goto(ply) {
    const n = totalPlies();
    if (ply === null || (ply >= n && d.status === 'running')) viewPly = null;
    else viewPly = Math.max(0, Math.min(n, ply));
    renderStatus();
    renderStage(!!replaying);
    if (!duo) seats.forEach(renderCamp); // 多人局的座位卡 renderStage 里已经画过
    renderMoves();
    renderCurve();
    renderThoughts();
  }

  // ---------- 回放 ----------
  function stopReplay() {
    if (!replaying) return;
    clearTimeout(replaying.timer);
    replaying = null;
    renderStatus();
  }
  function startReplay(from = 0) {
    if (!canReview()) return;
    replaying = { timer: null };
    window.__replayDone = false;
    goto(from);
    const step = () => {
      const n = totalPlies();
      if (!replaying) return;
      if (viewPly === null || viewPly >= n) {
        replaying = null;
        renderStatus();
        if (viewPly !== null && d.status === 'finished') resultBanner();
        window.__replayDone = true;
        return;
      }
      goto(viewPly + 1);
      // 发言：按倍速逐字打出来，打完再停一会儿（停顿也按倍速缩短）
      const sp = duo ? newSpeech(viewAt(viewPly - 1), viewAt(viewPly)) : null;
      if (sp) { present(sp, speed); seats.forEach(renderSeat); renderFocus(); }
      const t = turns.get(viewPly);
      stampFx(stampFor(t?.label, viewAt(viewPly)));
      const so = soundFor(t?.label, viewAt(viewPly));
      if (so) sfx(so, { fast: speed > 2 });
      const base = Math.min(5000, Math.max(900, (t?.latency_ms || 900) * 0.6 + (t?.analysis ? 600 : 0)));
      // 游戏要求的停顿（德州每手结算、开局提示）不随倍速缩短，画面要演完
      const extra = renderer.pauseAfter ? renderer.pauseAfter(viewAt(viewPly - 1), viewAt(viewPly)) || 0 : 0;
      replaying.timer = setTimeout(step, base / speed + extra + (sp ? speechPause(sp.text) / speed : 0));
    };
    const intro = from === 0 && renderer.pauseAfter ? renderer.pauseAfter(null, viewAt(0)) || 0 : 0;
    replaying.timer = setTimeout(step, 900 / speed + intro);
    renderStatus();
  }

  let foldMeasured = false;
  function renderAll() {
    if (!duo) seats.forEach(renderCamp); // 多人局的座位卡在 renderStage 里画（要用新算出的场景）
    renderStage(); // 先算出场景（多人局的状态字要用）
    renderStatus();
    renderCurve();
    renderMoves();
    renderThoughts();
    // 第一次量折叠时焦点区还是空的（renderStage 在 renderFocus 之前），会把面板全收起来、留下一大块空宣纸：画完整页后重量一次
    if (duo && !foldMeasured) { foldMeasured = true; fold?.update(true); }
  }

  // 只更新正在思考的卡片，避免每个字都重绘整栏
  const liveTimers = new Map();
  const liveLast = new Map();
  const LIVE_GAP = 160;
  function updateLive(seat) {
    if (liveTimers.has(seat) || viewPly !== null) return;
    // 多人局的焦点区、牌桌的聚光框每次都整块重画：流式输出时最多每 LIVE_GAP 毫秒画一次，不是每个字一帧
    if (duo || hud) {
      const wait = Math.max(0, LIVE_GAP - (performance.now() - (liveLast.get(seat) || 0)));
      liveTimers.set(seat, setTimeout(() => requestAnimationFrame(() => {
        liveTimers.delete(seat);
        liveLast.set(seat, performance.now());
        if (viewPly !== null) return;
        if (duo) { if (focusOf() === seat) renderFocus(); } else renderSpot();
      }), wait));
      return;
    }
    liveTimers.set(seat, requestAnimationFrame(() => {
      liveTimers.delete(seat);
      const p = partials.get(seat);
      if (!p) return;
      const list = camps[seat].list;
      const old = list.querySelector('.thought.live');
      if (!old) { renderThoughts(); return; }
      const fresh = thoughtCard(p, true);
      const det = old.querySelector('details');
      const oldReason = old.querySelector('.reasoning');
      const keepBottom = oldReason ? oldReason.scrollHeight - oldReason.scrollTop - oldReason.clientHeight < 30 : true;
      old.replaceWith(fresh);
      const nd = fresh.querySelector('details');
      if (nd && det) nd.open = det.open;
      const nr = fresh.querySelector('.reasoning');
      if (nr && keepBottom) nr.scrollTop = nr.scrollHeight;
    }));
  }

  /** 上帝视角 ⇄ 不剧透（公共视角） */
  async function togglePov() {
    d.viewer = d.viewer === '*' ? null : '*';
    await syncFromServer();
    toast(d.viewer === '*' ? '已切到不剧透：只看公共信息' : '已切回上帝视角');
  }
  /** 重新拿对局详情，正在想的人也按服务端的为准（不剧透时事件里的内容不能用） */
  async function syncFromServer() {
    await refresh();
    partials.clear();
    for (const p of d.partials || []) partials.set(p.seat, { ...p });
    turns.clear();
    for (const t of d.turns) turns.set(t.ply, t);
    waitingHuman = d.waitingHuman;
    renderAll();
  }
  let povTimer = null;

  async function refresh() {
    d = await api(`/matches/${id}${d.viewer ? `?viewer=${d.viewer}` : ''}`);
    viewCache.clear();
    for (const t of d.turns) turns.set(t.ply, t);
  }

  renderAll();
  // 链接参数：?turn=N 打开就停在第 N 步，?autoplay=1 自动回放，?speed= 倍速，?embed=1 嵌入（不显示导航）
  const qTurn = query.has('turn') ? Number(query.get('turn')) : null;
  if (query.get('embed') === '1') document.body.classList.add('embed-mode');
  if (recordMode) setTimeout(() => startReplay(0), 1200);
  else if (query.get('autoplay') === '1' && canReview()) setTimeout(() => startReplay(Number.isFinite(qTurn) ? qTurn : 0), 800);
  else if (Number.isFinite(qTurn) && canReview()) goto(qTurn);
  else if (d.status !== 'running' && canReview()) goto(totalPlies());

  // ---------- 实时事件 ----------
  let reportTimer = null; // 终局后自动弹战报；离开页面要取消，免得弹到别的页上
  let left = false;
  const stop = listen([`match:${id}`], async (e) => {
    // 不剧透时，事件里带着上帝视角的局面和夜间行动：一律不用，攒一下再向服务端要公共视角
    if (d.viewer === '*' && d.status === 'running' && e.type !== 'end') {
      if (e.type === 'delta') return;
      clearTimeout(povTimer);
      povTimer = setTimeout(() => syncFromServer().catch(() => {}), 250);
      return;
    }
    switch (e.type) {
      case '_open':
        // 实时连接刚连上：连上之前发出的事件（比如开局第一手的「轮到你」）收不到，补拉一次
        if (d.status === 'running') {
          await syncFromServer().catch(() => {});
          if (waitingHuman && !clock.has(waitingHuman)) { clock.set(waitingHuman, Date.now() - (d.waitingElapsed || 0)); nudgeTurn(); }
        }
        break;
      case 'turn_start':
        clock.set(e.seat, Date.now());
        // 轮到单人行动：别人不可能还在想（页面刚打开时可能错过了上一步的 move 事件，免得那个人一直亮着）
        if (!e.simultaneous) for (const s of [...partials.keys()]) if (s !== e.seat) partials.delete(s);
        if (e.seat && e.seat === humanSeat) { partials.delete(e.seat); await refresh(); waitingHuman = d.waitingHuman; if (waitingHuman) nudgeTurn(); }
        else partials.set(e.seat, { ply: e.ply, seat: e.seat, characterId: e.characterId, character_id: e.characterId, text: '', reasoning: '', attempts: [] });
        seats.forEach(renderCamp);
        renderStatus();
        renderThoughts();
        renderStage(false);
        break;
      case 'human_turn':
        if (e.seat && !clock.has(e.seat)) clock.set(e.seat, Date.now());
        // 只有轮到我自己的座位才进入「轮到你」；别的真人在想时和模型一样显示思考中
        await refresh();
        waitingHuman = d.waitingHuman;
        if (waitingHuman && !clock.has(waitingHuman)) { clock.set(waitingHuman, Date.now() - (d.waitingElapsed || 0)); nudgeTurn(); }
        if (e.seat && e.seat !== humanSeat && !partials.has(e.seat)) partials.set(e.seat, { ply: null, seat: e.seat, text: '', reasoning: '', attempts: [] });
        renderAll();
        break;
      case 'delta': {
        const p = partials.get(e.seat);
        if (!p || p.ply !== e.ply) return;
        if (e.attempt !== p.attempt) { p.attempt = e.attempt; p.text = ''; p.reasoning = ''; }
        if (e.kind === 'text') p.text += e.text;
        else p.reasoning += e.text;
        updateLive(e.seat);
        break;
      }
      case 'illegal': {
        const p = partials.get(e.seat);
        // 有真人的隐藏信息对局里，服务端不发理由和原话（可能带着私密信息），结束后从记录里看
        if (p) { p.attempts.push(e.error ? { attempted: e.attempted, error: e.error } : { attempted: null, error: '理由对局结束后公开' }); updateLive(e.seat); }
        break;
      }
      case 'move': {
        if (e.seat) clock.delete(e.seat);
        if (e.secret) {
          // 对玩家隐藏的一步（别人的夜间行动）：事件里没有座位，正在想的人按服务端的为准，免得走完的人一直亮着
          await refresh();
          const keep = new Map(partials);
          partials.clear();
          for (const p of d.partials || []) partials.set(p.seat, { ...p, ...(keep.get(p.seat) || {}) });
          if (viewPly === null) renderAll();
          break;
        }
        if (waitingHuman === e.seat) waitingHuman = null;
        const p = partials.get(e.seat);
        const prevView = d.view;
        turns.set(e.ply, {
          ply: e.ply, seat: e.seat, character_id: e.characterId, action: e.action, label: e.label,
          analysis: e.analysis, reasoning: d.options?.hideThoughts ? null : p?.reasoning || null,
          self_winrate: e.selfWinrate, latency_ms: e.latency, usage: e.usage, attempts: p?.attempts || [], eval: turns.get(e.ply)?.eval || null,
        });
        partials.delete(e.seat);
        if (Array.isArray(d.record?.actions)) d.record.actions.push({ seat: e.seat, action: e.action });
        if (e.view) d.view = e.view;
        else await refresh();
        if (viewPly === null) {
          const sp = duo ? newSpeech(prevView, d.view) : null;
          if (sp) present(sp);
          renderAll(); stampFx(stampFor(e.label, d.view)); const so = soundFor(e.label, d.view); if (so) sfx(so);
          const st = duo || hud ? null : stampFor(e.label, d.view);
          const lb = String(e.label || '');
          announceMove(`第${e.ply}步 ${duo ? `${seats.indexOf(e.seat) + 1}号` : seatName(e.seat)} ${lb.length > 40 ? `${lb.slice(0, 40)}…` : lb}${st === '杀' ? ' 将死' : st === '将' ? ' 将军' : ''}`);
        }
        else { seats.forEach(renderCamp); renderStatus(); renderMoves(); }
        break;
      }
      case 'eval': {
        if (e.ply === 0) d.options.startEval = e.eval;
        else if (turns.has(e.ply)) turns.get(e.ply).eval = e.eval;
        else turns.set(e.ply, { ply: e.ply, eval: e.eval });
        renderStage(false);
        renderCurve();
        renderMoves();
        const t = turns.get(e.ply);
        if (t?.seat) {
          renderCamp(t.seat);
          const card = camps[t.seat].list.querySelector(`.thought[data-ply="${e.ply}"]`);
          if (card) { cardCache.delete(t.ply); card.replaceWith(cachedCard(t)); }
        }
        break;
      }
      case 'draw':
        d.options.draw = e.draw;
        renderStatus();
        renderThoughts();
        break;
      case 'control':
        paused = e.paused;
        if (!duo) seats.forEach(renderCamp);
        renderStatus();
        renderStage(false);
        break;
      case 'end':
        d.viewer = null; // 结束后看上帝视角
        clock.clear();
        await refresh();
        partials.clear();
        waitingHuman = null;
        renderAll();
        if (!recordMode && canReview()) goto(totalPlies());
        // 对局页的转播条已经写着结果，不再弹提示条；棋类在棋盘上浮一条结果横幅
        if (!recordMode && d.status === 'finished') resultBanner();
        if (d.status === 'finished') sfx('win');
        // 战报等结果横幅演完再弹
        if (d.status === 'finished' && winbarOn && !recordMode) reportTimer = setTimeout(() => { if (root.isConnected && !left) showReport(); }, two && !duo ? 3400 : 1800);
        // 棋类已经有结果横幅，不再叠一枚「终」字大印
        // 狼人杀、谁是卧底的场景匾自己盖「胜」印，不再在屏幕正中压一枚大「终」字（会盖住座位和发言）
        if (d.status === 'finished' && !hud && !duo && !(two && !recordMode)) stampFx(d.result?.ranks && Object.values(d.result.ranks).every((r) => r === 1) ? '和' : '终', true);
        break;
    }
  });
  // ---------- 键盘 ----------
  // ← → 单步，Home / End 回到开头、最新，空格 播放/暂停回放，F 翻转棋盘。轮到自己出手、或在输入框里打字时不抢键
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape' && pickSel) { pickSel = null; seats.forEach(renderSeat); e.preventDefault(); return; }
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (waitingHuman && viewPly === null) return;
    const n = totalPlies();
    const at = viewPly ?? n;
    let used = true;
    if (e.key === 'ArrowLeft' && canReview()) { stopReplay(); goto(Math.max(0, at - 1)); }
    else if (e.key === 'ArrowRight' && canReview()) { stopReplay(); goto(at + 1 >= n ? (d.status === 'running' ? null : n) : at + 1); }
    else if (e.key === 'Home' && canReview()) { stopReplay(); goto(0); }
    else if (e.key === 'End') { stopReplay(); goto(d.status === 'running' ? null : n); }
    else if (e.key === ' ' && canReview() && n) { if (replaying) stopReplay(); else startReplay(viewPly !== null && viewPly < n ? viewPly : 0); }
    else if ((e.key === 'f' || e.key === 'F') && stage.setFlipped) { flipped = !flipped; stage.setFlipped(flipped); renderStage(false); }
    else if ((e.key === 'j' || e.key === 'k') && winbarOn && canReview() && !evalHidden()) {
      const keys = keyMoments();
      const p = e.key === 'j' ? [...keys].reverse().find((x) => x < at) : keys.find((x) => x > at);
      if (p) { stopReplay(); goto(p); }
    }
    else used = false;
    if (used) e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  return () => { left = true; clearTimeout(reportTimer); document.removeEventListener('keydown', onKey); stop(); stopReplay(); fold?.destroy(); cleanups.forEach((f) => f()); document.body.classList.remove('record-mode', 'embed-mode'); };
}
