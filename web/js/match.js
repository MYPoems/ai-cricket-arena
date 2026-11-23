// 对局页：一屏三栏。左右两栏是红黑双方的选手卡和思考，中间是棋盘、胜率条、走势和着法。

import { h, api, post, listen, toast, guard, tierBadge, avatar, fmtMs, fmtTokens, pct, MODE_NAMES, resultText } from './ui.js';
import { Board } from './board.js';
import { newGame, play } from '/games/xiangqi/rules.js';

const LINE_KEYS = ['判断', '威胁', '理由'];
const SEAT_NAME = { r: '红方', b: '黑方' };
const QUALITY_CLASS = { 最佳: 'good', 好棋: 'good', 缓着: 'warn', 失误: 'warn', 大漏着: 'bad' };

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
  return h('span', { class: `chip ${QUALITY_CLASS[q.tag] || ''}`, title: `比引擎最佳着法少 ${Math.round(q.loss * 100)} 个胜率百分点` },
    q.tag, q.loss >= 0.05 ? ` −${Math.round(q.loss * 100)}%` : '');
}

export async function matchView(root, id, { characters }) {
  let d = await api(`/matches/${id}`);
  const chars = new Map(characters.map((c) => [c.id, c]));
  const turns = new Map(d.turns.map((t) => [t.ply, t]));
  let live = d.partial ? { ...d.partial } : null;
  let viewPly = null; // null 表示跟随最新局面
  let paused = d.paused;
  let waitingHuman = d.waitingHuman;
  let offerNext = false; // 玩家本人：下一步附带提和
  const offers = () => d.options?.draw?.offers || [];
  const pendingOffer = () => { const o = offers().at(-1); return o?.status === 'pending' ? o : null; };
  const DRAW_TAG = { pending: ['提和', 'warn'], declined: ['提和被拒', ''], accepted: ['提和', 'good'], ignored: ['提和（冷却中，未送出）', ''] };

  const seatChar = (seat) => chars.get(d.seats[seat]) || d.players[seat];
  const humanSeat = ['r', 'b'].find((s) => seatChar(s)?.kind === 'human' && seatChar(s === 'r' ? 'b' : 'r')?.kind !== 'human');
  let flipped = humanSeat === 'b';

  const board = new Board({
    onMove: guard(async (iccs) => {
      await post(`/matches/${id}/move`, { action: iccs, offerDraw: offerNext });
      offerNext = false;
      waitingHuman = null;
    }),
  });
  board.setFlipped(flipped);

  // ---------- 布局 ----------
  const camp = (seat) => {
    const head = h('div', { class: 'camp-head' });
    const list = h('div', { class: 'camp-thoughts' });
    return { head, list, el: h('section', { class: `camp ${seat}` }, head, list) };
  };
  const camps = { r: camp('r'), b: camp('b') };
  const statusBar = h('div', { class: 'stage-bar' });
  const winbar = h('div', { class: 'winbar' }, h('div', { class: 'red' }), h('div', { class: 'mid' }), h('span', { class: 't' }), h('span', { class: 'b' }));
  const curve = h('div', { class: 'stage-curve' });
  const moves = h('div', { class: 'stage-moves' });

  root.replaceChildren(h('div', { class: 'arena' },
    camps.r.el,
    h('section', { class: 'stage' },
      statusBar,
      h('div', { class: 'stage-board' }, winbar, h('div', { class: 'board-wrap' }, board.el)),
      curve,
      moves,
    ),
    camps.b.el,
  ));

  // ---------- 数据 ----------
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
  function renderCamp(seat) {
    const c = seatChar(seat);
    const s = seatStats(seat);
    const thinking = d.status === 'running' && (live?.seat === seat || waitingHuman === seat);
    const change = d.rating_changes?.[d.seats[seat]];
    const won = d.status === 'finished' && d.result?.winner === seat;
    const lastQ = s.last?.eval?.quality;
    const challenger = d.challenge?.by === d.seats[seat] && d.challenge.text;
    camps[seat].el.classList.toggle('active', thinking);
    camps[seat].head.replaceChildren(
      h('div', { class: 'camp-id' },
        h('div', { class: 'camp-avatar' }, c?.avatar || '？', thinking ? h('i', { class: 'pulse' }) : null),
        h('div', { class: 'camp-name' },
          h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
            h('span', { class: `side-tag ${seat}` }, SEAT_NAME[seat]),
            h('b', {}, c?.name || '？'),
            won ? h('span', { class: 'chip good' }, '胜') : null),
          h('div', { class: 'sub' }, c?.kind === 'model' ? `${c.providerName || c.provider} · ${c.model}` : c?.kind === 'human' ? '玩家' : c?.name),
          h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } },
            c?.tier ? tierBadge(c.tier) : null,
            change ? h('span', { class: change.delta >= 0 ? 'delta-up' : 'delta-down' }, `${change.before} → ${change.after}（${change.delta >= 0 ? '+' : ''}${change.delta}）`) : null)),
      ),
      h('div', { class: 'camp-stats' },
        stat('步数', s.n),
        stat('平均用时', s.n ? fmtMs(Math.round(s.avg)) : '—'),
        stat('tokens', fmtTokens(s.tok)),
        stat('失误', s.tags.失误 + s.tags.大漏着, s.tags.大漏着 ? `其中大漏着 ${s.tags.大漏着}` : ''),
        stat('无效着法', s.illegal)),
      s.last?.self_winrate !== null && s.last?.self_winrate !== undefined
        ? h('div', { class: 'camp-gauge', title: '最近一步：模型自评胜率 / 引擎评估（走棋前）' },
          h('span', {}, '自评'), bar(s.last.self_winrate / 100, 'self'), h('b', {}, `${s.last.self_winrate}%`),
          h('span', {}, '引擎'), bar(lastQ ? lastQ.before : null, 'engine'), h('b', {}, lastQ ? pct(lastQ.before) : '—'))
        : null,
      challenger ? h('div', { class: 'camp-quote' }, `「${d.challenge.text}」`) : null,
    );
  }

  const stat = (label, value, title = '') => h('div', { class: 'cs', title }, h('b', {}, value), h('small', {}, label));
  const bar = (v, cls) => h('span', { class: `gbar ${cls}` }, h('i', { style: { width: `${v === null ? 0 : Math.round(v * 100)}%` } }));

  function renderStatus() {
    const running = d.status === 'running';
    const n = d.view.moves.length;
    const po = running ? pendingOffer() : null;
    const status = running
      ? (paused ? '已暂停' : po ? `${SEAT_NAME[po.seat]}提和，等${SEAT_NAME[po.seat === 'r' ? 'b' : 'r']}回应` : waitingHuman ? '轮到你走' : live ? `${SEAT_NAME[live.seat]}思考中` : '…')
      : resultText(d, d.seatNames);
    const btn = (label, title, fn, extra = '') => h('button', { class: `icon-btn ${extra}`, title, onclick: guard(fn) }, label);
    statusBar.replaceChildren(
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap', minWidth: 0 } },
        h('span', { class: 'chip' }, MODE_NAMES[d.mode]),
        h('span', { class: `stage-state${running ? '' : ' done'}` }, status),
        h('span', { class: 'muted small' }, viewPly === null ? `已走 ${n} 步` : `复盘 ${viewPly}/${n}`)),
      h('div', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } },
        viewPly !== null ? [
          btn('◀', '上一步', () => goto(Math.max(0, viewPly - 1))),
          btn('▶', '下一步', () => goto(Math.min(n, viewPly + 1))),
          btn('⟳', '回到最新', () => goto(null)),
        ] : null,
        running && !humanSeat ? btn(paused ? '▶' : '⏸', paused ? '继续' : '暂停', () => post(`/matches/${id}/control`, { op: paused ? 'resume' : 'pause' })) : null,
        running && paused ? btn('⏭', '单步', () => post(`/matches/${id}/control`, { op: 'step' })) : null,
        running && waitingHuman && po && po.seat !== waitingHuman ? h('button', { class: 'btn sm primary', onclick: guard(() => post(`/matches/${id}/control`, { op: 'accept_draw' })) }, '接受和棋') : null,
        running && waitingHuman && !po ? h('button', { class: `btn sm${offerNext ? ' primary' : ''}`, title: '走下一步时同时向对方提出和棋', onclick: () => { offerNext = !offerNext; renderStatus(); } }, offerNext ? '走棋时提和 ✓' : '提和') : null,
        running && waitingHuman ? btn('🏳', '认输', async () => { if (confirm('确定认输？')) await post(`/matches/${id}/control`, { op: 'resign' }); }) : null,
        running && d.mode === 'casual' ? btn('■', '中止对局', async () => { if (confirm('中止这盘棋？')) await post(`/matches/${id}/control`, { op: 'abort' }); }) : null,
        btn('⇅', '翻转棋盘', () => { flipped = !flipped; board.setFlipped(flipped); renderBoard(false); }),
        h('a', { class: 'icon-btn', title: '导出棋谱', href: `/api/matches/${id}/export` }, '⤓'),
      ),
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
    if (!latest && ply < d.view.moves.length && d.status !== 'running') {
      const best = ply === 0 ? d.options?.startEval?.best : turns.get(ply)?.eval?.raw?.best;
      if (best) arrows.push({ iccs: best, kind: 'best' });
    }
    const movable = latest && d.status === 'running' && waitingHuman && !paused ? waitingHuman : null;
    board.render({ board: boardArr, side, lastMove, inCheck, movable, arrows }, { animate });
    // 胜率条：红方期望得分
    let e = null;
    for (let p = ply; p >= 0 && e === null; p--) e = redEAt(p);
    const red = e ?? 0.5;
    winbar.classList.toggle('flip', flipped);
    winbar.querySelector('.red').style.height = `${red * 100}%`;
    winbar.querySelector('.t').textContent = Math.round((1 - red) * 100);
    winbar.querySelector('.b').textContent = Math.round(red * 100);
    winbar.title = `红方胜率 ${Math.round(red * 100)}%（${d.options?.startEval?.source === 'pikafish' ? 'Pikafish' : '内置 AI 粗略'}评估）`;
  }

  function renderCurve() {
    const n = d.view.moves.length;
    const W = 600, H = 60;
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
      <rect class="bk" x="0" y="0" width="${W}" height="${H / 2}"/>
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
      svgEl,
      h('div', { class: 'curve-legend' }, h('span', { class: 'lg-engine' }, '引擎'), h('span', { class: 'lg-self' }, '自评')),
    );
  }

  function renderMoves() {
    const mv = d.view.moves;
    const cur = viewPly ?? mv.length;
    const items = [];
    for (let i = 0; i < mv.length; i += 2) {
      const cell = (j) => {
        if (j >= mv.length) return null;
        const q = turns.get(j + 1)?.eval?.quality;
        return h('span', { class: `mv ${j % 2 ? 'b' : 'r'}${cur === j + 1 ? ' on' : ''}`, onclick: () => goto(j + 1), title: q ? q.tag : '' },
          q ? h('i', { class: `q q-${q.tag}` }) : null, mv[j].cn);
      };
      items.push(h('span', { class: 'mvpair' }, h('em', {}, i / 2 + 1), cell(i), cell(i + 1)));
    }
    moves.replaceChildren(...(items.length ? items : [h('span', { class: 'muted small' }, '还没有走棋')]));
    if (viewPly === null) moves.scrollTop = moves.scrollHeight;
    else {
      const on = moves.querySelector('.mv.on');
      if (on) moves.scrollTop = on.offsetTop - moves.clientHeight / 2;
    }
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
    for (const at of t.attempts || []) body.push(h('div', { class: 'illegal' }, `✗ ${at.attempted || '无着法'}：${at.error}`));
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

  function renderThoughts() {
    for (const seat of ['r', 'b']) {
      const cards = [];
      if (live && live.seat === seat && d.status === 'running') cards.push(thoughtCard(live, true));
      const plies = [...turns.keys()].filter((p) => turns.get(p).seat === seat).sort((a, b) => b - a);
      for (const p of plies) cards.push(thoughtCard(turns.get(p)));
      if (!cards.length) cards.push(h('div', { class: 'camp-empty' }, d.status === 'running' ? '等待出手' : '没有记录'));
      const list = camps[seat].list;
      list.replaceChildren(...cards);
      if (viewPly !== null) {
        const el = list.querySelector(`[data-ply="${viewPly}"]`);
        if (el) {
          el.classList.add('focus');
          list.scrollTo({ top: el.offsetTop - 6, behavior: 'smooth' });
        }
      } else list.scrollTop = 0;
    }
  }

  function goto(ply) {
    const n = d.view.moves.length;
    if (ply === null || (ply >= n && d.status === 'running')) viewPly = null;
    else viewPly = Math.max(0, Math.min(n, ply));
    renderStatus();
    renderBoard(false);
    renderMoves();
    renderCurve();
    renderThoughts();
  }

  function renderAll() {
    renderCamp('r');
    renderCamp('b');
    renderStatus();
    renderBoard();
    renderCurve();
    renderMoves();
    renderThoughts();
  }

  // 只更新正在思考的卡片，避免每个字都重绘整栏
  let liveTimer = null;
  function updateLive() {
    if (liveTimer) return;
    liveTimer = requestAnimationFrame(() => {
      liveTimer = null;
      if (!live) return;
      const list = camps[live.seat].list;
      const old = list.querySelector('.thought.live');
      const fresh = thoughtCard(live, true);
      if (!old) { renderThoughts(); return; }
      const det = old.querySelector('details');
      const oldReason = old.querySelector('.reasoning');
      const keepBottom = oldReason ? oldReason.scrollHeight - oldReason.scrollTop - oldReason.clientHeight < 30 : true;
      old.replaceWith(fresh);
      const nd = fresh.querySelector('details');
      if (nd && det) nd.open = det.open;
      const nr = fresh.querySelector('.reasoning');
      if (nr && keepBottom) nr.scrollTop = nr.scrollHeight;
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
        renderCamp('r');
        renderCamp('b');
        renderStatus();
        renderThoughts();
        renderBoard(false);
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
      case 'eval': {
        if (e.ply === 0) d.options.startEval = e.eval;
        else if (turns.has(e.ply)) turns.get(e.ply).eval = e.eval;
        else turns.set(e.ply, { ply: e.ply, eval: e.eval });
        renderBoard(false);
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
  return () => stop();
}
