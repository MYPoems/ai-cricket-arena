// 对局页（所有游戏通用）：一屏显示。中间是游戏画面、胜率条、走势和着法，两侧是各座位的选手卡和思考。
// 回放：从对局记录在浏览器里重建每一步，可以播放、调速、拖动进度。
// 录制版式：地址带 ?record=1 时隐藏导航、自动从头播放，播完设置 window.__replayDone = true（供服务端录成视频）。

import { h, api, post, listen, toast, guard, tierBadge, fmtMs, fmtTokens, pct, MODE_NAMES, resultText } from './ui.js';
import { loadRenderer, PALETTE } from '../stage/index.js';

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
  let viewPly = null; // null 表示跟随最新局面
  let paused = d.paused;
  let waitingHuman = d.waitingHuman;
  let offerNext = false;
  let replaying = null; // { timer }
  let speed = Number(query.get('speed')) || 1;

  const seatChar = (seat) => chars.get(d.seats[seat]) || d.players[seat];
  const seatName = (seat) => d.seatNames?.[seat] || seat;
  const color = (seat) => renderer.seatColor?.(seat, seats.indexOf(seat)) || PALETTE[seats.indexOf(seat) % PALETTE.length];
  const humanSeat = seats.find((s) => seatChar(s)?.kind === 'human') || null;
  let flipped = humanSeat ? !!renderer.flipFor?.(humanSeat) : false;
  const offers = () => d.options?.draw?.offers || [];
  const pendingOffer = () => { const o = offers().at(-1); return o?.status === 'pending' ? o : null; };
  const canReview = () => Array.isArray(d.record?.actions);

  const stage = renderer.createStage({
    onAction: guard(async (action) => {
      await post(`/matches/${id}/move`, { action, offerDraw: offerNext });
      offerNext = false;
      waitingHuman = null;
    }),
  });
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
  const winbar = h('div', { class: 'winbar', style: { background: color(seats[1] || seats[0]) } },
    h('div', { class: 'red', style: { background: color(seats[0]) } }), h('div', { class: 'mid' }), h('span', { class: 't' }), h('span', { class: 'b' }));
  const curve = h('div', { class: 'stage-curve' });
  const moves = h('div', { class: 'stage-moves' });
  const [aw, ah] = renderer.aspect || [1, 1];

  root.replaceChildren(h('div', { class: `arena${winbarOn ? '' : ' no-winbar'}${recordMode ? ' recording' : ''}`, style: { '--aw': aw, '--ah': ah } },
    h('div', { class: 'camp-col' }, ...leftSeats.map((s) => camps[s].el)),
    h('section', { class: 'stage' },
      statusBar,
      h('div', { class: 'stage-board' }, winbarOn ? winbar : null, h('div', { class: 'board-wrap' }, stage.el)),
      winbarOn ? curve : null,
      moves,
    ),
    h('div', { class: 'camp-col' }, ...rightSeats.map((s) => camps[s].el)),
  ));
  if (recordMode) document.body.classList.add('record-mode');

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
    const ts = [...turns.values()].filter((t) => t.seat === seat && t.label);
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

  function renderCamp(seat) {
    const c = seatChar(seat);
    const s = seatStats(seat);
    const thinking = d.status === 'running' && (partials.has(seat) || waitingHuman === seat);
    const change = d.rating_changes?.[d.seats[seat]];
    const ranks = d.result?.ranks;
    const won = d.status === 'finished' && ranks && ranks[seat] === Math.min(...Object.values(ranks)) && !Object.values(ranks).every((r) => r === ranks[seat]);
    const lastQ = s.last?.eval?.quality;
    const role = d.view?.roles?.[seat];
    camps[seat].el.classList.toggle('active', thinking);
    camps[seat].el.classList.toggle('out', !!d.view?.out?.includes?.(seat));
    camps[seat].head.replaceChildren(
      h('div', { class: 'camp-id' },
        h('div', { class: 'camp-avatar' }, c?.avatar || '？', thinking ? h('i', { class: 'pulse' }) : null),
        h('div', { class: 'camp-name' },
          h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
            h('span', { class: 'side-tag', style: { background: color(seat) } }, seatName(seat)),
            h('b', {}, c?.name || '？'),
            role ? h('span', { class: 'chip' }, role) : null,
            won ? h('span', { class: 'chip good' }, '胜') : null),
          h('div', { class: 'sub' }, c?.kind === 'model' ? `${c.providerName || c.provider} · ${c.model}` : c?.kind === 'human' ? '玩家' : c?.name),
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

  function renderStatus() {
    const running = d.status === 'running';
    const n = totalPlies();
    const thinkingSeats = [...partials.keys()];
    const status = running
      ? (paused ? '已暂停' : waitingHuman ? '轮到你' : thinkingSeats.length > 1 ? `${thinkingSeats.length} 人同时思考中` : thinkingSeats.length ? `${seatName(thinkingSeats[0])}思考中` : '…')
      : resultText(d, d.seatNames);
    const btn = (label, title, fn) => h('button', { class: 'icon-btn', title, onclick: guard(fn) }, label);
    const po = pendingOffer();
    const reviewing = viewPly !== null;
    statusBar.replaceChildren(
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap', minWidth: 0 } },
        h('span', { class: 'chip' }, d.gameName || ''),
        h('span', { class: 'chip' }, MODE_NAMES[d.mode]),
        h('span', { class: `stage-state${running ? '' : ' done'}` }, status),
        h('span', { class: 'muted small', style: { whiteSpace: 'nowrap' } }, reviewing ? `${replaying ? '回放' : '复盘'} ${viewPly}/${n}` : `已走 ${n} 步`)),
      h('div', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } },
        canReview() && n ? [
          btn(replaying ? '⏸' : '⏵', replaying ? '暂停回放' : '从头回放', () => (replaying ? stopReplay() : startReplay(reviewing && viewPly < n ? viewPly : 0))),
          h('select', { class: 'speed', title: '回放速度', onchange: (e) => { speed = Number(e.target.value); } },
            ...SPEEDS.map((s) => h('option', { value: s, selected: s === speed }, `${s}×`))),
          reviewing ? btn('◀', '上一步', () => { stopReplay(); goto(Math.max(0, viewPly - 1)); }) : null,
          reviewing ? btn('▶', '下一步', () => { stopReplay(); goto(Math.min(n, viewPly + 1)); }) : null,
          reviewing && running ? btn('⟳', '回到最新', () => { stopReplay(); goto(null); }) : null,
        ] : null,
        running && !humanSeat ? btn(paused ? '▶' : '⏸', paused ? '继续' : '暂停', () => post(`/matches/${id}/control`, { op: paused ? 'resume' : 'pause' })) : null,
        running && paused ? btn('⏭', '单步', () => post(`/matches/${id}/control`, { op: 'step' })) : null,
        running && waitingHuman && po && po.seat !== waitingHuman ? h('button', { class: 'btn sm primary', onclick: guard(() => post(`/matches/${id}/control`, { op: 'accept_draw' })) }, '接受和棋') : null,
        running && waitingHuman && d.features?.draw && !po ? h('button', { class: `btn sm${offerNext ? ' primary' : ''}`, title: '走下一步时同时向对方提出和棋', onclick: () => { offerNext = !offerNext; renderStatus(); } }, offerNext ? '走棋时提和 ✓' : '提和') : null,
        running && waitingHuman ? btn('🏳', '认输', async () => { if (confirm('确定认输？')) await post(`/matches/${id}/control`, { op: 'resign' }); }) : null,
        running && d.mode === 'casual' ? btn('■', '中止对局', async () => { if (confirm('中止这盘？')) await post(`/matches/${id}/control`, { op: 'abort' }); }) : null,
        stage.setFlipped ? btn('⇅', '翻转', () => { flipped = !flipped; stage.setFlipped(flipped); renderStage(false); }) : null,
        h('a', { class: 'icon-btn', title: '导出记录', href: `/api/matches/${id}/export` }, '⤓'),
      ),
    );
    if (reviewing && canReview() && n) {
      statusBar.append(h('input', { class: 'scrub', type: 'range', min: 0, max: n, value: viewPly, oninput: (e) => { stopReplay(); goto(Number(e.target.value)); } }));
    }
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
    stage.render(view, { movable, actions: movable ? d.humanActions : null, arrows, animate, replay: !!replaying, viewer: d.viewer });
    if (winbarOn) {
      let e = null;
      for (let p = ply; p >= 0 && e === null; p--) e = e0At(p);
      const v = e ?? 0.5;
      winbar.classList.toggle('flip', flipped);
      winbar.querySelector('.red').style.height = `${v * 100}%`;
      winbar.querySelector('.t').textContent = Math.round((1 - v) * 100);
      winbar.querySelector('.b').textContent = Math.round(v * 100);
      winbar.title = `${seatName(seats[0])}胜率 ${Math.round(v * 100)}%（${d.options?.startEval?.source === 'builtin' ? '内置粗略' : '引擎'}评估）`;
    }
  }

  function renderCurve() {
    if (!winbarOn) return;
    const n = totalPlies();
    const W = 600, H = 60;
    const pts = [];
    for (let p = 0; p <= n; p++) { const e = e0At(p); if (e !== null) pts.push([p, e]); }
    const self = [];
    for (let p = 1; p <= n; p++) {
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

  function renderMoves() {
    const items = moveItems();
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
      if (d.options?.hideThoughts && c?.kind === 'model') body.push(h('div', { class: 'stream muted' }, '思考中，对局结束后公开'));
      else {
        if (t.reasoning) body.push(h('details', { open: !t.text }, h('summary', {}, `原生推理 · ${t.reasoning.length} 字`), h('div', { class: 'reasoning' }, t.reasoning)));
        body.push(h('div', { class: 'stream typing' }, t.text || (c?.kind === 'model' ? '' : '思考中')));
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
        h('span', { class: 'move' }, t.label || (isLive ? (d.options?.hideThoughts && c?.kind === 'model' ? '' : '思考中') : '判负')),
        h('span', { class: 'grow' }),
        drawChip(t.ply),
        qualityChip(q)),
      meta ? h('div', { class: 'meta' }, meta) : null,
      ...body);
  }

  function renderThoughts() {
    for (const seat of seats) {
      const cards = [];
      const p = partials.get(seat);
      if (p && d.status === 'running' && viewPly === null) cards.push(thoughtCard(p, true));
      const limit = viewPly ?? Infinity;
      const plies = [...turns.keys()].filter((k) => turns.get(k).seat === seat && k <= limit).sort((a, b) => b - a);
      for (const k of plies) cards.push(thoughtCard(turns.get(k)));
      if (!cards.length) cards.push(h('div', { class: 'camp-empty' }, d.status === 'running' ? '等待出手' : '没有记录'));
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
    goto(from);
    const step = () => {
      const n = totalPlies();
      if (!replaying) return;
      if (viewPly >= n) {
        replaying = null;
        renderStatus();
        window.__replayDone = true;
        return;
      }
      goto(viewPly + 1);
      const t = turns.get(viewPly);
      const base = Math.min(5000, Math.max(900, (t?.latency_ms || 900) * 0.6 + (t?.analysis ? 600 : 0)));
      replaying.timer = setTimeout(step, base / speed);
    };
    replaying.timer = setTimeout(step, 900 / speed);
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
        if (seatChar(e.seat)?.kind === 'human') { waitingHuman = e.seat; partials.delete(e.seat); await refresh(); }
        else partials.set(e.seat, { ply: e.ply, seat: e.seat, characterId: e.characterId, character_id: e.characterId, text: '', reasoning: '', attempts: [] });
        seats.forEach(renderCamp);
        renderStatus();
        renderThoughts();
        renderStage(false);
        break;
      case 'human_turn':
        waitingHuman = e.seat;
        await refresh();
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
        if (viewPly === null) renderAll();
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
        await refresh();
        partials.clear();
        waitingHuman = null;
        renderAll();
        if (!recordMode && canReview()) goto(totalPlies());
        if (!recordMode) toast(resultText(d, d.seatNames));
        break;
    }
  });
  return () => { stop(); stopReplay(); document.body.classList.remove('record-mode'); };
}
