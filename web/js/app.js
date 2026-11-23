// 前端入口：登录状态、按地址栏 hash 切换页面。

import { h, api, toast, listen } from './ui.js';
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

async function route() {
  cleanup?.();
  cleanup = null;
  // 换页时关掉弹窗；接入令牌弹窗（只显示一次）除外，要用户确认保存后自己关
  document.querySelectorAll('dialog[open]:not([data-keep])').forEach((d) => d.close());
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const [page = 'lobby', id] = parts;
  // 对局页不属于任何一个栏目，导航不高亮
  const navKey = { lobby: 'lobby', new: 'play', match: null, rooms: 'rooms', room: 'rooms', characters: 'characters', ladder: 'ladder', compare: 'history', history: 'history', settings: 'settings', account: 'settings', admin: 'admin', 'agent-guide': 'characters' }[page] ?? 'lobby';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === navKey));
  document.body.dataset.page = page === 'match' && id ? 'match' : page;
  const loggedIn = !!session.user;
  if (!loggedIn && !PUBLIC_PAGES.has(page) && (NEED_LOGIN.has(page) || !session.publicView)) {
    go(`#/login?next=${encodeURIComponent(location.hash)}`);
    return;
  }
  if (page === 'admin' && session.user?.role !== 'admin') { go('#/'); return; }
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
    cleanup = typeof r === 'function' ? r : null;
    window.scrollTo(0, 0);
  } catch (e) {
    app.replaceChildren(h('div', { class: 'empty card' }, e.message));
    toast(e.message, true);
  }
}

// 顶栏右侧：登录用户 / 登录按钮；庄家的审批角标
const userBox = document.getElementById('userBox');
const navAdmin = document.getElementById('navAdmin');
const pendingBadge = document.getElementById('pendingBadge');
function paintUser() {
  const u = session.user;
  userBox.replaceChildren(u
    ? h('a', { class: 'user-chip', href: '#/account', title: '我的账号' }, h('span', { class: 'coin' }, (u.name || u.username).slice(0, 1)), h('span', {}, u.name || u.username))
    : h('a', { class: 'btn sm primary', href: '#/login' }, '登录'));
  // 用 style.display 控制显示：.nav a 的 display:flex 会盖过 hidden 属性
  navAdmin.hidden = u?.role !== 'admin';
  navAdmin.style.display = u?.role === 'admin' ? '' : 'none';
  pendingBadge.hidden = !session.pending;
  pendingBadge.style.display = session.pending ? '' : 'none';
  pendingBadge.textContent = String(session.pending || '');
}

// 深浅色切换
const themeBtn = document.getElementById('themeBtn');
const paintTheme = () => { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'; };
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme2', next); } catch { /* 无法保存时只在本次生效 */ }
  paintTheme();
});
paintTheme();

// 顶栏：进行中的对局数
const dot = document.getElementById('liveDot');
async function refreshLive() {
  try {
    const running = await api('/matches?status=running&limit=50');
    dot.innerHTML = running.length ? `<i></i>${running.length} 盘进行中` : '';
  } catch { dot.innerHTML = ''; }
}

await reloadSession();
await reloadMeta();
refreshLive();
if (session.user || session.publicView) listen(['lobby'], (e) => { if (e.type === 'match_created' || e.type === 'match_finished') refreshLive(); });
// 庄家：有新的注册申请时角标 +1
if (session.user?.role === 'admin') listen(['admin'], (e) => { if (e.type === 'registration' || e.type === 'user_updated') reloadSession(); });
window.addEventListener('hashchange', route);
route();
