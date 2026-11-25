import test from 'node:test';
import assert from 'node:assert/strict';
import game, { revealPlan, pauseBetween, parseCards, T, decodePlay, encodePlay } from '../games/liar/index.js';
import { replay } from '../games/index.js';

/** 改写当前这一轮：桌牌、各家手牌、轮到谁；可选每人子弹位置和已扣次数 */
function rig(state, { table = 'Q', hands, turn, bullets, pulls, pile = [] }) {
  const s = structuredClone(state);
  s.round.table = table;
  s.round.hands = Object.fromEntries(Object.entries(hands).map(([k, v]) => [k, v.split(' ').filter(Boolean)]));
  s.round.turn = turn;
  s.round.lead = turn;
  s.round.pile = pile;
  if (bullets) Object.assign(s.bullets, bullets);
  if (pulls) Object.assign(s.pulls, pulls);
  return s;
}
const ids = (s, seat = s.round.turn) => game.actions(s, seat).map((a) => a.id);
/** 行动列表的牌面（出牌的 id 是暗码，牌面在 cards 里；质疑是 call） */
const faces = (s, seat = s.round.turn) => game.actions(s, seat).map((a) => a.cards || a.id);
/** 暗码解回牌面（质疑原样返回） */
const plain = (s, seat, a) => (a === 'call' || a === null ? a : decodePlay(s, seat, a));
const run = (s, ...moves) => moves.reduce((st, m) => game.apply(st, st.round.turn, m), s);

test('座位与基本参数', () => {
  assert.equal(game.id, 'liar');
  assert.equal(game.name, '吹牛左轮');
  assert.deepEqual(game.players, { min: 2, max: 4, default: 4 });
  assert.deepEqual(game.seats(2), ['p1', 'p2']);
  assert.deepEqual(game.seats(4).slice(0, 3), game.seats(3));
  assert.equal(game.seatName('p3'), '3 号位');
  assert.equal(game.features.hidden, true);
  assert.equal(game.features.winbar, false);
});

test('带种子发牌可重现：20 张牌（Q K A 各 6 + 鬼 2），每人 5 张，桌牌是 Q/K/A 之一', () => {
  const a = game.create({ players: 4, seed: 42 });
  assert.deepEqual(a, game.create({ players: 4, seed: 42 }));
  assert.notDeepEqual(game.create({ players: 4, seed: 43 }).round.hands, a.round.hands);
  const all = Object.values(a.round.hands).flat().sort();
  assert.equal(all.length, 20);
  for (const [r, n] of [['Q', 6], ['K', 6], ['A', 6], ['鬼', 2]]) assert.equal(all.filter((c) => c === r).length, n, r);
  for (const h of Object.values(a.round.hands)) assert.equal(h.length, 5);
  assert.ok(['Q', 'K', 'A'].includes(a.round.table));
  for (const b of Object.values(a.bullets)) assert.ok(b >= 1 && b <= 6);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'state 能 JSON 序列化');
  const two = game.create({ players: 2, seed: 1 });
  assert.deepEqual(Object.keys(two.round.hands).sort(), ['p1', 'p2']);
  // 先手、桌牌、子弹都会随种子变化
  const tables = new Set(Array.from({ length: 30 }, (_, i) => game.create({ seed: i }).round.table));
  assert.equal(tables.size, 3);
  const leads = new Set(Array.from({ length: 30 }, (_, i) => game.create({ seed: i }).round.lead));
  assert.equal(leads.size, 4);
});

test('每轮第一手不能质疑；出 1–3 张，牌面按 Q K A 鬼 排好', () => {
  const s = rig(game.create({ players: 3, seed: 1 }), { hands: { p1: 'Q K A 鬼 鬼', p2: 'Q Q Q K K', p3: 'A A A A K' }, turn: 'p1' });
  const a = faces(s);
  assert.ok(!a.includes('call'));
  assert.ok(a.includes('Q K 鬼') && a.includes('鬼 鬼') && a.includes('Q'));
  assert.ok(a.every((x) => x.split(' ').length <= 3));
  assert.equal(new Set(a).size, a.length, '同牌面的组合只列一次');
  assert.throws(() => game.apply(s, 'p1', 'call'), /不能质疑/);
  assert.throws(() => game.apply(s, 'p1', 'Q K A 鬼'), /1–3 张/);
  assert.throws(() => game.apply(s, 'p1', 'Q Q'), /没有/);
  assert.throws(() => game.apply(s, 'p2', 'Q'), /不是/);
  const n = game.apply(s, 'p1', '鬼 Q');
  assert.deepEqual(n.round.hands.p1, ['K', 'A', '鬼']);
  assert.deepEqual(n.round.pile, [{ seat: 'p1', cards: ['Q', '鬼'] }]);
  assert.equal(n.round.turn, 'p2');
  assert.ok(ids(n).includes('call'), '下一位可以质疑');
  assert.deepEqual(s.round.pile, [], 'apply 不修改原 state');
});

test('出牌暗码：行动 id 看不出牌面，能解回牌面、能重放；旧记录的明文牌面照旧认', () => {
  const s = rig(game.create({ players: 3, seed: 1 }), { hands: { p1: 'Q K A 鬼 鬼', p2: 'Q Q Q K K', p3: 'A A A A K' }, turn: 'p1' });
  const acts = game.actions(s, 'p1');
  const codes = acts.map((a) => a.id);
  assert.equal(new Set(codes).size, codes.length, '暗码不重复');
  for (const a of acts) {
    assert.match(a.id, /^p-[0-9a-z]+$/);
    assert.doesNotMatch(a.id, /[QKA鬼 ]/);
    assert.equal(decodePlay(s, 'p1', a.id), a.cards);
    assert.equal(encodePlay(s, 'p1', a.cards), a.id);
    assert.deepEqual(game.apply(s, 'p1', a.id), game.apply(s, 'p1', a.cards), '暗码和明文出牌结果一样');
  }
  // 同样的牌面换一手、换一个人、换一个种子，暗码都不一样
  const other = rig(game.create({ players: 3, seed: 2 }), { hands: { p1: 'Q K A 鬼 鬼', p2: 'Q Q Q K K', p3: 'A A A A K' }, turn: 'p1' });
  assert.notEqual(encodePlay(other, 'p1', 'Q'), encodePlay(s, 'p1', 'Q'));
  const n = game.apply(s, 'p1', encodePlay(s, 'p1', 'K'));
  assert.notEqual(encodePlay(n, 'p2', 'Q'), encodePlay({ ...s, round: { ...s.round, turn: 'p2' } }, 'p2', 'Q'));
  assert.throws(() => game.apply(s, 'p1', 'p-zzzzzzz'), /无法识别/);
  assert.throws(() => game.apply(n, 'p2', encodePlay(s, 'p1', 'Q')), /无法识别/, '别人的暗码不能用');
  // 暗码出牌是公开的一步（只露张数），明文牌面才是私密步
  assert.equal(game.secret(s, 'p1', acts[0].id), false);
  assert.equal(game.secret(s, 'p1', 'Q 鬼'), true);
  assert.equal(game.label(s, 'p1', encodePlay(s, 'p1', 'Q 鬼')), `出 2 张，称都是 ${s.round.table}`);
});

test('质疑：有一张假牌出牌的人扣扳机；全是真牌（鬼牌算真）质疑的人扣；输家先出下一轮', () => {
  const base = rig(game.create({ players: 3, seed: 2 }), { table: 'K', hands: { p1: 'K A Q Q Q', p2: 'K K 鬼 A A', p3: 'Q Q A A A' }, turn: 'p1', bullets: { p1: 6, p2: 6, p3: 6 } });
  // p1 出 K A（说谎），p2 质疑 → p1 扣第 1 枪，没响，p1 先出下一轮
  let s = run(base, 'K A', 'call');
  assert.equal(s.history.length, 1);
  assert.deepEqual(s.history[0], { round: 1, table: 'K', caller: 'p2', accused: 'p1', cards: ['K', 'A'], lie: true, loser: 'p1', pull: 1, dead: false, pile: 2, plays: 1 });
  assert.equal(s.pulls.p1, 1);
  assert.equal(s.round.no, 2);
  assert.equal(s.round.turn, 'p1');
  assert.equal(s.round.pile.length, 0);
  for (const x of ['p1', 'p2', 'p3']) assert.equal(s.round.hands[x].length, 5, '重新发牌');
  // 质疑刚结算、新一轮还没人出牌：view.result 表示「结算中」，但整局没结束
  assert.deepEqual(game.view(s, '*').result, { settling: true });
  assert.equal(game.view(s, '*').over, false);
  assert.equal(game.view(game.apply(s, 'p1', game.actions(s, 'p1')[0].id), '*').result, null, '新一轮有人出牌后不再是结算中');
  // p1 出 K（真），p2 出 K 鬼（真），p3 质疑 → p3 扣扳机，p3 先出
  s = run(base, 'K', 'K 鬼', 'call');
  assert.equal(s.history[0].lie, false);
  assert.equal(s.history[0].accused, 'p2');
  assert.equal(s.history[0].loser, 'p3');
  assert.equal(s.pulls.p3, 1);
  assert.equal(s.round.turn, 'p3');
});

test('左轮：扣到子弹那一格出局；出局后由输家的下家先出，名次按出局先后', () => {
  let s = rig(game.create({ players: 3, seed: 3 }), { table: 'Q', hands: { p1: 'A A A A A', p2: 'Q Q Q Q Q', p3: 'K K K K K' }, turn: 'p1', bullets: { p1: 2, p2: 6, p3: 1 }, pulls: { p1: 1 } });
  s = run(s, 'A', 'call');
  assert.equal(s.history[0].dead, true);
  assert.deepEqual(s.out, ['p1']);
  assert.equal(s.alive.p1, false);
  assert.equal(s.round.turn, 'p2', '输家出局，由他的下家先出');
  assert.equal(s.round.hands.p1, undefined, '出局的人不再发牌');
  assert.ok(!game.outcome(s).over);
  assert.equal(game.view(s, null).revolvers.p1.alive, false);
  assert.ok(!game.view(s, null).seats.every((x) => game.view(s, null).alive.includes(x)));
});

test('左轮：终局名次与原因', () => {
  let s = rig(game.create({ players: 3, seed: 3 }), { table: 'Q', hands: { p1: 'A A A A A', p2: 'Q Q Q Q Q', p3: 'K K K K K' }, turn: 'p1', bullets: { p1: 1, p2: 6, p3: 1 } });
  s = run(s, 'A', 'call'); // p1 说谎被抓，第 1 枪中弹
  s = rig(s, { table: 'Q', hands: { p2: 'Q Q Q Q Q', p3: 'K K K K K' }, turn: 'p2' });
  s = run(s, 'Q Q', 'K', 'call'); // p3 说谎被 p2 抓
  const o = game.outcome(s);
  assert.equal(o.over, true);
  assert.equal(game.view(s, '*').over, true);
  assert.equal(game.view(s, '*').result.winner, 'p2');
  assert.equal(o.winner, 'p2');
  assert.deepEqual(o.ranks, { p2: 1, p3: 2, p1: 3 });
  assert.match(o.reason, /2 号位活到了最后/);
  assert.deepEqual(game.pending(s), []);
  assert.throws(() => game.apply(s, 'p2', 'Q'), /结束/);
  const f = game.forfeit(rig(game.create({ players: 4, seed: 1 }), { hands: { p1: 'Q', p2: 'Q', p3: 'Q', p4: 'Q' }, turn: 'p1' }), 'p2', '2 号位超时');
  assert.equal(f.ranks.p2, 4);
  assert.equal(f.ranks.p1, 1);
});

test('手里没牌的人本轮跳过；只剩一人有牌时他只能质疑', () => {
  let s = rig(game.create({ players: 3, seed: 4 }), { table: 'A', hands: { p1: 'A A', p2: 'K', p3: 'Q Q Q Q' }, turn: 'p1', bullets: { p1: 6, p2: 6, p3: 6 } });
  s = run(s, 'A A'); // p1 出完
  assert.equal(s.round.turn, 'p2');
  s = run(s, 'K'); // p2 出完：p1 没牌跳过，轮到 p3，且只剩 p3 有牌
  assert.equal(s.round.turn, 'p3');
  assert.deepEqual(ids(s), ['call']);
  assert.equal(game.view(s, null).mustCall, true);
  assert.throws(() => game.apply(s, 'p3', 'p-0000000'), /只能质疑/);
  assert.throws(() => game.apply(s, 'p3', 'Q'), /只能质疑/);
  s = run(s, 'call');
  assert.equal(s.history[0].accused, 'p2');
  assert.equal(s.history[0].loser, 'p2');
  // 两人局：一方出完牌，另一方就是唯一有牌的人，只能质疑（所以不会出现谁都没牌的情况）
  let t = rig(game.create({ players: 2, seed: 4 }), { table: 'Q', hands: { p1: 'Q', p2: 'K' }, turn: 'p1', bullets: { p1: 6, p2: 6 } });
  t = run(t, 'Q');
  assert.equal(t.round.turn, 'p2');
  assert.deepEqual(ids(t), ['call']);
  t = run(t, 'call');
  assert.equal(t.history[0].loser, 'p2', 'p1 出的是真牌，质疑的人输');
});

test('解析模型回答：宽松识别出牌和质疑，错误给出具体理由', () => {
  const s = rig(game.create({ players: 3, seed: 5 }), { table: 'K', hands: { p1: 'Q K K A 鬼', p2: 'Q Q Q A A', p3: 'K K A A 鬼' }, turn: 'p1' });
  const p = (txt, st = s, seat = st.round.turn) => {
    const r = game.parseReply(st, seat, txt);
    return { ...r, action: plain(st, seat, r.action) };
  };
  assert.equal(p('判断：…\n胜率：40%\n行动：出牌 K K').action, 'K K');
  assert.equal(game.parseReply(s, 'p1', '行动：出牌 K K').action, encodePlay(s, 'p1', 'K K'), '解析出的是暗码');
  assert.equal(p('判断：…\n胜率：40%\n行动：出牌 K K').winrate, 40);
  assert.equal(p('行动：出牌 鬼 K').action, 'K 鬼');
  assert.equal(p('行动：出牌 KJ').action, 'K 鬼', 'J 当鬼牌');
  assert.equal(p('行动：出牌 Joker').action, '鬼');
  assert.equal(p('行动:出牌 两张K').action, 'K K');
  assert.equal(p('行动：出牌 K×2（声称都是 K）').action, 'K K');
  assert.equal(p('出牌：Q').action, 'Q');
  assert.match(p('行动：出牌 A A').error, /没有/);
  assert.match(p('行动：出牌 Q K K A').error, /1–3 张/);
  assert.match(p('行动：质疑').error, /先出/);
  assert.match(p('我想想').error, /没有找到行动/);
  assert.match(p('行动：随便').error, /没有认出牌面/);
  // 不规范的写法
  assert.equal(p('**行动**：出牌 K').action, 'K', 'Markdown 加粗');
  assert.equal(p('- 行动：出牌 K').action, 'K', '列表符号');
  assert.equal(p('胜率：约 35%\n行动：出牌 K').winrate, 35);
  assert.equal(p('行动：出牌 [K, 鬼]').action, 'K 鬼', '方括号');
  assert.equal(p('行动：出牌 Q 称 K').action, 'Q', '「称」后面是声称，不是牌');
  assert.equal(p('行动：出牌 K，声称都是 K').action, 'K');
  assert.equal(p('行动：出牌 KK').action, 'K K');
  assert.equal(p('行动：出牌 Q、K').action, 'Q K');
  assert.match(p('行动：PASS').error, /没有认出牌面/, '英文词里的 A 不算牌');
  assert.match(p('行动：出牌 OK').error, /没有认出牌面/);
  const n = game.apply(s, 'p1', 'Q');
  assert.equal(p('判断：…\n行动：质疑', n).action, 'call');
  assert.equal(p('行动：质疑！', n).action, 'call');
  assert.equal(p('行动：LIAR', n).action, 'call');
  assert.equal(p('行动：不信', n).action, 'call');
  assert.equal(p('行动：我选择质疑', n).action, 'call');
  assert.equal(p('行动：不质疑，出牌 Q Q', n).action, 'Q Q', '否定的质疑不算');
  assert.equal(p('行动：先不质疑，出牌：Q', n).action, 'Q');
  assert.equal(p('行动：出牌 Q（不质疑）', n).action, 'Q');
  assert.match(p('行动：出牌 K', n, 'p1').error, /不是/);
  for (const a of ids(n)) assert.equal(game.parseReply(n, 'p2', game.mockReply(n, 'p2', a)).action, a, `mockReply 能读回 ${a}`);
  assert.match(game.mockReply(n, 'p2', ids(n)[0]), /行动：出牌 [QKA鬼]/, 'mockReply 写的是牌面，不是暗码');
  assert.deepEqual(parseCards('Q q 鬼牌').cards, ['Q', 'Q', '鬼']);
});

test('内置 AI：各档都出合法的行动；能确定对方说谎时质疑；有真牌就诚实出', () => {
  for (let seed = 0; seed < 40; seed++) {
    let s = game.create({ players: 2 + (seed % 3), seed });
    for (let i = 0; i < 30 && !game.outcome(s).over; i++) {
      const [seat] = game.pending(s);
      for (const level of [1, 2, 3]) assert.ok(ids(s, seat).includes(game.builtinMove(s, seat, { level })), `level ${level}`);
      s = game.apply(s, seat, game.builtinMove(s, seat, { level: 2 }));
    }
  }
  // 桌牌 Q 的 6 张和 2 张鬼牌，我手里有 4 张：对方 5 张牌里出 3 张「Q」不太可能全真
  const s = rig(game.create({ players: 2, seed: 6 }), { table: 'Q', hands: { p1: 'A K K A K', p2: 'Q Q 鬼 鬼 A' }, turn: 'p1' });
  const n = game.apply(s, 'p1', 'A K K');
  for (const level of [2, 3]) assert.equal(game.builtinMove(n, 'p2', { level }), 'call');
  // 有真牌就诚实出（不质疑一张牌的小手）
  const m = game.apply(rig(game.create({ players: 2, seed: 6 }), { table: 'Q', hands: { p1: 'Q A K A K', p2: 'Q Q K A A' }, turn: 'p1' }), 'p1', 'Q');
  const a = game.builtinMove(m, 'p2', { level: 2 });
  assert.equal(plain(m, 'p2', a), 'Q Q');
  // 只能质疑时 level 1 也质疑（真人超时由系统代打要用它）
  const t = run(rig(game.create({ players: 2, seed: 4 }), { table: 'Q', hands: { p1: 'Q', p2: 'K' }, turn: 'p1' }), 'Q');
  assert.equal(game.builtinMove(t, 'p2', { level: 1 }), 'call');
});

test('隐藏信息：玩家只看自己的牌，公共视角谁的牌都看不到，任何视角都没有子弹位置', () => {
  let s = game.create({ players: 4, seed: 7 });
  s = run(s, game.builtinMove(s, s.round.turn, { level: 2 }));
  const who = s.round.pile[0].seat;
  const god = game.view(s, null);
  assert.ok(Object.values(god.hands).every((h) => Array.isArray(h)));
  assert.deepEqual(god.pile[0].cards, s.round.pile[0].cards);
  const other = game.seats(4).find((x) => x !== who);
  const mine = game.view(s, other);
  assert.deepEqual(mine.hands[other], s.round.hands[other]);
  for (const x of game.seats(4)) if (x !== other) assert.equal(mine.hands[x], null);
  assert.equal(mine.pile[0].cards, null, '别人出的牌是暗牌');
  assert.equal(mine.pile[0].n, s.round.pile[0].cards.length);
  assert.equal(mine.log[0].cards, null);
  assert.deepEqual(game.view(s, who).pile[0].cards, s.round.pile[0].cards, '自己出的牌自己知道');
  const pub = game.view(s, '*');
  assert.ok(Object.values(pub.hands).every((h) => h === null));
  for (const v of [god, mine, pub]) {
    const txt = JSON.stringify(v);
    assert.ok(!/bullet/.test(txt), '视角里没有子弹');
    assert.deepEqual(Object.keys(v.revolvers.p1).sort(), ['alive', 'chambers', 'pulls']);
  }
  // 提示词只有自己的手牌
  const tp = game.turnPrompt(s, s.round.turn);
  assert.match(tp, /你的手牌/);
  assert.match(tp, new RegExp(`桌牌：${s.round.table}`));
  assert.match(tp, /下一枪 1\/6/);
  // 明文牌面的出牌是私密的，暗码出牌和质疑是公开的；label 不暴露牌面
  assert.equal(game.secret(s, who, 'Q Q'), true);
  assert.equal(game.secret(s, who, game.actions(s, s.round.turn)[0].id), false);
  assert.equal(game.secret(s, who, 'call'), false);
  assert.equal(game.secret(s, who, null), false);
  assert.equal(game.label(s, 'p1', 'Q 鬼'), `出 2 张，称都是 ${s.round.table}`);
  assert.doesNotMatch(game.label(s, 'p1', 'Q 鬼'), /鬼/);
});

test('揭晓的停顿：出牌不额外停，质疑按翻牌张数和中弹与否停，开局翻桌牌', () => {
  assert.equal(game.turnPause, T.PLAY);
  const s = rig(game.create({ players: 3, seed: 8 }), { table: 'Q', hands: { p1: 'A A K K Q', p2: 'Q Q Q Q Q', p3: 'K K K K K' }, turn: 'p1', bullets: { p1: 1, p2: 6, p3: 6 } });
  const a = game.apply(s, 'p1', 'A A');
  assert.equal(game.interlude(s, a), 0);
  const b = game.apply(a, 'p2', 'call');
  const plan = revealPlan(2, true);
  assert.equal(game.interlude(a, b), plan.end + T.DEAL);
  assert.ok(plan.shotAt > plan.aimAt && plan.aimAt > plan.verdictAt && plan.verdictAt > plan.flipAt);
  assert.equal(game.interlude(null, s), T.DEAL);
  assert.equal(pauseBetween({ challenges: 0 }, { challenges: 1, n: 1, dead: false, over: true }), revealPlan(1, false).end);
});

test('重放：同一份记录得到同一个局面；内置 AI 跑完整局', () => {
  for (let seed = 0; seed < 12; seed++) {
    const players = 2 + (seed % 3);
    let s = game.create({ players, seed });
    const actions = [];
    for (let i = 0; i < 400 && !game.outcome(s).over; i++) {
      const [seat] = game.pending(s);
      const a = game.builtinMove(s, seat, { level: 1 + (i % 3) });
      actions.push({ seat, action: a });
      s = game.apply(s, seat, a);
    }
    assert.ok(game.outcome(s).over, `seed ${seed} 没下完`);
    assert.deepEqual(replay(game, { players, seed, actions }), s);
    const o = game.outcome(s);
    assert.deepEqual(Object.values(o.ranks).sort(), Array.from({ length: players }, (_, i) => i + 1));
  }
});
