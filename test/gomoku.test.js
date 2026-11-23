import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import gomoku from '../games/gomoku/index.js';
import { replay } from '../games/index.js';
import { Evaluator, findRapfi } from '../server/evaluator.js';

const play = (moves) => replay(gomoku, { players: 2, actions: moves });
// 黑白交替：给出黑方和白方各自的落子序列
const alt = (black, white) => black.flatMap((b, i) => (white[i] ? [b, white[i]] : [b]));

test('横、竖、斜连成五子获胜，长连也算赢', () => {
  const h = play(alt(['A1', 'B1', 'C1', 'D1', 'E1'], ['A3', 'B3', 'C3', 'D3']));
  assert.deepEqual(gomoku.outcome(h), { over: true, winner: 'b', ranks: { b: 1, w: 2 }, reason: '连成五子' });
  assert.deepEqual(h.winLine, ['A1', 'B1', 'C1', 'D1', 'E1']);
  const v = play(alt(['H4', 'H5', 'H6', 'H7', 'H8'], ['A1', 'A2', 'A3', 'A4']));
  assert.equal(gomoku.outcome(v).winner, 'b');
  const d = play(alt(['A2', 'C3', 'E5', 'F6', 'G7'], ['B2', 'D9', 'K4', 'M12', 'O1']));
  assert.equal(gomoku.outcome(d).over, false, '不连续的斜线不算');
  const diag = play(alt(['C3', 'D4', 'E5', 'F6', 'G7'], ['A1', 'A2', 'A3', 'A4']));
  assert.equal(gomoku.outcome(diag).winner, 'b');
  // 长连：先摆 A1 B1 C1 E1 F1，再下 D1 连成六
  const long = play(alt(['A1', 'B1', 'C1', 'E1', 'F1', 'D1'], ['A3', 'B3', 'C3', 'E3', 'O15']));
  assert.equal(gomoku.outcome(long).winner, 'b');
  assert.equal(long.winLine.length, 6);
});

test('轮次与非法落子', () => {
  let s = gomoku.create();
  assert.deepEqual(gomoku.pending(s), ['b']);
  s = gomoku.apply(s, 'b', 'H8');
  assert.throws(() => gomoku.apply(s, 'b', 'H9'), /不是黑方/);
  assert.throws(() => gomoku.apply(s, 'w', 'H8'), /已经有子/);
  assert.throws(() => gomoku.apply(s, 'w', 'P1'), /无法识别/);
  assert.equal(gomoku.actions(s, 'w').length, 224);
});

test('解析模型回答', () => {
  const s = play(['H8']);
  assert.deepEqual(gomoku.parseReply(s, 'w', '判断：均势\n威胁：无\n理由：贴身\n胜率：48%\n落子：i9'), { action: 'I9', attempted: 'I9', winrate: 48, error: null });
  assert.match(gomoku.parseReply(s, 'w', '落子：H8').error, /已经有子/);
  assert.equal(gomoku.parseReply(s, 'w', '我下 J10 吧').action, 'J10');
  assert.match(gomoku.parseReply(s, 'w', '想想').error, /没有找到/);
});

test('内置 AI 能连五，也会挡住对方的冲四', () => {
  const win = play(alt(['A1', 'B1', 'C1', 'D1'], ['A5', 'B5', 'C5', 'O15']));
  assert.equal(gomoku.outcome(gomoku.apply(win, 'b', gomoku.builtinMove(win, 'b', { level: 2 }))).winner, 'b');
  // 白方 D7 E7 F7 G7 已连四（两端 C7、H7），黑方必须挡；这里让一端已被堵，只剩 H7
  const block = play(alt(['C7', 'A1', 'A3', 'A5', 'O1'], ['D7', 'E7', 'F7', 'G7']));
  assert.equal(gomoku.builtinMove(block, 'b', { level: 2 }), 'H7');
});

const rapfi = findRapfi(join(process.cwd(), 'engines'));
test('Rapfi：评估与最佳着法坐标换算', { skip: !rapfi && '没有找到 Rapfi' }, async () => {
  const ev = new Evaluator({ enginesDir: join(process.cwd(), 'engines'), aiPool: null, movetime: 200 });
  await ev.init();
  try {
    const s = play(alt(['A1', 'B1', 'C1', 'D1'], ['A5', 'B5', 'C5', 'O15']));
    const r = await ev.evaluate(gomoku.evalSpec(s));
    assert.equal(r.source, 'rapfi');
    assert.equal(r.best, 'E1', '黑方应直接连五');
    assert.ok(r.e > 0.9);
  } finally {
    ev.stop();
  }
});
