// 对局首页：快速开一盘（选红黑双方选手）+ 正在进行的对局。

import { h, api, post, guard, tierBadge, avatar, modelLine, MODE_NAMES, fmtTime, listen } from './ui.js';

export async function playView(root, { meta, characters, go }) {
  const [liveMatches, puzzles] = await Promise.all([api('/matches?status=running&limit=30'), api('/puzzles')]);
  const pickable = characters.filter((c) => !c.archived);
  const me = pickable.find((c) => c.kind === 'human');
  const firstModel = pickable.find((c) => c.kind === 'model');
  const builtin = pickable.find((c) => c.kind === 'builtin');
  const sel = { r: me?.id, b: (firstModel || builtin)?.id, mode: 'casual', showLegal: true, delayMs: 600, start: 'opening', fen: '' };

  const seatBox = (seat) => {
    const box = h('div', { class: 'seat-pick' });
    const draw = () => {
      box.replaceChildren(...pickable.map((c) => {
        const other = sel[seat === 'r' ? 'b' : 'r'];
        const dis = sel.mode === 'ranked' && (!c.ranked || c.id === other);
        return h('div', {
          class: `pick${sel[seat] === c.id ? ' on' : ''}${dis ? ' dis' : ''}`,
          title: dis ? (c.id === other ? '排位赛不能自己对自己' : '本地模型和自定义接口只能下娱乐赛') : modelLine(c),
          onclick: () => { if (dis) return; sel[seat] = c.id; redraw(); },
        }, avatar(c, 'sm'), h('div', { class: 't' }, h('span', {}, c.name), h('small', {}, c.kind === 'model' ? c.model : modelLine(c))));
      }));
    };
    box.draw = draw;
    return box;
  };
  const redBox = seatBox('r');
  const blackBox = seatBox('b');

  const seg = (key, opts) => {
    const el = h('div', { class: 'seg' });
    const draw = () => el.replaceChildren(...opts.map(([v, label]) => h('button', { class: sel[key] === v ? 'on' : '', onclick: () => { sel[key] = v; redraw(); } }, label)));
    el.draw = draw;
    return el;
  };
  const modeSeg = seg('mode', [['casual', '娱乐赛'], ['ranked', '排位赛']]);
  const startSel = h('select', { onchange: (e) => { sel.start = e.target.value; redraw(); } },
    ...puzzles.map((p) => h('option', { value: p.id }, p.title)), h('option', { value: 'fen' }, '自定义 FEN'));
  const fenInput = h('input', { type: 'text', placeholder: 'rnbakabnr/9/1c5c1/… w - - 0 1', oninput: (e) => { sel.fen = e.target.value; } });
  const legalSw = h('input', { type: 'checkbox', checked: true, onchange: (e) => { sel.showLegal = e.target.checked; } });
  const delay = h('input', { type: 'range', min: 0, max: 3000, step: 200, value: sel.delayMs, oninput: (e) => { sel.delayMs = Number(e.target.value); delayLabel.textContent = `${(sel.delayMs / 1000).toFixed(1)} 秒`; } });
  const delayLabel = h('span', { class: 'small muted' }, '0.6 秒');
  const startExtra = h('div', { class: 'col', style: { gap: '8px' } });

  function redraw() {
    if (sel.mode === 'ranked') {
      for (const s of ['r', 'b']) {
        const c = pickable.find((x) => x.id === sel[s]);
        if (c && !c.ranked) sel[s] = null;
      }
      if (sel.r === sel.b) sel.b = null;
    }
    redBox.draw();
    blackBox.draw();
    modeSeg.draw();
    startExtra.replaceChildren(
      sel.mode === 'casual' ? h('label', { class: 'field' }, h('span', {}, '起始局面'), startSel) : null,
      sel.mode === 'casual' && sel.start === 'fen' ? fenInput : null,
      sel.mode === 'casual' && sel.start !== 'fen' ? h('div', { class: 'small muted' }, puzzles.find((p) => p.id === sel.start)?.desc || '') : null,
    );
  }

  const start = guard(async () => {
    if (!sel.r || !sel.b) throw new Error('请选好红黑双方');
    const puzzle = puzzles.find((p) => p.id === sel.start);
    const fen = sel.mode === 'ranked' ? undefined : sel.start === 'fen' ? sel.fen.trim() : puzzle && puzzle.id !== 'opening' ? puzzle.fen : undefined;
    const r = await post('/matches', { game: 'xiangqi', seats: { r: sel.r, b: sel.b }, mode: sel.mode, options: { showLegal: sel.showLegal, delayMs: sel.delayMs, fen } });
    go(`#/match/${r.id}`);
  });

  const liveList = h('div', { class: 'live-list' });
  const drawLive = (list) => {
    liveList.replaceChildren(...(list.length ? list.map((m) => h('div', { class: 'live-item', onclick: () => go(`#/match/${m.id}`) },
      h('div', { class: 'who' }, h('span', { class: 'side-mark r' }), avatar(m.players.r, 'sm'), h('span', {}, m.players.r?.name), h('span', { class: 'muted' }, 'vs'), avatar(m.players.b, 'sm'), h('span', {}, m.players.b?.name)),
      h('span', { class: 'chip' }, MODE_NAMES[m.mode]), h('span', { class: 'small muted' }, `${m.plies} 步`))) : [h('div', { class: 'muted small' }, '暂时没有进行中的对局')]));
  };
  drawLive(liveMatches);

  root.replaceChildren(h('div', { class: 'setup' },
    h('div', { class: 'card pad col', style: { gap: '16px' } },
      h('div', { class: 'section-title', style: { margin: 0 } }, h('h2', {}, '开一盘中国象棋'), modeSeg),
      h('div', { class: 'col', style: { gap: '8px' } }, h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'side-mark r' }), h('b', {}, '红方')), redBox),
      h('div', { class: 'col', style: { gap: '8px' } }, h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'side-mark b' }), h('b', {}, '黑方')), blackBox),
      h('div', { class: 'grid2' },
        startExtra,
        h('div', { class: 'col', style: { gap: '10px' } },
          h('label', { class: 'switch' }, legalSw, '给模型提供合法着法列表'),
          h('label', { class: 'field' }, h('span', {}, h('span', {}, '两步之间的间隔 '), delayLabel), delay)),
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: start }, '开始对局'), h('a', { href: '#/characters', class: 'small' }, '创建新的 AI 选手')),
    ),
    h('div', { class: 'col' },
      h('div', { class: 'card pad col' }, h('h3', {}, '正在进行'), liveList),
      h('div', { class: 'card pad col' }, h('h3', {}, '天梯'), h('div', { class: 'small muted' }, meta.ladder.enabled ? '自动匹配已开启' : '自动匹配未开启'), h('a', { href: '#/ladder' }, '查看排名 →')),
    ),
  ));
  redraw();

  const stop = listen(['lobby'], async (e) => {
    if (e.type === 'match_created' || e.type === 'match_finished') drawLive(await api('/matches?status=running&limit=30'));
  });
  void tierBadge; void fmtTime;
  return stop;
}
