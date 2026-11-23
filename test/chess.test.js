import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../games/chess/rules.js';
import { chooseMove } from '../games/chess/ai.js';
import chess from '../games/chess/index.js';
import { replay } from '../games/index.js';

const playSeq = (moves, fen) => {
  let s = chess.create({ setup: fen ? { fen } : undefined });
  for (const a of moves) s = chess.apply(s, s.pos.side, a);
  return s;
};
const ids = (s) => chess.actions(s, s.pos.side).map((a) => a.id);
const sans = (s) => chess.actions(s, s.pos.side).map((a) => a.label);
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -';

test('perft：初始局面 1–4 层与公认值一致', () => {
  const p = R.parseFen(R.START_FEN);
  assert.deepEqual([1, 2, 3, 4].map((d) => R.perft(p, d)), [20, 400, 8902, 197281]);
  assert.equal(R.toFen(p), R.START_FEN, 'perft 后局面应完全还原');
});

test('perft：Kiwipete 等复杂局面（易位、过路兵、升变）', () => {
  assert.deepEqual([1, 2, 3].map((d) => R.perft(R.parseFen(KIWIPETE), d)), [48, 2039, 97862]);
  assert.deepEqual([1, 2, 3, 4].map((d) => R.perft(R.parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -'), d)), [14, 191, 2812, 43238]);
  assert.deepEqual([1, 2, 3].map((d) => R.perft(R.parseFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'), d)), [6, 264, 9467]);
  assert.deepEqual([1, 2, 3].map((d) => R.perft(R.parseFen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'), d)), [44, 1486, 62379]);
});

test('FEN 往返不变，并拒绝错误的 FEN', () => {
  const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 3 12';
  assert.equal(R.toFen(R.parseFen(fen)), fen);
  assert.throws(() => R.parseFen('8/8/8 w'), /8 行/);
  assert.throws(() => R.parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN w KQkq - 0 1'), /8 列/);
  assert.throws(() => R.parseFen('rnbqkbnr/ppppxppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), /未知棋子/);
  assert.throws(() => R.parseFen('8/8/8/8/8/8/8/K7 w - - 0 1'), /各有一个王/);
  assert.throws(() => R.parseFen('k6R/8/8/8/8/8/8/K7 w - - 0 1'), /被将军/, '不走棋的一方被将军');
  // 易位权与王车位置不符时被丢弃
  assert.equal(R.toFen(R.parseFen('4k3/8/8/8/8/8/8/4K2R w KQkq - 0 1')).split(' ')[2], 'K');
});

test('从任意 FEN 开局', () => {
  const s = chess.create({ setup: { fen: '4k3/8/8/8/8/8/4P3/4K3 b - - 0 40' } });
  assert.deepEqual(chess.pending(s), ['b']);
  assert.equal(chess.fen(s), '4k3/8/8/8/8/8/4P3/4K3 b - - 0 40');
  assert.throws(() => chess.create({ setup: { fen: 'bad' } }));
});

test('标准代数记谱：Nf3、exd5、O-O、消歧义、升变带将', () => {
  let s = chess.create();
  assert.ok(sans(s).includes('Nf3') && sans(s).includes('e4'));
  s = playSeq(['e2e4', 'd7d5']);
  assert.equal(chess.label(s, 'w', 'e4d5'), 'exd5');
  s = playSeq(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6']);
  assert.equal(chess.label(s, 'w', 'e1g1'), 'O-O');
  assert.equal(chess.label(R.newGame(KIWIPETE), 'w', 'e1c1'), 'O-O-O');
  // 两匹马都能到 d2：按列区分
  const d = chess.create({ setup: { fen: '4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1' } });
  assert.equal(chess.label(d, 'w', 'b1d2'), 'Nbd2');
  // 同列两个车：按行区分
  const r = chess.create({ setup: { fen: '4k3/8/8/R7/8/8/8/R3K3 w - - 0 1' } });
  assert.equal(chess.label(r, 'w', 'a1a3'), 'R1a3');
  // 升变并将军
  const p = chess.create({ setup: { fen: 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1' } });
  assert.equal(chess.label(p, 'w', 'e7e8q'), 'e8=Q+');
  assert.equal(chess.label(p, 'w', 'e7e8n'), 'e8=N');
  // 将死记 #
  const f = playSeq(['f2f3', 'e7e5', 'g2g4']);
  assert.equal(chess.label(f, 'b', 'd8h4'), 'Qh4#');
});

test('王车易位：被将军、经过被攻击格时不能易位；王车走过后失去易位权', () => {
  // 黑象 c4 控制 f1：不能短易位；b1 被攻击不影响长易位
  let s = chess.create({ setup: { fen: 'r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1' } });
  assert.ok(!ids(s).includes('e1g1'));
  assert.ok(ids(s).includes('e1c1'));
  s = chess.create({ setup: { fen: 'r3k2r/8/8/8/8/8/1q6/R3K2R w KQkq - 0 1' } });
  assert.ok(ids(s).includes('e1g1'), 'b1 被攻击时……');
  assert.ok(!ids(s).includes('e1c1'), '……c1、d1 被后控制，不能长易位');
  // 被将军时不能易位
  s = chess.create({ setup: { fen: 'r3k2r/8/8/8/8/8/4q3/R3K2R w KQkq - 0 1' } });
  assert.ok(!ids(s).includes('e1g1') && !ids(s).includes('e1c1'));
  // 易位后车到位
  s = chess.apply(chess.create({ setup: { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' } }), 'w', 'e1g1');
  assert.equal(s.pos.board[R.parseSq('f1')], 'R');
  assert.equal(s.pos.board[R.parseSq('h1')], null);
  s = chess.apply(s, 'b', 'e8c8');
  assert.equal(s.pos.board[R.parseSq('d8')], 'r');
  assert.equal(chess.fen(s).split(' ')[2], '-');
  // 车走过一次就失去该侧易位权
  s = playSeq(['h1g1', 'a8b8', 'g1h1', 'b8a8'], 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(chess.fen(s).split(' ')[2], 'Qk');
  // 车被吃掉也失去易位权
  s = playSeq(['a1a8'], 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(chess.fen(s).split(' ')[2], 'Kk');
});

test('吃过路兵：只能紧接着吃，并移除被吃的兵', () => {
  let s = playSeq(['e2e4', 'a7a6', 'e4e5', 'd7d5']);
  assert.equal(chess.fen(s).split(' ')[3], 'd6');
  assert.ok(ids(s).includes('e5d6'));
  assert.equal(chess.label(s, 'w', 'e5d6'), 'exd6');
  const t = chess.apply(s, 'w', 'e5d6');
  assert.equal(t.pos.board[R.parseSq('d5')], null, '被吃的兵移走');
  assert.equal(t.pos.board[R.parseSq('d6')], 'P');
  // 错过一步就不能再吃
  const late = playSeq(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'h2h3', 'h7h6']);
  assert.ok(!ids(late).includes('e5d6'));
  // 吃过路兵后自己的王被横向将军：不合法
  const pin = chess.create({ setup: { fen: '8/8/8/K2pP2r/8/8/8/7k w - d6 0 1' } });
  assert.ok(!ids(pin).includes('e5d6'));
  // 旁边没有兵时 FEN 不写过路兵格
  assert.equal(chess.fen(playSeq(['e2e4'])).split(' ')[3], '-');
});

test('升变：四个选项都可走，升变后棋子正确', () => {
  const s = chess.create({ setup: { fen: '1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1' } });
  const pr = ids(s).filter((id) => id.startsWith('a7'));
  assert.deepEqual(pr.sort(), ['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r', 'a7b8b', 'a7b8n', 'a7b8q', 'a7b8r']);
  assert.equal(chess.apply(s, 'w', 'a7b8n').pos.board[R.parseSq('b8')], 'N');
  assert.throws(() => chess.apply(s, 'w', 'a7a8'), /不合法/, '升变必须写明棋子');
  const b = chess.create({ setup: { fen: '4k3/8/8/8/8/8/p7/4K3 b - - 0 1' } });
  assert.equal(chess.apply(b, 'b', 'a2a1r').pos.board[0], 'r');
});

test('将死与逼和', () => {
  const mate = playSeq(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  assert.deepEqual(chess.outcome(mate), { over: true, winner: 'b', ranks: { b: 1, w: 2 }, reason: '黑方将死白方' });
  assert.deepEqual(chess.pending(mate), []);
  assert.equal(chess.evalSpec(mate), null);
  assert.throws(() => chess.apply(mate, 'w', 'e2e3'), /已经结束/);
  // 白后走到 f7 形成逼和
  const st = playSeq(['f1f7'], '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1');
  const o = chess.outcome(st);
  assert.equal(o.over, true);
  assert.equal(o.winner, null);
  assert.deepEqual(o.ranks, { w: 1, b: 1 });
  assert.match(o.reason, /逼和/);
});

test('50 回合规则、三次重复、子力不足', () => {
  let s = chess.create({ setup: { fen: '4k3/8/8/8/8/8/4P3/R3K3 w - - 98 80' } });
  s = chess.apply(s, 'w', 'a1a2');
  assert.equal(chess.outcome(s).over, false);
  s = chess.apply(s, 'b', 'e8d8');
  assert.match(chess.outcome(s).reason, /50 回合/);
  // 走兵重置计数
  let p = chess.create({ setup: { fen: '4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80' } });
  p = chess.apply(p, 'w', 'e2e3');
  assert.equal(chess.outcome(p).over, false);
  assert.equal(p.pos.halfmove, 0);
  // 三次重复：双方马跳出又跳回两次，初始局面第三次出现
  const rep = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const r7 = playSeq([...rep, ...rep].slice(0, 7));
  assert.equal(chess.outcome(r7).over, false);
  const r8 = chess.apply(r7, 'b', 'f6g8');
  assert.match(chess.outcome(r8).reason, /三次/);
  // 子力不足
  assert.match(chess.outcome(chess.create({ setup: { fen: '8/8/8/4k3/8/8/8/4K3 w - - 0 1' } })).reason, /子力/);
  assert.equal(chess.outcome(chess.create({ setup: { fen: '8/8/8/4k3/8/8/8/3BK3 w - - 0 1' } })).over, true);
  assert.equal(chess.outcome(chess.create({ setup: { fen: '8/8/8/4k3/8/8/8/3NK3 w - - 0 1' } })).over, true);
  assert.equal(chess.outcome(chess.create({ setup: { fen: '2b5/8/8/4k3/8/8/8/3BK3 w - - 0 1' } })).over, true, '同色格象');
  assert.equal(chess.outcome(chess.create({ setup: { fen: '1b6/8/8/4k3/8/8/8/3BK3 w - - 0 1' } })).over, false, '异色格象');
  assert.equal(chess.outcome(chess.create({ setup: { fen: '1n6/8/8/4k3/8/8/8/3NK3 w - - 0 1' } })).over, false, '马对马');
  assert.equal(chess.outcome(chess.create({ setup: { fen: '8/8/8/4k3/8/8/P7/4K3 w - - 0 1' } })).over, false);
  // 吃掉最后一个兵后变成子力不足
  const c = playSeq(['e1d2'], '8/8/8/8/8/8/3p4/4K1k1 w - - 0 1');
  assert.equal(chess.outcome(c).over, true);
});

test('轮次、非法着法、apply 不修改原 state、state 可 JSON 序列化', () => {
  const s = chess.create();
  assert.deepEqual(chess.seats(2), ['w', 'b']);
  assert.equal(chess.seatName('w'), '白方');
  assert.deepEqual(chess.pending(s), ['w']);
  assert.deepEqual(chess.actions(s, 'b'), []);
  assert.throws(() => chess.apply(s, 'b', 'e7e5'), /不是黑方/);
  assert.throws(() => chess.apply(s, 'w', 'e2e5'), /不合法/);
  const before = JSON.stringify(s);
  const t = chess.apply(s, 'w', 'e2e4');
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(JSON.parse(JSON.stringify(t)), t);
  assert.deepEqual(chess.pending(t), ['b']);
  // 被将军时只能应将
  const chk = playSeq(['e2e4', 'e7e5', 'd1h5', 'b8c6', 'h5f7']);
  assert.ok(chk.moves.at(-1).check);
  assert.equal(chk.moves.at(-1).san, 'Qxf7+');
  assert.deepEqual(ids(chk), ['e8f7'], 'e7 也被后控制，只能王吃后');
});

test('对局记录可以重现（replay 与逐步 apply 一致）', () => {
  const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5c6', 'd7c6', 'e1g1'];
  const a = replay(chess, { players: 2, actions: moves.map((action, i) => ({ seat: i % 2 ? 'b' : 'w', action })) });
  const b = replay(chess, { players: 2, actions: moves });
  assert.deepEqual(a, b);
  assert.deepEqual(a, playSeq(moves));
  assert.equal(chess.view(a, null).moves.map((m) => m.san).join(' '), 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O');
});

test('view 与 evalSpec：无隐藏信息，各座位视角一致', () => {
  const s = playSeq(['e2e4', 'f7f6', 'd2d4', 'g7g5', 'd1h5']);
  const v = chess.view(s, null);
  assert.deepEqual(chess.view(s, 'w'), v);
  assert.deepEqual(chess.view(s, 'b'), v);
  assert.equal(v.inCheck, true);
  assert.equal(v.side, 'b');
  assert.equal(v.lastMove, 'd1h5');
  assert.deepEqual(v.moves.at(-1), { uci: 'd1h5', san: 'Qh5#', side: 'w', check: true });
  const e = chess.evalSpec(playSeq(['e2e4']));
  assert.deepEqual(e, { engine: 'stockfish', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', persp: 'b' });
  assert.deepEqual(chess.features, { draw: true, hidden: false, winbar: true, evalEngine: 'stockfish' });
  assert.deepEqual(chess.rankedSeries, { legs: 2, sameSeed: false });
});

test('提示词：文字棋盘、FEN、最近着法、按棋子分组的合法着法', () => {
  const s = playSeq(['e2e4', 'e7e5', 'g1f3']);
  const sys = chess.systemPrompt('b', { style: '稳健', showLegal: true });
  assert.match(sys, /执黑方/);
  assert.match(sys, /着法：UCI/);
  assert.match(sys, /稳健/);
  const t = chess.turnPrompt(s, 'b', { showLegal: true });
  assert.match(t, /对方上一步：Nf3（g1f3）/);
  assert.match(t, /8 {2}r n b q k b n r 8/);
  assert.match(t, /1 {2}R N B Q K B . R 1/);
  assert.match(t, /FEN：rnbqkbnr\/pppp1ppp\/8\/4p3\/4P3\/5N2\/PPPP1PPP\/RNBQKB1R b KQkq - 1 2/);
  assert.match(t, /最近的着法：1\. e4 e5 2\. Nf3/);
  assert.match(t, /马：.*Nc6 b8c6/);
  assert.match(t, /兵：/);
  assert.doesNotMatch(chess.turnPrompt(s, 'b', { showLegal: false }), /你可以走的着法/);
  // 从黑方先走的 FEN 开始时回合号正确
  const fb = playSeq(['e7e5', 'g1f3'], 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  assert.match(chess.turnPrompt(fb, 'b'), /最近的着法：1\.\.\. e5 2\. Nf3/);
});

test('解析模型回答：UCI、SAN、全角、易位、升变缺省、各种错误', () => {
  const s = chess.create();
  const P = (text, st = s) => chess.parseReply(st, st.pos.side, text);
  const full = '判断：均势。\n威胁：无\n理由：抢中心。\n胜率：52%\n着法：e2e4';
  assert.deepEqual(P(full), { action: 'e2e4', attempted: 'e2e4', winrate: 52, error: null });
  assert.equal(P('胜率：50%\n着法：Nf3').action, 'g1f3');
  assert.equal(P('着法： ｅ２ｅ４').action, 'e2e4');
  assert.equal(P('胜率：５０％\n着法：e2-e4').winrate, 50);
  assert.equal(P('着法：**Nc3**').action, 'b1c3');
  assert.equal(P('着法：nf3').action, 'g1f3');
  assert.equal(P('着法：d4（d2d4）').action, 'd2d4');
  assert.equal(P('判断：……\n着法：e4').action, 'e2e4');
  assert.equal(P('我决定走 g1f3').action, 'g1f3', '没有「着法：」时取最后一个坐标');
  const castle = chess.create({ setup: { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' } });
  assert.equal(P('着法：O-O', castle).action, 'e1g1');
  assert.equal(P('着法：0-0-0', castle).action, 'e1c1');
  assert.equal(P('着法：短易位', castle).action, 'e1g1');
  assert.equal(P('着法：e1g1', castle).action, 'e1g1');
  const promo = chess.create({ setup: { fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1' } });
  assert.equal(P('着法：a7a8', promo).action, 'a7a8q', '升变没写棋子默认升后');
  assert.equal(P('着法：a7a8n', promo).action, 'a7a8n');
  assert.equal(P('着法：a8=R', promo).action, 'a7a8r');
  assert.equal(P('着法：a8', promo).action, 'a7a8q');
  // 错误
  assert.match(P('着法：e3e4').error, /没有棋子/);
  assert.match(P('着法：e7e5').error, /对方的棋子/);
  assert.match(P('着法：e2e5').error, /不符合规则/);
  assert.equal(P('着法：e2e5').attempted, 'e2e5');
  assert.match(P('着法：Nf4').error, /不是当前局面的合法着法/);
  assert.match(P('判断：不知道').error, /没有找到着法/);
  assert.match(P('').error, /没有找到着法/);
  const chk = playSeq(['e2e4', 'e7e5', 'd1h5', 'b8c6', 'h5f7']);
  assert.match(P('着法：a7a6', chk).error, /正被将军/);
  // mockReply 能被自己解析回来
  for (const a of ids(s)) assert.equal(P(chess.mockReply(s, 'w', a)).action, a);
});

test('内置 AI：一步杀、吃掉白送的后、单步耗时在 2 秒内', () => {
  const m1 = chess.create({ setup: { fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4' } });
  for (const level of [1, 2, 3, 4]) assert.equal(chess.builtinMove(m1, 'w', { level }), 'h5f7');
  const br = chess.create({ setup: { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1' } });
  assert.equal(chess.builtinMove(br, 'w', { level: 2 }), 'd1d8');
  const hang = chess.create({ setup: { fen: 'rnb1kbnr/pppp1ppp/8/4p1q1/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - 0 3' } });
  assert.equal(chess.builtinMove(hang, 'w', { level: 2 }), 'c1g5');
  // 车底线杀
  const m2 = chess.create({ setup: { fen: '6k1/8/6K1/8/8/8/8/R7 w - - 0 1' } });
  assert.equal(chess.builtinMove(m2, 'w', { level: 3 }), 'a1a8');
  for (const fen of [R.START_FEN, KIWIPETE, 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R2QKB1R w KQ - 0 8']) {
    const st = chess.create({ setup: { fen } });
    const t0 = Date.now();
    const a = chess.builtinMove(st, 'w', { level: 4 });
    assert.ok(Date.now() - t0 < 2000, `耗时 ${Date.now() - t0}ms`);
    assert.ok(ids(st).includes(a));
  }
  assert.ok(ids(m1).includes(chess.builtinMove(m1, 'w', { random: true })));
  // 占优时不走成三次重复：把某步走后的局面在历史里记两次，AI 就换一步
  const pos = R.parseFen('6k1/8/8/8/8/8/5Q2/6K1 w - - 0 1');
  const first = chooseMove(pos, { depth: 2 });
  assert.ok(first.score > 500);
  const after = R.clonePos(pos);
  R.makeMove(after, first.move);
  const key = R.posKey(after);
  const second = chooseMove(pos, { depth: 2, history: [key, key] });
  assert.notEqual(R.moveToUci(second.move), R.moveToUci(first.move));
});
