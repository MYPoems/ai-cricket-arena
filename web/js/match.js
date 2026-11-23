// 对局页：实时观战、玩家走棋、思考面板、胜率条与曲线、着法列表与复盘。

import { h, api, post, listen, toast, guard, tierBadge, avatar, fmtMs, fmtTokens, pct, MODE_NAMES, resultText } from './ui.js';
import { Board } from './board.js';
import { newGame, play } from '/games/xiangqi/rules.js';

const LINE_KEYS = ['判断', '威胁', '理由'];

function parseAnalysis(text) {
  if (!text) return null;
  const out = {};
  for (const k of [...LINE_KEYS, '胜率', '着法']) {
    const m = new RegExp(`${k}[:：]\\s*(.+)`).exec(text);
    if (m) out[k] = m[1].trim();
  }
  return Object.keys(out).length >= 2 ? out : null;
}

function qualityChip(q) {
  if (!q) return null;
  const cls = { 最佳: 'good', 好棋: 'good', 缓着: 'warn', 失误: 'warn', 大漏着: 'bad' }[q.tag] || '';
  return h('span', { class: `chip ${cls}`, title: `比引擎最佳着法少 ${Math.round(q.loss * 100)} 个胜率百分点` }, q.tag, q.loss >= 0.05 ? ` −${Math.round(q.loss * 100)}%` : '');
}

export async function matchView(root, id, { meta, characters }) {
  let d = await api(`/matches/${id}`);
  const chars = new Map(characters.map((c) => [c.id, c]));
  const turns = new Map(d.turns.map((t) => [t.ply, t]));
  let live = d.partial ? { ...d.partial } : null;
  let viewPly = null; // null 表示跟随最新局面
  let paused = d.paused;
  let waitingHuman = d.waitingHuman;
  let flipped = false;

  const seatChar = (seat) => chars.get(d.seats[seat]) || d.players[seat];
  const humanSeat = ['r', 'b'].find((s) => seatChar(s)?.kind === 'human' && !(seatChar(s === 'r' ? 'b' : 'r')?.kind === 'human'));
  if (humanSeat === 'b') flipped = true;

  const board = new Board({
    onMove: guard(async (iccs) => {
      await post(`/matches/${id}/move`, { action: iccs });
      waitingHuman = null;
    }),
  });
  board.setFlipped(flipped);

  // ---------- 布局 ----------
  const playersEl = h('div', { class: 'card players' });
  const controls = h('div', { class: 'row' });
  const banner = h('div');
  const winbar = h('div', { class: 'winbar' }, h('div', { class: 'red' }), h('div', { class: 'mid' }), h('span', { class: 't' }), h('span', { class: 'b' }));
  const curve = h('div', { class: 'card', style: { padding: '8px 10px' } });
  const moves = h('div', { class: 'card movelist' });
  const thoughts = h('div', { class: 'thoughts' });

  root.replaceChildren(
    h('div', { class: 'col' },
      playersEl,
      h('div', { class: 'match' },
        h('div', { class: 'col' },
          h('div', { class: 'board-area' }, winbar, h('div', { class: 'board-wrap' }, board.el)),
          curve,
          moves,
          controls,
        ),
        h('div', { class: 'col' }, banner, thoughts),
      ),
    ),
  );

  // ---------- 渲染 ----------
  const actions = () => d.view.moves.map((m) => m.iccs);

  function stateAt(ply) {
    let g = newGame(d.startFen);
    const acts = actions();
    for (let i = 0; i < ply; i++) g = play(g, acts[i]);
    return g;
  }

  function redEAt(ply) {
    if (ply === 0) return d.options?.startEval?.redE ?? null;
    return turns.get(ply)?.eval?.redE ?? null;
  }

  function renderPlayers() {
    const total = d.view.moves.length;
    const toMove = d.view.side;
    const status = d.status === 'running'
      ? (paused ? '已暂停' : waitingHuman ? '轮到你走' : live ? `${seatChar(live.seat)?.name || ''} 思考中` : '…')
      : resultText(d, d.seatNames);
    const side = (seat, right) => {
      const c = seatChar(seat);
      return h('div', { class: `player${right ? ' right' : ''}${d.status === 'running' && toMove === seat ? ' on' : ''}` },
        avatar(c),
        h('div', { style: { minWidth: 0 } },
          h('div', { class: 'row', style: { gap: '6px', justifyContent: right ? 'flex-end' : 'flex-start', flexWrap: 'nowrap' } },
            h('span', { class: `side-mark ${seat}` }), h('span', { class: 'name' }, c?.name || '？'), c?.tier ? tierBadge(c.tier) : null),
          h('div', { class: 'sub' }, c?.kind === 'model' ? `${c.providerName || c.provider} · ${c.model}` : c?.kind === 'human' ? '玩家' : c?.name),
        ),
      );
    };
    playersEl.replaceChildren(
      side('r', false),
      h('div', { class: 'vs' }, h('span', { class: 'chip' }, MODE_NAMES[d.mode]), h('span', { class: 'state' }, status), h('span', { class: 'muted small' }, `第 ${total} 步`)),
      side('b', true),
    );
  }

  function renderBoard(animate = true) {
    const ply = viewPly ?? d.view.moves.length;
    const latest = viewPly === null;
    const g = latest ? null : stateAt(ply);
    const boardArr = latest ? d.view.board : g.pos.board;
    const side = latest ? d.view.side : g.pos.side;
    const lastMove = ply > 0 ? d.view.moves[ply - 1].iccs : null;
    const inCheck = latest ? d.view.inCheck : ply > 0 && d.view.moves[ply - 1].check;
    const arrows = [];
    if (!latest && ply < d.view.moves.length) {
      const best = (ply === 0 ? d.options?.startEval?.best : turns.get(ply)?.eval?.raw?.best);
      if (best && d.status !== 'running') arrows.push({ iccs: best, kind: 'best' });
    }
    const movable = latest && d.status === 'running' && waitingHuman && !paused ? waitingHuman : null;
    board.render({ board: boardArr, side, lastMove, inCheck, movable, arrows }, { animate });
    // 胜率条（红方期望得分）
    let e = null;
    for (let p = ply; p >= 0 && e === null; p--) e = redEAt(p);
    const red = e ?? 0.5;
    winbar.classList.toggle('flip', flipped);
    winbar.querySelector('.red').style.height = `${red * 100}%`;
    winbar.querySelector('.t').textContent = `黑 ${Math.round((1 - red) * 100)}`;
    winbar.querySelector('.b').textContent = `红 ${Math.round(red * 100)}`;
    winbar.title = `胜率评估：${d.options?.startEval?.source === 'pikafish' ? 'Pikafish' : '内置 AI（粗略）'}`;
  }

  function renderCurve() {
    const n = d.view.moves.length;
    const W = 500, H = 70;
    const pts = [];
    for (let p = 0; p <= n; p++) {
      const e = redEAt(p);
      if (e !== null) pts.push([p, e]);
    }
    const self = [];
    for (let p = 1; p <= n; p++) {
      const t = turns.get(p);
      if (t?.self_winrate === null || t?.self_winrate === undefined) continue;
      const s = t.self_winrate / 100;
      self.push([p, t.seat === 'r' ? s : 1 - s]);
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
      <line class="mid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>
      ${pts.length > 1 ? `<path class="area-r" d="${path(pts)} L ${X(pts[pts.length - 1][0])} ${H} L ${X(pts[0][0])} ${H} Z"/><path class="line" d="${path(pts)}"/>` : ''}
      ${self.length > 1 ? `<path class="self" d="${path(self)}"/>` : ''}
      ${n ? `<line class="cursor" x1="${X(cur)}" y1="0" x2="${X(cur)}" y2="${H}"/>` : ''}`;
    svgEl.addEventListener('click', (e) => {
      if (!n) return;
      const r = svgEl.getBoundingClientRect();
      goto(Math.round(((e.clientX - r.left) / r.width) * n));
    });
    curve.replaceChildren(
      h('div', { class: 'row small muted', style: { justifyContent: 'space-between', marginBottom: '2px' } },
        h('span', {}, '红方胜率走势'),
        h('span', { class: 'row', style: { gap: '10px' } },
          h('span', {}, h('span', { style: { color: 'var(--red)' } }, '━'), ' 引擎'),
          h('span', {}, h('span', { style: { color: 'var(--accent-2)' } }, '┅'), ' 模型自评'))),
      svgEl,
    );
  }

  function renderMoves() {
    const mv = d.view.moves;
    const cur = viewPly ?? mv.length;
    const items = [];
    for (let i = 0; i < mv.length; i += 2) {
      items.push(h('div', { class: 'n' }, `${i / 2 + 1}.`));
      for (const j of [i, i + 1]) {
        if (j >= mv.length) { items.push(h('div')); continue; }
        const q = turns.get(j + 1)?.eval?.quality;
        items.push(h('div', { class: `mv${cur === j + 1 ? ' on' : ''}`, onclick: () => goto(j + 1) },
          q ? h('span', { class: `q q-${q.tag}`, title: q.tag }) : null, mv[j].cn));
      }
    }
    moves.replaceChildren(...(items.length ? items : [h('div', { class: 'muted small', style: { gridColumn: '1 / -1' } }, '还没有走棋')]));
    // 只滚动列表本身，不带动整个页面
    if (viewPly === null) moves.scrollTop = moves.scrollHeight;
    else {
      const on = moves.querySelector('.mv.on');
      if (on) moves.scrollTop = on.offsetTop - moves.clientHeight / 2;
    }
  }

  function renderControls() {
    const running = d.status === 'running';
    const hasHuman = !!humanSeat;
    controls.replaceChildren(
      running && !hasHuman ? h('button', { class: 'btn', onclick: guard(async () => { await post(`/matches/${id}/control`, { op: paused ? 'resume' : 'pause' }); }) }, paused ? '▶ 继续' : '⏸ 暂停') : null,
      running && paused ? h('button', { class: 'btn', onclick: guard(() => post(`/matches/${id}/control`, { op: 'step' })) }, '⏭ 单步') : null,
      running && waitingHuman ? h('button', { class: 'btn', onclick: guard(async () => { if (confirm('确定认输？')) await post(`/matches/${id}/control`, { op: 'resign' }); }) }, '🏳 认输') : null,
      running && d.mode === 'casual' ? h('button', { class: 'btn', onclick: guard(async () => { if (confirm('中止这盘棋？')) await post(`/matches/${id}/control`, { op: 'abort' }); }) }, '中止') : null,
      h('button', { class: 'btn', onclick: () => { flipped = !flipped; board.setFlipped(flipped); renderBoard(false); } }, '⇅ 翻转'),
      viewPly !== null ? h('button', { class: 'btn', onclick: () => goto(null) }, '回到最新') : null,
      h('span', { class: 'grow' }),
      viewPly !== null ? h('span', { class: 'row', style: { gap: '4px' } },
        h('button', { class: 'btn sm', onclick: () => goto(Math.max(0, viewPly - 1)) }, '◀'),
        h('span', { class: 'small muted' }, `${viewPly}/${d.view.moves.length}`),
        h('button', { class: 'btn sm', onclick: () => goto(Math.min(d.view.moves.length, viewPly + 1)) }, '▶')) : null,
      h('a', { class: 'btn sm', href: `/api/matches/${id}/export` }, '导出棋谱'),
    );
  }

  function renderBanner() {
    if (d.status === 'running') {
      banner.replaceChildren(d.challenge?.text ? h('div', { class: 'result-banner' }, h('b', {}, `${chars.get(d.challenge.by)?.name || ''} 的挑战宣言：`), d.challenge.text) : '');
      return;
    }
    const ch = d.rating_changes || {};
    banner.replaceChildren(h('div', { class: 'result-banner col', style: { gap: '6px' } },
      h('b', {}, resultText(d, d.seatNames)),
      Object.keys(ch).length ? h('div', { class: 'row small' }, ...Object.entries(ch).map(([cid, c]) => h('span', {},
        `${chars.get(cid)?.name || Object.values(d.players).find((p) => p?.id === cid)?.name || ''}：${c.before} → ${c.after} `,
        h('span', { class: c.delta >= 0 ? 'delta-up' : 'delta-down' }, c.delta >= 0 ? `+${c.delta}` : c.delta)))) : null,
      d.challenge?.text ? h('div', { class: 'small muted' }, `挑战宣言：${d.challenge.text}`) : null,
    ));
  }

  function thoughtCard(t, isLive = false) {
    const c = chars.get(t.character_id ?? t.characterId) || seatChar(t.seat);
    const a = parseAnalysis(t.analysis ?? t.text);
    const q = t.eval?.quality;
    const engineE = q ? q.before : null;
    const meta = h('div', { class: 'meta' },
      t.self_winrate !== null && t.self_winrate !== undefined ? h('span', { class: 'chip', title: '模型自评胜率 / 引擎评估的胜率（走棋前）' }, `自评 ${t.self_winrate}%`, engineE !== null ? ` · 引擎 ${pct(engineE)}` : '') : null,
      qualityChip(q),
      t.latency_ms ? h('span', { class: 'chip' }, fmtMs(t.latency_ms)) : null,
      t.usage && (t.usage.input || t.usage.output) ? h('span', { class: 'chip', title: `输入 ${t.usage.input}（缓存 ${t.usage.cached}）/ 输出 ${t.usage.output}` }, `${fmtTokens(t.usage.input + t.usage.output)} tok`) : null,
    );
    const body = [];
    if (isLive) {
      if (d.options?.hideThoughts && c?.kind === 'model') body.push(h('div', { class: 'stream muted' }, '思考中…（对局结束后公开）'));
      else {
        if (t.reasoning) body.push(h('details', { open: !t.text }, h('summary', {}, `原生推理（${t.reasoning.length} 字）`), h('div', { class: 'reasoning' }, t.reasoning)));
        body.push(h('div', { class: 'stream typing' }, t.text || (c?.kind === 'model' ? '' : '思考中…')));
      }
    } else if (a) {
      body.push(h('div', { class: 'lines' }, ...LINE_KEYS.filter((k) => a[k]).flatMap((k) => [h('b', {}, k), h('span', {}, a[k])])));
    } else if (t.analysis) {
      body.push(h('div', { class: 'stream' }, t.analysis));
    }
    if (!isLive && t.reasoning) body.push(h('details', {}, h('summary', {}, `原生推理（${t.reasoning.length} 字）`), h('div', { class: 'reasoning' }, t.reasoning)));
    for (const at of t.attempts || []) body.push(h('div', { class: 'illegal' }, `✗ ${at.attempted || '无着法'}：${at.error}`));
    const moveLabel = t.label || (isLive ? '' : '（判负）');
    return h('div', { class: `thought ${t.seat}${isLive ? ' live' : ''}`, 'data-ply': t.ply },
      h('div', { class: 'head' },
        h('span', { class: 'muted small' }, `#${t.ply}`), avatar(c, 'sm'), h('b', {}, c?.name || ''),
        moveLabel ? h('span', { class: 'move' }, moveLabel) : null,
        meta),
      ...body);
  }

  function renderThoughts() {
    const cards = [];
    if (live && d.status === 'running') cards.push(thoughtCard(live, true));
    const plies = [...turns.keys()].sort((a, b) => b - a);
    for (const p of plies) cards.push(thoughtCard(turns.get(p)));
    if (!cards.length) cards.push(h('div', { class: 'empty card' }, '等待第一步…'));
    thoughts.replaceChildren(...cards);
    if (viewPly !== null) {
      const el = thoughts.querySelector(`[data-ply="${viewPly}"]`);
      el?.classList.add('focus');
      if (el) thoughts.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    }
  }

  function goto(ply) {
    const n = d.view.moves.length;
    if (ply === null || (ply >= n && d.status === 'running')) viewPly = null;
    else viewPly = Math.max(0, Math.min(n, ply));
    renderBoard(false);
    renderMoves();
    renderCurve();
    renderControls();
    renderThoughts();
  }

  function renderAll() {
    renderPlayers();
    renderBoard();
    renderCurve();
    renderMoves();
    renderControls();
    renderBanner();
    renderThoughts();
  }

  // 只更新正在思考的卡片，避免每个字都重绘整个面板
  let liveTimer = null;
  function updateLive() {
    if (liveTimer) return;
    liveTimer = requestAnimationFrame(() => {
      liveTimer = null;
      const old = thoughts.querySelector('.thought.live');
      const fresh = live ? thoughtCard(live, true) : null;
      if (old && fresh) {
        const det = old.querySelector('details');
        const wasOpen = det?.open;
        const oldReason = old.querySelector('.reasoning');
        const keepScroll = oldReason ? oldReason.scrollHeight - oldReason.scrollTop - oldReason.clientHeight < 30 : true;
        old.replaceWith(fresh);
        const nd = fresh.querySelector('details');
        if (nd && det) nd.open = wasOpen;
        const nr = fresh.querySelector('.reasoning');
        if (nr && keepScroll) nr.scrollTop = nr.scrollHeight;
      } else renderThoughts();
    });
  }

  renderAll();
  if (d.status !== 'running') goto(d.view.moves.length);

  // ---------- 实时事件 ----------
  const stop = listen([`match:${id}`], (e) => {
    switch (e.type) {
      case 'turn_start':
        live = { ply: e.ply, seat: e.seat, characterId: e.characterId, character_id: e.characterId, text: '', reasoning: '', attempts: [] };
        if (seatChar(e.seat)?.kind === 'human') { waitingHuman = e.seat; live = null; }
        renderPlayers();
        renderThoughts();
        renderBoard(false);
        renderControls();
        break;
      case 'delta':
        if (!live || live.ply !== e.ply) return;
        if (e.attempt !== live.attempt) { live.attempt = e.attempt; live.text = ''; live.reasoning = ''; }
        if (e.kind === 'text') live.text += e.text;
        else live.reasoning += e.text;
        updateLive();
        break;
      case 'illegal':
        if (live) { live.attempts.push({ attempted: e.attempted, error: e.error }); updateLive(); }
        break;
      case 'move': {
        waitingHuman = null;
        const att = live?.ply === e.ply ? live.attempts : [];
        turns.set(e.ply, {
          ply: e.ply, seat: e.seat, character_id: e.characterId, action: e.action, label: e.label,
          analysis: e.analysis, reasoning: d.options?.hideThoughts ? null : live?.reasoning || null,
          self_winrate: e.selfWinrate, latency_ms: e.latency, usage: e.usage, attempts: att, eval: turns.get(e.ply)?.eval || null,
        });
        d.view = e.view;
        live = null;
        renderAll();
        break;
      }
      case 'eval':
        if (e.ply === 0) d.options.startEval = e.eval;
        else if (turns.has(e.ply)) turns.get(e.ply).eval = e.eval;
        else turns.set(e.ply, { ply: e.ply, eval: e.eval });
        renderBoard(false);
        renderCurve();
        renderMoves();
        if (!live) renderThoughts();
        else {
          const card = thoughts.querySelector(`.thought[data-ply="${e.ply}"]`);
          if (card && turns.get(e.ply)?.seat) card.replaceWith(thoughtCard(turns.get(e.ply)));
        }
        break;
      case 'control':
        paused = e.paused;
        renderPlayers();
        renderControls();
        renderBoard(false);
        break;
      case 'end':
        api(`/matches/${id}`).then((nd) => {
          d = nd;
          for (const t of nd.turns) turns.set(t.ply, t);
          live = null;
          waitingHuman = null;
          renderAll();
          goto(d.view.moves.length);
          toast(resultText(d, d.seatNames));
        });
        break;
    }
  });
  void meta;
  return () => stop();
}
