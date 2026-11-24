// 大厅：一进来就能看到最精彩的一盘（今日擂台）、场上在发生什么（对局墙）、一键开一盘（快速开始）。

import { h, api, post, guard, toast, listen, fmtTime, MODE_NAMES, resultText, tierBadge, emptyState, linkRow, pressed, cleanName, summarizeSeats } from './ui.js';
import { loadRenderer } from '../stage/index.js';

const renderers = {};
async function preload(list) {
  for (const m of list) if (!renderers[m.game]) renderers[m.game] = await loadRenderer(m.game).catch(() => null);
}

const who = (p) => (p?.kind === 'model' ? p.model : p?.kind === 'agent' ? '自带 Agent' : p?.kind === 'human' ? '真人' : p?.kind === 'builtin' ? '内置 AI' : p?.kind === 'engine' ? ({ pikafish: 'Pikafish', rapfi: 'Rapfi', stockfish: 'Stockfish' }[p.provider || 'pikafish'] || '引擎') : '随机');
const HOT_RE = /炸弹|王炸|全下|将军|将死|\+|绝杀|出局|死亡|背叛|春天/;
const SORTS = [['hot', '最精彩'], ['new', '最新'], ['tier', '排位优先']];
/** 隐藏信息游戏（斗地主、德州、狼人杀、卧底…）没有公开的着法，用当前阶段说明进度 */
function phaseOf(v) {
  if (!v) return '';
  if (v.handNo) return `第 ${v.handNo}${v.hands ? `/${v.hands}` : ''} 手${v.streetName ? ` · ${v.streetName}` : ''}`;
  if (v.day) return `第 ${v.day} ${v.night ? '夜' : '天'}${v.phaseName ? ` · ${v.phaseName}` : ''}`;
  if (v.phase === 'bid') return '叫地主';
  if (v.trickNo) return `第 ${v.trickNo} 轮`;
  if (v.round) return `第 ${v.round} 轮`;
  return '';
}
/** 进度：第 N 手 · 刚走的着法；还没走过就是「等待第一手」 */
const progress = (m) => (m.lastLabel ? `第 ${m.plies} 手 · ${m.lastLabel}` : phaseOf(m.view) || (m.plies ? `第 ${m.plies} 手` : '等待第一手'));
const nm = (p) => cleanName(p?.name);
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem(`lobby.${k}`); localStorage.setItem(`lobby.${k}`, v); } catch { /* 本机存不了就算了 */ } return null; };

/** 精彩程度：有高光、在思考、胜率胶着、排位赛 */
function heat(m) {
  let s = 0;
  if (m.hot) s += 5;
  if (m.thinking && !m.paused) s += 1;
  if (m.redE !== null && m.redE !== undefined) s += 2 * (1 - Math.abs(m.redE - 0.5) * 2);
  if (m.mode !== 'casual') s += 1.5;
  s += Math.min(2, m.plies / 40);
  return s;
}

export async function lobbyView(root, { go, session, meta }) {
  let [data, rooms] = await Promise.all([api('/lobby'), api('/rooms').catch(() => [])]);
  await preload(data.live);
  const cards = new Map();
  let stopEvents = null;
  let filter = pref('game') || 'all';
  let sort = pref('sort') || 'hot';

  const hero = h('section', { class: 'card framed hero' });
  const side = h('aside', { class: 'col' });
  const filters = h('div', { class: 'filters' });
  const grid = h('div', { class: 'mgrid' });
  const roomBox = h('div');
  const recent = h('div');

  root.replaceChildren(h('div', { class: 'lobby' },
    h('div', { class: 'col', style: { minWidth: 0, gap: '0' } }, hero, roomBox, filters, grid,
      h('section', { class: 'section-gap' }, h('div', { class: 'section-title' }, h('h2', {}, '最近结束'), h('a', { href: '#/history', class: 'small' }, '全部对局 →')), recent)),
    side));

  // ---------- 今日擂台 ----------
  function drawHero() {
    const pick = [...data.live].sort((a, b) => heat(b) - heat(a))[0];
    if (!pick) {
      const last = data.recent[0];
      hero.replaceChildren(h('div', { class: 'lattice' }), h('span', { class: 'wm' }, '斗'),
        h('span', { class: 'hero-tag' }, '今日擂台 · 虚位以待'),
        h('div', { class: 'hero-mid', style: { justifySelf: 'center' } },
          h('div', { class: 'vs' }, '擂台空着'),
          h('div', { class: 'state' }, '现在没有对局。开一盘、组个局，或者打开天梯自动匹配。'),
          h('div', { class: 'row', style: { justifyContent: 'center' } }, quickAiMatch(true), h('a', { class: 'btn', href: '#/rooms' }, '去组局'),
            last ? h('a', { class: 'btn ghost', href: `#/match/${last.id}` }, '看上一盘回放') : null)));
      return;
    }
    const seats = Object.keys(pick.players);
    const two = seats.length === 2;
    const P = (s) => h('div', { class: 'hero-p' }, h('span', { class: 'coin moon' }, pick.players[s]?.avatar || '？'), h('b', { class: 'gold-text' }, nm(pick.players[s])), h('small', {}, `${pick.seatNames?.[s] || s} · ${who(pick.players[s])}`));
    const e = pick.redE ?? 0.5;
    const tug = pick.features?.winbar ? h('div', { class: 'tug' }, h('span', {}, `${Math.round(e * 100)}%`), h('div', { class: 'bar' }, h('i', { class: 'l', style: { width: `${e * 100}%` } }), h('i', { class: 'r' }), h('span', { class: 'knot', style: { left: `${e * 100}%` } })), h('span', {}, `${100 - Math.round(e * 100)}%`)) : null;
    const reason = pick.hot ? '高光时刻' : pick.redE !== null && pick.redE !== undefined && Math.abs(pick.redE - 0.5) < 0.12 ? '胜率胶着' : pick.mode !== 'casual' ? '排位进行中' : '正在进行';
    hero.replaceChildren(h('div', { class: 'lattice' }), h('span', { class: 'wm' }, '擂'),
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'hero-tag' }, `今日擂台 · ${reason}`), h('span', { class: 'small muted' }, `${pick.gameName} · ${MODE_NAMES[pick.mode]}${pick.lastLabel || !phaseOf(pick.view) ? (pick.plies ? ` · 第 ${pick.plies} 手` : '') : ` · ${phaseOf(pick.view)}`}`)),
      two
        ? h('div', { class: 'hero-vs' }, P(seats[0]), h('div', { class: 'hero-mid' }, h('div', { class: 'vs' }, '对'), tug, h('div', { class: 'state' }, pick.lastLabel ? ['刚走 ', h('b', {}, pick.lastLabel)] : phaseOf(pick.view) || (pick.plies ? `第 ${pick.plies} 手` : '等待第一手'), pick.thinking ? ` · ${pick.seatNames?.[pick.thinking] || ''}思考中` : ''), h('a', { class: 'btn primary', href: `#/match/${pick.id}` }, '进入观战')), P(seats[1]))
        : h('div', { class: 'hero-mid', style: { justifySelf: 'stretch' } },
          h('div', { class: 'row', style: { justifyContent: 'center', gap: '18px' } }, ...seats.map((s) => h('div', { class: 'hero-p' }, h('span', { class: 'coin', style: { width: '56px', height: '56px', fontSize: '30px' } }, pick.players[s]?.avatar || '？'), h('small', {}, nm(pick.players[s]))))),
          h('div', { class: 'state' }, pick.lastLabel ? ['最新：', h('b', {}, pick.lastLabel)] : phaseOf(pick.view) || (pick.plies ? `第 ${pick.plies} 手` : '等待第一手')),
          h('a', { class: 'btn primary', href: `#/match/${pick.id}` }, '进入观战')));
  }

  /** 快速开始：随机挑两名系统选手和一个双人游戏，开一盘娱乐赛直接观战 */
  function quickAiMatch(primary = false) {
    return h('button', { class: `btn ${primary ? 'primary' : ''}`, onclick: guard(async () => {
      if (!session.user) { go('#/login'); return; }
      const chars = await api('/characters');
      const games = meta.games.filter((g) => g.players.min === 2);
      for (let tries = 0; tries < 10; tries++) {
        const g = games[Math.floor(Math.random() * games.length)];
        const pool = chars.filter((c) => c.system && c.kind !== 'human' && (c.kind !== 'engine' || (c.provider || 'pikafish') === g.features?.evalEngine));
        if (pool.length < 2) continue;
        const a = pool[Math.floor(Math.random() * pool.length)];
        const b = pool.filter((c) => c.id !== a.id)[Math.floor(Math.random() * (pool.length - 1))];
        const seats = Object.fromEntries(g.seats.map((s, i) => [s, (i ? b : a).id]));
        const r = await post('/matches', { game: g.id, seats, mode: 'casual' });
        go(`#/match/${r.id}`);
        return;
      }
      toast('没有能凑成一盘的选手', true);
    }) }, '看一盘 AI 对决');
  }

  // ---------- 右栏 ----------
  function drawSide() {
    side.replaceChildren(
      h('div', { class: 'figs' },
        ...[[data.live.length, '进行中'], [data.today, '今日开局'], [data.rooms, '等人组局'], [data.total, '累计完赛']].map(([n, l]) => h('div', { class: 'card quiet fig' }, h('b', { class: 'gold-text' }, n), h('small', {}, l)))),
      h('div', { class: 'card pad col', style: { gap: '12px' } }, h('div', { class: 'label' }, '快速开始'),
        h('div', { class: 'quick' }, quickAiMatch(true),
          h('a', { class: 'btn', href: '#/new' }, '我来挑战一只蛐蛐'),
          h('a', { class: 'btn', href: '#/rooms' }, '开一个组局'),
          h('a', { class: 'btn', href: '#/agent-guide' }, '让我的 Agent 上场'))),
      data.tops.length ? h('div', { class: 'card quiet pad col', style: { gap: '8px' } }, h('div', { class: 'label' }, '天梯榜首'),
        h('div', { class: 'side-list' }, ...data.tops.slice(0, 6).map((t) => h('a', { class: 'it', href: `#/characters/${t.id}` }, h('span', { class: 'k' }, t.gameName), h('span', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap', minWidth: 0 } }, h('span', { class: 'coin sm' }, t.avatar), h('b', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, cleanName(t.name))), h('span', { class: 'num' }, t.points))))) : null,
      data.log.length ? h('div', { class: 'card quiet pad col', style: { gap: '8px' } }, h('div', { class: 'label' }, '动态'),
        h('div', { class: 'feed' }, ...data.log.map((x) => h('div', { class: /晋级|王者|连胜|爆冷/.test(x.text) ? 'hot' : '' }, x.text)))) : null);
  }

  // ---------- 等人入座的组局 ----------
  function drawRooms() {
    roomBox.replaceChildren(rooms.length ? h('section', { style: { marginTop: 'var(--s5)' } },
      h('div', { class: 'section-title' }, h('h2', {}, '等人入座的组局'), h('a', { href: '#/rooms', class: 'small' }, '全部组局 →')),
      h('div', { class: 'rooms' }, ...rooms.slice(0, 3).map((r) => h('a', { class: 'card room', href: `#/room/${r.id}` },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 't' }, r.title), h('span', { class: 'chip' }, r.gameName)),
        h('div', { class: 'slots' }, ...Object.values(r.seats).map((s) => s ? h('span', { class: 'coin sm', title: cleanName(s.character.name) }, s.character.avatar) : h('span', { class: 'slot-dot' }, '＋'))),
        h('div', { class: 'small muted' }, `${r.filled}/${r.players} 人 · 房主 ${r.host?.name || '—'}`))))) : null);
  }

  // ---------- 对局墙 ----------
  function drawFilters() {
    const count = (id) => data.live.filter((m) => m.game === id).length;
    // 记住的筛选在场上已经没有对局时也留着这颗胶囊（显示 0），空状态里给「看全部」
    const games = meta.games.filter((g) => count(g.id) || g.id === filter);
    filters.replaceChildren(
      h('div', { class: 'pills', role: 'group', 'aria-label': '按游戏筛选' },
        h('button', { class: `pill ${filter === 'all' ? 'on' : ''}`, type: 'button', ...pressed(filter === 'all'), onclick: () => setFilter('all') }, `全部 ${data.live.length}`),
        ...games.map((g) => h('button', { class: `pill ${filter === g.id ? 'on' : ''}`, type: 'button', ...pressed(filter === g.id), onclick: () => setFilter(g.id) }, `${g.name} ${count(g.id)}`))),
      h('span', { class: 'grow' }),
      h('select', { style: { width: 'auto' }, 'aria-label': '排序', onchange: (e) => { sort = e.target.value; pref('sort', sort); drawGrid(); } }, ...SORTS.map(([k, l]) => h('option', { value: k, selected: sort === k }, `排序：${l}`))));
  }
  function setFilter(id) { filter = id; pref('game', id); drawFilters(); drawGrid(); }

  function card(m) {
    const r = renderers[m.game];
    const stage = r ? r.createStage({ onAction: () => {} }) : { el: h('div'), render() {} };
    const head = h('div', { class: 'g' });
    const hl = h('div', { class: 'hl' });
    const sub = h('div', { class: 'sub' });
    const whoRow = h('div', { class: 'who' });
    const el = h('a', { class: 'card mcard', href: `#/match/${m.id}`, style: { gridTemplateColumns: '1fr' } },
      head, h('div', { class: 'mthumb', style: { width: '100%', height: '200px' } }, h('div', { class: 'board-wrap', style: { width: '100%', height: '100%' } }, stage.el)), hl, whoRow, sub);
    const c = { el, stage, head, hl, sub, whoRow, m };
    paint(c, false);
    return c;
  }

  function paint(c, animate = true) {
    const m = c.m;
    try { c.stage.render(m.view, { movable: null, arrows: [], animate }); } catch { /* 缩略画面画不出来时不影响卡片 */ }
    c.el.classList.toggle('hot', !!m.hot);
    c.head.replaceChildren(h('span', {}, m.gameName, h('span', { class: 'small muted', style: { marginLeft: '8px', fontFamily: 'var(--sans)', fontWeight: 400 } }, MODE_NAMES[m.mode])),
      m.paused ? h('span', { class: 'small muted' }, '已暂停') : m.thinking ? h('span', { class: 'thinking-dot' }, `${m.seatNames?.[m.thinking] || ''}思考中`) : null);
    c.hl.textContent = progress(m);
    const seats = Object.keys(m.players);
    c.whoRow.replaceChildren(...seats.slice(0, 6).map((s) => h('span', { class: 'coin', title: nm(m.players[s]) }, m.players[s]?.avatar || '？')),
      h('span', { title: seats.map((s) => nm(m.players[s])).join('、') }, seats.length === 2 ? summarizeSeats(seats.map((s) => m.players[s]?.name)) : `${seats.length} 人 · ${summarizeSeats(seats.map((s) => m.players[s]?.name))}`));
    c.sub.textContent = `开局 ${fmtTime(m.started_at)}`;
  }

  function drawGrid() {
    const ids = new Set(data.live.map((m) => m.id));
    for (const id of [...cards.keys()]) if (!ids.has(id)) cards.delete(id);
    let list = data.live.filter((m) => filter === 'all' || m.game === filter);
    list = sort === 'new' ? list.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
      : sort === 'tier' ? list.sort((a, b) => (b.mode !== 'casual') - (a.mode !== 'casual') || heat(b) - heat(a))
        : list.sort((a, b) => heat(b) - heat(a));
    if (!list.length) {
      const e = data.live.length
        ? emptyState('这个游戏现在没有对局。', { wm: '静', action: h('button', { class: 'btn primary', type: 'button', onclick: () => setFilter('all') }, '看全部') })
        : emptyState('场上暂时没有对局。', { wm: '静', action: quickAiMatch(true) });
      e.style.gridColumn = '1 / -1';
      grid.replaceChildren(e);
      return;
    }
    grid.replaceChildren(...list.map((m) => {
      let c = cards.get(m.id);
      if (!c) { c = card(m); cards.set(m.id, c); } else { c.m = { ...c.m, ...m, hot: c.m.hot || m.hot }; paint(c, false); }
      return c.el;
    }));
  }

  function drawRecent() {
    if (!data.recent.length) { recent.replaceChildren(emptyState('还没有结束的对局。', { wm: '局', action: h('a', { class: 'btn primary', href: '#/new' }, '开一局') })); return; }
    recent.replaceChildren(h('div', { class: 'card table-wrap' }, h('table', { class: 'list recent-list' },
      ...data.recent.slice(0, 8).map((m) => {
        const names = Object.values(m.players).map((pl) => pl?.name);
        const who = summarizeSeats(names);
        return linkRow(`#/match/${m.id}`, [
          h('td', { class: 'c-game' }, h('span', { class: 'chip' }, m.gameName)),
          h('td', { class: 'c-players', title: names.map(cleanName).join('、') }, who),
          h('td', { class: 'c-result muted', style: { whiteSpace: 'normal' } }, resultText(m)),
          h('td', { class: 'c-time num muted' }, fmtTime(m.finished_at || m.created_at))], { label: `${m.gameName}：${who}，${resultText(m)}` });
      }))));
  }

  function subscribe() {
    stopEvents?.();
    const chans = ['lobby', ...data.live.map((m) => `match:${m.id}`)];
    stopEvents = listen(chans, (e) => {
      if (e.ch === 'lobby') {
        if (e.type === 'match_created' || e.type === 'match_finished' || e.type === 'room_updated') reload();
        return;
      }
      const id = e.ch.slice(6);
      const c = cards.get(id);
      if (!c) return;
      if (e.type === 'turn_start') { c.m.thinking = e.seat; paint(c, false); }
      else if (e.type === 'move') {
        if (!e.view) { reload(); return; }
        Object.assign(c.m, { view: e.view, lastMove: e.action, lastLabel: e.label, plies: e.ply, thinking: null });
        if (e.label && HOT_RE.test(e.label)) c.m.hot = true;
        paint(c, true);
        c.el.classList.remove('flash'); void c.el.offsetWidth; c.el.classList.add('flash');
      } else if (e.type === 'eval') {
        if (e.eval?.quality?.tag === '大漏着') c.m.hot = true;
        if (e.eval?.redE !== undefined) c.m.redE = e.eval.redE;
        paint(c, false);
      } else if (e.type === 'control') { c.m.paused = e.paused; paint(c, false); }
      else if (e.type === 'end') reload();
    });
  }

  let reloading = null;
  async function reload() {
    if (reloading) return;
    reloading = setTimeout(async () => {
      reloading = null;
      [data, rooms] = await Promise.all([api('/lobby'), api('/rooms').catch(() => [])]);
      await preload(data.live);
      drawAll();
      subscribe();
    }, 400);
  }

  function drawAll() { drawHero(); drawSide(); drawRooms(); drawFilters(); drawGrid(); drawRecent(); }
  drawAll();
  subscribe();
  void tierBadge;
  return () => { stopEvents?.(); clearTimeout(reloading); };
}
