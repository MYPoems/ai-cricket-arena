import test from 'node:test';
import assert from 'node:assert/strict';
import poker, { seatIdx, parseActionText } from '../games/poker/index.js';
import { evaluate, handName, fromCode, equity, category } from '../games/poker/cards.js';
import { replay } from '../games/index.js';

const cards = (str) => str.trim().split(/\s+/).map((c) => {
  const v = fromCode(c);
  if (v < 0) throw new Error(`坏牌 ${c}`);
  return v;
});

/** 改写当前这手的底牌和后面要发的公共牌（holes 要包含所有在局座位） */
function rig(state, holes, board = '') {
  const s = structuredClone(state);
  const h = s.hand;
  const used = [];
  for (const [seat, cs] of Object.entries(holes)) {
    h.hole[seatIdx(seat)] = cards(cs);
    used.push(...h.hole[seatIdx(seat)]);
  }
  assert.equal(used.length, h.pos, 'rig 需要给出所有在局座位的底牌');
  const b = board ? cards(board) : [];
  const rest = [];
  for (let c = 0; c < 52; c++) if (!used.includes(c) && !b.includes(c)) rest.push(c);
  h.deck = [...used, ...b, ...rest];
  return s;
}

/** 依次执行 [座位, 行动] */
function run(state, steps) {
  let s = state;
  for (const [seat, a] of steps) {
    assert.deepEqual(poker.pending(s), [seat], `应该轮到 ${seat}（准备 ${a}）`);
    s = poker.apply(s, seat, a);
  }
  return s;
}

const make = (players, setup = {}, seed = 1) => poker.create({ players, seed, setup });

// ---------- 牌型 ----------

test('牌型评估：7 选 5、各种牌型的大小', () => {
  const sc = (s) => evaluate(cards(s));
  assert.equal(category(sc('As 2d 3c 4h 5s 9d Kc')), 4, 'A-5 顺子');
  assert.ok(sc('As 2d 3c 4h 5s 9d Kc') < sc('2s 3d 4c 5h 6s 9d Kc'), '6 高顺子大于 5 高顺子');
  assert.ok(sc('2h 7h 9h Jh Kh As Ad') > sc('Ts Jd Qc Kh As 2d 3c'), '同花大于顺子');
  assert.equal(category(sc('Ks Kd Kc 9h 9s 9d 2c')), 6, '两个三条组成葫芦');
  assert.equal(handName(sc('Ks Kd Kc 9h 9s 9d 2c')), '葫芦 K 带 9');
  assert.ok(sc('As Ad 8c 8h 5s 5d Kc') > sc('As Ad 8c 8h 5s 5d Qc'), '两对比第五张（第三对不算）');
  assert.equal(handName(sc('Ts Js Qs Ks As 2d 3c')), '皇家同花顺');
  assert.equal(category(sc('5h 6h 7h 8h 9h 9s 9d')), 8);
  assert.equal(sc('As Kd 9c 7h 4s 3d 2c'), sc('Ad Ks 9h 7c 4d 3s 2h'), '花色不影响大小');
  assert.equal(handName(sc('Ah Ad 2c 7s 9d')), '一对 A');
});

test('胜率：AA 对 KK 约 82%，河牌时精确', () => {
  const [a, k] = equity([cards('As Ah'), cards('Ks Kh')], [], [], { sims: 2000 });
  assert.ok(Math.abs(a - 0.82) < 0.04, `AA 胜率 ${a}`);
  assert.ok(Math.abs(a + k - 1) < 1e-9);
  const river = equity([cards('As Ah'), cards('Ks Kh')], cards('Kd 2c 7d 9s Jc'));
  assert.deepEqual(river, [0, 1]);
  const split = equity([cards('2s 3h'), cards('4s 5h')], cards('Ts Js Qd Kc Ad'));
  assert.deepEqual(split, [0.5, 0.5]);
});

// ---------- 开局与轮次 ----------

test('座位、盲注和行动顺序（6 人）', () => {
  assert.deepEqual(poker.seats(6), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  assert.deepEqual(poker.seats(3), poker.seats(6).slice(0, 3));
  assert.equal(poker.seatName('p3'), '3 号位');
  const s = make(6);
  assert.equal(s.hand.button, 0);
  assert.deepEqual(s.stacks, [200, 199, 198, 200, 200, 200]);
  assert.deepEqual(poker.pending(s), ['p4']);
  const v = poker.view(s, null);
  assert.deepEqual(v.roles, { p1: '庄位', p2: '小盲', p3: '大盲' });
  // 都弃牌到大盲：大盲赢下盲注，庄位轮转
  const t = run(s, [['p4', 'fold'], ['p5', 'fold'], ['p6', 'fold'], ['p1', 'fold'], ['p2', 'fold']]);
  assert.equal(t.handNo, 2);
  assert.equal(t.last.text, '其他人弃牌，3 号位赢下 3');
  assert.deepEqual(t.last.net, [0, -1, 1, 0, 0, 0]);
  assert.equal(t.hand.button, 1);
  assert.deepEqual(poker.pending(t), ['p5']);
});

test('大盲的选择权；翻牌后从庄位左边开始', () => {
  const s = run(make(6), [['p4', 'fold'], ['p5', 'fold'], ['p6', 'fold'], ['p1', 'call'], ['p2', 'call']]);
  assert.deepEqual(poker.pending(s), ['p3']);
  const ids = poker.actions(s, 'p3').map((a) => a.id);
  assert.ok(ids.includes('check') && !ids.includes('fold') && ids.includes('raise:4'));
  const f = poker.apply(s, 'p3', 'check');
  assert.equal(f.hand.street, 1);
  assert.equal(f.hand.board.length, 3);
  assert.deepEqual(poker.pending(f), ['p2']);
  const g = run(f, [['p2', 'check'], ['p3', 'check'], ['p1', 'check']]);
  assert.equal(g.hand.street, 2);
  assert.equal(poker.label(g, 'p2', 'raise:4'), '下注 4');
});

test('单挑：庄位是小盲、翻牌前先行动、翻牌后后行动', () => {
  const s = make(2);
  assert.equal(s.hand.button, 0);
  assert.equal(s.hand.sb, 0);
  assert.equal(s.hand.bb, 1);
  assert.deepEqual(poker.pending(s), ['p1']);
  assert.deepEqual(poker.view(s, null).roles, { p1: '庄位·小盲', p2: '大盲' });
  const f = run(s, [['p1', 'call'], ['p2', 'check']]);
  assert.equal(f.hand.street, 1);
  assert.deepEqual(poker.pending(f), ['p2']);
  const n = run(f, [['p2', 'raise:2'], ['p1', 'fold']]);
  assert.equal(n.handNo, 2);
  assert.equal(n.hand.button, 1);
  assert.deepEqual(poker.pending(n), ['p2']);
});

test('最小加注、任意金额加注、加注额校验', () => {
  let s = make(6);
  assert.throws(() => poker.apply(s, 'p4', 'raise:3'), /最小加注到 4/);
  assert.throws(() => poker.apply(s, 'p4', 'raise:201'), /最多只能加注到 200/);
  assert.throws(() => poker.apply(s, 'p5', 'call'), /不是5 号位行动|不是 ?5 号位/);
  assert.throws(() => poker.apply(s, 'p4', 'check'), /需要跟注 2/);
  assert.throws(() => poker.apply(s, 'p4', 'bet'), /无法识别/);
  s = poker.apply(s, 'p4', 'raise:4');
  assert.equal(poker.actions(s, 'p5').find((a) => a.id.startsWith('raise:')).id, 'raise:6');
  const ids = poker.actions(s, 'p5').map((a) => a.id);
  assert.ok(!ids.includes('raise:13'), '13 不是代表性金额');
  s = poker.apply(s, 'p5', 'raise:13'); // 但范围内任意整数都接受
  assert.equal(s.hand.minRaise, 9);
  assert.throws(() => poker.apply(s, 'p6', 'raise:21'), /最小加注到 22/);
  s = poker.apply(s, 'p6', 'raise:22');
  assert.equal(poker.label(s, 'p1', 'raise:40'), '加注到 40');
  assert.equal(poker.label(s, 'p1', 'call'), '跟注 22');
  assert.equal(poker.label(s, 'p1', 'allin'), '加注到 200（全下）');
});

test('不足最小加注的全下不重新开放加注', () => {
  // 1 号位庄位、2 号位小盲（只有 30）、3 号位大盲
  let s = make(3, { stacks: [200, 30, 200] });
  s = run(s, [['p1', 'raise:20'], ['p2', 'allin']]);
  assert.equal(s.hand.currentBet, 30);
  assert.equal(s.hand.minRaise, 18, '不足的全下不改变最小加注幅度');
  // 大盲还没行动过，可以加注：最小加注到 30 + 18
  assert.equal(poker.actions(s, 'p3').find((a) => a.id.startsWith('raise:')).id, 'raise:48');
  s = poker.apply(s, 'p3', 'call');
  // 回到 1 号位：只能跟注或弃牌
  const ids = poker.actions(s, 'p1').map((a) => a.id);
  assert.deepEqual(ids, ['fold', 'call']);
  assert.throws(() => poker.apply(s, 'p1', 'raise:60'), /不足最小加注/);
  assert.throws(() => poker.apply(s, 'p1', 'allin'), /只能跟注或弃牌/);
  assert.match(poker.parseReply(s, 'p1', '行动：加注到 60').error, /不足最小加注/);
  s = poker.apply(s, 'p1', 'call');
  assert.equal(s.hand.street, 1);
});

test('边池：多人全下按层分配', () => {
  let s = make(3, { stacks: [50, 100, 200], hands: 1 });
  s = rig(s, { p1: 'As Ad', p2: 'Ks Kd', p3: '7c 2h' }, '3s 8d 9c Jh 4c');
  s = run(s, [['p1', 'allin'], ['p2', 'allin'], ['p3', 'call']]);
  assert.equal(poker.outcome(s).over, true);
  assert.deepEqual(s.stacks, [150, 100, 100]);
  assert.deepEqual(s.hand.result.pots.map((p) => p.amount), [150, 100]);
  assert.match(s.hand.result.text, /1 号位以一对 A 赢下主池 150；2 号位以一对 K 赢下边池 1 100/);
  const v = poker.view(s, 'p3');
  assert.deepEqual(v.players.map((p) => p.cards), [['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2h']], '摊牌后公开底牌');
  assert.equal(v.players[0].handName, '一对 A');
  assert.equal(poker.outcome(s).reason, '1 手结束：1 号位 150 筹码第一');
  assert.deepEqual(poker.outcome(s).ranks, { p1: 1, p2: 2, p3: 2 });
});

test('未被跟注的部分退回', () => {
  let s = make(2, { stacks: [200, 50], hands: 1 });
  s = rig(s, { p1: '7c 2h', p2: 'As Ad' }, '3s 8d 9c Jh 4c');
  s = run(s, [['p1', 'allin']]);
  assert.deepEqual(poker.actions(s, 'p2').map((a) => a.id), ['fold', 'allin'], '筹码不够跟注时只有弃牌和全下');
  s = poker.apply(s, 'p2', 'call');
  assert.deepEqual(s.stacks, [150, 100]);
  assert.match(s.hand.result.text, /1 号位收回未被跟注的 150/);
});

test('平分底池：零头给庄位左侧第一位', () => {
  let s = make(3, { hands: 1 });
  s = rig(s, { p1: '2s 3h', p2: '4c 5d', p3: '6s 7h' }, 'Ts Js Qd Kc Ad');
  s = run(s, [['p1', 'call'], ['p2', 'fold'], ['p3', 'check'],
    ['p3', 'check'], ['p1', 'check'], ['p3', 'check'], ['p1', 'check'], ['p3', 'check'], ['p1', 'check']]);
  assert.equal(poker.outcome(s).over, true);
  // 底池 5，两人平分：各 2，零头 1 给庄位（1 号位）左边第一位赢家 3 号位
  assert.deepEqual(s.stacks, [200, 199, 201]);
  assert.match(s.hand.result.text, /1 号位、3 号位以顺子（A 高）平分底池 5|3 号位、1 号位以顺子（A 高）平分底池 5/);
});

test('所有人全下时直接发完公共牌', () => {
  let s = make(4, { hands: 2 });
  s = rig(s, { p1: 'As Ad', p2: 'Ks Kd', p3: 'Qs Qd', p4: 'Js Jd' }, '2c 3c 7h 8d 9s');
  s = run(s, [['p4', 'allin'], ['p1', 'allin'], ['p2', 'fold'], ['p3', 'fold']]);
  assert.equal(s.last.board.length, 5);
  assert.equal(s.last.showdown, true);
  assert.deepEqual(s.last.net, [203, -1, -2, -200]);
  assert.equal(s.handNo, 2);
  assert.ok(poker.view(s, null).out.includes('p4'), '4 号位输光出局');
  assert.equal(poker.view(s, null).last.text, '1 号位以一对 A 赢下底池 403');
});

test('破产玩家不再参与之后的手牌', () => {
  let s = make(3, { stacks: [200, 200, 2] });
  s = rig(s, { p1: 'As Ad', p2: '9c 8c', p3: '7c 2h' }, '3s 8d 9h Jh 4c');
  // 3 号位大盲 2 已全下，不需要行动
  s = run(s, [['p1', 'raise:10'], ['p2', 'fold']]);
  assert.equal(s.handNo, 2);
  assert.deepEqual(s.stacks.slice(0, 2).map((v) => v > 0), [true, true]);
  assert.equal(s.stacks[2], 0);
  const v = poker.view(s, null);
  assert.deepEqual(v.out, ['p3']);
  assert.equal(v.players[2].cards, null);
  // 两人单挑：庄位移到 2 号位，3 号位不再出现
  assert.equal(s.hand.button, 1);
  for (let k = 0; k < 40 && !poker.outcome(s).over; k++) {
    const [seat] = poker.pending(s);
    assert.notEqual(seat, 'p3');
    s = poker.apply(s, seat, poker.actions(s, seat)[0].id === 'fold' ? 'call' : 'check');
  }
});

test('打满手数或只剩一人有筹码时结束，名次按筹码', () => {
  let s = make(3, { hands: 2 });
  s = run(s, [['p1', 'fold'], ['p2', 'fold'], ['p2', 'fold'], ['p3', 'fold']]);
  const out = poker.outcome(s);
  assert.equal(out.over, true);
  assert.deepEqual(s.stacks, [201, 199, 200]);
  assert.deepEqual(out.ranks, { p1: 1, p3: 2, p2: 3 });
  assert.equal(out.reason, '2 手结束：1 号位 201 筹码第一');
  assert.deepEqual(poker.pending(s), []);
  assert.throws(() => poker.apply(s, 'p1', 'fold'), /已经结束/);
  const tie = { ...structuredClone(s), stacks: [200, 200, 200] };
  assert.deepEqual(poker.outcome(tie).ranks, { p1: 1, p2: 1, p3: 1 });
  assert.match(poker.outcome(tie).reason, /并列第一/);
  assert.equal(poker.outcome(tie).winner, null);
  // 只剩一人有筹码
  let b = make(2, { stacks: [200, 50] });
  b = rig(b, { p1: 'As Ad', p2: '7c 2h' }, '3s 8d 9c Jh 4c');
  b = run(b, [['p1', 'allin'], ['p2', 'call']]);
  assert.equal(poker.outcome(b).over, true);
  assert.match(poker.outcome(b).reason, /打到第 1 手只剩 1 号位有筹码/);
  const f = poker.forfeit(make(3), 'p2', '2 号位连续无效');
  assert.equal(f.ranks.p2, 3);
  assert.equal(f.reason, '2 号位连续无效');
});

test('bb/100 统计', () => {
  const s = run(make(3, { hands: 2 }), [['p1', 'fold'], ['p2', 'fold']]);
  // 3 号位第一手赢了 1 个筹码 = 0.5 个大盲，打了 1 手 → 50 bb/100
  assert.equal(s.bb100[2], 50);
  assert.equal(s.bb100[1], -50);
  assert.equal(poker.view(s, null).players[2].bb100, 50);
});

// ---------- 隐藏信息 ----------

test('视角：只看到自己的底牌；上帝视角看到全部和胜率', () => {
  const s = make(4, {}, 99);
  const v1 = poker.view(s, 'p2');
  assert.equal(v1.players[1].cards.length, 2);
  for (const k of [0, 2, 3]) assert.equal(v1.players[k].cards, null);
  assert.ok(v1.players.every((p) => p.equity === null));
  assert.ok(!JSON.stringify(v1).includes('deck'));
  const god = poker.view(s, null);
  assert.ok(god.players.every((p) => p.cards.length === 2));
  const sum = god.players.reduce((a, p) => a + p.equity, 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `胜率和 ${sum}`);
  assert.deepEqual(poker.view(s, null), god, '同一局面的胜率可重现');
  // 弃牌后不再有胜率，但上帝视角仍看得到他的牌
  const t = poker.apply(s, 'p4', 'fold');
  const g2 = poker.view(t, null);
  assert.equal(g2.players[3].equity, null);
  assert.equal(g2.players[3].cards.length, 2);
  assert.equal(g2.players[3].folded, true);
  // 别人看不到弃牌者的牌
  assert.equal(poker.view(t, 'p1').players[3].cards, null);
});

test('带种子的发牌可以重现', () => {
  const a = make(6, {}, 12345), b = make(6, {}, 12345), c = make(6, {}, 54321);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.hand.hole, c.hand.hole);
  // 用内置 AI 打完一场，再用记录重放，结果一致
  let s = make(4, { hands: 6 }, 777);
  const actions = [];
  while (!poker.outcome(s).over) {
    const [seat] = poker.pending(s);
    const action = poker.builtinMove(s, seat, { level: 2 });
    actions.push({ seat, action });
    s = poker.apply(s, seat, action);
  }
  const r = replay(poker, { players: 4, seed: 777, setup: { hands: 6 }, actions });
  assert.deepEqual(r, s);
});

// ---------- 模型回答 ----------

test('解析模型回答：中英文写法和金额校验', () => {
  const s = make(6); // 4 号位行动，需要跟 2，可以加注到 4–200
  const p = (t) => poker.parseReply(s, 'p4', t);
  assert.deepEqual(p('判断：牌一般\n推断：大盲范围宽\n理由：便宜看翻牌\n胜率：35%\n行动：跟注'), { action: 'call', attempted: '跟注 2', winrate: 35, error: null });
  assert.equal(p('行动：加注到 60').action, 'raise:60');
  assert.equal(p('行动：加注到六十').action, 'raise:60');
  assert.equal(p('行动: 加注 12').action, 'raise:12');
  assert.equal(p('行动：加注至１２').action, 'raise:12');
  assert.equal(p('Action: raise to 12').action, 'raise:12');
  assert.equal(p('行动：call').action, 'call');
  assert.equal(p('行动：跟').action, 'call');
  assert.equal(p('行动：fold').action, 'fold');
  assert.equal(p('行动：弃牌').action, 'fold');
  assert.equal(p('行动：全下').action, 'allin');
  assert.equal(p('行动：All-in').action, 'allin');
  assert.equal(p('行动：加注到 200').action, 'allin', '加注到全部筹码就是全下');
  assert.equal(p('想了想\n我选择弃牌').action, 'fold');
  assert.match(p('行动：加注到 3').error, /最小加注到 4.*4–200/);
  assert.match(p('行动：加注到 500').error, /最多只能加注到 200/);
  assert.match(p('行动：过牌').error, /需要跟注 2，不能过牌/);
  assert.match(p('行动：加注').error, /写明加注到的总额/);
  assert.match(p('嗯……').error, /没有找到行动/);
  assert.equal(p('判断：x\n胜率：120%\n行动：跟注').winrate, 100);
  // 没有要跟的注时「跟注」按过牌处理
  const bbOption = run(make(6), [['p4', 'call'], ['p5', 'fold'], ['p6', 'fold'], ['p1', 'fold'], ['p2', 'fold']]);
  assert.equal(poker.parseReply(bbOption, 'p3', '行动：跟注').action, 'check');
  assert.equal(parseActionText('raise 40').to, 40);
  assert.equal(parseActionText('不加注，跟注').kind, 'call');
});

test('mockReply 写出的回答能被解析回同一个行动', () => {
  let s = make(6, { hands: 3 }, 5);
  for (let k = 0; k < 30 && !poker.outcome(s).over; k++) {
    const [seat] = poker.pending(s);
    for (const a of poker.actions(s, seat)) {
      const text = poker.mockReply(s, seat, a.id);
      assert.equal(poker.parseReply(s, seat, text).action, a.id, text);
    }
    s = poker.apply(s, seat, poker.builtinMove(s, seat, { level: 2 }));
  }
});

test('提示词包含底牌、筹码、位置、行动记录', () => {
  const s = run(make(6), [['p4', 'raise:6']]);
  s.hand.hole[4] = cards('As Kh');
  const t = poker.turnPrompt(s, 'p5');
  assert.match(t, /你的底牌：A♠ K♥/);
  assert.match(t, /第 1 手（本场共 20 手/);
  assert.match(t, /需要跟 6/);
  assert.match(t, /最小加注到 10/);
  assert.match(t, /4 号位 加注到 6/);
  assert.match(t, /1 号位（庄位）/);
  const sys = poker.systemPrompt('p5', { state: s });
  assert.match(sys, /行动：加注到 60/);
  assert.match(sys, /推断/);
});

// ---------- 内置 AI ----------

test('内置 AI：强牌加注、弱牌面对加注弃牌', () => {
  let s = make(6);
  s = rig(s, { p1: '2c 3d', p2: '4c 5d', p3: '6c 8d', p4: 'As Ah', p5: '7c 2h', p6: '9c Td' });
  for (let k = 0; k < 10; k++) {
    const a = poker.builtinMove(s, 'p4', { level: 3 });
    assert.ok(a.startsWith('raise:') || a === 'allin', `AA 应该加注，实际 ${a}`);
  }
  const t = poker.apply(s, 'p4', 'raise:8');
  for (let k = 0; k < 10; k++) assert.equal(poker.builtinMove(t, 'p5', { level: 3 }), 'fold');
  // 先取一次随机行动再比较（放在比较函数里会每次重新随机）
  const rnd = poker.builtinMove(t, 'p5', { random: true });
  assert.ok(poker.actions(t, 'p5').some((a) => a.id === rnd));
});

test('内置 AI 打完整场不出错，筹码守恒', () => {
  for (const n of [2, 3, 6]) {
    let s = make(n, { hands: 15 }, n * 31);
    let guard = 0;
    while (!poker.outcome(s).over) {
      const [seat] = poker.pending(s);
      s = poker.apply(s, seat, poker.builtinMove(s, seat, { level: 1 + (guard % 3) }));
      assert.ok(++guard < 5000);
    }
    assert.equal(s.stacks.reduce((a, b) => a + b, 0), n * 200);
  }
});

test('每手结束、新一手开始的停顿：服务端和牌桌按同一份时长', async () => {
  const { default: g } = await import('../games/poker/index.js');
  const { T, endDur, streetsBetween } = await import('../games/poker/timing.js');
  let s = g.create({ players: 2, seed: 7 });
  assert.equal(g.interlude(null, s), T.DEAL, '开局有开局提示');
  // 同一手里的普通行动不停
  const a = g.pending(s)[0];
  const s1 = g.apply(s, a, 'call');
  assert.equal(g.interlude(s, s1), 0);
  // 有人弃牌：结算卡 + 开局提示
  const s2 = g.apply(s1, g.pending(s1)[0], 'raise:60');
  const s3 = g.apply(s2, g.pending(s2)[0], 'fold');
  assert.equal(s3.hand.no, s2.hand.no + 1);
  assert.equal(g.interlude(s2, s3), endDur({ showdown: false, streets: 0 }) + T.DEAL);
  // 翻牌前全下跟注：摊牌，要把三条街翻完
  let t = g.create({ players: 2, seed: 9 });
  t = g.apply(t, g.pending(t)[0], 'allin');
  const before = t;
  t = g.apply(t, g.pending(t)[0], 'call');
  assert.equal(streetsBetween(0, 5), 3);
  assert.equal(t.last.showdown, true);
  if (!t.over) assert.equal(g.view(t, null).last.showdown, true);
  // 两人各 200 全下：底池 400 = 200 个大盲，算大底池，转牌、河牌前各多停 BIG_WAIT；两家亮牌、一个池
  const info = { showdown: true, streets: 3, shown: 2, pots: 1, big: true };
  assert.equal(g.interlude(before, t), endDur(info) + (t.over ? 0 : T.DEAL));
  assert.equal(endDur(info) - endDur({ ...info, big: false }), 2 * T.BIG_WAIT);
});

test('结算时刻表：一家一家亮牌、补翻、抬牌、按池分发、结算卡依次排开', async () => {
  const { T, schedule, endDur } = await import('../games/poker/timing.js');
  const S = schedule({ showdown: true, streets: 2, shown: 3, pots: 2, big: true });
  assert.deepEqual(S.reveal, [T.REVEAL_AT, T.REVEAL_AT + T.REVEAL_GAP, T.REVEAL_AT + 2 * T.REVEAL_GAP]);
  // 亮完三家（最后一家第二张翻完）才补翻；转牌、河牌前各多停 BIG_WAIT
  assert.equal(S.streetAt[0], S.reveal[2] + T.CARD_GAP + T.FLIP + T.RUNOUT_GAP + T.BIG_WAIT);
  assert.equal(S.streetAt[1], S.streetAt[0] + T.STREET + T.BIG_WAIT);
  assert.ok(S.liftAt > S.streetAt[1] + T.FLIP);
  assert.deepEqual(S.push, [S.liftAt + T.BADGE, S.liftAt + T.BADGE + T.PUSH]);
  assert.ok(S.cardAt >= S.push[1] + T.PUSH);
  assert.equal(S.end, S.cardAt + T.HOLD_SHOWDOWN);
  // 河牌摊牌：不用补翻；弃牌：收注后推一个池
  const R = schedule({ showdown: true, streets: 0, shown: 2, pots: 1 });
  assert.equal(R.streetAt.length, 0);
  assert.equal(R.liftAt, R.reveal[1] + T.CARD_GAP + T.FLIP + T.LIFT);
  assert.equal(endDur({ showdown: false }), T.FOLD_PUSH + T.PUSH + T.CARD_AT + T.HOLD_FOLD);
});

/** 和牌桌（web/stage/poker.js 的 pickView）一样，只用浏览器数据算停顿 */
const pickView = (v) => v && ({
  handNo: v.handNo, boardLen: v.board.length, over: !!v.over, bb: v.blinds?.bb,
  last: v.last ? { showdown: !!v.last.showdown, boardLen: v.last.board.length, shown: Object.keys(v.last.shown || {}).length, pots: v.last.pots?.length || 1, pot: v.last.pot ?? 0 } : null,
  done: v.result ? { showdown: !!v.result.showdown, boardLen: v.board.length, shown: v.result.shown?.length ?? 0, pots: v.result.pots?.length || 1, pot: v.pot } : null,
});

test('服务端停顿和牌桌、回放按浏览器数据算出来的一样（各种视角）', async () => {
  const { pauseBetween } = await import('../games/poker/timing.js');
  for (const [n, seed] of [[2, 3], [3, 11], [6, 21]]) {
    let s = make(n, { hands: 12, stacks: Array.from({ length: n }, (_, j) => 60 + j * 70) }, seed);
    let guard = 0;
    while (!poker.outcome(s).over && guard++ < 3000) {
      const [seat] = poker.pending(s);
      const t = poker.apply(s, seat, poker.builtinMove(s, seat, { level: 2 }));
      for (const viewer of [null, 'p1', '*']) {
        assert.equal(pauseBetween(pickView(poker.view(s, viewer)), pickView(poker.view(t, viewer))), poker.interlude(s, t));
      }
      s = t;
    }
  }
});

test('分池给浏览器：每个池的赢家和分到的数，加起来等于这手的净输赢', () => {
  let s = make(3, { stacks: [50, 100, 200], hands: 2 });
  s = rig(s, { p1: 'As Ad', p2: 'Ks Kd', p3: '7c 2h' }, '3s 8d 9c Jh 4c');
  s = run(s, [['p1', 'allin'], ['p2', 'allin'], ['p3', 'call']]);
  const v = poker.view(s, 'p3');
  assert.equal(v.handNo, 2);
  assert.equal(v.last.pot, 250);
  assert.deepEqual(v.last.pots.map((p) => [p.amount, p.winners, p.shares, p.uncalled]), [[150, ['p1'], [150], false], [100, ['p2'], [100], false]]);
  assert.equal(v.last.pots[0].hand, '一对 A');
  // 新一手里其他人的底牌仍然看不到
  assert.deepEqual(v.players.map((p) => !!p.cards), [false, false, true]);
  // 退回未被跟注的部分单独一个池
  let u = make(2, { stacks: [200, 50], hands: 1 });
  u = rig(u, { p1: '7c 2h', p2: 'As Ad' }, '3s 8d 9c Jh 4c');
  u = run(u, [['p1', 'allin'], ['p2', 'call']]);
  const r = poker.view(u, null).result;
  assert.deepEqual(r.pots.map((p) => [p.amount, p.winners, p.uncalled]), [[100, ['p2'], false], [150, ['p1'], true]]);
  assert.deepEqual(r.shown, ['p1', 'p2']);
});

test('整场统计：入池、翻前加注、摊牌、最大底池、累计盈亏，只在终局给', () => {
  let s = make(3, { hands: 2 });
  // 第 1 手：1 号位加注，2 号位跟注，3 号位弃牌，翻牌后 2 号位弃牌
  s = run(s, [['p1', 'raise:6'], ['p2', 'call'], ['p3', 'fold'], ['p2', 'check'], ['p1', 'raise:8'], ['p2', 'fold']]);
  assert.equal(poker.view(s, null).stats, null, '没打完不给统计');
  // 第 2 手：2 号位庄位，3 号位小盲、1 号位大盲；都弃牌给大盲
  s = run(s, [['p2', 'fold'], ['p3', 'fold']]);
  const st = poker.view(s, 'p2').stats;
  assert.equal(st.hands, 2);
  const by = Object.fromEntries(st.players.map((p) => [p.seat, p]));
  assert.deepEqual([by.p1.vpip, by.p1.pfr, by.p2.vpip, by.p2.pfr, by.p3.vpip], [1, 1, 1, 0, 0]);
  assert.deepEqual(st.players.map((p) => p.played), [2, 2, 2]);
  assert.deepEqual(by.p1.curve, [8, 9]);
  assert.equal(by.p1.net, 9);
  assert.equal(by.p1.best, 14, '第 1 手赢下的底池：6 + 6 + 大盲 2');
  assert.equal(by.p2.net + by.p3.net + by.p1.net, 0);
  assert.equal(by.p1.sd, 0);
});
