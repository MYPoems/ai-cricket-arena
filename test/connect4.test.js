import test from 'node:test';
import assert from 'node:assert/strict';
import connect4 from '../games/connect4/index.js';
import { replay } from '../games/index.js';

const play = (cols) => replay(connect4, { players: 2, actions: String(cols).split('') });
const ids = (s, seat = s.side) => connect4.actions(s, seat).map((a) => a.id);
// 随机对局里找到的一盘和棋（42 手下满，没有人连四）
const DRAW = '324325534124675744724771125556373111326666';

test('座位、落子位置与轮次', () => {
  assert.deepEqual(connect4.seats(2), ['r', 'b']);
  assert.equal(connect4.seatName('r'), '红方');
  const s0 = connect4.create({ players: 2, seed: 3 });
  assert.deepEqual(connect4.create({ seed: 1 }), s0, '开局与种子无关');
  assert.deepEqual(connect4.pending(s0), ['r']);
  assert.deepEqual(ids(s0), ['1', '2', '3', '4', '5', '6', '7']);
  const s = connect4.apply(connect4.apply(s0, 'r', '4'), 'b', 4);
  assert.equal(s0.board[3], null, '不修改原 state');
  assert.equal(s.board[3], 'r', '第 4 列最底');
  assert.equal(s.board[7 + 3], 'b', '叠在上面');
  assert.deepEqual(s.moves, [{ col: 4, row: 1, side: 'r' }, { col: 4, row: 2, side: 'b' }]);
  assert.throws(() => connect4.apply(s, 'b', '3'), /不是黑方/);
  assert.throws(() => connect4.apply(s, 'r', '8'), /无法识别/);
  assert.throws(() => connect4.apply(s, 'r', '0'), /无法识别/);
  const full = play('444444');
  assert.throws(() => connect4.apply(full, 'r', '4'), /第 4 列已经满了/);
  assert.deepEqual(ids(full), ['1', '2', '3', '5', '6', '7']);
  assert.equal(connect4.label(s, 'r', '5'), '5');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(full)));
});

test('横、竖、两条斜线连成四子获胜', () => {
  const h = play('1122334');
  assert.deepEqual(connect4.outcome(h), { over: true, winner: 'r', ranks: { r: 1, b: 2 }, reason: '红方连成四子' });
  assert.deepEqual(h.winLine, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(connect4.pending(h), []);
  assert.throws(() => connect4.apply(h, 'b', '5'), /已经结束/);
  assert.equal(connect4.evalSpec(h), null);

  const v = play('1212121');
  assert.equal(connect4.outcome(v).winner, 'r');
  assert.deepEqual(v.winLine, [[0, 0], [0, 1], [0, 2], [0, 3]]);

  const d1 = play('12234334744');
  assert.equal(connect4.outcome(d1).winner, 'r');
  assert.deepEqual(d1.winLine, [[0, 0], [1, 1], [2, 2], [3, 3]]);

  const d2 = play('76654554144');
  assert.equal(connect4.outcome(d2).winner, 'r');
  assert.deepEqual(d2.winLine.map(([c, r]) => `${c},${r}`).sort(), ['3,3', '4,2', '5,1', '6,0']);

  // 黑方赢
  const b = play('5121212');
  assert.equal(connect4.outcome(b).over, false);
  const bw = connect4.apply(b, 'b', '1');
  assert.deepEqual(connect4.outcome(bw).ranks, { b: 1, r: 2 });
});

test('下满平局', () => {
  const s = play(DRAW);
  assert.equal(s.moves.length, 42);
  assert.deepEqual(connect4.outcome(s), { over: true, winner: null, ranks: { r: 1, b: 1 }, reason: '棋盘下满，平局' });
  assert.deepEqual(connect4.pending(s), []);
  assert.equal(connect4.evalSpec(s), null);
  assert.equal(connect4.outcome(play(DRAW.slice(0, 41))).over, false);
  assert.deepEqual(connect4.forfeit(s, 'r', '红方认输'), { over: true, winner: 'b', ranks: { b: 1, r: 2 }, reason: '红方认输' });
});

test('提示词：列号在上方的文字棋盘', () => {
  const s = play('44');
  const p = connect4.turnPrompt(s, 'r', { showLegal: true });
  assert.match(p, / 1 2 3 4 5 6 7\n/);
  assert.match(p, / \. \. \. O \. \. \.\n \. \. \. X \. \. \./);
  assert.match(p, /对方上一手：第 4 列/);
  assert.match(p, /还能下的列：1 2 3 4 5 6 7/);
  assert.doesNotMatch(connect4.turnPrompt(s, 'r'), /还能下的列/);
  const sys = connect4.systemPrompt('b', { style: '激进' });
  assert.match(sys, /执黑方（O，后手）/);
  assert.match(sys, /落子：列号，例如 4/);
  assert.match(sys, /激进/);
});

test('解析模型回答', () => {
  const s = play('444444');
  assert.deepEqual(connect4.parseReply(s, 'r', '判断：均势\n威胁：无\n理由：占中\n胜率：55%\n落子：3'), { action: '3', attempted: '3', winrate: 55, error: null });
  assert.equal(connect4.parseReply(s, 'r', '落子：第5列').action, '5');
  assert.equal(connect4.parseReply(s, 'r', '落子: 第 2 列').action, '2');
  assert.equal(connect4.parseReply(s, 'r', '落子：６').action, '6', '全角');
  assert.equal(connect4.parseReply(s, 'r', '落子：七').action, '7', '中文数字');
  assert.equal(connect4.parseReply(s, 'r', '我决定下第三列').action, '3');
  assert.equal(connect4.parseReply(s, 'r', '还是 1列 吧').action, '1');
  assert.match(connect4.parseReply(s, 'r', '落子：8').error, /只能是 1–7/);
  const full = connect4.parseReply(s, 'r', '落子：4');
  assert.equal(full.attempted, '4');
  assert.match(full.error, /第 4 列已经满了.*1 2 3 5 6 7/);
  assert.match(connect4.parseReply(s, 'r', '再想想').error, /没有找到/);
  for (const a of ids(s)) assert.equal(connect4.parseReply(s, 'r', connect4.mockReply(s, 'r', a)).action, a);
});

test('内置 AI：抓住一步胜，挡住对方的一步胜', () => {
  const win = play('112233'); // 红方底行 1 2 3，第 4 列连四
  for (const level of [1, 2, 3, 4]) assert.equal(connect4.builtinMove(win, 'r', { level }), '4', `level ${level}`);
  const block = play('171727'); // 黑方第 7 列已有三子，红方必须挡
  for (const level of [1, 2, 3, 4]) assert.equal(connect4.builtinMove(block, 'r', { level }), '7', `level ${level}`);
  // 有赢就先赢，不去挡
  const both = play('1727273');
  assert.equal(connect4.outcome(both).over, false);
  assert.equal(connect4.builtinMove(both, 'b', { level: 2 }), '7');
  for (let k = 0; k < 10; k++) assert.ok(ids(win).includes(connect4.builtinMove(win, 'r', { random: true })));
});

test('局面评估：确定的胜 / 和 / 负，以及限时的启发式', async () => {
  const start = connect4.create();
  const spec = connect4.evalSpec(start);
  assert.equal(spec.engine, 'local');
  assert.equal(spec.persp, 'r');
  let t = Date.now();
  const r0 = await spec.evaluate();
  assert.ok(Date.now() - t < 300, '300 毫秒内返回');
  assert.ok(r0.e > 0.3 && r0.e < 0.8, `开局 e=${r0.e}`);
  assert.equal(r0.best, '4');

  const win = await connect4.evalSpec(play('112233')).evaluate();
  assert.deepEqual([win.e, win.best, win.source], [1, '4', 'solver']);

  // 红方底行 2 3 4 两头都空，黑方挡不住：黑方视角必败
  const lost = connect4.evalSpec(play('22334'));
  assert.equal(lost.persp, 'b');
  const rl = await lost.evaluate();
  assert.equal(rl.e, 0);
  assert.ok(['1', '5'].includes(rl.best));

  // 只剩最后一格：和棋
  const last = await connect4.evalSpec(play(DRAW.slice(0, 41))).evaluate();
  assert.deepEqual([last.e, last.best], [0.5, DRAW[41]]);

  // 残局能算到底：结果必须是确定的 0 / 0.5 / 1
  const late = connect4.evalSpec(play(DRAW.slice(0, 30)));
  t = Date.now();
  const rlate = await late.evaluate();
  assert.ok(Date.now() - t < 300);
  assert.equal(rlate.source, 'solver');
  assert.ok([0, 0.5, 1].includes(rlate.e));
  assert.ok(ids(play(DRAW.slice(0, 30))).includes(rlate.best));
});

test('观众视角与着法列表', () => {
  const s = play('4433');
  const v = connect4.view(s, null);
  assert.deepEqual(v.lastMove, { col: 2, row: 1 });
  assert.deepEqual(v.moves.map((m) => m.label), ['4', '4', '3', '3']);
  assert.deepEqual(connect4.view(s, 'r'), v, '没有隐藏信息');
  assert.equal(v.winLine, null);
});
