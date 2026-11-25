// 组局：房主开一个房间，大家把自己的 AI 蛐蛐（或者自己）拉进座位，坐满后房主开局。
// 组局开出来的是娱乐赛，不计入 AI 蛐蛐每天主动参加的对局上限；同一只蛐蛐可以同时在多个组局和对局里。

import { getGame } from '../games/index.js';
import { newId, now } from './db.js';
import { getCharacter, humanCharacter } from './characters.js';
import { HttpError } from './http.js';
import { canManage } from './auth.js';

const OPEN_HOURS = 6; // 开着没开局的房间 6 小时后自动关闭
const INVITE_GAP_MS = 20000; // 同一个组局对同一个人，20 秒内只发一次邀请

export function roomRoutes(router, { db, hub, arena }) {
  const get = (id) => {
    const r = db.get('SELECT * FROM rooms WHERE id = ?', id);
    if (!r) throw new HttpError(404, '组局不存在');
    return r;
  };

  function view(r) {
    const game = getGame(r.game);
    const seats = {};
    for (const s of game.seats(r.players)) {
      const x = r.seats[s];
      const c = x ? db.get('SELECT c.id, c.name, c.avatar, c.kind, c.provider, c.model, c.level, c.system, c.owner_id, c.agent_timeout, c.last_seen FROM characters c WHERE c.id = ?', x.characterId) : null;
      if (c?.kind === 'human') c.name = db.get('SELECT name FROM users WHERE id = ?', c.owner_id)?.name || c.name; // 真人显示账号名
      const by = x ? db.get('SELECT id, name FROM users WHERE id = ?', x.userId) : null;
      seats[s] = c ? { character: c, by } : null;
    }
    const host = db.get('SELECT id, name FROM users WHERE id = ?', r.host_id);
    return {
      id: r.id, game: r.game, gameName: game.name, players: r.players, title: r.title, status: r.status, host,
      seats, seatNames: Object.fromEntries(game.seats(r.players).map((s) => [s, game.seatName(s)])),
      options: r.options, matchId: r.match_id, created_at: r.created_at, updated_at: r.updated_at,
      filled: Object.values(seats).filter(Boolean).length,
    };
  }

  function save(r, patch) {
    Object.assign(r, patch, { updated_at: now() });
    db.update('rooms', { id: r.id }, { ...patch, updated_at: r.updated_at });
    const v = view(r);
    hub.emit(`room:${r.id}`, { type: 'room', room: v });
    hub.emit('lobby', { type: 'room_updated', room: v });
    return v;
  }

  function expireOld() {
    const cutoff = new Date(Date.now() - OPEN_HOURS * 3600e3).toISOString();
    db.run("UPDATE rooms SET status = 'closed', updated_at = ? WHERE status = 'open' AND updated_at < ?", now(), cutoff);
  }

  // ---------- 在线真人、邀请 ----------

  /** 进行中的对局里我坐着的真人座位（断线重连后顶栏提示「回到对局」） */
  const liveOf = (uid) => arena.liveSeatsOf(uid).map((x) => {
    let gameName = x.game;
    try { gameName = getGame(x.game).name; } catch { /* 游戏已下线 */ }
    return { ...x, gameName };
  });

  router.get('/api/me/live', ({ user }) => liveOf(user.id), { auth: 'user' });

  /** 在线的真人玩家（登录用户开着网站）：名字、在不在对局里。只给登录用户看，游客看不到谁在线 */
  router.get('/api/online', ({ user }) => {
    const ids = hub.onlineIds?.() || [];
    if (!ids.length) return [];
    const rows = db.all(`SELECT id, name FROM users WHERE status = 'active' AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
    return rows.map((u) => {
      const live = liveOf(u.id);
      return { id: u.id, name: u.name, me: u.id === user.id, playing: live.length ? { matchId: live[0].matchId, gameName: live[0].gameName } : null };
    }).sort((a, b) => Number(b.me) - Number(a.me) || Number(!!a.playing) - Number(!!b.playing) || String(a.name).localeCompare(String(b.name), 'zh'));
  }, { auth: 'user' });

  const lastInvite = new Map(); // `${roomId}:${userId}` → 时间
  /** 邀请在线的真人来组局：房主或已经在座的人可以邀请；对方收到弹窗，点「加入」就本人入座 */
  router.post('/api/rooms/:id/invite', ({ params, body, user }) => {
    const r = get(params.id);
    if (r.status !== 'open') throw new HttpError(409, '这个组局已经开局或关闭了');
    const inRoom = Object.values(r.seats).some((x) => x.userId === user.id);
    if (r.host_id !== user.id && user.role !== 'admin' && !inRoom) throw new HttpError(403, '房主或已经入座的人才能邀请');
    const target = db.get("SELECT id, name FROM users WHERE id = ? AND status = 'active'", String(body.userId || ''));
    if (!target) throw new HttpError(404, '没有这个玩家');
    if (target.id === user.id) throw new HttpError(400, '不用邀请自己');
    if (!hub.online?.(target.id)) throw new HttpError(409, `${target.name}现在不在线`);
    const human = humanCharacter(db, target.id);
    if (human && Object.values(r.seats).some((x) => x.characterId === human.id)) throw new HttpError(409, `${target.name}已经在这一局里了`);
    const game = getGame(r.game);
    if (game.seats(r.players).every((s) => r.seats[s])) throw new HttpError(409, '座位已经坐满了');
    const key = `${r.id}:${target.id}`;
    if (Date.now() - (lastInvite.get(key) || 0) < INVITE_GAP_MS) throw new HttpError(429, `刚邀请过${target.name}，等一会儿再邀请`);
    lastInvite.set(key, Date.now());
    if (lastInvite.size > 2000) for (const [k, t] of lastInvite) if (Date.now() - t > INVITE_GAP_MS) lastInvite.delete(k);
    const v = view(r);
    hub.emit(`user:${target.id}`, { type: 'room_invite', from: user.name, room: { id: v.id, title: v.title, gameName: v.gameName, players: v.players, filled: v.filled } });
    return { ok: true, name: target.name };
  });

  /** 本人入座：坐到第一个空位（收到邀请点「加入」） */
  router.post('/api/rooms/:id/join', ({ params, user }) => {
    const r = get(params.id);
    if (r.status !== 'open') throw new HttpError(409, '这个组局已经开局或关闭了');
    const human = humanCharacter(db, user.id);
    if (!human) throw new HttpError(400, '你的账号还没有本人选手');
    if (Object.values(r.seats).some((x) => x.characterId === human.id)) return view(r);
    const game = getGame(r.game);
    const seat = game.seats(r.players).find((s) => !r.seats[s]);
    if (!seat) throw new HttpError(409, '座位已经坐满了');
    return save(r, { seats: { ...r.seats, [seat]: { characterId: human.id, userId: user.id } } });
  });

  /** 不去：告诉组局里的人 */
  router.post('/api/rooms/:id/decline', ({ params, user }) => {
    const r = get(params.id);
    hub.emit(`room:${r.id}`, { type: 'invite_declined', name: user.name });
    return { ok: true };
  });

  router.get('/api/rooms', () => {
    expireOld();
    return db.all("SELECT * FROM rooms WHERE status = 'open' ORDER BY updated_at DESC LIMIT 50").map(view);
  });

  router.get('/api/rooms/:id', ({ params }) => view(get(params.id)));

  router.post('/api/rooms', ({ body, user }) => {
    const game = getGame(String(body.game || ''));
    const n = Number(body.players) || game.players.default;
    if (n < game.players.min || n > game.players.max) throw new HttpError(400, `${game.name}需要 ${game.players.min}–${game.players.max} 人`);
    if (db.get("SELECT COUNT(*) AS n FROM rooms WHERE host_id = ? AND status = 'open'", user.id).n >= 5) throw new HttpError(400, '你已经开了 5 个还没开局的组局，先开局或关掉一些');
    const title = String(body.title || '').trim().slice(0, 30) || `${user.name}的${game.name}局`;
    const r = {
      id: newId('room'), game: game.id, players: n, title, host_id: user.id, status: 'open', seats: {},
      options: { showLegal: body.showLegal !== false, delayMs: Math.max(0, Math.min(10000, Number(body.delayMs ?? 600))) },
      match_id: null, created_at: now(), updated_at: now(),
    };
    db.insert('rooms', r);
    return save(r, {});
  });

  /** 拉一只蛐蛐入座：自己的蛐蛐（包括自己本人、自带 agent）；房主还可以拉系统选手（内置 AI 等）补位 */
  router.post('/api/rooms/:id/seat', ({ params, body, user }) => {
    const r = get(params.id);
    if (r.status !== 'open') throw new HttpError(409, '这个组局已经开局或关闭了');
    const game = getGame(r.game);
    const seat = String(body.seat || '');
    if (!game.seats(r.players).includes(seat)) throw new HttpError(400, '没有这个座位');
    if (r.seats[seat]) throw new HttpError(409, `${game.seatName(seat)}已经有人了`);
    const c = getCharacter(db, String(body.characterId || ''));
    if (c.archived) throw new HttpError(400, '这只蛐蛐已归档');
    const isHost = r.host_id === user.id || user.role === 'admin';
    if (c.system ? !isHost : !canManage(user, c)) throw new HttpError(403, c.system ? '只有房主可以拉系统选手补位' : '只能拉你自己的蛐蛐入场');
    if (c.kind === 'engine' && (c.provider || 'pikafish') !== game.features?.evalEngine) throw new HttpError(400, `${c.name}不会下${game.name}`);
    const taken = Object.values(r.seats).map((x) => x.characterId);
    if (!c.system && taken.includes(c.id)) throw new HttpError(409, `${c.name}已经在这一局里了`);
    return save(r, { seats: { ...r.seats, [seat]: { characterId: c.id, userId: user.id } } });
  });

  /** 离座：自己拉进来的蛐蛐自己可以撤；房主可以请任何人离座 */
  router.post('/api/rooms/:id/leave', ({ params, body, user }) => {
    const r = get(params.id);
    if (r.status !== 'open') throw new HttpError(409, '这个组局已经开局或关闭了');
    const x = r.seats[String(body.seat || '')];
    if (!x) return view(r);
    if (x.userId !== user.id && r.host_id !== user.id && user.role !== 'admin') throw new HttpError(403, '只能撤下自己拉进来的蛐蛐');
    const seats = { ...r.seats };
    delete seats[String(body.seat)];
    return save(r, { seats });
  });

  router.post('/api/rooms/:id/start', ({ params, user }) => {
    const r = get(params.id);
    if (r.host_id !== user.id && user.role !== 'admin') throw new HttpError(403, '只有房主可以开局');
    if (r.status !== 'open') throw new HttpError(409, '这个组局已经开局或关闭了');
    const game = getGame(r.game);
    const missing = game.seats(r.players).filter((s) => !r.seats[s]);
    if (missing.length) throw new HttpError(400, `还有 ${missing.length} 个座位空着`);
    const seats = Object.fromEntries(game.seats(r.players).map((s) => [s, r.seats[s].characterId]));
    arena.checkCapacity(db.get('SELECT id, role FROM users WHERE id = ?', r.host_id));
    const matchId = arena.createMatch({ game: r.game, seats, mode: 'casual', origin: 'room', createdBy: r.host_id, options: r.options });
    return save(r, { status: 'started', match_id: matchId });
  });

  router.post('/api/rooms/:id/close', ({ params, user }) => {
    const r = get(params.id);
    if (r.host_id !== user.id && user.role !== 'admin') throw new HttpError(403, '只有房主可以关闭组局');
    if (r.status !== 'open') return view(r);
    return save(r, { status: 'closed' });
  });
}
