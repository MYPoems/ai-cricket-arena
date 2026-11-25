import test from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES } from '../server/puzzles/turtlesoup.js';
import game, {
  setPuzzleBank, HOST, MAX_TRIES, Q_PER, Q_MAX, R_MAX, NOTE_MAX, INTRO_MS,
  parseGuess, parseAnswerId, parseHitId, judgeHits, builtinAnswer, puzzleOf,
} from '../games/turtlesoup/index.js';
import stage from '../web/stage/turtlesoup.js';
import { replay } from '../games/index.js';
import { timeoutAction } from '../server/arena.js';
import { CARD_MS, speechPause } from '../games/speech.js';

setPuzzleBank(PUZZLES);

/** 指定谜题开局 */
const start = (players = 4, puzzle = 1, seed = 7) => game.create({ players, seed, setup: { puzzle } });
const pts = (s) => puzzleOf(s).points.length;
/** 当前猜题者提问，汤主回答 */
function ask(s, q = '主角是男的吗？', answer = 'no') {
  const g = game.pending(s)[0];
  s = game.apply(s, g, `提问：${q}`);
  return game.apply(s, HOST, answer);
}
/** 当前猜题者还原，汤主判定 */
function solve(s, hits, text = '我觉得是这样的故事') {
  const g = game.pending(s)[0];
  s = game.apply(s, g, `还原：${text}`);
  return game.apply(s, HOST, `hit:${hits.length ? hits.join(',') : 'none'}`);
}
/** 用内置 AI 下完一盘，返回 { state, actions } */
function playOut(players, seed, setup = {}) {
  let s = game.create({ players, seed, setup });
  const actions = [];
  for (let i = 0; i < 600 && !game.outcome(s).over; i++) {
    const [seat] = game.pending(s);
    const a = game.builtinMove(s, seat, {});
    s = game.apply(s, seat, a);
    actions.push({ seat, action: a });
  }
  return { state: s, actions };
}

test('座位、人数和基本属性', () => {
  assert.equal(game.id, 'turtlesoup');
  assert.equal(game.name, '海龟汤');
  assert.deepEqual(game.players, { min: 3, max: 6, default: 4 });
  for (let n = 3; n <= 6; n++) assert.deepEqual(game.seats(n), game.seats(6).slice(0, n));
  assert.deepEqual(game.seats(4), ['p1', 'p2', 'p3', 'p4']);
  assert.equal(game.seatName('p1'), '汤主');
  assert.equal(game.seatName('p3'), '3 号');
  assert.deepEqual(game.features, { hidden: true, winbar: false, draw: false });
  assert.throws(() => game.create({ players: 2, seed: 1 }), /3–6/);
  assert.throws(() => game.create({ players: 7, seed: 1 }), /3–6/);
});

test('谜题库：至少 24 道原创题，难度、红汤清汤、本格变格都有，字数和要点数合规', () => {
  assert.ok(PUZZLES.length >= 24);
  assert.deepEqual(PUZZLES.map((p) => p.id), PUZZLES.map((_, i) => i + 1));
  const titles = new Set();
  for (const p of PUZZLES) {
    assert.ok(!titles.has(p.title), `重复标题 ${p.title}`);
    titles.add(p.title);
    assert.ok([1, 2, 3].includes(p.tier));
    assert.ok(['red', 'clear'].includes(p.soup));
    assert.ok(['ben', 'bian'].includes(p.style));
    assert.ok([...p.surface].length <= 120, `${p.title} 汤面过长`);
    assert.ok([...p.truth].length <= 300, `${p.title} 汤底过长`);
    assert.ok(p.points.length >= 3 && p.points.length <= 5, `${p.title} 要点数`);
    for (const pt of p.points) assert.ok(pt.text && pt.keys, `${p.title} 要点缺字段`);
    // 汤底本身命中全部要点；只复述汤面不能命中全部要点
    assert.equal(judgeHits(p, p.truth).length, p.points.length, `${p.title} 汤底没命中全部要点`);
    assert.ok(judgeHits(p, p.surface).length < p.points.length, `${p.title} 复述汤面就全中了`);
    // 内置汤主对本题问题里答「是」的拼起来，内置猜题者能还原成功
    const yes = p.probes.filter((q) => ['yes', 'both'].includes(builtinAnswer(p, q))).join('；');
    assert.equal(judgeHits(p, yes).length, p.points.length, `${p.title} 的问题问不全要点`);
    assert.ok(p.probes.some((q) => builtinAnswer(p, q) === 'no'), `${p.title} 没有答「不是」的问题`);
    // 每条要点的原话命中它自己；本题问题里前几条（对应要点）答「是」，后面的（错误方向）答「不是」
    p.points.forEach((pt, i) => assert.ok(judgeHits(p, pt.text).includes(i + 1), `${p.title} 要点 ${i + 1} 的原话不命中自己`));
    p.probes.forEach((q, i) => assert.equal(builtinAnswer(p, q), i < p.points.length ? 'yes' : 'no', `${p.title}：${q}`));
    // 主角性别：hero 必填；性别词不放进 yes / no 词表（问到配角的性别会答反）
    assert.ok(['m', 'f'].includes(p.hero) && p.heroNames, `${p.title} 缺 hero`);
    assert.ok(!/男的|男人|男性|女的|女人|女性/.test(`${p.yes}|${p.no}`), `${p.title} 的词表里有性别词`);
  }
  for (const t of [1, 2, 3]) assert.ok(PUZZLES.filter((p) => p.tier === t).length >= 6, `难度 ${t} 太少`);
  assert.ok(PUZZLES.some((p) => p.soup === 'red') && PUZZLES.some((p) => p.soup === 'clear'));
  assert.ok(PUZZLES.some((p) => p.style === 'bian') && PUZZLES.some((p) => p.style === 'ben'));
});

test('带种子开局可重现；setup.puzzle 指定题目；提问总数 = 猜题人数 × 8', () => {
  assert.deepEqual(game.create({ players: 5, seed: 42 }), game.create({ players: 5, seed: 42 }));
  const ids = new Set();
  for (let seed = 1; seed <= 60; seed++) ids.add(game.create({ players: 4, seed }).puzzleId);
  assert.ok(ids.size >= 10, '种子挑题太集中');
  assert.equal(start(4, 17).puzzleId, 17);
  assert.equal(game.create({ players: 4, seed: 3, setup: { puzzle: 999 } }).puzzleId, game.create({ players: 4, seed: 3 }).puzzleId);
  for (let n = 3; n <= 6; n++) {
    const s = game.create({ players: n, seed: 1 });
    assert.equal(s.maxQ, (n - 1) * Q_PER);
    assert.deepEqual(game.pending(s), ['p2']);
    assert.equal(game.actions(s, 'p2'), null);
    assert.deepEqual(game.actions(s, HOST), []);
  }
});

test('轮流提问：提问后汤主作答，答完轮到下一位；补充语随回答公开', () => {
  let s = start(4, 1);
  s = game.apply(s, 'p2', '提问：小林是在给别人当模特吗？');
  assert.equal(s.phase, 'answer');
  assert.deepEqual(game.pending(s), [HOST]);
  assert.deepEqual(game.actions(s, HOST).map((a) => a.id), ['yes', 'no', 'irrelevant', 'both']);
  assert.throws(() => game.apply(s, 'p3', '提问：再问一个'), /汤主/);
  s = game.apply(s, HOST, 'yes|她在工作');
  assert.deepEqual(s.log[0], { seat: 'p2', kind: 'q', text: '小林是在给别人当模特吗？', qn: 1, answer: 'yes', note: '她在工作' });
  assert.deepEqual(game.pending(s), ['p3']);
  s = ask(s);
  assert.deepEqual(game.pending(s), ['p4']);
  s = ask(s);
  assert.deepEqual(game.pending(s), ['p2'], '一圈后回到 2 号');
  assert.equal(s.asked, 3);
  assert.equal(game.label(start(4, 1), 'p2', '提问：她在等人吗？'), '提问：她在等人吗？');
});

test('汤主的行动校验：只认四种回答、补充不超过 20 字、判定编号在范围内', () => {
  let s = game.apply(start(4, 1), 'p2', '提问：她在等人吗？');
  assert.throws(() => game.apply(s, HOST, 'maybe'), /是 \/ 不是/);
  assert.throws(() => game.apply(s, HOST, `no|${'很'.repeat(NOTE_MAX + 1)}`), /补充/);
  assert.equal(game.apply(s, HOST, `no|${'很'.repeat(NOTE_MAX)}`).log[0].note.length, NOTE_MAX);
  s = game.apply(start(4, 1), 'p2', '还原：她在给画家当模特');
  assert.equal(s.phase, 'judge');
  assert.equal(game.actions(s, HOST).length, 1 << pts(s), '判定的行动是要点的全部组合');
  assert.throws(() => game.apply(s, HOST, 'hit:4'), /1–3/);
  assert.throws(() => game.apply(s, HOST, 'yes'), /hit/);
  assert.deepEqual(parseHitId('hit:3,1,1', 3), { hits: [1, 3] });
  assert.deepEqual(parseHitId('hit:none', 3), { hits: [] });
  assert.deepEqual(parseHitId('hit:', 3), { hits: [] });
  assert.deepEqual(parseAnswerId('both|一半对'), { answer: 'both', note: '一半对' });
});

test('还原：命中全部要点即获胜、对局结束；汤主不计分并和最后一名同名次', () => {
  let s = start(4, 1);
  s = ask(s);
  s = solve(s, [1, 2]);
  assert.equal(s.best.p3, 2);
  assert.equal(s.tries.p3, 1);
  assert.equal(game.outcome(s).over, false);
  assert.deepEqual(game.pending(s), ['p4']);
  s = solve(s, [1, 2, 3], '小林给写生的画家当模特，画的就是撑伞的女人');
  const o = game.outcome(s);
  assert.equal(o.over, true);
  assert.equal(o.winner, 'p4');
  assert.deepEqual(o.unrated, [HOST]);
  assert.deepEqual(o.ranks, { p4: 1, p3: 2, p2: 3, p1: 3 });
  assert.match(o.reason, /4 号第 1 次还原命中全部 3 个要点/);
  assert.throws(() => game.apply(s, 'p2', '提问：还能问吗'), /结束/);
});

test('还原次数用完的人不再轮到；所有人都用完时对局结束，按最好命中排名', () => {
  let s = start(3, 1); // 两位猜题者
  s = solve(s, [1]); // p2 第 1 次
  s = solve(s, [1, 2]); // p3 第 1 次
  s = solve(s, []); // p2 第 2 次
  assert.equal(s.tries.p2, MAX_TRIES);
  assert.deepEqual(game.pending(s), ['p3']);
  s = ask(s); // p3 提问，下一轮还是 p3（p2 没有机会了）
  assert.deepEqual(game.pending(s), ['p3']);
  s = game.apply(s, 'p3', '还原：随便猜一个');
  assert.equal(game.parseReply(s, HOST, '判定：1').action, 'hit:1');
  s = game.apply(s, HOST, 'hit:1');
  const o = game.outcome(s);
  assert.equal(o.over, true);
  assert.deepEqual(o.ranks, { p3: 1, p2: 2, p1: 2 });
  assert.equal(o.winner, 'p3');
  assert.match(o.reason, /还原机会都用完/);
  // 用完了还想还原：拒绝
  let t = start(3, 1);
  t = solve(t, [1]); t = ask(t); t = solve(t, []);
  t.turn = 'p2'; // 硬把回合交给机会已用完的 2 号
  assert.throws(() => game.apply(t, 'p2', '还原：再来一次'), /用完/);
  assert.match(game.parseReply(t, 'p2', '胜率：1%\n还原：再来').error, /用完/);
});

test('提问次数用完：进入最后还原，每位还有机会的人各还原一次，不能再提问；都不中按最好命中排名，并列为平局', () => {
  let s = start(3, 1); // maxQ = 16
  for (let i = 0; i < 15; i++) s = ask(s);
  assert.equal(s.final, false);
  s = ask(s);
  assert.equal(s.asked, 16);
  assert.equal(s.final, true);
  assert.equal(s.phase, 'final');
  assert.deepEqual(game.pending(s), ['p2'], '最后一问是 3 号问的，从 2 号开始');
  assert.throws(() => game.apply(s, 'p2', '提问：还能问吗？'), /只能还原/);
  assert.equal(game.parseReply(s, 'p2', '判断：x\n胜率：10%\n提问：他是谁？').error, '提问次数已经用完，现在只能还原');
  s = game.apply(s, 'p2', '他给画家当模特'); // 没写前缀，最后阶段当还原
  assert.equal(s.log.at(-1).kind, 'r');
  s = game.apply(s, HOST, 'hit:1');
  assert.deepEqual(game.pending(s), ['p3']);
  s = solve(s, [2]);
  const o = game.outcome(s);
  assert.equal(o.over, true);
  assert.equal(o.winner, null, '都命中 1 个：平局');
  assert.deepEqual(o.ranks, { p2: 1, p3: 1, p1: 1 });
  assert.match(o.reason, /并列第一/);
  assert.equal(game.view(s, '*').truth, puzzleOf(s).truth, '终局公开汤底');
});

test('超时放弃本回合：不消耗还原次数，但占一次提问名额；框架的超时代打得到合法行动', async () => {
  let s = start(4, 1);
  assert.equal(await timeoutAction(game, s, 'p2', 4), '（超时，没有发言）');
  s = game.apply(s, 'p2', '（超时，没有发言）');
  assert.equal(s.tries.p2, 0);
  assert.equal(s.asked, 1);
  assert.equal(s.log[0].kind, 'pass');
  assert.deepEqual(game.pending(s), ['p3']);
  assert.equal(game.label(start(4, 1), 'p2', '过。'), '跳过本回合');
  assert.equal(parseGuess('过来的人是谁？').kind, 'q', '「过」开头的问题不算放弃');
  // 汤主超时：内置汤主按关键词代答
  s = game.apply(s, 'p3', '提问：小林是在给别人当模特吗？');
  assert.equal(await timeoutAction(game, s, HOST, 4), 'yes');
  s = game.apply(s, HOST, 'yes');
  s = game.apply(s, 'p4', '还原：她给画家当模特');
  const j = await timeoutAction(game, s, HOST, 4);
  assert.equal(j, 'hit:1,2');
  // 最后还原阶段超时：放弃最后机会
  let f = start(3, 1);
  for (let i = 0; i < 16; i++) f = ask(f);
  f = game.apply(f, 'p2', '（超时，没有发言）');
  assert.deepEqual(game.pending(f), ['p3']);
  f = game.apply(f, 'p3', '（超时，没有发言）');
  assert.equal(game.outcome(f).over, true);
});

test('解析猜题者的回答：提问、还原（多行、超长收尾）、全角冒号和方括号', () => {
  const s = start(4, 1);
  const p = (t) => game.parseReply(s, 'p2', t);
  assert.equal(p('判断：线索不多\n推断：可能是工作\n计划：问职业\n胜率：20%\n提问：她是在工作吗？').action, '提问：她是在工作吗？');
  assert.equal(p('胜率：20%\n【提问】：她是在工作吗？').action, '提问：她是在工作吗？');
  assert.equal(p('胜率：33%\n提问:  「她在等人吗」').action, '提问：她在等人吗');
  assert.equal(p('胜率：33%\n提问：她在等人吗').winrate, 33);
  const multi = p('判断：够了\n胜率：60%\n还原：小林给画家当模特，\n画家要画撑伞的女人，按小时付钱。');
  assert.equal(multi.action, '还原：小林给画家当模特， 画家要画撑伞的女人，按小时付钱。');
  const long = p(`胜率：5%\n还原：${'她在广场上当模特。'.repeat(40)}`);
  assert.ok(long.action && [...long.action.replace(/^还原：/, '')].length <= R_MAX);
  assert.ok(game.parseReply(s, 'p2', `提问：${'问'.repeat(Q_MAX + 10)}`).action.length <= Q_MAX + 3);
  assert.match(p('判断：不知道\n胜率：0%').error, /提问：/);
  assert.match(p('提问：').error, /不能为空/);
  assert.equal(game.parseReply(s, 'p3', '提问：她在等人吗').error, '现在不需要你行动');
  assert.match(game.apply(s, 'p2', '问：她在等人吗').log[0].text, /她在等人吗/);
  assert.throws(() => game.apply(s, 'p2', '这是一个没有写前缀而且特别长的句子'.repeat(5)), /提问/);
});

test('解析汤主的回答：四种回答、补充、各种写法；判定的编号写法', () => {
  let s = game.apply(start(4, 1), 'p2', '提问：她在等人吗？');
  const p = (t) => game.parseReply(s, HOST, t).action;
  assert.equal(p('判断：x\n理由：y\n胜率：40%\n回答：是'), 'yes');
  assert.equal(p('回答：不是'), 'no');
  assert.equal(p('回答：不是，补充：她不在等任何人'), 'no|她不在等任何人');
  assert.equal(p('回答: 无关'), 'irrelevant');
  assert.equal(p('回答：不相关'), 'irrelevant');
  assert.equal(p('回答：是也不是（一半对）'), 'both|一半对');
  assert.equal(p('回答：「否」'), 'no');
  assert.equal(p('判断：x\n是'), 'yes', '没写「回答：」时看最后一行');
  const longNote = p(`回答：是，补充：${'这个问题问得很好'.repeat(5)}`);
  assert.ok(longNote.startsWith('yes|') && [...longNote.slice(4)].length <= NOTE_MAX);
  assert.match(game.parseReply(s, HOST, '回答：也许吧').error, /无法识别/);
  s = game.apply(start(4, 1), 'p2', '还原：她给画家当模特');
  const j = (t) => game.parseReply(s, HOST, t);
  assert.equal(j('判断：x\n胜率：30%\n判定：1、2').action, 'hit:1,2');
  assert.equal(j('判定：第二条和第三条（二、三）').action, 'hit:2,3');
  assert.equal(j('判定：１，３').action, 'hit:1,3');
  assert.equal(j('判定：无').action, 'hit:none');
  assert.equal(j('判定：全部命中').action, 'hit:1,2,3');
  assert.match(j('判定：2 个').error, /编号/);
  assert.match(j('判定：4').error, /只有 3 个要点/);
  assert.match(j('判断：说中了两条').error, /没有找到判定/);
});

test('内置汤主：按关键词答题，答不上答「无关」；红汤问死人答是，清汤答不是；内置判定按要点关键词', () => {
  const sun = PUZZLES.find((p) => p.id === 1);
  assert.equal(builtinAnswer(sun, '有画家在画她吗？'), 'yes');
  assert.equal(builtinAnswer(sun, '撑伞是为了防晒吗？'), 'no');
  assert.equal(builtinAnswer(sun, '今天是星期几？'), 'irrelevant');
  assert.equal(builtinAnswer(sun, '有人死了吗？'), 'no');
  assert.equal(builtinAnswer(sun, '有鬼吗？'), 'no');
  const pot = PUZZLES.find((p) => p.id === 4);
  assert.equal(builtinAnswer(pot, '有人死了吗？'), 'yes');
  const parrot = PUZZLES.find((p) => p.id === 13);
  const whistleOf = () => PUZZLES.find((p) => p.id === 7);
  assert.equal(builtinAnswer(parrot, '老人是病死的吗？'), 'no', '更具体的「病死」压过「死」');
  const ghost = PUZZLES.find((p) => p.id === 24);
  assert.equal(builtinAnswer(ghost, '故事里有超自然的力量吗？'), 'yes');
  // 性别只按主角答；问配角的性别答「无关」，不被「女人」「男的」这些词带偏
  assert.equal(builtinAnswer(sun, '主角是女的吗？'), 'yes');
  assert.equal(builtinAnswer(sun, '小林是男的吗'), 'no');
  assert.equal(builtinAnswer(sun, '她是女性吗？'), 'yes');
  assert.equal(builtinAnswer(parrot, '凶手是男的吗？'), 'irrelevant');
  assert.equal(builtinAnswer(pot, '那个男人是故意的吗？'), 'yes', '只是提到「男人」，不是问性别');
  const photo = PUZZLES.find((p) => p.id === 12);
  assert.equal(builtinAnswer(photo, '照片里的女人和他有血缘关系吗？'), 'yes');
  assert.equal(builtinAnswer(photo, '那个女人是他的前女友吗？'), 'no');
  // 「还有别人吗」：别的词都没对上时按题目的 others 答；对上了别的词就听别的词的
  assert.equal(builtinAnswer(PUZZLES.find((p) => p.id === 14), '店里还有别人吗？'), 'yes');
  assert.equal(builtinAnswer(PUZZLES.find((p) => p.id === 16), '还有别人参与了这件事吗？'), 'no');
  assert.equal(builtinAnswer(whistleOf(), '口哨是别人在开玩笑吗？'), 'no');
  assert.equal(builtinAnswer(PUZZLES.find((p) => p.id === 21), '她在等去世的丈夫吗？'), 'no');
  // 多组关键词的要点：要同时说到
  const whistle = PUZZLES.find((p) => p.id === 7);
  assert.deepEqual(judgeHits(whistle, '队友吹了口哨'), []);
  assert.deepEqual(judgeHits(whistle, '吹口哨的队友遇难了'), [3]);
});

test('内置 AI 跑完 60 盘：不抛错、能结束、记录重放一致；有人还原成功也有人没成功', () => {
  let solvedCount = 0;
  let unsolved = 0;
  for (let i = 0; i < 60; i++) {
    const players = 3 + (i % 4);
    const { state, actions } = playOut(players, 500 + i);
    const o = game.outcome(state);
    assert.equal(o.over, true, `第 ${i} 盘没结束`);
    assert.deepEqual(o.unrated, [HOST]);
    assert.equal(Object.keys(o.ranks).length, players);
    assert.equal(o.ranks[HOST], Math.max(...Object.values(o.ranks)));
    if (state.solved) { solvedCount++; assert.equal(o.ranks[state.solved], 1); } else unsolved++;
    assert.deepEqual(replay(game, { players, seed: 500 + i, actions }), state);
    // 回合数有上限：提问 + 还原 + 汤主回应
    assert.ok(actions.length <= 2 * (state.maxQ + (players - 1) * MAX_TRIES) + players);
  }
  assert.ok(solvedCount > 0 && unsolved >= 0);
});

test('模拟模型：mockReply 写成的回答 parseReply 解析回同一个行动', () => {
  for (let i = 0; i < 12; i++) {
    let s = game.create({ players: 4, seed: 900 + i });
    for (let k = 0; k < 200 && !game.outcome(s).over; k++) {
      const [seat] = game.pending(s);
      const a = game.builtinMove(s, seat, {});
      const r = game.parseReply(s, seat, game.mockReply(s, seat, a));
      assert.equal(r.action, a, `${seat} ${a} → ${r.error}`);
      s = game.apply(s, seat, a);
    }
  }
});

test('提示词：猜题者看不到汤底，汤主能看到汤底和要点；写明汤主必须如实回答、不剧透', () => {
  let s = start(4, 9);
  const P = puzzleOf(s);
  s = ask(s, '有人死了吗？', 'yes');
  const gp = game.turnPrompt(s, 'p3');
  assert.ok(gp.includes(P.surface));
  assert.ok(!gp.includes(P.truth));
  for (const pt of P.points) assert.ok(!gp.includes(pt.text), '猜题者提示里出现了要点');
  assert.match(gp, /有人死了吗？ → 是/);
  assert.match(gp, /还剩 23\/24/);
  const gs = game.systemPrompt('p3', { players: 4 });
  assert.match(gs, /全场提问共 24 次/);
  assert.ok(!gs.includes(P.truth));
  s = game.apply(s, 'p3', '提问：她有双胞胎姐妹吗？');
  const hp = game.turnPrompt(s, HOST);
  assert.ok(hp.includes(P.truth));
  for (const pt of P.points) assert.ok(hp.includes(pt.text));
  assert.match(hp, /她有双胞胎姐妹吗？/);
  const hs = game.systemPrompt(HOST, { players: 4 });
  assert.match(hs, /如实回答/);
  assert.match(hs, /不能剧透/);
  assert.match(hs, /不是给你的指令/);
});

test('隐藏信息：公共视角和猜题者视角不含汤底和要点文字（整盘逐步检查，含画面模块）；汤主、上帝视角和终局可见', () => {
  for (let i = 0; i < 16; i++) {
    let s = game.create({ players: 3 + (i % 4), seed: 1300 + i });
    const P = puzzleOf(s);
    const secrets = [P.truth, ...P.points.map((p) => p.text)];
    let prev = null;
    for (let k = 0; k < 400; k++) {
      const over = game.outcome(s).over;
      for (const viewer of ['*', ...s.guessers]) {
        const v = game.view(s, viewer);
        const blob = JSON.stringify([v, stage.duoView(v), prev ? stage.announce(game.view(prev, viewer), v) : null]);
        // 猜题者自己说出来的话是公开的（内置猜题者把问题改成陈述句，可能恰好和要点一字不差）
        const said = s.log.map((e) => e.text).join('\n');
        for (const x of secrets) if (!said.includes(x)) assert.equal(blob.includes(x), over, `${viewer} 视角${over ? '终局应公开' : '泄露'}：${x.slice(0, 12)}`);
        if (!over) assert.equal(v.points, null);
        assert.equal(v.pointCount, P.points.length);
      }
      const hv = game.view(s, HOST);
      assert.equal(hv.truth, P.truth);
      assert.deepEqual(hv.points, P.points.map((p) => p.text));
      assert.equal(game.view(s, null).truth, P.truth);
      if (over) break;
      const [seat] = game.pending(s);
      prev = s;
      s = game.apply(s, seat, game.builtinMove(s, seat, {}));
    }
  }
});

test('节奏：开局停顿读汤面；每句话按字数停；判定、进入最后还原、终局加一张公告卡', () => {
  let s = start(3, 1);
  assert.equal(game.interlude(null, s), INTRO_MS);
  assert.equal(stage.pauseAfter(null, game.view(s, null)), INTRO_MS);
  let n = game.apply(s, 'p2', '提问：她在等人吗？');
  assert.equal(game.interlude(s, n), speechPause('她在等人吗？'));
  s = n; n = game.apply(s, HOST, 'no|和等人无关');
  assert.equal(game.interlude(s, n), speechPause('不是 · 和等人无关'));
  assert.equal(stage.announce(game.view(s, null), game.view(n, null)), null);
  s = n; n = game.apply(s, 'p3', '还原：她在当模特');
  s = n; n = game.apply(s, HOST, 'hit:1');
  assert.equal(game.interlude(s, n), speechPause('命中 1 · 1/3') + CARD_MS);
  const a = stage.announce(game.view(s, '*'), game.view(n, '*'));
  assert.equal(a.title, '3 号还原 · 命中 1/3');
  assert.equal(a.ms, CARD_MS);
  assert.equal(stage.pauseAfter(game.view(s, '*'), game.view(n, '*')), CARD_MS);
  // 还原成功
  s = n; n = game.apply(s, 'p2', '还原：全对');
  s = n; n = game.apply(s, HOST, 'hit:1,2,3');
  assert.equal(stage.announce(game.view(s, '*'), game.view(n, '*')).title, '2 号还原成功');
  // 进入最后还原
  let f = start(3, 1);
  for (let i = 0; i < 15; i++) f = ask(f);
  const g = game.apply(f, 'p3', '提问：最后一问？');
  const h = game.apply(g, HOST, 'irrelevant');
  assert.equal(game.interlude(g, h), speechPause('无关') + CARD_MS);
  assert.equal(stage.announce(game.view(g, '*'), game.view(h, '*')).title, '提问次数用完');
});

test('画面模块：座位卡的发言和 view.speeches 一致（逐字打字对得上），场景条标题', () => {
  let s = start(4, 1);
  s = ask(s, '她在等人吗？', 'no|不是等人');
  s = solve(s, [1]);
  const v = game.view(s, '*');
  const d = stage.duoView(v);
  assert.deepEqual(d.seats.p2.said, [{ tag: '第 1 问', text: '她在等人吗？' }]);
  assert.deepEqual(d.seats.p3.said, [{ tag: '还原 1', text: '我觉得是这样的故事' }]);
  assert.deepEqual(d.seats.p1.said.map((x) => x.text), ['不是 · 不是等人', '命中 1 · 1/3']);
  assert.deepEqual(v.speeches.map((x) => x.text), ['她在等人吗？', '不是 · 不是等人', '我觉得是这样的故事', '命中 1 · 1/3']);
  assert.equal(d.seats.p1.role.text, '汤主');
  assert.equal(d.seats.p3.role.text, '命中 1/3');
  // 还原交上去、汤主还没判定：座位卡上不先挂「命中 0/k」
  const pend = game.apply(s, game.pending(s)[0], '还原：再猜一次');
  assert.equal(stage.duoView(game.view(pend, '*')).seats.p4.role, null);
  assert.equal(d.seats.p4.state, 'speaking');
  assert.match(d.scene.title, /第 2 问 · 轮到 4 号/);
  s = solve(s, [1, 2, 3]);
  const e = stage.duoView(game.view(s, 'p2'));
  assert.equal(e.scene.kind, 'over');
  assert.match(e.scene.title, /4 号胜/);
});

test('题库只在服务端：开局参数带整道谜题，浏览器重放不需要题库', () => {
  const setup = game.prepareSetup({}, 7);
  assert.equal(typeof setup.puzzle, 'object');
  assert.ok(setup.puzzle.truth && setup.puzzle.points.length);
  assert.deepEqual(game.prepareSetup({ puzzle: 4 }, 7).puzzle.id, 4);
  setPuzzleBank([]);
  try {
    const s = game.create({ players: 4, seed: 7, setup });
    assert.equal(puzzleOf(s).truth, setup.puzzle.truth);
    assert.throws(() => game.create({ players: 4, seed: 7, setup: {} }), /题库只在服务端/);
  } finally { setPuzzleBank(PUZZLES); }
});
