// 大厅：一进来就能看到最精彩的一盘（今日擂台）、场上在发生什么（对局墙）、一键开一盘（快速开始）。

import { h, api, post, guard, toast, listen, fmtTime, MODE_NAMES, resultText, emptyState, linkRow, pressed, cleanName, summarizeSeats, coin, pageHead } from './ui.js';
import { loadRenderer } from '../stage/index.js';

// 各游戏的画面模块：用到哪个取哪个，几个一起取；大厅先把文字画出来，缩略画面等模块到了再补上
const renderers = {};
const loading = {};
const loadGame = (game) => (loading[game] ||= loadRenderer(game).then((r) => { renderers[game] = r; return r; }).catch(() => null));
const preload = (list) => Promise.all([...new Set(list.map((m) => m.game))].map(loadGame));

const who = (p) => (p?.kind === 'model' ? p.model : p?.kind === 'agent' ? '自带 Agent' : p?.kind === 'human' ? '真人' : p?.kind === 'builtin' ? '内置 AI' : p?.kind === 'engine' ? ({ pikafish: 'Pikafish', rapfi: 'Rapfi', stockfish: 'Stockfish' }[p.provider || 'pikafish'] || '引擎') : '随机');
const HOT_RE = /炸弹|王炸|全下|将军|将死|\+|绝杀|出局|死亡|背叛|春天/;
const SORTS = [['hot', '最精彩'], ['new', '最新'], ['tier', '排位优先']];
let hasCricket = false; // 这位用户养没养过蛐蛐（大厅「快速开始」第一项用）
/** 隐藏信息游戏（斗地主、德州、狼人杀、卧底…）没有公开的着法，用当前阶段说明进度 */
function phaseOf(v) {
  if (!v) return '';
  if (v.handNo) return `第 ${v.handNo}${v.hands ? `/${v.hands}` : ''} 手${v.streetName ? ` · ${v.streetName}` : ''}`;
  if (v.day) return `第 ${v.day} ${v.night ? '夜' : '天'}${v.phaseName ? ` · ${v.phaseName}` : ''}`;
  if (v.phase === 'bid') return '叫地主';
  if (v.trickNo) return `第 ${v.trickNo} 轮`;
  if (v.round) return `第 ${v.round} 轮`;
  return '';
}
/** 进度：第 N 手 · 刚走的着法；还没走过就是「等待第一手」 */
const progress = (m) => (m.lastLabel ? `第 ${m.plies} 手 · ${m.lastLabel}` : phaseOf(m.view) || (m.plies ? `第 ${m.plies} 手` : '等待第一手'));
const nm = (p) => cleanName(p?.name);
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem(`lobby.${k}`); localStorage.setItem(`lobby.${k}`, v); } catch { /* 本机存不了就算了 */ } return null; };

/** 精彩程度：有高光、在思考、胜率胶着、排位赛 */
function heat(m) {
  let s = 0;
  if (m.hot) s += 5;
  if (m.thinking && !m.paused) s += 1;
  if (m.redE !== null && m.redE !== undefined) s += 2 * (1 - Math.abs(m.redE - 0.5) * 2);
  if (m.mode !== 'casual') s += 1.5;
  s += Math.min(2, m.plies / 40);
  return s;
}

export async function lobbyView(root, { go, session, meta, early }) {
  // early：首屏时入口已经提前发出的大厅请求（和登录状态一起取，少等一个来回）
  let [data, rooms] = await Promise.all([early ? early.then((d) => d || api('/lobby')) : api('/lobby'), api('/rooms').catch(() => [])]);
  preload(data.live);
  const guest = !session.user;
  const cards = new Map();
  let stopEvents = null;
  let noCricket = false;
  let filter = pref('game') || 'all';
  let sort = pref('sort') || 'hot';
  let online = []; // 在线的真人玩家（只给登录用户看）
  const onlineBox = h('div');

  const hero = h('section', { class: 'card framed hero' });
  const side = h('aside', { class: 'col' });
  const filters = h('div', { class: 'filters' });
  const grid = h('div', { class: 'mgrid' });
  const roomBox = h('div');
  const recent = h('div');

  // 游客第一眼先知道这是什么地方、下一步做什么；登录后不占地方（标题只留给读屏）
  const intro = guest
    ? pageHead('看 AI 斗蛐蛐', '各家大模型在这里下棋、打牌、玩狼人杀。看它们怎么想，谁更会赢。', '斗',
      h('a', { class: 'btn primary', href: '#/register' }, '申请入场'), h('a', { class: 'btn', href: '#/login' }, '登录'))
    : h('h1', { class: 'sr-only' }, '大厅');
  if (guest) intro.classList.add('lobby-intro');
  root.replaceChildren(intro, h('div', { class: 'lobby' },
    h('div', { class: 'col', style: { minWidth: 0, gap: '0' } }, hero, roomBox, filters, grid,
      h('section', { class: 'section-gap' }, h('div', { class: 'section-title' }, h('h2', {}, '最近结束'), h('a', { href: '#/history', class: 'small' }, '全部对局 →')), recent)),
    side));

  // ---------- 今日擂台 ----------
  function drawHero() {
    // 擂台只推荐真在打的局：AI 对 AI、走了至少 10 步、没暂停、10 分钟内动过；都不满足才退而求其次
    const fresh = (x) => !x.humanWaiting && !x.paused && (x.plies || 0) >= 10 && Date.now() - new Date(x.lastAt || 0).getTime() < 10 * 60e3;
    const pool = data.live.filter(fresh);
    const moving = data.live.filter((x) => !x.humanWaiting);
    // 场上只剩等真人出手的局时也推一盘出来：下面的对局墙明明有对局，擂台不能写「没有对局」
    const pick = [...(pool.length ? pool : moving.length ? moving : data.live)].sort((a, b) => heat(b) - heat(a))[0];
    if (!pick) {
      const last = data.recent[0];
      hero.replaceChildren(h('div', { class: 'lattice' }), h('span', { class: 'wm' }, '斗'),
        h('span', { class: 'hero-tag' }, '今日擂台 · 虚位以待'),
        h('div', { class: 'hero-mid', style: { justifySelf: 'center' } },
          h('div', { class: 'vs' }, '擂台空着'),
          h('div', { class: 'state' }, guest ? '现在没有对局。' : '现在没有对局。开一盘、组个局，或者打开天梯自动匹配。'),
          h('div', { class: 'row', style: { justifyContent: 'center' } },
            guest ? null : [quickAiMatch(true), h('a', { class: 'btn', href: '#/rooms' }, '去组局')],
            last ? h('a', { class: `btn ${guest ? 'primary' : 'ghost'}`, href: `#/match/${last.id}` }, '看上一盘回放') : null)));
      return;
    }
    const seats = Object.keys(pick.players);
    const two = seats.length === 2;
    const P = (s) => h('div', { class: 'hero-p' }, coin(pick.players[s], 'moon'), h('b', { class: 'gold-text' }, nm(pick.players[s])), h('small', {}, `${pick.seatNames?.[s] || s} · ${who(pick.players[s])}`));
    const e = pick.redE ?? 0.5;
    const tug = pick.features?.winbar ? h('div', { class: 'tug' }, h('span', {}, `${Math.round(e * 100)}%`), h('div', { class: 'bar' }, h('i', { class: 'l', style: { width: `${e * 100}%` } }), h('i', { class: 'r' }), h('span', { class: 'knot', style: { left: `${e * 100}%` } })), h('span', {}, `${100 - Math.round(e * 100)}%`)) : null;
    const reason = pick.humanWaiting ? '等真人出手' : pick.hot ? '高光时刻' : pick.redE !== null && pick.redE !== undefined && Math.abs(pick.redE - 0.5) < 0.12 ? '胜率胶着' : pick.mode !== 'casual' ? '排位进行中' : '正在进行';
    hero.replaceChildren(h('div', { class: 'lattice' }), h('span', { class: 'wm' }, '擂'),
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'hero-tag' }, `今日擂台 · ${reason}`), h('span', { class: 'small muted' }, `${pick.gameName} · ${MODE_NAMES[pick.mode]}${pick.lastLabel || !phaseOf(pick.view) ? (pick.plies ? ` · 第 ${pick.plies} 手` : '') : ` · ${phaseOf(pick.view)}`}`)),
      two
        ? h('div', { class: 'hero-vs' }, P(seats[0]), h('div', { class: 'hero-mid' }, h('div', { class: 'vs' }, '对'), tug, h('div', { class: 'state' }, pick.lastLabel ? ['刚走 ', h('b', {}, pick.lastLabel)] : phaseOf(pick.view) || (pick.plies ? `第 ${pick.plies} 手` : '等待第一手'), pick.thinking ? ` · ${pick.seatNames?.[pick.thinking] || ''}思考中` : ''), h('a', { class: 'btn primary', href: `#/match/${pick.id}` }, '进入观战')), P(seats[1]))
        : h('div', { class: 'hero-mid', style: { justifySelf: 'stretch' } },
          h('div', { class: 'hero-many' }, ...seats.map((s) => h('div', { class: 'hero-p', title: nm(pick.players[s]) }, coin(pick.players[s], 'hero-sm'), h('small', {}, nm(pick.players[s]))))),
          h('div', { class: 'state' }, pick.lastLabel ? ['最新：', h('b', {}, pick.lastLabel)] : phaseOf(pick.view) || (pick.plies ? `第 ${pick.plies} 手` : '等待第一手')),
          h('a', { class: 'btn primary', href: `#/match/${pick.id}` }, '进入观战')));
  }

  /** 快速开始：随机挑两名系统选手和一个双人游戏，开一盘娱乐赛直接观战 */
  function quickAiMatch(primary = false) {
    return h('button', { class: `btn ${primary ? 'primary' : ''}`, onclick: guard(async () => {
      if (!session.user) { go('#/login'); return; }
      const chars = await api('/characters');
      const games = meta.games.filter((g) => g.players.min === 2);
      for (let tries = 0; tries < 10; tries++) {
        const g = games[Math.floor(Math.random() * games.length)];
        const pool = chars.filter((c) => c.system && c.kind !== 'human' && (c.kind !== 'engine' || (c.provider || 'pikafish') === g.features?.evalEngine));
        if (pool.length < 2) continue;
        const a = pool[Math.floor(Math.random() * pool.length)];
        const b = pool.filter((c) => c.id !== a.id)[Math.floor(Math.random() * (pool.length - 1))];
        const seats = Object.fromEntries(g.seats.map((s, i) => [s, (i ? b : a).id]));
        const r = await post('/matches', { game: g.id, seats, mode: 'casual' });
        go(`#/match/${r.id}`);
        return;
      }
      toast('没有能凑成一盘的选手', true);
    }) }, '看一盘 AI 对决');
  }

  // ---------- 右栏 ----------
  function drawSide() {
    side.replaceChildren(
      h('div', { class: 'figs' },
        ...[[data.live.length, '进行中'], [data.today, '今日开局'], [data.rooms, '等人组局'], [data.total, '累计完赛']].map(([n, l]) => h('div', { class: 'card quiet fig' }, h('b', { class: 'gold-text' }, n), h('small', {}, l)))),
      // 快速开始里的事都要登录；游客的入口在页头（申请入场、登录）
      guest ? null : h('div', { class: 'card pad col', style: { gap: '12px' } }, h('div', { class: 'label' }, '快速开始'),
        // 还没养过蛐蛐的新人：第一件事是养一只
        h('div', { class: 'quick' }, noCricket ? h('a', { class: 'btn primary', href: '#/characters' }, '养第一只蛐蛐') : null, quickAiMatch(!noCricket),
          h('a', { class: 'btn', href: '#/new' }, '我来挑战一只蛐蛐'),
          h('a', { class: 'btn', href: '#/rooms' }, '开一个组局'),
          h('a', { class: 'btn', href: '#/agent-guide' }, '让我的 Agent 上场'))),
      onlineBox,
      data.tops.length ? h('div', { class: 'card quiet pad col', style: { gap: '8px' } }, h('div', { class: 'label' }, '天梯榜首'),
        h('div', { class: 'side-list' }, ...data.tops.slice(0, 6).map((t) => h('a', { class: 'it', href: `#/characters/${t.id}` }, h('span', { class: 'k' }, t.gameName), h('span', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap', minWidth: 0 } }, coin(t, 'sm'), h('b', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, cleanName(t.name))), h('span', { class: 'num' }, t.points))))) : null,
      data.log.length ? h('div', { class: 'card quiet pad col', style: { gap: '8px' } }, h('div', { class: 'label' }, '动态'),
        h('div', { class: 'feed' }, ...data.log.map((x) => h('div', { class: /晋级|王者|连胜|爆冷/.test(x.text) ? 'hot' : '' }, x.text)))) : null);
  }

  // ---------- 在线玩家 ----------
  function drawOnline() {
    const others = online.filter((u) => !u.me);
    onlineBox.replaceChildren(guest ? '' : h('div', { class: 'card quiet pad col', style: { gap: '8px' } },
      h('div', { class: 'label' }, `在线玩家 · ${others.length}`),
      others.length
        ? h('ul', { class: 'online-list' }, ...others.slice(0, 12).map((u) => h('li', {}, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'nm' }, u.name),
          u.playing ? h('a', { class: 'small', href: `#/match/${u.playing.matchId}` }, `${u.playing.gameName}对局中`) : h('small', { class: 'muted' }, '空闲'))))
        : h('div', { class: 'small muted' }, '现在只有你在线。'),
      others.length ? h('a', { class: 'small', href: '#/rooms' }, '开一个组局，就能邀请他们来 →') : null));
  }
  async function loadOnline() {
    if (guest) return;
    try { online = await api('/online'); } catch { online = []; }
    if (root.isConnected) drawOnline();
  }

  // ---------- 等人入座的组局 ----------
  function drawRooms() {
    roomBox.replaceChildren(rooms.length ? h('section', { style: { marginTop: 'var(--s5)' } },
      h('div', { class: 'section-title' }, h('h2', {}, '等人入座的组局'), h('a', { href: '#/rooms', class: 'small' }, '全部组局 →')),
      h('div', { class: 'rooms' }, ...rooms.slice(0, 3).map((r) => h('a', { class: 'card room', href: `#/room/${r.id}` },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 't' }, r.title), h('span', { class: 'chip' }, r.gameName)),
        h('div', { class: 'slots' }, ...Object.values(r.seats).map((s) => s ? Object.assign(coin(s.character, 'sm'), { title: cleanName(s.character.name) }) : h('span', { class: 'slot-dot' }, '＋'))),
        h('div', { class: 'small muted' }, `${r.filled}/${r.players} 人 · 房主 ${r.host?.name || '—'}`))))) : null);
  }

  // ---------- 对局墙 ----------
  function drawFilters() {
    const count = (id) => data.live.filter((m) => m.game === id).length;
    // 记住的筛选在场上已经没有对局时也留着这颗胶囊（显示 0），空状态里给「看全部」
    const games = meta.games.filter((g) => count(g.id) || g.id === filter);
    filters.replaceChildren(
      h('div', { class: 'pills', role: 'group', 'aria-label': '按游戏筛选' },
        h('button', { class: `pill ${filter === 'all' ? 'on' : ''}`, type: 'button', ...pressed(filter === 'all'), onclick: () => setFilter('all') }, `全部 ${data.live.length}`),
        ...games.map((g) => h('button', { class: `pill ${filter === g.id ? 'on' : ''}`, type: 'button', ...pressed(filter === g.id), onclick: () => setFilter(g.id) }, `${g.name} ${count(g.id)}`))),
      h('span', { class: 'grow' }),
      h('select', { style: { width: 'auto' }, 'aria-label': '排序', onchange: (e) => { sort = e.target.value; pref('sort', sort); drawGrid(); } }, ...SORTS.map(([k, l]) => h('option', { value: k, selected: sort === k }, `排序：${l}`))));
  }
  function setFilter(id) { filter = id; pref('game', id); drawFilters(); drawGrid(); }

  function card(m) {
    const head = h('div', { class: 'g' });
    const hl = h('div', { class: 'hl' });
    const sub = h('div', { class: 'sub' });
    const whoRow = h('div', { class: 'who' });
    const wrap = h('div', { class: 'board-wrap', style: { width: '100%', height: '100%' } }, h('i', { class: 'sk mthumb-sk' }));
    // 缩略画面只是一张图：整块不接受点击和焦点（画面里的小按钮不该出现在一个链接里面），读屏也跳过
    const el = h('a', { class: 'card mcard', href: `#/match/${m.id}`, style: { gridTemplateColumns: '1fr' } },
      head, h('div', { class: 'mthumb', inert: true, 'aria-hidden': 'true', style: { width: '100%', height: '200px' } }, wrap), hl, whoRow, sub);
    // 闪一下金边（新的一步）：动画演完自己摘掉类名，不用「删类名 → 读 offsetWidth → 加类名」逼浏览器排版
    el.addEventListener('animationend', (e) => { if (e.animationName === 'flash') el.classList.remove('flash'); });
    // dirty：有没画上去的变化；thumb：缩略画面也要重画；shown：画过缩略画面；visible：在屏幕附近
    const c = { el, wrap, stage: null, head, hl, sub, whoRow, m, dirty: false, thumb: true, anim: false, flash: false, shown: false, visible: false };
    paintText(c);
    // 画面模块还没到：先出文字，到了再把缩略画面补上
    if (!mount(c)) loadGame(m.game).then(() => { if (cards.get(m.id) === c && mount(c)) queue(c); });
    queue(c);
    return c;
  }
  /** 给卡片装上缩略画面（模块已经加载时）；返回装没装上 */
  function mount(c) {
    if (c.stage) return true;
    const r = renderers[c.m.game];
    if (!r) return false;
    try { c.stage = r.createStage({ onAction: () => {} }); } catch { return false; }
    c.wrap.replaceChildren(c.stage.el);
    return true;
  }

  /** 卡片上的文字（便宜）：标题、思考中、进度、选手 */
  function paintText(c) {
    const m = c.m;
    c.el.classList.toggle('hot', !!m.hot);
    c.head.replaceChildren(h('span', {}, m.gameName, h('span', { class: 'small muted', style: { marginLeft: '8px', fontFamily: 'var(--sans)', fontWeight: 400 } }, MODE_NAMES[m.mode])),
      m.paused ? h('span', { class: 'small muted' }, '已暂停') : m.thinking ? h('span', { class: 'thinking-dot' }, `${m.seatNames?.[m.thinking] || ''}思考中`) : null);
    c.hl.textContent = progress(m);
    const seats = Object.keys(m.players);
    // 两人局写「甲 对 乙」；多人局头像已经排了一排，后面只写人数——名单放不下，截成「6 人 · 庄家 +…」反而像坏了，全名在悬停里
    const names = seats.map((s) => m.players[s]?.name);
    c.whoRow.replaceChildren(...seats.slice(0, 6).map((s) => Object.assign(coin(m.players[s]), { title: nm(m.players[s]) })),
      h('span', { title: names.map(cleanName).join('、') }, seats.length === 2 ? summarizeSeats(names) : `${seats.length} 人`));
    c.sub.textContent = `开局 ${fmtTime(m.started_at)}`;
    // 读屏读到的是一句整话，不是卡片里各块文字拼在一起
    c.el.setAttribute('aria-label', `${m.gameName} ${MODE_NAMES[m.mode] || ''}：${summarizeSeats(names, { max: 4 })}，${m.paused ? '已暂停' : progress(m)}`);
  }

  // 场上对局多时每个事件都重画缩略画面会把大厅卡死：变化先记下，攒到一起每秒画一次（所有卡合在同一帧里画，
  // 排版、分层这些整页的开销一秒只付一次）；只画在屏幕附近的卡（IntersectionObserver）。新卡、刚滚进来的卡马上画
  const PAINT_GAP = 1000;
  const due = new Set();
  let paintRaf = 0, tick = 0, tickAt = 0, lastFlush = -Infinity;
  const byEl = new WeakMap();
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => {
    for (const e of es) {
      const c = byEl.get(e.target);
      if (!c) continue;
      c.visible = e.isIntersecting;
      if (c.visible && c.dirty) queue(c, { thumb: false });
    }
  }, { rootMargin: '300px 0px' }) : null;
  function queue(c, { thumb = true, anim = false, flash = false } = {}) {
    c.dirty = true;
    c.thumb ||= thumb;
    c.anim ||= anim;
    c.flash ||= flash;
    if (!byEl.has(c.el)) { byEl.set(c.el, c); if (io) io.observe(c.el); else c.visible = true; }
    if (!c.visible) return;
    due.add(c);
    if (paintRaf) return;
    const now = performance.now();
    const at = c.shown ? Math.max(now, lastFlush + PAINT_GAP) : now; // 还没画过的卡不等
    if (tick && tickAt <= at) return;
    clearTimeout(tick);
    tickAt = at;
    tick = setTimeout(() => { tick = 0; paintRaf = requestAnimationFrame(flushPaints); }, at - now);
  }
  // 一帧里最多画 3 张缩略画面，剩下的接着下一帧画：一次全画完那一帧会很长
  const PER_FRAME = 3;
  function flushPaints() {
    paintRaf = 0;
    lastFlush = performance.now();
    const list = [...due].slice(0, PER_FRAME);
    for (const c of list) due.delete(c);
    if (due.size) paintRaf = requestAnimationFrame(flushPaints);
    for (const c of list) {
      if (!c.dirty || !c.visible || !c.el.isConnected) continue;
      c.dirty = false;
      c.shown = true;
      if (c.thumb && c.stage) { try { c.stage.render(c.m.view, { movable: null, arrows: [], animate: c.anim }); } catch { /* 缩略画面画不出来时不影响卡片 */ } }
      paintText(c);
      if (c.flash) c.el.classList.add('flash');
      c.thumb = !c.stage; // 画面模块还没到的，记着等它到了再画
      c.anim = c.flash = false;
    }
  }
  const dropCard = (c) => { due.delete(c); io?.unobserve(c.el); byEl.delete(c.el); };

  function drawGrid() {
    const ids = new Set(data.live.map((m) => m.id));
    for (const [id, c] of [...cards]) if (!ids.has(id)) { dropCard(c); cards.delete(id); }
    let list = data.live.filter((m) => filter === 'all' || m.game === filter);
    list = sort === 'new' ? list.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
      : sort === 'tier' ? list.sort((a, b) => (b.mode !== 'casual') - (a.mode !== 'casual') || heat(b) - heat(a))
        : list.sort((a, b) => heat(b) - heat(a));
    if (!list.length) {
      const e = data.live.length
        ? emptyState('这个游戏现在没有对局。', { wm: '静', action: h('button', { class: 'btn primary', type: 'button', onclick: () => setFilter('all') }, '看全部') })
        : emptyState('场上暂时没有对局。', { wm: '静', action: guest ? null : quickAiMatch(true) });
      e.style.gridColumn = '1 / -1';
      grid.replaceChildren(e);
      return;
    }
    grid.replaceChildren(...list.map((m) => {
      let c = cards.get(m.id);
      if (!c) { c = card(m); cards.set(m.id, c); } else { c.m = { ...c.m, ...m, hot: c.m.hot || m.hot }; queue(c); }
      return c.el;
    }));
  }

  function drawRecent() {
    if (!data.recent.length) { recent.replaceChildren(emptyState('还没有结束的对局。', { wm: '局', action: guest ? null : h('a', { class: 'btn primary', href: '#/new' }, '开一局') })); return; }
    recent.replaceChildren(h('div', { class: 'card table-wrap' }, h('table', { class: 'list recent-list' },
      ...data.recent.slice(0, 8).map((m) => {
        const names = Object.values(m.players).map((pl) => pl?.name);
        const who = summarizeSeats(names);
        return linkRow(`#/match/${m.id}`, [
          h('td', { class: 'c-game' }, h('span', { class: 'chip' }, m.gameName)),
          h('td', { class: 'c-players', title: names.map(cleanName).join('、') }, who),
          h('td', { class: 'c-result muted', style: { whiteSpace: 'normal' } }, resultText(m)),
          h('td', { class: 'c-time num muted' }, fmtTime(m.finished_at || m.created_at))], { label: `${m.gameName}：${who}，${resultText(m)}` });
      }))));
  }

  function subscribe() {
    stopEvents?.();
    const chans = ['lobby', ...data.live.map((m) => `match:${m.id}`)];
    stopEvents = listen(chans, (e) => {
      // 思考的流式输出（delta）、无效着法：大厅上不显示，直接丢掉
      if (e.type === 'delta' || e.type === 'illegal') return;
      if (e.ch === 'lobby') {
        if (e.type === 'presence') { loadOnline(); return; }
        if (e.type === 'match_created' || e.type === 'match_finished' || e.type === 'room_updated') reload();
        return;
      }
      const id = e.ch.slice(6);
      const c = cards.get(id);
      if (!c) return;
      if (e.type === 'turn_start') { c.m.thinking = e.seat; queue(c, { thumb: false }); }
      else if (e.type === 'move') {
        if (!e.view) { reload(); return; }
        Object.assign(c.m, { view: e.view, lastMove: e.action, lastLabel: e.label, plies: e.ply, thinking: null });
        if (e.label && HOT_RE.test(e.label)) c.m.hot = true;
        queue(c, { anim: true, flash: true });
      } else if (e.type === 'eval') {
        if (e.eval?.quality?.tag === '大漏着') c.m.hot = true;
        if (e.eval?.redE !== undefined) c.m.redE = e.eval.redE;
        queue(c, { thumb: false });
      } else if (e.type === 'control') { c.m.paused = e.paused; queue(c, { thumb: false }); }
      else if (e.type === 'end') reload();
    });
  }
  let reloading = null;
  async function reload() {
    if (reloading) return;
    reloading = setTimeout(async () => {
      reloading = null;
      [data, rooms] = await Promise.all([api('/lobby'), api('/rooms').catch(() => [])]);
      preload(data.live);
      drawAll();
      subscribe();
    }, 400);
  }

  function drawAll() { drawHero(); drawSide(); drawRooms(); drawFilters(); drawGrid(); drawRecent(); }
  drawAll();
  subscribe();
  loadOnline();
  // 画完再问一句「我有没有蛐蛐」（不挡首屏）：没有的话，快速开始第一项换成「养第一只蛐蛐」
  // 已经知道养过了就不再问（这个标签页里只问到「有」为止）
  if (!guest && !hasCricket) api('/characters').then((list) => { hasCricket = list.some((c) => c.mine && !c.system && c.kind !== 'human'); noCricket = !hasCricket; if (noCricket && root.isConnected) drawSide(); }).catch(() => {});
  return () => { stopEvents?.(); clearTimeout(reloading); io?.disconnect(); cancelAnimationFrame(paintRaf); clearTimeout(tick); };
}
