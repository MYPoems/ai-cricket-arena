import test from 'node:test';
import assert from 'node:assert/strict';
import game, { parseSeatRef, cleanSpeech, speechError, SETUPS, MAX_DAYS, MAX_LEN } from '../games/werewolf/index.js';
import { replay } from '../games/index.js';

/** 固定身份的局面：roles 按座位顺序给出，例如 'wwsthvvv'（w 狼 s 预言家 t 女巫 h 猎人 v 村民） */
function fixed(code) {
  const map = { w: 'wolf', s: 'seer', t: 'witch', h: 'hunter', v: 'villager' };
  const s = game.create({ players: code.length, seed: 1 });
  s.roles = Object.fromEntries(s.seats.map((x, i) => [x, map[code[i]]]));
  return s;
}

/** 依次让 pending 的座位执行 moves[seat]；moves 可以是函数 */
function act(s, moves) {
  const wolf = s.phase === 'wolf'; // 狼人逐个提名：一直执行到狼人阶段结束
  do {
    for (const seat of game.pending(s)) s = game.apply(s, seat, typeof moves === 'function' ? moves(seat, s) : moves[seat]);
  } while (wolf && s.phase === 'wolf' && game.pending(s).length);
  return s;
}

/** 跑一整夜：狼人都刀 kill，预言家查 check，女巫用 witch */
function night(s, { kill = 'none', check = null, witch = 'none' } = {}) {
  assert.equal(s.phase, 'wolf');
  s = act(s, () => kill);
  if (s.phase === 'seer') s = act(s, () => check || s.alive.find((x) => x !== game.pending(s)[0]));
  if (s.phase === 'witch') s = act(s, () => witch);
  return s;
}

/** 处理遗言、猎人（不开枪），说完白天的话 */
function talk(s, { shoot = 'none' } = {}) {
  let k = 0;
  while (['lastword', 'hunter', 'speak', 'tiespeak'].includes(s.phase)) {
    const seat = game.pending(s)[0];
    s = game.apply(s, seat, s.phase === 'hunter' ? shoot : `第${s.day}天第${++k}句`);
  }
  return s;
}

test('座位、人数和基本属性', () => {
  assert.deepEqual(game.players, { min: 6, max: 9, default: 8 });
  assert.deepEqual(game.features, { hidden: true, winbar: false, draw: false });
  assert.equal(game.noun, '行动');
  assert.equal(game.id, 'werewolf');
  assert.equal(game.name, '狼人杀');
  for (let n = 6; n <= 9; n++) assert.deepEqual(game.seats(n), game.seats(9).slice(0, n));
  assert.deepEqual(game.seats(9), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
  assert.equal(game.seatName('p3'), '3 号');
  assert.throws(() => game.create({ players: 5, seed: 1 }), /6–9/);
  assert.throws(() => game.create({ players: 10, seed: 1 }), /6–9/);
});

test('身份配置按人数；带种子分配可重现', () => {
  const want = { 6: [2, 1, 1, 0, 2], 7: [2, 1, 1, 1, 2], 8: [3, 1, 1, 1, 2], 9: [3, 1, 1, 1, 3] };
  for (let n = 6; n <= 9; n++) {
    assert.equal(SETUPS[n].length, n);
    const seen = new Set();
    for (let seed = 0; seed < 40; seed++) {
      const a = game.create({ players: n, seed });
      assert.deepEqual(a, game.create({ players: n, seed }));
      assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'state 能 JSON 序列化');
      const c = ['wolf', 'seer', 'witch', 'hunter', 'villager'].map((r) => Object.values(a.roles).filter((x) => x === r).length);
      assert.deepEqual(c, want[n]);
      seen.add(a.seats.filter((x) => a.roles[x] === 'wolf').join());
      assert.equal(a.phase, 'wolf');
      assert.equal(a.day, 1);
    }
    assert.ok(seen.size > 10, '不同种子狼人座位不同');
  }
});

test('狼人逐个提名：pending 每次一只狼，后面的狼能看到队友提名，多数决，平票取座位号小的，空刀', () => {
  let s = fixed('vwvwsvwth');
  assert.deepEqual(game.pending(s), ['p2']);
  assert.deepEqual(game.pending(game.apply(s, 'p2', 'p5')), ['p4']);
  assert.match(game.turnPrompt(game.apply(s, 'p2', 'p5'), 'p4'), /5 ?号/);
  assert.deepEqual(game.actions(s, 'p2').map((a) => a.id), ['p1', 'p3', 'p5', 'p6', 'p8', 'p9', 'none']);
  assert.deepEqual(game.actions(s, 'p1'), []);
  assert.throws(() => game.apply(s, 'p2', 'p4'), /队友/);
  assert.throws(() => game.apply(s, 'p1', 'p3'), /不是/);
  // 多数
  let t = act(s, { p2: 'p5', p4: 'p6', p7: 'p6' });
  assert.equal(t.phase, 'seer');
  assert.equal(t.night.kill, 'p6');
  // 三方平票取座位号小的
  t = act(s, { p2: 'p9', p4: 'p3', p7: 'p5' });
  assert.equal(t.night.kill, 'p3');
  // 空刀和座位平票时刀座位；多数空刀则空刀
  s = fixed('vwvwsvvth');
  s.alive = s.alive.filter((x) => x !== 'p7');
  assert.deepEqual(game.pending(s), ['p2']);
  assert.equal(act(s, { p2: 'none', p4: 'p8' }).night.kill, 'p8');
  assert.equal(act(s, { p2: 'none', p4: 'none' }).night.kill, null);
});

test('预言家查验：结果只有预言家和上帝能看到', () => {
  let s = fixed('wwstvvhv');
  s = act(s, () => 'p6');
  assert.deepEqual(game.pending(s), ['p3']);
  assert.throws(() => game.apply(s, 'p3', 'p3'), /自己/);
  assert.throws(() => game.apply(s, 'p3', 'none'), /必须/);
  s = game.apply(s, 'p3', 'p1');
  assert.deepEqual(s.checks, [{ day: 1, target: 'p1', wolf: true }]);
  assert.deepEqual(game.view(s, 'p3').checks, [{ day: 1, target: 'p1', wolf: true }]);
  assert.deepEqual(game.view(s, 'p5').checks, []);
  assert.deepEqual(game.view(s, 'p1').checks, []);
  assert.equal(game.view(s, null).checks.length, 1);
  assert.match(game.turnPrompt(s, 'p4'), /被狼人杀的是6号/);
});

test('女巫：解药救人成平安夜；不能自救；毒药毒人；一晚只能用一瓶；药用完跳过', () => {
  // 救人
  let s = night(fixed('wwstvvhv'), { kill: 'p6', check: 'p5', witch: 'save' });
  assert.equal(s.phase, 'speak');
  assert.deepEqual(s.dawn, { day: 1, dead: [] });
  assert.equal(s.potions.save, false);
  assert.equal(s.alive.length, 8);
  // 自救不行
  s = fixed('wwstvvhv');
  s = act(s, () => 'p4');
  s = game.apply(s, 'p3', 'p5');
  assert.deepEqual(game.actions(s, 'p4').map((a) => a.id).includes('save'), false);
  assert.throws(() => game.apply(s, 'p4', 'save'), /自救/);
  assert.throws(() => game.apply(s, 'p4', 'poison:p4'), /自己/);
  // 毒人：首夜两人死亡，都留遗言（不公布死因）
  s = game.apply(s, 'p4', 'poison:p1');
  assert.deepEqual(s.dawn.dead, ['p1', 'p4']);
  assert.equal(s.phase, 'lastword');
  assert.deepEqual(s.lastQueue, ['p1', 'p4']);
  assert.equal(s.potions.poison, false);
  assert.ok(game.view(s, 'p5').deaths.every((d) => d.cause === null));
  assert.deepEqual(game.view(s, null).deaths.map((d) => d.cause), ['poison', 'wolf']);
  // 两瓶都用完后女巫阶段跳过
  s = night(fixed('wwstvvhv'), { kill: 'p6', check: 'p5', witch: 'save' });
  s.potions.poison = false;
  s = talk(s);
  s = act(s, () => 'none');
  assert.equal(s.phase, 'wolf');
  s = act(s, () => 'p6');
  s = game.apply(s, 'p3', 'p5');
  assert.equal(s.phase, 'speak', '女巫没有药可用，直接天亮');
  assert.deepEqual(s.dawn, { day: 2, dead: ['p6'] });
  assert.deepEqual(s.lastQueue, [], '第 2 夜死亡没有遗言');
});

test('猎人：被狼杀可以开枪，被毒不能，被放逐先遗言再开枪', () => {
  // 被狼杀：首夜遗言后开枪
  let s = night(fixed('wwstvvhv'), { kill: 'p7', check: 'p5' });
  assert.equal(s.phase, 'lastword');
  s = game.apply(s, 'p7', '我是猎人');
  assert.equal(s.phase, 'hunter');
  assert.deepEqual(game.pending(s), ['p7']);
  assert.throws(() => game.apply(s, 'p7', 'p7'), /自己/);
  s = game.apply(s, 'p7', 'p1');
  assert.ok(!s.alive.includes('p1'));
  assert.deepEqual(s.shots, [{ day: 1, seat: 'p7', target: 'p1' }]);
  assert.equal(s.deaths.at(-1).cause, 'shot');
  assert.equal(s.phase, 'speak');
  // 被毒：不开枪
  s = night(fixed('wwstvvhv'), { kill: 'p6', check: 'p5', witch: 'poison:p7' });
  assert.deepEqual(s.dawn.dead, ['p6', 'p7']);
  s = talk(s, { shoot: 'p1' });
  assert.equal(s.shots.length, 0);
  assert.equal(s.phase, 'vote');
  // 被放逐
  s = night(fixed('wwstvvhv'), { kill: 'none', check: 'p5' });
  s = talk(s);
  s = act(s, (seat) => (seat === 'p7' ? 'p1' : 'p7'));
  assert.equal(s.phase, 'lastword');
  assert.deepEqual(game.pending(s), ['p7']);
  s = game.apply(s, 'p7', '我是猎人，带走 2 号');
  assert.equal(s.phase, 'hunter');
  s = game.apply(s, 'p7', 'none');
  assert.equal(s.phase, 'wolf');
  assert.equal(s.day, 2);
  assert.deepEqual(s.shots, [{ day: 1, seat: 'p7', target: null }]);
});

test('白天：按座位顺序发言，发言不超过 60 字；投票放逐、弃票、平票加赛和重投', () => {
  let s = night(fixed('wwstvvhv'), { kill: 'p6', check: 'p5', witch: 'save' });
  assert.equal(s.phase, 'speak');
  assert.deepEqual(s.queue, s.seats);
  assert.equal(game.actions(s, 'p1'), null);
  assert.deepEqual(game.actions(s, 'p2'), []);
  assert.throws(() => game.apply(s, 'p1', ''), /为空/);
  assert.throws(() => game.apply(s, 'p1', '好'.repeat(MAX_LEN + 1)), /上限/);
  assert.throws(() => game.apply(s, 'p2', '抢话'), /不是/);
  s = game.apply(s, 'p1', '「我是好人」');
  assert.equal(s.speeches[0].text, '我是好人');
  s = talk(s);
  assert.equal(s.phase, 'vote');
  assert.deepEqual(game.pending(s), s.alive);
  assert.ok(game.actions(s, 'p1').some((a) => a.id === 'none'));
  assert.throws(() => game.apply(s, 'p1', 'p1'), /自己/);
  // 平票：p1、p2 各 3 票，其余弃票
  const tieVotes = { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p2', p6: 'p2', p7: 'none', p8: 'none' };
  let t = act(s, tieVotes);
  assert.equal(t.phase, 'tiespeak');
  assert.deepEqual(t.queue, ['p1', 'p2']);
  t = talk(t);
  assert.equal(t.phase, 'revote');
  assert.deepEqual(game.pending(t), ['p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
  assert.throws(() => game.apply(t, 'p3', 'p5'), /平票/);
  const re = act(t, { p3: 'p1', p4: 'p1', p5: 'p2', p6: 'p2', p7: 'none', p8: 'none' });
  assert.equal(re.phase, 'wolf', '再平票无人出局，进入下一夜');
  assert.equal(re.alive.length, 8);
  const re2 = act(t, { p3: 'p1', p4: 'p1', p5: 'p2', p6: 'none', p7: 'none', p8: 'none' });
  assert.ok(!re2.alive.includes('p1'));
  assert.equal(re2.phase, 'lastword');
  // 全部弃票：无人出局
  const none = act(s, () => 'none');
  assert.equal(none.phase, 'wolf');
  assert.equal(none.voteLog.at(-1).out, null);
  // 出局者身份不公开
  const out = act(s, (seat) => (seat === 'p5' ? 'p6' : 'p5'));
  assert.ok(!out.alive.includes('p5'));
  assert.equal(game.view(out, 'p6').roles.p5, undefined);
  assert.deepEqual(game.view(out, 'p6').out, ['p5']);
});

test('胜负：狼人全灭好人胜；狼人数不少于好人数狼人胜；10 天上限狼人胜；名次和阵营', () => {
  // 6 人：2 狼。放逐一狼、毒一狼
  let s = night(fixed('wwstvv'), { kill: 'p5', check: 'p1', witch: 'save' });
  s = talk(s);
  s = act(s, (seat) => (seat === 'p1' ? 'p3' : 'p1'));
  s = talk(s);
  s = act(s, () => 'p6');
  s = game.apply(s, 'p3', 'p6');
  s = game.apply(s, 'p4', 'poison:p2');
  let o = game.outcome(s);
  assert.equal(o.over, true);
  assert.equal(o.winnerTeam, '好人');
  assert.deepEqual(o.teams, { 好人: ['p3', 'p4', 'p5', 'p6'], 狼人: ['p1', 'p2'] });
  assert.deepEqual(o.ranks, { p1: 2, p2: 2, p3: 1, p4: 1, p5: 1, p6: 1 });
  assert.match(o.reason, /狼人全部出局/);
  // 狼人数追平好人：6 人局刀到只剩 2 好人
  s = fixed('wwstvv');
  s.potions = { save: false, poison: false };
  s = night(s, { kill: 'p5', check: 'p1' });
  assert.equal(s.phase, 'lastword');
  s = talk(s);
  s = act(s, (seat) => (seat === 'p1' || seat === 'p2' ? 'p3' : 'none'));
  o = game.outcome(s);
  assert.equal(o.winnerTeam, '狼人');
  assert.match(o.reason, /不少于好人/);
  assert.deepEqual(o.ranks, { p1: 1, p2: 1, p3: 2, p4: 2, p5: 2, p6: 2 });
  // 天数上限
  s = fixed('wwstvvhv');
  s.potions = { save: false, poison: false };
  for (let d = 1; d <= MAX_DAYS; d++) {
    s = night(s, { kill: 'none', check: 'p5' });
    s = talk(s);
    s = act(s, () => 'none');
  }
  o = game.outcome(s);
  assert.equal(o.winnerTeam, '狼人');
  assert.match(o.reason, /10 天/);
  assert.equal(s.day, MAX_DAYS);
  // 犯规：所在阵营判负
  const f = game.forfeit(fixed('wwstvv'), 'p3', '3 号连续无效');
  assert.equal(f.winnerTeam, '狼人');
  assert.equal(f.ranks.p1, 1);
  assert.equal(f.ranks.p3, 2);
});

test('解析座位写法和发言整理', () => {
  for (const t of ['3号', '3 号', 'p3', 'P3', '三号', '３号', '3']) assert.equal(parseSeatRef(t), 'p3', t);
  assert.equal(parseSeatRef('九号'), 'p9');
  assert.deepEqual(parseSeatRef('10号'), { invalid: 10 });
  assert.equal(parseSeatRef('没有'), null);
  assert.equal(cleanSpeech(' “大家好”\n'), '大家好');
  assert.equal(speechError('好'.repeat(MAX_LEN)), null);
});

test('解析模型回答：各阶段格式宽松，非法目标报错', () => {
  const w = (line) => `判断：局势一般。\n推断：3号可疑。\n胜率：６0%\n${line}`;
  let s = fixed('wwstvvhv');
  let r = game.parseReply(s, 'p1', w('刀：五号'));
  assert.equal(r.action, 'p5');
  assert.equal(game.parseReply(s, 'p1', w('刀： 5 号')).action, 'p5');
  assert.equal(game.parseReply(s, 'p1', w('刀：空刀')).action, 'none');
  assert.match(game.parseReply(s, 'p1', w('刀：2号')).error, /队友/);
  assert.match(game.parseReply(s, 'p1', w('刀：12号')).error, /没有 12 号/);
  assert.match(game.parseReply(s, 'p1', '判断：嗯\n胜率：50%').error, /刀：3号/);
  assert.match(game.parseReply(s, 'p3', w('查验：5号')).error, /不需要/);
  assert.equal(game.parseReply(s, 'p1', '胜率：70%\n刀：p6').winrate, 70);
  s = act(s, () => 'p6');
  assert.equal(game.parseReply(s, 'p3', w('查验：p1')).action, 'p1');
  assert.match(game.parseReply(s, 'p3', w('查验：3号')).error, /自己/);
  s = game.apply(s, 'p3', 'p1');
  for (const [line, want] of [['用药：救', 'save'], ['用药：救 6号', 'save'], ['用药：使用解药', 'save'], ['用药：毒 1号', 'poison:p1'], ['用药：毒药 一号', 'poison:p1'], ['用药：不用', 'none'], ['用药：都不用', 'none']]) {
    assert.equal(game.parseReply(s, 'p4', w(line)).action, want, line);
  }
  assert.match(game.parseReply(s, 'p4', w('用药：毒')).error, /毒谁/);
  assert.match(game.parseReply(s, 'p4', w('用药：毒 4号')).error, /自己/);
  assert.match(game.parseReply(s, 'p4', w('用药：随便')).error, /无法识别/);
  s = game.apply(s, 'p4', 'save');
  r = game.parseReply(s, 'p1', w('发言：「我是好人，大家听我说。」'));
  assert.equal(r.action, '我是好人，大家听我说。');
  assert.match(game.parseReply(s, 'p1', w(`发言：${'长'.repeat(61)}`)).error, /61 个字/);
  assert.equal(game.parseReply(s, 'p1', '判断：x\n胜率：50%\n发言：\n我是好人').action, '我是好人');
  s = talk(s);
  assert.equal(game.parseReply(s, 'p1', w('投票：弃票')).action, 'none');
  assert.equal(game.parseReply(s, 'p1', w('投票：弃权')).action, 'none');
  assert.equal(game.parseReply(s, 'p1', w('投票：4号')).action, 'p4');
  assert.match(game.parseReply(s, 'p1', w('投票：1号')).error, /自己/);
  s = act(s, (seat) => (seat === 'p7' ? 'p1' : 'p7'));
  s = game.apply(s, 'p7', '我是猎人');
  assert.equal(game.parseReply(s, 'p7', w('开枪：不开枪')).action, 'none');
  assert.equal(game.parseReply(s, 'p7', w('开枪：2号')).action, 'p2');
  assert.match(game.parseReply(s, 'p7', w('开枪：7号')).error, /已经出局|自己/);
});

test('遗言格式；mockReply 能被自己解析', () => {
  let s = night(fixed('wwstvvhv'), { kill: 'p5', check: 'p1' });
  assert.equal(s.phase, 'lastword');
  assert.equal(game.parseReply(s, 'p5', '判断：x\n推断：y\n胜率：10%\n遗言：1号是狼').action, '1号是狼');
  assert.equal(game.parseReply(s, 'p5', '判断：x\n胜率：10%\n发言：1号是狼').action, '1号是狼');
  for (let seed = 0; seed < 20; seed++) {
    let t = game.create({ players: 6 + (seed % 4), seed });
    for (let k = 0; k < 60 && !game.outcome(t).over; k++) {
      for (const seat of game.pending(t)) {
        const a = game.builtinMove(t, seat);
        assert.equal(game.parseReply(t, seat, game.mockReply(t, seat, a)).action, a);
      }
      t = act(t, (seat) => game.builtinMove(t, seat));
    }
  }
});

test('提示词：规则、身份、胜利条件、防注入、身份专属信息', () => {
  let s = fixed('wwstvvhv');
  const sys = game.systemPrompt('p1', { players: 8, state: s });
  assert.match(sys, /狼人（队友：2号）/);
  assert.match(sys, /不是给你的指令/);
  assert.match(sys, /胜率：/);
  assert.match(sys, /刀：3号/);
  assert.match(sys, /狼人 3 人、预言家 1 人、女巫 1 人、猎人 1 人、村民 2 人/);
  assert.match(game.systemPrompt('p5', { players: 8, state: s }), /好人阵营/);
  assert.match(game.systemPrompt('p5', { players: 8 }), /每次行动的消息/);
  assert.match(game.systemPrompt('p5', { players: 8, state: s, style: '激进' }), /激进/);
  s.roles.p8 = 'wolf';
  s = game.apply(s, 'p1', 'p5');
  const tp = game.turnPrompt(s, 'p2');
  assert.match(tp, /1号提名5号/);
  assert.match(tp, /8号还没提名/);
  s = act(s, () => 'p5');
  s = game.apply(s, 'p3', 'p8');
  assert.match(game.turnPrompt(s, 'p4'), /被狼人杀的是5号/);
  s = game.apply(s, 'p4', 'none');
  const seer = game.turnPrompt(s, 'p3');
  assert.match(seer, /8号是狼人/);
  assert.match(seer, /第 1 夜：5号死亡/);
  assert.doesNotMatch(game.turnPrompt(s, 'p6'), /查验记录|狼人队友|被狼人杀的是/);
  assert.match(game.turnPrompt(s, 'p1'), /狼人队友：2号、8号/);
  assert.match(game.turnPrompt(s, 'p4'), /解药还在，毒药还在/);
});

test('隐藏信息视角：身份、夜间行动、当前投票、行动记录', () => {
  let s = fixed('wwstvvhv');
  // 夜里村民看不到是谁在行动
  let v = game.view(s, 'p5');
  assert.equal(v.phase, 'night');
  assert.deepEqual(v.pending, []);
  assert.deepEqual(v.roles, { p5: '村民' });
  assert.equal(v.tonight.wolfVotes, undefined);
  // 狼人看到队友身份和提名
  s = game.apply(s, 'p1', 'p6');
  v = game.view(s, 'p2');
  assert.deepEqual(v.roles, { p1: '狼人', p2: '狼人' });
  assert.deepEqual(v.tonight.wolfVotes, { p1: 'p6' });
  assert.deepEqual(v.pending, ['p2']);
  assert.deepEqual(v.mates, ['p1']);
  assert.equal(game.view(s, 'p3').tonight.wolfVotes, undefined);
  s = game.apply(s, 'p2', 'p6');
  // 女巫阶段：女巫看到死者
  s = game.apply(s, 'p3', 'p2');
  v = game.view(s, 'p4');
  assert.equal(v.phase, 'witch');
  assert.equal(v.tonight.kill, 'p6');
  assert.deepEqual(v.potions, { save: true, poison: true });
  assert.equal(game.view(s, 'p5').potions, null);
  assert.equal(game.view(s, 'p5').tonight.kill, undefined);
  // 上帝视角全部公开
  const g = game.view(s, null);
  assert.equal(g.god, true);
  assert.equal(Object.keys(g.roles).length, 8);
  assert.equal(g.roles.p1, '狼人');
  assert.deepEqual(g.tonight.wolfVotes, { p1: 'p6', p2: 'p6' });
  assert.equal(g.tonight.check, 'p2');
  s = game.apply(s, 'p4', 'save');
  // 行动记录：夜间行动对旁人打码，对本人和上帝可见
  assert.deepEqual(game.view(s, 'p5').log.map((e) => e.label), ['夜间行动', '夜间行动', '夜间行动', '夜间行动']);
  assert.deepEqual(game.view(s, 'p1').log.map((e) => e.label), ['刀 6号', '刀 6号', '夜间行动', '夜间行动']);
  assert.deepEqual(game.view(s, null).log.map((e) => e.label), ['刀 6号', '刀 6号', '查验 2号', '救 6号']);
  assert.equal(game.view(s, 'p3').lastNight.checkWolf, true);
  assert.equal(game.view(s, 'p5').lastNight.check, undefined);
  // 投票进行中只看到自己的票
  s = talk(s);
  s = game.apply(s, 'p1', 'p3');
  s = game.apply(s, 'p2', 'p3');
  assert.deepEqual(game.view(s, 'p5').votes, {});
  assert.deepEqual(game.view(s, 'p1').votes, { p1: 'p3' });
  assert.deepEqual(game.view(s, null).votes, { p1: 'p3', p2: 'p3' });
  assert.equal(game.secret(s, 'p3', 'p1'), false);
  const log5 = game.view(s, 'p5').log;
  assert.equal(log5[4].label, '第1天第1句', '公开发言不打码');
  assert.deepEqual(log5.slice(-2).map((e) => [e.seat, e.label]), [['p1', '已投票'], ['p2', '已投票']], '计票前看不到别人投给谁');
  assert.equal(game.view(s, 'p1').log.at(-2).label, '投 3号');
  // 结束后全部公开
  const done = { ...s, phase: 'over', result: { team: 'wolf', reason: 'x' } };
  assert.equal(Object.keys(game.view(done, 'p5').roles).length, 8);
});

test('内置 AI：行动合法，所有人数都能正常结束，带种子可以重现', () => {
  for (let i = 0; i < 40; i++) {
    const players = 6 + (i % 4);
    let s = game.create({ players, seed: i * 7 });
    const actions = [];
    for (let k = 0; k < 400 && !game.outcome(s).over; k++) {
      const pend = game.pending(s);
      assert.ok(pend.length, `${s.phase} 没有座位需要行动`);
      const moves = pend.map((seat) => {
        const a = game.builtinMove(s, seat, {});
        const acts = game.actions(s, seat);
        if (acts) assert.ok(acts.some((x) => x.id === a), `${s.phase} ${seat} ${a}`);
        assert.ok(game.label(s, seat, a));
        return [seat, a];
      });
      for (const [seat, a] of moves) { s = game.apply(s, seat, a); actions.push({ seat, action: a }); }
    }
    const o = game.outcome(s);
    assert.ok(o.over);
    assert.ok(['好人', '狼人'].includes(o.winnerTeam));
    assert.deepEqual(replay(game, { players, seed: i * 7, actions }), s);
  }
  // 预言家发言会报查验结果，好人会投被报出的狼
  let s = night(fixed('wwstvvhv'), { kill: 'p6', check: 'p1', witch: 'save' });
  s = game.apply(s, 'p1', '我是好人');
  s = game.apply(s, 'p2', '我是好人');
  const speech = game.builtinMove(s, 'p3');
  assert.match(speech, /预言家.*1号.*狼人/);
  s = talk(game.apply(s, 'p3', speech));
  for (const seat of ['p4', 'p5', 'p6', 'p7', 'p8']) assert.equal(game.builtinMove(s, seat), 'p1');
  assert.notEqual(game.builtinMove(s, 'p2'), 'p1');
  // 女巫首夜救人
  let t = act(fixed('wwstvvhv'), () => 'p6');
  t = game.apply(t, 'p3', 'p1');
  assert.equal(game.builtinMove(t, 'p4'), 'save');
});
