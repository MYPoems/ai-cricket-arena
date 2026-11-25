import test from 'node:test';
import assert from 'node:assert/strict';
import go from '../games/go/index.js';
import { replay } from '../games/index.js';
import { scoreFinal, bensonAlive, parseCoord, label, tryPlay, hashBoard, legalPoints } from '../games/go/rules.js';
import { FastBoard } from '../games/go/engine.js';

const play = (moves, setup = {}) => replay(go, { players: 2, setup, actions: moves.map((a, i) => ({ seat: i % 2 ? 'w' : 'b', action: a })) });

/** 文字棋盘 → board 数组（第一行是最上面一行） */
function boardFrom(rows) {
  const size = rows.length;
  const b = new Array(size * size).fill(null);
  rows.forEach((row, k) => {
    const y = size - 1 - k;
    [...row.replace(/\s/g, '')].forEach((ch, x) => { b[y * size + x] = ch === 'X' ? 'b' : ch === 'O' ? 'w' : null; });
  });
  return b;
}

test('坐标：GTP 惯例跳过 I，行号自下而上', () => {
  assert.equal(label(0, 9), 'A1');
  assert.equal(label(8, 9), 'J1');
  assert.equal(label(80, 9), 'J9');
  assert.equal(parseCoord('j9', 9), 80);
  assert.equal(parseCoord('I5', 9), null);
  assert.equal(parseCoord('K1', 9), null, '9 路没有 K 列');
  assert.equal(parseCoord('T19', 19), 360);
  assert.equal(parseCoord('A10', 9), null);
});

test('开局参数：默认 9 路贴 7.5，可选 13 / 19 路和贴目', () => {
  const s = go.create({});
  assert.equal(s.size, 9);
  assert.equal(s.komi, 7.5);
  assert.equal(go.create({ setup: { size: 19, komi: 6.5 } }).size, 19);
  assert.equal(go.create({ setup: { size: 19, komi: 6.5 } }).komi, 6.5);
  assert.equal(go.create({ setup: { size: 10 } }).size, 9);
  assert.deepEqual(go.seats(2), ['b', 'w']);
  assert.equal(go.seatName('w'), '白方');
  assert.equal(go.actions(s, 'b').length, 82, '81 个点 + 虚手');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
});

test('提子：单子、角上、整串，提子数累计', () => {
  // 白 A1 被黑 A2、B1 提掉
  let s = play(['A2', 'A1', 'B1']);
  assert.equal(s.board[0], null);
  assert.deepEqual(s.moves[2].captured, ['A1']);
  assert.equal(s.caps.b, 1);
  // 两子一串：白 E5 E6，黑围住提两子
  s = play(['D5', 'E5', 'D6', 'E6', 'F5', 'J9', 'F6', 'J8', 'E4', 'J7', 'E7']);
  assert.deepEqual([...s.moves.at(-1).captured].sort(), ['E5', 'E6']);
  assert.equal(s.caps.b, 2);
  assert.equal(s.board[parseCoord('E5', 9)], null);
  assert.throws(() => go.apply(s, 'w', 'D5'), /已经有子/);
  assert.throws(() => go.apply(s, 'b', 'A1'), /不是黑方/);
});

test('禁止自杀；能提子的「自杀点」可以下', () => {
  // 黑 A2、B1 围住 A1：白下 A1 是自杀
  const s = play(['A2', 'J9', 'B1']);
  assert.throws(() => go.apply(s, 'w', 'A1'), /自杀/);
  assert.match(go.parseReply(s, 'w', '落子：A1').error, /自杀/);
  assert.ok(!go.actions(s, 'w').some((a) => a.id === 'A1'));
  // 多子自杀：白 A1 A2 只剩 A3 一口气（B1 B2 被黑占），白再下 A3 填掉自己的最后一口气
  const t = play(['B1', 'A1', 'B2', 'A2', 'B3', 'J9', 'A4']);
  assert.throws(() => go.apply(t, 'w', 'A3'), /自杀/);
  // 提子的点不是自杀：黑 B1 A2 被白围，黑落子提白
  const u = play(['B2', 'A2', 'C1', 'B1', 'J9', 'J8', 'A1']);
  assert.ok(u.moves.at(-1).captured.length > 0, `A1 应提掉 ${u.moves.at(-1).captured}`);
});

test('打劫：立即提回是全局同形，禁止；找劫材后可以提回', () => {
  // 构造劫：黑 D5 E4 E6 F5? 用标准形：
  // 黑：C5 D4 D6；白：E4 E6 F5 D5（D5 白子被黑 E5 提）
  const moves = ['C5', 'E4', 'D4', 'E6', 'D6', 'F5', 'J1', 'D5', 'E5'];
  let s = play(moves);
  assert.deepEqual(s.moves.at(-1).captured, ['D5'], '黑 E5 提白 D5');
  // 白立即在 D5 提回 E5：会重现局面，禁止
  assert.throws(() => go.apply(s, 'w', 'D5'), /全局同形/);
  assert.match(go.parseReply(s, 'w', '落子：D5').error, /全局同形/);
  assert.match(go.turnPrompt(s, 'w'), /禁着点：D5（全局同形（打劫））/);
  // 白找劫材 A9，黑应 A8，白再提回
  s = go.apply(s, 'w', 'A9');
  s = go.apply(s, 'b', 'A8');
  s = go.apply(s, 'w', 'D5');
  assert.deepEqual(s.moves.at(-1).captured, ['E5']);
  // 黑也不能马上提回
  assert.throws(() => go.apply(s, 'b', 'E5'), /全局同形/);
});

test('虚手：一次不终局，双方连续虚手终局并数子；手数上限也终局', () => {
  let s = play(['E5', 'pass']);
  assert.equal(go.outcome(s).over, false);
  assert.equal(go.label(s, 'b', 'pass'), '虚手');
  s = go.apply(s, 'b', 'D4');
  s = go.apply(s, 'w', 'pass');
  assert.equal(go.outcome(s).over, false, '中间隔了一手不算连续');
  s = go.apply(s, 'b', 'pass');
  const o = go.outcome(s);
  assert.equal(o.over, true);
  assert.equal(o.winner, 'b', '黑两子占全盘，81 子对 0 子');
  assert.match(o.reason, /双方连续虚手.*黑 81，白 0 \+ 贴目 7\.5，黑胜 73\.5 目/);
  assert.deepEqual(go.pending(s), []);
  assert.throws(() => go.apply(s, 'w', 'A1'), /已经结束/);
  // 上限
  const t = go.create({});
  const lim = { ...t, maxMoves: 4 };
  let u = lim;
  for (const a of ['A1', 'J9', 'A9', 'J1']) u = go.apply(u, u.side, a);
  assert.equal(u.end, 'limit');
  assert.match(go.outcome(u).reason, /到了 4 手上限/);
});

test('认输：行动 resign 或回答「认输」，对方胜', () => {
  const s = play(['E5']);
  const r = go.parseReply(s, 'w', '判断：大势已去\n威胁：无\n理由：无\n胜率：2%\n落子：认输');
  assert.equal(r.action, 'resign');
  const t = go.apply(s, 'w', 'resign');
  assert.deepEqual(go.outcome(t), { over: true, winner: 'b', ranks: { b: 1, w: 2 }, reason: '白方认输' });
  assert.equal(go.label(s, 'w', 'resign'), '认输');
  assert.ok(!go.actions(s, 'w').some((a) => a.id === 'resign'), '认输不放进行动列表，免得随机选手乱点');
  assert.deepEqual(go.forfeit(s, 'b', '黑方超时'), { over: true, winner: 'w', ranks: { w: 1, b: 2 }, reason: '黑方超时' });
});

test('数子 + 贴目：子 + 只挨着一方的空点', () => {
  // 黑占左边 4 列（含第 4 列墙），白占右边 5 列（第 5 列墙）：黑 36，白 45
  const rows = Array.from({ length: 9 }, () => '...XO....');
  const f = scoreFinal(boardFrom(rows), 9, 7.5);
  assert.equal(f.b, 36);
  assert.equal(f.w, 45);
  assert.equal(f.margin, 36 - 45 - 7.5);
  assert.deepEqual(f.dead, []);
  // 公共的空点（挨着双方）谁都不算
  const rows2 = Array.from({ length: 9 }, () => '...X.O...');
  const g = scoreFinal(boardFrom(rows2), 9, 0);
  assert.equal(g.b, 36);
  assert.equal(g.w, 36);
  assert.equal(g.owner[4], null);
});

test('死子判定：对方地里孤立的子判死并算给对方，活棋不动；结果确定', () => {
  const rows = [
    '...XO....',
    '...XO.X..', // 白地里一颗黑子（死）
    '...XO....',
    '.O.XO....', // 黑地里一颗白子（死）
    '...XO....',
    '...XO....',
    '...XO..X.',
    '...XO....',
    '...XO....',
  ];
  const board = boardFrom(rows);
  const f1 = scoreFinal(board, 9, 7.5);
  const f2 = scoreFinal(board, 9, 7.5);
  assert.deepEqual(f1, f2, '同样的局面永远得到同样结果');
  const dead = f1.dead.map((i) => label(i, 9)).sort();
  assert.deepEqual(dead, ['B6', 'G8', 'H3']);
  assert.equal(f1.b, 36);
  assert.equal(f1.w, 45);
  // 带眼的活棋（Benson 无条件活）：不会被判死
  const alive = boardFrom([
    'XXXXXXXXX',
    'X.X.XOOOO',
    'XXXXXO.O.',
    'OOOOOOOOO',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const benson = bensonAlive(alive, 9, 'b');
  assert.ok(benson.has(80), '上边黑棋两只眼，无条件活');
  assert.ok(benson.has(parseCoord('F8', 9)) === false);
  const fa = scoreFinal(alive, 9, 7.5);
  assert.ok(!fa.dead.some((i) => alive[i] === 'b'));
});

test('终局视图：每个点的归属和死子', () => {
  const s0 = go.create({});
  // 黑围左边、白围右边，白地里放一颗黑子，然后双方虚手
  const moves = [];
  for (let y = 1; y <= 9; y++) moves.push(`D${y}`, `E${y}`);
  moves.push('H5', 'pass', 'pass');
  let s = s0;
  for (const a of moves) s = go.apply(s, s.side, a);
  assert.equal(s.end, 'pass');
  const v = go.view(s, null);
  assert.equal(v.over, true);
  assert.ok(v.final);
  assert.equal(v.final.owner.length, 81);
  assert.deepEqual(v.final.dead, ['H5']);
  assert.equal(v.final.owner[parseCoord('H5', 9)], 'w');
  assert.equal(v.final.owner[parseCoord('A1', 9)], 'b');
  assert.equal(v.final.b, 36);
  assert.equal(v.final.w, 45);
  assert.match(go.outcome(s).reason, /判 黑死子 1 颗.*白胜 16\.5 目/);
  assert.equal(v.final.result, '白胜 16.5 目');
  assert.deepEqual(v.ko, []);
  assert.equal(v.lastMove, null);
  assert.equal(v.lastPass, 'b');
  assert.equal(v.moves.at(-1).label, '虚手');
  // 进行中的视图
  const m = go.view(play(['A2', 'A1', 'B1']), null);
  assert.equal(m.lastMove, 'B1');
  assert.deepEqual(m.captured, ['A1']);
  assert.equal(m.caps.b, 1);
  assert.equal(m.final, null);
});

test('解析模型回答：各种写法', () => {
  const s = play(['E5']);
  const P = (t) => go.parseReply(s, 'w', t);
  assert.deepEqual(P('判断：均势\n威胁：无\n理由：靠\n胜率：48%\n落子：d4'), { action: 'D4', attempted: 'D4', winrate: 48, error: null });
  assert.equal(P('落子：Ｃ３').action, 'C3');
  assert.equal(P('落子:d 4').action, 'D4');
  assert.equal(P('落子： D-4（星位）').action, 'D4');
  assert.equal(P('落子：虚手').action, 'pass');
  assert.equal(P('落子：停一手').action, 'pass');
  assert.equal(P('落子：PASS').action, 'pass');
  assert.equal(P('判断：没棋了\n虚手').action, 'pass');
  assert.equal(P('落子：天元').action, null, '天元已经有子');
  assert.match(P('落子：天元').error, /已经有子/);
  assert.equal(P('落子：C十').error !== null, true);
  assert.equal(P('落子：c三').action, 'C3');
  assert.equal(P('胜率：50%\n我想下 G7 吧').action, 'G7');
  assert.equal(P('胜率：50%\n落子：E5').error, 'E5 已经有子');
  assert.match(P('落子：I3').error, /没有 I 列/);
  assert.match(P('落子：K3').error, /超出棋盘/);
  assert.match(P('落子：Q16').error, /超出棋盘/);
  assert.match(P('落子：随便').error, /不是坐标/);
  assert.match(P('想想').error, /没有找到/);
  assert.equal(P('胜率：６０％\n落子：A1').winrate, 60);
  // 19 路两位数行号
  const t = go.create({ setup: { size: 19 } });
  assert.equal(go.parseReply(t, 'b', '落子：q16').action, 'Q16');
  assert.equal(go.parseReply(t, 'b', '落子：Q十六').action, 'Q16');
  assert.equal(go.parseReply(t, 'b', '落子：T19').action, 'T19');
});

test('mockReply 写出的回答能解析回同一行动', () => {
  let s = go.create({});
  for (let k = 0; k < 30; k++) {
    const a = go.builtinMove(s, s.side, { level: 1 });
    const r = go.parseReply(s, s.side, go.mockReply(s, s.side, a));
    assert.equal(r.action, a);
    assert.ok(r.winrate >= 5 && r.winrate <= 95);
    s = go.apply(s, s.side, a);
    if (s.end) break;
  }
  const p = go.parseReply(s, s.side, go.mockReply(s, s.side, 'pass'));
  assert.equal(p.action, 'pass');
});

test('提示词：棋盘带行号列字母、提子数、上一手、禁着点、可选合法着点', () => {
  const s = play(['A2', 'A1', 'B1']);
  const sys = go.systemPrompt('w', { state: s });
  assert.match(sys, /跳过字母 I/);
  assert.match(sys, /例如 D4/);
  assert.match(sys, /贴 7\.5/);
  const t = go.turnPrompt(s, 'w', { showLegal: true });
  assert.match(t, /第 4 手/);
  assert.match(t, /对方上一手：B1（提掉 1 子：A1）/);
  assert.match(t, /黑方已提 1 子，白方已提 0 子/);
  assert.match(t, /禁着点：A1（自杀）/, 'A1 被黑 A2 B1 围住，白下是自杀');
  assert.match(t, / {4}A B C D E F G H J/);
  assert.match(t, /\n 9 {2}\. \. \. \. \. \. \. \. \.  9\n/);
  assert.match(t, /\n 1 {2}\. X \. \. \. \. \. \. \.  1\n/);
  assert.match(t, /你可以落子的点：C1 D1/);
  const p = go.turnPrompt(go.apply(s, 'w', 'pass'), 'b');
  assert.match(p, /对方上一手：虚手。你也虚手的话，对局立即结束并数子/);
});

test('快速棋盘和规则引擎一致（随机对局逐步对照）', () => {
  for (let g = 0; g < 12; g++) {
    const size = [9, 13, 19][g % 3];
    let s = go.create({ setup: { size } });
    const fb = new FastBoard(size);
    while (!s.end && s.moves.length < 250) {
      const a = go.builtinMove(s, s.side, { random: true, seed: g });
      const c = s.side === 'b' ? 1 : 2;
      if (a === 'pass') fb.pass();
      else {
        const i = parseCoord(a, size);
        const p = fb.pt(i % size, Math.floor(i / size));
        assert.ok(fb.legal(p, c), `${a} 在快速棋盘上也合法`);
        fb.play(p, c);
      }
      s = go.apply(s, s.side, a);
      for (let i = 0; i < size * size; i++) {
        const v = fb.col[fb.pt(i % size, Math.floor(i / size))];
        assert.equal(v, s.board[i] === 'b' ? 1 : s.board[i] === 'w' ? 2 : 0);
      }
    }
  }
});

test('内置 AI：9 路 30 局、13 路 3 局随机 / 初级能正常下完；带种子可重现', () => {
  const run = (size, seed, levels) => {
    let s = go.create({ setup: { size } });
    const record = { players: 2, setup: { size }, actions: [] };
    while (!go.outcome(s).over) {
      const seat = s.side;
      const a = go.builtinMove(s, seat, { level: levels[seat], seed, playouts: 60 });
      record.actions.push({ seat, action: a });
      s = go.apply(s, seat, a);
    }
    return { s, record };
  };
  for (let g = 0; g < 30; g++) {
    const { s, record } = run(9, g, g % 3 === 0 ? { b: 2, w: 1 } : { b: 1, w: 1 });
    const o = go.outcome(s);
    assert.equal(o.over, true);
    assert.ok(o.reason.length > 5);
    // 记录重放得到同一局面、同一结果
    const again = replay(go, record);
    assert.deepEqual(again.board, s.board);
    assert.deepEqual(go.outcome(again), o);
    if (g < 2) {
      const twin = run(9, g, g % 3 === 0 ? { b: 2, w: 1 } : { b: 1, w: 1 });
      assert.deepEqual(twin.record, record, '同样的种子下出同一盘');
    }
  }
  for (let g = 0; g < 3; g++) assert.equal(go.outcome(run(13, 100 + g, { b: 1, w: 1 }).s).over, true);
});

test('内置 AI：会提子、会逃子、对方虚手且自己领先时跟着虚手', () => {
  // 白 E5 被黑 D5 F5 E6 三面围住，黑下 E4 提子
  const s = play(['D5', 'E5', 'F5', 'A9', 'E6', 'A8']);
  assert.equal(go.builtinMove(s, 'b', { level: 2, seed: 1, playouts: 300 }), 'E4');
  assert.equal(go.builtinMove(s, 'b', { level: 3, seed: 1, playouts: 300 }), 'E4');
  // 黑全盘领先、白虚手：黑跟着虚手结束
  const t = play(['E5', 'pass']);
  assert.equal(go.builtinMove(t, 'b', { level: 2, seed: 1 }), 'pass');
  assert.equal(go.builtinMove(t, 'b', { level: 1 }), 'pass');
});

test('局面评估：300 毫秒内返回走棋方期望得分和最好着点', () => {
  for (const size of [9, 13, 19]) {
    let s = go.create({ setup: { size } });
    for (let k = 0; k < 10; k++) s = go.apply(s, s.side, go.builtinMove(s, s.side, { level: 1, seed: k }));
    const spec = go.evalSpec(s);
    assert.equal(spec.engine, 'local');
    assert.equal(spec.persp, s.side);
    const t0 = performance.now();
    const r = spec.evaluate();
    const ms = performance.now() - t0;
    assert.ok(ms < 300, `${size} 路评估用了 ${Math.round(ms)}ms`);
    assert.ok(r.e >= 0 && r.e <= 1);
    assert.ok(r.best === 'pass' || go.actions(s, s.side).some((a) => a.id === r.best), `best ${r.best} 合法`);
  }
  // 明显的提子：白 E5 只剩一口气
  const s = play(['D5', 'E5', 'F5', 'A9', 'E6', 'A8']);
  const r = go.evalSpec(s).evaluate();
  assert.equal(r.best, 'E4');
  assert.ok(r.e > 0.5);
  assert.equal(go.evalSpec(play(['E5', 'pass', 'pass'])), null);
  assert.deepEqual(go.features, { draw: false, hidden: false, winbar: true, evalEngine: 'local', clock: true });
});

test('全局同形：哈希历史包含开局空盘，legalPoints 与 tryPlay 一致', () => {
  const s = play(['E5', 'D5']);
  assert.equal(s.hist.length, 3);
  const { legal, banned } = legalPoints(s, 'b');
  assert.equal(legal.length + banned.length, 79);
  const r = tryPlay(s.board, 9, parseCoord('A1', 9), 'b', hashBoard(s.board), new Set(s.hist));
  assert.equal(r.error, undefined);
});

test('视图里的打劫点：刚提一子、对方不能立即提回的点；找过劫材后消失', () => {
  let s = play(['C5', 'E4', 'D4', 'E6', 'D6', 'F5', 'J1', 'D5', 'E5']);
  assert.deepEqual(go.view(s, null).ko, ['D5']);
  assert.deepEqual(go.view(s, 'w').ko, ['D5']);
  s = go.apply(s, 'w', 'A9');
  assert.deepEqual(go.view(s, null).ko, []);
  s = go.apply(go.apply(s, 'b', 'A8'), 'w', 'D5');
  assert.deepEqual(go.view(s, null).ko, ['E5']);
  // 普通提子（提回去不是同形）不算打劫
  assert.deepEqual(go.view(play(['A2', 'A1', 'B1']), null).ko, []);
  assert.deepEqual(go.view(go.create({}), null).ko, []);
});

test('双活不判死：各有一眼共一口公气、无眼两口公气', () => {
  // 黑角上一块（眼在 A9）和白一块（眼在 G9）共用 D9：谁填 D9 谁被提
  const oneEye = boardFrom([
    '.XX.OO.OX',
    'XXXXOOOOX',
    'OOOOXXXXX',
    '...OX....',
    '...OX....',
    '...OX....',
    '...OX....',
    '...OX....',
    '...OX....',
  ]);
  const f = scoreFinal(oneEye, 9, 7.5);
  assert.deepEqual(f.dead, []);
  assert.equal(f.owner[parseCoord('D9', 9)], null, '公气谁都不算');
  assert.equal(f.owner[parseCoord('A9', 9)], 'b');
  assert.equal(f.owner[parseCoord('G9', 9)], 'w');
  // 黑 B7 B8 B9 C7 和白 D7 D8 D9 共用 C8、C9 两口气，都没有眼
  const noEye = boardFrom([
    'OX.OX....',
    'OX.OX....',
    'OXXOX....',
    'OOOXX....',
    '...OX....',
    '...OX....',
    '...OX....',
    '...OX....',
    '...OX....',
  ]);
  assert.deepEqual(scoreFinal(noEye, 9, 7.5).dead, []);
});

test('死活常见情形：角上无眼的残子、只有一只眼的棋判死；直四、曲四判活', () => {
  const pad = (top) => boardFrom([...top, ...Array(9 - top.length).fill('.........')].map((r, k) => (k === 6 ? '..X...X..' : r)));
  const whiteDead = (top) => {
    const b = pad(top);
    const f = scoreFinal(b, 9, 7.5);
    return b.every((c, i) => c !== 'w' || f.dead.includes(i));
  };
  const anyDead = (top) => scoreFinal(pad(top), 9, 7.5).dead.length > 0;
  assert.ok(whiteDead(['OO.X.....', '..X......', 'XX.......']), '角上两子');
  assert.ok(whiteDead(['.OX......', 'OOX......', 'XXX......']), '一只眼');
  assert.ok(whiteDead(['..OX.....', 'OOOX.....', 'XXXX.....']), '直二');
  assert.ok(!anyDead(['....OX...', 'OOOOOX...', 'XXXXXX...']), '直四');
  assert.ok(!anyDead(['...OX....', '.OOOX....', 'OOXXX....', 'XXX......']), '曲四');
  assert.ok(!anyDead(['.O.OX....', 'OOOOX....', 'XXXXX....']), '两只眼');
});

test('解析：markdown 加粗、写反的坐标、一行里几样取最前面的、只有数字时提示缺列字母', () => {
  const s = play(['E5']);
  const P = (t) => go.parseReply(s, 'w', t);
  assert.equal(P('**落子：D4**').action, 'D4');
  assert.equal(P('**落子**：`D4`').action, 'D4');
  assert.equal(P('### 落子: **d4**（挂角）').action, 'D4');
  assert.equal(P('落子位置：C3').action, 'C3');
  assert.equal(P('落子：4D').action, 'D4');
  assert.equal(P('落子：D4（防 E6 的断，不能虚手）').action, 'D4');
  assert.equal(P('落子：不认输，下 C3').action, 'C3');
  assert.equal(P('落子：虚手（D4 已经没有价值）').action, 'pass');
  assert.equal(P('理由：再不行就认输\n落子：G3').action, 'G3');
  assert.equal(P('落子：F6\n落子：G6').action, 'G6', '写了两行取最后一行');
  assert.match(P('落子：４四').error, /缺列字母/);
  assert.match(P('落子：4-4').error, /缺列字母.*例如 D4/);
  assert.equal(P('我选择虚手。').action, 'pass');
  assert.equal(P('落子：停1手').action, 'pass');
});

test('提示词：气紧的棋串、什么时候虚手、后半盘给出直接数子的结果', () => {
  const s = play(['D5', 'E5', 'F5', 'A9', 'E6', 'A8']);
  assert.match(go.turnPrompt(s, 'b'), /对方气紧的棋：E5（只剩 1 气，被打吃，气在 E4）/);
  assert.match(go.turnPrompt(go.apply(s, 'b', 'J1'), 'w'), /你的气紧的棋：E5（只剩 1 气，被打吃，气在 E4）/);
  assert.doesNotMatch(go.turnPrompt(play(['E5']), 'w'), /气紧/);
  const sys = go.systemPrompt('b', { state: s });
  assert.match(sys, /什么时候虚手/);
  assert.match(sys, /提干净再虚手/);
  // 对方虚手后：直接数子的结果
  const t = go.turnPrompt(play(['E5', 'pass']), 'b');
  assert.match(t, /按现在的盘面直接数.*黑 81，白 0 \+ 贴目 7\.5/);
  assert.doesNotMatch(go.turnPrompt(play(['E5']), 'w'), /直接数/);
  // 快到手数上限时提醒
  const near = { ...play(['E5', 'D5']), maxMoves: 12 };
  assert.match(go.turnPrompt(near, 'b'), /只剩 10 手就强制终局/);
});

test('初级内置 AI（真人超时由它代走）：不把自己的一串子送进虎口', () => {
  // 黑 A1 只剩 B1 一口气；黑再下 B1 两子还是只有 C1 一口气（送吃）
  const s = play(['A1', 'A2', 'J9', 'B2']);
  for (let seed = 0; seed < 300; seed++) assert.notEqual(go.builtinMove(s, 'b', { level: 1, seed }), 'B1');
  // 对方虚手、按正式终局判定自己能赢：跟着虚手（盘面粗数看不出来的也算——黑地里的白子 H5 是死子）
  const moves = [];
  for (let y = 1; y <= 9; y++) moves.push(`E${y}`, `D${y}`);
  moves.push('J9', 'H5', 'J8', 'pass');
  let t = go.create({});
  for (const a of moves) t = go.apply(t, t.side, a);
  assert.equal(t.side, 'b');
  assert.equal(go.builtinMove(t, 'b', { level: 1, seed: 3 }), 'pass');
});

test('局面评估：强手连下时期望得分不乱跳（不把好棋标成失误）', () => {
  let s = go.create({});
  let prev = go.evalSpec(s).evaluate();
  let flagged = 0, n = 0;
  for (let k = 0; k < 14; k++) {
    const a = prev.best;
    s = go.apply(s, s.side, a);
    if (s.end) break;
    const after = go.evalSpec(s).evaluate();
    if (prev.e - (1 - after.e) >= 0.1) flagged++;
    n++;
    assert.equal(Object.keys(after).sort().join(), 'best,e,source', '评估结果要能直接入库');
    prev = after;
  }
  assert.ok(flagged <= 1, `${n} 手里有 ${flagged} 手掉了 10% 以上`);
});
