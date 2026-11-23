// 上线前验收修过的问题：畸形请求、跨站写操作、密钥外发、模型回答的 Markdown、德州的说明文字。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { Router, handler } from '../server/http.js';
import { canSetBaseURL, baseURLFor, presetOf } from '../server/providers/presets.js';
import { plainReply } from '../server/arena.js';
import { parseActionText } from '../games/poker/index.js';
import { getGame } from '../games/index.js';

async function withServer(fn) {
  const router = new Router();
  router.get('/api/ping', () => ({ ok: true }));
  router.post('/api/echo', ({ body }) => body);
  const server = createServer(handler(router, []));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(server.address().port);
  } finally {
    server.close();
  }
}

function raw(port, text) {
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1', () => s.end(text));
    let out = '';
    s.on('data', (d) => { out += d; });
    s.on('end', () => resolve(out));
    s.on('error', reject);
  });
}

test('畸形请求地址回 400，服务不退出', async () => {
  await withServer(async (port) => {
    for (const path of ['//', '///', '//a:b:c/x', 'http://[/x']) {
      const res = await raw(port, `GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      assert.match(res, /^HTTP\/1\.1 400/, path);
    }
    const ok = await fetch(`http://127.0.0.1:${port}/api/ping`).then((r) => r.json());
    assert.deepEqual(ok, { ok: true });
    const bad = await fetch(`http://127.0.0.1:${port}/api/%E0%A4%A`);
    assert.ok(bad.status === 400 || bad.status === 404);
  });
});

test('写操作只接受同源 JSON：跨站表单和跨站 JSON 都被拒', async () => {
  await withServer(async (port) => {
    const url = `http://127.0.0.1:${port}/api/echo`;
    const form = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
    assert.equal(form.status, 415);
    const cross = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{"a":1}' });
    assert.equal(cross.status, 403);
    const same = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` }, body: '{"a":1}' });
    assert.deepEqual(await same.json(), { a: 1 });
    const nul = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' });
    assert.equal(nul.status, 400);
  });
});

test('有密钥的预置平台不能改地址，密钥不会被发到别处', () => {
  assert.equal(canSetBaseURL('deepseek', 'http://127.0.0.1:3298/v1'), false);
  assert.equal(baseURLFor('deepseek', 'http://127.0.0.1:3298/v1'), presetOf('deepseek').baseURL);
  assert.equal(baseURLFor('openai', 'https://evil.example/v1'), presetOf('openai').baseURL);
  assert.equal(canSetBaseURL('qwen', 'https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'), true);
  assert.equal(canSetBaseURL('qwen', 'https://aliyuncs.com.evil.example/v1'), false);
  assert.equal(canSetBaseURL('custom', 'http://10.0.0.2/v1'), true);
  assert.equal(presetOf('__proto__'), null);
  assert.equal(presetOf('constructor'), null);
  assert.throws(() => getGame('__proto__'), (e) => e.status === 400);
});

test('模型回答去掉 Markdown 再解析', () => {
  assert.equal(plainReply('**出牌**：`3 3`\n1. 行动：合作\n- 胜率：40%\n3 3'), '出牌：3 3\n行动：合作\n胜率：40%\n3 3');
  const ddz = getGame('doudizhu');
  const st = ddz.create({ players: 3, seed: 7 });
  const seat = ddz.pending(st)[0];
  assert.equal(ddz.parseReply(st, seat, plainReply('判断：牌一般\n**叫分**：`叫1`')).action, '叫1');
});

test('德州：括号说明和否定词不影响行动判断', () => {
  assert.equal(parseActionText('弃牌（对手全下，赔率不够）').kind, 'fold');
  assert.equal(parseActionText('跟注（对手全下）').kind, 'call');
  assert.equal(parseActionText('不加注，跟注').kind, 'call');
  assert.equal(parseActionText('全下').kind, 'allin');
  assert.deepEqual(parseActionText('加注到 60'), { kind: 'raise', to: 60 });
});

test('国际象棋：棋子符号和中文棋子名不会被当成兵', () => {
  const chess = getGame('chess');
  const s = chess.create({ players: 2 });
  assert.equal(chess.parseReply(s, 'w', '着法：♘f3').action, 'g1f3');
  assert.equal(chess.parseReply(s, 'w', '着法：马f3').action, 'g1f3');
  assert.ok(chess.parseReply(s, 'w', '着法：♘e5').error);
});
