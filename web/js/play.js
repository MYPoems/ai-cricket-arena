// 开局：选游戏、人数和各座位的选手。

import { h, api, post, guard, avatar, modelLine, MODE_NAMES, listen, pageHead, pressed, icon, cleanName, summarizeSeats, dialog, clockFields } from './ui.js';

export async function playView(root, { meta, characters, go, session }) {
  // 排位赛由天梯自动匹配产生；只有庄家能手动开排位（测试用）
  const canRanked = session.user?.role === 'admin';
  // 右栏「正在进行」用大厅的数据：带着轮到谁、最后一步什么时候走的
  const liveOf = () => api('/lobby').then((x) => x.live || []);
  const [liveMatches, puzzles] = await Promise.all([liveOf(), api('/puzzles')]);
  const games = meta.games;
  const pickable = characters.filter((c) => !c.archived);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const sel = {
    game: games.find((g) => g.id === q.get('game'))?.id || games[0].id,
    players: null, seats: {}, mode: 'casual', showLegal: true, delayMs: 600, start: 'opening', fen: '',
    moveTime: 300, timeoutLoss: 3, // 两人棋类：真人每步限时（秒）、超时几次判负
    goSize: 9, // 围棋路数（大模型每步一次调用，19 路一盘几百手，默认 9 路）
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

  // 默认对手：自己的蛐蛐（模型、Agent）在前，然后内置 AI（初级在前）、引擎，「随机走子」排最后——
  // 从大厅点「我来挑战一只蛐蛐」进来，对面坐的是一只像样的对手，而不是随机走子
  const RANK = { model: 0, agent: 1, builtin: 2, engine: 3, random: 9 };
  const rankOf = (c) => (RANK[c.kind] ?? 5) * 100 + (c.kind === 'builtin' ? Number(c.level) || 0 : 0) + (/[?�]|（旧）/.test(c.name || '') ? 50 : 0);
  function defaults() {
    const ids = seatIds();
    const me = pickable.find((c) => c.kind === 'human');
    const ai = pickable.filter((c) => fits(c) && c.kind !== 'human').sort((a, b) => rankOf(a) - rankOf(b));
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
  const advOpts = h('div', { class: 'col', style: { gap: '10px' } },
    h('label', { class: 'switch' }, legalSw, '给模型提供合法行动列表'),
    h('label', { class: 'field' }, h('span', {}, h('span', {}, '两步之间的间隔 '), delayLabel), delay));
  const advBox = h('div', { class: 'adv-box' }, advOpts);

  const lineOf = (c) => (c.kind === 'model' ? c.model : modelLine(c));
  /** 座位多的游戏（斗地主 3 人、德州 6 人、狼人杀 8–9 人）：每个座位只占一行，写着现在坐的是谁，点开再换。
   *  每个座位都把十几名选手摊开的话，狼人杀要铺上百颗胶囊、手机上滚四五屏 */
  function seatRow(seat) {
    const name = game().seatNames[seat] || seat;
    const c = pickable.find((x) => x.id === sel.seats[seat]);
    return h('button', { type: 'button', class: `seat-row${c ? '' : ' none'}`, 'data-seat': seat, 'aria-haspopup': 'dialog', 'aria-label': `${name}：${c ? cleanName(c.name) : '未选'}，更换`, onclick: () => {
      const dlg = dialog(`${name}的选手`, seatBox(seat, () => dlg.close()));
      // 焦点落在现在坐着的那一位上（不是右上角的关闭键）：方向明确，Tab 一下就是相邻的选手
      dlg.querySelector('.pick.on, .pick')?.focus({ preventScroll: true });
      // 选完后这一行重画过了，焦点还给新的这一行
      dlg.addEventListener('close', () => seatsBox.querySelector(`[data-seat="${seat}"]`)?.focus({ preventScroll: true }));
    } },
    h('span', { class: 'side-tag seat-lab' }, name),
    c ? avatar(c, 'sm') : null,
    h('span', { class: 't' }, h('span', {}, c ? cleanName(c.name) : '选一名选手'), c ? h('small', {}, lineOf(c)) : null),
    icon('chevron-down', 16));
  }

  function seatBox(seat, after) {
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
        onclick: () => { if (dis) return; sel.seats[seat] = c.id; redraw(); after?.(); },
      }, on ? h('span', { class: 'pick-check' }, icon('check', 16)) : avatar(c, 'sm'), h('span', { class: 't' }, h('span', {}, cleanName(c.name)), h('small', {}, lineOf(c))));
    }));
    return box;
  }

  function redraw() {
    const g = game();
    gameSeg.replaceChildren(...games.map((x) => h('button', { type: 'button', class: sel.game === x.id ? 'on' : '', ...pressed(sel.game === x.id), onclick: () => { sel.game = x.id; sel.players = null; defaults(); redraw(); syncUrl(); } }, x.name)));
    playersSel.hidden = g.players.min === g.players.max; // 空着时不占一行（原来游戏条下面平白多出一截空）
    playersSel.replaceChildren(g.players.min !== g.players.max
      ? h('label', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'label' }, '人数'),
        h('select', { style: { width: 'auto' }, onchange: (e) => { sel.players = Number(e.target.value); defaults(); redraw(); } },
          ...Array.from({ length: g.players.max - g.players.min + 1 }, (_, i) => g.players.min + i).map((n) => h('option', { value: n, selected: n === (sel.players || g.players.default) }, `${n} 人`))))
      : null);
    modeSeg.replaceChildren(...[['casual', '娱乐赛'], ...(canRanked ? [['ranked', '排位赛']] : [])].map(([v, l]) => h('button', { type: 'button', class: sel.mode === v ? 'on' : '', ...pressed(sel.mode === v), onclick: () => { sel.mode = v; redraw(); } }, l)));
    const ids = seatIds();
    seatsBox.replaceChildren(...(ids.length > 2
      ? [h('div', { class: 'seat-rows', role: 'group', 'aria-label': '各座位的选手' }, ...ids.map(seatRow))]
      : ids.map((seat) => h('div', { class: 'col', style: { gap: '8px' } },
        h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'side-tag seat-lab' }, g.seatNames[seat] || seat)),
        seatBox(seat)))));
    const byId = new Map(pickable.map((c) => [c.id, c]));
    summary.replaceChildren(...(() => {
      const names = seatIds().map((s) => byId.get(sel.seats[s])?.name);
      if (names.some((n) => !n)) return [h('span', { class: 'muted' }, '还有座位没选选手')];
      return [h('span', { class: 'small muted' }, `${g.name} · ${sel.mode === 'ranked' ? '排位赛' : '娱乐赛'}`), h('b', {}, summarizeSeats(names).replace(' 对 ', ' vs '))];
    })());
    // 真人上场时，「合法行动列表」「间隔」这些术语收进「高级」；纯 AI 对局照常摊开
    const hasHuman = seatIds().some((s) => byId.get(sel.seats[s])?.kind === 'human');
    if (hasHuman !== advBox.classList.contains('adv-on')) {
      advBox.classList.toggle('adv-on', hasHuman);
      advBox.replaceChildren(hasHuman ? h('details', { class: 'adv' }, h('summary', {}, '高级'), advOpts) : advOpts);
    }
    startExtra.replaceChildren(
      sel.game === 'go' ? h('label', { class: 'field' }, h('span', {}, '棋盘'),
        h('select', { onchange: (e) => { sel.goSize = Number(e.target.value); } }, ...[[9, '9 路（一盘约 80 手）'], [13, '13 路（约 160 手）'], [19, '19 路（约 300 手，模型对局很慢）']].map(([v, l]) => h('option', { value: v, selected: v === sel.goSize }, l)))) : null,
      // 两人棋类有真人上场：每步限时、超时判负次数
      g.features?.clock && hasHuman ? clockFields(sel) : null,
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
    const r = await post('/matches', { game: sel.game, seats, mode: sel.mode, options: { showLegal: sel.showLegal, delayMs: sel.delayMs, fen, ...(sel.game === 'go' ? { setup: { size: sel.goSize } } : {}), ...(game().features?.clock ? { humanTimeout: sel.moveTime, timeoutLoss: sel.timeoutLoss } : {}) } });
    go(`#/match/${r.id}`);
  });

  const liveList = h('div', { class: 'live-list' });
  const LIVE_MAX = 8;
  const meId = session.user?.id;
  /** 这一盘里有没有我本人坐着 */
  const iSit = (m) => Object.values(m.players || {}).some((p) => p?.kind === 'human' && meId && p.owner_id === meId);
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso || 0).getTime()) / 1000);
    return s < 60 ? '刚刚' : s < 3600 ? `${Math.floor(s / 60)} 分钟前` : s < 86400 ? `${Math.floor(s / 3600)} 小时前` : `${Math.floor(s / 86400)} 天前`;
  };
  /** 一盘现在什么状态：「等你出手 · 3 小时前」 */
  const stateOf = (m) => {
    const st = m.humanWaiting ? (iSit(m) ? '等你出手' : '等真人出手') : m.paused ? '已暂停' : m.thinking ? `${m.seatNames?.[m.thinking] || ''}思考中` : m.plies ? `第 ${m.plies} 步` : '等待第一手';
    return `${st} · ${ago(m.lastAt || m.started_at || m.created_at)}`;
  };
  const item = (m) => {
    const names = Object.values(m.players).map((p) => p?.name);
    const mine = m.humanWaiting && iSit(m);
    return h('a', { class: `live-item${mine ? ' mine' : ''}`, href: `#/match/${m.id}`, title: names.map(cleanName).join('、') },
      h('div', { class: 'who' }, h('span', { class: 'chip' }, m.gameName), h('span', { class: 'names' }, summarizeSeats(names))),
      h('span', { class: 'chip' }, MODE_NAMES[m.mode]), h('span', { class: `small ${mine ? 'live-turn' : 'muted'}` }, stateOf(m)));
  };
  const drawLive = (list) => {
    // 「待你行动」排在最前面单独一组，其余按最近动过的在前
    const mine = list.filter((m) => m.humanWaiting && iSit(m));
    const rest = list.filter((m) => !mine.includes(m)).sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')));
    const shown = rest.slice(0, Math.max(0, LIVE_MAX - mine.length));
    liveList.replaceChildren(
      mine.length ? h('div', { class: 'live-group' }, h('div', { class: 'label' }, `待你行动 · ${mine.length}`), ...mine.map(item)) : null,
      mine.length && shown.length ? h('div', { class: 'label live-sep' }, '其他对局') : null,
      ...(list.length ? shown.map(item) : [h('div', { class: 'muted small' }, '暂时没有进行中的对局')]),
      list.length > mine.length + shown.length ? h('a', { class: 'small live-all', href: '#/' }, `全部 ${list.length} 盘 →`) : null);
  };
  drawLive(liveMatches);

  defaults();
  root.replaceChildren(
    // 只有娱乐赛一个选项时（非庄家）不摆一个孤零零的模式开关
    pageHead('开一局', '座位上可以放你自己的蛐蛐、你本人和系统选手。想和别人的蛐蛐斗，去「组局」。', '开', canRanked ? modeSeg : null),
    h('div', { class: 'setup' },
    h('div', { class: 'card framed col setup-main', style: { gap: '22px' } },
      h('div', { class: 'row' }, gameSeg, playersSel),
      seatsBox,
      h('div', { class: 'grid2' },
        startExtra,
        advBox,
      ),
      h('div', { class: 'start-bar' }, summary, h('a', { href: '#/characters', class: 'small start-new' }, '养一只新蛐蛐'), h('button', { class: 'btn primary lg', type: 'button', onclick: start }, '开始对局')),
    ),
    h('div', { class: 'card quiet col setup-side', style: { gap: '12px' } },
      h('div', { class: 'section-title', style: { margin: 0 } }, h('h3', {}, '正在进行')), liveList),
  ));
  redraw();

  return listen(['lobby'], async (e) => {
    if (e.type === 'match_created' || e.type === 'match_finished') drawLive(await liveOf().catch(() => liveMatches));
  });
}
