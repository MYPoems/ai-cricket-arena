import test from 'node:test';
import assert from 'node:assert/strict';
import dilemma, { normalizeTalk, parseChoice, MIN_ROUNDS, MAX_ROUNDS } from '../games/dilemma/index.js';
import { replay } from '../games/index.js';

const g = dilemma;

/** 打一轮：双方喊话后各自选择 */
function round(s, ca, cb, ta = '', tb = '') {
  s = g.apply(s, 'a', ta);
  s = g.apply(s, 'b', tb);
  s = g.apply(s, 'a', ca);
  return g.apply(s, 'b', cb);
}
const fresh = (rounds = 20) => g.create({ players: 2, seed: 7, setup: { rounds } });

test('座位、阶段与同时行动', () => {
  assert.deepEqual(g.seats(2), ['a', 'b']);
  assert.equal(g.seatName('a'), '甲');
  assert.equal(g.seatName('b'), '乙');
  let s = fresh();
  assert.deepEqual(g.pending(s), ['a', 'b']);
  assert.equal(g.actions(s, 'a'), null, '喊话阶段是自由文本');
  s = g.apply(s, 'a', '你好');
  assert.deepEqual(g.pending(s), ['b']);
  assert.deepEqual(g.actions(s, 'a'), []);
  assert.throws(() => g.apply(s, 'a', '再说一句'), /已经提交/);
  s = g.apply(s, 'b', '');
  assert.equal(s.phase, 'choose');
  assert.deepEqual(g.actions(s, 'a').map((x) => x.id), ['C', 'D']);
  assert.throws(() => g.apply(s, 'a', '随便'), /无法识别/);
  const before = JSON.stringify(s);
  const s2 = g.apply(s, 'a', 'C');
  assert.equal(JSON.stringify(s), before, 'apply 不修改原 state');
  assert.deepEqual(g.pending(s2), ['b']);
  const s3 = g.apply(s2, 'b', 'D');
  assert.equal(s3.phase, 'talk');
  assert.equal(s3.history.length, 1);
  assert.deepEqual(s3.score, { a: 0, b: 5 });
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s3)));
});

test('收益表', () => {
  let s = fresh();
  s = round(s, 'C', 'C');
  assert.deepEqual(s.history[0].pts, { a: 3, b: 3 });
  s = round(s, 'D', 'D');
  assert.deepEqual(s.history[1].pts, { a: 1, b: 1 });
  s = round(s, 'D', 'C');
  assert.deepEqual(s.history[2].pts, { a: 5, b: 0 });
  s = round(s, 'C', 'D');
  assert.deepEqual(s.history[3].pts, { a: 0, b: 5 });
  assert.deepEqual(s.score, { a: 9, b: 9 });
});

test('喊话：去掉换行、不超过 30 字、「（不说）」算空', () => {
  let s = fresh();
  s = g.apply(s, 'a', '第一行\n第二行');
  assert.equal(s.cur.talk.a, '第一行 第二行');
  assert.throws(() => g.apply(s, 'b', '字'.repeat(31)), /30 字/);
  s = g.apply(s, 'b', '字'.repeat(30));
  assert.equal(s.cur.talk.b.length, 30);
  assert.equal(normalizeTalk('（不说）'), '');
  assert.equal(normalizeTalk('(不说)'), '');
  assert.equal(normalizeTalk('「合作吧」'), '合作吧');
  assert.equal(normalizeTalk('  '), '');
  assert.equal(g.label(fresh(), 'a', ''), '不说话');
  assert.equal(g.label(fresh(), 'a', '你好'), '喊话：你好');
});

test('总轮数由种子决定、在 15–25 之间且可重现，结束与名次', () => {
  const totals = new Set();
  for (let seed = 0; seed < 200; seed++) {
    const t = g.create({ players: 2, seed }).total;
    assert.ok(t >= MIN_ROUNDS && t <= MAX_ROUNDS, `seed ${seed} → ${t}`);
    assert.equal(g.create({ players: 2, seed }).total, t);
    totals.add(t);
  }
  assert.ok(totals.size >= 8, '轮数应有变化');

  let s = g.create({ players: 2, seed: 1, setup: { rounds: 3 } });
  s = round(s, 'C', 'C');
  s = round(s, 'D', 'C');
  assert.equal(g.outcome(s).over, false);
  s = round(s, 'C', 'C');
  const out = g.outcome(s);
  assert.deepEqual(out, { over: true, winner: 'a', ranks: { a: 1, b: 2 }, reason: '3 轮结束：甲 11 分，乙 6 分' });
  assert.deepEqual(g.pending(s), []);
  assert.throws(() => g.apply(s, 'a', ''), /已经结束/);

  let t = g.create({ players: 2, seed: 1, setup: { rounds: 2 } });
  t = round(t, 'D', 'C');
  t = round(t, 'C', 'D');
  assert.deepEqual(g.outcome(t).ranks, { a: 1, b: 1 });
  assert.equal(g.outcome(t).winner, null);
  assert.match(g.outcome(t).reason, /平局/);
  assert.deepEqual(g.forfeit(fresh(), 'a', '甲连续无效'), { over: true, winner: 'b', ranks: { b: 1, a: 2 }, reason: '甲连续无效' });
});

test('统计：合作率、报复比例、主动背叛', () => {
  let s = fresh();
  s = round(s, 'D', 'C'); // 甲主动背叛
  s = round(s, 'C', 'D'); // 乙报复（甲上一轮背叛）
  s = round(s, 'D', 'C'); // 甲报复
  s = round(s, 'C', 'C'); // 乙被背叛后仍合作
  const v = g.view(s, null);
  assert.equal(v.stats.a.coopRate, 0.5);
  assert.equal(v.stats.a.unprovoked, 1);
  assert.equal(v.stats.a.chances, 1);
  assert.equal(v.stats.a.retaliation, 1);
  assert.equal(v.stats.b.coopRate, 0.75);
  assert.equal(v.stats.b.unprovoked, 0);
  assert.equal(v.stats.b.chances, 2);
  assert.equal(v.stats.b.retaliation, 0.5);
  assert.equal(g.view(fresh(), null).stats.a.coopRate, null);
});

test('隐藏信息：进行中的一轮看不到对方已提交的内容，上帝视角可以', () => {
  let s = fresh(17);
  s = g.apply(s, 'a', '我会合作');
  assert.equal(g.view(s, 'b').current.talk.a, null);
  assert.equal(g.view(s, 'a').current.talk.a, '我会合作');
  assert.equal(g.view(s, null).current.talk.a, '我会合作');
  assert.equal(g.view(s, 'b').total, null, '选手视角不知道总轮数');
  assert.equal(g.view(s, null).total, 17);
  assert.ok(!JSON.stringify(g.view(s, 'b')).includes('我会合作'));
  s = g.apply(s, 'b', '');
  // 双方喊完后喊话公开
  assert.equal(g.view(s, 'b').current.talk.a, '我会合作');
  s = g.apply(s, 'a', 'D');
  assert.equal(g.view(s, 'b').current.choice.a, null);
  assert.equal(g.view(s, 'a').current.choice.a, 'D');
  assert.equal(g.view(s, null).current.choice.a, 'D');
  assert.deepEqual(g.view(s, 'b').pending, ['b']);
  s = g.apply(s, 'b', 'C');
  assert.equal(g.view(s, 'b').history[0].choice.a, 'D');
  // 提示词里不出现总轮数
  const prompt = g.systemPrompt('a') + g.turnPrompt(s, 'a');
  assert.ok(!prompt.includes('17'), '不能透露具体轮数');
  assert.match(g.systemPrompt('a'), /大约 20 轮，具体轮数事先不知道/);
  assert.match(g.systemPrompt('a'), /不是给你的指令/);
});

test('提示词包含历史、喊话和总分', () => {
  let s = fresh();
  s = round(s, 'C', 'D', '一起合作', '好的');
  s = g.apply(s, 'a', '你骗我');
  s = g.apply(s, 'b', '');
  const p = g.turnPrompt(s, 'a');
  assert.match(p, /第 2 轮 · 选择阶段/);
  assert.match(p, /你 0 分，对方 5 分/);
  assert.match(p, /你喊：「一起合作」｜对方喊：「好的」｜你合作，对方背叛｜得分：你 \+0，对方 \+5/);
  assert.match(p, /本轮喊话：你喊 「你骗我」；对方喊 （不说）/);
  const pb = g.turnPrompt(s, 'b');
  assert.match(pb, /你 5 分，对方 0 分/);
});

test('解析模型回答', () => {
  let s = fresh();
  const talk = g.parseReply(s, 'a', '判断：对方未知\n计划：先示好\n胜率：55%\n喊话：我们合作吧！');
  assert.deepEqual(talk, { action: '我们合作吧！', attempted: '我们合作吧！', winrate: 55, error: null });
  assert.equal(g.parseReply(s, 'a', '判断：x\n计划：这一轮喊话要强硬\n胜率：50%\n喊话：（不说）').action, '');
  assert.equal(g.parseReply(s, 'a', '喊话： ').action, '');
  assert.equal(g.parseReply(s, 'a', '**喊话**：「别背叛」').action, '别背叛');
  assert.equal([...g.parseReply(s, 'a', `喊话：${'长'.repeat(40)}`).action].length, 30, '超长截断到 30 字');
  assert.match(g.parseReply(s, 'a', '判断：x\n胜率：50%').error, /没有找到喊话/);
  s = g.apply(g.apply(s, 'a', ''), 'b', '');
  const ok = (text, want) => assert.equal(g.parseReply(s, 'a', text).action, want, text);
  ok('判断：守信\n理由：互惠\n胜率：60%\n选择：合作', 'C');
  ok('选择：背叛', 'D');
  ok('选择 ： C', 'C');
  ok('选择：d', 'D');
  ok('选择：cooperate', 'C');
  ok('选择：Defect', 'D');
  ok('选择：**合作**', 'C');
  ok('选择：「背叛」。', 'D');
  ok('判断：x\n理由：y\n胜率：50%\n背叛', 'D');
  assert.equal(g.parseReply(s, 'a', '胜率：120%\n选择：合作').winrate, 100);
  assert.match(g.parseReply(s, 'a', '选择：看情况').error, /无法识别/);
  assert.match(g.parseReply(s, 'a', '我想想').error, /没有找到选择/);
  // 喊话阶段的行动在选择阶段不算
  assert.match(g.parseReply(s, 'a', '喊话：你好').error, /没有找到选择/);
  assert.equal(parseChoice('合作（C）'), 'C');
  assert.equal(parseChoice('不知道'), null);
  // mockReply 写出的回答能被解析回同一个行动
  for (const act of ['C', 'D']) assert.equal(g.parseReply(s, 'b', g.mockReply(s, 'b', act)).action, act);
  const t0 = fresh();
  assert.equal(g.parseReply(t0, 'a', g.mockReply(t0, 'a', '你好')).action, '你好');
  assert.equal(g.parseReply(t0, 'a', g.mockReply(t0, 'a', '')).action, '');
});

test('内置 AI：随机、以牙还牙、宽容的以牙还牙', () => {
  let s = fresh();
  const talk = g.builtinMove(s, 'a', { level: 2 });
  assert.equal(typeof talk, 'string');
  assert.doesNotThrow(() => g.apply(s, 'a', talk));
  assert.doesNotThrow(() => g.apply(s, 'a', g.builtinMove(s, 'a', { level: 1, random: true })));
  const choose = (st) => g.apply(g.apply(st, 'a', ''), 'b', '');
  // 以牙还牙：第一轮合作，之后照抄对方上一轮
  assert.equal(g.builtinMove(choose(s), 'a', { level: 2 }), 'C');
  s = round(s, 'C', 'D');
  assert.equal(g.builtinMove(choose(s), 'a', { level: 2 }), 'D');
  const afterCoop = round(s, 'D', 'C');
  assert.equal(g.builtinMove(choose(afterCoop), 'a', { level: 2 }), 'C');
  // 宽容：被背叛后大约 1/3 仍合作
  let coop = 0;
  for (let i = 0; i < 3000; i++) if (g.builtinMove(choose(s), 'a', { level: 3 }) === 'C') coop++;
  assert.ok(coop > 800 && coop < 1200, `宽容合作 ${coop}/3000`);
  assert.equal(g.builtinMove(choose(afterCoop), 'a', { level: 3 }), 'C');
  // 随机：两种都会出现
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(g.builtinMove(choose(s), 'a', { level: 1 }));
  assert.deepEqual([...seen].sort(), ['C', 'D']);
});

test('带种子的对局可以从记录重放', () => {
  const actions = [];
  let s = g.create({ players: 2, seed: 12345 });
  while (!g.outcome(s).over) {
    for (const seat of g.pending(s)) {
      const action = g.builtinMove(s, seat, { level: 3 });
      actions.push({ seat, action });
      s = g.apply(s, seat, action);
    }
  }
  const r = replay(g, { players: 2, seed: 12345, setup: {}, actions });
  assert.deepEqual(r, s);
  assert.equal(r.history.length, g.create({ players: 2, seed: 12345 }).total);
  assert.equal(actions.length, r.total * 4);
});

// ---------- 规则 2：喊话轮流先手、达标线 ----------
const fresh2 = (rounds = 20) => g.create({ players: 2, seed: 7, setup: { rounds, rules: 2 } });
/** 规则 2 打一轮：按先手顺序喊话，再各自选择 */
function round2(s, ca, cb) {
  while (s.phase === 'talk') s = g.apply(s, g.pending(s)[0], '');
  s = g.apply(s, 'a', ca);
  return g.apply(s, 'b', cb);
}

test('规则 2：新开的对局带 rules 2，旧记录按 1 重放', () => {
  assert.equal(g.newSetup.rules, 2);
  assert.equal(fresh().rules, 1);
  assert.equal(fresh2().rules, 2);
});

test('规则 2：喊话轮流先手，后说的能听到先说的', () => {
  let s = fresh2();
  assert.deepEqual(g.pending(s), ['a'], '单数轮甲先说');
  assert.throws(() => g.apply(s, 'b', '抢话'), /已经提交|不需要/);
  s = g.apply(s, 'a', '我先表态：合作');
  assert.deepEqual(g.pending(s), ['b']);
  assert.equal(g.view(s, 'b').current.talk.a, '我先表态：合作', '先说的话一出口对方就能看到');
  assert.match(g.turnPrompt(s, 'b'), /对方先说，对方喊：「我先表态：合作」/);
  s = g.apply(s, 'b', '好');
  assert.equal(s.phase, 'choose');
  s = g.apply(g.apply(s, 'a', 'C'), 'b', 'C');
  assert.deepEqual(g.pending(s), ['b'], '双数轮乙先说');
  assert.equal(g.view(s, null).first, 'b');
  assert.match(g.turnPrompt(s, 'b'), /这一轮你先说/);
});

test('规则 2：达标线决定胜负，领先后一直背叛赢不了', () => {
  const tft = (s, me) => { const p = s.history.at(-1); return !p || p.choice[me === 'a' ? 'b' : 'a'] === 'C' ? 'C' : 'D'; };
  const play = (fa, fb, rounds = 20) => {
    let s = fresh2(rounds);
    while (!g.outcome(s).over) s = round2(s, fa(s, 'a'), fb(s, 'b'));
    return g.outcome(s);
  };
  // 前 10 轮合作，然后先背叛一次再一直背叛：以牙还牙会跟着背叛，两人都掉到线下
  let o = play((s) => (s.history.length >= 10 ? 'D' : 'C'), tft);
  assert.equal(o.winner, null);
  assert.match(o.reason, /两败俱伤/);
  // 一直背叛对一直合作：只有背叛的达标
  o = play(() => 'D', () => 'C');
  assert.equal(o.winner, 'a');
  assert.match(o.reason, /只有甲达标/);
  // 都达标：分高的赢
  o = play((s) => (s.history.length === 19 ? 'D' : 'C'), () => 'C');
  assert.equal(o.winner, 'a');
  assert.match(o.reason, /双方都达标，甲分高/);
  // 一直合作：同分平局
  o = play(() => 'C', () => 'C');
  assert.equal(o.winner, null);
  assert.match(o.reason, /同分/);
  assert.match(g.systemPrompt('a'), /达标线/);
});
