// 天梯扩展统计：不确定性、阵营战绩（含旧记录重放）、对位热力图、出手统计、活跃度。

import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { getGame } from '../games/index.js';
import { applyResult, sigmaLine, uncertainty, PLACEMENT_GAMES } from '../server/ladder/rating.js';
import { ladderBoard, pairOutcome, seatSides, playStats, ladderRoutes } from '../server/ladder/stats.js';

const db = openDb(':memory:');
const NOW = Date.parse('2026-11-23T12:00:00Z');
const ago = (days) => new Date(NOW - days * 864e5).toISOString();

function addChar(id, extra = {}) {
  db.insert('characters', { id, owner_id: 'local', name: id, avatar: '🦗', kind: 'model', provider: 'mock', model: id, style: '', created_at: ago(30), ...extra });
}

let seq = 0;
/** 写一盘已结束的排位赛并结算积分；turns 为 [[座位, 用时 ms, token, 是否犯规], …] */
function addMatch(game, seats, result, { at = ago(1), turns = [], mode = 'ranked', setup = null, actions = [] } = {}) {
  const id = `m_${++seq}`;
  db.insert('matches', { id, game, mode, status: 'finished', options: {}, seats, actions, result, setup, created_at: at, finished_at: at });
  turns.forEach(([seat, ms, tok, bad], i) => db.insert('turns', {
    match_id: id, ply: i + 1, seat, character_id: seats[seat], action: 'x', latency_ms: ms,
    usage: { input: tok, output: 0 }, attempts: bad ? [{ text: '乱走', error: '不合法' }] : [], created_at: at,
  }));
  if (mode !== 'casual') applyResult(db, game, id, seats, result.ranks);
  return id;
}

const duel = (a, b, winner) => ({ winner, ranks: winner === 'r' ? { r: 1, b: 2 } : winner === 'b' ? { r: 2, b: 1 } : { r: 1, b: 1 }, reason: '测试' });

for (const id of ['A', 'B', 'C', 'D']) addChar(id);
addChar('A2', { model: 'A' }); // 和 A 同一个模型的另一只蛐蛐（模型榜合并）
addChar('S', { style: '激进' }); // 有风格提示词，不进模型榜

test('σ 定级线：人越多 σ 降得越慢；新人、下满但 σ 仍大的都算「定级中」', () => {
  assert.ok(sigmaLine(2) < sigmaLine(3) && sigmaLine(3) < sigmaLine(8));
  assert.ok(sigmaLine(2) > 6.5 && sigmaLine(2) < 8);
  const fresh = uncertainty({ mu: 25, sigma: 25 / 3, played: 0 });
  assert.deepEqual(fresh, { mid: 2000, pm: 333, unsure: true, placing: true });
  assert.equal(uncertainty({ mu: 26, sigma: 7.9, played: PLACEMENT_GAMES }).unsure, true);
  assert.equal(uncertainty({ mu: 26, sigma: 5, played: 12 }).unsure, false);
  assert.equal(uncertainty({ mu: 26, sigma: 8, played: 12 }, 8).unsure, false); // 8 人局的线更高
});

test('对位结果：比名次，同队不算交手', () => {
  assert.equal(pairOutcome({ ranks: { a: 1, b: 2 } }, 'a', 'b'), 'w');
  assert.equal(pairOutcome({ ranks: { a: 3, b: 2 } }, 'a', 'b'), 'l');
  assert.equal(pairOutcome({ ranks: { a: 1, b: 1 } }, 'a', 'b'), 'd');
  assert.equal(pairOutcome({ ranks: { a: 1, b: 1, c: 2 }, teams: { 农民: ['a', 'b'], 地主: ['c'] } }, 'a', 'b'), null);
  assert.equal(pairOutcome({ winner: 'b' }, 'a', 'b'), 'l');
});

test('象棋：对位热力图、出手统计、活跃度', () => {
  // A 对 B 4 胜 1 负；A 对 C 1 和；D 只下过很久以前的一盘
  for (let i = 0; i < 4; i++) addMatch('xiangqi', { r: 'A', b: 'B' }, duel('A', 'B', 'r'), { turns: [['r', 1000, 500, false], ['b', 3000, 700, true]] });
  addMatch('xiangqi', { r: 'B', b: 'A' }, duel('B', 'A', 'r'), { turns: [['r', 2000, 900, false], ['b', 2000, 100, false]] });
  addMatch('xiangqi', { r: 'A', b: 'C' }, duel('A', 'C', null));
  addMatch('xiangqi', { r: 'D', b: 'C' }, duel('D', 'C', 'r'), { at: ago(40) });
  addMatch('xiangqi', { r: 'D', b: 'B' }, duel('D', 'B', 'r'), { mode: 'casual' }); // 娱乐赛不算

  const board = ladderBoard(db, 'xiangqi', 'characters', { now: NOW });
  const row = (k) => board.rows.find((r) => r.key === k);
  assert.equal(board.sides, null);
  // 对位：行方视角
  assert.deepEqual(pick(board.heat.cells.A.B), { w: 4, d: 0, l: 1 });
  assert.deepEqual(pick(board.heat.cells.B.A), { w: 1, d: 0, l: 4 });
  assert.deepEqual(pick(board.heat.cells.A.C), { w: 0, d: 1, l: 0 });
  assert.equal(board.heat.cells.B?.C, undefined); // 没交过手
  assert.equal(board.heat.cells.A.B.games.length, 5);
  assert.equal(board.heat.cells.A.B.games[0].o, 'l'); // 最近一盘在前
  // 出手统计：A 走了 5 步（4 × 1000ms + 2000ms），token 4 × 500 + 100 = 2100，分在 6 盘里有步数的 5 盘
  const a = row('A').stats;
  assert.equal(a.moves, 5);
  assert.equal(a.avgMoveMs, 1200);
  assert.equal(a.avgTokens, 420);
  assert.equal(a.invalidRate, 0);
  const b = row('B').stats;
  assert.equal(b.invalidRate, 4 / 5);
  assert.equal(b.avgMoveMs, 2800);
  assert.equal(row('C').stats.avgMoveMs, null);
  // 活跃度：最近 14 天的排位局数
  assert.equal(a.recent, 6);
  assert.equal(row('D').stats.recent, 0);
  assert.equal(row('D').played, 1); // 娱乐赛没有结算
  // 不确定性跟着积分走
  assert.equal(row('A').unc.mid, Math.round(1000 + 40 * row('A').mu));
  assert.equal(row('A').unc.pm, Math.round(40 * row('A').sigma));
  assert.equal(row('A').points, Math.round(1000 + 40 * (row('A').mu - 3 * row('A').sigma)));
});

test('缓存：有新对局结束后重算', () => {
  const before = ladderBoard(db, 'xiangqi', 'characters', { now: NOW }).heat.cells.B?.C;
  assert.equal(before, undefined);
  addMatch('xiangqi', { r: 'B', b: 'C' }, duel('B', 'C', 'r'));
  assert.deepEqual(pick(ladderBoard(db, 'xiangqi', 'characters', { now: NOW }).heat.cells.B.C), { w: 1, d: 0, l: 0 });
});

test('模型榜：同模型的蛐蛐合在一起，有风格提示词的不算', () => {
  addMatch('xiangqi', { r: 'A2', b: 'B' }, duel('A2', 'B', 'r'), { turns: [['r', 4000, 1000, false]] });
  addMatch('xiangqi', { r: 'S', b: 'B' }, duel('S', 'B', 'r'));
  const board = ladderBoard(db, 'xiangqi', 'models', { now: NOW });
  const a = board.rows.find((r) => r.key === 'mock/A');
  assert.ok(a);
  assert.equal(board.rows.some((r) => r.key === 'mock/S'), false);
  assert.deepEqual(pick(board.heat.cells['mock/A']['mock/B']), { w: 5, d: 0, l: 1 });
  assert.equal(a.stats.moves, 6);
  assert.equal(a.stats.avgMoveMs, Math.round((4 * 1000 + 2000 + 4000) / 6));
});

test('狼人杀：按阵营分开统计胜率和阵营分', () => {
  const ids = ['A', 'B', 'C', 'D', 'W1', 'W2', 'W3', 'W4'];
  for (const id of ['W1', 'W2', 'W3', 'W4']) addChar(id);
  const seats = Object.fromEntries(ids.map((id, i) => [`p${i}`, id]));
  // 三盘：A 当狼两次（赢一次输一次），当好人一次（赢）
  const game = (wolves, wolvesWin) => {
    const good = Object.keys(seats).filter((s) => !wolves.includes(s));
    const winners = wolvesWin ? wolves : good;
    return { winner: winners[0], winnerTeam: wolvesWin ? '狼人' : '好人', teams: { 好人: good, 狼人: wolves }, ranks: Object.fromEntries(Object.keys(seats).map((s) => [s, winners.includes(s) ? 1 : 2])), reason: '测试' };
  };
  addMatch('werewolf', seats, game(['p0', 'p1', 'p2'], true));
  addMatch('werewolf', seats, game(['p0', 'p3', 'p4'], false));
  addMatch('werewolf', seats, game(['p5', 'p6', 'p7'], false));
  const board = ladderBoard(db, 'werewolf', 'characters', { now: NOW });
  assert.deepEqual(board.sides, ['狼人', '好人']);
  const a = board.rows.find((r) => r.key === 'A').sides;
  assert.equal(a.狼人.n, 2);
  assert.equal(a.狼人.w, 1);
  assert.equal(a.狼人.rate, 0.5);
  assert.equal(a.好人.n, 1);
  assert.equal(a.好人.rate, 1);
  assert.ok(Number.isFinite(a.狼人.points) && Number.isFinite(a.好人.mid));
  assert.ok(a.好人.mid > 2000); // 当好人赢过，阵营实力高于起点
  // 同队的狼不算交手：A 和 B 第一盘同是狼，第二盘 A 狼 B 好人（好人胜），第三盘同是好人
  assert.deepEqual(pick(board.heat.cells.A.B), { w: 0, d: 0, l: 1 });
});

test('斗地主旧记录没有 teams 时重放认出地主', () => {
  const g = getGame('doudizhu');
  let s = g.create({ players: 3, seed: 42 });
  const actions = [];
  while (!s.landlord) {
    const seat = g.pending(s)[0];
    const a = g.actions(s, seat);
    const pickA = a.find((x) => x.id === '叫3') || a[0];
    actions.push({ seat, action: pickA.id });
    s = g.apply(s, seat, pickA.id);
  }
  const lord = s.landlord;
  const seats = { p1: 'A', p2: 'B', p3: 'C' };
  const ranks = Object.fromEntries(Object.keys(seats).map((x) => [x, x === lord ? 1 : 2]));
  const id = addMatch('doudizhu', seats, { winner: lord, ranks, reason: '旧记录' }, { setup: { seed: 42, players: 3 }, actions });
  const m = db.get('SELECT id, game, seats, result FROM matches WHERE id = ?', id);
  const sides = seatSides(db, m);
  assert.equal(sides[lord], '地主');
  assert.equal(Object.values(sides).filter((x) => x === '农民').length, 2);
  const board = ladderBoard(db, 'doudizhu', 'characters', { now: NOW });
  const lordRow = board.rows.find((r) => r.key === seats[lord]);
  assert.equal(lordRow.sides.地主.w, 1);
  assert.equal(lordRow.sides.农民, null);
  // 两个农民同队，不算交手
  const farmers = Object.keys(seats).filter((x) => x !== lord).map((x) => seats[x]);
  assert.equal(board.heat.cells[farmers[0]]?.[farmers[1]], undefined);
});

test('playStats 没有数据时全为空', () => {
  assert.deepEqual(playStats(undefined, ago(14)), { recent: 0, moves: 0, avgMoveMs: null, avgTokens: null, invalidRate: null });
});

test('路由：GET /api/ladder/board', () => {
  const routes = [];
  ladderRoutes({ get: (p, h) => routes.push([p, h]) }, { db });
  assert.equal(routes[0][0], '/api/ladder/board');
  const out = routes[0][1]({ query: { game: 'xiangqi', view: 'bogus' } });
  assert.equal(out.view, 'characters');
  assert.ok(out.heat.ids.length >= 2 && out.heat.ids.length <= 12);
  assert.throws(() => routes[0][1]({ query: { game: 'nope' } }), /未知游戏/);
});

function pick(c) {
  return { w: c.w, d: c.d, l: c.l };
}
