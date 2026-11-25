import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../games/mahjong/index.js';
import { replay } from '../games/index.js';
import { isWin, waitsOf, shanten, scoreHand, toCounts, parseTile, tileName, pauseBetween, FX } from '../games/mahjong/rules.js';

const SEATS = ['p1', 'p2', 'p3', 'p4'];
/** 「123m456s」→ 牌的整数数组 */
const T = (txt) => {
  const out = [];
  for (const m of String(txt).matchAll(/(\d+)([msp])/g)) for (const d of m[1]) out.push('msp'.indexOf(m[2]) * 9 + Number(d) - 1);
  return out.sort((a, b) => a - b);
};
const C = (txt) => toCounts(T(txt));
const ids = (s, seat) => game.actions(s, seat).map((a) => a.id);

/**
 * 摆一个局面：定缺都已定好、轮到 turn 出牌。hands 为 { p1: '…' }，que 为 'mspm' 这样四个字母，
 * wall 为接下来要摸的牌（按顺序），melds 为 { p1: [{ k, t }] }
 */
function rig({ hands, que = 'pppp', wall = '', turn = 'p1', drawn = null, melds = {}, dealer = 'p1' }) {
  const s = game.create({ seed: 1, setup: { hands: 1 } });
  const h = s.hand;
  h.hands = SEATS.map((x) => T(hands[x] || ''));
  h.que = [...que].map((q) => 'msp'.indexOf(q));
  h.melds = SEATS.map((x) => (melds[x] || []).map((m) => ({ from: SEATS.indexOf(x), ...m, t: typeof m.t === 'string' ? T(m.t)[0] : m.t })));
  const w = T(wall);
  // 把墙换成指定顺序的牌（后面补一些凑数，保证够摸），已经摸的位置 ptr 从 0 开始
  h.wall = [...w, ...Array.from({ length: 40 }, (_, k) => k % 27)];
  h.ptr = 0;
  if (wall === 'EMPTY') { h.wall = []; }
  h.phase = 'turn';
  h.turn = SEATS.indexOf(turn);
  h.dealer = SEATS.indexOf(dealer);
  h.drawn = drawn ? T(drawn)[0] : null;
  h.played = [true, true, true, true];
  return s;
}

test('座位与基本参数', () => {
  assert.deepEqual(game.seats(4), SEATS);
  assert.deepEqual(game.seats(2), ['p1', 'p2']);
  assert.equal(game.seatName('p3'), '3 号位');
  assert.equal(game.id, 'mahjong');
  assert.equal(game.name, '麻将');
  assert.deepEqual(game.players, { min: 4, max: 4, default: 4 });
  assert.equal(game.features.hidden, true);
  assert.equal(game.features.winbar, false);
  assert.throws(() => game.create({ players: 3, seed: 1 }), /4 人/);
  assert.throws(() => game.create({ seed: 1, setup: { hands: 0 } }), /1–16/);
  assert.throws(() => game.create({ seed: 1, setup: { hands: 17 } }), /1–16/);
});

test('带种子发牌可重现：108 张、每人 13 张、庄家 14 张、可 JSON 序列化', () => {
  const a = game.create({ seed: 42 });
  const b = game.create({ seed: 42 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(game.create({ seed: 43 }).hand.hands, a.hand.hands);
  const h = a.hand;
  for (let j = 0; j < 4; j++) assert.equal(h.hands[j].length, j === h.dealer ? 14 : 13);
  const all = [...h.hands.flat(), ...h.wall.slice(h.ptr)].sort((x, y) => x - y);
  assert.equal(all.length, 108);
  assert.deepEqual(toCounts(all), new Array(27).fill(4));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  // 庄家轮转
  const dealers = new Set(Array.from({ length: 20 }, (_, i) => game.create({ seed: i }).hand.dealer));
  assert.equal(dealers.size, 4);
});

test('定缺：四家同时行动，别人的选择在玩家视角里先藏着，全定完庄家先出', () => {
  let s = game.create({ seed: 3 });
  assert.deepEqual(game.pending(s), SEATS);
  assert.deepEqual(ids(s, 'p1'), ['que:m', 'que:s', 'que:p']);
  s = game.apply(s, 'p1', 'que:m');
  assert.deepEqual(game.pending(s), ['p2', 'p3', 'p4']);
  assert.throws(() => game.apply(s, 'p1', 'que:s'), /不是/);
  const v2 = game.view(s, 'p2');
  assert.equal(v2.players[0].que, null, '别人的定缺先不公开');
  assert.equal(v2.log[0].text, '已定缺');
  assert.equal(game.view(s, 'p1').players[0].que, 'm');
  s = game.apply(s, 'p2', 'que:s');
  s = game.apply(s, 'p3', 'que:p');
  s = game.apply(s, 'p4', 'que:m');
  assert.equal(s.hand.phase, 'turn');
  assert.deepEqual(game.pending(s), [SEATS[s.hand.dealer]]);
  assert.equal(game.view(s, 'p2').players[0].que, 'm');
  assert.equal(game.interlude(game.apply(game.apply(game.apply(game.create({ seed: 3 }), 'p1', 'que:m'), 'p2', 'que:s'), 'p3', 'que:p'), s), FX.QUE);
});

test('手里还有缺门时只能打缺门；打出后没人能要就直接下一家摸牌', () => {
  let s = rig({ hands: { p1: '1239m 2345s 66778p', p2: '111m 222m 333m 4445s', p3: '5678m 5678s 12399s', p4: '1m 2m 3m 4m 5m 6m 7m 8m 9m 1s 2s 3s 4s' }, que: 'pmmp', wall: '9m 1p', drawn: '8p' });
  s.hand.hands[0] = [...s.hand.hands[0]]; // 14 张
  const acts = ids(s, 'p1');
  assert.deepEqual(acts.filter((a) => a.startsWith('discard:')).sort(), ['discard:6p', 'discard:7p', 'discard:8p']);
  assert.throws(() => game.apply(s, 'p1', 'discard:1m'), /必须先打/);
  s = game.apply(s, 'p1', 'discard:6p');
  // p2..p4 都要不了 6筒（p4 缺筒；p2、p3 没有 6筒）：直接轮到 p2 摸牌
  assert.equal(s.hand.phase, 'turn');
  assert.deepEqual(game.pending(s), ['p2']);
  assert.equal(s.hand.drawn, T('9m')[0]);
});

test('胡牌判定、听牌、向听数', () => {
  assert.ok(isWin(C('123m456m789m123s99s')));
  assert.ok(isWin(C('11m22m33m44m55m66m77m')), '七对');
  assert.ok(isWin(C('11m11m22m33m44m55m66m')), '四张相同算两对');
  assert.ok(!isWin(C('123m456m789m123s99p'), 0, 2), '有缺门的牌不能胡');
  assert.ok(!isWin(C('123m456m789m12s99s')));
  assert.ok(isWin(C('22s'), 4), '四组副露单钓');
  assert.deepEqual(waitsOf(C('1112345678999m'), 0, 1).map(tileName), ['1万', '2万', '3万', '4万', '5万', '6万', '7万', '8万', '9万']);
  assert.deepEqual(waitsOf(C('123m456m789m123s9p'), 0, 2), [], '单钓缺门的牌不算听');
  assert.equal(shanten(C('123m456m789m123s99s')), -1);
  assert.equal(shanten(C('123m456m789m123s9s')), 0);
  assert.equal(shanten(C('1m4m7m2s5s8s1p4p7p3m6m9m2p')), 4, '13 张里有四个嵌张 / 边张搭子');
  assert.equal(shanten(C('1122334455667m')), 0, '七对一向听差一张');
});

test('算番：常见番型、根、加番、封顶', () => {
  const fan = (h, melds = [], flags = {}, cap = 4) => scoreHand(C(h), melds, flags, cap);
  assert.equal(fan('123m456m789m123s99s').fan, 0);
  assert.equal(fan('123m456m789m123s99s').title, '平胡');
  assert.equal(fan('111m222m333m555s99s').fan, 1, '对对胡');
  assert.equal(fan('123m456m789m123m99m').fan, 2, '清一色');
  assert.equal(fan('123m456m789m123m99m').title, '清一色');
  assert.equal(fan('11m22m33m44m55m66s77s').fan, 2, '七对');
  const long = fan('11m11m22m33m44m55s66s');
  assert.equal(long.title, '龙七对');
  assert.equal(long.fan, 3);
  assert.equal(fan('11m11m22m33m44m55m66m').fan, 4, '清龙七对 5 番封顶 4');
  assert.equal(fan('11m11m22m33m44m55m66m').raw, 5);
  assert.equal(fan('11m11m22m33m44m55m66m', [], {}, 6).fan, 5);
  assert.equal(fan('111m999m123s789s11s').fan, 2, '带幺九');
  assert.equal(fan('222m555m888m222s55s').fan, 3, '将对 = 对对胡 1 + 2');
  const gold = fan('22s', [{ k: 'peng', t: T('1m')[0] }, { k: 'peng', t: T('5m')[0] }, { k: 'peng', t: T('9s')[0] }, { k: 'peng', t: T('7s')[0] }]);
  assert.equal(gold.fan, 2, '金钩钓 = 对对胡 + 1');
  // 根：四张相同（含杠）
  assert.equal(fan('111123m456s789s99s', [], {}).fan, 1, '手里四张 1万 算一根（不能当七对）');
  assert.equal(fan('123m456m99s', [{ k: 'an', t: T('5s')[0] }, { k: 'peng', t: T('7s')[0] }]).fan, 1, '暗杠算根');
  assert.equal(fan('123m456m789m123s99s', [], { gangHua: true, zimo: true }).fan, 1, '杠上花');
  assert.equal(fan('123m456m789m123s99s', [], { qiang: true }).fan, 1, '抢杠胡');
  assert.equal(fan('123m456m789m123s99s', [], { haidi: true, zimo: true }).items[0].name, '海底捞月');
  assert.equal(fan('123m456m789m123s99s', [], { tian: true }).fan, 4, '天胡直接封顶');
});

test('胡优先于碰；一炮多响两家都胡，打的人各赔一份', () => {
  // p1 缺筒、手里只有一张 5筒（必须打它）；p2 缺条、有一对 5筒能碰；p3、p4 缺万、都单钓 5筒
  let s = rig({
    hands: { p1: '123m456m789m1119s5p', p2: '55p113579m24689m', p3: '123s456s789s333p5p', p4: '234s567s789p111p5p' },
    que: 'psmm', drawn: '9s',
  });
  s = game.apply(s, 'p1', 'discard:5p');
  assert.equal(s.hand.phase, 'react');
  assert.deepEqual(game.pending(s), ['p2', 'p3', 'p4']);
  assert.deepEqual(ids(s, 'p2'), ['peng', 'pass']);
  assert.deepEqual(ids(s, 'p3'), ['hu', 'pass']);
  // 响应先藏着：别人连「谁答了」都看不到
  s = game.apply(s, 'p2', 'peng');
  assert.equal(game.view(s, 'p3').log.at(-1).text, '打 5筒');
  assert.equal(game.view(s, '*').log.at(-1).text, '打 5筒');
  assert.equal(game.view(s, 'p2').log.at(-1).text, '碰 5筒');
  assert.equal(game.view(s, null).log.at(-1).text, '碰 5筒');
  s = game.apply(s, 'p3', 'hu');
  s = game.apply(s, 'p4', 'hu');
  assert.ok(s.hand.won[2] && s.hand.won[3], '两家都胡');
  assert.equal(s.hand.melds[1].length, 0, '有人胡就不能碰');
  assert.equal(s.hand.delta[0], -2, '平胡各 1 分，打的人赔两份');
  assert.equal(s.hand.delta[2], 1);
  assert.equal(s.hand.delta[3], 1);
  // 结算后：胡公开；被截走的碰只有本人和上帝视角看得到（公开就等于说他有一对 5筒）
  const pub = game.view(s, 'p4').log.map((e) => `${e.seat} ${e.text}`);
  assert.ok(pub.includes('p3 胡 5筒') && pub.includes('p4 胡 5筒'));
  assert.ok(!pub.some((x) => x.startsWith('p2')), pub.join('|'));
  assert.ok(game.view(s, 'p2').log.some((e) => e.seat === 'p2' && e.text === '碰 5筒（被胡截走）'));
  assert.ok(game.view(s, null).log.some((e) => e.seat === 'p2' && /被胡截走/.test(e.text)));
  // 继续：从最后一个胡的人（p4）的下家开始，p1 摸牌
  assert.deepEqual(game.pending(s), ['p1']);
  assert.equal(game.interlude(null, s) > 0, true);
});

test('碰后直接打牌；明杠放杠的人付 2，补杠能被抢', () => {
  let s = rig({ hands: { p1: '1239m 2345m 66778m', p2: '55m 123s 456s 789s 11m', p3: '1s', p4: '1s' }, que: 'pppp', drawn: '9m', wall: '9p 9p 9p' });
  s.hand.hands[2] = T('123s456s789s1m2m3m4m'); s.hand.hands[3] = T('123s456s789s1m2m3m4m');
  s = game.apply(s, 'p1', 'discard:5m');
  assert.deepEqual(game.pending(s), ['p2']);
  s = game.apply(s, 'p2', 'peng');
  assert.equal(s.hand.phase, 'turn');
  assert.deepEqual(game.pending(s), ['p2']);
  assert.equal(s.hand.drawn, null);
  assert.ok(!ids(s, 'p2').includes('zimo'), '碰后不能自摸');
  assert.deepEqual(s.hand.melds[1].map((m) => [m.k, tileName(m.t)]), [['peng', '5万']]);
  assert.ok(game.view(s, null).players[0].river.at(-1).gone, '被碰走的牌从牌河拿走');

  // 明杠
  let g = rig({ hands: { p1: '1239m 2345m 66778m', p2: '555m 123s 456s 789s 1m', p3: '1s', p4: '1s' }, que: 'pppp', drawn: '9m', wall: '9p 8p 7p' });
  g.hand.hands[2] = T('123s456s789s1m2m3m4m'); g.hand.hands[3] = T('123s456s789s1m2m3m4m');
  g = game.apply(g, 'p1', 'discard:5m');
  assert.deepEqual(ids(g, 'p2'), ['gang', 'peng', 'pass']);
  g = game.apply(g, 'p2', 'gang');
  assert.equal(g.hand.delta[0], -2);
  assert.equal(g.hand.delta[1], 2);
  assert.deepEqual(game.pending(g), ['p2'], '杠后补一张');
  assert.equal(g.hand.kong, true);

  // 补杠被抢：p1 碰过 3筒，摸到第四张补杠；p3 正听 3筒
  let r = rig({ hands: { p1: '123m456m78m99m3p', p2: '147m258m369m1p4p7p2p', p3: '123m456m789m999p3p', p4: '147m258m369m1p4p7p2p' }, que: 'ssss', drawn: '3p', melds: { p1: [{ k: 'peng', t: '3p' }] }, wall: '9m' });
  assert.ok(ids(r, 'p1').includes('bugang:3p'));
  r = game.apply(r, 'p1', 'bugang:3p');
  assert.equal(r.hand.phase, 'react');
  assert.deepEqual(game.pending(r), ['p3']);
  assert.deepEqual(ids(r, 'p3'), ['hu', 'pass']);
  const passed = game.apply(r, 'p3', 'pass');
  assert.equal(passed.hand.melds[0][0].k, 'bu', '都过就补杠成功');
  assert.equal(passed.hand.delta[0], 3, '补杠每家没胡的给 1');
  r = game.apply(r, 'p3', 'hu');
  assert.equal(r.hand.melds[0][0].k, 'peng', '被抢了杠还是碰');
  assert.ok(r.hand.won[2].items.some((x) => x.name === '抢杠胡'));
  assert.equal(r.hand.delta[0], -2, '抢杠胡 1 番 = 2 分');
});

test('自摸：每家没胡的都付，并且自摸加底；暗杠每家付 2', () => {
  let s = rig({ hands: { p1: '123m456m789m123s9s', p2: '1p', p3: '1p', p4: '1p' }, que: 'pppp', drawn: '9s', wall: '1p' });
  s.hand.hands[0].push(T('9s')[0]); s.hand.hands[0].sort((a, b) => a - b);
  for (const j of [1, 2, 3]) s.hand.hands[j] = T('147m258m369m1s4s7s2s');
  assert.ok(ids(s, 'p1').includes('zimo'));
  s = game.apply(s, 'p1', 'zimo');
  assert.deepEqual(s.hand.delta, [6, -2, -2, -2], '平胡 1 分 + 加底 1，三家各付 2');
  assert.equal(s.hand.won[0].zimo, true);
  assert.deepEqual(game.pending(s), ['p2']);

  let a = rig({ hands: { p1: '5555m123s456s78s11m', p2: '1p', p3: '1p', p4: '1p' }, que: 'pppp', drawn: '1m', wall: '9s' });
  for (const j of [1, 2, 3]) a.hand.hands[j] = T('147m258m369m1s4s7s2s');
  a = game.apply(a, 'p1', 'angang:5m');
  assert.deepEqual(a.hand.delta, [6, -2, -2, -2]);
  assert.equal(a.hand.kong, true);
  assert.equal(game.view(a, 'p2').players[0].melds[0].t, null, '别人看不到暗杠是什么牌');
  assert.equal(game.view(a, null).players[0].melds[0].t, '5m');
  // 杠上花：补到的 9s 正好胡（78s 听 69s）
  assert.ok(ids(a, 'p1').includes('zimo'));
  const z = game.apply(a, 'p1', 'zimo');
  assert.ok(z.hand.won[0].items.some((x) => x.name === '杠上花'));
});

test('流局：查花猪、查大叫、退税', () => {
  // 牌墙已空，p1 打出最后一张没人要 → 结束。p2 听牌（听 9s），p3 没听牌但收过杠钱，p4 是花猪（还有缺的筒）
  let s = rig({ hands: { p1: '147m258m369m1247s5p', p2: '123m456m789m111s9s', p3: '147m258m369m1s4s7s2s', p4: '123m456m789m125s1p' }, que: 'pppp', drawn: '5p' });
  s.hand.wall = [];
  s.hand.pays.push({ kind: 'gang', from: 0, to: 2, amt: 2, text: '明杠' });
  s.hand.delta = [-2, 0, 2, 0];
  s = game.apply(s, 'p1', 'discard:5p');
  assert.equal(s.over, true);
  const last = s.last;
  assert.equal(last.end, 'wall');
  assert.deepEqual(last.seats.map((x) => x.status), ['noting', 'ting', 'noting', 'pig']);
  // 花猪 p4 赔每家不是花猪的封顶 16；p1、p3 没听牌赔 p2（平胡 0 番 = 1）；p3 退回杠钱 2
  assert.deepEqual(last.seats.map((x) => x.delta), [-2 + 16 - 1 + 2, 16 + 1 + 1, 2 + 16 - 1 - 2, -48]);
  assert.equal(s.totals.reduce((a, b) => a + b, 0), 0);
  const out = game.outcome(s);
  assert.equal(out.over, true);
  assert.equal(out.ranks.p2, 1);
  assert.equal(out.ranks.p4, 4);
});

test('解析模型回答', () => {
  let s = game.create({ seed: 8 });
  assert.equal(game.parseReply(s, 'p1', '判断：万子多\n胜率：30%\n定缺：条').action, 'que:s');
  assert.equal(game.parseReply(s, 'p1', '定缺：筒子').action, 'que:p');
  assert.equal(game.parseReply(s, 'p1', '定缺：萬').action, 'que:m');
  assert.match(game.parseReply(s, 'p1', '出牌：5万').error, /定缺/);
  assert.equal(game.parseReply(s, 'p1', '胜率：45%\n定缺：条').winrate, 45);
  for (const [seat, q] of [['p1', 'que:p'], ['p2', 'que:p'], ['p3', 'que:p'], ['p4', 'que:p']]) s = game.apply(s, seat, q);
  const d = SEATS[s.hand.dealer];
  const hand = s.hand.hands[s.hand.dealer];
  const one = hand.find((t) => Math.floor(t / 9) === 2) ?? hand[0];
  const r = game.parseReply(s, d, `判断：一般\n推断：无\n理由：先打缺门\n胜率：20%\n出牌：${tileName(one)}`);
  assert.equal(r.action, `discard:${'123456789'[one % 9]}${'msp'[Math.floor(one / 9)]}`);
  assert.equal(parseTile('出牌：五筒'), 22);
  assert.equal(parseTile('出牌：7条'), 15);
  assert.equal(parseTile('出牌：９ｍ'.normalize('NFKC')), 8);
  assert.match(game.parseReply(s, d, '出牌：过').error, /不能过/);
  assert.match(game.parseReply(s, d, '出牌：大王').error, /无法识别/);
  assert.match(game.parseReply(s, d, '判断：没写').error, /没有找到/);
  const missing = [...Array(27).keys()].find((t) => !hand.includes(t));
  assert.match(game.parseReply(s, d, `出牌：${tileName(missing)}`).error, /没有/);
  assert.match(game.parseReply(s, d, '行动：自摸').error, /不能|还没有胡/);
  const other = SEATS.find((x) => x !== d);
  assert.match(game.parseReply(s, other, '出牌：1万').error, /不是/);
  // 响应
  let rs = rig({ hands: { p1: '123m456m789m1s5p', p2: '55p123m456m789m9m', p3: '1s', p4: '1s' }, que: 'ssss', drawn: '1s' });
  rs.hand.que = [2, 1, 1, 1];
  rs.hand.hands[2] = T('147m258m369m1p4p7p2p'); rs.hand.hands[3] = T('147m258m369m1p4p8p3p');
  rs = game.apply(rs, 'p1', 'discard:5p');
  assert.deepEqual(game.pending(rs), ['p2']);
  assert.equal(game.parseReply(rs, 'p2', '理由：凑刻子\n胜率：30%\n行动：碰').action, 'peng');
  assert.equal(game.parseReply(rs, 'p2', '行动：过').action, 'pass');
  assert.equal(game.parseReply(rs, 'p2', '行动：不碰').action, 'pass');
  assert.match(game.parseReply(rs, 'p2', '行动：胡').error, /不能胡/);
  // mockReply 能被自己解析回来
  for (const a of game.actions(rs, 'p2')) assert.equal(game.parseReply(rs, 'p2', game.mockReply(rs, 'p2', a.id)).action, a.id);
});

test('隐藏信息：玩家只看到自己的手牌，任何视角都没有牌墙顺序', () => {
  const s = game.create({ seed: 21 });
  const god = game.view(s, null);
  assert.ok(god.players.every((p) => Array.isArray(p.hand)));
  for (const v of SEATS) {
    const view = game.view(s, v);
    for (const p of view.players) {
      if (p.seat === v) assert.ok(Array.isArray(p.hand));
      else { assert.equal(p.hand, null); assert.equal(p.ting, null); }
    }
    assert.ok(!JSON.stringify(view).includes('"wall":['), '不含牌墙');
  }
  const pub = game.view(s, '*');
  assert.ok(pub.players.every((p) => p.hand === null));
  assert.equal(typeof god.wall, 'number');
});

test('提示词：紧凑写法、列出可行动作；内置 AI 各档都给合法行动', () => {
  let s = game.create({ seed: 5 });
  const p = game.turnPrompt(s, 'p1');
  assert.match(p, /定缺/);
  assert.match(p, /\d+[万条筒]/);
  assert.match(game.systemPrompt('p1', { state: s }), /血战到底/);
  for (const seat of SEATS) s = game.apply(s, seat, game.builtinMove(s, seat, { level: 2 }));
  const d = game.pending(s)[0];
  const tp = game.turnPrompt(s, d);
  assert.match(tp, /可以打：/);
  assert.match(tp, /牌河/);
  for (const level of [1, 2, 3]) {
    let x = s;
    for (let k = 0; k < 120 && !game.outcome(x).over; k++) {
      for (const seat of game.pending(x)) {
        const a = game.builtinMove(x, seat, { level });
        assert.ok(ids(x, seat).includes(a), `level ${level} 给出了不合法的行动 ${a}`);
        x = game.apply(x, seat, a);
      }
    }
  }
});

test('内置 AI：能胡就胡；level 2 打孤张、留搭子', () => {
  const s = rig({ hands: { p1: '123m456m789m123s9s', p2: '1p', p3: '1p', p4: '1p' }, que: 'pppp', drawn: '9s' });
  s.hand.hands[0].push(T('9s')[0]); s.hand.hands[0].sort((a, b) => a - b);
  assert.equal(game.builtinMove(s, 'p1', { level: 1 }), 'zimo');
  assert.equal(game.builtinMove(s, 'p1', { level: 3 }), 'zimo');
  const t = rig({ hands: { p1: '123m456m789m34s 9s 1s', p2: '1p', p3: '1p', p4: '1p' }, que: 'pppp', drawn: '1s' });
  // 1s 和 9s 都是孤张；打掉其中一张后听牌，level 2 不会拆 34s 或面子
  const a = game.builtinMove(t, 'p1', { level: 2 });
  assert.ok(['discard:1s', 'discard:9s'].includes(a), a);
});

test('整场：多盘累计、庄家轮转、带种子可重现、停顿时长', () => {
  for (const seed of [1, 2, 3]) {
    // 第 3 局用规则 2：窗口里本来要不了的人由 autoAction 代答
    const setup = seed === 3 ? { hands: 3, rules: 2 } : { hands: 3 };
    let s = game.create({ seed, setup });
    const actions = [];
    const dealers = [s.hand.dealer];
    let n = 0;
    while (!game.outcome(s).over) {
      for (const seat of game.pending(s)) {
        const a = game.autoAction(s, seat) ?? game.builtinMove(s, seat, { level: 2 });
        const prev = s;
        s = game.apply(s, seat, a);
        actions.push({ seat, action: a });
        if (s.handNo !== prev.handNo) {
          dealers.push(s.hand.dealer);
          assert.ok(game.interlude(prev, s) >= FX.HU + FX.SETTLE, '一盘结束停下来看结算');
        }
      }
      assert.ok(++n < 3000);
    }
    assert.equal(s.handNo, 3);
    assert.equal(s.history.length, 3);
    assert.equal(s.totals.reduce((a, b) => a + b, 0), 0, '零和');
    assert.deepEqual(dealers, [dealers[0], (dealers[0] + 1) % 4, (dealers[0] + 2) % 4]);
    const again = replay(game, { seed, players: 4, setup, actions });
    assert.deepEqual(again, s);
    const out = game.outcome(s);
    const top = Math.max(...s.totals);
    for (const [seat, r] of Object.entries(out.ranks)) assert.equal(r === 1, s.totals[SEATS.indexOf(seat)] === top);
    assert.match(out.reason, /3 盘结束/);
  }
  assert.equal(pauseBetween(null, { handNo: 1 }), FX.DEAL);
  assert.equal(pauseBetween({ handNo: 1, wins: 0, calls: 0 }, { handNo: 1, wins: 1, calls: 0 }), FX.HU);
  assert.equal(pauseBetween({ handNo: 1, wins: 0, calls: 0 }, { handNo: 1, wins: 0, calls: 1 }), FX.CALL);
  assert.equal(pauseBetween({ handNo: 1, wins: 1, calls: 0 }, { handNo: 2, wins: 0, calls: 0, end: 'wall' }), FX.WALL + FX.SETTLE + FX.DEAL);
});

test('规则 2：响应窗口里其余没胡的人都在（代答「过」），谁真能响应对别人保密', () => {
  assert.deepEqual(game.newSetup, { rules: 2 });
  assert.throws(() => game.create({ seed: 1, setup: { rules: 3 } }), /规则版本/);
  assert.equal(game.create({ seed: 1 }).cfg.rules, 1, '旧记录没有 rules：按规则 1 重放');
  // 同「胡优先于碰」的牌：p1 打 5筒，p2 能碰，p3 能胡，p4 什么都不能
  const base = rig({
    hands: { p1: '123m456m789m1119s5p', p2: '55p113579m24689m', p3: '123s456s789s333p5p', p4: '147m258m369m1s4s7s2s' },
    que: 'psmp', drawn: '9s',
  });
  base.cfg.rules = 2;
  let s = game.apply(base, 'p1', 'discard:5p');
  assert.deepEqual(game.pending(s), ['p2', 'p3', 'p4'], 'p4 也在窗口里');
  assert.deepEqual(ids(s, 'p4'), ['pass']);
  assert.equal(game.autoAction(s, 'p4'), 'pass');
  assert.equal(game.autoAction(s, 'p2'), null, '真能响应的要问本人');
  // 私密步：定缺、响应窗口里的每一步、暗杠
  assert.equal(game.secret(s, 'p2', null), true);
  assert.equal(game.secret(s, 'p4', 'pass'), true);
  assert.equal(game.secret(game.create({ seed: 1 }), 'p1', null), true, '定缺');
  assert.equal(game.secret(base, 'p1', null), false, '轮到谁出牌是公开的');
  assert.equal(game.secret(base, 'p1', 'discard:5p'), false);
  assert.equal(game.secret(base, 'p1', 'angang:5m'), true);
  s = game.apply(s, 'p4', 'pass');
  s = game.apply(s, 'p2', 'pass');
  s = game.apply(s, 'p3', 'pass');
  assert.equal(s.hand.phase, 'turn');
  assert.deepEqual(game.pending(s), ['p2']);
  // 代答的过不记；真过的只有本人和上帝视角看得到
  assert.ok(!game.view(s, null).log.some((e) => e.seat === 'p4' && e.text === '过'));
  assert.ok(game.view(s, null).log.some((e) => e.seat === 'p3' && e.text === '过'));
  assert.ok(game.view(s, 'p3').log.some((e) => e.seat === 'p3' && e.text === '过'));
  for (const v of ['p1', 'p4', '*']) assert.ok(!game.view(s, v).log.some((e) => e.text === '过'), v);
  // 没人能要的牌不开窗口
  const quiet = rig({ hands: { p1: '1239m 2345s 66778p', p2: '111m 222m 333m 4445s', p3: '5678m 5678s 12399s', p4: '1m 2m 3m 4m 5m 6m 7m 8m 9m 1s 2s 3s 4s' }, que: 'pmmp', wall: '9m 1p', drawn: '8p' });
  quiet.cfg.rules = 2;
  assert.deepEqual(game.pending(game.apply(quiet, 'p1', 'discard:6p')), ['p2']);
  // 补杠每次都开窗口（不然「停下来问」就说明有人在等这张），都过就杠成
  let r = rig({ hands: { p1: '123m456m78m99m3p', p2: '147m258m369m1p4p7p2p', p3: '147m258m369m1p4p7p2p', p4: '147m258m369m1p4p7p2p' }, que: 'ssss', drawn: '3p', melds: { p1: [{ k: 'peng', t: '3p' }] }, wall: '9m' });
  r.cfg.rules = 2;
  r = game.apply(r, 'p1', 'bugang:3p');
  assert.equal(r.hand.phase, 'react');
  assert.deepEqual(game.pending(r), ['p2', 'p3', 'p4']);
  for (const x of ['p2', 'p3', 'p4']) r = game.apply(r, x, game.autoAction(r, x));
  assert.equal(r.hand.melds[0][0].k, 'bu');
  assert.deepEqual(game.pending(r), ['p1'], '杠后补一张');
});

test('暗杠：别人看到「暗杠」，不知道是哪张（记录和事件都不带牌）', () => {
  let a = rig({ hands: { p1: '5555m123s456s78s11m', p2: '1p', p3: '1p', p4: '1p' }, que: 'pppp', drawn: '1m', wall: '9s' });
  for (const j of [1, 2, 3]) a.hand.hands[j] = T('147m258m369m1s4s7s2s');
  a = game.apply(a, 'p1', 'angang:5m');
  const other = game.view(a, 'p2');
  assert.equal(other.log.at(-1).text, '暗杠');
  assert.equal(other.ev.type, 'gang');
  assert.equal(other.ev.t, null);
  assert.equal(game.view(a, '*').ev.t, null);
  assert.equal(game.view(a, 'p1').log.at(-1).text, '暗杠 5万');
  assert.equal(game.view(a, null).ev.t, '5m');
  assert.ok(!JSON.stringify({ ...other, players: other.players.filter((p) => p.seat !== 'p2') }).includes('5m'), '玩家视角里（除了自己的手牌）哪里都没有 5万');
});

test('解析：宽松写法', () => {
  let s = game.create({ seed: 8 });
  assert.equal(game.parseReply(s, 'p1', '定缺：s').action, 'que:s');
  assert.equal(game.parseReply(s, 'p1', '胜率：约 25%\n定缺：万').winrate, 25);
  for (const seat of SEATS) s = game.apply(s, seat, 'que:p');
  const d = SEATS[s.hand.dealer];
  const t = s.hand.hands[s.hand.dealer].find((x) => Math.floor(x / 9) === 2);
  const nm = tileName(t), code = `${(t % 9) + 1}p`;
  for (const txt of [`出牌：${nm}（等自摸）`, `出牌：${nm}，先不杠`, `行动：打${nm}`, `我打${nm}`, `出牌：「${nm}」。`, `出牌：${code}`]) {
    assert.equal(game.parseReply(s, d, `判断：x\n胜率：30%\n${txt}`).action, `discard:${code}`, txt);
  }
  assert.match(game.parseReply(s, d, `胜率：30%\n判断：先打${nm}`).error, /没有找到/);
  let rs = rig({ hands: { p1: '123m456m789m1s5p', p2: '55p123m456m789m9m', p3: '1s', p4: '1s' }, que: 'ssss', drawn: '1s' });
  rs.hand.que = [2, 1, 1, 1];
  rs.hand.hands[2] = T('147m258m369m1p4p7p2p'); rs.hand.hands[3] = T('147m258m369m1p4p8p3p');
  rs = game.apply(rs, 'p1', 'discard:5p');
  assert.equal(game.parseReply(rs, 'p2', '行动：碰，过两巡再说').action, 'peng');
  assert.equal(game.parseReply(rs, 'p2', '行动：过（不碰）').action, 'pass');
  assert.equal(game.parseReply(rs, 'p2', '碰').action, 'peng');
});

test('认输：犯规者垫底，其余按分数', () => {
  const s = game.create({ seed: 4 });
  s.totals = [5, -3, 0, -2];
  const out = game.forfeit(s, 'p1', '1 号位超时');
  assert.equal(out.ranks.p1, 4);
  assert.equal(out.ranks.p3, 1);
  assert.equal(out.winner, 'p3');
});
