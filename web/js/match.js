// 对局页（所有游戏通用）：一屏显示。中间是游戏画面、胜率条、走势和着法，两侧是各座位的选手卡和思考。
// 回放：从对局记录在浏览器里重建每一步，可以播放、调速、拖动进度。
// 录制版式：地址带 ?record=1 时隐藏导航、自动从头播放，播完设置 window.__replayDone = true（供服务端录成视频）。

import { h, api, post, listen, toast, guard, tierBadge, fmtMs, fmtTokens, pct, MODE_NAMES, resultText, modelLine } from './ui.js';
import { loadRenderer, PALETTE } from '../stage/index.js';
import { createFold } from './fold.js';
import { createSpot } from './spot.js';

const LINE_KEYS = ['判断', '威胁', '理由', '推断', '计划'];
const QUALITY_CLASS = { 最佳: 'good', 好棋: 'good', 缓着: 'warn', 失误: 'warn', 大漏着: 'bad' };
const DRAW_TAG = { pending: ['提和', 'warn'], declined: ['提和被拒', ''], accepted: ['提和', 'good'], ignored: ['提和（冷却中，未送出）', ''] };
const SPEEDS = [0.5, 1, 2, 4, 8];

function parseAnalysis(text) {
  if (!text) return null;
  const out = {};
  for (const k of [...LINE_KEYS, '胜率']) {
    const m = new RegExp(`${k}[:：]\\s*(.+)`).exec(text);
    if (m) out[k] = m[1].trim();
  }
  return Object.keys(out).length >= 2 ? out : null;
}

function qualityChip(q) {
  if (!q) return null;
  return h('span', { class: `chip ${QUALITY_CLASS[q.tag] || ''}`, title: `比引擎最佳着法少 ${Math.round(q.loss * 100)} 个胜率百分点` },
    q.tag, q.loss >= 0.05 ? ` −${Math.round(q.loss * 100)}%` : '');
}

export async function matchView(root, id, { characters }) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const recordMode = query.get('record') === '1';
  let d = await api(`/matches/${id}`);
  const renderer = await loadRenderer(d.game);
  const gameMod = (await import(`/games/${d.game}/index.js`)).default;
  const { replay } = await import('/games/index.js');

  const chars = new Map(characters.map((c) => [c.id, c]));
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
  const color = (seat) => renderer.seatColor?.(seat, seats.indexOf(seat)) || PALETTE[seats.indexOf(seat) % PALETTE.length];
  // 我自己坐的座位（一盘里可以有多位真人，各看各的）；有真人在局时不给暂停
  const humanSeat = d.mySeat || null;
  const hasHuman = seats.some((s) => seatChar(s)?.kind === 'human');
  let flipped = humanSeat ? !!renderer.flipFor?.(humanSeat) : false;
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
  // 牌桌版式（德州）：牌桌上已有每个人的名牌和动作，两侧不放选手卡；右上是聚光框（只显示轮到的人），右下是本手记录
  const hud = !duo && !!renderer.hud;
  const spot = hud ? createSpot() : null;
  const handBox = h('section', { class: 'hand-log' });
  let pinPly = null; // 在本手记录里点过的一步；null 表示聚光框跟随当前行动者
  let spotPly = null;
  stage.setFlipped?.(flipped);

  // ---------- 布局 ----------
  const camps = {};
  for (const seat of seats) {
    const head = h('div', { class: 'camp-head' });
    const list = h('div', { class: 'camp-thoughts' });
    const el = h('section', { class: `camp${two ? '' : ' compact'}`, style: { '--side-color': color(seat) } }, head, list);
    camps[seat] = { head, list, el };
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
  const moves = h('div', { class: 'stage-moves' });
  const [aw, ah] = renderer.aspect || [1, 1];

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
      h('section', { class: 'stage' }, statusBar, sceneEl, focusEl, h('div', { class: 'duo-stage' }, stage.el), logBox),
      h('div', { class: 'seats' }, ...rightSeats.map((s) => seatEls[s])),
    ));
    // 放不下时把面板收成胶囊按钮（见 fold.js）；按钮条放在面板的位置上
    const arenaEl = root.firstElementChild;
    fold = createFold({ arena: arenaEl, stageCol: arenaEl.querySelector('.stage'), focusEl, panelRoot: stage.el, logBox, moves, logLabel: () => logSum.textContent.replace(/^全部记录\s*·\s*/, '') });
    logBox.before(fold.el);
  } else if (hud) {
    root.replaceChildren(h('div', { class: `arena hud g-${d.game}${recordMode ? ' recording' : ''}`, style: { '--aw': aw, '--ah': ah } },
      h('section', { class: 'stage' }, statusBar, h('div', { class: 'stage-board' }, h('div', { class: 'board-wrap' }, stage.el))),
      h('aside', { class: 'hud-col' }, spot.el, handBox)));
  } else {
    root.replaceChildren(h('div', { class: `arena g-${d.game}${winbarOn ? '' : ' no-winbar'}${recordMode ? ' recording' : ''}`, style: { '--aw': aw, '--ah': ah } },
      h('div', { class: 'camp-col' }, ...leftSeats.map((s) => camps[s].el)),
      h('section', { class: 'stage' },
        statusBar,
        h('div', { class: 'stage-board' }, h('div', { class: 'board-wrap' }, stage.el)),
        winbarOn ? curve : null,
        moves,
      ),
      h('div', { class: 'camp-col' }, ...rightSeats.map((s) => camps[s].el)),
    ));
  }
  if (recordMode) document.body.classList.add('record-mode');

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

  function seatStats(seat) {
    const limit = viewPly ?? Infinity;
    const ts = [...turns.values()].filter((t) => t.seat === seat && t.label && t.ply <= limit);
    const tags = { 失误: 0, 大漏着: 0 };
    let lat = 0, tok = 0, illegal = 0, last = null;
    for (const t of ts) {
      lat += t.latency_ms || 0;
      tok += (t.usage?.input || 0) + (t.usage?.output || 0);
      if (t.attempts?.length) illegal += t.attempts.length;
      const tag = t.eval?.quality?.tag;
      if (tag in tags) tags[tag]++;
      if (!last || t.ply > last.ply) last = t;
    }
    return { n: ts.length, avg: ts.length ? lat / ts.length : 0, tok, illegal, tags, last };
  }

  // ---------- 渲染 ----------
  const stat = (label, value, title = '') => h('div', { class: 'cs', title }, h('b', {}, value), h('small', {}, label));
  const bar = (v, cls) => h('span', { class: `gbar ${cls}` }, h('i', { style: { width: `${v === null ? 0 : Math.round(v * 100)}%` } }));

  // ---------- 对称座位版式 ----------
  /** 当前焦点：点过的座位，否则是正在行动的人，再否则是最近一步的人 */
  function focusOf() {
    if (focusSeat) return focusSeat;
    if (viewPly === null && d.status === 'running') {
      const live = [...partials.keys()][0] || waitingHuman;
      if (live) return live;
    }
    const limit = viewPly ?? Infinity;
    const last = [...turns.values()].filter((t) => t.seat && t.label && t.ply <= limit).sort((a, b) => b.ply - a.ply)[0];
    return last?.seat || seats[0];
  }

  function renderSeat(seat) {
    const c = seatChar(seat);
    const info = duoInfo.seats?.[seat] || {};
    const st = String(info.state || '');
    const thinking = d.status === 'running' && viewPly === null && (partials.has(seat) || waitingHuman === seat);
    // 多人同时思考（投票）时不让所有座位一起闪，只标单人行动
    const speaking = st.includes('speaking') || (thinking && partials.size <= 1);
    const cls = ['seat', rightSeats.includes(seat) ? 'mir' : '', st.replace('speaking', ''), speaking ? 'speaking' : '', focusOf() === seat ? 'focused' : '', info.pick ? 'pickable' : ''].filter(Boolean).join(' ');
    const el = h('div', {
      class: cls, role: 'button', tabindex: 0, title: info.pick ? info.pickTitle || '选这个人' : `看 ${seats.indexOf(seat) + 1} 号的发言和想法`,
      onclick: () => {
        if (info.pick) {
          // 毒药不可撤回，先确认一次
          if (String(info.pick).startsWith('poison:') && !confirm(`${info.pickTitle || '用毒药'}？毒药只有一瓶，用了不能撤回。`)) return;
          doAction(info.pick);
          return;
        }
        focusSeat = focusSeat === seat ? null : seat;
        seats.forEach(renderSeat);
        renderFocus();
      },
    },
    h('span', { class: 'no' }, seats.indexOf(seat) + 1),
    h('span', { class: 'coin' }, c?.avatar || '？', st.includes('dead') ? h('span', { class: 'dead-mark' }, '亡') : null),
    // 发言不再铺在座位卡上，点座位在中间焦点区看；这里只标说过几句
    h('div', { class: 'info' }, h('b', { class: 'nm' }, c?.name || '？'), h('div', { class: 'md' }, modelLine(c)),
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
    sceneEl.replaceChildren(sc ? h('div', {}, h('b', { class: 't' }, sc.title), sc.sub ? h('span', { class: 's' }, sc.sub) : null) : null);
  }

  /** 焦点区：大头像 +「说的」（公开发言、投票）+「想的」（AI 的推理，上帝视角或对局结束后才有） */
  let lastFocus = null;
  function renderFocus() {
    const seat = focusOf();
    const c = seatChar(seat);
    const info = duoInfo.seats?.[seat] || {};
    const limit = viewPly ?? Infinity;
    const live = viewPly === null && d.status === 'running' ? partials.get(seat) : null;
    const t = live || [...turns.values()].filter((x) => x.seat === seat && x.ply <= limit).sort((a, b) => b.ply - a.ply)[0];
    const hidden = d.options?.hideThoughts && d.status === 'running' && (c?.kind === 'model' || c?.kind === 'agent');
    const a = t && !live ? parseAnalysis(t.analysis) : null;
    const thoughtText = hidden ? '对局结束后公开'
      : live ? (live.text || live.reasoning || '思考中…')
        : a ? LINE_KEYS.filter((k) => a[k] && k !== '发言' && k !== '投票').map((k) => `${k}：${a[k]}`).join('\n') || t?.analysis || ''
          : t?.analysis || t?.reasoning || '';
    // 「说的」：这个人全部的公开发言（按轮次），最后一步若不是发言（投票、用药）单列一行
    const said = info.said || [];
    const isSpeech = (label) => said.some((x) => label.includes(x.text) || x.text.includes(label));
    const recent = !live && t?.label && !isSpeech(t.label) ? t.label : null;
    const lines = said.map((x, i) => h('div', { class: `sp${i === said.length - 1 && !recent && !live ? ' last' : ''}` }, h('span', { class: 'tg' }, x.tag), h('span', { class: 'tx' }, x.text)));
    if (recent) lines.push(h('div', { class: 'sp act last' }, h('span', { class: 'tg' }, '刚才'), h('span', { class: 'tx' }, recent)));
    if (live) lines.push(h('div', { class: 'sp live' }, h('span', { class: 'tg' }, '此刻'), h('span', { class: 'tx' }, '正在想…')));
    const saidBox = h('div', { class: 'said-list' }, ...(lines.length ? lines : [h('div', { class: 'none' }, '还没有开口')]));
    // 没有想法可看（内置 AI 不写想法，或真人局里 AI 的想法要等终局）：「说的」占满整行，想法那栏收成一句说明
    const solo = !live && (hidden || !thoughtText);
    // 换了人：焦点区内容依次浮上来，不是一下子替换
    const swapped = lastFocus !== null && lastFocus !== seat;
    lastFocus = seat;
    focusEl.className = `focus${solo ? ' solo' : ''}${swapped ? ' swap' : ''}`;
    focusEl.replaceChildren(
      // 结构：头像行（横排）+「说的」+「想的」；宽屏时说的、想的左右并排
      h('div', { class: 'who' }, h('span', { class: 'coin lg' }, c?.avatar || '？'),
        h('div', { class: 'id' }, h('b', { class: 'gold-text' }, `${seats.indexOf(seat) + 1} 号 · ${c?.name || '？'}`), h('small', {}, modelLine(c))),
        info.role ? h('span', { class: 'role', style: { '--rc': info.role.color || 'var(--jade)' } }, info.role.text) : null,
        hidden ? h('span', { class: 'chip' }, '想法对局结束后公开') : null,
        h('span', { class: 'hint' }, focusSeat ? '' : '点座位换人看'),
        focusSeat ? h('button', { class: 'btn sm ghost', onclick: () => { focusSeat = null; seats.forEach(renderSeat); renderFocus(); } }, '跟随当前') : null),
      // 宣纸右下角淡淡的座号水印：大屏上宣纸撑高时留白有个落点（宣纸矮时不显示，见 app.css）
      h('div', { class: `paper said${(focusEl.querySelector('.said')?.clientHeight || 0) >= 240 ? ' tall' : ''}` }, h('span', { class: 'wm-no', 'aria-hidden': 'true' }, `${seats.indexOf(seat) + 1}号`), h('span', { class: 'lab' }, said.length ? `说的 · ${said.length} 句` : '说的'), saidBox),
      solo ? null : h('div', { class: `well thought2${live ? ' typing' : ''}` }, h('span', { class: 'lab' }, d.viewer ? '想的' : '想的 · 上帝视角'), h('div', { class: 'tt' }, thoughtText || '思考中…')));
    saidBox.scrollTop = saidBox.scrollHeight;
    const markScrolled = () => saidBox.classList.toggle('scrolled', saidBox.scrollTop > 2);
    saidBox.addEventListener('scroll', markScrolled, { passive: true });
    requestAnimationFrame(markScrolled);
    fold?.schedule();
  }

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
      h('span', { class: 'coin' }, c?.avatar || '？'),
      h('div', { class: 'who' },
        h('b', {}, c?.name || seatName(seat)),
        h('span', {}, [seatName(seat), c?.kind === 'human' ? '真人' : c?.kind === 'agent' ? '自带 Agent' : c?.kind === 'model' ? c.model : modelLine(c || {})].filter(Boolean).join(' · ')),
        line ? h('span', { class: 'ln' }, line) : null),
    ];
    const tools = f.pinned ? h('button', { class: 'btn sm ghost', onclick: () => { pinPly = null; renderSpot(); renderHandLog(); } }, '跟随当前') : null;
    const body = [h('div', { class: 'spot-act' },
      h('span', { class: `st${f.live || f.human ? ' live' : ''}` }, status),
      f.turn?.label ? h('b', { class: 'act' }, f.turn.label) : f.live || f.human ? h('span', { class: 'dots' }, h('i'), h('i'), h('i')) : null)];
    const scroll = h('div', { class: 'spot-scroll', 'data-stick': f.live ? 'bottom' : '' });
    if (mine) scroll.append(h('div', { class: 'spot-tip' }, renderer.turnTip || '轮到你了：在牌桌上出手。'));
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
  let hlSeen = new Set();
  function renderHandLog() {
    if (!hud) return;
    const view = viewPly === null ? d.view : viewAt(viewPly);
    const L = renderer.handLog?.(view);
    if (!L) return;
    const cur = viewPly ?? totalPlies();
    const base = cur - L.count; // 本手第 k 条行动是第 base + k 步
    let k = 0;
    const list = h('div', { class: 'hl-list' });
    // 新出现的行滑进来；已经在的行不重播动画
    const seen = hlSeen;
    hlSeen = new Set();
    const fresh = (key) => { hlSeen.add(key); return seen.size && !seen.has(key) ? ' fresh' : ''; };
    if (L.last) list.append(h('div', { class: 'hl-last' }, L.last));
    for (const g of L.groups) {
      list.append(h('div', { class: `hl-street${fresh(`${view.handNo}|${g.street}|${g.board.join('')}`)}` }, h('span', {}, g.name), ...g.board.map(cardChip)));
      for (const it of g.items) {
        if (it.blind) { list.append(h('div', { class: `hl-item blind${fresh(`${view.handNo}|${it.seat}|${it.text}`)}` }, h('span', { class: 'no', style: { '--c': color(it.seat) } }, seatNum(it.seat)), h('span', { class: 'nm' }, seatChar(it.seat)?.name || seatName(it.seat)), h('span', { class: 'tx' }, it.text))); continue; }
        const ply = base + (++k);
        list.append(h('button', { class: `hl-item${spotPly === ply ? ' on' : ''}${fresh(`p${ply}`)}`, type: 'button', title: '在聚光框里看这一步的思考', onclick: () => { pinPly = pinPly === ply ? null : ply; renderSpot(); renderHandLog(); } },
          h('span', { class: 'no', style: { '--c': color(it.seat) } }, seatNum(it.seat)),
          h('span', { class: 'nm' }, seatChar(it.seat)?.name || seatName(it.seat)),
          h('span', { class: 'tx' }, it.text)));
      }
    }
    if (!L.count) list.append(h('div', { class: 'hl-empty' }, d.status === 'running' && viewPly === null ? '这一手还没有人行动' : '这一手没有行动'));
    if (L.result) list.append(h('div', { class: `hl-res${fresh(`r${view.handNo}`)}` }, L.result));
    handBox.replaceChildren(h('header', {}, h('b', {}, L.label || '本手记录'), h('span', {}, `${L.title} · ${L.sub}`)), list);
    list.scrollTop = list.scrollHeight;
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
    camps[seat].el.classList.toggle('active', thinking);
    camps[seat].el.classList.toggle('out', !!cv?.out?.includes?.(seat));
    camps[seat].head.replaceChildren(
      h('div', { class: 'camp-id' },
        h('div', { class: 'camp-avatar' }, c?.avatar || '？', thinking ? h('i', { class: 'pulse' }) : null),
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
      two ? h('div', { class: 'camp-stats' },
        stat('步数', s.n),
        stat('平均用时', s.n ? fmtMs(Math.round(s.avg)) : '—'),
        stat('tokens', fmtTokens(s.tok)),
        stat('失误', s.tags.失误 + s.tags.大漏着, s.tags.大漏着 ? `其中大漏着 ${s.tags.大漏着}` : ''),
        stat('无效', s.illegal)) : h('div', { class: 'camp-mini' }, `${s.n} 步 · ${s.n ? fmtMs(Math.round(s.avg)) : '—'} · ${fmtTokens(s.tok)} tokens${s.illegal ? ` · 无效 ${s.illegal}` : ''}${change ? ` · ${change.delta >= 0 ? '+' : ''}${change.delta}` : ''}`),
      two && s.last?.self_winrate !== null && s.last?.self_winrate !== undefined
        ? h('div', { class: 'camp-gauge', title: '最近一步：模型自评胜率 / 引擎评估（走棋前）' },
          h('span', {}, '自评'), bar(s.last.self_winrate / 100, 'self'), h('b', {}, `${s.last.self_winrate}%`),
          h('span', {}, '引擎'), bar(lastQ ? lastQ.before : null, 'engine'), h('b', {}, lastQ ? pct(lastQ.before) : '—'))
        : null,
      d.challenge?.by === d.seats[seat] && d.challenge.text ? h('div', { class: 'camp-quote' }, `「${d.challenge.text}」`) : null,
    );
  }

  let lastStatus = null;
  function renderStatus() {
    const running = d.status === 'running';
    const n = totalPlies();
    const thinkingSeats = [...partials.keys()];
    const status = running
      ? (paused ? '已暂停' : waitingHuman ? '轮到你' : thinkingSeats.length > 1 ? `${thinkingSeats.length} 人同时思考中` : thinkingSeats.length ? `${seatName(thinkingSeats[0])}思考中` : '…')
      : viewPly !== null && viewPly < n ? (replaying ? '回放中' : '复盘中') : resultText(d, d.seatNames);
    const btn = (label, title, fn) => h('button', { class: 'icon-btn', title, onclick: guard(fn) }, label);
    const po = pendingOffer();
    const reviewing = viewPly !== null;
    const prevStatus = lastStatus;
    lastStatus = status;
    statusBar.replaceChildren(
      h('div', { class: 'bar-info' },
        h('span', { class: 'gname' }, d.gameName || ''),
        h('span', { class: 'chip' }, MODE_NAMES[d.mode]),
        h('span', { class: `stage-state${running ? '' : ' done'}${prevStatus !== null && prevStatus !== status ? ' swap' : ''}` }, status),
        h('span', { class: 'muted small', style: { whiteSpace: 'nowrap' } }, reviewing ? `${replaying ? '回放' : '复盘'} ${viewPly}/${n}` : `已走 ${n} 步`)),
      h('div', { class: 'bar-ctrl' },
        canReview() && n ? [
          btn(replaying ? '⏸' : '⏵', replaying ? '暂停回放（空格）' : '从头回放（空格）', () => (replaying ? stopReplay() : startReplay(reviewing && viewPly < n ? viewPly : 0))),
          h('select', { class: 'speed', title: '回放速度', onchange: (e) => { speed = Number(e.target.value); } },
            ...SPEEDS.map((s) => h('option', { value: s, selected: s === speed }, `${s}×`))),
          reviewing ? btn('◀', '上一步（←）', () => { stopReplay(); goto(Math.max(0, viewPly - 1)); }) : null,
          reviewing ? btn('▶', '下一步（→）', () => { stopReplay(); goto(Math.min(n, viewPly + 1)); }) : null,
          reviewing && running ? btn('⟳', '回到最新', () => { stopReplay(); goto(null); }) : null,
        ] : null,
        running && !hasHuman ? btn(paused ? '▶' : '⏸', paused ? '继续' : '暂停', () => post(`/matches/${id}/control`, { op: paused ? 'resume' : 'pause' })) : null,
        running && paused ? btn('⏭', '单步', () => post(`/matches/${id}/control`, { op: 'step' })) : null,
        running && waitingHuman && po && po.seat !== waitingHuman ? h('button', { class: 'btn sm primary', onclick: guard(() => post(`/matches/${id}/control`, { op: 'accept_draw' })) }, '接受和棋') : null,
        running && waitingHuman && d.features?.draw && !po ? h('button', { class: `btn sm${offerNext ? ' primary' : ''}`, title: '走下一步时同时向对方提出和棋', onclick: () => { offerNext = !offerNext; renderStatus(); } }, offerNext ? '走棋时提和 ✓' : '提和') : null,
        running && waitingHuman ? btn('🏳', '认输', async () => { if (confirm('确定认输？')) await post(`/matches/${id}/control`, { op: 'resign' }); }) : null,
        running && d.mode === 'casual' ? btn('■', '中止对局', async () => { if (confirm('中止这盘？')) await post(`/matches/${id}/control`, { op: 'abort' }); }) : null,
        stage.setFlipped ? btn('⇅', '翻转（F）', () => { flipped = !flipped; stage.setFlipped(flipped); renderStage(false); }) : null,
        !running && canReview() && n ? btn('⏺', '录成视频（按当前回放速度）', async () => { await post(`/matches/${id}/record`, { speed }); toast(`已开始录制（${speed}×），完成后在「对局记录」里下载`); }) : null,
        h('a', { class: 'icon-btn', title: '导出记录', href: `/api/matches/${id}/export` }, '⤓'),
      ),
    );
    if (winbarOn) statusBar.append(tug);
    if (reviewing && canReview() && n) {
      statusBar.append(h('input', { class: 'scrub', type: 'range', min: 0, max: n, value: viewPly, oninput: (e) => { stopReplay(); goto(Number(e.target.value)); } }));
    }
  }

  let lastAnnView = null;
  function showAnnounce(a) {
    const col = root.querySelector('.arena .stage');
    if (!col) return;
    col.querySelector('.announce')?.remove();
    const card = h('div', { class: `announce ${a.kind || ''}`, role: 'status' }, h('b', {}, a.title), a.sub ? h('span', {}, a.sub) : null);
    col.append(card);
    setTimeout(() => card.remove(), 2700);
  }
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
    stage.render(view, { movable, actions: movable ? d.humanActions : null, arrows, animate, replay: !!replaying, viewer: d.viewer, players: playerInfo, clock: latest && d.status === 'running' ? Object.fromEntries(clock) : {} });
    // 场上公告（天亮死讯、有人出局）：画面往前走了一步才弹，复盘往回翻、第一次打开时不弹
    if (renderer.announce && animate && lastAnnView && view !== lastAnnView && (latest || replaying)) {
      let a = null;
      try { a = renderer.announce(lastAnnView, view); } catch (err) { console.error(err); }
      if (a) showAnnounce(a);
    }
    lastAnnView = view;
    if (duo) {
      try { duoInfo = renderer.duoView(view, { movable, actions: movable ? d.humanActions : null, viewer: d.viewer }) || duoInfo; } catch (err) { console.error(err); }
      renderScene();
      seats.forEach(renderSeat);
      fold?.update();
    }
    if (winbarOn) {
      let e = null;
      for (let p = ply; p >= 0 && e === null; p--) e = e0At(p);
      const v = e ?? 0.5;
      tugFill.style.width = `${v * 100}%`;
      tugKnot.style.left = `${v * 100}%`;
      tugL.textContent = `${seatName(seats[0])} ${Math.round(v * 100)}%`;
      tugR.textContent = `${Math.round((1 - v) * 100)}% ${seatName(seats[1])}`;
      tug.title = `${seatName(seats[0])}胜率 ${Math.round(v * 100)}%（${d.options?.startEval?.source === 'builtin' ? '内置粗略' : '引擎'}评估）`;
    }
  }

  function renderCurve() {
    if (!winbarOn) return;
    const n = totalPlies();
    const W = 600, H = 60;
    const pts = [];
    const upto = noSpoil() ? (viewPly ?? n) : n;
    for (let p = 0; p <= upto; p++) { const e = e0At(p); if (e !== null) pts.push([p, e]); }
    const self = [];
    for (let p = 1; p <= upto; p++) {
      const t = turns.get(p);
      if (t?.self_winrate === null || t?.self_winrate === undefined) continue;
      const s = t.self_winrate / 100;
      self.push([p, t.seat === seats[0] ? s : 1 - s]);
    }
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
    svgEl.addEventListener('click', (e) => {
      if (!n || !canReview()) return;
      const r = svgEl.getBoundingClientRect();
      stopReplay();
      goto(Math.round(((e.clientX - r.left) / r.width) * n));
    });
    curve.replaceChildren(svgEl, h('div', { class: 'curve-legend' }, h('span', { class: 'lg-engine' }, `${seatName(seats[0])}胜率`), h('span', { class: 'lg-self' }, '自评')));
  }

  function moveItems() {
    const list = renderer.moveList ? renderer.moveList(d.view) : null;
    if (list && list.length) return list;
    return [...turns.values()].filter((t) => t.label).sort((a, b) => a.ply - b.ply).map((t) => ({ seat: t.seat, label: t.label }));
  }

  let movesShown = null;
  function renderMoves() {
    if (hud) { renderHandLog(); return; }
    const all = moveItems();
    const items = noSpoil() && viewPly !== null ? all.slice(0, viewPly) : all;
    const cur = viewPly ?? items.length;
    const els = [];
    const cell = (j) => {
      const it = items[j];
      if (!it) return null;
      const q = turns.get(j + 1)?.eval?.quality;
      return h('span', { class: `mv${cur === j + 1 ? ' on' : ''}`, style: { color: two && seats.indexOf(it.seat) === 0 ? color(seats[0]) : '' }, onclick: () => { if (canReview()) { stopReplay(); goto(j + 1); } }, title: q ? q.tag : seatName(it.seat) },
        q ? h('i', { class: `q q-${q.tag}` }) : null, two ? '' : `${seatName(it.seat)} `, it.label);
    };
    if (two) for (let i = 0; i < items.length; i += 2) els.push(h('span', { class: 'mvpair' }, h('em', {}, i / 2 + 1), cell(i), cell(i + 1)));
    else for (let i = 0; i < items.length; i++) els.push(h('span', { class: 'mvpair' }, h('em', {}, i + 1), cell(i)));
    moves.replaceChildren(...(els.length ? els : [h('span', { class: 'muted small' }, '还没有行动')]));
    // 新的一步弹出来
    if (viewPly === null && movesShown !== null && items.length > movesShown) {
      const all = moves.querySelectorAll('.mv');
      for (let j = movesShown; j < items.length; j++) all[j]?.classList.add('fresh');
    }
    movesShown = items.length;
    logSum.textContent = `全部记录 · ${items.length} 条`;
    if (viewPly === null) moves.scrollTop = moves.scrollHeight;
    else {
      const on = moves.querySelector('.mv.on');
      if (on) moves.scrollTop = on.offsetTop - moves.clientHeight / 2;
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
    const q = t.eval?.quality;
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
        h('span', { class: 'move' }, t.label || (isLive ? (d.options?.hideThoughts && (c?.kind === 'model' || c?.kind === 'agent') ? '' : '思考中') : '判负')),
        h('span', { class: 'grow' }),
        drawChip(t.ply),
        qualityChip(q)),
      meta ? h('div', { class: 'meta' }, meta) : null,
      ...body);
  }

  const seenCards = {};
  function renderThoughts() {
    if (duo) { renderFocus(); return; }
    if (hud) { renderSpot(); renderHandLog(); return; }
    for (const seat of seats) {
      const cards = [];
      const p = partials.get(seat);
      if (p && d.status === 'running' && viewPly === null) cards.push(thoughtCard(p, true));
      const limit = viewPly ?? Infinity;
      const plies = [...turns.keys()].filter((k) => turns.get(k).seat === seat && k <= limit).sort((a, b) => b - a);
      for (const k of plies) cards.push(thoughtCard(turns.get(k)));
      if (!cards.length) cards.push(h('div', { class: 'camp-empty' }, d.status === 'running' ? '等待出手' : '没有记录'));
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
      } else list.scrollTop = 0;
    }
  }

  function goto(ply) {
    const n = totalPlies();
    if (ply === null || (ply >= n && d.status === 'running')) viewPly = null;
    else viewPly = Math.max(0, Math.min(n, ply));
    renderStatus();
    renderStage(!!replaying);
    seats.forEach(renderCamp);
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
        window.__replayDone = true;
        return;
      }
      goto(viewPly + 1);
      const t = turns.get(viewPly);
      stampFx(stampFor(t?.label, viewAt(viewPly)));
      const base = Math.min(5000, Math.max(900, (t?.latency_ms || 900) * 0.6 + (t?.analysis ? 600 : 0)));
      // 游戏要求的停顿（德州每手结算、开局提示）不随倍速缩短，画面要演完
      const extra = renderer.pauseAfter ? renderer.pauseAfter(viewAt(viewPly - 1), viewAt(viewPly)) || 0 : 0;
      replaying.timer = setTimeout(step, base / speed + extra);
    };
    const intro = from === 0 && renderer.pauseAfter ? renderer.pauseAfter(null, viewAt(0)) || 0 : 0;
    replaying.timer = setTimeout(step, 900 / speed + intro);
    renderStatus();
  }

  function renderAll() {
    seats.forEach(renderCamp);
    renderStatus();
    renderStage();
    renderCurve();
    renderMoves();
    renderThoughts();
  }

  // 只更新正在思考的卡片，避免每个字都重绘整栏
  const liveTimers = new Map();
  function updateLive(seat) {
    if (liveTimers.has(seat) || viewPly !== null) return;
    if (duo) { liveTimers.set(seat, requestAnimationFrame(() => { liveTimers.delete(seat); if (focusOf() === seat) renderFocus(); })); return; }
    if (hud) { liveTimers.set(seat, requestAnimationFrame(() => { liveTimers.delete(seat); renderSpot(); })); return; }
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

  async function refresh() {
    d = await api(`/matches/${id}${d.viewer ? `?viewer=${d.viewer}` : ''}`);
    viewCache.clear();
    for (const t of d.turns) turns.set(t.ply, t);
  }

  renderAll();
  if (recordMode) setTimeout(() => startReplay(0), 1200);
  else if (d.status !== 'running' && canReview()) goto(totalPlies());

  // ---------- 实时事件 ----------
  const stop = listen([`match:${id}`], async (e) => {
    switch (e.type) {
      case 'turn_start':
        clock.set(e.seat, Date.now());
        if (e.seat && e.seat === humanSeat) { partials.delete(e.seat); await refresh(); waitingHuman = d.waitingHuman; }
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
        if (waitingHuman && !clock.has(waitingHuman)) clock.set(waitingHuman, Date.now() - (d.waitingElapsed || 0));
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
        if (p) { p.attempts.push({ attempted: e.attempted, error: e.error }); updateLive(e.seat); }
        break;
      }
      case 'move': {
        if (e.seat) clock.delete(e.seat);
        if (e.secret) { await refresh(); if (viewPly === null) renderAll(); break; } // 对玩家隐藏的一步（别人的夜间行动）
        if (waitingHuman === e.seat) waitingHuman = null;
        const p = partials.get(e.seat);
        turns.set(e.ply, {
          ply: e.ply, seat: e.seat, character_id: e.characterId, action: e.action, label: e.label,
          analysis: e.analysis, reasoning: d.options?.hideThoughts ? null : p?.reasoning || null,
          self_winrate: e.selfWinrate, latency_ms: e.latency, usage: e.usage, attempts: p?.attempts || [], eval: turns.get(e.ply)?.eval || null,
        });
        partials.delete(e.seat);
        if (Array.isArray(d.record?.actions)) d.record.actions.push({ seat: e.seat, action: e.action });
        if (e.view) d.view = e.view;
        else await refresh();
        if (viewPly === null) { renderAll(); stampFx(stampFor(e.label, d.view)); }
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
          if (card) card.replaceWith(thoughtCard(t));
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
        if (!recordMode) toast(resultText(d, d.seatNames));
        if (d.status === 'finished') stampFx(d.result?.ranks && Object.values(d.result.ranks).every((r) => r === 1) ? '和' : '终', true);
        break;
    }
  });
  // ---------- 键盘 ----------
  // ← → 单步，Home / End 回到开头、最新，空格 播放/暂停回放，F 翻转棋盘。轮到自己出手、或在输入框里打字时不抢键
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
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
    else used = false;
    if (used) e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  return () => { document.removeEventListener('keydown', onKey); stop(); stopReplay(); fold?.destroy(); document.body.classList.remove('record-mode'); };
}
