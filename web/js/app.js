// 前端入口：登录状态、按地址栏 hash 切换页面。

import { h, api, toast, listen, icon, dialog, setTitle, connectionOk, emptyState } from './ui.js';
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
const TITLES = { lobby: '大厅', rooms: '组局', room: '组局', new: '开局', characters: '蛐蛐', ladder: '天梯', history: '对局记录', compare: '同题对比', settings: '设置', account: '我的账号', admin: '审批', login: '登录', register: '申请注册', 'agent-guide': 'Agent 接入说明', match: '对局' };
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
  try {
    const characters = loggedIn && ['new', 'match', 'compare', 'room'].includes(page) ? await api('/characters') : [];
    const ctx = { meta, characters, go, reloadMeta, session, reloadSession };
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
    // 换页：新页面的前几块依次浮上来；动画放完就摘掉，页面自己刷新内容时不再重播
    app.classList.remove('page-in');
    void app.offsetWidth;
    app.classList.add('page-in');
    clearTimeout(pageInTimer);
    pageInTimer = setTimeout(() => app.classList.remove('page-in'), 500);
  } catch (e) {
    if (seq !== routeSeq) return;
    app.replaceChildren(emptyState(e.message, { wm: '误', action: h('button', { class: 'btn primary', type: 'button', onclick: () => route() }, '重试') }));
    toast(e.message, true);
  } finally {
    if (seq === routeSeq) loadingEnd();
  }
}

// ---------- 顶栏右侧：登录用户 / 登录按钮；庄家的审批角标 ----------
const userBox = document.getElementById('userBox');
const navAdmin = document.getElementById('navAdmin');
const pendingBadge = document.getElementById('pendingBadge');
const moreBadge = document.getElementById('moreBadge');
function paintUser() {
  const u = session.user;
  userBox.replaceChildren(u
    ? h('a', { class: 'user-chip', href: '#/account', title: '我的账号', 'aria-label': `我的账号：${u.name || u.username}` }, h('span', { class: 'coin' }, (u.name || u.username).slice(0, 1)), h('span', { class: 'user-name' }, u.name || u.username))
    : h('a', { class: 'btn sm primary', href: '#/login' }, '登录'));
  // 用 style.display 控制显示：.nav a 的 display:flex 会盖过 hidden 属性
  navAdmin.hidden = u?.role !== 'admin';
  navAdmin.style.display = u?.role === 'admin' ? '' : 'none';
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
const TAB_ICONS = { lobby: 'home', rooms: 'users', characters: 'cricket', ladder: 'trophy', more: 'menu' };
for (const el of document.querySelectorAll('#tabbar [data-r]')) el.prepend(icon(TAB_ICONS[el.dataset.r], 22));
document.getElementById('moreBtn').addEventListener('click', () => {
  const u = session.user;
  const item = (href, ic, label, extra = null) => h('a', { class: 'sheet-item', href }, icon(ic, 20), h('span', {}, label), extra);
  const dlg = dialog('更多', h('nav', { class: 'sheet-list', 'aria-label': '更多栏目' },
    item('#/new', 'swords', '开局'),
    item('#/history', 'history', '对局记录'),
    u ? item('#/settings', 'settings', '设置') : null,
    u?.role === 'admin' ? item('#/admin', 'shield', '审批', session.pending ? h('span', { class: 'badge' }, session.pending) : null) : null,
    item('#/agent-guide', 'link', 'Agent 接入说明'),
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
addEventListener('dsqq:conn', (e) => { paintDot(); if (e.detail.ok) refreshLive(); });

try {
  await Promise.all([reloadSession(), reloadMeta()]);
} catch (e) {
  app.replaceChildren(emptyState(`连不上服务器：${e.message}`, { wm: '断', action: h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, '重新加载') }));
  throw e;
}
refreshLive();
if (session.user || session.publicView) listen(['lobby'], (e) => { if (e.type === 'match_created' || e.type === 'match_finished') refreshLive(); });
// 庄家：有新的注册申请时角标 +1
if (session.user?.role === 'admin') listen(['admin'], (e) => { if (e.type === 'registration' || e.type === 'user_updated') reloadSession(); });
// 离开前记下旧地址的滚动位置（页面里用 replaceState 改过的查询参数也算在旧地址上）
window.addEventListener('hashchange', (e) => { saveScroll(new URL(e.oldURL).hash || '#/'); route(); });
route();
