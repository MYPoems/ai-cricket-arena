// 前端入口：按地址栏 hash 切换页面。

import { api, toast, listen } from './ui.js';
import { playView } from './play.js';
import { matchView } from './match.js';
import { charactersView, profileView } from './characters.js';
import { ladderView } from './ladder.js';
import { compareNewView, compareView } from './compare.js';
import { historyView, settingsView } from './pages.js';

const app = document.getElementById('app');
const meta = {};
let cleanup = null;

async function reloadMeta() {
  Object.assign(meta, await api('/meta'));
  return meta;
}

const go = (hash) => { location.hash = hash; };

async function route() {
  cleanup?.();
  cleanup = null;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [page = 'play', id] = parts;
  const navKey = { match: 'play', characters: 'characters', ladder: 'ladder', compare: 'compare', history: 'history', settings: 'settings' }[page] || 'play';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === navKey));
  document.body.dataset.page = page === 'match' && id ? 'match' : page;
  try {
    const characters = ['play', 'match', 'compare'].includes(page) ? await api('/characters') : [];
    const ctx = { meta, characters, go, reloadMeta };
    let r;
    if (page === 'match' && id) r = await matchView(app, id, ctx);
    else if (page === 'characters' && id) r = await profileView(app, id, ctx);
    else if (page === 'characters') r = await charactersView(app, ctx);
    else if (page === 'ladder') r = await ladderView(app, ctx);
    else if (page === 'compare' && id) r = await compareView(app, id, ctx);
    else if (page === 'compare') r = await compareNewView(app, ctx);
    else if (page === 'history') r = await historyView(app, ctx);
    else if (page === 'settings') r = await settingsView(app, ctx);
    else r = await playView(app, ctx);
    cleanup = typeof r === 'function' ? r : null;
    window.scrollTo(0, 0);
  } catch (e) {
    app.replaceChildren(Object.assign(document.createElement('div'), { className: 'empty card', textContent: e.message }));
    toast(e.message, true);
  }
}

// 顶栏：进行中的对局数
const dot = document.getElementById('liveDot');
async function refreshLive() {
  try {
    const running = await api('/matches?status=running&limit=50');
    dot.innerHTML = running.length ? `<i></i>${running.length} 盘进行中` : '';
  } catch { /* 忽略 */ }
}
listen(['lobby'], (e) => { if (e.type === 'match_created' || e.type === 'match_finished') refreshLive(); });

await reloadMeta();
refreshLive();
window.addEventListener('hashchange', route);
route();
