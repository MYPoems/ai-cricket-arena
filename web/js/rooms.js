// 组局：开房、把自己的 AI 蛐蛐拉进座位、坐满后房主开局。

import { h, api, post, guard, toast, listen, modelLine, fmtTime, dialog, pageHead } from './ui.js';

const coin = (c, cls = '') => h('span', { class: `coin ${cls}` }, c?.avatar || '？');

export async function roomsView(root, { meta, go, session }) {
  const list = await api('/rooms');
  const create = () => {
    let game = meta.games[0];
    let players = game.players.default;
    const title = h('input', { type: 'text', id: 'room-title', maxlength: 30, placeholder: '比如：周五斗地主' });
    const body = h('div', { class: 'col' });
    const draw = () => body.replaceChildren(
      h('div', { class: 'field' }, h('span', {}, '游戏'), h('div', { class: 'seat-pick' }, ...meta.games.map((g) => h('button', { class: `pick ${g.id === game.id ? 'on' : ''}`, onclick: () => { game = g; players = g.players.default; draw(); } }, h('span', { class: 't' }, g.name, h('small', {}, g.players.min === g.players.max ? `${g.players.min} 人` : `${g.players.min}–${g.players.max} 人`)))))),
      game.players.min !== game.players.max ? h('label', { class: 'field' }, h('span', {}, '人数'), h('select', { onchange: (e) => { players = Number(e.target.value); } }, ...Array.from({ length: game.players.max - game.players.min + 1 }, (_, i) => game.players.min + i).map((n) => h('option', { value: n, selected: n === players }, `${n} 人`)))) : null,
      h('label', { class: 'field' }, h('span', {}, '组局名'), title),
      h('div', { class: 'small muted' }, '组局开出的是娱乐赛：不计积分，也不占蛐蛐每天主动参加对局的名额。'));
    draw();
    const dlg = dialog('开一个组局', body, [
      h('button', { class: 'btn', onclick: () => dlg.close() }, '取消'),
      h('button', { class: 'btn primary', onclick: guard(async () => {
        const r = await post('/rooms', { game: game.id, players, title: title.value.trim() });
        dlg.close();
        go(`#/room/${r.id}`);
      }) }, '开局'),
    ]);
  };

  const cards = list.map((r) => h('a', { class: 'card room', href: `#/room/${r.id}` },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 't' }, r.title), h('span', { class: 'chip' }, r.gameName)),
    h('div', { class: 'slots' }, ...Object.values(r.seats).map((s) => s ? h('span', { class: 'coin sm', title: s.character.name }, s.character.avatar) : h('span', { class: 'slot-dot' }, '＋'))),
    h('div', { class: 'small muted' }, `房主 ${r.host?.name || '—'} · ${r.filled}/${r.players} 人 · ${fmtTime(r.updated_at)}`)));

  root.replaceChildren(
    pageHead('组局', '开一个局，大家把自己养的 AI 蛐蛐拉进来斗一场。', '组', session.user ? h('button', { class: 'btn primary lg', onclick: create }, '开一个组局') : h('a', { class: 'btn primary', href: '#/login' }, '登录后组局')),
    list.length ? h('div', { class: 'rooms' }, cards) : h('div', { class: 'empty card' }, h('div', {}, '现在没有等人的组局。'), session.user ? h('button', { class: 'btn primary', onclick: create }, '开第一个') : null));
  return listen(['lobby'], (e) => { if (e.type === 'room_updated') roomsView(root, { meta, go, session }); });
}

export async function roomView(root, id, { go, session, characters }) {
  let room = await api(`/rooms/${id}`);
  const me = session.user;
  const isHost = () => me && (room.host?.id === me.id || me.role === 'admin');

  function pickDialog(seat) {
    const mine = characters.filter((c) => c.mine && !c.archived);
    const sys = isHost() ? characters.filter((c) => c.system) : [];
    const taken = new Set(Object.values(room.seats).filter(Boolean).map((s) => s.character.id));
    const item = (c) => h('button', { class: `pick ${taken.has(c.id) && !c.system ? 'dis' : ''}`, disabled: taken.has(c.id) && !c.system, onclick: guard(async () => {
      room = await post(`/rooms/${id}/seat`, { seat, characterId: c.id });
      dlg.close();
      draw();
    }) }, coin(c, 'sm'), h('span', { class: 't' }, c.name, h('small', {}, modelLine(c))));
    const dlg = dialog(`拉蛐蛐入座：${room.seatNames[seat]}`, h('div', { class: 'col' },
      h('div', { class: 'field' }, h('span', {}, '我的蛐蛐'), mine.length ? h('div', { class: 'seat-pick' }, ...mine.map(item)) : h('div', { class: 'small muted' }, '你还没有蛐蛐。', h('a', { href: '#/characters' }, '去养一只'))),
      sys.length ? h('div', { class: 'field' }, h('span', {}, '系统选手（房主可以拉来补位）'), h('div', { class: 'seat-pick' }, ...sys.map(item))) : null,
      h('div', { class: 'small muted' }, '同一只蛐蛐可以同时在好几个组局和对局里。自带 Agent 的蛐蛐要保持在线，否则轮到它时会超时判负。')));
  }

  function seatCard(seat, i) {
    const s = room.seats[seat];
    const open = room.status === 'open';
    if (!s) {
      return h('div', { class: 'card seatcard empty' }, h('span', { class: 'no' }, i + 1), h('span', { class: 'coin' }, '＋'),
        h('div', {}, h('div', { class: 'nm muted' }, room.seatNames[seat]), h('div', { class: 'md' }, '空位')),
        open && me ? h('button', { class: 'btn sm', onclick: () => pickDialog(seat) }, '拉蛐蛐入座') : null);
    }
    const mineSeat = me && (s.by?.id === me.id || isHost());
    return h('div', { class: 'card seatcard' }, h('span', { class: 'no' }, i + 1), coin(s.character),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm gold-text' }, s.character.name), h('div', { class: 'md' }, `${room.seatNames[seat]} · ${modelLine(s.character)}`), h('div', { class: 'md' }, s.character.system ? '系统选手' : `${s.by?.name || '—'} 带来的`)),
      open && mineSeat ? h('button', { class: 'btn sm ghost', onclick: guard(async () => { room = await post(`/rooms/${id}/leave`, { seat }); draw(); }) }, '离座') : null);
  }

  function draw() {
    const seats = Object.keys(room.seatNames);
    const full = room.filled === room.players;
    const statusText = { open: full ? '坐满了，等房主开局' : `还差 ${room.players - room.filled} 个座位`, started: '已开局', closed: '已关闭' }[room.status];
    root.replaceChildren(
      pageHead(room.title, `${room.gameName} · ${room.players} 人 · 房主 ${room.host?.name || '—'}`, '组'),
      h('div', { class: 'room-page' },
        h('div', { class: 'seats-grid' }, ...seats.map(seatCard)),
        h('div', { class: 'col' },
          h('div', { class: 'card framed col' },
            h('h3', {}, statusText),
            room.status === 'started' ? h('a', { class: 'btn primary lg', href: `#/match/${room.matchId}` }, '进入观战') : null,
            room.status === 'open' && isHost() ? h('button', { class: 'btn primary lg', disabled: !full, onclick: guard(async () => { room = await post(`/rooms/${id}/start`); go(`#/match/${room.matchId}`); }) }, full ? '开局' : '坐满后才能开局') : null,
            room.status === 'open' ? h('div', { class: 'small muted' }, '把这个页面的链接发给朋友，他们登录后可以把自己的蛐蛐拉进空位。') : null,
            room.status === 'open' ? h('button', { class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(location.href); toast('链接已复制'); } catch { toast(location.href); } } }, '复制邀请链接') : null,
            room.status === 'open' && isHost() ? h('button', { class: 'btn sm ghost', onclick: guard(async () => { if (!confirm('关闭这个组局？')) return; room = await post(`/rooms/${id}/close`); draw(); }) }, '关闭组局') : null),
          h('div', { class: 'card pad small muted' }, '组局是娱乐赛：不计积分，也不占蛐蛐每天主动参加对局的名额，没有次数限制。每只蛐蛐用的是它主人的 API 密钥。'))));
  }
  draw();
  return listen([`room:${id}`], (e) => { if (e.type === 'room') { room = e.room; draw(); } });
}
