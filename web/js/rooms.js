// 组局：开房、把自己的 AI 蛐蛐拉进座位、坐满后房主开局。

import { h, api, post, guard, guardConfirm, toast, listen, modelLine, fmtTime, dialog, pageHead, emptyState, setTitle, pressed, icon, cleanName, coin } from './ui.js';

export async function roomsView(root, { meta, go, session }) {
  const list = await api('/rooms');
  const create = () => {
    let game = meta.games[0];
    let players = game.players.default;
    const title = h('input', { type: 'text', id: 'room-title', maxlength: 30, placeholder: '例如：周五斗地主' });
    const body = h('div', { class: 'col' });
    const draw = () => body.replaceChildren(
      h('div', { class: 'field' }, h('span', {}, '游戏'), h('div', { class: 'seg seg-games', role: 'group', 'aria-label': '游戏' }, ...meta.games.map((g) => h('button', { type: 'button', class: g.id === game.id ? 'on' : '', ...pressed(g.id === game.id), title: g.players.min === g.players.max ? `${g.players.min} 人` : `${g.players.min}–${g.players.max} 人`, onclick: () => { game = g; players = g.players.default; draw(); } }, g.name)))),
      game.players.min !== game.players.max ? h('label', { class: 'field' }, h('span', {}, '人数'), h('select', { onchange: (e) => { players = Number(e.target.value); } }, ...Array.from({ length: game.players.max - game.players.min + 1 }, (_, i) => game.players.min + i).map((n) => h('option', { value: n, selected: n === players }, `${n} 人`)))) : null,
      h('label', { class: 'field' }, h('span', {}, '组局名'), title),
      h('div', { class: 'small muted' }, '组局开出的是娱乐赛：不计积分，也不占蛐蛐每天主动参加对局的名额。'));
    draw();
    const dlg = dialog('开一个组局', body, [
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, '取消'),
      h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
        const r = await post('/rooms', { game: game.id, players, title: title.value.trim() });
        dlg.close();
        go(`#/room/${r.id}`);
      }) }, '创建组局'),
    ]);
  };

  const card = (r) => h('a', { class: 'card room', href: `#/room/${r.id}` },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 't' }, r.title), h('span', { class: 'chip' }, r.gameName)),
    h('div', { class: 'slots' }, ...Object.values(r.seats).map((s) => s ? Object.assign(coin(s.character, 'sm'), { title: cleanName(s.character.name) }) : h('span', { class: 'slot-dot' }, '＋'))),
    h('div', { class: 'small muted' }, `房主 ${r.host?.name || '—'} · ${r.filled}/${r.players} 人 · ${fmtTime(r.updated_at)}`));
  // 没有组局时：页头不放按钮（主操作只出现一次），下面一张安静的卡片讲清楚三步
  const emptyBox = () => h('div', { class: 'card quiet rooms-empty' },
    h('p', { class: 'empty-text' }, '现在没有等人的组局。'),
    h('ol', { class: 'steps' },
      h('li', {}, h('b', {}, '选游戏'), h('span', {}, '挑一个游戏，开一个组局')),
      h('li', {}, h('b', {}, '拉蛐蛐'), h('span', {}, '把链接发给朋友，各自把蛐蛐拉进座位')),
      h('li', {}, h('b', {}, '开斗'), h('span', {}, '坐满后房主开局，大家一起观战'))),
    session.user ? h('button', { class: 'btn primary', type: 'button', onclick: create }, icon('plus', 16), '开第一个组局') : h('a', { class: 'btn primary', href: '#/login?next=%23%2Frooms' }, '登录后组局'));
  const headBtn = () => (session.user ? h('button', { class: 'btn primary lg', type: 'button', onclick: create }, icon('plus', 18), '开一个组局') : h('a', { class: 'btn primary', href: '#/login?next=%23%2Frooms' }, '登录后组局'));
  const listBox = h('div');
  const drawList = (rooms) => {
    root.replaceChildren(
      pageHead('组局', '开一个局，大家把自己养的 AI 蛐蛐拉进来斗一场。', '组', ...(rooms.length ? [headBtn()] : [])),
      listBox);
    listBox.replaceChildren(rooms.length ? h('div', { class: 'rooms' }, rooms.map(card)) : emptyBox());
  };
  drawList(list);
  // 列表有变化时只重画列表，不能再调 roomsView：那样每次都会多挂一个监听，旧的没人关，
  // 进了房间后它还在，一有入座更新就把整页换回列表
  let alive = true;
  const stop = listen(['lobby'], guard(async (e) => {
    if (e.type !== 'room_updated' || !alive) return;
    const fresh = await api('/rooms');
    if (alive && root.isConnected) drawList(fresh);
  }));
  return () => { alive = false; stop(); };
}

export async function roomView(root, id, { go, session, characters, meta }) {
  let room = await api(`/rooms/${id}`);
  const me = session.user;
  const isHost = () => me && (room.host?.id === me.id || me.role === 'admin');
  setTitle(room.title, '组局');

  function pickDialog(seat) {
    // 只列会下这个游戏的（引擎只会自己那一种棋）；系统选手只在「系统选手」里出现一次
    const g = meta?.games?.find((x) => x.id === room.game);
    const fits = (c) => c.kind !== 'engine' || (c.provider || 'pikafish') === g?.features?.evalEngine;
    const mine = characters.filter((c) => c.mine && !c.archived && !c.system && fits(c));
    const sys = isHost() ? characters.filter((c) => c.system && fits(c)) : [];
    const taken = new Set(Object.values(room.seats).filter(Boolean).map((s) => s.character.id));
    const item = (c) => h('button', { type: 'button', class: `pick ${taken.has(c.id) && !c.system ? 'dis' : ''}`, disabled: taken.has(c.id) && !c.system, title: taken.has(c.id) && !c.system ? '已经坐在别的座位上了' : null, onclick: guard(async () => {
      room = await post(`/rooms/${id}/seat`, { seat, characterId: c.id });
      dlg.close();
      draw();
    }) }, coin(c, 'sm'), h('span', { class: 't' }, cleanName(c.name), h('small', {}, modelLine(c))));
    const dlg = dialog(`拉蛐蛐入座：${room.seatNames[seat]}`, h('div', { class: 'col' },
      h('div', { class: 'field' }, h('span', {}, '我的蛐蛐'), mine.length ? h('div', { class: 'seat-pick' }, ...mine.map(item)) : h('div', { class: 'small muted' }, '你还没有蛐蛐。', h('a', { href: '#/characters' }, '去养一只'))),
      sys.length ? h('div', { class: 'field' }, h('span', {}, '系统选手（房主可以拉来补位）'), h('div', { class: 'seat-pick' }, ...sys.map(item))) : null,
      h('div', { class: 'small muted' }, '同一只蛐蛐可以同时在好几个组局和对局里。自带 Agent 的蛐蛐要保持在线，否则轮到它时会超时判负。')));
    dlg.querySelector('.pick:not(:disabled)')?.focus({ preventScroll: true });
  }

  // ---------- 在线真人：房主和已入座的人可以邀请 ----------
  let online = [];
  const onlineBox = h('div', { class: 'card pad col online-card' });
  const canInvite = () => me && room.status === 'open' && (isHost() || Object.values(room.seats).some((s) => s?.by?.id === me.id));
  const seatedUsers = () => new Set(Object.values(room.seats).filter((s) => s?.character?.kind === 'human').map((s) => s.character.owner_id));
  const invited = new Map(); // userId → 邀请时间（按钮显示「已邀请」20 秒）
  async function loadOnline() {
    if (!me) return;
    try { online = await api('/online'); } catch { online = []; }
    drawOnline();
  }
  function drawOnline() {
    if (!me) { onlineBox.hidden = true; return; }
    const inRoom = seatedUsers();
    const others = online.filter((u) => !u.me);
    const full = room.filled >= room.players;
    onlineBox.hidden = room.status !== 'open';
    onlineBox.replaceChildren(
      h('h3', {}, '在线玩家', h('small', { class: 'muted' }, ` ${others.length} 人`)),
      others.length ? h('ul', { class: 'online-list' }, ...others.map((u) => {
        const here = inRoom.has(u.id);
        const sent = Date.now() - (invited.get(u.id) || 0) < 20000;
        return h('li', {},
          h('span', { class: 'dot', 'aria-hidden': 'true' }),
          h('span', { class: 'nm' }, u.name),
          h('small', { class: 'muted' }, here ? '在这一局' : u.playing ? `${u.playing.gameName}对局中` : '空闲'),
          canInvite() && !here ? h('button', { type: 'button', class: 'btn sm', disabled: sent || full, title: full ? '座位已经坐满了' : null, onclick: guard(async () => {
            await post(`/rooms/${id}/invite`, { userId: u.id });
            invited.set(u.id, Date.now());
            toast(`已邀请${u.name}`);
            drawOnline();
            setTimeout(drawOnline, 20100);
          }) }, sent ? '已邀请' : '邀请') : null);
      })) : h('div', { class: 'small muted' }, '现在没有别的玩家在线。'),
      canInvite() ? h('div', { class: 'small muted' }, '对方会收到弹窗，点「加入」就本人入座。') : null);
  }

  // 座位上只有选手的简要资料（没有平台的中文名）：模型蛐蛐只写模型，免得写成「deepseek · deepseek-chat」
  const lineOf = (c) => (c.kind === 'model' && !c.providerName ? c.model || '' : modelLine(c));

  function seatCard(seat, i) {
    const s = room.seats[seat];
    const open = room.status === 'open';
    if (!s) {
      // 类名用 vacant：empty 是全站空状态的类名（居中、上下 48px 留白），套在座位卡上会把空座撑高、文字居中
      return h('div', { class: 'card seatcard vacant' }, h('span', { class: 'no' }, i + 1), h('span', { class: 'coin' }, '＋'),
        h('div', {}, h('div', { class: 'nm muted' }, room.seatNames[seat]), h('div', { class: 'md' }, '空位')),
        open && me ? h('button', { class: 'btn sm', type: 'button', onclick: () => pickDialog(seat) }, '拉蛐蛐入座') : null);
    }
    const mineSeat = me && (s.by?.id === me.id || isHost());
    return h('div', { class: 'card seatcard' }, h('span', { class: 'no' }, i + 1), coin(s.character),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm gold-text' }, cleanName(s.character.name)), h('div', { class: 'md' }, [room.seatNames[seat], lineOf(s.character)].filter(Boolean).join(' · ')), h('div', { class: 'md' }, s.character.system ? '系统选手' : s.character.kind === 'human' ? `${s.by?.name ? `${s.by.name} ` : ''}本人入座` : `${s.by?.name || '—'} 带来的`)),
      open && mineSeat ? h('button', { class: 'btn sm ghost', type: 'button', onclick: guard(async () => { room = await post(`/rooms/${id}/leave`, { seat }); draw(); }) }, '离座') : null);
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
            room.status === 'started' ? h('a', { class: 'btn primary lg', href: `#/match/${room.matchId}` }, mySeatName() ? `进入对局（你在${mySeatName()}）` : '进入观战') : null,
            room.status === 'closed' ? h('a', { class: 'btn', href: '#/rooms' }, '返回组局') : null,
            room.status === 'open' && isHost() ? h('button', { class: 'btn primary lg', type: 'button', disabled: !full, onclick: guard(async () => { room = await post(`/rooms/${id}/start`); go(`#/match/${room.matchId}`); }) }, full ? '开局' : '坐满后才能开局') : null,
            room.status === 'open' ? h('div', { class: 'small muted' }, '把这个页面的链接发给朋友，他们登录后可以把自己的蛐蛐拉进空位。') : null,
            room.status === 'open' ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(location.href); toast('链接已复制'); } catch { toast(location.href); } } }, icon('link', 16), '复制邀请链接') : null,
            room.status === 'open' && isHost() ? h('button', { class: 'btn sm ghost danger', type: 'button', onclick: guardConfirm({ title: '关闭组局', body: `关闭「${room.title}」？已经入座的蛐蛐会被请回去，这个局不能再开。`, okText: '关闭组局', danger: true }, async () => {
              room = await post(`/rooms/${id}/close`);
              draw();
            }) }, '关闭组局') : null),
          onlineBox,
          h('div', { class: 'card quiet pad small muted' }, '组局是娱乐赛：不计积分，也不占蛐蛐每天主动参加对局的名额，没有次数限制。每只蛐蛐用的是它主人的 API 密钥。'))));
    drawOnline();
  }
  draw();
  loadOnline();
  // 开局了：自己坐在里面（本人入座）就直接进对局，不用再点「观战」
  function mySeatName() {
    if (!me) return null;
    const hit = Object.entries(room.seats || {}).find(([, s]) => s?.character?.kind === 'human' && s.character.owner_id === me.id);
    return hit ? room.seatNames[hit[0]] : null;
  }
  // 在线名单：有人上线、下线时（服务端两秒合并一次）重新取；另外每 30 秒兜底刷新一次
  const stopLobby = me ? listen(['lobby'], (e) => { if (e.type === 'presence') loadOnline(); }) : () => {};
  const onlineTimer = me ? setInterval(loadOnline, 30000) : null;
  const stopRoom = listen([`room:${id}`], (e) => {
    if (e.type === 'invite_declined') { toast(`${e.name}这次不来`); return; }
    if (e.type !== 'room') return;
    const was = room.status;
    room = e.room;
    if (was !== 'started' && room.status === 'started' && room.matchId && mySeatName()) { toast(`开局了，你在${mySeatName()}`); go(`#/match/${room.matchId}`); return; }
    draw();
  });
  return () => { stopRoom(); stopLobby(); clearInterval(onlineTimer); };
}
