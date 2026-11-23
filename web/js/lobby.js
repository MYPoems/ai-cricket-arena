// 对战大厅：正在进行的对局实时更新（缩略棋盘、胜率、谁在思考、最新一手），以及最近结束的对局。

import { h, api, listen, fmtTime, MODE_NAMES, resultText } from './ui.js';
import { loadRenderer } from '../stage/index.js';

const renderers = {};
async function preload(list) {
  for (const m of list) if (!renderers[m.game]) renderers[m.game] = await loadRenderer(m.game).catch(() => null);
}


function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return '刚刚开局';
  if (s < 3600) return `开局 ${Math.floor(s / 60)} 分钟`;
  return `开局 ${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
}

const who = (p) => (p?.kind === 'model' ? p.model : p?.kind === 'agent' ? 'Agent' : p?.kind === 'human' ? '玩家' : p?.kind === 'builtin' ? '内置 AI' : p?.kind === 'engine' ? ({ pikafish: 'Pikafish', rapfi: 'Rapfi', stockfish: 'Stockfish' }[p.provider || 'pikafish'] || '引擎') : '随机走子');

export async function lobbyView(root, { go }) {
  let data = await api('/lobby');
  await preload(data.live);
  const cards = new Map(); // id → { el, board, state }
  let stopEvents = null;

  const figs = h('div', { class: 'lobby-figs' });
  const grid = h('div');
  const recent = h('div');

  root.replaceChildren(
    h('header', { class: 'lobby-head' },
      h('div', {},
        h('div', { class: 'label kicker' }, '电子斗蛐蛐 · 实时对局'),
        h('h1', {}, '对战大厅')),
      figs),
    grid,
    h('section', { style: { marginTop: '56px' } },
      h('div', { class: 'section-title' }, h('h2', {}, '最近结束'), h('a', { href: '#/history', class: 'label' }, '全部对局 →')),
      recent),
  );

  function drawFigs() {
    figs.replaceChildren(
      h('div', {}, h('b', {}, data.live.length), h('span', { class: 'label' }, '进行中')),
      h('div', {}, h('b', {}, data.today), h('span', { class: 'label' }, '今日开局')),
      h('div', {}, h('b', {}, data.total), h('span', { class: 'label' }, '累计完赛')),
      h('a', { class: 'btn primary', href: '#/new', style: { alignSelf: 'center' } }, '开一局'),
    );
  }

  function card(m) {
    const r = renderers[m.game];
    const board = r ? r.createStage({ onAction: () => {} }) : { el: h('div'), render() {} };
    const winbar = h('div', { class: 'winbar' }, h('div', { class: 'red' }), h('div', { class: 'mid' }), h('span', { class: 't' }), h('span', { class: 'b' }));
    const top = h('div', { class: 'mc-top' });
    const vs = h('div', { class: 'mc-vs' });
    const foot = h('div', { class: 'mc-foot' });
    const el = h('a', { class: 'match-card', href: `#/match/${m.id}` },
      top, vs, h('div', { class: 'mc-board' }, winbar, h('div', { class: 'board-wrap' }, board.el)), foot);
    if (!m.features?.winbar) winbar.style.display = 'none';
    const c = { el, board, winbar, top, vs, foot, m };
    paint(c, false);
    return c;
  }

  function paint(c, animate = true) {
    const m = c.m;
    c.board.render(m.view, { movable: null, arrows: [], animate });
    const red = m.redE ?? 0.5;
    c.winbar.querySelector('.red').style.height = `${red * 100}%`;
    const first = Object.keys(m.players)[0];
    c.winbar.title = `${m.seatNames?.[first] || ''}胜率 ${Math.round(red * 100)}%`;
    const state = m.paused ? '已暂停' : m.thinking ? `${m.seatNames?.[m.thinking] || m.thinking}思考中` : '等待中';
    c.top.replaceChildren(
      h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'chip' }, m.gameName), h('span', { class: 'chip' }, MODE_NAMES[m.mode] || m.mode)),
      h('span', { class: 'label', style: { color: m.thinking && !m.paused ? 'var(--red)' : '' } }, `${state} · 第 ${m.plies} 步`));
    const seatsOf = Object.keys(m.players);
    const p = (seat) => h('div', { class: `mc-p ${seatsOf.indexOf(seat) === 0 ? 'r' : 'b'}` },
      h('b', { class: m.thinking === seat && !m.paused ? 'on' : '' }, m.players[seat]?.name || '？'),
      h('small', {}, who(m.players[seat])));
    if (seatsOf.length === 2) c.vs.replaceChildren(p(seatsOf[0]), h('span', { class: 'mc-x' }, 'vs'), p(seatsOf[1]));
    else c.vs.replaceChildren(h('div', { class: 'mc-p', style: { gridColumn: '1 / -1' } }, h('b', {}, seatsOf.map((s) => m.players[s]?.name).join(' · ')), h('small', {}, `${seatsOf.length} 人`)));
    c.foot.replaceChildren(
      h('span', {}, m.lastLabel ? h('span', {}, '最新一手 ', h('span', { class: 'mc-last' }, m.lastLabel)) : '尚未落子'),
      h('span', {}, ago(m.started_at)));
  }

  function drawGrid() {
    const ids = new Set(data.live.map((m) => m.id));
    for (const id of [...cards.keys()]) if (!ids.has(id)) cards.delete(id);
    if (!data.live.length) {
      grid.replaceChildren(h('div', { class: 'lobby-empty' },
        h('div', { style: { fontSize: '20px', color: 'var(--text)' } }, '场上暂时没有对局'),
        h('div', {}, '开一局，或者在天梯里打开自动匹配，对局开始后会出现在这里。'),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('a', { class: 'btn primary', href: '#/new' }, '开一局'), h('a', { class: 'btn', href: '#/ladder' }, '去天梯'))));
      return;
    }
    const els = data.live.map((m) => {
      let c = cards.get(m.id);
      if (!c) { c = card(m); cards.set(m.id, c); } else { c.m = m; paint(c, false); }
      return c.el;
    });
    grid.replaceChildren(h('div', { class: 'live-grid' }, ...els));
  }

  function drawRecent() {
    if (!data.recent.length) { recent.replaceChildren(h('div', { class: 'empty' }, '还没有结束的对局')); return; }
    recent.replaceChildren(h('ol', { class: 'toc' }, ...data.recent.map((m, i) => h('li', {},
      h('a', { href: `#/match/${m.id}` },
        h('span', { class: 'no' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 't' }, h('span', { class: 'muted', style: { fontSize: '12px', marginRight: '8px' } }, m.gameName), ...Object.values(m.players).flatMap((pl, i) => (i ? ['  对  ', pl?.name] : [h('span', { class: 'r' }, pl?.name)]))),
        h('span', { class: 'd' }, resultText(m)),
        h('span', { class: 'd' }, `${m.plies} 步 · ${fmtTime(m.finished_at || m.created_at)}`),
        h('span', { class: 'go' }, '→'))))));
  }

  function subscribe() {
    stopEvents?.();
    const chans = ['lobby', ...data.live.map((m) => `match:${m.id}`)];
    stopEvents = listen(chans, (e) => {
      if (e.ch === 'lobby') {
        if (e.type === 'match_created' || e.type === 'match_finished') reload();
        return;
      }
      const id = e.ch.slice(6);
      const c = cards.get(id);
      if (!c) return;
      if (e.type === 'turn_start') { c.m.thinking = e.seat; paint(c, false); }
      else if (e.type === 'move') {
        if (!e.view) { reload(); return; }
        Object.assign(c.m, { view: e.view, lastMove: e.action, lastLabel: e.label, plies: e.ply, thinking: null });
        paint(c, true);
      } else if (e.type === 'eval' && e.eval?.redE !== undefined) { c.m.redE = e.eval.redE; paint(c, false); }
      else if (e.type === 'control') { c.m.paused = e.paused; paint(c, false); }
      else if (e.type === 'end') reload();
    });
  }

  let reloading = null;
  async function reload() {
    if (reloading) return;
    reloading = setTimeout(async () => {
      reloading = null;
      data = await api('/lobby');
      await preload(data.live);
      drawFigs();
      drawGrid();
      drawRecent();
      subscribe();
    }, 300);
  }

  drawFigs();
  drawGrid();
  drawRecent();
  subscribe();
  const tick = setInterval(() => { for (const c of cards.values()) paint(c, false); }, 30000);
  void go;
  return () => { stopEvents?.(); clearInterval(tick); clearTimeout(reloading); };
}
