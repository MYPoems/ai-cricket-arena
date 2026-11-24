// 自带 agent 选手：领回合、提交、重试、离线判负、令牌鉴权、单独的 Agent 天梯、MCP。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { initSecrets } from '../server/secrets.js';
import { Hub, Router, handler } from '../server/http.js';
import { AiPool } from '../server/ai-worker.js';
import { Evaluator } from '../server/evaluator.js';
import { Arena } from '../server/arena.js';
import { Matchmaker } from '../server/ladder/matchmaker.js';
import { agentRoutes } from '../server/agent-api.js';
import { createCharacter, ensureSystemCharacters, issueAgentToken, publicCharacter } from '../server/characters.js';
import { leaderboard } from '../server/ladder/rating.js';
import { getGame } from '../games/index.js';

process.env.ARENA_DEV = '1';
const db = openDb(':memory:');
initSecrets(join(tmpdir(), `agent-test-${process.pid}.key`));
const hub = new Hub();
const aiPool = new AiPool(1);
const evaluator = new Evaluator({ enginesDir: join(tmpdir(), 'no-engines-here'), aiPool });
await evaluator.init();
const arena = new Arena({ db, hub, aiPool, evaluator });
ensureSystemCharacters(db, 'local');
const builtin = db.get("SELECT * FROM characters WHERE name = '内置 AI · 初级'");
const events = [];
hub.emit = (ch, e) => events.push({ ch, ...e });

const router = new Router();
agentRoutes(router, { db, arena });
router.get('/api/secret', () => ({ secret: true }), { auth: 'user' });
const server = createServer(handler(router, []));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); });

function agent(name, extra = {}) {
  const c = createCharacter(db, 'local', { kind: 'agent', name, auto_match: 1, ...extra });
  return { c, token: issueAgentToken(db, c.id) };
}
const call = (token, path, body) => fetch(`${base}${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

function waitEnd(id, ms = 60000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      const m = db.get('SELECT status, result, rating_changes FROM matches WHERE id = ?', id);
      if (m.status !== 'running' && !arena.live.has(id)) { clearInterval(iv); resolve(m); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('对局超时')); }
    }, 30);
  });
}

test('令牌：只存哈希；带令牌能访问 agent 接口、不用登录，但不能访问别的接口', async () => {
  const { c, token } = agent('令牌测试');
  assert.match(token, /^pka_/);
  const row = db.get('SELECT agent_token FROM characters WHERE id = ?', c.id);
  assert.notEqual(row.agent_token, token);
  assert.equal(publicCharacter(db, row.agent_token ? db.get('SELECT * FROM characters WHERE id = ?', c.id) : c).agent_token, undefined);
  const me = await call(token, '/api/agent/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.name, '令牌测试');
  assert.equal((await call(token, '/api/secret')).status, 401, '令牌不能绕过密码访问其他接口');
  assert.equal((await call('pka_wrongwrongwrongwrongwrong', '/api/agent/me')).status, 401);
  // 重新生成后旧令牌失效
  const fresh = issueAgentToken(db, c.id);
  assert.equal((await call(token, '/api/agent/me')).status, 401);
  assert.equal((await call(fresh, '/api/agent/me')).status, 200);
  // 来过之后算在线
  assert.equal(publicCharacter(db, db.get('SELECT * FROM characters WHERE id = ?', c.id)).online, true);
});

test('完整对局：agent 领回合、推送思考、提交（文字和 action 两种）、无效重试，四子棋下到结束', async () => {
  const { c, token } = agent('四子棋 agent');
  const id = arena.createMatch({ game: 'connect4', seats: { r: c.id, b: builtin.id }, mode: 'casual', options: { delayMs: 0 } });
  let turns = 0, retried = false;
  for (;;) {
    const r = await call(token, '/api/agent/turn?wait=5');
    if (!r.json.turn) {
      if (db.get('SELECT status FROM matches WHERE id = ?', id).status !== 'running') break;
      continue;
    }
    const t = r.json.turn;
    assert.equal(t.match_id, id);
    assert.ok(t.system.length > 20 && t.prompt.length > 10);
    assert.ok(Array.isArray(t.legal_actions) && t.legal_actions.length);
    assert.ok(t.seconds_left > 0);
    await call(token, '/api/agent/think', { turn_id: t.id, text: `第 ${turns + 1} 步：先占中路。` });
    if (!retried) {
      retried = true;
      const bad = await call(token, '/api/agent/move', { turn_id: t.id, reply: '落子：第 99 列' });
      assert.equal(bad.json.ok, false);
      assert.ok(bad.json.error && bad.json.retries_left === 3);
      continue; // 下一次领到的是重试回合，带着原因
    }
    if (t.attempt === 1) assert.ok(t.retry, '重试回合要带上次无效的原因');
    const act = t.legal_actions[0].id;
    const ok = turns % 2
      ? await call(token, '/api/agent/move', { turn_id: t.id, action: act, model: 'test-model', usage: { input: 100, output: 20 } })
      : await call(token, '/api/agent/move', { turn_id: t.id, reply: `判断：试试\n落子：${act}`, model: 'test-model' });
    assert.equal(ok.json.ok, true, JSON.stringify(ok.json));
    turns++;
  }
  const m = await waitEnd(id);
  assert.equal(m.status, 'finished');
  const rows = db.all('SELECT * FROM turns WHERE match_id = ? AND character_id = ? ORDER BY ply', id, c.id);
  assert.equal(rows.length, turns);
  assert.ok(rows[0].reasoning.includes('先占中路'), '思考要存下来');
  assert.equal(rows[0].attempts.length, 1, '第一步有一次无效');
  assert.match(rows[0].model_served, /自报：test-model/);
  assert.ok(events.some((e) => e.type === 'delta' && e.kind === 'reasoning' && e.text.includes('先占中路')));
});

test('离线：限时内没来领回合判负；领了不交按无效处理', async () => {
  const { c } = agent('掉线的 agent');
  db.update('characters', { id: c.id }, { agent_timeout: 1 }); // 测试用 1 秒
  const id = arena.createMatch({ game: 'connect4', seats: { r: c.id, b: builtin.id }, mode: 'casual', options: { delayMs: 0 } });
  const m = await waitEnd(id, 15000);
  assert.equal(m.result.winner, 'b');
  assert.match(m.result.reason, /没有来领回合/);
});

test('单独的 Agent 天梯：agent 排位记在 agent:游戏；不能和模型选手同场排位', async () => {
  const { c, token } = agent('排位 agent');
  const model = createCharacter(db, 'local', { kind: 'model', provider: 'mock', model: 'mock', name: '模拟模型' });
  assert.throws(() => arena.createMatch({ game: 'connect4', seats: { r: c.id, b: model.id }, mode: 'ranked' }), /Agent 天梯/);
  const id = arena.createMatch({ game: 'connect4', seats: { r: c.id, b: builtin.id }, mode: 'ranked', options: { delayMs: 0 } });
  for (;;) {
    const r = await call(token, '/api/agent/turn?wait=3');
    if (!r.json.turn) { if (db.get('SELECT status FROM matches WHERE id = ?', id).status !== 'running') break; continue; }
    await call(token, '/api/agent/move', { turn_id: r.json.turn.id, action: r.json.turn.legal_actions[0].id });
  }
  const m = await waitEnd(id);
  assert.ok(m.rating_changes[c.id]);
  assert.ok(leaderboard(db, 'agent:connect4').some((r) => r.character_id === c.id));
  assert.ok(!leaderboard(db, 'connect4').some((r) => r.character_id === c.id), '不进模型天梯');
});

test('自动匹配：只匹配在线的 agent，只和 agent 配对，系统选手不参加', async () => {
  const mm = new Matchmaker(arena);
  db.run("UPDATE characters SET auto_match = 0 WHERE kind != 'agent' AND system = 0");
  db.run("UPDATE characters SET auto_match = 0 WHERE kind = 'agent'");
  const { c } = agent('在线 agent');
  const { c: c2 } = agent('另一个在线 agent');
  db.update('characters', { id: c.id }, { last_seen: null });
  db.update('characters', { id: c2.id }, { last_seen: new Date().toISOString(), agent_timeout: 1 });
  assert.ok(!mm.eligible().some((x) => x.id === c.id), '离线不参加匹配');
  assert.ok(!mm.eligible().some((x) => x.system), '系统选手不参加自动匹配');
  assert.equal(await mm.tick({ force: true }), null, '只有一个在线 agent、系统选手又不补位：配不成');
  db.update('characters', { id: c.id }, { last_seen: new Date().toISOString(), agent_timeout: 1 }); // 1 秒不来领就判负，让排位赛自己结束
  assert.ok(mm.eligible().some((x) => x.id === c.id));
  const id = await mm.tick({ force: true });
  assert.ok(id);
  const seats = db.get('SELECT seats FROM matches WHERE id = ?', id).seats;
  const kinds = Object.values(seats).map((cid) => db.get('SELECT kind, system FROM characters WHERE id = ?', cid));
  assert.ok(kinds.every((k) => k.kind === 'agent' && !k.system), JSON.stringify(kinds));
  const m = await waitEnd(id, 20000);
  assert.match(m.result.reason, /没有来领回合/);
  db.update('characters', { id: c.id }, { auto_match: 0 });
  db.update('characters', { id: c2.id }, { auto_match: 0 });
});

test('MCP：initialize、tools/list、wait_for_turn、submit_move', async () => {
  const { c, token } = agent('MCP agent');
  const rpc = (method, params, id = 1) => call(token, '/api/agent/mcp', { jsonrpc: '2.0', id, method, params }).then((r) => r.json);
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, '电子斗蛐蛐');
  const tools = (await rpc('tools/list', {})).result.tools.map((t) => t.name);
  assert.deepEqual(tools, ['wait_for_turn', 'think', 'submit_move', 'get_status']);
  const note = await call(token, '/api/agent/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note.status, 202);
  const id = arena.createMatch({ game: 'connect4', seats: { r: c.id, b: builtin.id }, mode: 'casual', options: { delayMs: 0 } });
  const w = await rpc('tools/call', { name: 'wait_for_turn', arguments: { wait_seconds: 5 } });
  const t = JSON.parse(w.result.content[0].text);
  assert.equal(t.match_id, id);
  const s = await rpc('tools/call', { name: 'submit_move', arguments: { turn_id: t.id, reply: `落子：${t.legal_actions[0].id}` } });
  assert.equal(JSON.parse(s.result.content[0].text).ok, true);
  const bad = await rpc('tools/call', { name: 'submit_move', arguments: { turn_id: 'nope', reply: 'x' } });
  assert.equal(bad.result.isError, true);
  arena.control(id, 'abort');
  await waitEnd(id).catch(() => {});
});

test('隐藏信息：agent 拿到的提示词和模型一样只有本座位的信息', async () => {
  const { c, token } = agent('卧底 agent');
  const seats = { p1: c.id, p2: builtin.id, p3: builtin.id, p4: builtin.id };
  const id = arena.createMatch({ game: 'undercover', seats, mode: 'casual', options: { delayMs: 0, seed: 5 } });
  const r = await call(token, '/api/agent/turn?wait=10');
  const st = getGame('undercover').create({ players: 4, seed: 5 });
  const mine = st.words.p1;
  const other = Object.values(st.words).find((w) => w !== mine);
  assert.ok(r.json.turn.system.includes(mine) || r.json.turn.prompt.includes(mine));
  assert.ok(!r.json.turn.system.includes(other) && !r.json.turn.prompt.includes(other), '不能看到别人的词');
  arena.control(id, 'abort');
  await waitEnd(id).catch(() => {});
});
