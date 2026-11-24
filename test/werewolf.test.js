import test from 'node:test';
import assert from 'node:assert/strict';
import game, { parseSeatRef, cleanSpeech, speechError, SETUPS, setupOf, MAX_DAYS, MAX_LEN } from '../games/werewolf/index.js';
import { speechPause, typeMs, SPEECH, CARD_MS } from '../games/speech.js';
import { replay } from '../games/index.js';

/** 固定身份的局面：roles 按座位顺序给出，例如 'wwsthvvv'（w 狼 s 预言家 t 女巫 h 猎人 v 村民） */
function fixed(code) {
  const map = { w: 'wolf', s: 'seer', t: 'witch', h: 'hunter', v: 'villager' };
  const s = game.create({ players: code.length, seed: 1 });
  s.roles = Object.fromEntries(s.seats.map((x, i) => [x, map[code[i]]]));
  return s;
}

/** 依次让 pending 的座位执行 moves[seat]；moves 可以是函数。代答步（已出局的狼等）按 autoAction 走 */
function act(s, moves) {
  const wolf = s.phase === 'wolf'; // 狼人逐个提名：一直执行到狼人阶段结束
  do {
    for (const seat of game.pending(s)) s = game.apply(s, seat, game.autoAction(s, seat) ?? (typeof moves === 'function' ? moves(seat, s) : moves[seat]));
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
    s = game.apply(s, seat, game.autoAction(s, seat) ?? (s.phase === 'hunter' ? shoot : `第${s.day}天第${++k}句`));
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
  const want = { 6: [2, 1, 1, 0, 2], 7: [2, 1, 1, 1, 2], 8: [2, 1, 1, 1, 3], 9: [3, 1, 1, 1, 3] };
  for (let n = 6; n <= 9; n++) {
    assert.equal(SETUPS[n].length, n);
    const seen = new Set();
    for (let seed = 0; seed < 40; seed++) {
      const a = game.create({ players: n, seed, setup: game.newSetup });
      assert.deepEqual(a, game.create({ players: n, seed, setup: game.newSetup }));
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
  // 两瓶都用完后女巫这一步照样有（步数不暴露女巫的药），但不问女巫，由框架代答「不用」
  s = night(fixed('wwstvvhv'), { kill: 'p6', check: 'p5', witch: 'save' });
  s.potions.poison = false;
  s = talk(s);
  s = act(s, () => 'none');
  assert.equal(s.phase, 'wolf');
  s = act(s, () => 'p6');
  s = game.apply(s, 'p3', 'p5');
  assert.equal(s.phase, 'witch', '女巫没有药也照样有这一步');
  assert.equal(s.night.witchSaw, false, '没药可用的女巫不会被告知刀口');
  assert.equal(game.autoAction(s, 'p4'), 'none');
  assert.equal(game.view(s, 'p4').tonight.kill, undefined, '没被问到的女巫看不到今晚刀口');
  assert.deepEqual(game.view(s, 'p4').pending, [], '代答步不提示本人');
  s = game.apply(s, 'p4', 'none');
  assert.equal(s.phase, 'hunter', '天亮后死者 6 号有一步「猎人检查」');
  assert.deepEqual(game.pending(s), ['p6']);
  assert.equal(game.autoAction(s, 'p6'), 'none', '6 号不是猎人，代答跳过');
  s = game.apply(s, 'p6', 'none');
  assert.equal(s.phase, 'speak');
  assert.equal(s.shots.length, 0, '代答的猎人检查不算开枪');
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
  assert.equal(game.parseReply(s, 'p1', w(`发言：${'长'.repeat(61)}`)).action, '长'.repeat(61)); // 比以前的 60 字长也照样收下
  assert.equal(game.parseReply(s, 'p1', w(`发言：${'长'.repeat(MAX_LEN + 5)}`)).action, `${'长'.repeat(MAX_LEN - 1)}…`); // 超过上限、没有句号：截断加省略号
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
  assert.match(sys, /狼人 2 人、预言家 1 人、女巫 1 人、猎人 1 人、村民 3 人/);
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
  // 旁人只看到一条「夜晚」，看不出夜里走了几步
  assert.deepEqual(game.view(s, 'p5').log.map((e) => e.label), ['夜晚']);
  assert.deepEqual(game.view(s, 'p1').log.map((e) => e.label), ['刀 6号', '刀 6号', '夜晚']);
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
  assert.equal(log5[1].label, '第1天第1句', '公开发言不打码');
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

/** 用内置 AI 跑一盘，记下旁人能看到的步：每夜的私密步数、每次死人后的「猎人检查」步数 */
function simulate(n, seed, setup = game.newSetup) {
  const NIGHT = ['wolf', 'seer', 'witch'];
  let s = game.create({ players: n, seed, setup });
  const record = [];
  const nights = [];
  const blocks = [];
  const cover = { deadWolf: 0, deadSeer: 0, deadWitch: 0, dryWitch: 0, nonHunterCheck: 0, realHunter: 0 };
  let night = null;
  let block = null;
  for (let k = 0; k < 800 && s.phase !== 'over'; k++) {
    for (const seat of game.pending(s)) {
      if (s.phase === 'over' || !game.pending(s).includes(seat)) break;
      const prev = s;
      const a = game.builtinMove(s, seat);
      const auto = game.autoAction(s, seat);
      if (auto !== null) {
        assert.equal(a, auto, '内置 AI 在代答步给出代答行动');
        assert.deepEqual(game.actions(s, seat).map((x) => x.id), [auto], '代答步只有代答行动');
      }
      const secret = game.secret(s, seat, a);
      if (auto !== null) assert.ok(secret && game.secret(s, seat, null), '代答步一律私密（框架开始等这一步时 action 为空，也一样）');
      if (NIGHT.includes(s.phase)) {
        if (!night) {
          const dead = (r) => s.seats.some((x) => s.roles[x] === r && !s.alive.includes(x));
          night = { day: s.day, steps: 0 };
          if (dead('wolf')) cover.deadWolf++;
          if (dead('seer')) cover.deadSeer++;
          if (dead('witch')) cover.deadWitch++;
        }
        if (s.phase === 'witch' && auto !== null && s.alive.includes(seat)) cover.dryWitch++;
        assert.ok(secret, '夜间行动都是私密的');
        night.steps++;
      }
      if (s.phase === 'hunter') {
        assert.ok(block, '猎人检查只在有人死后出现');
        block.got++;
        if (auto !== null && s.roles[seat] !== 'hunter') cover.nonHunterCheck++;
        if (auto === null) cover.realHunter++;
        // 旁人视角：轮到谁、是不是猎人都看不到
        const pub = game.view(s, '*');
        assert.equal(pub.phase, 'wait');
        assert.deepEqual(pub.pending, []);
      }
      s = game.apply(s, seat, a);
      record.push({ seat, action: a, auto: auto !== null, secret });
      // 对局在夜里结束（天亮分出胜负）时，剩下的代答步当场走完，这一夜不算（结束后一切公开）
      if (night && !NIGHT.includes(s.phase)) { if (s.phase !== 'over') nights.push(night); night = null; }
      if (block && !['lastword', 'hunter'].includes(s.phase)) { if (s.phase !== 'over') blocks.push(block); block = null; }
      if (NIGHT.includes(prev.phase) && !NIGHT.includes(s.phase) && s.phase !== 'over') {
        block = { expected: s.dawn.dead.length, got: 0, kind: 'dawn' };
        if (!['lastword', 'hunter'].includes(s.phase)) { blocks.push(block); block = null; }
      }
      if (s.voteLog.length > prev.voteLog.length && s.voteLog.at(-1).next === 'out' && s.phase !== 'over') {
        block = { expected: 1, got: 0, kind: 'vote' };
      }
    }
  }
  return { s, record, nights, blocks, cover };
}

test('夜里的私密步数固定：每个狼人座位（含已出局）+ 预言家 + 女巫，不随谁死了变化', () => {
  const cover = { deadWolf: 0, deadSeer: 0, deadWitch: 0, dryWitch: 0, nonHunterCheck: 0, realHunter: 0 };
  let games = 0;
  for (const n of [6, 7, 8, 9]) {
    const wolves = SETUPS[n].filter((r) => r === 'wolf').length;
    const hunter = SETUPS[n].includes('hunter');
    const perNight = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const r = simulate(n, seed);
      assert.ok(game.outcome(r.s).over, `${n} 人 种子 ${seed} 没下完`);
      games++;
      for (const k of Object.keys(cover)) cover[k] += r.cover[k];
      for (const nt of r.nights) {
        assert.equal(nt.steps, wolves + 2, `${n} 人 种子 ${seed} 第 ${nt.day} 夜走了 ${nt.steps} 步`);
        perNight.add(nt.steps);
      }
      // 死人后的「猎人检查」步数只取决于公开的死亡人数（没有猎人的 6 人局没有这一步）
      for (const b of r.blocks) assert.equal(b.got, hunter ? b.expected : 0, `${n} 人 种子 ${seed} ${b.kind} 死 ${b.expected} 人，猎人检查 ${b.got} 步`);
      // 玩家视角的行动记录：别人的夜间行动每夜只有一条「夜晚」
      const nightsStarted = new Set(r.s.log.filter((e) => ['wolf', 'seer', 'witch'].includes(e.kind)).map((e) => e.day)).size;
      for (const v of ['*', ...r.s.seats]) {
        const log = game.view({ ...r.s, phase: 'speak', result: null }, v).log;
        assert.ok(!log.some((e) => e.label === '夜间行动'));
        const hidden = log.filter((e) => e.label === '夜晚');
        if (v === '*') assert.equal(hidden.length, nightsStarted, '公共视角每夜一条「夜晚」');
        assert.ok(hidden.length <= nightsStarted);
        assert.ok(!log.some((e) => e.seat !== v && /跳过|不能开枪/.test(e.label)), '别人的代答步不出现');
      }
      // 上帝视角的行动记录和对局步数一一对应（复盘按步跳转要用）
      assert.equal(game.view(r.s, null).log.length, r.record.length);
    }
    assert.deepEqual([...perNight], [wolves + 2], `${n} 人局每夜步数恒定`);
  }
  assert.ok(games >= 160);
  // 确实覆盖到了：狼死了、预言家死了、女巫死了、非猎人死者的猎人检查、真猎人决定（女巫没药的情形内置 AI 很少碰到，见上面女巫的测试）
  for (const [k, v] of Object.entries(cover)) if (k !== 'dryWitch') assert.ok(v > 0, `没有覆盖到 ${k}`);
});

test('代答步不改变结果：死狼的空刀不算票，死预言家查不到东西，死女巫不用药', () => {
  let s = fixed('wwwsthvv');
  s.alive = s.alive.filter((x) => x !== 'p1' && x !== 'p2' && x !== 'p4' && x !== 'p5'); // 两狼、预言家、女巫已出局
  assert.deepEqual(game.pending(s), ['p1'], '已出局的狼也占一步');
  assert.equal(game.secret(s, 'p1', null), true);
  assert.equal(game.autoAction(s, 'p1'), 'none');
  assert.equal(game.autoAction(s, 'p2'), null, '没轮到的座位没有代答');
  assert.deepEqual(game.view(s, 'p1').pending, [], '代答步不提示本人');
  assert.equal(game.view(s, 'p7').phase, 'night');
  s = game.apply(s, 'p1', 'none');
  s = game.apply(s, 'p2', 'none');
  assert.deepEqual(game.pending(s), ['p3']);
  s = game.apply(s, 'p3', 'p7');
  assert.equal(s.night.kill, 'p7', '死狼的空刀不算票（否则 2 票空刀压过 1 票）');
  assert.equal(s.phase, 'seer');
  assert.equal(game.autoAction(s, 'p4'), 'none');
  s = game.apply(s, 'p4', 'none');
  assert.equal(s.night.check, null);
  assert.equal(s.checks.length, 0, '死预言家查不到东西');
  assert.equal(s.phase, 'witch');
  assert.equal(s.night.witchSaw, false);
  s = game.apply(s, 'p5', 'none');
  assert.deepEqual(s.dawn.dead, ['p7']);
  assert.deepEqual(s.potions, { save: true, poison: true });
  assert.deepEqual(s.nights.at(-1).wolfVotes, { p3: 'p7' }, '上帝视角的提名记录里没有死狼');
  assert.deepEqual(game.view(s, null).log.map((e) => e.label), ['已出局，跳过', '已出局，跳过', '刀 7号', '已出局，跳过', '已出局，跳过']);
  // 死的是 7 号（村民）：照样有一步猎人检查，代答跳过；旁人看不出区别
  assert.equal(s.phase, 'lastword');
  s = game.apply(s, 'p7', '我是村民');
  assert.equal(s.phase, 'hunter');
  assert.equal(game.autoAction(s, 'p7'), 'none');
  assert.equal(game.secret(s, 'p7', 'none'), true);
  assert.equal(game.secret(s, 'p7', null), true, '框架开始等这一步时（还没有行动）也是私密的');
  assert.equal(game.label(s, 'p7', 'none'), '不是猎人，跳过');
  assert.equal(game.view(s, 'p8').phase, 'wait');
  s = game.apply(s, 'p7', 'none');
  assert.equal(s.phase, 'speak');
  assert.equal(s.shots.length, 0);
});

test('旧对局记录（没有代答步）照样能重放，结果相同', () => {
  let checked = 0;
  for (const n of [7, 8, 9]) {
    for (let seed = 1; seed <= 25; seed++) {
      const r = simulate(n, seed, {});
      const legacy = r.record.filter((x) => !x.auto);
      if (legacy.length === r.record.length) continue;
      checked++;
      const t = replay(game, { players: n, seed, actions: legacy.map(({ seat, action }) => ({ seat, action })) });
      for (const k of ['alive', 'deaths', 'nights', 'checks', 'shots', 'voteLog', 'speeches', 'result', 'potions', 'day', 'phase']) assert.deepEqual(t[k], r.s[k], `${n} 人 种子 ${seed} ${k}`);
      assert.deepEqual(t.log, r.s.log.filter((e) => !e.auto), '补上的空步不进行动记录，和旧记录一一对应');
      // 逐步判断私密：和新规则下的同一步一致
      let st = game.create({ players: n, seed });
      for (const x of legacy) {
        assert.equal(game.secret(st, x.seat, x.action), x.secret);
        st = game.apply(st, x.seat, x.action);
      }
    }
  }
  assert.ok(checked > 20);
});

test('8 人局两狼三民（规则 3 起）；旧记录没有规则版本，仍按三狼两民重放', () => {
  const count = (s, r) => Object.values(s.roles).filter((x) => x === r).length;
  for (let seed = 1; seed <= 20; seed++) {
    const now = game.create({ players: 8, seed, setup: game.newSetup });
    assert.equal(now.rules, 3);
    assert.equal(count(now, 'wolf'), 2);
    assert.equal(count(now, 'villager'), 3);
    const old = game.create({ players: 8, seed });
    assert.equal(old.rules, 1);
    assert.equal(count(old, 'wolf'), 3, '旧对局重放的身份不能变');
    assert.equal(count(game.create({ players: 8, seed, setup: { rules: 2 } }), 'wolf'), 3);
  }
  assert.deepEqual(setupOf(8, 1).filter((r) => r === 'wolf').length, 3);
  const s = game.create({ players: 8, seed: 3, setup: game.newSetup });
  assert.match(game.systemPrompt('p1', { players: 8, state: s }), /狼人 2 人、预言家 1 人、女巫 1 人、猎人 1 人、村民 3 人/);
  assert.match(game.systemPrompt('p1', { players: 8 }), /狼人 2 人/);
});

test('有人发完言：按字数停顿（打字 + 打完后停留），其余步不额外停', () => {
  assert.equal(typeMs('好'), SPEECH.minType);
  assert.equal(typeMs('一'.repeat(20)), 20 * SPEECH.charMs);
  assert.equal(typeMs('一'.repeat(500)), SPEECH.maxType);
  const a = game.create({ players: 6, seed: 1, setup: game.newSetup });
  const b = { ...a, speeches: [{ day: 1, seat: 'p1', kind: 'speak', text: '我是好人，先听后面的发言。' }] };
  assert.equal(game.interlude(a, b), speechPause(b.speeches[0].text));
  assert.equal(game.interlude(b, { ...b }), 0);
  assert.equal(game.interlude(null, b), 0);
});

test('发言放宽：分几行写不丢，写长了在句号处收尾；计票后不论有没有人出局都停一张公告卡', () => {
  let s = game.create({ players: 6, seed: 2, setup: game.newSetup });
  // 走到第一天发言
  for (let guard = 0; s.phase !== 'speak' && guard < 50; guard++) {
    const seat = game.pending(s)[0];
    s = game.apply(s, seat, game.autoAction(s, seat) ?? game.builtinMove(s, seat));
  }
  assert.equal(s.phase, 'speak');
  const seat = s.queue[0];
  const r = game.parseReply(s, seat, '判断：还早。\n推断：不好说。\n胜率：50%\n发言：我是好人。\n昨晚平安，先听后面的人怎么说。');
  assert.equal(r.action, '我是好人。昨晚平安，先听后面的人怎么说。');
  const long = `${'好'.repeat(150)}。${'好'.repeat(100)}`;
  assert.equal(game.parseReply(s, seat, `发言：${long}`).action, `${'好'.repeat(150)}。`);
  assert.equal([...game.parseReply(s, seat, `发言：${'好'.repeat(300)}`).action].length, MAX_LEN);
  // 计票：平票、无人出局也停
  const before = { ...s, voteLog: [] };
  const after = { ...s, voteLog: [{ day: 1, stage: 'vote', votes: { p1: 'p2', p2: 'p1' }, counts: { p1: 1, p2: 1 }, out: null, tied: ['p1', 'p2'], next: 'tie' }] };
  assert.equal(game.interlude(before, after), CARD_MS);
});
