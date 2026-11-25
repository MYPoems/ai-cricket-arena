// 掼蛋：牌型与逢人配、比大小、接风、升级与过 A、进贡还贡抗贡、解析模型回答、内置 AI、隐藏信息、带种子可重现
import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../games/guandan/index.js';
import { replay } from '../games/index.js';
import {
  interpret, beats, parseTokens, cardOf, deal, allPlays, resolvePlay, cardName, playId, isBomb, SJ, BJ,
} from '../games/guandan/rules.js';

const S = ['p1', 'p2', 'p3', 'p4'];
/** 写法 → 具体牌（不写花色按 ♠；「配」是红桃级牌） */
const C = (txt, level = 2) => parseTokens(txt).tokens.map((t) => (t.wild ? cardOf(level, 1) : cardOf(t.rank, t.suit ?? 0)));
const kinds = (txt, level = 2) => interpret(C(txt, level), level).map((x) => `${x.type}:${x.key}${x.type === 'bomb' ? `/${x.n}` : ''}`).sort();
const run = (s, lv = 2) => { for (const x of game.pending(s)) s = game.apply(s, x, game.builtinMove(s, x, { level: lv })); return s; };

test('两副牌 108 张，每人 27 张，带种子可重现', () => {
  const a = deal(42), b = deal(42), c = deal(43);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.every((h) => h.length === 27));
  const all = a.flat();
  for (let k = 0; k < 54; k++) assert.equal(all.filter((x) => x === k).length, 2);
  const s1 = game.create({ seed: 9 }), s2 = game.create({ seed: 9 });
  assert.deepEqual(s1, s2);
  assert.equal(s1.total, 3);
  assert.equal(game.create({ seed: 1, setup: { hands: 99 } }).total, 13);
  assert.equal(game.create({ seed: 1, setup: { hands: 1 } }).total, 1);
});

test('牌型识别：普通牌型、A 当 1、逢人配', () => {
  assert.deepEqual(kinds('♠5 ♣5 ♦5 ♠8 ♦8'), ['fullhouse:5']);
  assert.deepEqual(kinds('♠A ♥2 3 4 5', 9), ['straight:1']);
  assert.deepEqual(kinds('♠10 ♠J ♠Q ♠K ♠A', 9), ['sflush:10', 'straight:10']);
  assert.deepEqual(kinds('A A 2 2 3 3', 9), ['tube:1']);
  assert.deepEqual(kinds('Q Q K K A A', 9), ['tube:12']);
  assert.deepEqual(kinds('K K K A A A', 9), ['plate:13']);
  assert.deepEqual(kinds('A A A 2 2 2', 9), ['plate:1']);
  assert.deepEqual(kinds('Q K A 2 3', 9), [], '顺子不能绕过 A');
  assert.deepEqual(kinds('5 6 7 8 9 10', 2), [], '顺子正好 5 张');
  assert.deepEqual(kinds('小王 小王 大王 大王'), ['kings:0']);
  assert.deepEqual(kinds('小王 大王'), [], '一小一大不是对子');
  assert.deepEqual(kinds('小王 小王'), ['pair:16']);
  assert.deepEqual(kinds('9 9 9 小王 小王'), ['fullhouse:9']);
  // 逢人配（级数 7：红桃 7）
  assert.deepEqual(kinds('配 5 5 6 6', 7), ['fullhouse:5', 'fullhouse:6']);
  assert.deepEqual(kinds('♠4 ♠5 ♠6 配 ♠8', 7), ['sflush:4', 'straight:4']);
  assert.deepEqual(kinds('9 9 9 9 配 配', 7), ['bomb:9/6']);
  assert.deepEqual(kinds('配 小王', 7), [], '逢人配不能当王');
  assert.deepEqual(kinds('配', 7), ['single:15'], '逢人配单出就是级牌');
  assert.deepEqual(kinds('配 配', 7), ['pair:15']);
  assert.deepEqual(kinds('♣7', 7), ['single:15'], '级牌单张大于 A');
});

test('比大小：级牌 > A，炸弹类顺序 4 张 < 5 张 < 同花顺 < 6 张 < 四大天王', () => {
  const k = (txt, level = 7) => { const l = interpret(C(txt, level), level); return l.find((x) => x.type === 'sflush') || l[0]; };
  assert.ok(beats(k('♣7'), k('A')), '级牌单张压 A');
  assert.ok(beats(k('小王'), k('♣7')));
  assert.ok(!beats(k('A A'), k('♣7 ♦7')));
  const b4 = k('3 3 3 3'), b4big = k('A A A A'), b5 = k('3 3 3 3 3'), sf = k('♠2 ♠3 ♠4 ♠5 ♠6'), b6 = k('2 2 2 2 2 2'), kg = k('小王 小王 大王 大王');
  assert.ok(beats(b4big, b4) && beats(b5, b4big) && beats(sf, b5) && beats(b6, sf) && beats(kg, b6));
  assert.ok(!beats(b5, sf) && !beats(sf, b6));
  assert.ok(beats(k('♣7 ♣7 ♦7 ♠7'), b4big), '级牌炸弹大于同张数的 A 炸弹');
  assert.ok(beats(k('♦3 ♦4 ♦5 ♦6 ♦7'), sf), '同花顺比点数');
  assert.ok(beats(b4, k('♠10 ♥J Q K A')), '炸弹压顺子');
  assert.ok(beats(k('♥2 3 4 5 6'), k('♥A 2 3 4 5')), 'A 当 1 的顺子最小');
  assert.ok(!beats(k('A A'), k('5 5 5')), '不同牌型不能压');
});

test('枚举出法：逢人配补齐、同花顺、四大天王都能找到，行动 id 可以原样 apply', () => {
  const hand = C('配 小王 小王 大王 大王 ♠3 ♠4 ♠5 ♠6 9 9 9 K', 7);
  const ps = allPlays(hand, 7);
  assert.ok(ps.some((p) => p.type === 'kings'));
  assert.ok(ps.some((p) => p.type === 'sflush' && p.key === 3 && p.wild === 1));
  assert.ok(ps.some((p) => p.type === 'bomb' && p.key === 9 && p.n === 4 && p.wild === 1));
  for (const p of ps) {
    const r = resolvePlay(playId(p.cards, p, 7), hand, 7, null);
    assert.ok(!r.error, r.error);
    assert.equal(r.combo.type, p.type);
  }
});

test('出牌：解析各种写法，逢人配有歧义时跟牌取最小、领出取最大', () => {
  const s = game.create({ seed: 1, setup: { level: 7, first: 'p1', deal: {
    p1: '配 ♠5 ♣5 ♠6 ♦6 ♠9 ♠10 ♠J ♠Q ♠K', p2: '♠4 ♣4 ♦4 ♠3 ♣3 ♠8', p3: '♠2 ♣2', p4: '♦2 ♥3' } } });
  assert.equal(s.turn, 'p1');
  const acts = game.actions(s, 'p1');
  assert.ok(!acts.some((a) => a.id === 'pass'), '领出不能不出');
  // 领出：「配 5 5 6 6」取最强（三带二 6）
  let r = game.parseReply(s, 'p1', '判断：x\n胜率：60%\n出牌：红桃7 5 5 6 6');
  assert.equal(r.error, null);
  assert.equal(r.winrate, 60);
  assert.match(r.action, /=fullhouse:6$/);
  // 跟牌：上家三带二 4 → 「配 5 5 6 6」取能压过的最小组法（三带二 5）
  const s2 = game.apply(game.create({ seed: 1, setup: { level: 7, first: 'p2', deal: {
    p1: '♠2 ♣2', p2: '♠4 ♣4 ♦4 ♠3 ♣3 ♠8', p3: '配 ♠5 ♣5 ♠6 ♦6 ♠9', p4: '♦2 ♥3' } } }), 'p2', '4 4 4 3 3');
  assert.equal(s2.turn, 'p3');
  r = game.parseReply(s2, 'p3', '出牌：♥7 5 5 6 6');
  assert.match(r.action, /=fullhouse:5$/);
  // 全角冒号、不出
  assert.equal(game.parseReply(s2, 'p3', '出牌：不出').action, 'pass');
  assert.equal(game.parseReply(s2, 'p3', '出牌:要不起').action, 'pass');
  // 错误要具体
  assert.match(game.parseReply(s2, 'p3', '出牌：A A A K K').error, /没有|不够/);
  assert.match(game.parseReply(s2, 'p3', '出牌：9').error, /压不过/);
  assert.match(game.parseReply(s2, 'p3', '出牌：5 6').error, /不是合法牌型/);
  assert.match(game.parseReply(s2, 'p3', '我觉得不出').error, /没有找到出牌/);
  assert.match(game.parseReply(s, 'p1', '出牌：不出').error, /领出/);
  // apply 接受任意合法写法
  const s3 = game.apply(s2, 'p3', '红桃7 黑桃5 梅花5 黑桃6 方块6');
  assert.equal(s3.trick.last.type, 'fullhouse');
  assert.equal(s3.trick.last.key, 5);
  assert.throws(() => game.apply(s2, 'p3', '9'), /压不过/);
  assert.throws(() => game.apply(s, 'p1', 'pass'), /不能不出/);
  assert.throws(() => game.apply(s, 'p2', '♠3'), /不是/);
});

test('只写点数时能凑成同花顺去压炸弹', () => {
  const s = game.create({ seed: 1, setup: { level: 2, first: 'p2', deal: {
    p1: '♠6 ♠7 ♠8 ♠9 ♠10 ♣6', p2: '♣3 ♦3 ♥3 ♠3 ♠K', p3: '♠2 ♣2', p4: '♦2 ♦3' } } });
  const s1 = game.apply(s, 'p2', '3 3 3 3');
  const s2 = game.apply(game.apply(s1, 'p3', 'pass'), 'p4', 'pass');
  const r = game.parseReply(s2, 'p1', '出牌：6 7 8 9 10');
  assert.equal(r.error, null);
  assert.match(r.action, /=sflush:6$/);
});

test('模型的各种不规范写法：markdown、「对3」「三个5」、手牌式「5♠ 5♣」、「×2」、「♥7当5」、只写点数时逢人配补哪个点数', () => {
  const s = game.create({ seed: 1, setup: { level: 7, first: 'p1', deal: {
    p1: '配 配 ♠5 ♣5 ♠6 ♣6 ♠3 ♦3 ♠A ♦A ♠K ♣K ♦K 小王 小王', p2: '♠4', p3: '♠2', p4: '♦2' } } });
  const act = (line) => { const r = game.parseReply(s, 'p1', `判断：x\n胜率：50%\n${line}`); assert.equal(r.error, null, `${line}：${r.error}`); return r.action; };
  assert.equal(act('**出牌：** 3 3'), '♠3 ♦3=pair:3');
  assert.equal(act('**出牌**：3 3'), '♠3 ♦3=pair:3');
  assert.equal(act('出牌：对3'), '♠3 ♦3=pair:3');
  assert.equal(act('出牌：一对小王'), '小王 小王=pair:16');
  assert.equal(act('出牌：小王×2'), '小王 小王=pair:16');
  assert.equal(act('出牌：三个K'), '♠K ♣K ♦K=triple:13');
  assert.equal(act('出牌：A♠♦'), '♠A ♦A=pair:14');
  assert.equal(act('出牌：5♠ 5♣ 6♠ 6♣ 逢人配♥7'), '♠5 ♣5 ♠6 ♣6 ♥7=fullhouse:6', '「逢人配♥7」是一张');
  assert.equal(act('出牌：♥7当5 5 5 6 6'), '♠5 ♣5 ♠6 ♣6 ♥7=fullhouse:5', '写了当几就按它');
  assert.equal(act('出牌：5 5 6 6 ♥7（当5）'), '♠5 ♣5 ♠6 ♣6 ♥7=fullhouse:5', '括号里的「当5」也认');
  assert.equal(act('出牌：5 5 5 6 6'), '♠5 ♣5 ♠6 ♣6 ♥7=fullhouse:5', '只写点数、5 不够由逢人配补：逢人配当 5');
  assert.equal(act('出牌：三带二 6 6 6 5 5（♥7当6）'), '♠5 ♣5 ♠6 ♣6 ♥7=fullhouse:6', '照抄记录里的写法');
  assert.equal(act('出牌：1'), '♠A=single:14', '1 当 A');
  assert.equal(act('出牌：级牌7'), '♥7=single:15');
  // 还贡：解析失败时列出能还的牌
  let t = game.create({ seed: 1, setup: { hands: 2, first: 'p1', deal: { p1: '♠3', p2: '♠4 ♠5 ♦9', p3: '♠6', p4: '♠7 ♠8 ♦10' } } });
  for (let i = 0; i < 40 && t.phase !== 'back'; i++) t = run(t);
  assert.equal(t.phase, 'back');
  const giver = game.pending(t)[0];
  const r = game.parseReply(t, giver, '**还贡：** 一张大王');
  assert.match(r.error, /能还的牌：/);
  const ok = game.actions(t, giver)[0].id.replace(/^还贡\s*/, '');
  assert.equal(game.parseReply(t, giver, `**还贡**：${ok}`).action, `还贡 ${ok}`);
  assert.ok(game.turnPrompt(t, giver).includes(`例如「还贡：${game.actions(t, giver)[0].id.replace(/^还贡\s*/, '')}」`), '例子用能还的牌');
});

test('要不起时自动不出（autoAction），领出和压得过时照常问', () => {
  let s = game.create({ seed: 1, setup: { level: 2, first: 'p1', deal: {
    p1: '♠A ♠3', p2: '♠4 ♠5', p3: '♠6 小王', p4: '♠7 ♠8' } } });
  assert.equal(game.autoAction(s, 'p1'), null, '领出不代答');
  s = game.apply(s, 'p1', 'A');
  assert.equal(game.autoAction(s, 'p2'), 'pass', '2 号位没有大过 A 的牌');
  s = game.apply(s, 'p2', 'pass');
  assert.equal(game.autoAction(s, 'p3'), null, '3 号位有小王，要问');
  assert.equal(game.autoAction(s, 'p4'), null, '不是他的回合');
});

test('一轮：都不出时最后出牌的人领出；他已出完由队友接风', () => {
  let s = game.create({ seed: 3, setup: { level: 2, first: 'p1', deal: {
    p1: '♠A', p2: '♠3 ♠4', p3: '♠5 ♠6', p4: '♠7 ♠8' } } });
  s = game.apply(s, 'p1', 'A'); // 1 号位出完，头游
  assert.deepEqual(s.order, ['p1']);
  assert.equal(s.turn, 'p2');
  s = game.apply(s, 'p2', 'pass');
  s = game.apply(s, 'p3', 'pass');
  s = game.apply(s, 'p4', 'pass');
  assert.equal(s.turn, 'p3', '队友 3 号位接风');
  assert.equal(s.trick.wind, true);
  assert.equal(s.trick.last, null);
  assert.equal(game.view(s, null).wind, 'p3');
  // 普通一轮：3 出 5，4 出 7，2 不出、3 不出 → 4 领出
  s = game.apply(s, 'p3', '5');
  s = game.apply(s, 'p4', '7');
  s = game.apply(s, 'p2', 'pass');
  s = game.apply(s, 'p3', 'pass');
  assert.equal(s.turn, 'p4');
  assert.equal(s.trick.last, null);
});

test('升级：双下升 3 级、头游 + 三游升 2 级、头游 + 末游升 1 级，下一盘打头游队的级', () => {
  const play1 = (deal, moves) => {
    let s = game.create({ seed: 5, setup: { hands: 3, first: 'p1', deal } });
    for (const [seat, a] of moves) s = game.apply(s, seat, a);
    return s;
  };
  // 双下：1 号位、3 号位先出完
  let s = play1({ p1: '♠A', p2: '♠3 ♠4', p3: '♠K', p4: '♠5 ♠6' }, [['p1', 'A'], ['p2', 'pass'], ['p3', 'pass'], ['p4', 'pass'], ['p3', 'K']]);
  assert.equal(s.handNo, 2);
  assert.deepEqual(s.levels, { A: 5, B: 2 });
  assert.equal(s.history[0].partnerPos, 2);
  assert.equal(s.levelTeam, 'A');
  assert.equal(s.level, 5);
  // 头游 + 三游：1 头游，2 二游，3 三游
  s = play1({ p1: '♠A', p2: '♠K', p3: '♠Q ♠J', p4: '♠5 ♠6 ♠7' }, SINGLE_MOVES);
  assert.deepEqual(s.history[0].order.slice(0, 3), ['p1', 'p2', 'p3']);
  assert.deepEqual(s.levels, { A: 4, B: 2 });
  // 头游 + 末游：2 号位头游，1、3 号位二游三游，4 号位末游
  s = game.create({ seed: 5, setup: { hands: 3, first: 'p2', deal: { p1: '♠K', p2: '♠A', p3: '♠Q', p4: '♠7 ♠8 ♠9' } } });
  for (const [x, a] of [['p2', 'A'], ['p3', 'pass'], ['p4', 'pass'], ['p1', 'pass']]) s = game.apply(s, x, a);
  assert.equal(s.turn, 'p4', '2 号位出完、别家都不出：4 号位接风');
  for (const [x, a] of [['p4', '7'], ['p1', 'K'], ['p3', 'pass'], ['p4', 'pass']]) s = game.apply(s, x, a);
  assert.equal(s.turn, 'p3', '1 号位出完、别家都不出：3 号位接风');
  s = game.apply(s, 'p3', 'Q');
  assert.equal(s.handNo, 2);
  assert.deepEqual(s.history[0].order, ['p2', 'p1', 'p3', 'p4']);
  assert.deepEqual(s.levels, { A: 2, B: 3 });
  assert.equal(s.level, 3);
});

const SINGLE_MOVES = [['p1', 'A'], ['p2', 'pass'], ['p3', 'pass'], ['p4', 'pass'], ['p3', 'J'], ['p4', 'pass'], ['p2', 'K'], ['p3', 'pass'], ['p4', 'pass'], ['p4', '5'], ['p3', 'Q']];

test('不能越过 A；打 A 拿头游且队友不是末游就过 A、结束整场', () => {
  // K 级的队双下：只能到 A
  let s = game.create({ seed: 5, setup: { hands: 5, first: 'p1', levels: { A: 13 }, deal: { p1: '♠A', p2: '♠3 ♠4', p3: '♠K', p4: '♠5 ♠6' } } });
  for (const [x, a] of [['p1', 'A'], ['p2', 'pass'], ['p3', 'pass'], ['p4', 'pass'], ['p3', 'K']]) s = game.apply(s, x, a);
  assert.equal(s.levels.A, 14);
  assert.equal(game.view(s, null).levels.A, 'A');
  // 打自己的 A：1、3 号位双下 → 过 A
  s = game.create({ seed: 5, setup: { hands: 5, first: 'p1', levels: { A: 14 }, levelTeam: 'A', deal: { p1: '♠5', p2: '♠3 ♠4', p3: '♠K', p4: '♠6 ♠7' } } });
  assert.equal(s.level, 14);
  for (const [x, a] of [['p1', '5'], ['p2', 'pass'], ['p3', 'pass'], ['p4', 'pass'], ['p3', 'K']]) s = game.apply(s, x, a);
  const o = game.outcome(s);
  assert.equal(o.over, true);
  assert.deepEqual(o.ranks, { p1: 1, p2: 2, p3: 1, p4: 2 });
  assert.match(o.reason, /打过 A/);
  assert.equal(o.winnerTeam, '1·3 队', '对局页写「1·3 队胜」');
  assert.ok(o.teams && Object.values(o.teams).some((t) => t.includes('p1') && t.includes('p3')));
  // 打 A 拿头游但队友末游：不算过，记一次失败
  s = game.create({ seed: 5, setup: { hands: 5, first: 'p1', levels: { A: 14 }, levelTeam: 'A', deal: { p1: '♠5', p2: '♠3', p3: '♠Q ♠K', p4: '♠6' } } });
  for (const [x, a] of [['p1', '5'], ['p2', 'pass'], ['p3', 'pass'], ['p4', '6'], ['p2', 'pass'], ['p3', 'pass'], ['p2', '3']]) s = game.apply(s, x, a);
  assert.ok(!game.outcome(s).over);
  assert.deepEqual(s.history[0].order, ['p1', 'p4', 'p2', 'p3']);
  assert.equal(s.levels.A, 14);
  assert.equal(s.aFails.A, 1);
});

test('打满盘数结束：级数高的队赢，同级看最后一盘头游', () => {
  let s = game.create({ seed: 5, setup: { hands: 1, first: 'p1', deal: { p1: '♠A', p2: '♠3 ♠4', p3: '♠K', p4: '♠5 ♠6' } } });
  for (const [x, a] of [['p1', 'A'], ['p2', 'pass'], ['p3', 'pass'], ['p4', 'pass'], ['p3', 'K']]) s = game.apply(s, x, a);
  const o = game.outcome(s);
  assert.equal(o.over, true);
  assert.equal(o.ranks.p1, 1);
  assert.equal(o.ranks.p2, 2);
  assert.match(o.reason, /打满 1 盘/);
  assert.equal(o.winnerTeam, '1·3 队');
  // 终局时桌面上还留着最后一手，记录里也有
  assert.equal(game.view(s, '*').lead.seat, 'p3');
  assert.equal(game.view(s, '*').result.last.last.type, '单张');
  assert.deepEqual(game.pending(s), []);
  assert.deepEqual(game.actions(s, 'p1'), []);
});

/** 第一盘用小牌打出指定名次（1 号位头游，3 号位二游 → 双下；或 1 号位头游、4 号位末游 → 单贡） */
function afterFirstHand(seed, double) {
  let s = game.create({ seed, setup: { hands: 3, first: 'p1', deal: double
    ? { p1: '♠A', p2: '♠3 ♠4', p3: '♠K', p4: '♠5 ♠6' }
    : { p1: '♠A', p2: '♠K', p3: '♠Q ♠J', p4: '♠5 ♠6 ♠7' } } });
  const moves = double ? [['p1', 'A'], ['p2', 'pass'], ['p3', 'pass'], ['p4', 'pass'], ['p3', 'K']] : SINGLE_MOVES;
  for (const [x, a] of moves) s = game.apply(s, x, a);
  return s;
}

test('进贡还贡：末游贡除逢人配外最大的牌，头游还 ≤10 的牌，进贡的人先出', () => {
  let found = false;
  for (let seed = 1; seed < 40 && !found; seed++) {
    const s = afterFirstHand(seed, false);
    if (s.tribute.anti) continue;
    found = true;
    assert.equal(s.phase, 'back');
    const p = s.tribute.pays[0];
    assert.equal(p.from, 'p4');
    assert.equal(p.to, 'p1');
    assert.deepEqual(game.pending(s), ['p1']);
    assert.ok(game.secret(s, 'p1', 'x'), '还贡是私密行动');
    const acts = game.actions(s, 'p1');
    assert.ok(acts.length > 0 && acts.every((a) => /^还贡 /.test(a.id)));
    // 不能还 J 以上（除非手里全是大牌）
    const big = s.cards.p1.find((c) => c < 52 && (c >> 2) + 2 > 10 && (c >> 2) + 2 !== s.level);
    if (big !== undefined && acts.length) assert.throws(() => game.apply(s, 'p1', `还贡 ${cardName(big)}`), /不超过 10/);
    // 解析模型回答
    const id = acts[0].id;
    const r = game.parseReply(s, 'p1', `理由：还小牌\n还贡：${id.slice(3)}`);
    assert.equal(r.action, id);
    // 别人看不到还的是什么
    const s2 = game.apply(s, 'p1', id);
    assert.equal(s2.phase, 'play');
    assert.equal(s2.turn, 'p4', '进贡的人先出');
    assert.equal(game.view(s2, 'p2').tribute.backs[0].card, null);
    assert.equal(game.view(s2, 'p4').tribute.backs[0].card, id.slice(3));
    assert.equal(game.view(s2, null).tribute.backs[0].card, id.slice(3));
    assert.equal(s2.cards.p4.length, 27);
    assert.equal(s2.cards.p1.length, 27);
  }
  assert.ok(found);
});

test('双下进贡：两人都贡，大的给头游，贡大牌的先出；合计两张大王抗贡', () => {
  let doubleSeen = false, antiSeen = false;
  for (let seed = 1; seed < 400 && !(doubleSeen && antiSeen); seed++) {
    const s = afterFirstHand(seed, true);
    if (s.tribute.anti) {
      antiSeen = true;
      assert.equal(s.phase, 'play');
      assert.equal(s.turn, 'p1', '抗贡时头游先出');
      const bj = ['p2', 'p4'].reduce((n, x) => n + s.cards[x].filter((c) => c === BJ).length, 0);
      assert.ok(bj >= 2);
      continue;
    }
    if (doubleSeen) continue;
    doubleSeen = true;
    const pays = s.tribute.pays;
    assert.equal(pays.length, 2);
    assert.deepEqual(new Set(pays.map((p) => p.from)), new Set(['p2', 'p4']));
    assert.deepEqual(new Set(pays.map((p) => p.to)), new Set(['p1', 'p3']));
    assert.deepEqual(game.pending(s).sort(), ['p1', 'p3']);
    let t = s;
    for (const x of ['p3', 'p1']) t = game.apply(t, x, game.builtinMove(t, x, { level: 2 }));
    assert.equal(t.phase, 'play');
    assert.ok(['p2', 'p4'].includes(t.turn));
    assert.ok(Object.values(t.cards).every((h) => h.length === 27));
  }
  assert.ok(doubleSeen && antiSeen);
});

test('隐藏信息：玩家只看到自己的手牌，观众公共视角看不到任何手牌，上帝视角全看到；结束后全公开', () => {
  let s = game.create({ seed: 11 });
  s = run(run(s));
  const v1 = game.view(s, 'p1');
  assert.ok(Array.isArray(v1.hands.p1));
  assert.equal(v1.hands.p2, null);
  assert.equal(v1.hands.p3, null);
  assert.equal(v1.counts.p2, s.cards.p2.length);
  const pub = game.view(s, '*');
  assert.ok(S.every((x) => pub.hands[x] === null));
  const god = game.view(s, null);
  assert.ok(S.every((x) => Array.isArray(god.hands[x])));
  // 视角里不能有种子、牌堆
  assert.ok(!JSON.stringify(v1).includes('"seed"'));
  while (!game.outcome(s).over) s = run(s);
  assert.ok(S.every((x) => Array.isArray(game.view(s, 'p2').hands[x])));
});

test('提示词：写明级牌、逢人配、上家的牌、各家张数、队友和两队级数', () => {
  let s = game.create({ seed: 21 });
  s = run(s);
  const seat = game.pending(s)[0];
  const p = game.turnPrompt(s, seat, { showLegal: true });
  assert.match(p, /第 1\/3 盘/);
  assert.match(p, /逢人配 ♥2/);
  assert.match(p, /队友/);
  assert.match(p, /1·3 队 2，2·4 队 2/);
  assert.match(p, /本轮要压的牌/);
  assert.match(p, /出牌：/);
  assert.ok(p.length < 1600, `提示词太长：${p.length}`);
  assert.match(game.systemPrompt('p1'), /逢人配/);
  const acts = game.actions(s, seat);
  assert.ok(acts.length <= 40 && acts.some((a) => a.id === 'pass'));
  const lead = game.actions(game.create({ seed: 21 }), game.create({ seed: 21 }).turn);
  assert.ok(lead.length <= 50 && !lead.some((a) => a.id === 'pass'));
});

test('内置 AI 三档都能打完整场、模拟模型的回答能解析，带种子可以重放', () => {
  for (const lv of [1, 2, 3]) {
    let s = game.create({ seed: 100 + lv, setup: { hands: 2 } });
    const record = { seed: 100 + lv, setup: { hands: 2 }, players: 4, actions: [] };
    let n = 0;
    while (!game.outcome(s).over) {
      for (const x of game.pending(s)) {
        const a = game.builtinMove(s, x, { level: lv });
        const r = game.parseReply(s, x, game.mockReply(s, x, a));
        assert.equal(r.error, null, r.error);
        assert.ok(game.label(s, x, a));
        s = game.apply(s, x, r.action);
        record.actions.push({ seat: x, action: r.action });
        n++;
      }
      assert.ok(n < 3000);
    }
    assert.deepEqual(replay(game, record), s);
  }
});

test('level 2 规则型明显强于随机', () => {
  let wins = 0;
  for (let g = 0; g < 8; g++) {
    let s = game.create({ seed: 300 + g, setup: { hands: 1 } });
    while (!game.outcome(s).over) for (const x of game.pending(s)) s = game.apply(s, x, game.builtinMove(s, x, { level: x === 'p1' || x === 'p3' ? 2 : 1 }));
    if (game.outcome(s).ranks.p1 === 1) wins++;
  }
  assert.ok(wins >= 6, `规则型只赢了 ${wins}/8`);
});

test('内置 AI：队友的牌不压；能一手出完就出完', () => {
  let s = game.create({ seed: 1, setup: { level: 2, first: 'p1', deal: {
    p1: '♠5 ♠9 ♠Q', p2: '♠3 ♠4', p3: '♠K ♠8 ♠7 ♠6', p4: '♠3 ♠4' } } });
  s = game.apply(s, 'p1', '9');
  s = game.apply(s, 'p2', 'pass');
  assert.equal(game.builtinMove(s, 'p3', { level: 2 }), 'pass');
  const s2 = game.create({ seed: 1, setup: { level: 2, first: 'p1', deal: { p1: '♠5 ♣5 ♦5 ♠8 ♦8', p2: '♠3', p3: '♠4', p4: '♠6' } } });
  assert.match(game.builtinMove(s2, 'p1', { level: 2 }), /=fullhouse:5$/);
});

test('forfeit：犯规一方整队判负', () => {
  const s = game.create({ seed: 1 });
  const o = game.forfeit(s, 'p2', '2 号位超时');
  assert.deepEqual(o.ranks, { p1: 1, p2: 2, p3: 1, p4: 2 });
  assert.equal(o.winnerTeam, '1·3 队');
  assert.ok(o.teams);
});

test('四大天王和炸弹的出法都在候选里', () => {
  const s = game.create({ seed: 1, setup: { level: 2, first: 'p1', deal: { p1: '小王 小王 大王 大王 ♠9 ♣9 ♦9 ♥9 ♠3', p2: '♠4', p3: '♠5', p4: '♠6' } } });
  const acts = game.actions(s, 'p1');
  assert.ok(acts.some((a) => /=kings:0$/.test(a.id)));
  assert.ok(acts.some((a) => /=bomb4:9$/.test(a.id)));
  assert.ok(isBomb({ type: 'kings' }));
  assert.ok([SJ, BJ].every((c) => cardName(c).includes('王')));
});
