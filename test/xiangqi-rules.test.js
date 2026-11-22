import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../games/xiangqi/rules.js';
import { moveToChinese, chineseToMove } from '../games/xiangqi/notation.js';
import { chooseMove } from '../games/xiangqi/ai.js';
import xiangqi from '../games/xiangqi/index.js';

const movesFrom = (fen, from) =>
  R.legalMoves(R.parseFen(fen)).map(R.moveToIccs).filter((m) => !from || m.startsWith(from)).sort();

test('初始局面走法计数与公认值一致', () => {
  const p = R.parseFen(R.START_FEN);
  assert.deepEqual([1, 2, 3, 4].map((d) => R.perft(p, d)), [44, 1920, 79666, 3290240]);
  assert.equal(R.toFen(p), R.START_FEN, 'perft 后局面应完全还原');
});

test('FEN 往返不变，并拒绝错误的 FEN', () => {
  const fen = '3k5/R8/9/9/9/9/9/9/4R4/5K3 b - - 3 12';
  assert.equal(R.toFen(R.parseFen(fen)), fen);
  assert.throws(() => R.parseFen('9/9/9 w'));
  assert.throws(() => R.parseFen('3k5/9/9/9/9/9/9/9/9/3K4 w'), /9 列/);
  assert.throws(() => R.parseFen('3x5/9/9/9/9/9/9/9/9/3K5 w'), /未知棋子/);
});

test('蹩马腿', () => {
  assert.deepEqual(movesFrom('3k5/9/9/9/9/9/9/9/1P7/1N2K4 w', 'b0'), ['b0d1']);
});

test('塞象眼、象不过河', () => {
  const fen = '3k5/9/9/9/9/2B6/9/9/3P5/2B1K4 w';
  assert.deepEqual(movesFrom(fen, 'c0'), ['c0a2']);
  assert.deepEqual(movesFrom(fen, 'c4'), ['c4a2', 'c4e2']);
});

test('炮必须隔一子才能吃子', () => {
  const ms = movesFrom('3k5/9/9/9/9/9/9/C1p1p4/9/5K3 w', 'a2');
  assert.ok(ms.includes('a2e2'), '隔一子可以吃');
  assert.ok(!ms.includes('a2c2'), '没有炮架不能吃');
  assert.ok(ms.includes('a2b2') && !ms.includes('a2d2'), '炮架之后不能平移');
});

test('兵卒：未过河只能前进，过河后可横走，不能后退', () => {
  assert.deepEqual(movesFrom('3k5/9/9/9/9/9/4P4/9/9/5K3 w', 'e3'), ['e3e4']);
  assert.deepEqual(movesFrom('3k5/9/9/4P4/9/9/9/9/9/5K3 w', 'e6'), ['e6d6', 'e6e7', 'e6f6']);
  assert.deepEqual(movesFrom('4P4/5k3/9/9/9/9/9/9/9/3K5 w', 'e9'), ['e9d9', 'e9f9'], '到底线的兵只能横走');
});

test('将帅不能照面', () => {
  const fen = '4k4/9/9/9/4N4/9/9/9/9/4K4 w';
  assert.deepEqual(movesFrom(fen, 'e5'), [], '挡在中间的马不能离开');
  assert.deepEqual(movesFrom(fen, 'e0'), ['e0d0', 'e0e1', 'e0f0']);
});

test('不能走成被将军的局面', () => {
  // 红帅 e0，黑车在 d9 控制 d 列：帅不能走到 d0
  const ms = movesFrom('3rk4/9/9/9/9/9/9/9/9/4K4 w', 'e0');
  assert.ok(!ms.includes('e0d0'));
});

test('将死与困毙', () => {
  const mate = R.newGame('R3k4/1R7/9/9/9/9/9/9/9/3K5 b - - 0 1');
  assert.deepEqual(R.result(mate), { over: true, winner: 'r', reason: '将死' });
  const stale = R.newGame('3k5/R8/9/9/9/9/9/9/4R4/5K3 b - - 0 1');
  assert.deepEqual(R.result(stale), { over: true, winner: 'r', reason: '困毙' });
});

const playAll = (fen, list) => list.reduce((g, m) => R.play(g, m), R.newGame(fen));

test('单方长将判负', () => {
  const seq = ['a7a9', 'e9e8', 'a9a8', 'e8e9', 'a8a9', 'e9e8', 'a9a8', 'e8e9', 'a8a9'];
  const g = playAll('4k4/9/R8/9/9/9/9/9/9/3K5 w - - 0 1', seq);
  assert.equal(R.result(playAll('4k4/9/R8/9/9/9/9/9/9/3K5 w - - 0 1', seq.slice(0, 8))).over, false);
  assert.deepEqual(R.result(g), { over: true, winner: 'b', reason: '红方长将判负' });
});

test('双方都不将军的重复局面判和', () => {
  const seq = ['a5a6', 'e9e8', 'a6a5', 'e8e9', 'a5a6', 'e9e8', 'a6a5', 'e8e9'];
  const g = playAll('4k4/9/9/9/R8/9/9/9/9/3K5 w - - 0 1', seq);
  assert.deepEqual(R.result(g), { over: true, winner: null, reason: '重复局面判和' });
});

test('60 回合无吃子判和', () => {
  const g = R.newGame('4k4/9/9/9/R8/9/9/9/9/3K5 w - - 119 80');
  const g2 = R.play(g, 'a5a4');
  assert.equal(R.result(g2).reason, '60 回合无吃子判和');
});

test('不合法的着法会抛错且不修改原局面', () => {
  const g = R.newGame();
  assert.throws(() => R.play(g, 'b0b5'), /不合法/);
  assert.equal(R.toFen(g.pos), R.START_FEN);
});

test('中文记谱', () => {
  const p = R.parseFen(R.START_FEN);
  const cn = (m, pos = p) => moveToChinese(pos, R.iccsToMove(m));
  assert.equal(cn('h2e2'), '炮二平五');
  assert.equal(cn('b0c2'), '马八进七');
  assert.equal(cn('a0a1'), '车九进一');
  assert.equal(cn('c3c4'), '兵七进一');
  assert.equal(cn('c0e2'), '相七进五');
  assert.equal(cn('f0e1'), '仕四进五');
  const pb = R.parseFen(R.START_FEN.replace(' w ', ' b '));
  assert.equal(cn('h7e7', pb), '炮８平５');
  assert.equal(cn('h9g7', pb), '马８进７');
  assert.equal(cn('e6e5', pb), '卒５进１');
  // 同列两个车用前后区分
  const p2 = R.parseFen('3k5/9/9/9/9/9/R8/9/9/R2K5 w');
  assert.equal(cn('a3a4', p2), '前车进一');
  assert.equal(cn('a0a1', p2), '后车进一');
  // 退
  const p3 = R.parseFen('3k5/9/9/9/9/R8/9/9/9/3K5 w');
  assert.equal(cn('a4a1', p3), '车九退三');
});

test('中文记谱解析，兼容繁体和半角数字', () => {
  const p = R.parseFen(R.START_FEN);
  assert.equal(R.moveToIccs(chineseToMove(p, '炮二平五')), 'h2e2');
  assert.equal(R.moveToIccs(chineseToMove(p, '砲2平5')), 'h2e2');
  assert.equal(chineseToMove(p, '炮二进九'), null);
  const pb = R.parseFen(R.START_FEN.replace(' w ', ' b '));
  assert.equal(R.moveToIccs(chineseToMove(pb, '馬8進7')), 'h9g7');
});

test('解析模型回答', () => {
  const s = xiangqi.create();
  const ok = xiangqi.parseReply(s, '判断：开局均势\n威胁：无\n理由：中炮\n胜率：52%\n着法：h2e2');
  assert.deepEqual(ok, { action: 'h2e2', attempted: 'h2e2', winrate: 52, error: null });
  assert.equal(xiangqi.parseReply(s, '着法：炮二平五').action, 'h2e2');
  assert.equal(xiangqi.parseReply(s, '我决定走 H2-E2').action, 'h2e2');
  assert.match(xiangqi.parseReply(s, '着法：b0b5').error, /不符合规则/);
  assert.match(xiangqi.parseReply(s, '着法：e5e6').error, /没有棋子/);
  assert.match(xiangqi.parseReply(s, '着法：h7e7').error, /对方的棋子/);
  assert.match(xiangqi.parseReply(s, '我想想').error, /没有找到着法/);
});

test('游戏定义：走棋、记谱、终局名次、重建', () => {
  let s = xiangqi.create();
  s = xiangqi.apply(s, 'h2e2');
  s = xiangqi.apply(s, 'h9g7');
  assert.deepEqual(s.moves.map((m) => m.cn), ['炮二平五', '马８进７']);
  assert.equal(xiangqi.toMove(s), 'r');
  const again = xiangqi.replay(R.START_FEN, ['h2e2', 'h9g7']);
  assert.equal(xiangqi.fen(again), xiangqi.fen(s));
  const mate = xiangqi.create({ fen: 'R3k4/1R7/9/9/9/9/9/9/9/3K5 b - - 0 1' });
  assert.deepEqual(xiangqi.outcome(mate), { over: true, winner: 'r', ranks: { r: 1, b: 2 }, reason: '将死' });
});

test('内置 AI 能找到一步杀', () => {
  const g = R.newGame('4k4/1R7/9/9/9/9/9/9/9/R2K5 w - - 0 1');
  const c = chooseMove(g.pos, { depth: 2, random: 0 });
  const after = R.play(g, c.move);
  assert.equal(R.result(after).reason, '将死');
});
