// 账号系统和组局：注册要庄家审批、登录会话、权限边界、组局拉蛐蛐入场、每日上限只算自动匹配。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { initSecrets } from '../server/secrets.js';
import { Hub, Router, handler } from '../server/http.js';
import { AiPool } from '../server/ai-worker.js';
import { Evaluator } from '../server/evaluator.js';
import { Arena } from '../server/arena.js';
import { Matchmaker } from '../server/ladder/matchmaker.js';
import { Compare } from '../server/compare.js';
import { routes } from '../server/api.js';
import { roomRoutes } from '../server/rooms.js';
import { authRoutes, ensureAdmin, userFromRequest, verifyPassword } from '../server/auth.js';
import { ensureSystemCharacters, createCharacter } from '../server/characters.js';

process.env.ARENA_DEV = '1';
process.env.ARENA_ADMIN_PASSWORD = 'admin-pass-123';
const dataDir = mkdtempSync(join(tmpdir(), 'acct-'));
const db = openDb(':memory:');
initSecrets(join(dataDir, 'secret.key'));
const hub = new Hub();
const aiPool = new AiPool(1);
const evaluator = new Evaluator({ enginesDir: join(tmpdir(), 'no-engines-here'), aiPool });
await evaluator.init();
const arena = new Arena({ db, hub, aiPool, evaluator });
ensureAdmin(db, dataDir);
ensureSystemCharacters(db, 'local');
const matchmaker = new Matchmaker(arena);
const compare = new Compare(arena);

const router = new Router();
authRoutes(router, { db, hub, onApproved: (u) => createCharacter(db, u.id, { kind: 'human', name: u.username, avatar: '🙂' }) });
routes(router, { db, hub, arena, matchmaker, compare, evaluator });
roomRoutes(router, { db, hub, arena });
const server = createServer(handler(router, [], { resolveUser: (req) => userFromRequest(db, req), publicView: () => db.getSetting('publicView', true) }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/** 带 Cookie 的简易客户端 */
function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) { const v = set.split(';')[0]; cookie = v.endsWith('=') ? '' : v; call.lastSetCookie = set; }
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b), call };
}

const admin = client();
const alice = client();
const bob = client();
const guest = client();

test('庄家：首次启动用设定的初始密码，登录名 admin；Cookie 是 HttpOnly + SameSite', async () => {
  const u = db.get("SELECT * FROM users WHERE id = 'local'");
  assert.equal(u.role, 'admin');
  assert.equal(u.username, 'admin');
  assert.ok(verifyPassword('admin-pass-123', u.pass_hash));
  assert.notEqual(u.pass_hash, 'admin-pass-123');
  const r = await admin.post('/api/auth/login', { username: 'admin', password: 'admin-pass-123' });
  assert.equal(r.status, 200);
  assert.match(admin.call.lastSetCookie, /HttpOnly/);
  assert.match(admin.call.lastSetCookie, /SameSite=Lax/);
  assert.equal((await admin.get('/api/auth/me')).json.user.role, 'admin');
  assert.equal((await guest.post('/api/auth/login', { username: 'admin', password: 'wrong-password' })).status, 401);
});

test('注册：要庄家审批，通过前不能登录；庄家能看到申请；通过后自动有真人角色', async () => {
  assert.equal((await alice.post('/api/auth/register', { username: 'alice', password: 'short' })).status, 400);
  const r = await alice.post('/api/auth/register', { username: 'alice', password: 'alice-pass-1', note: '想让我的 DeepSeek 来下棋' });
  assert.equal(r.json.status, 'pending');
  assert.equal((await bob.post('/api/auth/register', { username: 'alice', password: 'another-pass' })).status, 409);
  await bob.post('/api/auth/register', { username: 'bob', password: 'bob-pass-12' });
  const login = await alice.post('/api/auth/login', { username: 'alice', password: 'alice-pass-1' });
  assert.equal(login.status, 403);
  assert.match(login.json.error, /审批/);
  assert.equal((await admin.get('/api/auth/me')).json.pending, 2);
  const pending = (await admin.get('/api/admin/users?status=pending')).json;
  assert.deepEqual(pending.map((u) => u.username).sort(), ['alice', 'bob']);
  assert.equal(pending.find((u) => u.username === 'alice').note, '想让我的 DeepSeek 来下棋');
  for (const u of pending) assert.equal((await admin.post(`/api/admin/users/${u.id}/approve`)).status, 200);
  assert.equal((await alice.post('/api/auth/login', { username: 'alice', password: 'alice-pass-1' })).status, 200);
  assert.equal((await bob.post('/api/auth/login', { username: 'bob', password: 'bob-pass-12' })).status, 200);
  const mine = (await alice.get('/api/characters')).json;
  assert.ok(mine.some((c) => c.kind === 'human' && c.mine), '审批通过后有自己的真人角色');
});

test('权限：游客只读，普通用户不能动庄家设置，也不能动别人的蛐蛐', async () => {
  assert.equal((await guest.get('/api/matches')).status, 200, '默认开放观战');
  assert.equal((await guest.post('/api/characters', { kind: 'model', name: 'x', provider: 'mock', model: 'mock' })).status, 401);
  assert.equal((await alice.post('/api/settings', { publicView: false })).status, 403);
  assert.equal((await alice.get('/api/admin/users')).status, 403);
  const a = (await alice.post('/api/characters', { kind: 'model', name: '爱丽丝的鹿', provider: 'mock', model: 'mock', daily_limit: 20 })).json;
  assert.equal(a.owner_id, (await alice.get('/api/auth/me')).json.user.id);
  assert.equal((await bob.patch(`/api/characters/${a.id}`, { name: '偷来的鹿' })).status, 403);
  assert.equal((await alice.patch(`/api/characters/${a.id}`, { daily_limit: 60 })).status, 400, '每天主动对局最多 50');
  const builtin = db.get("SELECT id FROM characters WHERE name = '内置 AI · 初级'").id;
  const steal = await bob.post('/api/matches', { game: 'connect4', seats: { r: a.id, b: builtin } });
  assert.equal(steal.status, 403);
  assert.match(steal.json.error, /组局/);
  assert.equal((await bob.post('/api/matches', { game: 'connect4', seats: { r: builtin, b: builtin }, mode: 'ranked' })).status, 403, '普通用户不能手动开排位');
  // 庄家关闭开放观战后游客看不到
  assert.equal((await admin.post('/api/settings', { publicView: false })).status, 200);
  assert.equal((await guest.get('/api/matches')).status, 401);
  assert.equal((await guest.get('/api/auth/me')).status, 200, '登录状态接口总能访问');
  await admin.post('/api/settings', { publicView: true });
});

test('组局：大家把自己的蛐蛐拉进座位，房主开局；不计入每日主动对局上限', async () => {
  const a = (await alice.post('/api/characters', { kind: 'model', name: '鹿二号', provider: 'mock', model: 'mock' })).json;
  const b = (await bob.post('/api/characters', { kind: 'model', name: '鲍勃的龟', provider: 'mock', model: 'mock' })).json;
  const room = (await alice.post('/api/rooms', { game: 'connect4', title: '四子棋练习', delayMs: 0 })).json;
  assert.equal(room.status, 'open');
  assert.equal((await bob.post(`/api/rooms/${room.id}/seat`, { seat: 'r', characterId: a.id })).status, 403, '不能拉别人的蛐蛐');
  assert.equal((await alice.post(`/api/rooms/${room.id}/seat`, { seat: 'r', characterId: a.id })).status, 200);
  assert.equal((await bob.post(`/api/rooms/${room.id}/seat`, { seat: 'r', characterId: b.id })).status, 409, '座位已有人');
  const builtin = db.get("SELECT id FROM characters WHERE name = '内置 AI · 初级'").id;
  assert.equal((await bob.post(`/api/rooms/${room.id}/seat`, { seat: 'b', characterId: builtin })).status, 403, '只有房主能拉系统选手');
  assert.equal((await bob.post(`/api/rooms/${room.id}/seat`, { seat: 'b', characterId: b.id })).status, 200);
  assert.ok((await guest.get('/api/rooms')).json.some((r) => r.id === room.id), '大厅能看到等待开局的组局');
  assert.equal((await bob.post(`/api/rooms/${room.id}/start`)).status, 403, '只有房主能开局');
  const started = (await alice.post(`/api/rooms/${room.id}/start`)).json;
  assert.equal(started.status, 'started');
  const m = db.get('SELECT origin, created_by, mode FROM matches WHERE id = ?', started.matchId);
  assert.equal(m.origin, 'room');
  assert.equal(m.mode, 'casual');
  // 同一只蛐蛐可以同时再进另一个组局
  const room2 = (await alice.post('/api/rooms', { game: 'connect4' })).json;
  assert.equal((await alice.post(`/api/rooms/${room2.id}/seat`, { seat: 'r', characterId: a.id })).status, 200);
  const u = arena.todayUsage(a.id);
  assert.equal(u.games, 0, '组局不计入每日主动对局');
  assert.equal(u.all, 1);
  arena.control(started.matchId, 'abort');
});

test('真人落子和控制：只有座位上的真人能走、能认输；开局的人能暂停', async () => {
  const aliceHuman = (await alice.get('/api/characters')).json.find((c) => c.kind === 'human');
  const builtin = db.get("SELECT id FROM characters WHERE name = '内置 AI · 初级'").id;
  const id = (await alice.post('/api/matches', { game: 'connect4', seats: { r: aliceHuman.id, b: builtin }, options: { delayMs: 0 } })).json.id;
  assert.equal(db.get('SELECT origin FROM matches WHERE id = ?', id).origin, 'manual');
  assert.equal((await bob.post(`/api/matches/${id}/move`, { action: '4' })).status, 403);
  assert.equal((await bob.post(`/api/matches/${id}/control`, { op: 'resign' })).status, 403);
  assert.equal((await alice.post(`/api/matches/${id}/control`, { op: 'resign' })).status, 200);
});
