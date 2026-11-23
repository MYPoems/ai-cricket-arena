// 开局：选游戏、人数和各座位的选手。

import { h, api, post, guard, avatar, modelLine, MODE_NAMES, listen } from './ui.js';

export async function playView(root, { meta, characters, go }) {
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

  const gameSeg = h('div', { class: 'seg' });
  const playersSel = h('span');
  const seatsBox = h('div', { class: 'col', style: { gap: '18px' } });
  const modeSeg = h('div', { class: 'seg' });
  const startSel = h('select', { onchange: (e) => { sel.start = e.target.value; redraw(); } },
    ...puzzles.map((p) => h('option', { value: p.id }, p.title)), h('option', { value: 'fen' }, '自定义 FEN'));
  const fenInput = h('input', { type: 'text', placeholder: 'rnbakabnr/9/1c5c1/… w - - 0 1', oninput: (e) => { sel.fen = e.target.value; } });
  const legalSw = h('input', { type: 'checkbox', checked: true, onchange: (e) => { sel.showLegal = e.target.checked; } });
  const delayLabel = h('span', { class: 'small muted' }, '0.6 秒');
  const delay = h('input', { type: 'range', min: 0, max: 3000, step: 200, value: sel.delayMs, oninput: (e) => { sel.delayMs = Number(e.target.value); delayLabel.textContent = `${(sel.delayMs / 1000).toFixed(1)} 秒`; } });
  const startExtra = h('div', { class: 'col', style: { gap: '8px' } });

  function seatBox(seat) {
    const box = h('div', { class: 'seat-pick' });
    const others = Object.entries(sel.seats).filter(([s]) => s !== seat).map(([, id]) => id);
    box.replaceChildren(...pickable.filter(fits).map((c) => {
      const dis = sel.mode === 'ranked' && (!c.ranked || (!c.system && others.includes(c.id)));
      return h('div', {
        class: `pick${sel.seats[seat] === c.id ? ' on' : ''}${dis ? ' dis' : ''}`,
        title: dis ? (others.includes(c.id) ? '排位赛里同一名选手不能占多个座位' : '本机订阅和自定义接口只能下娱乐赛') : modelLine(c),
        onclick: () => { if (dis) return; sel.seats[seat] = c.id; redraw(); },
      }, avatar(c, 'sm'), h('div', { class: 't' }, h('span', {}, c.name), h('small', {}, c.kind === 'model' ? c.model : modelLine(c))));
    }));
    return box;
  }

  function redraw() {
    const g = game();
    gameSeg.replaceChildren(...games.map((x) => h('button', { class: sel.game === x.id ? 'on' : '', onclick: () => { sel.game = x.id; sel.players = null; defaults(); redraw(); } }, x.name)));
    playersSel.replaceChildren(g.players.min !== g.players.max
      ? h('label', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'label' }, '人数'),
        h('select', { style: { width: 'auto' }, onchange: (e) => { sel.players = Number(e.target.value); defaults(); redraw(); } },
          ...Array.from({ length: g.players.max - g.players.min + 1 }, (_, i) => g.players.min + i).map((n) => h('option', { value: n, selected: n === (sel.players || g.players.default) }, `${n} 人`))))
      : null);
    modeSeg.replaceChildren(...[['casual', '娱乐赛'], ['ranked', '排位赛']].map(([v, l]) => h('button', { class: sel.mode === v ? 'on' : '', onclick: () => { sel.mode = v; redraw(); } }, l)));
    seatsBox.replaceChildren(...seatIds().map((seat, i) => h('div', { class: 'col', style: { gap: '8px' } },
      h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'side-tag', style: { background: i === 0 ? 'var(--red)' : 'var(--text)' } }, g.seatNames[seat] || seat)),
      seatBox(seat))));
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
  const drawLive = (list) => {
    liveList.replaceChildren(...(list.length ? list.map((m) => h('div', { class: 'live-item', onclick: () => go(`#/match/${m.id}`) },
      h('div', { class: 'who' }, h('span', { class: 'chip' }, m.gameName), h('span', {}, Object.values(m.players).map((p) => p?.name).join(' · '))),
      h('span', { class: 'chip' }, MODE_NAMES[m.mode]), h('span', { class: 'small muted' }, `${m.plies} 步`))) : [h('div', { class: 'muted small' }, '暂时没有进行中的对局')]));
  };
  drawLive(liveMatches);

  defaults();
  root.replaceChildren(h('div', { class: 'setup' },
    h('div', { class: 'col', style: { gap: '22px' } },
      h('div', { class: 'section-title', style: { margin: 0 } }, h('h2', {}, '开一局'), modeSeg),
      h('div', { class: 'row' }, gameSeg, playersSel),
      seatsBox,
      h('div', { class: 'grid2' },
        startExtra,
        h('div', { class: 'col', style: { gap: '10px' } },
          h('label', { class: 'switch' }, legalSw, '给模型提供合法行动列表'),
          h('label', { class: 'field' }, h('span', {}, h('span', {}, '两步之间的间隔 '), delayLabel), delay)),
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: start }, '开始对局'), h('a', { href: '#/characters', class: 'small' }, '创建新的 AI 选手')),
    ),
    h('div', { class: 'col' },
      h('div', { class: 'col', style: { gap: '8px' } }, h('div', { class: 'section-title', style: { margin: 0 } }, h('h3', {}, '正在进行')), liveList),
    ),
  ));
  redraw();

  return listen(['lobby'], async (e) => {
    if (e.type === 'match_created' || e.type === 'match_finished') drawLive(await api('/matches?status=running&limit=30'));
  });
}
