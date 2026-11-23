// 前端通用工具：DOM 创建、接口请求、实时事件、提示。

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
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

export const post = (path, body) => api(path, { method: 'POST', body: body || {} });
export const patch = (path, body) => api(path, { method: 'PATCH', body });

/** 订阅实时事件；返回关闭函数 */
export function listen(channels, onEvent) {
  const es = new EventSource(`/api/events?ch=${encodeURIComponent(channels.join(','))}`);
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch (err) {
      console.error(err);
    }
  };
  return () => es.close();
}

let toastTimer;
export function toast(text, err = false) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast${err ? ' err' : ''}` }, text);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), err ? 5000 : 2500);
}

/** 包装异步操作：出错时提示 */
export const guard = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (e) {
    toast(e.message, true);
  }
};

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
  const names = (winners.length ? winners : [r.winner]).map((s) => m.players?.[s]?.name || seatNames[s] || s);
  return `${names.join('、')}胜（${r.reason}）`;
}

/** 页面标题：书法大字 + 副标题 + 角落水印字，右侧可放按钮 */
export function pageHead(title, sub = '', wm = '', ...actions) {
  return h('div', { class: 'page-head' },
    wm ? h('span', { class: 'wm', 'aria-hidden': 'true' }, wm) : null,
    h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null),
    actions.length ? h('div', { class: 'row' }, actions) : null);
}

/** 弹窗 */
export function dialog(title, body, actions = []) {
  const dlg = h('dialog', {},
    h('div', { class: 'dlg-head' }, h('h3', {}, title), h('button', { class: 'btn ghost sm', onclick: () => dlg.close() }, '✕')),
    h('div', { class: 'dlg-body' }, body),
    actions.length ? h('div', { class: 'dlg-foot' }, actions) : null,
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
