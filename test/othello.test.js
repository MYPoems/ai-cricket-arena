import test from 'node:test';
import assert from 'node:assert/strict';
import othello from '../games/othello/index.js';
import { replay } from '../games/index.js';
import { counts } from '../games/othello/rules.js';

const play = (moves, setup) => replay(othello, { players: 2, setup, actions: moves });
const ids = (s, seat = s.side) => othello.actions(s, seat).map((a) => a.id);

// 随机对局里找到的局面（黑白都是从标准开局下出来的）
const PASS_SEQ = ['c4', 'e3', 'f6', 'b4', 'c3', 'c5', 'b5', 'a6', 'a5', 'b2', 'b3', 'a4', 'a3', 'c2', 'f4', 'g5', 'a2', 'g7', 'f5', 'a1', 'g4', 'd6', 'c1', 'd2', 'g6', 'h4', 'e6', 'h6', 'd3', 'e2', 'h7', 'h8', 'g8', 'f8', 'b1', 'd1', 'h5'];
const WIPE_SEQ = ['f5', 'f4', 'e3', 'f2', 'g3', 'f6', 'd3', 'g5', 'd6', 'e6', 'g1', 'f3', 'f7', 'g6', 'h5'];

test('座位、开局与先手的合法落点', () => {
  assert.deepEqual(othello.seats(2), ['b', 'w']);
  assert.equal(othello.seatName('b'), '黑方');
  const s = othello.create({ players: 2, seed: 1 });
  assert.equal(s.board[3 * 8 + 3], 'w', 'd4 白');
  assert.equal(s.board[3 * 8 + 4], 'b', 'e4 黑');
  assert.equal(s.board[4 * 8 + 3], 'b', 'd5 黑');
  assert.equal(s.board[4 * 8 + 4], 'w', 'e5 白');
  assert.deepEqual(othello.pending(s), ['b']);
  assert.deepEqual(ids(s).sort(), ['c4', 'd3', 'e6', 'f5']);
  assert.deepEqual(othello.actions(s, 'w'), []);
  assert.deepEqual(othello.create({ seed: 1 }), othello.create({ seed: 99 }), '开局与种子无关、可重现');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
});

test('落子翻转、轮次与非法落子', () => {
  const s0 = othello.create();
  const s = othello.apply(s0, 'b', 'D3');
  assert.equal(s0.board[2 * 8 + 3], null, '不修改原 state');
  assert.equal(s.board[3 * 8 + 3], 'b', 'd4 被翻成黑');
  assert.deepEqual(s.moves[0], { label: 'd3', side: 'b', flips: ['d4'] });
  assert.deepEqual(counts(s.board), { b: 4, w: 1, empty: 59 });
  assert.deepEqual(othello.pending(s), ['w']);
  assert.throws(() => othello.apply(s, 'b', 'c5'), /不是黑方/);
  assert.throws(() => othello.apply(s, 'w', 'd3'), /已经有子/);
  assert.throws(() => othello.apply(s, 'w', 'a1'), /必须夹住/);
  assert.throws(() => othello.apply(s, 'w', 'i9'), /无法识别/);
  // 一手同时翻多个方向
  const multi = othello.create({ setup: { board: `
    ........
    ........
    ....X.X.
    ....OO..
    ..XO....
    ....O...
    ....X...
    ........` } });
  const m = othello.apply(multi, 'b', 'e4');
  assert.deepEqual([...m.moves[0].flips].sort(), ['d4', 'e3', 'e5', 'f5'], '四个方向同时翻转');
  assert.equal(counts(m.board).w, 0);
  assert.equal(m.over, true, '白子被吃光即终局');
  assert.equal(othello.label(s, 'w', 'C5'), 'c5');
});

test('一方无处可下时自动跳过，由对方连走', () => {
  const before = play(PASS_SEQ.slice(0, -1));
  assert.equal(before.side, 'b');
  const s = othello.apply(before, 'b', 'h5');
  assert.deepEqual(s.passes, [{ seat: 'w', ply: 37 }]);
  assert.equal(s.side, 'b', '白方被跳过，仍是黑方走');
  assert.deepEqual(othello.pending(s), ['b']);
  assert.deepEqual(othello.actions(s, 'w'), []);
  assert.equal(othello.view(s, null).pass, 'w');
  assert.match(othello.turnPrompt(s, 'b'), /白方）无处可下，跳过一手/);
  // 回放得到同一局面
  assert.deepEqual(play(PASS_SEQ), s);
  // 开局就无子可下的一方直接被跳过
  const st = othello.create({ setup: { side: 'w', board: `
    XO......
    ........
    ........
    ........
    ........
    ........
    ........
    ........` } });
  assert.equal(st.side, 'b');
  assert.deepEqual(st.passes, [{ seat: 'w', ply: 0 }]);
});

test('终局：吃光、双方都无子可下、下满与平局', () => {
  const wipe = othello.apply(othello.apply(play(WIPE_SEQ), 'w', 'c6'), 'b', 'b7');
  assert.equal(wipe.over, true);
  assert.deepEqual(othello.pending(wipe), []);
  const out = othello.outcome(wipe);
  assert.equal(out.winner, 'b');
  assert.deepEqual(out.ranks, { b: 1, w: 2 });
  assert.match(out.reason, /白方的棋子被全部吃光/);
  assert.throws(() => othello.apply(wipe, 'w', 'a1'), /已经结束/);
  assert.equal(othello.evalSpec(wipe), null);

  const stuck = othello.create({ setup: { board: `
    X.......
    ........
    ........
    ........
    ........
    ........
    ........
    .......O` } });
  assert.equal(stuck.over, true);
  const o2 = othello.outcome(stuck);
  assert.deepEqual(o2.ranks, { b: 1, w: 1 }, '子数相同名次相同');
  assert.equal(o2.winner, null);
  assert.match(o2.reason, /双方都无子可下.*平局/);

  const full = othello.create({ setup: { board: 'XXXXXXXX'.repeat(5) + 'OOOOOOOO'.repeat(3) } });
  const o3 = othello.outcome(full);
  assert.equal(o3.winner, 'b');
  assert.match(o3.reason, /棋盘下满，黑方 40 子，白方 24 子/);
  assert.deepEqual(othello.forfeit(full, 'b', '黑方认输'), { over: true, winner: 'w', ranks: { w: 1, b: 2 }, reason: '黑方认输' });
});

test('提示词：文字棋盘、可落子标记与子数', () => {
  const s = othello.create();
  const p = othello.turnPrompt(s, 'b', { showLegal: true });
  assert.match(p, /5 {2}\. \. \. X O \* \. \./);
  assert.match(p, /你可以落子的位置：c4 d3 e6 f5|你可以落子的位置：d3 c4 f5 e6/);
  assert.match(p, /子数：黑 X 2，白 O 2，空位 60/);
  assert.doesNotMatch(othello.turnPrompt(s, 'b'), /\*/);
  const sys = othello.systemPrompt('w', { style: '稳健' });
  assert.match(sys, /执白方（O，后手）/);
  assert.match(sys, /落子：坐标，例如 d3/);
  assert.match(sys, /稳健/);
});

test('解析模型回答', () => {
  const s = othello.create();
  assert.deepEqual(othello.parseReply(s, 'b', '判断：均势\n威胁：无\n理由：开局\n胜率：50%\n落子：D3'), { action: 'd3', attempted: 'd3', winrate: 50, error: null });
  assert.equal(othello.parseReply(s, 'b', '胜率：４５％\n落子：ｆ５').action, 'f5', '全角');
  assert.equal(othello.parseReply(s, 'b', '落子:c 4').action, 'c4');
  assert.equal(othello.parseReply(s, 'b', '落子：e六').action, 'e6', '中文数字');
  assert.equal(othello.parseReply(s, 'b', '我想下 f5 这个点').action, 'f5', '没有落子行时取最后一个坐标');
  assert.equal(othello.parseReply(s, 'b', '胜率：45%').winrate, 45);
  assert.match(othello.parseReply(s, 'b', '落子：d4').error, /已经有子/);
  const bad = othello.parseReply(s, 'b', '落子：a1');
  assert.equal(bad.attempted, 'a1');
  assert.match(bad.error, /必须夹住.*c4/);
  assert.match(othello.parseReply(s, 'b', '想想再说').error, /没有找到/);
  // mockReply 写出的回答能被解析回同一步
  for (const a of ids(s)) assert.equal(othello.parseReply(s, 'b', othello.mockReply(s, 'b', a)).action, a);
});

test('内置 AI：抓住一步胜（吃光对方），挡住对方的一步胜', () => {
  // 黑方 b7 能把白子全部翻光（另有 c4 c5 b6 可下）
  const win = othello.apply(play(WIPE_SEQ), 'w', 'c6');
  assert.deepEqual(ids(win).sort(), ['b6', 'b7', 'c4', 'c5']);
  for (const level of [1, 2, 3, 4]) assert.equal(othello.builtinMove(win, 'b', { level }), 'b7', `level ${level}`);
  // 白方 8 个落点里只有 h7 能不让黑方下一手吃光
  const block = play(WIPE_SEQ);
  assert.equal(ids(block).length, 8);
  for (const level of [2, 3, 4]) assert.equal(othello.builtinMove(block, 'w', { level }), 'h7', `level ${level}`);
  // 随机走子也是合法的
  for (let k = 0; k < 10; k++) assert.ok(ids(block).includes(othello.builtinMove(block, 'w', { random: true })));
});

test('局面评估：开局接近均势，必胜局面给出 1，限时返回', async () => {
  const s = othello.create();
  const spec = othello.evalSpec(s);
  assert.equal(spec.engine, 'local');
  assert.equal(spec.persp, 'b');
  let t = Date.now();
  const r = await spec.evaluate();
  assert.ok(Date.now() - t < 300, '300 毫秒内返回');
  assert.ok(r.e > 0.3 && r.e < 0.7, `开局 e=${r.e}`);
  assert.ok(ids(s).includes(r.best));

  const win = othello.apply(play(WIPE_SEQ), 'w', 'c6');
  const rw = await othello.evalSpec(win).evaluate();
  assert.equal(rw.e, 1);
  assert.equal(rw.best, 'b7');

  // 白方不下 h7 就会被吃光：评估从白方视角给出最佳着法 h7
  const block = play(WIPE_SEQ);
  const rb = await othello.evalSpec(block).evaluate();
  assert.equal(othello.evalSpec(block).persp, 'w');
  assert.equal(rb.best, 'h7');

  // 中盘任意局面也要限时
  const mid = play(PASS_SEQ.slice(0, 24));
  t = Date.now();
  const rm = await othello.evalSpec(mid).evaluate();
  assert.ok(Date.now() - t < 300);
  assert.ok(rm.e >= 0 && rm.e <= 1);
});

test('观众视角与着法列表', () => {
  const s = play(['d3', 'c5']);
  const v = othello.view(s, null);
  assert.equal(v.lastMove, 'c5');
  assert.deepEqual(v.flipped, ['d5']);
  assert.deepEqual(v.counts, { b: 3, w: 3 });
  assert.deepEqual(v.moves, [{ label: 'd3', side: 'b' }, { label: 'c5', side: 'w' }]);
  assert.deepEqual(othello.view(s, 'b'), v, '没有隐藏信息');
  assert.deepEqual(v.legal.sort(), ids(s).sort());
});
