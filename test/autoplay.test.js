// 托管、出牌限时、断线转托管，在线名单和组局邀请（端到端：真的开 HTTP 服务、真的连事件流）

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 断线宽限缩短，测试不用等 15 秒（常量在模块加载时读环境变量，所以下面用动态 import）
process.env.ARENA_DEV = '1';
process.env.ARENA_OFFLINE_GRACE_MS = '400';
process.env.ARENA_OFFLINE_SLOW_MS = '800';

const { openDb, now } = await import('../server/db.js');
const { initSecrets } = await import('../server/secrets.js');
const { Hub, Router, handler } = await import('../server/http.js');
const { AiPool } = await import('../server/ai-worker.js');
const { Evaluator } = await import('../server/evaluator.js');
const { Arena, turnLimitMs } = await import('../server/arena.js');
const { routes } = await import('../server/api.js');
const { roomRoutes } = await import('../server/rooms.js');
const { userFromRequest, createSession } = await import('../server/auth.js');
const { createCharacter, ensureSystemCharacters } = await import('../server/characters.js');
const { Matchmaker } = await import('../server/ladder/matchmaker.js');
const { Compare } = await import('../server/compare.js');
const { getGame } = await import('../games/index.js');

const db = openDb(':memory:');
initSecrets(join(tmpdir(), `autoplay-test-${process.pid}.key`));
const hub = new Hub();
const aiPool = new AiPool(1);
const evaluator = new Evaluator({ enginesDir: join(tmpdir(), 'no-engines-here'), aiPool });
await evaluator.init();
const arena = new Arena({ db, hub, aiPool, evaluator });
ensureSystemCharacters(db, 'local');
const router = new Router();
routes(router, { db, hub, arena, matchmaker: new Matchmaker(arena), compare: new Compare(arena), evaluator });
roomRoutes(router, { db, hub, arena });
const server = createServer(handler(router, [], { resolveUser: (req) => userFromRequest(db, req), publicView: () => true }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.closeAllConnections?.(); server.close(); aiPool.close?.(); for (const id of [...arena.live.keys()]) stop(id); });

const events = [];
const emit0 = hub.emit.bind(hub);
hub.emit = (ch, e) => { events.push({ ch, ...e }); emit0(ch, e); };

function makeUser(id, name) {
  db.insert('users', { id, name, username: id, role: 'user', status: 'active', created_at: now() });
  const human = createCharacter(db, id, { kind: 'human', name: '我', avatar: '🙂' });
  const cookie = `dsqq_sid=${createSession(db, id)}`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return {
    id, name, human,
    get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b),
    /** 打开网站：连上事件流（在线）；返回断开函数（断线） */
    async connect(chans = 'lobby') {
      const ac = new AbortController();
      const res = await fetch(`${base}/api/events?ch=${encodeURIComponent(chans)}`, { headers: { Cookie: cookie }, signal: ac.signal });
      const reader = res.body.getReader();
      (async () => { try { while (!(await reader.read()).done); } catch { /* 断开 */ } })();
      return () => ac.abort();
    },
  };
}
const ann = makeUser('u_ann', '安');
const ben = makeUser('u_ben', '本');
const builtin = db.get("SELECT * FROM characters WHERE name = '内置 AI · 初级'");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, what = '条件') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(30); }
  throw new Error(`等不到${what}`);
}
const stop = (id) => { const rt = arena.live.get(id); if (rt) { rt.abortReason = '测试结束'; rt.abort.abort(); rt.wake?.(); } };
const turnsOf = (id) => db.all('SELECT ply, seat, analysis FROM turns WHERE match_id = ? ORDER BY ply', id);

test('每步限时：牌类用 features.turnLimit，其他游戏仍是 10 分钟；对局选项可以改', () => {
  assert.equal(turnLimitMs({ options: {} }, getGame('mahjong')), 20000);
  assert.equal(turnLimitMs({ options: {} }, getGame('doudizhu')), 25000);
  assert.equal(turnLimitMs({ options: {} }, getGame('xiangqi')), 600000);
  assert.equal(turnLimitMs({ options: { humanTimeout: 6 } }, getGame('poker')), 6000);
  for (const g of ['doudizhu', 'poker', 'mahjong', 'guandan', 'liar']) assert.ok(getGame(g).features.turnLimit > 0, g);
  for (const g of ['xiangqi', 'chess', 'gomoku', 'werewolf', 'undercover', 'turtlesoup', 'dilemma']) assert.ok(!getGame(g).features.turnLimit, g);
});

test('超时：系统代打这一步并转托管；托管中马上代打；取消后自己出', async () => {
  const id = arena.createMatch({ game: 'doudizhu', seats: { p1: ann.human.id, p2: builtin.id, p3: builtin.id }, mode: 'casual', options: { delayMs: 0, seed: 7, humanTimeout: 5 } });
  await until(() => arena.live.get(id)?.humans?.p1, 15000, '轮到安');
  const d = (await ann.get(`/api/matches/${id}`)).json;
  assert.equal(d.waitingHuman, 'p1');
  assert.ok(d.waitingLeft > 3000 && d.waitingLeft <= 5000, `剩余 ${d.waitingLeft}`);
  assert.equal(d.turnLimit, 5000);
  // 不出：5 秒后系统代打，转托管
  await until(() => arena.live.get(id)?.auto?.p1 === 'timeout', 8000, '超时转托管');
  await until(() => turnsOf(id).some((t) => t.seat === 'p1' && /超时，系统代为行动/.test(t.analysis || '')), 3000, '代打记录');
  assert.ok(events.some((e) => e.ch === `match:${id}` && e.type === 'auto' && e.seat === 'p1' && e.reason === 'timeout'));
  // 托管中：再轮到时 1.5 秒内代打
  const n0 = turnsOf(id).filter((t) => t.seat === 'p1').length;
  await until(() => turnsOf(id).filter((t) => t.seat === 'p1').length > n0, 20000, '托管代打');
  assert.ok(turnsOf(id).some((t) => t.seat === 'p1' && /托管，系统代为行动/.test(t.analysis || '')));
  // 别人不能替安开关托管；安自己取消
  assert.equal((await ben.post(`/api/matches/${id}/control`, { op: 'auto_off' })).status, 403);
  const off = await ann.post(`/api/matches/${id}/control`, { op: 'auto_off' });
  assert.equal(off.status, 200);
  assert.deepEqual(off.json.auto, {});
  // 取消后轮到安：不会马上代打，要等满限时
  await until(() => arena.live.get(id)?.humans?.p1, 20000, '再轮到安');
  const t0 = Date.now();
  await sleep(1800);
  assert.ok(arena.live.get(id)?.humans?.p1, '取消托管后系统不再马上代打');
  // 托管打开：正等着的这一步马上代打
  await ann.post(`/api/matches/${id}/control`, { op: 'auto_on' });
  await until(() => !arena.live.get(id)?.humans?.p1 || arena.live.get(id)?.humans?.p1.at > t0 + 1800, 3000, '打开托管后代打');
  assert.equal(arena.live.get(id)?.auto?.p1, 'manual');
  stop(id);
});

test('没有托管的游戏：开关托管报错', async () => {
  const id = arena.createMatch({ game: 'gomoku', seats: Object.fromEntries(getGame('gomoku').seats(2).map((s, i) => [s, i ? builtin.id : ann.human.id])), mode: 'casual', options: { delayMs: 0 } });
  await until(() => arena.live.get(id), 3000, '开局');
  assert.equal((await ann.post(`/api/matches/${id}/control`, { op: 'auto_on' })).status, 400);
  stop(id);
});

test('断线：宽限期后转托管，连回来自动取消；在线名单、我的进行中对局', async () => {
  const offA = await ann.connect();
  const offB = await ben.connect();
  await until(() => hub.online(ann.id) && hub.online(ben.id), 3000, '两人在线');
  const list = (await ann.get('/api/online')).json;
  assert.deepEqual(list.map((u) => [u.name, u.me]), [['安', true], ['本', false]]);
  assert.equal((await fetch(`${base}/api/online`)).status, 401, '游客看不到谁在线');

  const id = arena.createMatch({ game: 'mahjong', seats: { p1: ann.human.id, p2: builtin.id, p3: builtin.id, p4: builtin.id }, mode: 'casual', options: { delayMs: 0, seed: 3 } });
  await until(() => arena.live.get(id), 3000, '开局');
  await until(() => [...arena.live.keys()].length === 1, 5000, '前面的对局收尾');
  const live = (await ann.get('/api/me/live')).json;
  assert.equal(live.length, 1);
  assert.equal(live[0].matchId, id);
  assert.equal(live[0].gameName, '麻将');
  assert.equal((await ann.get('/api/online')).json[0].playing.matchId, id);

  offA(); // 安断线
  await until(() => arena.live.get(id)?.auto?.p1 === 'offline', 5000, '断线转托管');
  const reconnect = await ann.connect();
  await until(() => !arena.live.get(id)?.auto?.p1, 3000, '回来自动取消托管');
  // 本人点的托管，断线再回来不会被取消
  await ann.post(`/api/matches/${id}/control`, { op: 'auto_on' });
  reconnect();
  await sleep(700);
  const back = await ann.connect();
  await sleep(200);
  assert.equal(arena.live.get(id)?.auto?.p1, 'manual');
  stop(id);
  back(); offB();
});

test('组局邀请：房主邀请在线玩家，对方收到私信、加入就本人入座；不在线、重复邀请、外人邀请都不行', async () => {
  const offB = await ben.connect();
  await until(() => hub.online(ben.id), 3000, '本在线');
  const room = (await ann.post('/api/rooms', { game: 'mahjong', players: 4, title: '测试局' })).json;
  assert.equal((await ann.post(`/api/rooms/${room.id}/join`)).status, 200);
  // 外人（本不在局里、也不是房主）不能邀请
  assert.equal((await ben.post(`/api/rooms/${room.id}/invite`, { userId: ann.id })).status, 403);
  const from = events.length;
  const r = await ann.post(`/api/rooms/${room.id}/invite`, { userId: ben.id });
  assert.equal(r.status, 200);
  const inv = events.slice(from).find((e) => e.ch === `user:${ben.id}` && e.type === 'room_invite');
  assert.equal(inv.from, '安');
  assert.equal(inv.room.id, room.id);
  assert.equal(inv.room.gameName, '麻将');
  assert.equal((await ann.post(`/api/rooms/${room.id}/invite`, { userId: ben.id })).status, 429, '20 秒内不重复邀请');
  // 本点「加入」：本人坐进第一个空位
  const j = await ben.post(`/api/rooms/${room.id}/join`);
  assert.equal(j.status, 200);
  assert.equal(j.json.seats.p2.character.id, ben.human.id);
  assert.equal((await ann.post(`/api/rooms/${room.id}/invite`, { userId: ben.id })).status, 409, '已经在局里');
  // 不在线的人邀请不了
  offB();
  await until(() => !hub.online(ben.id), 3000, '本下线');
  const cara = makeUser('u_cara', '卡拉');
  assert.equal((await ann.post(`/api/rooms/${room.id}/invite`, { userId: cara.id })).status, 409);
  // 不去：组局里的人收到一句
  const f2 = events.length;
  await cara.post(`/api/rooms/${room.id}/decline`);
  assert.ok(events.slice(f2).some((e) => e.ch === `room:${room.id}` && e.type === 'invite_declined' && e.name === '卡拉'));
});
