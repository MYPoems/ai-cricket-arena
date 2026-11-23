import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../games/doudizhu/index.js';
import { replay } from '../games/index.js';
import { classify, beats, deal, parseCards, cardsId, fullDeck, allCombos, showOrder, RANKS, FX } from '../games/doudizhu/rules.js';

// 自定义发牌并跳过叫分：hands 为 { p1: '3 3 …' }，地主先出
const make = (hands, { landlord = 'p1', bid = 1, bottom = '' } = {}) => game.create({ seed: 1, setup: { hands, landlord, bid, bottom } });
const play = (s, ...moves) => moves.reduce((st, m) => game.apply(st, st.turn, m), s);
const ids = (s, seat = s.turn) => game.actions(s, seat).map((a) => a.id);
const kind = (txt) => classify(parseCards(txt).cards)?.type ?? null;

test('座位与基本参数', () => {
  assert.deepEqual(game.seats(3), ['p1', 'p2', 'p3']);
  assert.equal(game.seatName('p2'), '2 号位');
  assert.deepEqual(game.players, { min: 3, max: 3, default: 3 });
  assert.equal(game.noun, '出牌');
  assert.deepEqual(game.features, { hidden: true, winbar: false, draw: false });
  assert.deepEqual(game.rankedSeries, { legs: 3, sameSeed: true });
});

test('带种子发牌可重现：每人 17 张、底牌 3 张，正好一副牌', () => {
  const a = game.create({ players: 3, seed: 42 });
  const b = game.create({ players: 3, seed: 42 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(game.create({ seed: 43 }).hands, a.hands);
  for (const s of ['p1', 'p2', 'p3']) assert.equal(a.hands[s].length, 17);
  assert.equal(a.bottom.length, 3);
  const all = [...a.hands.p1, ...a.hands.p2, ...a.hands.p3, ...a.bottom].sort((x, y) => x - y);
  assert.deepEqual(all, fullDeck());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'state 能 JSON 序列化');
  // 首叫位只由种子决定
  assert.equal(a.first, b.first);
  const firsts = new Set(Array.from({ length: 30 }, (_, i) => game.create({ seed: i }).first));
  assert.equal(firsts.size, 3);
});

test('叫分：必须比当前高，叫 3 分立即当地主，拿走底牌并先出', () => {
  let s = game.create({ seed: 5 });
  const f = s.first;
  assert.deepEqual(game.pending(s), [f]);
  assert.deepEqual(ids(s), ['叫0', '叫1', '叫2', '叫3']);
  s = game.apply(s, f, '叫2');
  const n = s.turn;
  assert.deepEqual(ids(s), ['叫0', '叫3']);
  assert.throws(() => game.apply(s, n, '叫1'), /必须叫比 2 高/);
  assert.throws(() => game.apply(s, f, '叫3'), /不是/);
  const before = s.hands[n].length;
  s = game.apply(s, n, '叫3');
  assert.equal(s.landlord, n);
  assert.equal(s.bid, 3);
  assert.equal(s.phase, 'play');
  assert.equal(s.hands[n].length, before + 3);
  assert.deepEqual(game.pending(s), [n]);
  assert.deepEqual(game.view(s, null).roles[n], '地主');
});

test('叫分：一圈后最高者当地主', () => {
  let s = game.create({ seed: 9 });
  const order = [s.first];
  s = game.apply(s, s.turn, '叫1');
  order.push(s.turn);
  s = game.apply(s, s.turn, '叫2');
  order.push(s.turn);
  s = game.apply(s, s.turn, '叫0');
  assert.equal(new Set(order).size, 3);
  assert.equal(s.landlord, order[1]);
  assert.equal(s.bid, 2);
});

test('三家都不叫：用 seed+1 重发，最多重发 5 次，之后首叫位当 1 分地主', () => {
  const seed = 100;
  let s = game.create({ seed });
  const first = s.first;
  for (let k = 1; k <= 5; k++) {
    s = play(s, '叫0', '叫0', '叫0');
    assert.equal(s.deals, k);
    assert.equal(s.phase, 'bid');
    assert.equal(s.turn, first);
    const d = deal(seed + k);
    assert.deepEqual(s.hands.p1, d.hands[0], `第 ${k} 次重发用 seed+${k}`);
    assert.deepEqual(s.bottom, d.bottom);
  }
  s = play(s, '叫0', '叫0', '叫0');
  assert.equal(s.deals, 5);
  assert.equal(s.landlord, first);
  assert.equal(s.bid, 1);
  assert.equal(s.hands[first].length, 20);
  // 重放得到同一局面
  const actions = Array.from({ length: 18 }, (_, i) => ({ seat: ['p1', 'p2', 'p3'][(['p1', 'p2', 'p3'].indexOf(first) + i) % 3], action: '叫0' }));
  assert.deepEqual(replay(game, { seed, players: 3, actions }), s);
});

test('牌型识别', () => {
  assert.equal(kind('3'), 'single');
  assert.equal(kind('2 2'), 'pair');
  assert.equal(kind('小王 小王'), null);
  assert.equal(kind('7 7 7'), 'triple');
  assert.equal(kind('3 3 3 小王'), 'triple1');
  assert.equal(kind('3 3 3 4 4'), 'triple2');
  assert.equal(kind('3 3 3 小王 大王'), null, '三带二不能带王');
  assert.equal(kind('3 4 5 6 7'), 'straight');
  assert.equal(kind('3 4 5 6'), null);
  assert.equal(kind('10 J Q K A'), 'straight');
  assert.equal(kind('J Q K A 2'), null, '顺子不含 2');
  assert.equal(kind('3 3 4 4 5 5'), 'pairs');
  assert.equal(kind('3 3 4 4'), null);
  assert.equal(kind('K K A A 2 2'), null);
  assert.equal(kind('3 3 3 4 4 4'), 'plane');
  assert.equal(kind('K K K A A A 3 4'), 'plane1');
  assert.equal(kind('K K K A A A 3 3'), 'plane1', '翅膀可以是同点数的两张单牌');
  assert.equal(kind('3 3 3 4 4 4 5 5 6 6'), 'plane2');
  assert.equal(kind('A A A 2 2 2 3 4'), null, '飞机不含 2');
  assert.equal(kind('3 3 3 4 4 4 4 5'), null, '翅膀不能和飞机主体同点数');
  assert.equal(kind('3 3 3 4 4 4 小王 大王'), null, '翅膀不能是一对王');
  assert.equal(kind('5 5 5 5 3 4'), 'four2');
  assert.equal(kind('5 5 5 5 3 3 4 4'), 'four4');
  assert.equal(kind('5 5 5 5'), 'bomb');
  assert.equal(kind('小王 大王'), 'rocket');
  assert.equal(kind('3 3 3 4 4 4 5 5 5 6 6 6'), 'plane', '多种解释时优先当作纯飞机');
});

test('比较大小：同牌型同张数比主体，炸弹压非炸弹，王炸最大', () => {
  const c = (t) => classify(parseCards(t).cards);
  assert.ok(beats(c('4'), c('3')));
  assert.ok(!beats(c('3'), c('3')));
  assert.ok(!beats(c('4 4'), c('3')));
  assert.ok(beats(c('4 4 4 3'), c('3 3 3 A')), '三带一只比三张');
  assert.ok(!beats(c('4 5 6 7 8 9'), c('3 4 5 6 7')), '顺子张数不同不能压');
  assert.ok(beats(c('4 5 6 7 8'), c('3 4 5 6 7')));
  assert.ok(beats(c('3 3 3 3'), c('小王')));
  assert.ok(beats(c('3 3 3 3'), c('10 J Q K A')));
  assert.ok(beats(c('4 4 4 4'), c('3 3 3 3')));
  assert.ok(!beats(c('3 3 3 3'), c('4 4 4 4')));
  assert.ok(beats(c('小王 大王'), c('2 2 2 2')));
  assert.ok(!beats(c('2 2 2 2'), c('小王 大王')));
  assert.ok(beats(c('2 2 2 2'), c('3 3 3 3 4 5')), '炸弹压四带二');
  assert.ok(!beats(c('4 4 4 4 3 5'), c('3 3 3 3')), '四带二不是炸弹');
});

test('出牌轮次：领出不能不出；两家都不出时最后出牌者重新领出', () => {
  let s = make({ p1: '3 4 4 9 K', p2: '5 6 Q', p3: '7 8 A' });
  assert.ok(!ids(s).includes('不出'));
  assert.ok(ids(s).includes('4 4'));
  assert.throws(() => game.apply(s, 'p1', '不出'), /领出时不能不出/);
  assert.throws(() => game.apply(s, 'p1', '5'), /没有/);
  assert.throws(() => game.apply(s, 'p1', '3 4'), /不是合法牌型/);
  s = game.apply(s, 'p1', '3');
  assert.deepEqual(ids(s, 'p2'), ['5', '6', 'Q', '不出']);
  assert.deepEqual(game.actions(s, 'p3'), [], '没轮到的座位没有行动');
  const before = JSON.stringify(s);
  s = play(s, 'Q');
  assert.notEqual(JSON.stringify(s), before);
  assert.throws(() => game.apply(s, 'p3', '8'), /压不过/);
  s = play(s, 'A', '不出', '不出');
  assert.equal(s.turn, 'p3');
  assert.equal(s.trick.last, null);
  assert.equal(s.trick.n, 2);
  assert.ok(!ids(s).includes('不出'));
  // 跟牌：同牌型同张数更大，或炸弹
  let t = make({ p1: '3 3 9', p2: '4 4 6 6 6 6', p3: '5' });
  t = play(t, '3 3');
  assert.deepEqual(ids(t).sort(), ['4 4', '6 6', '6 6 6 6', '不出'].sort());
});

test('apply 不修改原 state', () => {
  const s = make({ p1: '3 4 5', p2: '6 7', p3: '8 9' });
  const snap = JSON.stringify(s);
  game.apply(s, 'p1', '3');
  assert.equal(JSON.stringify(s), snap);
});

test('计分：春天、炸弹翻倍、名次', () => {
  let s = make({ p1: '3 3 3 3 5', p2: '6 7 8 9 10 J Q', p3: '4 4 K' }, { bid: 3 });
  s = play(s, '3 3 3 3', '不出', '不出', '5');
  const o = game.outcome(s);
  assert.equal(o.over, true);
  assert.equal(o.winner, 'p1');
  assert.deepEqual(o.ranks, { p1: 1, p2: 2, p3: 2 });
  assert.equal(o.score, 12);
  assert.equal(o.reason, '地主出完牌获胜（叫 3 分，炸弹 ×2，春天 ×2，共 12 分）');
  assert.deepEqual(game.pending(s), []);
  assert.throws(() => game.apply(s, 'p2', '6'), /已经结束/);

  // 农民出过牌：不算春天
  let t = make({ p1: '3 5 5 2', p2: '4 9', p3: 'Q K' }, { bid: 2 });
  t = play(t, '3', '4', '不出', '2', '不出', '不出', '5 5');
  assert.deepEqual(game.outcome(t).ranks, { p1: 1, p2: 2, p3: 2 });
  assert.equal(game.outcome(t).reason, '地主出完牌获胜（叫 2 分，共 2 分）');
});

test('计分：反春（地主只出了第一手），农民一方同为第一名', () => {
  let s = make({ p1: '3 5 7', p2: '2', p3: 'K K' }, { bid: 1 });
  s = play(s, '3', '2');
  const o = game.outcome(s);
  assert.deepEqual(o.ranks, { p1: 2, p2: 1, p3: 1 });
  assert.equal(o.winner, 'p2');
  assert.equal(o.reason, '农民（2 号位）出完牌获胜（叫 1 分，反春 ×2，共 2 分）');
  // 两个炸弹
  let t = make({ p1: '3 3 3 3 6', p2: '4 4 4 4 9', p3: '8' }, { bid: 2 });
  t = play(t, '3 3 3 3', '4 4 4 4', '不出', '不出', '9');
  assert.equal(game.outcome(t).reason, '农民（2 号位）出完牌获胜（叫 2 分，炸弹 2 个 ×4，反春 ×2，共 16 分）');
});

test('认输与犯规：出牌阶段按队判，叫分阶段只判犯规者', () => {
  const s = make({ p1: '3', p2: '4', p3: '5' });
  assert.deepEqual(game.forfeit(s, 'p2', 'x').ranks, { p1: 1, p2: 2, p3: 2 });
  assert.deepEqual(game.forfeit(s, 'p1', 'x').ranks, { p1: 2, p2: 1, p3: 1 });
  const b = game.create({ seed: 3 });
  assert.deepEqual(game.forfeit(b, 'p3', 'x').ranks, { p1: 1, p2: 1, p3: 2 });
});

test('解析模型回答：叫分', () => {
  let s = game.create({ seed: 7 });
  const f = s.first;
  const r = game.parseReply(s, f, '判断：牌不错\n推断：无\n理由：有王\n胜率：60%\n叫分：3');
  assert.deepEqual(r, { action: '叫3', attempted: '叫3', winrate: 60, error: null });
  assert.equal(game.parseReply(s, f, '叫分：不叫').action, '叫0');
  assert.equal(game.parseReply(s, f, '叫分：２分').action, '叫2');
  assert.equal(game.parseReply(s, f, '叫分 ： 二').action, '叫2');
  assert.equal(game.parseReply(s, f, '我决定叫 1 分').action, '叫1');
  assert.match(game.parseReply(s, f, '出牌：3').error, /叫分阶段/);
  assert.match(game.parseReply(s, f, '嗯').error, /没有找到叫分/);
  s = game.apply(s, f, '叫2');
  const r2 = game.parseReply(s, s.turn, '叫分：1');
  assert.equal(r2.action, null);
  assert.match(r2.error, /最高已经是 2 分/);
});

test('解析模型回答：出牌', () => {
  let s = make({ p1: '3 3 5 10 J Q K A 小王 大王', p2: '4 4 6 2', p3: '7 7 8' });
  const p = (txt, seat = s.turn) => game.parseReply(s, seat, txt);
  assert.deepEqual(p('判断：好\n推断：无\n理由：走小对\n胜率：55%\n出牌：3 3'), { action: '3 3', attempted: '3 3', winrate: 55, error: null });
  assert.equal(p('出牌：33').action, '3 3');
  assert.equal(p('出牌：ＪＱＫＡ１０').action, '10 J Q K A');
  assert.equal(p('出牌: a k q j 10').action, '10 J Q K A');
  assert.equal(p('出牌：王炸').action, '小王 大王');
  assert.equal(p('出牌：三 三').action, '3 3');
  assert.equal(p('出牌：3 3（一对三）').action, '3 3');
  assert.match(p('出牌：不出').error, /不能不出/);
  assert.match(p('出牌：2 2').error, /没有这些牌/);
  assert.match(p('出牌：3 5').error, /不是合法牌型/);
  assert.match(p('出牌：一对3').error, /无法识别/);
  assert.match(p('我出 3').error, /没有找到出牌/);
  s = game.apply(s, 'p1', '3 3');
  assert.equal(p('出牌：不要').action, '不出');
  assert.equal(p('出牌：4 4').action, '4 4');
  const bad = p('出牌：6');
  assert.equal(bad.action, null);
  assert.equal(bad.attempted, '6');
  assert.match(bad.error, /压不过1 号位的对子 3 3/);
});

test('mockReply 写出的回答能被解析回同一行动', () => {
  let s = game.create({ seed: 21 });
  for (let i = 0; i < 40 && !game.outcome(s).over; i++) {
    const seat = s.turn;
    for (const a of game.actions(s, seat).slice(0, 5)) {
      assert.equal(game.parseReply(s, seat, game.mockReply(s, seat, a.id)).action, a.id);
    }
    s = game.apply(s, seat, game.builtinMove(s, seat));
  }
});

test('隐藏信息：玩家视角只看到自己的手牌，叫分时看不到底牌；观众是上帝视角', () => {
  let s = game.create({ seed: 8 });
  const v1 = game.view(s, 'p1');
  assert.ok(Array.isArray(v1.hands.p1));
  assert.equal(v1.hands.p2, null);
  assert.equal(v1.hands.p3, null);
  assert.deepEqual(v1.counts, { p1: 17, p2: 17, p3: 17 });
  assert.equal(v1.bottom, null);
  const god = game.view(s, null);
  assert.ok(god.hands.p1 && god.hands.p2 && god.hands.p3);
  assert.equal(god.bottom.length, 3);
  assert.deepEqual(god.roles, {});
  s = play(s, '叫3');
  const l = s.landlord;
  const other = ['p1', 'p2', 'p3'].find((x) => x !== l);
  const v = game.view(s, other);
  assert.equal(v.bottom.length, 3, '地主确定后底牌公开');
  assert.equal(v.hands[l], null);
  assert.equal(v.counts[l], 20);
  assert.equal(v.roles[l], '地主');
  assert.equal(v.roles[other], '农民');
  // 对局结束后亮出所有手牌
  const e = play(make({ p1: '3', p2: '4 5', p3: '6 7' }), '3');
  assert.ok(game.view(e, 'p2').hands.p3);
  assert.equal(game.view(e, 'p2').result.landlordWins, true);
});

test('视图：本轮各家最近一次出牌；新一轮还没出牌时淡显上一轮', () => {
  let s = make({ p1: '3 4 9', p2: '5 6', p3: '7 8' });
  s = play(s, '3', '5', '不出');
  let v = game.view(s, null);
  assert.deepEqual(v.table.p1.cards, ['3']);
  assert.deepEqual(v.table.p2.cards, ['5']);
  assert.equal(v.table.p3.pass, true);
  assert.equal(v.stale, false);
  s = play(s, '不出');
  v = game.view(s, null);
  assert.equal(v.turn, 'p2');
  assert.equal(v.stale, true);
  assert.equal(v.table.p1.pass, true);
});

test('内置 AI：叫分看王、2 和炸弹', () => {
  const strong = make({ p1: '小王 大王 2 2 3 3 3 3 5 6 7 8 9 J Q K A', p2: '4', p3: '4' });
  const weak = make({ p1: '3 4 5 6 7 8 9 10 J J Q Q K 4 5 6 8', p2: '9', p3: '9' });
  const bidState = (h) => ({ ...game.create({ seed: 1 }), hands: { p1: h.hands.p1, p2: h.hands.p2, p3: h.hands.p3 }, turn: 'p1' });
  assert.equal(game.builtinMove(bidState(strong), 'p1'), '叫3');
  assert.equal(game.builtinMove(bidState(weak), 'p1'), '叫0');
});

test('内置 AI：能一手出完就出完；领出优先出顺子、连对，不拆炸弹', () => {
  assert.equal(game.builtinMove(make({ p1: '3 4 5 6 7 8', p2: '9', p3: '9' }), 'p1'), '3 4 5 6 7 8');
  assert.equal(game.builtinMove(make({ p1: '3 3 3 4', p2: '9', p3: '9' }), 'p1'), '3 3 3 4');
  const lead = game.builtinMove(make({ p1: '3 4 5 6 7 9 9 K', p2: '2 2 2', p3: '10 10' }), 'p1');
  assert.equal(lead, '3 4 5 6 7');
  const bomb = game.builtinMove(make({ p1: '5 5 5 5 8 8 J', p2: '2 2 2', p3: '10 10' }), 'p1');
  assert.ok(!/5/.test(bomb) || bomb === '5 5 5 5', `不拆炸弹：${bomb}`);
});

test('内置 AI：跟牌用最小的能压过的牌，不拆炸弹，农民不压队友', () => {
  // 地主出 4，农民 p2 有 6 8 2 和炸弹 9：出 6
  let s = make({ p1: '4 A A K Q', p2: '6 8 2 9 9 9 9 3 3 3 J', p3: '5 7 10 10 J Q' });
  s = play(s, '4');
  assert.equal(game.builtinMove(s, 'p2'), '6');
  // 只能用炸弹压，对手还有很多牌：不出
  let t = make({ p1: '2 3 4 5 6 7 8 10 J Q', p2: '9 9 9 9 3 4 5 6 7 8 J Q', p3: 'K K' });
  t = play(t, '2');
  assert.equal(game.builtinMove(t, 'p2'), '不出');
  // 对手只剩一张：炸
  let u = make({ p1: '2 3', p2: '9 9 9 9 3 4 5', p3: 'K K' });
  u = play(u, '2');
  assert.equal(game.builtinMove(u, 'p2'), '9 9 9 9');
  // 队友压住了地主：不再压队友
  let v = make({ p1: '3 4 5 6 7 10 J', p2: '8 8 9', p3: 'K K A A 2' }, { landlord: 'p1' });
  v = play(v, '3', '8');
  assert.equal(v.turn, 'p3');
  assert.equal(game.builtinMove(v, 'p3'), '不出');
});

test('内置 AI：所有座位跑完多局，不抛错、能结束、可重放', () => {
  for (let seed = 0; seed < 12; seed++) {
    let s = game.create({ players: 3, seed });
    const actions = [];
    let n = 0;
    while (!game.outcome(s).over) {
      const [seat] = game.pending(s);
      const a = game.builtinMove(s, seat, { level: seed % 2 ? 1 : 2 });
      assert.ok(game.actions(s, seat).some((x) => x.id === a), `合法：${a}`);
      actions.push({ seat, action: a });
      s = game.apply(s, seat, a);
      assert.ok(++n < 400);
    }
    const o = game.outcome(s);
    assert.match(o.reason, /出完牌获胜/);
    assert.deepEqual(replay(game, { seed, players: 3, actions }), s);
  }
});

test('提示词：叫分与出牌阶段的内容和格式', () => {
  const sys = game.systemPrompt('p2', { style: '激进' });
  assert.match(sys, /2 号位/);
  assert.match(sys, /叫分：0/);
  assert.match(sys, /出牌：不出/);
  assert.match(sys, /推断/);
  assert.match(sys, /激进/);
  let s = game.create({ seed: 4 });
  assert.match(game.turnPrompt(s, s.turn), /叫分阶段[\s\S]*你的手牌（17 张）/);
  s = play(s, '叫3');
  const l = s.landlord;
  s = game.apply(s, l, game.builtinMove(s, l));
  const t = game.turnPrompt(s, s.turn, { showLegal: true });
  assert.match(t, /身份：农民/);
  assert.match(t, /底牌（公开）/);
  assert.match(t, /本轮要压过的牌/);
  assert.match(t, /合法出牌/);
  assert.match(t, /不出：不出/);
  assert.match(t, /出牌记录/);
  assert.ok(!game.turnPrompt(s, s.turn).includes('合法出牌'));
  // 合法组合太多时只列一部分
  const many = make({ p1: '3 3 3 4 4 4 5 5 5 6 6 6 7 8 9 10 J Q K A', p2: '2', p3: '2' });
  assert.ok(game.actions(many, 'p1').length > 300);
  assert.match(game.turnPrompt(many, 'p1', { showLegal: true }), /还有其他合法组合/);
});

test('牌面文字解析与 id 规范', () => {
  assert.deepEqual(parseCards('10 J Q K A').cards, [7, 8, 9, 10, 11]);
  assert.equal(cardsId(parseCards('A K Q J 10').cards), '10 J Q K A');
  assert.equal(cardsId(parseCards('大王，小王').cards), '小王 大王');
  assert.match(parseCards('1 0').error, /无法识别/);
  assert.ok(allCombos(parseCards('3 3 4 4 5 5').cards).some((c) => c.type === 'pairs'));
});

test('摆牌顺序：主体在前、带的牌在后，各部分从大到小', () => {
  const order = (txt) => {
    const k = classify(parseCards(txt).cards);
    return showOrder(k.cards, k.type).map((r) => RANKS[r]).join(' ');
  };
  assert.equal(order('3 K K K'), 'K K K 3');
  assert.equal(order('3 3 K K K'), 'K K K 3 3');
  assert.equal(order('3 4 K K K A A A'), 'A A A K K K 4 3');
  assert.equal(order('3 3 4 4 5 5 5 6 6 6'), '6 6 6 5 5 5 4 4 3 3');
  assert.equal(order('3 3 3 4 4 4 5 5 5 6 6 6'), '6 6 6 5 5 5 4 4 4 3 3 3', '纯飞机');
  assert.equal(order('3 5 9 9 9 9'), '9 9 9 9 5 3');
  assert.equal(order('3 3 3 3 5 5 5 5'), '5 5 5 5 3 3 3 3', '四带两对：按大的四张算主体');
  assert.equal(order('3 4 5 6 7'), '7 6 5 4 3');
  assert.equal(order('小王 大王'), '大王 小王');
  // 带的三张和机身不连：机身是连着的那几组
  assert.equal(showOrder(parseCards('3 3 3 4 4 4 5 5 5 9 9 9').cards, 'plane1').map((r) => RANKS[r]).join(' '), '5 5 5 4 4 4 3 3 3 9 9 9');
});

test('视图：出牌按摆牌顺序（本轮各家、桌心、本局记录）', () => {
  let s = make({ p1: '3 4 K K K Q', p2: 'A A', p3: '2' }, { bid: 2 });
  s = game.apply(s, 'p1', '3 K K K');
  const v = game.view(s, null);
  assert.deepEqual(v.lead.cards, ['K', 'K', 'K', '3']);
  assert.deepEqual(v.table.p1.cards, ['K', 'K', 'K', '3']);
  assert.deepEqual(v.plays[0].cards, ['K', 'K', 'K', '3']);
});

test('结算：地主得失是每家农民的两倍', () => {
  let s = make({ p1: '3 3 3 3 5', p2: '6 7', p3: '4 4 K' }, { bid: 3 });
  s = play(s, '3 3 3 3', '不出', '不出', '5');
  const r = game.view(s, 'p2').result;
  assert.equal(r.score, 12);
  assert.equal(r.bid, 3);
  assert.equal(r.bombs, 1);
  assert.deepEqual(r.scores, { p1: 24, p2: -12, p3: -12 });
  let t = make({ p1: '3 5 7', p2: '2', p3: 'K K' }, { bid: 1 });
  t = play(t, '3', '2');
  assert.deepEqual(game.view(t, null).result.scores, { p1: -4, p2: 2, p3: 2 });
});

test('特效停顿：定地主、飞机、王炸、炸弹、春天要等画面演完，普通出牌按 turnPause', () => {
  const { fly, handover, plane, rocket, bomb, banner, bannerDelay, card } = FX;
  let s = game.create({ seed: 5 });
  assert.equal(game.interlude(null, s), 0);
  const b = game.apply(s, s.turn, '叫3');
  assert.ok(game.interlude(s, b) >= handover, '底牌交接');
  let p = make({ p1: '3 3 3 4 4 4 5 6 7 8 9 10 J 小王 大王 Q', p2: '9 9', p3: '2 2' });
  const p1 = game.apply(p, 'p1', '3 3 3 4 4 4 5 6');
  assert.equal(game.interlude(p, p1), Math.max(game.turnPause, fly + plane + 300), '飞机');
  const p2 = game.apply(p1, 'p2', '不出');
  assert.equal(game.interlude(p1, p2), 0, '不出：按 turnPause');
  const p3 = play(p2, '不出', '小王 大王');
  assert.equal(game.interlude(play(p2, '不出'), p3), Math.max(game.turnPause, fly + rocket + 600), '王炸');
  const q = make({ p1: '3 3 3 3 5', p2: '6 7', p3: '4 4 K' }, { bid: 3 });
  const q1 = game.apply(q, 'p1', '3 3 3 3');
  assert.equal(game.interlude(q, q1), Math.max(game.turnPause, 300 + bomb + 300), '炸弹');
  const q2 = play(q1, '不出', '不出');
  const q3 = game.apply(q2, 'p1', '5');
  assert.equal(game.interlude(q2, q3), bannerDelay + banner + card + 300, '春天横幅');
  const r = game.apply(make({ p1: '3 4', p2: '5', p3: '6' }), 'p1', '3');
  assert.equal(game.interlude(make({ p1: '3 4', p2: '5', p3: '6' }), r), 0, '普通单张');
});
