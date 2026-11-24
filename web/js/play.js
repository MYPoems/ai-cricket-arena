// 开局：选游戏、人数和各座位的选手。

import { h, api, post, guard, avatar, modelLine, MODE_NAMES, listen, pageHead, pressed, icon, cleanName, summarizeSeats } from './ui.js';

export async function playView(root, { meta, characters, go, session }) {
  // 排位赛由天梯自动匹配产生；只有庄家能手动开排位（测试用）
  const canRanked = session.user?.role === 'admin';
  const [liveMatches, puzzles] = await Promise.all([api('/matches?status=running&limit=30'), api('/puzzles')]);
  const games = meta.games;
  const pickable = characters.filter((c) => !c.archived);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const sel = {
    game: games.find((g) => g.id === q.get('game'))?.id || games[0].id,
    players: null, seats: {}, mode: 'casual', showLegal: true, delayMs: 600, start: 'opening', fen: '',
  };
  const game = () => games.find((g) => g.id === sel.game);

  /** 当前游戏的座位 id（人数可变的游戏按选定人数） */
  function seatIds() {
    const g = game();
    const n = sel.players || g.players.default;
    const all = Object.keys(g.seatNames);
    return n === g.seats.length ? g.seats : all.slice(0, n);
  }

  /** 这名选手能不能下当前游戏：引擎只下自己的游戏 */
  const fits = (c) => c.kind !== 'engine' || (c.provider || 'pikafish') === game().features?.evalEngine;

  function defaults() {
    const ids = seatIds();
    const me = pickable.find((c) => c.kind === 'human');
    const ai = pickable.filter((c) => fits(c) && c.kind !== 'human');
    sel.seats = {};
    ids.forEach((s, i) => { sel.seats[s] = i === 0 && me ? me.id : (ai[(i - (me ? 1 : 0)) % Math.max(1, ai.length)] || ai[0])?.id; });
  }

  const gameSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '游戏' });
  /** 选中的游戏写进地址栏（不新增历史记录），刷新后还是这个游戏 */
  const syncUrl = () => history.replaceState(history.state, '', sel.game === games[0].id ? '#/new' : `#/new?game=${sel.game}`);
  const playersSel = h('span');
  const seatsBox = h('div', { class: 'col', style: { gap: '18px' } });
  const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '模式' });
  const startSel = h('select', { onchange: (e) => { sel.start = e.target.value; redraw(); } },
    ...puzzles.map((p) => h('option', { value: p.id }, p.title)), h('option', { value: 'fen' }, '自定义 FEN'));
  const fenInput = h('input', { type: 'text', placeholder: 'rnbakabnr/9/1c5c1/… w - - 0 1', oninput: (e) => { sel.fen = e.target.value; } });
  const legalSw = h('input', { type: 'checkbox', checked: true, onchange: (e) => { sel.showLegal = e.target.checked; } });
  const delayLabel = h('span', { class: 'small muted' }, '0.6 秒');
  const delay = h('input', { type: 'range', min: 0, max: 3000, step: 200, value: sel.delayMs, oninput: (e) => { sel.delayMs = Number(e.target.value); delayLabel.textContent = `${(sel.delayMs / 1000).toFixed(1)} 秒`; } });
  const startExtra = h('div', { class: 'col', style: { gap: '8px' } });
  const summary = h('div', { class: 'start-sum' });

  function seatBox(seat) {
    const box = h('div', { class: 'seat-pick', role: 'group', 'aria-label': `${game().seatNames[seat] || seat}的选手` });
    const others = Object.entries(sel.seats).filter(([s]) => s !== seat).map(([, id]) => id);
    box.replaceChildren(...pickable.filter(fits).map((c) => {
      const dis = sel.mode === 'ranked' && (!c.ranked || (!c.system && others.includes(c.id)));
      const on = sel.seats[seat] === c.id;
      return h('button', {
        type: 'button',
        class: `pick${on ? ' on' : ''}${dis ? ' dis' : ''}`,
        ...pressed(on),
        'aria-disabled': dis ? 'true' : null,
        title: dis ? (others.includes(c.id) ? '排位赛里同一名选手不能占多个座位' : '本机订阅和自定义接口只能下娱乐赛') : modelLine(c),
        onclick: () => { if (dis) return; sel.seats[seat] = c.id; redraw(); },
      }, on ? h('span', { class: 'pick-check' }, icon('check', 16)) : avatar(c, 'sm'), h('span', { class: 't' }, h('span', {}, cleanName(c.name)), h('small', {}, c.kind === 'model' ? c.model : modelLine(c))));
    }));
    return box;
  }

  function redraw() {
    const g = game();
    gameSeg.replaceChildren(...games.map((x) => h('button', { type: 'button', class: sel.game === x.id ? 'on' : '', ...pressed(sel.game === x.id), onclick: () => { sel.game = x.id; sel.players = null; defaults(); redraw(); syncUrl(); } }, x.name)));
    playersSel.replaceChildren(g.players.min !== g.players.max
      ? h('label', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'label' }, '人数'),
        h('select', { style: { width: 'auto' }, onchange: (e) => { sel.players = Number(e.target.value); defaults(); redraw(); } },
          ...Array.from({ length: g.players.max - g.players.min + 1 }, (_, i) => g.players.min + i).map((n) => h('option', { value: n, selected: n === (sel.players || g.players.default) }, `${n} 人`))))
      : null);
    modeSeg.replaceChildren(...[['casual', '娱乐赛'], ...(canRanked ? [['ranked', '排位赛']] : [])].map(([v, l]) => h('button', { type: 'button', class: sel.mode === v ? 'on' : '', ...pressed(sel.mode === v), onclick: () => { sel.mode = v; redraw(); } }, l)));
    seatsBox.replaceChildren(...seatIds().map((seat, i) => h('div', { class: 'col', style: { gap: '8px' } },
      h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'side-tag seat-lab' }, g.seatNames[seat] || seat)),
      seatBox(seat))));
    const byId = new Map(pickable.map((c) => [c.id, c]));
    summary.replaceChildren(...(() => {
      const names = seatIds().map((s) => byId.get(sel.seats[s])?.name);
      if (names.some((n) => !n)) return [h('span', { class: 'muted' }, '还有座位没选选手')];
      return [h('span', { class: 'small muted' }, `${g.name} · ${sel.mode === 'ranked' ? '排位赛' : '娱乐赛'}`), h('b', {}, summarizeSeats(names).replace(' 对 ', ' vs '))];
    })());
    startExtra.replaceChildren(
      sel.game === 'xiangqi' && sel.mode === 'casual' ? h('label', { class: 'field' }, h('span', {}, '起始局面'), startSel) : null,
      sel.game === 'xiangqi' && sel.mode === 'casual' && sel.start === 'fen' ? fenInput : null,
      sel.game === 'xiangqi' && sel.mode === 'casual' && sel.start !== 'fen' ? h('div', { class: 'small muted' }, puzzles.find((p) => p.id === sel.start)?.desc || '') : null,
    );
  }

  const start = guard(async () => {
    const seats = Object.fromEntries(seatIds().map((s) => [s, sel.seats[s]]));
    if (Object.values(seats).some((v) => !v)) throw new Error('请为每个座位选好选手');
    const puzzle = puzzles.find((p) => p.id === sel.start);
    const fen = sel.game !== 'xiangqi' || sel.mode === 'ranked' ? undefined : sel.start === 'fen' ? sel.fen.trim() : puzzle && puzzle.id !== 'opening' ? puzzle.fen : undefined;
    const r = await post('/matches', { game: sel.game, seats, mode: sel.mode, options: { showLegal: sel.showLegal, delayMs: sel.delayMs, fen } });
    go(`#/match/${r.id}`);
  });

  const liveList = h('div', { class: 'live-list' });
  const LIVE_MAX = 8;
  const drawLive = (list) => {
    liveList.replaceChildren(...(list.length ? list.slice(0, LIVE_MAX).map((m) => {
      const names = Object.values(m.players).map((p) => p?.name);
      return h('a', { class: 'live-item', href: `#/match/${m.id}`, title: names.map(cleanName).join('、') },
        h('div', { class: 'who' }, h('span', { class: 'chip' }, m.gameName), h('span', { class: 'names' }, summarizeSeats(names))),
        h('span', { class: 'chip' }, MODE_NAMES[m.mode]), h('span', { class: 'small muted' }, m.plies ? `${m.plies} 步` : '等待第一手'));
    }) : [h('div', { class: 'muted small' }, '暂时没有进行中的对局')]),
    list.length > LIVE_MAX ? h('a', { class: 'small live-all', href: '#/' }, `全部 ${list.length} 盘 →`) : null);
  };
  drawLive(liveMatches);

  defaults();
  root.replaceChildren(
    pageHead('开一局', '座位上可以放你自己的蛐蛐、你本人和系统选手。想和别人的蛐蛐斗，去「组局」。', '开', modeSeg),
    h('div', { class: 'setup' },
    h('div', { class: 'card framed col setup-main', style: { gap: '22px' } },
      h('div', { class: 'row' }, gameSeg, playersSel),
      seatsBox,
      h('div', { class: 'grid2' },
        startExtra,
        h('div', { class: 'col', style: { gap: '10px' } },
          h('label', { class: 'switch' }, legalSw, '给模型提供合法行动列表'),
          h('label', { class: 'field' }, h('span', {}, h('span', {}, '两步之间的间隔 '), delayLabel), delay)),
      ),
      h('div', { class: 'start-bar' }, summary, h('a', { href: '#/characters', class: 'small start-new' }, '养一只新蛐蛐'), h('button', { class: 'btn primary lg', type: 'button', onclick: start }, '开始对局')),
    ),
    h('div', { class: 'card quiet col setup-side', style: { gap: '12px' } },
      h('div', { class: 'section-title', style: { margin: 0 } }, h('h3', {}, '正在进行')), liveList),
  ));
  redraw();

  return listen(['lobby'], async (e) => {
    if (e.type === 'match_created' || e.type === 'match_finished') drawLive(await api('/matches?status=running&limit=30').catch(() => liveMatches));
  });
}
