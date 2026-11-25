// 前端入口：登录状态、按地址栏 hash 切换页面。

import { h, api, post, guard, listen, icon, dialog, setTitle, connectionOk, emptyState, coin, toast } from './ui.js';
import { nudgeTurn } from './sound.js';
import { playView } from './play.js';
import { lobbyView } from './lobby.js';
import { matchView } from './match.js';
import { charactersView, profileView } from './characters.js';
import { ladderView } from './ladder.js';
import { compareNewView, compareView } from './compare.js';
import { historyView, settingsView } from './pages.js';
import { agentGuideView } from './agent-guide.js';
import { loginView, registerView, accountView, adminView } from './auth.js';
import { roomsView, roomView } from './rooms.js';

const app = document.getElementById('app');
const meta = {};
const session = { user: null, pending: 0, publicView: true };
let cleanup = null;
let pageInTimer = null;
let routed = false;
const announcer = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
document.body.append(announcer);
let routeSeq = 0; // 换页很快时，前一页还在加载：加载完发现已经不是当前页，就把它的监听关掉、不画
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

async function reloadMeta() {
  Object.assign(meta, await api('/meta'));
  return meta;
}

async function reloadSession() {
  Object.assign(session, await api('/auth/me'));
  paintUser();
  return session;
}

const go = (hash) => { location.hash = hash; };

// 需要登录才能打开的页面；游客打开时先去登录，登录后回来
const NEED_LOGIN = new Set(['new', 'settings', 'account', 'admin']);
const PUBLIC_PAGES = new Set(['login', 'register']);
// 导航高亮：对局页不属于任何一个栏目
const NAV_KEY = { lobby: 'lobby', new: 'play', match: '', rooms: 'rooms', room: 'rooms', characters: 'characters', ladder: 'ladder', compare: 'history', history: 'history', settings: 'settings', account: 'settings', admin: 'admin', 'agent-guide': 'characters', login: '', register: '' };
// 默认页面标题；页面自己知道更具体的名字时（天梯的游戏、选手名字）会再改
const TITLES = { lobby: '大厅', rooms: '组局', room: '组局', new: '开局', characters: '蛐蛐', ladder: '天梯', history: '对局记录', compare: '同题对比', settings: '设置', account: '我的账号', admin: '审批', login: '登录', register: '申请注册', 'agent-guide': 'Agent 接入', match: '对局' };
// 手机底栏「更多」里收着的栏目
const MORE_KEYS = new Set(['play', 'history', 'settings', 'admin']);

// ---------- 换页进度条：加载超过 150ms 才出现，出现后至少停 300ms，不一闪而过 ----------
const bar = document.getElementById('routeBar');
let barTimer = null;
let barShownAt = 0;
function loadingStart() {
  clearTimeout(barTimer);
  if (barShownAt) return; // 上一页的进度条还在，接着走
  barTimer = setTimeout(() => {
    barShownAt = performance.now();
    bar.classList.remove('done');
    void bar.offsetWidth;
    bar.classList.add('on');
    app.setAttribute('aria-busy', 'true');
  }, 150);
}
function loadingEnd() {
  clearTimeout(barTimer);
  app.removeAttribute('aria-busy');
  if (!barShownAt) return;
  const wait = Math.max(0, 300 - (performance.now() - barShownAt));
  barTimer = setTimeout(() => {
    barShownAt = 0;
    bar.classList.replace('on', 'done');
    barTimer = setTimeout(() => bar.classList.remove('done'), 420);
  }, wait);
}

// ---------- 滚动位置：每个地址记一份；后退、前进回到原处，点链接进来从顶上开始 ----------
const SCROLL_KEY = 'dsqq.scroll';
let navType = 'push';
window.navigation?.addEventListener('navigate', (e) => { navType = e.navigationType; });
const scrollMap = () => { try { return JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}'); } catch { return {}; } };
let currentKey = location.hash || '#/';
function saveScroll(key = currentKey) {
  try {
    const m = scrollMap();
    m[key] = Math.round(scrollY);
    const keys = Object.keys(m);
    if (keys.length > 60) delete m[keys[0]];
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(m));
  } catch { /* 存不了就算了 */ }
}
function restoreScroll(key) {
  const y = navType === 'traverse' ? scrollMap()[key] : 0;
  navType = 'push';
  if (!y) { window.scrollTo(0, 0); return; }
  requestAnimationFrame(() => window.scrollTo(0, y));
}
addEventListener('pagehide', () => saveScroll(location.hash || '#/'));

async function route() {
  const seq = ++routeSeq;
  clearTimeout(slowTimer);
  hideSlow();
  currentKey = location.hash || '#/';
  cleanup?.();
  cleanup = null;
  // 换页时关掉弹窗；接入令牌弹窗（只显示一次）除外，要用户确认保存后自己关
  document.querySelectorAll('dialog[open]:not([data-keep])').forEach((d) => d.close());
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const [page = 'lobby', id] = parts;
  const navKey = NAV_KEY[page] ?? 'lobby';
  for (const a of document.querySelectorAll('#nav a, #tabbar [data-r]')) {
    const on = a.dataset.r === navKey || (a.dataset.r === 'more' && MORE_KEYS.has(navKey));
    a.classList.toggle('on', on);
    if (on && a.tagName === 'A') a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.body.dataset.page = page === 'match' && id ? 'match' : page;
  setTitle(TITLES[page] || '大厅');
  const loggedIn = !!session.user;
  if (!loggedIn && !PUBLIC_PAGES.has(page) && (NEED_LOGIN.has(page) || !session.publicView)) {
    go(`#/login?next=${encodeURIComponent(location.hash)}`);
    return;
  }
  if (page === 'admin' && session.user?.role !== 'admin') { go('#/'); return; }
  loadingStart();
  // 8 秒还没加载完：右下角给一个「加载较慢 · 重试」，不让人对着半透明的旧页面干等
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { if (seq === routeSeq) showSlow(); }, 8000);
  try {
    const characters = loggedIn && ['new', 'match', 'compare', 'room'].includes(page) ? await api('/characters') : [];
    const ctx = { meta, characters, go, reloadMeta, session, reloadSession, early: page === 'lobby' ? earlyLobby : null };
    earlyLobby = null;
    let r;
    if (page === 'match' && id) r = await matchView(app, id, ctx);
    else if (page === 'characters' && id) r = await profileView(app, id, ctx);
    else if (page === 'characters') r = await charactersView(app, ctx);
    else if (page === 'ladder') r = await ladderView(app, ctx);
    else if (page === 'compare' && id) r = await compareView(app, id, ctx);
    else if (page === 'compare') r = await compareNewView(app, ctx);
    else if (page === 'history') r = await historyView(app, ctx);
    else if (page === 'settings') r = await settingsView(app, ctx);
    else if (page === 'new') r = await playView(app, ctx);
    else if (page === 'agent-guide') r = await agentGuideView(app, ctx);
    else if (page === 'rooms') r = await roomsView(app, ctx);
    else if (page === 'room' && id) r = await roomView(app, id, ctx);
    else if (page === 'login') r = await loginView(app, ctx);
    else if (page === 'register') r = await registerView(app, ctx);
    else if (page === 'account') r = await accountView(app, ctx);
    else if (page === 'admin') r = await adminView(app, ctx);
    else r = await lobbyView(app, ctx);
    if (seq !== routeSeq) { if (typeof r === 'function') r(); return; }
    cleanup = typeof r === 'function' ? r : null;
    restoreScroll(currentKey);
    // 换页后告诉读屏到了哪一页（页面不整页刷新，读屏自己不知道）；第一页不报，标题本来就会读
    if (routed) announcer.textContent = document.title.split(' — ')[0];
    routed = true;
    // 换页：新页面的前几块依次浮上来；动画放完就摘掉，页面自己刷新内容时不再重播
    app.classList.remove('page-in');
    void app.offsetWidth;
    app.classList.add('page-in');
    clearTimeout(pageInTimer);
    pageInTimer = setTimeout(() => app.classList.remove('page-in'), 500);
  } catch (e) {
    if (seq !== routeSeq) return;
    // 页面本身就显示了原因，不再另弹提示条
    if (e.status === 404 && page === 'room') {
      app.replaceChildren(emptyState('这个组局已关闭或不存在。', { wm: '散', action: h('a', { class: 'btn primary', href: '#/rooms' }, '返回组局') }));
    } else {
      app.replaceChildren(emptyState(e.message, { wm: '误', action: h('button', { class: 'btn primary', type: 'button', onclick: () => route() }, '重试') }));
    }
  } finally {
    if (seq === routeSeq) { loadingEnd(); clearTimeout(slowTimer); hideSlow(); }
  }
}

// 「跳到正文」：页面用 hash 路由，链接不能真的改 hash，直接把焦点交给正文
document.getElementById('skipLink')?.addEventListener('click', (e) => { e.preventDefault(); app.focus(); app.scrollIntoView({ block: 'start' }); });

// ---------- 加载较慢：超过 8 秒给一个重试 ----------
let slowTimer = null;
let slowBox = null;
function showSlow() {
  hideSlow();
  slowBox = h('div', { class: 'slow-note', role: 'status' }, h('span', {}, '加载较慢'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => { hideSlow(); route(); } }, icon('refresh', 14), '重试'));
  document.body.append(slowBox);
}
function hideSlow() { slowBox?.remove(); slowBox = null; }

// ---------- 顶栏右侧：登录用户 / 登录按钮；庄家的审批角标 ----------
const userBox = document.getElementById('userBox');
const navAdmin = document.getElementById('navAdmin');
const pendingBadge = document.getElementById('pendingBadge');
const moreBadge = document.getElementById('moreBadge');
function paintUser() {
  const u = session.user;
  userBox.replaceChildren(u
    ? h('a', { class: 'user-chip', href: '#/account', title: '我的账号', 'aria-label': `我的账号：${u.name || u.username}` }, coin({ name: u.name || u.username, kind: 'human' }), h('span', { class: 'user-name' }, u.name || u.username))
    : h('a', { class: 'btn sm primary', href: '#/login' }, '登录'));
  // 用 style.display 控制显示：.nav a 的 display:flex 会盖过 hidden 属性
  navAdmin.hidden = u?.role !== 'admin';
  navAdmin.style.display = u?.role === 'admin' ? '' : 'none';
  // 游客：要登录才能用的栏目（开局、设置）不放进导航
  for (const a of document.querySelectorAll('#nav [data-r="play"], #nav [data-r="settings"], #tabbar [data-r="play"]')) a.style.display = u ? '' : 'none';
  for (const b of [pendingBadge, moreBadge]) {
    b.hidden = !session.pending;
    b.style.display = session.pending ? '' : 'none';
    b.textContent = String(session.pending || '');
  }
}

// ---------- 深浅色切换：支持视图过渡的浏览器整页交叉淡化 ----------
const themeBtn = document.getElementById('themeBtn');
const isDark = () => document.documentElement.dataset.theme === 'dark';
function paintTheme() {
  themeBtn.replaceChildren(icon(isDark() ? 'sun' : 'moon', 18));
  const label = isDark() ? '切换到浅色' : '切换到深色';
  themeBtn.setAttribute('aria-label', label);
  themeBtn.title = label;
}
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  const apply = () => {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme2', next); } catch { /* 无法保存时只在本次生效 */ }
    paintTheme();
  };
  if (document.startViewTransition && !reduced()) document.startViewTransition(apply);
  else apply();
}
themeBtn.addEventListener('click', toggleTheme);
paintTheme();

// ---------- 手机底栏：大厅、组局、蛐蛐、天梯、更多（弹出其余栏目） ----------
const TAB_ICONS = { lobby: 'home', play: 'swords', rooms: 'users', characters: 'cricket', ladder: 'trophy', more: 'menu' };
for (const el of document.querySelectorAll('#tabbar [data-r]')) el.prepend(icon(TAB_ICONS[el.dataset.r], 22));
document.getElementById('moreBtn').addEventListener('click', () => {
  const u = session.user;
  const item = (href, ic, label, extra = null) => h('a', { class: 'sheet-item', href }, icon(ic, 20), h('span', {}, label), extra);
  const dlg = dialog('更多', h('nav', { class: 'sheet-list', 'aria-label': '更多栏目' },
    null, // 「开局」已经在底栏上
    item('#/history', 'history', '对局记录'),
    u ? item('#/settings', 'settings', '设置') : null,
    u?.role === 'admin' ? item('#/admin', 'shield', '审批', session.pending ? h('span', { class: 'badge' }, session.pending) : null) : null,
    item('#/agent-guide', 'link', 'Agent 接入'),
    u ? item('#/account', 'user', '我的账号') : item('#/login', 'user', '登录'),
    h('button', { class: 'sheet-item', type: 'button', onclick: () => { toggleTheme(); dlg.close(); } }, icon(isDark() ? 'sun' : 'moon', 20), h('span', {}, isDark() ? '换成浅色' : '换成深色'))), [], { className: 'sheet' });
  // 点当前页的链接不会触发换页，也要收起
  dlg.addEventListener('click', (e) => { if (e.target.closest('a.sheet-item')) dlg.close(); });
});

// ---------- 顶栏直播点：进行中的对局数；实时连接断开时显示「重连中」 ----------
const dot = document.getElementById('liveDot');
let liveCount = 0;
function paintDot() {
  const ok = connectionOk();
  dot.classList.toggle('off', !ok);
  dot.title = ok ? '' : '实时连接断开，正在重连';
  dot.replaceChildren(...(!ok ? [h('i'), '重连中…'] : liveCount ? [h('i'), `${liveCount} 盘进行中`] : []));
}
async function refreshLive() {
  try {
    liveCount = (await api('/matches?status=running&limit=50')).length;
  } catch { liveCount = 0; }
  paintDot();
}
addEventListener('dsqq:conn', (e) => { paintDot(); if (e.detail.ok) { refreshLive(); checkMyLive(); } });

// ---------- 断线重连：我坐着的对局还在进行，提醒回去 ----------
// 打开网站、实时连接断开后重新连上时各查一次；正开着那盘对局的页面就不提醒，每盘只提醒一次
const shownLive = new Set();
async function checkMyLive() {
  if (!session.user) return;
  let list = [];
  try { list = await api('/me/live'); } catch { return; }
  for (const x of list) {
    if (shownLive.has(x.matchId) || location.hash.startsWith(`#/match/${x.matchId}`)) continue;
    shownLive.add(x.matchId);
    const why = x.auto === 'offline' ? '，断线期间由系统托管' : x.auto ? '，系统托管中' : x.myTurn ? '，正轮到你' : '';
    toast(h('span', {}, `你有一盘${x.gameName}还在进行${why} `, h('a', { href: `#/match/${x.matchId}` }, '回到对局')), false, { ms: 15000 });
  }
}

// 首屏就是大厅时，大厅的数据和登录状态一起取（少等一个来回）；没有权限看（要登录）时拿到 null，照常走登录
let earlyLobby = /^#?\/?$/.test(location.hash) ? api('/lobby').catch(() => null) : null;
try {
  await Promise.all([reloadSession(), reloadMeta()]);
} catch (e) {
  app.replaceChildren(emptyState(`连不上服务器：${e.message}`, { wm: '断', action: h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, '重新加载') }));
  throw e;
}
refreshLive();
checkMyLive();
if (session.user || session.publicView) listen(['lobby'], (e) => { if (e.type === 'match_created' || e.type === 'match_finished') refreshLive(); });
// 天梯给我匹配到了对局（我开了「参加天梯自动匹配」）：提醒一下、带我进去；不在任何页面上操作到一半时直接跳过去
if (session.user) listen([`user:${session.user.id}`], (e) => {
  if (e.type !== 'invite' || !e.matchId) return;
  nudgeTurn();
  const href = `#/match/${e.matchId}`;
  const busy = /^#\/(match|new|rooms?)(\/|$)/.test(location.hash) && !location.hash.startsWith(href);
  if (!busy) { location.hash = href; return; }
  toast(h('span', {}, `天梯为你匹配到一盘${e.game || ''}排位赛 `, h('a', { href }, '进入对局')));
});
// 组局邀请：弹窗问要不要来，点「加入」就本人入座；正在对局页上不打断，只提示一句
if (session.user) listen([`user:${session.user.id}`], (e) => {
  if (e.type !== 'room_invite' || !e.room) return;
  nudgeTurn();
  const r = e.room;
  const text = `${e.from} 邀请你一起玩${r.gameName}（「${r.title}」，已坐 ${r.filled}/${r.players} 人）`;
  if (/^#\/match\//.test(location.hash)) {
    toast(h('span', {}, `${text} `, h('a', { href: `#/room/${r.id}` }, '去看看')), false, { ms: 15000 });
    return;
  }
  const dlg = dialog('组局邀请', h('p', { class: 'invite-text' }, text), [
    h('button', { class: 'btn', type: 'button', onclick: () => { dlg.close(); post(`/rooms/${r.id}/decline`).catch(() => {}); } }, '不去'),
    h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
      await post(`/rooms/${r.id}/join`);
      dlg.close();
      location.hash = `#/room/${r.id}`;
    }) }, '加入'),
  ]);
  dlg.dataset.keep = '1'; // 点遮罩不关，免得误点就当没看见
});
// 庄家：有新的注册申请时角标 +1
if (session.user?.role === 'admin') listen(['admin'], (e) => { if (e.type === 'registration' || e.type === 'user_updated') reloadSession(); });
// 离开前记下旧地址的滚动位置（页面里用 replaceState 改过的查询参数也算在旧地址上）
window.addEventListener('hashchange', (e) => { saveScroll(new URL(e.oldURL).hash || '#/'); route(); });
route();
