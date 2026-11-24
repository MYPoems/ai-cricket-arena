// 前端通用工具：DOM 创建、接口请求、实时事件、提示、弹窗。

import { icon } from './icons.js';

export { icon };

// 让 replaceChildren / append 忽略 null、undefined、false，方便写条件渲染
for (const name of ['replaceChildren', 'append']) {
  const orig = Element.prototype[name];
  Element.prototype[name] = function (...nodes) {
    return orig.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
  };
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv === null || sv === undefined) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
        else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {}, // 服务端要求写操作带 JSON 类型，防跨站表单
    body: method !== 'GET' ? JSON.stringify(body || {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.status = res.status; // 调用方按状态码区分（比如 404：组局已关闭）
    throw err;
  }
  return data;
}

export const post = (path, body) => api(path, { method: 'POST', body: body || {} });
export const patch = (path, body) => api(path, { method: 'PATCH', body });

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 实时事件 ----------
// 一个标签页里的所有订阅合用一条 EventSource（/api/events?ch=a,b,c）：浏览器对同一主机最多 6 条连接，
// 每个订阅各开一条的话，开两三个标签页就占满了，新页面的请求全卡住。
// 订阅的频道一变（防抖 60ms），开一条新连接；新连接连上后接管它的频道，旧连接没频道可管了再关——换线时不漏事件。
// 服务端每条连接最多收 10 个频道，超过就分成几条。
// 「连接状态」：任何一条断了，顶栏的直播点显示「重连中」，全部恢复后复原。
// 浏览器会自动重连 EventSource；连接被服务端关掉时，这里按 1、2、4…15 秒退避自己重开。
const MAX_CH = 40;
const subs = new Set(); // { chans: Set<string>, onEvent }
const owner = new Map(); // 频道 → 现在由哪条连接投递这个频道的事件（同一事件可能两条连接都收到，只认这一条）
let conns = [];
let liveKey = null;
let syncTimer = null;
let retryTimer = null;
let retryDelay = 1000;
const broken = new Set();
let connOk = true;
let unloading = false;
addEventListener('pagehide', () => { unloading = true; });
addEventListener('pageshow', () => { unloading = false; });
function markConn(key, ok) {
  if (ok) broken.delete(key); else broken.add(key);
  const now = broken.size === 0;
  if (now === connOk) return;
  connOk = now;
  dispatchEvent(new CustomEvent('dsqq:conn', { detail: { ok: now } }));
}
export const connectionOk = () => connOk;

/** 一个标签页最多开 2 条：大厅一口气订 20 多盘对局时也只占 2 条连接。
 *  超出的部分先舍弃对局频道（match:*，大厅缩略图的实时刷新），大厅、组局、管理这些频道一定保留 */
const MAX_CONNS = 2;
function wantedChannels() {
  const all = new Set();
  for (const s of subs) for (const c of s.chans) all.add(c);
  const rank = (c) => (c.startsWith('match:') ? 1 : 0);
  return [...all].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)).slice(0, MAX_CH * MAX_CONNS);
}

function dispatch(data) {
  for (const s of [...subs]) {
    if (!s.chans.has(data.ch)) continue;
    try { s.onEvent(data); } catch (err) { console.error(err); }
  }
}

function closeConn(c) {
  c.dead = true;
  c.es.close();
  conns = conns.filter((x) => x !== c);
  markConn(c, true);
}

/** 关掉不再负责任何频道的连接（还没连上的新连接留着，等它接管） */
function prune() {
  for (const c of [...conns]) {
    const owns = c.chans.some((ch) => owner.get(ch) === c);
    if (owns) continue;
    if (c.dead || c.opened || c.key !== liveKey) closeConn(c);
  }
}

function openConn(chans, key) {
  const c = { chans, key, opened: false, dead: false, es: new EventSource(`/api/events?ch=${encodeURIComponent(chans.join(','))}`) };
  c.es.onopen = () => {
    if (c.dead) return;
    c.opened = true;
    retryDelay = 1000;
    markConn(c, true);
    const want = new Set(wantedChannels());
    for (const ch of chans) if (want.has(ch)) owner.set(ch, c);
    prune();
    // 连上（或断线重连上）了：告诉订阅者，让它们补拉一次最新状态——连接建立之前发出的事件收不到
    for (const ch of chans) if (owner.get(ch) === c) dispatch({ ch, type: '_open' });
  };
  c.es.onmessage = (e) => {
    if (c.dead) return;
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    if (owner.get(data.ch) === c) dispatch(data);
  };
  c.es.onerror = () => {
    if (c.dead || unloading) return;
    markConn(c, false);
    // 服务端把连接关了（浏览器不会再自己重连）：退避后整组重开
    if (c.es.readyState === EventSource.CLOSED) {
      c.es.close();
      c.dead = true;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => sync(true), retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    }
  };
  conns.push(c);
  return c;
}

function sync(force = false) {
  clearTimeout(syncTimer);
  syncTimer = null;
  const want = wantedChannels();
  const wantSet = new Set(want);
  for (const ch of [...owner.keys()]) if (!wantSet.has(ch)) owner.delete(ch);
  const key = want.join(',');
  if (force || key !== liveKey) {
    liveKey = key;
    for (let i = 0; i < want.length; i += MAX_CH) openConn(want.slice(i, i + MAX_CH), key);
  }
  prune();
}

const scheduleSync = () => { if (!syncTimer) syncTimer = setTimeout(() => sync(), 60); };

/** 订阅实时事件；返回关闭函数。同一标签页的订阅合用一条连接 */
export function listen(channels, onEvent) {
  const s = { chans: new Set(channels), onEvent };
  subs.add(s);
  scheduleSync();
  return () => { if (subs.delete(s)) scheduleSync(); };
}

// ---------- 提示条 ----------
// 右下角（手机在底部居中）一摞，最多 3 条；普通 4 秒、出错 7 秒；鼠标停在上面或键盘聚焦时暂停计时。
let toastHost = null;
const TOAST_MAX = 3;
function toastBox() {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'toasts', popover: 'manual', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    document.body.append(toastHost);
  }
  // 放进顶层并排到最上面：开着的弹窗（也在顶层）不会把提示盖住
  if (toastHost.showPopover) {
    try { if (toastHost.matches(':popover-open')) toastHost.hidePopover(); toastHost.showPopover(); } catch { /* 不支持时照常显示在页面上 */ }
  }
  return toastHost;
}
export function toast(text, err = false) {
  const box = toastBox();
  let left = err ? 7000 : 4000;
  let started = 0;
  let timer = null;
  let el = null;
  const dismiss = () => {
    clearTimeout(timer);
    if (el.classList.contains('leaving')) return;
    el.classList.add('leaving');
    setTimeout(() => {
      el.remove();
      if (!box.children.length && box.matches?.(':popover-open')) try { box.hidePopover(); } catch { /* 已经关了 */ }
    }, reducedMotion() ? 0 : 160);
  };
  const run = () => { started = Date.now(); clearTimeout(timer); timer = setTimeout(dismiss, left); };
  const pause = () => { clearTimeout(timer); left = Math.max(1500, left - (Date.now() - started)); };
  el = h('div', { class: `toast${err ? ' err' : ''}`, role: err ? 'alert' : null },
    h('div', { class: 'toast-text' }, text),
    h('button', { class: 'toast-x', type: 'button', 'aria-label': '关闭提示', title: '关闭', onclick: dismiss }, icon('close', 14)));
  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', run);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', run);
  box.append(el);
  const live = [...box.children].filter((x) => !x.classList.contains('leaving'));
  for (const old of live.slice(0, Math.max(0, live.length - TOAST_MAX))) old.querySelector('.toast-x')?.click();
  run();
  return dismiss;
}

// ---------- 忙碌态 ----------
/** 触发这次操作的按钮：按钮本身，或提交表单的那个按钮 */
function busyTarget(ev) {
  const t = ev.currentTarget;
  if (t instanceof HTMLButtonElement) return t;
  if (t instanceof HTMLFormElement) return ev.submitter || t.querySelector('button[type=submit], button:not([type])');
  return null;
}

/** 按钮进入忙碌：立即禁用、标 aria-busy；超过 150ms 才转圈，快的操作不闪。返回恢复函数 */
export function markBusy(btn) {
  if (!btn || btn.disabled) return () => {};
  const hadFocus = document.activeElement === btn;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  const t = setTimeout(() => btn.classList.add('busy'), 150);
  return () => {
    clearTimeout(t);
    btn.classList.remove('busy');
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    if (hadFocus && btn.isConnected && (!document.activeElement || document.activeElement === document.body)) btn.focus({ preventScroll: true });
  };
}

/** 包装异步操作：执行期间按钮禁用并转圈，出错时提示；开关、输入框保存失败时退回原值 */
export const guard = (fn) => async (...args) => {
  const ev = args[0] instanceof Event ? args[0] : null;
  const field = ev && ev.currentTarget instanceof HTMLInputElement ? ev.currentTarget : null;
  return runGuarded(fn, args, ev ? busyTarget(ev) : null, field);
};

/** 先问一句再做：确认框开着时按钮不转圈，点了「确定」才进入忙碌。
 *  ask 是 confirmDialog 的参数，或返回 true/false（可以是 Promise）的函数——不需要确认时直接返回 true */
export const guardConfirm = (ask, fn) => async (...args) => {
  const ev = args[0] instanceof Event ? args[0] : null;
  const btn = ev ? busyTarget(ev) : null; // 事件派发完 currentTarget 就清空了，先记下按钮
  const ok = typeof ask === 'function' ? await ask(...args) : await confirmDialog(ask);
  if (!ok) return undefined;
  return runGuarded(fn, args, btn, null);
};

async function runGuarded(fn, args, btn, field) {
  const check = field && (field.type === 'checkbox' || field.type === 'radio') ? field : null;
  const release = markBusy(btn);
  if (check) { check.disabled = true; check.setAttribute('aria-busy', 'true'); }
  try {
    const r = await fn(...args);
    if (field && !check) field.defaultValue = field.value;
    return r;
  } catch (e) {
    if (check) check.checked = !check.checked;
    else if (field && field.type !== 'file') field.value = field.defaultValue;
    toast(e.message, true);
    return undefined;
  } finally {
    release();
    if (check) { check.disabled = false; check.removeAttribute('aria-busy'); }
  }
}

/** 表单项就地报错：红框（aria-invalid）、字段下方一行说明、焦点移过去；改动后自动清掉 */
export function markInvalid(input, msg) {
  clearInvalid(input);
  const id = `err-${Math.random().toString(36).slice(2, 8)}`;
  const tip = h('div', { class: 'field-err', id, role: 'alert' }, msg);
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', id);
  const host = input.closest('.field') || input.parentElement;
  host.append(tip);
  input._errTip = tip;
  input.addEventListener('input', () => clearInvalid(input), { once: true });
  input.focus();
  return false;
}
export function clearInvalid(input) {
  input._errTip?.remove();
  input._errTip = null;
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
}

/** 页面标题：setTitle('天梯', '中国象棋') → 「天梯 · 中国象棋 — 电子斗蛐蛐」 */
export function setTitle(...parts) {
  const t = parts.filter(Boolean).join(' · ');
  document.title = t ? `${t} — 电子斗蛐蛐` : '电子斗蛐蛐';
}

/** 选手名字：旧数据里有编码坏掉的名字（含 U+FFFD 或控制字符），显示成「未命名蛐蛐」 */
const BAD_NAME = /[\uFFFD\u0000-\u001F\u007F-\u009F]/;
export const cleanName = (name) => (!name || BAD_NAME.test(String(name)) ? '未命名蛐蛐' : String(name));

/** 座位名单压成一句：重复的合并成「×N」，两人局写「A 对 B」，太多时只列前几位。
 *  summarizeSeats(['我', '内置 AI · 中级', '内置 AI · 中级']) → 「我 + 内置 AI · 中级 ×2」 */
export function summarizeSeats(names, { max = 3 } = {}) {
  const list = (names || []).map(cleanName);
  if (list.length === 2) return `${list[0]} 对 ${list[1]}`;
  const groups = new Map();
  for (const n of list) groups.set(n, (groups.get(n) || 0) + 1);
  const parts = [...groups].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n));
  return parts.length > max ? `${parts.slice(0, max).join(' + ')} 等 ${list.length} 位` : parts.join(' + ');
}

/** 空状态：角落水印字 + 一句话 + 一个主操作（wm 传 null 不要水印，比如页头已经有一个了） */
export function emptyState(text, { wm = '空', action = null, card = true } = {}) {
  return h('div', { class: `empty${card ? ' card' : ''}` },
    wm ? h('span', { class: 'wm', 'aria-hidden': 'true' }, wm) : null,
    h('p', { class: 'empty-text' }, text),
    action);
}

/** 可点的表格行：第一格放真链接并铺满整行（键盘可达、Ctrl/中键开新标签）。
 *  首格被钉住（position: sticky）时链接铺不满，点行里其他地方也照样跳转 */
export function linkRow(href, cells, { label } = {}) {
  const [first, ...rest] = cells;
  const a = h('a', { class: 'row-link', href, 'aria-label': label }, [...first.childNodes]);
  first.replaceChildren(a);
  const tr = h('tr', { class: 'click' }, first, rest);
  tr.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.target.closest('a, button, input, select, label, summary')) return;
    if (String(window.getSelection?.() || '')) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) window.open(a.href, '_blank', 'noopener');
    else location.href = a.href;
  });
  return tr;
}

/** 选择按钮的属性：选中态既有 .on 也有 aria-pressed */
export const pressed = (on) => ({ 'aria-pressed': on ? 'true' : 'false' });

export function tierBadge(t) {
  if (!t) return null;
  return h('span', { class: 'tier', 'data-t': t.tier }, t.label || t.tier);
}

export function avatar(c, size = '') {
  return h('div', { class: `avatar ${size}` }, c?.avatar || '？');
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const fmtMs = (ms) => (ms === null || ms === undefined ? '' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`);
export const fmtTokens = (n) => (!n ? '0' : n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M`);
export const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

export const MODE_NAMES = { casual: '娱乐赛', ranked: '排位赛', placement: '定级赛' };

export function modelLine(c) {
  if (!c) return '';
  if (c.kind === 'human') return '玩家';
  if (c.kind === 'builtin') return `内置 AI · ${c.level || 3} 层搜索`;
  if (c.kind === 'random') return '随机走子';
  if (c.kind === 'agent') return `自带 Agent${c.agent_timeout ? ` · 每步 ${c.agent_timeout} 秒` : ''}`;
  if (c.kind === 'engine') return `${{ pikafish: 'Pikafish', rapfi: 'Rapfi', stockfish: 'Stockfish' }[c.provider || 'pikafish'] || c.provider} · 每步 ${c.level || 200}ms`;
  return `${c.providerName || c.provider} · ${c.model}`;
}

/** 按名次判定某座位的结果：'w' 胜 / 'd' 和 / 'l' 负（支持团队和多人） */
export function seatOutcome(result, seat) {
  const ranks = result?.ranks;
  if (!ranks || ranks[seat] === undefined) return result?.winner ? (result.winner === seat ? 'w' : 'l') : 'd';
  const vals = Object.values(ranks);
  const best = Math.min(...vals);
  if (vals.every((r) => r === best)) return 'd';
  return ranks[seat] === best ? 'w' : 'l';
}

export function resultText(m, seatNames = {}) {
  const r = m.result;
  if (!r) return m.status === 'running' ? '进行中' : '';
  if (r.aborted) return `中止：${r.reason}`;
  if (r.winnerTeam) return `${r.winnerTeam}胜（${r.reason}）`;
  const seats = Object.keys(r.ranks || {});
  const winners = seats.filter((s) => seatOutcome(r, s) === 'w');
  if (seats.length && !winners.length) return `平局（${r.reason}）`;
  if (!seats.length && !r.winner) return `和棋（${r.reason}）`;
  const names = (winners.length ? winners : [r.winner]).map((s) => (m.players?.[s] ? cleanName(m.players[s].name) : seatNames[s] || s));
  return `${names.join('、')}胜（${r.reason}）`;
}

/** 页面标题：书法大字 + 副标题 + 角落水印字，右侧可放按钮 */
export function pageHead(title, sub = '', wm = '', ...actions) {
  return h('div', { class: 'page-head' },
    wm ? h('span', { class: 'wm', 'aria-hidden': 'true' }, wm) : null,
    h('div', { class: 'ph-title' }, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null),
    actions.length ? h('div', { class: 'row' }, actions) : null);
}

// ---------- 弹窗 ----------
/** 弹窗：260ms 浮上来、160ms 淡出；Esc、点遮罩、右上角关闭键都能关 */
let dlgSeq = 0;
const nativeClose = HTMLDialogElement.prototype.close;
export function dialog(title, body, actions = [], { className = '' } = {}) {
  const tid = `dlg-t-${++dlgSeq}`;
  const dlg = h('dialog', { class: className || null, 'aria-labelledby': tid },
    h('div', { class: 'dlg-head' }, h('h3', { id: tid }, title),
      h('button', { class: 'icon-btn dlg-x', type: 'button', 'aria-label': '关闭', title: '关闭', onclick: () => dlg.close() }, icon('close', 18))),
    h('div', { class: 'dlg-body' }, body),
    actions.length ? h('div', { class: 'dlg-foot' }, actions) : null,
  );
  let closing = false;
  // 所有关法（包括别处直接调 dlg.close()）都先放完淡出再真正关掉
  dlg.close = function (v) {
    if (closing || !this.open) return;
    if (reducedMotion()) { nativeClose.call(this, v); return; }
    closing = true;
    this.classList.add('closing');
    setTimeout(() => nativeClose.call(this, v), 160);
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close(); });
  // 点遮罩关闭：按下和松开都在遮罩上才算，免得在框里拖选文字拖到外面就关了
  let downOnVeil = false;
  dlg.addEventListener('pointerdown', (e) => { downOnVeil = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && downOnVeil && !dlg.dataset.keep) dlg.close(); downOnVeil = false; });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/** 确认框，代替 confirm()：返回 Promise<boolean>。danger 时默认焦点落在「取消」上 */
export function confirmDialog({ title = '请确认', body = '', okText = '确定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    let dlg = null;
    const cancelBtn = h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, cancelText);
    const okBtn = h('button', { class: `btn primary${danger ? ' danger' : ''}`, type: 'button', onclick: () => { ok = true; dlg.close(); } }, okText);
    dlg = dialog(title, typeof body === 'string' ? h('p', { class: 'dlg-msg' }, body) : body, [cancelBtn, okBtn], { className: 'dlg-confirm' });
    dlg.addEventListener('close', () => resolve(ok));
    (danger ? cancelBtn : okBtn).focus();
  });
}

/** 输入框，代替 prompt()：返回 Promise<string|null>（取消为 null） */
export function promptDialog({ title = '请输入', label = '', value = '', placeholder = '', okText = '确定', maxlength = 60 } = {}) {
  return new Promise((resolve) => {
    let out = null;
    let dlg = null;
    const input = h('input', { type: 'text', value, placeholder, maxlength });
    const form = h('form', { class: 'stack-2', onsubmit: (e) => { e.preventDefault(); out = input.value.trim(); dlg.close(); } },
      h('label', { class: 'field' }, label ? h('span', {}, label) : null, input));
    dlg = dialog(title, form, [
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, '取消'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, okText),
    ], { className: 'dlg-confirm' });
    dlg.addEventListener('close', () => resolve(out));
    input.focus();
    input.select();
  });
}
