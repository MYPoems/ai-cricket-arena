// 第三轮挑刺（服务端与规则）修过的问题：
// 自带 agent 座位的保密（隐藏信息、引擎评估、同一副牌的系列赛）、真人超时托管、狼人杀猎人开枪后再判胜负、
// 自定义接口地址不能指向内网、环境变量密钥只给庄家、派生不能绕过限制、事件流频道与连接上限、同时开局上限。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { initSecrets, getKey, keyStatus } from '../server/secrets.js';
import { Hub, Router, handler, SSE_MAX_PER_IP } from '../server/http.js';
import { AiPool } from '../server/ai-worker.js';
import { Evaluator } from '../server/evaluator.js';
import { Arena, timeoutAction, MAX_LIVE_PER_USER } from '../server/arena.js';
import { Matchmaker } from '../server/ladder/matchmaker.js';
import { Compare } from '../server/compare.js';
import { routes } from '../server/api.js';
import { roomRoutes } from '../server/rooms.js';
import { lobbyRoutes } from '../server/lobby.js';
import { agentRoutes } from '../server/agent-api.js';
import { authRoutes, ensureAdmin, userFromRequest } from '../server/auth.js';
import { ensureSystemCharacters, createCharacter, issueAgentToken } from '../server/characters.js';
import { isPrivateAddress, assertPublicURL } from '../server/providers/netguard.js';
import { needsGuard } from '../server/providers/index.js';
import { getGame } from '../games/index.js';

process.env.ARENA_DEV = '1';
process.env.ARENA_ADMIN_PASSWORD = 'admin-pass-123';
const dataDir = mkdtempSync(join(tmpdir(), 'r3-'));
const db = openDb(':memory:');
initSecrets(join(dataDir, 'secret.key'));
const hub = new Hub();
const events = [];
const realEmit = hub.emit.bind(hub);
hub.emit = (ch, e) => { events.push({ ch, ...e }); realEmit(ch, e); };
const aiPool = new AiPool(1);
const evaluator = new Evaluator({ enginesDir: join(tmpdir(), 'no-engines-here'), aiPool });
await evaluator.init();
const arena = new Arena({ db, hub, aiPool, evaluator });
ensureAdmin(db, dataDir);
ensureSystemCharacters(db, 'local');
const matchmaker = new Matchmaker(arena);
const compare = new Compare(arena);
const builtin = db.get("SELECT * FROM characters WHERE name = '内置 AI · 初级'");
const random = db.get("SELECT * FROM characters WHERE name = '随机走子'");
const me = db.get("SELECT * FROM characters WHERE kind = 'human' AND owner_id = 'local'");

const router = new Router();
authRoutes(router, { db, hub, onApproved: (u) => createCharacter(db, u.id, { kind: 'human', name: u.username, avatar: '🙂' }) });
routes(router, { db, hub, arena, matchmaker, compare, evaluator });
roomRoutes(router, { db, hub, arena });
lobbyRoutes(router, { db, arena, matchmaker });
agentRoutes(router, { db, arena });
const server = createServer(handler(router, [], { resolveUser: (req) => userFromRequest(db, req), publicView: () => db.getSetting('publicView', true) }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); aiPool.close?.(); });

function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) { const v = set.split(';')[0]; cookie = v.endsWith('=') ? '' : v; }
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b) };
}
const admin = client();
const alice = client();
const guest = client();
await admin.post('/api/auth/login', { username: 'admin', password: 'admin-pass-123' });
await alice.post('/api/auth/register', { username: 'alice', password: 'alice-pass-1' });
const aliceId = db.get("SELECT id FROM users WHERE username = 'alice'").id;
await admin.post(`/api/admin/users/${aliceId}/approve`);
await alice.post('/api/auth/login', { username: 'alice', password: 'alice-pass-1' });

const agentCall = (token, path, body) => fetch(`${base}${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
function newAgent(name) {
  const c = createCharacter(db, 'local', { kind: 'agent', name });
  return { c, token: issueAgentToken(db, c.id) };
}
const stop = async (id) => {
  const rt = arena.live.get(id);
  if (rt) { rt.abortReason = '测试结束'; rt.abort.abort(); rt.wake?.(); }
  for (let i = 0; i < 200 && arena.live.has(id); i++) await new Promise((r) => setTimeout(r, 10));
};
const until = async (fn, ms = 10000) => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('等待超时'); await new Promise((r) => setTimeout(r, 20)); }
};

// ---------- 自带 agent 座位的保密 ----------

test('隐藏信息对局里有自带 agent：进行中对外只有公共视角，不给种子、别人的词、别人的思考', async () => {
  const uc = getGame('undercover');
  const { c, token } = newAgent('卧底 agent');
  const mock = createCharacter(db, 'local', { kind: 'model', name: '模拟甲', provider: 'mock', model: 'mock' });
  const seed = 11;
  const st = uc.create({ players: 4, seed });
  const from = events.length;
  const id = arena.createMatch({ game: 'undercover', seats: { p1: c.id, p2: mock.id, p3: builtin.id, p4: builtin.id }, mode: 'casual', options: { delayMs: 0, seed, hideThoughts: false } });
  const turn = (await agentCall(token, '/api/agent/turn?wait=20')).json.turn; // 等到轮到 agent（前面的座位已经说过话）
  assert.ok(turn, 'agent 领到回合');
  // 游客请求对局详情（agent 自己不登录也能这样请求）
  const d = (await guest.get(`/api/matches/${id}`)).json;
  assert.equal(d.hiddenLive, true);
  assert.equal(d.record.actions, null, '不给行动记录');
  assert.equal(d.record.seed, undefined, '不给种子');
  assert.equal(d.viewer, null);
  assert.equal(d.view.pair, null, '看不到词对');
  assert.deepEqual(d.view.words, {}, '看不到任何人的词');
  assert.equal(d.options.hideThoughts, true, '强制隐藏思考');
  assert.ok(d.turns.every((t) => !t.analysis && !t.reasoning), '进行中不给模型的思考');
  const txt = JSON.stringify(d);
  const spoken = d.view.speeches.map((s) => s.text).join('');
  for (const w of new Set(Object.values(st.words))) if (!spoken.includes(w)) assert.ok(!txt.includes(w), `详情里出现了词「${w}」`);
  // 用 ?viewer= 也换不到别人的视角
  const d2 = (await guest.get(`/api/matches/${id}?viewer=p2`)).json;
  assert.equal(d2.viewer, null);
  assert.deepEqual(d2.view.words, {});
  // 事件流：不广播局面，不广播思考
  const mine = events.slice(from).filter((e) => e.ch === `match:${id}`);
  assert.ok(mine.filter((e) => e.type === 'move').every((e) => e.view === null && !e.analysis), '走子事件不带上帝视角和思考');
  assert.equal(mine.filter((e) => e.type === 'delta').length, 0, '不推送思考');
  // 大厅缩略图也只有公共视角
  const card = (await guest.get('/api/lobby')).json.live.find((x) => x.id === id);
  assert.deepEqual(card.view.words, {});
  await stop(id);
  // 结束后全部公开
  const end = arena.detail(id);
  assert.ok(Array.isArray(end.record.actions));
  assert.ok(end.view.pair);
});

test('有真人或 agent 在下的棋：进行中不对外给引擎评估（含最佳着法），结束后公开', async () => {
  for (const kind of ['human', 'agent']) {
    const seatChar = kind === 'human' ? me : newAgent('下棋 agent').c;
    const from = events.length;
    const id = arena.createMatch({ game: 'xiangqi', seats: { r: builtin.id, b: seatChar.id }, mode: 'casual', options: { delayMs: 0 } });
    await until(() => db.get('SELECT eval FROM turns WHERE match_id = ? AND ply = 1', id)?.eval, 20000); // 评估照常入库
    const mine = events.slice(from).filter((e) => e.ch === `match:${id}`);
    assert.equal(mine.filter((e) => e.type === 'eval').length, 0, `${kind}：不推送评估事件`);
    const d = (await guest.get(`/api/matches/${id}`)).json;
    assert.equal(d.evalHidden, true);
    assert.equal(d.options.startEval, undefined);
    assert.ok(d.turns.length >= 1 && d.turns.every((t) => t.eval === null), `${kind}：详情里不给评估`);
    assert.ok(!JSON.stringify(d).includes('"best"'), '详情里没有最佳着法');
    const card = (await guest.get('/api/lobby')).json.live.find((x) => x.id === id);
    assert.equal(card.redE, null, '大厅卡片不给胜率');
    await stop(id);
    const end = arena.detail(id);
    assert.equal(end.evalHidden, false);
    assert.ok(end.turns.some((t) => t.eval), '结束后公开评估');
  }
  // 没有真人和 agent 的对局照常推送评估
  const from = events.length;
  const id = arena.createMatch({ game: 'xiangqi', seats: { r: builtin.id, b: random.id }, mode: 'casual', options: { delayMs: 0 } });
  await until(() => events.slice(from).some((e) => e.ch === `match:${id}` && e.type === 'eval' && e.ply >= 1), 20000);
  assert.equal(arena.detail(id).evalHidden, false);
  await stop(id);
});

test('有 agent 的排位：强制隐藏思考；同一副牌的系列赛第二盘换牌', async () => {
  const a = newAgent('复式 agent');
  const id = arena.createMatch({ game: 'doudizhu', seats: { p1: a.c.id, p2: builtin.id, p3: builtin.id }, mode: 'ranked', origin: 'auto', options: { hideThoughts: false } });
  const row = db.get('SELECT options, setup FROM matches WHERE id = ?', id);
  assert.equal(row.options.hideThoughts, true);
  assert.equal(row.options.series.leg, 1);
  const next = matchmaker.onFinished({ ...arena.summary(id), status: 'finished' });
  assert.ok(next, '开出第二盘');
  const row2 = db.get('SELECT options, setup FROM matches WHERE id = ?', next);
  assert.equal(row2.options.series.leg, 2);
  assert.notEqual(row2.setup.seed, row.setup.seed, '有 agent 时第二盘不能是同一副牌');
  await stop(id);
  await stop(next);
  // 没有 agent 和真人时仍然是同一副牌（复式）
  const mock = createCharacter(db, 'local', { kind: 'model', name: '模拟乙', provider: 'mock', model: 'mock' });
  const id3 = arena.createMatch({ game: 'doudizhu', seats: { p1: mock.id, p2: builtin.id, p3: builtin.id }, mode: 'ranked', origin: 'auto' });
  const next3 = matchmaker.onFinished({ ...arena.summary(id3), status: 'finished' });
  assert.equal(db.get('SELECT setup FROM matches WHERE id = ?', next3).setup.seed, db.get('SELECT setup FROM matches WHERE id = ?', id3).setup.seed);
  await stop(id3);
  await stop(next3);
});

test('对局详情：viewer 参数是对象原型上的名字时不出错', () => {
  const id = arena.createMatch({ game: 'connect4', seats: { r: random.id, b: random.id }, mode: 'casual', options: { delayMs: 5000 } });
  for (const v of ['constructor', '__proto__', 'toString', 'nobody']) assert.equal(arena.detail(id, v).viewer, null);
  return stop(id);
});

// ---------- 真人超时 ----------

test('真人超时：有默认行动用默认行动；多人局没有默认行动时系统代打，两人局判负', async () => {
  const ww = getGame('werewolf');
  let s = ww.create({ players: 6, seed: 3 });
  const wolf = ww.pending(s)[0];
  assert.equal(await timeoutAction(ww, s, wolf, 6), 'none', '狼人超时空刀');
  // 走到预言家：没有「不查」这个行动，由系统替他随便查一个
  while (s.phase === 'wolf') s = ww.apply(s, ww.pending(s)[0], 'none');
  assert.equal(s.phase, 'seer');
  const seer = ww.pending(s)[0];
  const check = await timeoutAction(ww, s, seer, 6);
  assert.match(check, /^p\d$/);
  s = ww.apply(s, seer, check);
  while (s.phase !== 'speak') s = ww.apply(s, ww.pending(s)[0], ww.autoAction(s, ww.pending(s)[0]) ?? 'none');
  const speaker = ww.pending(s)[0];
  const say = await timeoutAction(ww, s, speaker, 6);
  assert.match(say, /超时/, '发言只说超时，不替他表态');
  assert.ok(!/预言家|狼人|好人/.test(say));
  ww.apply(s, speaker, say);

  const ddz = getGame('doudizhu');
  let d = ddz.create({ seed: 9 });
  assert.equal(await timeoutAction(ddz, d, ddz.pending(d)[0], 3), '叫0', '叫分超时不叫');
  d = ddz.apply(d, ddz.pending(d)[0], '叫3');
  const lead = await timeoutAction(ddz, d, ddz.pending(d)[0], 3);
  assert.ok(lead && lead !== '不出', '领出超时由系统代出一手');
  d = ddz.apply(d, ddz.pending(d)[0], lead);
  assert.equal(await timeoutAction(ddz, d, ddz.pending(d)[0], 3), '不出', '跟牌超时不出');

  const uc = getGame('undercover');
  let u = uc.create({ players: 4, seed: 2 });
  const usay = await timeoutAction(uc, u, uc.pending(u)[0], 4);
  assert.ok(usay);
  uc.apply(u, uc.pending(u)[0], usay);
  while (u.phase === 'speak') u = uc.apply(u, uc.pending(u)[0], uc.builtinMove(u, uc.pending(u)[0]));
  assert.match(await timeoutAction(uc, u, uc.pending(u)[0], 4), /^p\d$/, '投票超时由系统代投');

  const pk = getGame('poker');
  const p = pk.create({ players: 3, seed: 4 });
  assert.equal(await timeoutAction(pk, p, pk.pending(p)[0], 3), 'fold', '面对下注超时弃牌');
  const xq = getGame('xiangqi');
  const x = xq.create({ players: 2 });
  assert.equal(await timeoutAction(xq, x, xq.pending(x)[0], 2), null, '两人棋类超时判负');
});

test('新开的狼人杀对局带规则版本 2（旧记录没有，按版本 1 重放）', async () => {
  const ww = getGame('werewolf');
  let seed = 1;
  while (ww.create({ players: 6, seed }).roles.p1 !== 'villager') seed++;
  const seats = { p1: me.id, p2: builtin.id, p3: builtin.id, p4: builtin.id, p5: builtin.id, p6: builtin.id };
  const id = arena.createMatch({ game: 'werewolf', seats, mode: 'casual', options: { delayMs: 0, seed } });
  const row = db.get('SELECT setup FROM matches WHERE id = ?', id);
  assert.equal(row.setup.setup.rules, 2);
  assert.equal(arena.detail(id, null, 'local').view.n, 6);
  await stop(id);
  assert.equal(arena.detail(id).record.setup.rules, 2, '结束后浏览器重放也用同一版本');
  assert.equal(ww.create({ players: 6, seed }).rules, 1);
});

// ---------- 狼人杀：猎人开枪后再判胜负 ----------

test('狼人杀规则版本 2：猎人出局时先开枪再判胜负；旧记录（版本 1）照旧', () => {
  const ww = getGame('werewolf');
  const build = (rules) => {
    let seed = 1;
    let s;
    for (;; seed++) { s = ww.create({ players: 7, seed, setup: rules ? { rules } : {} }); if (s.roles.p1 === 'wolf' && s.roles.p2 === 'hunter' && s.roles.p3 === 'villager') break; }
    // 摆一个残局：只剩 1 狼（p1）、猎人（p2）、村民（p3），白天投票
    const dead = s.seats.filter((x) => !['p1', 'p2', 'p3'].includes(x));
    s.alive = ['p1', 'p2', 'p3'];
    s.deaths = dead.map((seat) => ({ seat, day: 1, time: 'day', cause: 'vote' }));
    s.day = 3;
    s.phase = 'vote';
    s.votes = {};
    s.queue = [];
    s.potions = { save: false, poison: false };
    return s;
  };
  const voteOutHunter = (s) => {
    s = ww.apply(s, 'p1', 'p2');
    s = ww.apply(s, 'p3', 'p2');
    return ww.apply(s, 'p2', 'p1');
  };
  // 版本 1（旧记录）：猎人一出局就判狼人胜
  const old = voteOutHunter(build(null));
  assert.equal(old.rules, 1);
  assert.equal(ww.outcome(old).winnerTeam, '狼人');
  // 版本 2：先遗言、再开枪；带走最后一只狼，好人胜
  let s = voteOutHunter(build(2));
  assert.equal(ww.outcome(s).over, false, '猎人还没开枪，不判');
  assert.equal(s.phase, 'lastword');
  s = ww.apply(s, 'p2', '我是猎人，带走 1 号。');
  assert.equal(s.phase, 'hunter');
  assert.equal(ww.autoAction(s, 'p2'), null, '真的要问猎人');
  const shot = ww.apply(s, 'p2', 'p1');
  assert.equal(ww.outcome(shot).winnerTeam, '好人');
  // 不开枪（或带走的不是狼）：补判狼人胜
  const hold = ww.apply(s, 'p2', 'none');
  assert.equal(ww.outcome(hold).winnerTeam, '狼人');
  const wrong = ww.apply(s, 'p2', 'p3');
  assert.equal(ww.outcome(wrong).winnerTeam, '狼人');
  // 夜里被刀也一样：1 狼、猎人、村民、女巫（没药）……狼刀猎人后本该狼人胜，猎人先开枪
  let n = build(2);
  n.phase = 'vote';
  n = ww.apply(n, 'p1', 'none'); n = ww.apply(n, 'p2', 'none'); n = ww.apply(n, 'p3', 'none'); // 全部弃票，进入夜晚
  assert.equal(n.phase, 'wolf');
  while (n.phase !== 'over' && !(n.phase === 'hunter' && ww.autoAction(n, ww.pending(n)[0]) === null)) {
    const seat = ww.pending(n)[0];
    const auto = ww.autoAction(n, seat);
    n = ww.apply(n, seat, auto ?? (n.phase === 'wolf' ? 'p2' : n.phase === 'seer' ? 'p1' : 'none'));
  }
  assert.equal(n.phase, 'hunter', '夜里被刀的猎人也先开枪');
  assert.equal(ww.outcome(ww.apply(n, 'p2', 'p1')).winnerTeam, '好人');
  assert.equal(ww.outcome(ww.apply(n, 'p2', 'none')).winnerTeam, '狼人');
});

// ---------- 接口地址、密钥 ----------

test('自定义接口地址：普通用户不能指向本机或内网，庄家不限', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  const dns = (map) => async (host) => { if (!map[host]) throw new Error('ENOTFOUND'); return map[host].map((address) => ({ address })); };
  await assert.rejects(() => assertPublicURL('http://127.0.0.1:3200/v1'), /内网/);
  await assert.rejects(() => assertPublicURL('http://2130706433/v1'), /内网/, '十进制写法的 127.0.0.1');
  await assert.rejects(() => assertPublicURL('http://[::1]:11434/v1'), /内网/);
  await assert.rejects(() => assertPublicURL('file:///etc/passwd'), /http/);
  await assert.rejects(() => assertPublicURL('http://user:pw@example.com/v1'), /用户名/);
  await assert.rejects(() => assertPublicURL('https://nas.example/v1', dns({ 'nas.example': ['192.168.1.10'] })), /内网/);
  await assert.rejects(() => assertPublicURL('https://mixed.example/v1', dns({ 'mixed.example': ['8.8.8.8', '10.0.0.1'] })), /内网/, '有一个解析结果在内网就不行');
  await assert.rejects(() => assertPublicURL('https://nope.example/v1', dns({})), /解析不了/);
  await assertPublicURL('https://api.example/v1', dns({ 'api.example': ['8.8.8.8'] }));

  assert.equal(needsGuard(db, aliceId, 'custom'), true);
  assert.equal(needsGuard(db, aliceId, 'ollama'), true);
  assert.equal(needsGuard(db, aliceId, 'deepseek'), false, '预置平台只能用官方地址，不用查');
  assert.equal(needsGuard(db, 'local', 'custom'), false, '庄家不限');

  const bad = await alice.post('/api/characters', { kind: 'model', name: '内网探针', provider: 'custom', model: 'x', base_url: 'http://127.0.0.1:3200/v1' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /内网/);
  assert.equal((await alice.post('/api/characters', { kind: 'model', name: '本地模型', provider: 'ollama', model: 'x' })).status, 400, 'Ollama 默认地址是服务器本机');
  const list = await alice.post('/api/provider-models', { provider: 'custom', baseURL: 'http://192.168.1.1/v1' });
  assert.equal(list.status, 400);
  assert.match(list.json.error, /内网/);
  const t = await alice.post('/api/test-config', { provider: 'custom', model: 'x', base_url: 'http://169.254.169.254/latest' });
  assert.equal(t.json.ok, false);
  assert.match(t.json.error, /内网/);
  const ok = await admin.post('/api/characters', { kind: 'model', name: '庄家的本地模型', provider: 'ollama', model: 'x' });
  assert.equal(ok.status, 200, '庄家可以用本机 Ollama');
});

test('派生不能绕过新建时的限制：不能派生出真人角色、本机订阅通道、内网地址', async () => {
  const a = (await alice.post('/api/characters', { kind: 'model', name: '鹿', provider: 'mock', model: 'mock' })).json;
  assert.equal((await alice.post(`/api/characters/${a.id}/derive`, { kind: 'human', name: '第二个我' })).status, 400);
  assert.equal((await alice.post(`/api/characters/${a.id}/derive`, { provider: 'claude-cli', model: 'claude-opus-5-5' })).status, 403);
  const r = await alice.post(`/api/characters/${a.id}/derive`, { provider: 'custom', model: 'x', base_url: 'http://10.0.0.5:8080/v1' });
  assert.equal(r.status, 400);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM characters WHERE owner_id = ? AND kind = 'human'", aliceId).n, 1);
  assert.equal((await alice.post(`/api/characters/${a.id}/derive`, { name: '鹿·二' })).status, 200);
});

test('环境变量里的密钥只给庄家名下的选手用', () => {
  process.env.DEEPSEEK_API_KEY = 'sk-env-owner';
  try {
    assert.equal(getKey(db, 'local', 'deepseek'), 'sk-env-owner');
    assert.equal(getKey(db, aliceId, 'deepseek'), null, '别的用户要自己填密钥');
    assert.equal(keyStatus(db, 'local').deepseek, 'env');
    assert.equal(keyStatus(db, aliceId).deepseek, 'none');
  } finally {
    delete process.env.DEEPSEEK_API_KEY;
  }
});

test('密钥接口：不是字符串或太长的密钥回 400', async () => {
  assert.equal((await alice.post('/api/keys', { provider: 'deepseek', key: 12345 })).status, 400);
  assert.equal((await alice.post('/api/keys', { provider: 'deepseek', key: 'x'.repeat(600) })).status, 400);
  assert.equal((await alice.post('/api/keys', { provider: 'deepseek', key: 'sk-alice' })).status, 200);
  assert.equal(getKey(db, aliceId, 'deepseek'), 'sk-alice');
  assert.equal((await alice.post('/api/keys', { provider: 'deepseek', key: '' })).status, 200);
});

// ---------- 事件流、上限 ----------

test('事件流：只收认识的频道名，没人听的频道不留；同一地址的连接有上限', () => {
  const h = new Hub();
  const conns = [];
  const open = (ip, chans) => {
    const handlers = {};
    const req = { headers: {}, socket: { remoteAddress: ip }, on: (ev, fn) => { handlers[ev] = fn; } };
    const res = { writeHead() {}, write() {} };
    h.subscribe(req, res, chans);
    conns.push(handlers);
    return handlers;
  };
  const c = open('1.2.3.4', ['match:m1', 'lobby']);
  assert.equal(h.watchers('match:m1'), 1);
  c.close();
  c.close(); // 重复触发不重复扣
  assert.equal(h.channels.has('match:m1'), false, '没人听的频道删掉');
  assert.equal(h.total, 0);
  for (let i = 0; i < SSE_MAX_PER_IP; i++) open('5.6.7.8', ['lobby']);
  assert.throws(() => open('5.6.7.8', ['lobby']), (e) => e.status === 429);
  open('9.9.9.9', ['lobby']); // 别的地址不受影响
  for (const x of conns) x.close?.();
  assert.equal(h.total, 0);
  assert.equal(h.perIp.size, 0);
});

test('事件流接口：乱写的频道名不建频道，admin 频道只给庄家', async () => {
  const sub = async (cl, ch) => {
    const ac = new AbortController();
    const cookie = cl === alice ? aliceCookie : '';
    const r = await fetch(`${base}/api/events?ch=${encodeURIComponent(ch)}`, { headers: cookie ? { Cookie: cookie } : {}, signal: ac.signal });
    await new Promise((res) => setTimeout(res, 50));
    const chans = [...hub.channels.keys()];
    ac.abort();
    await new Promise((res) => setTimeout(res, 50));
    return { status: r.status, chans };
  };
  const aliceCookie = `dsqq_sid=${(await import('../server/auth.js')).createSession(db, aliceId)}`;
  const r = await sub(alice, `admin,evil${'x'.repeat(100)},match:m_ok,../../etc,lobby`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.chans.sort(), ['lobby', 'match:m_ok']);
  assert.equal(hub.channels.size, 0, '断开后频道表清空');
});

test('同时开着的对局有上限（庄家不限）', async () => {
  const ids = [];
  const body = { game: 'connect4', seats: { r: random.id, b: random.id }, options: { delayMs: 10000 } };
  for (let i = 0; i < MAX_LIVE_PER_USER; i++) {
    const r = await alice.post('/api/matches', body);
    assert.equal(r.status, 200);
    ids.push(r.json.id);
  }
  const over = await alice.post('/api/matches', body);
  assert.equal(over.status, 429);
  assert.match(over.json.error, /同时开着/);
  const room = (await alice.post('/api/rooms', { game: 'connect4', delayMs: 10000 })).json;
  // 房主拉系统选手补位后开局，同样受限
  await alice.post(`/api/rooms/${room.id}/seat`, { seat: 'r', characterId: random.id });
  await alice.post(`/api/rooms/${room.id}/seat`, { seat: 'b', characterId: random.id });
  assert.equal((await alice.post(`/api/rooms/${room.id}/start`)).status, 429);
  const adm = await admin.post('/api/matches', body);
  assert.equal(adm.status, 200);
  for (const id of [...ids, adm.json.id]) await stop(id);
  assert.equal((await alice.post(`/api/rooms/${room.id}/start`)).status, 200, '有几盘结束后又能开');
  await stop(db.get('SELECT match_id FROM rooms WHERE id = ?', room.id).match_id);
});

// ---------- 登录、错误信息 ----------

test('登录：不存在的用户名和密码错一样回 401；意外错误不把内部细节回给浏览器', async () => {
  assert.equal((await guest.post('/api/auth/login', { username: 'nobody_here', password: 'whatever-123' })).status, 401);
  assert.equal((await guest.post('/api/auth/login', { username: 'x'.repeat(500), password: 'whatever-123' })).status, 401);
  assert.equal((await guest.post('/api/auth/login', { username: 'alice', password: 'x'.repeat(5000) })).status, 401);
  assert.equal((await guest.post('/api/auth/login', { username: 'alice', password: 'alice-pass-1' })).status, 200);
  const r2 = new Router();
  r2.get('/api/boom', () => { throw new Error('SQLITE_ERROR: no such table: secret_table at C:\\data\\arena.db'); }, { auth: 'any' });
  r2.get('/api/known', () => { const e = new Error('未知游戏：x'); e.status = 400; throw e; }, { auth: 'any' });
  const s2 = createServer(handler(r2, []));
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const origErr = console.error;
  console.error = () => {};
  try {
    const b = await fetch(`http://127.0.0.1:${s2.address().port}/api/boom`);
    assert.equal(b.status, 500);
    assert.equal((await b.json()).error, '服务器错误');
    const k = await fetch(`http://127.0.0.1:${s2.address().port}/api/known`);
    assert.equal((await k.json()).error, '未知游戏：x');
  } finally {
    console.error = origErr;
    s2.close();
  }
});

// ---------- agent 接口的上限 ----------

test('agent：一个回合里推送的思考有总量上限，自报用量封顶', async () => {
  const { c, token } = newAgent('话痨 agent');
  const id = arena.createMatch({ game: 'connect4', seats: { r: c.id, b: random.id }, mode: 'casual', options: { delayMs: 0 } });
  const turn = (await agentCall(token, '/api/agent/turn?wait=10')).json.turn;
  for (let i = 0; i < 8; i++) await agentCall(token, '/api/agent/think', { turn_id: turn.id, text: 'x'.repeat(4000) });
  const p = arena.live.get(id).partials.r;
  assert.ok(p.reasoning.length <= 20000, `思考合计 ${p.reasoning.length} 字`);
  await agentCall(token, '/api/agent/move', { turn_id: turn.id, action: turn.legal_actions[0].id, usage: { input: 1e300, output: -5 } });
  await until(() => db.get('SELECT usage FROM turns WHERE match_id = ? AND ply = 1', id));
  const u = db.get('SELECT usage FROM turns WHERE match_id = ? AND ply = 1', id).usage;
  assert.ok(u.input <= 1e7 && u.output === 0);
  await stop(id);
});

// ---------- 夜间行动的用时 ----------

test('有真人的狼人杀：内置 AI 的夜间行动也至少停一会儿，和代答步从用时上分不出来', async () => {
  const { AUTO_DELAY_MS } = await import('../server/arena.js');
  const keep = [...AUTO_DELAY_MS];
  AUTO_DELAY_MS[0] = 300; AUTO_DELAY_MS[1] = 400;
  try {
    const ww = getGame('werewolf');
    let seed = 1;
    while (ww.create({ players: 6, seed }).roles.p1 !== 'villager') seed++;
    const seats = { p1: me.id, p2: builtin.id, p3: builtin.id, p4: builtin.id, p5: builtin.id, p6: builtin.id };
    const id = arena.createMatch({ game: 'werewolf', seats, mode: 'casual', options: { delayMs: 0, seed } });
    await until(() => arena.live.get(id)?.humans?.p1, 20000); // 第一夜过完，轮到真人
    const night = db.all('SELECT ply, seat, latency_ms FROM turns WHERE match_id = ? ORDER BY ply', id).filter((t) => t.seat !== 'p1');
    assert.ok(night.length >= 4, '两只狼、预言家、女巫各一步');
    for (const t of night.slice(0, 4)) assert.ok(t.latency_ms >= 290, `第 ${t.ply} 步只用了 ${t.latency_ms} 毫秒`);
    await stop(id);
  } finally {
    AUTO_DELAY_MS[0] = keep[0]; AUTO_DELAY_MS[1] = keep[1];
  }
});

test('账号被停用后，名下 agent 的令牌不能用，蛐蛐也不再自动约战', async () => {
  const bob = client();
  await bob.post('/api/auth/register', { username: 'bob_r3', password: 'bob-pass-12' });
  const bobId = db.get("SELECT id FROM users WHERE username = 'bob_r3'").id;
  await admin.post(`/api/admin/users/${bobId}/approve`);
  await bob.post('/api/auth/login', { username: 'bob_r3', password: 'bob-pass-12' });
  const made = (await bob.post('/api/characters', { kind: 'agent', name: '鲍勃的 agent', auto_match: true })).json;
  assert.equal((await agentCall(made.agentToken, '/api/agent/me')).status, 200);
  const mock = (await bob.post('/api/characters', { kind: 'model', name: '鲍勃的模型', provider: 'mock', model: 'mock', auto_match: true })).json;
  assert.ok(matchmaker.eligible().some((c) => c.id === mock.id));
  await admin.post(`/api/admin/users/${bobId}/disable`);
  assert.equal((await agentCall(made.agentToken, '/api/agent/me')).status, 401);
  assert.ok(!matchmaker.eligible().some((c) => c.owner_id === bobId));
  await admin.post(`/api/admin/users/${bobId}/enable`);
  assert.equal((await agentCall(made.agentToken, '/api/agent/me')).status, 200);
});
