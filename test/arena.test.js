// 端到端测试：用模拟模型跑完整对局、犯规判负、排位结算、自动匹配和同题对比。

import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { initSecrets, setKey, getKey, keyStatus } from '../server/secrets.js';
import { Hub } from '../server/http.js';
import { AiPool } from '../server/ai-worker.js';
import { Evaluator } from '../server/evaluator.js';
import { Arena } from '../server/arena.js';
import { Matchmaker } from '../server/ladder/matchmaker.js';
import { Compare } from '../server/compare.js';
import { createCharacter, ensureSystemCharacters, updateCharacter } from '../server/characters.js';
import { tierOf, leaderboard } from '../server/ladder/rating.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ARENA_DEV = '1';

const db = openDb(':memory:');
initSecrets(join(tmpdir(), `arena-test-${process.pid}.key`));
const hub = new Hub();
const aiPool = new AiPool(2);
const evaluator = new Evaluator({ enginesDir: join(tmpdir(), 'no-engines-here'), aiPool });
await evaluator.init();
const arena = new Arena({ db, hub, aiPool, evaluator });
ensureSystemCharacters(db, 'local');

const events = [];
hub.emit = (ch, e) => events.push({ ch, ...e });

function waitEnd(id, ms = 120000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      const m = db.get('SELECT status, result FROM matches WHERE id = ?', id);
      if (m.status !== 'running' && !arena.live.has(id)) { clearInterval(iv); resolve(m); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('对局超时')); }
    }, 50);
  });
}

const mock = (name, extra = {}) => createCharacter(db, 'local', { kind: 'model', provider: 'mock', model: 'mock', name, auto_match: 1, ...extra });
const builtin = db.get("SELECT * FROM characters WHERE name = '内置 AI · 初级'");

test('密钥加密保存、不以明文落库', () => {
  setKey(db, 'local', 'deepseek', 'sk-test-123');
  assert.equal(getKey(db, 'local', 'deepseek'), 'sk-test-123');
  assert.ok(!db.get('SELECT cipher FROM api_keys').cipher.includes('sk-test'));
  assert.equal(keyStatus(db, 'local').deepseek, 'db');
  setKey(db, 'local', 'deepseek', '');
  assert.equal(keyStatus(db, 'local').deepseek, 'none');
});

test('选手配置锁定，只能改运行设置', () => {
  const c = mock('锁定测试');
  assert.throws(() => updateCharacter(db, c.id, { model: 'other' }), /派生/);
  assert.equal(updateCharacter(db, c.id, { daily_limit: 3, name: '新名字' }).daily_limit, 3);
});

test('模拟模型对内置 AI 下完一盘排位赛并结算积分', async () => {
  const a = mock('模拟甲');
  const id = arena.createMatch({ seats: { r: a.id, b: builtin.id }, mode: 'ranked', options: { delayMs: 0 } });
  const m = await waitEnd(id);
  assert.equal(m.status, 'finished', JSON.stringify(m.result));
  const full = db.get('SELECT * FROM matches WHERE id = ?', id);
  assert.equal(full.mode, 'placement');
  assert.ok(full.rating_changes[a.id] && full.rating_changes[builtin.id]);
  const turns = db.all('SELECT * FROM turns WHERE match_id = ? ORDER BY ply', id);
  assert.equal(turns.length, full.actions.length);
  const modelTurn = turns.find((t) => t.character_id === a.id);
  assert.match(modelTurn.analysis, /着法：/);
  assert.ok(modelTurn.self_winrate >= 0);
  assert.ok(turns.some((t) => t.eval?.quality), '应有着法质量评估');
  assert.ok(events.some((e) => e.ch === `match:${id}` && e.type === 'delta'), '应推送思考增量');
  // 整局对话：第二步时模型能看到第一步自己的回答
  const conv = full.conversations[Object.keys(full.seats).find((s) => full.seats[s] === a.id)];
  assert.ok(conv.messages.filter((x) => x.role === 'assistant').length >= 2);
});

test('连续给出无效着法判负', async () => {
  const bad = mock('总走错', { style: '【测试：总是走错】' });
  const id = arena.createMatch({ seats: { r: bad.id, b: builtin.id }, mode: 'casual', options: { delayMs: 0 } });
  const m = await waitEnd(id);
  assert.equal(m.status, 'finished');
  assert.equal(m.result.winner, 'b');
  assert.match(m.result.reason, /4 次给出无效着法/);
  const t = db.get('SELECT attempts FROM turns WHERE match_id = ?', id);
  assert.equal(t.attempts.length, 4);
});

test('玩家本人走棋与认输', async () => {
  const me = db.get("SELECT * FROM characters WHERE kind = 'human'");
  const id = arena.createMatch({ seats: { r: me.id, b: builtin.id }, mode: 'casual', options: { delayMs: 0 } });
  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => arena.humanMove(id, 'b0b5'), /不合法/);
  arena.humanMove(id, 'h2e2');
  await new Promise((r) => { const iv = setInterval(() => { if (arena.live.get(id)?.human) { clearInterval(iv); r(); } }, 30); });
  arena.control(id, 'resign');
  const m = await waitEnd(id);
  assert.equal(m.result.winner, 'b');
  assert.match(m.result.reason, /认输/);
});

test('自动匹配：模型自己挑对手并写宣言', async () => {
  const mm = new Matchmaker(arena);
  // 只留一个挑战者和内置 AI，让对局快速结束
  db.run("UPDATE characters SET auto_match = 0 WHERE name != '内置 AI · 初级' AND name != '内置 AI · 中级'");
  mock('挑战者');
  db.setSetting('ladder', { enabled: true, concurrency: 1 });
  const id = await mm.tick();
  assert.ok(id, JSON.stringify(mm.lastLog));
  const m = db.get('SELECT * FROM matches WHERE id = ?', id);
  assert.equal(m.challenge.text, '来一盘，看看谁算得更深。');
  await waitEnd(id);
  db.setSetting('ladder', { enabled: false });
});

test('每日对局上限生效', () => {
  const c = mock('限量');
  updateCharacter(db, c.id, { daily_limit: 1 });
  db.insert('matches', { id: 'm_fake', game: 'xiangqi', mode: 'ranked', status: 'finished', options: {}, seats: { r: c.id, b: builtin.id }, actions: [], created_at: new Date().toISOString() });
  const mm = new Matchmaker(arena);
  assert.ok(!mm.eligible().some((x) => x.id === c.id));
});

test('同题对比', async () => {
  const a = mock('对比甲');
  const cmp = new Compare(arena);
  const id = cmp.create({ fen: '4k4/1R7/9/9/9/9/9/9/9/R2K5 w - - 0 1', title: '双车一步杀', characterIds: [a.id, builtin.id] });
  for (let i = 0; i < 200; i++) {
    const d = cmp.detail(id);
    if (d.answers.every((x) => ['done', 'failed'].includes(x.status))) {
      const b = d.answers.find((x) => x.character_id === builtin.id);
      assert.equal(b.status, 'done');
      assert.ok(b.eval && typeof b.eval.loss === 'number');
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail('同题对比超时');
});

test('段位划分', () => {
  assert.equal(tierOf(1500, 2).tier, '定级中');
  assert.equal(tierOf(900, 10).label, '黑铁 III');
  assert.equal(tierOf(1100, 10).label, '黑铁 II');
  assert.equal(tierOf(1250, 10).label, '黄铜 III');
  assert.equal(tierOf(1599, 10).label, '白银 I');
  assert.equal(tierOf(2150, 10).label, '钻石 I');
  assert.equal(tierOf(2300, 10, 0).label, '王者');
  assert.equal(tierOf(2300, 10, 12).label, '大师');
  assert.ok(leaderboard(db, 'xiangqi').length >= 2);
});

test.after(() => aiPool.close());
