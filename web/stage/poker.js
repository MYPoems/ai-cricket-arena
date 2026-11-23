// 德州扑克画面：漆边绿绢椭圆桌（桌沿有厚度、嵌两道金线），座位均匀环绕（2–6 人），按钮位、大小盲标在座位前。
// 实体筹码按面额配色（1 象牙、5 朱、25 青、100 墨、500 紫），一枚一枚叠起来，侧面露出条纹。
// 上帝视角：在局玩家的底牌翻开，名牌下面是实时胜率；玩家视角只看得到自己的底牌。
// 动效：新一手发牌飞入；翻牌三张依次翻开，转牌、河牌单张翻；下注时筹码从座位滑到桌前，一轮结束收进底池；
// 一手结束时先把没发完的公共牌翻完，组成牌型的五张牌抬起发光，底池推向赢家；有人全下时桌面压暗、「ALL IN」横幅、胜率对比。
// 玩家本人行动时右下角是操作台：弃牌、过牌/跟注、加注（预设 + 滑杆 + 数字）、全下。
// 每一手开始弹开局提示（第几手、盲注、庄位），结束弹结算卡（公共牌、亮出的底牌和牌型、各人输赢）；
// 停多久见 games/poker/timing.js——服务端按同一份时长停下来等，画面演完才轮到下一个人。
//
// 画面用 HTML 画：根节点是尺寸容器，桌面固定比例（横版 80×50em，竖版 50×70em），里面一律用 em 定位，等比缩放。
// 动画按「开始时刻」续播：重画时用负的 animation-delay 接上，对局推进不会打断正在进行的动画。

import { fromCode, evaluate, bestFive, code as codeOf } from '/games/poker/cards.js';
import { T as TM, cardAt, endDur, streetsBetween, pauseBetween } from '/games/poker/timing.js';

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK = { T: '10' };
const EASE = 'cubic-bezier(.2,.75,.1,1)';
const isRed = (c) => c[1] === 'h' || c[1] === 'd';
// 筹码面额：面色、镶边色、侧面深色
const DENOMS = [
  [500, '#6e3d92', '#f3d98e', '#3f1f58'],
  [100, '#26221f', '#d9b054', '#0f0d0c'],
  [25, '#2f7a68', '#f6ead0', '#164238'],
  [5, '#c8321f', '#fff1dc', '#741409'],
  [1, '#efe5cf', '#3a5a96', '#a8987a'],
];

// ---------- 版式（单位 em） ----------
const LAYOUTS = {
  land: {
    w: 80, h: 50,
    table: { cx: 40, cy: 23.4, rx: 31.5, ry: 16.5 },
    ring: { rx: 35.5, ry: 20.4 }, bets: { rx: 21.5, ry: 9.2, off: -16 }, marks: { rx: 24.5, ry: 11.6, off: 15 },
    seat: { w: 15.4, h: 4.9 }, clampX: [8.4, 71.6], clampY: [8.8, 44.4],
    board: { cx: 40, y: 16.2, cw: 5.3, gap: 0.65 },
    pot: { cx: 40, y: 24.1 }, info: [1.4, 1.2], cmp: { cx: 40, y: 27.8, w: 26 },
    ctl: { x: 50.6, y: 39.9, w: 29, h: 9.6 },
  },
  port: {
    w: 50, h: 70,
    table: { cx: 25, cy: 30.5, rx: 19.5, ry: 25 },
    ring: { rx: 21, ry: 25.2 }, bets: { rx: 12.5, ry: 16.8, off: -14 }, marks: { rx: 13.6, ry: 18.6, off: 18 },
    seat: { w: 13.8, h: 4.6 }, clampX: [7.4, 42.6], clampY: [8.8, 54.8],
    board: { cx: 25, y: 22, cw: 4.3, gap: 0.45 },
    pot: { cx: 25, y: 28.6 }, info: [1, 1], cmp: { cx: 25, y: 32.4, w: 28 },
    ctl: { x: 1, y: 60.4, w: 48, h: 9.2 },
  },
};

// ---------- 样式 ----------
const CSS = `
.pk { position: relative; width: 100%; height: 100%; container-type: size; user-select: none; -webkit-user-select: none; font-family: var(--sans); }
.pk-box { position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: min(100cqw, 160cqh); height: min(62.5cqw, 100cqh); font-size: min(1.25cqw, 2cqh); }
.pk.port .pk-box { width: min(100cqw, 71.43cqh); height: min(140cqw, 100cqh); font-size: min(2cqw, 1.4286cqh); }
.pk-box > *, .pk-layer > * { position: absolute; }
.pk-layer { inset: 0; }

/* 牌桌：漆木桌沿（外描金、内嵌金线），绿绢桌面下沉 */
.pk-rail { border-radius: 50%; border: .22em solid transparent;
  background:
    radial-gradient(60% 50% at 26% 8%, rgb(255 214 170 / .26), transparent 60%) padding-box,
    radial-gradient(closest-side, transparent 80%, rgb(0 0 0 / .45) 100%) padding-box,
    linear-gradient(180deg, #5a160c 0%, #330a06 50%, #1b0503 100%) padding-box,
    var(--edge) border-box;
  box-shadow: inset 0 .16em 0 rgb(255 226 184 / .3), inset 0 -.25em .4em rgb(0 0 0 / .55),
    0 .35em 0 #3b1607, 0 .7em 0 #1a0703, 0 .78em 0 .06em #050100, 0 1.4em 1.6em rgb(0 0 0 / .55); }
:root[data-theme="light"] .pk-rail { box-shadow: inset 0 .16em 0 rgb(255 226 184 / .3), inset 0 -.25em .4em rgb(0 0 0 / .55),
  0 .35em 0 #6a4a16, 0 .7em 0 #3e2a0a, 0 .78em 0 .06em rgb(70 44 8 / .7), 0 1.4em 1.6em rgb(80 48 10 / .42); }
.pk-felt { border-radius: 50%; overflow: hidden;
  background:
    var(--grain),
    radial-gradient(48% 40% at 32% 20%, rgb(190 255 220 / .16), transparent 70%),
    radial-gradient(70% 70% at 50% 46%, transparent 40%, rgb(0 20 12 / .55) 100%),
    repeating-linear-gradient(0deg, rgb(255 255 255 / .018) 0 .08em, transparent .08em .22em),
    repeating-linear-gradient(90deg, rgb(0 0 0 / .05) 0 .06em, transparent .06em .2em),
    linear-gradient(180deg, #1f6a52 0%, #154f3c 55%, #0d3628 100%);
  box-shadow: inset 0 .7em 1.2em rgb(0 0 0 / .6), inset 0 0 0 .08em rgb(0 0 0 / .65), 0 0 0 .12em rgb(226 186 96 / .55), 0 0 0 .3em rgb(20 4 2 / .5); }
.pk-felt::after { content: ''; position: absolute; inset: 1.6em; border-radius: 50%; border: .08em solid rgb(240 205 120 / .28); box-shadow: inset 0 .06em 0 rgb(0 0 0 / .35); }
.pk-wm > span { font-size: 9em; }
.pk-wm { font: 400 1em/1 var(--brush); color: rgb(240 225 170 / .06); translate: -50% -50%; pointer-events: none; letter-spacing: .1em; white-space: nowrap; }

/* 牌：白卡纸、圆角、卡纸厚度；font-size 决定大小（牌宽 5em、高 7em） */
.pk-c { position: absolute; width: 5em; height: 7em; border-radius: .48em; color: #1c1310;
  background: radial-gradient(120% 70% at 20% 0%, #fff, rgb(255 255 255 / 0) 60%), linear-gradient(172deg, #fffcf3 0%, #f6eedb 72%, #ecdfc1 100%);
  box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 .07em 0 #fff, inset 0 -.08em .1em rgb(150 110 50 / .18),
    0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .16em 0 rgb(60 36 8 / .55), 0 .38em .5em -.05em rgb(0 0 0 / .5); }
.pk-c.r { color: #c42d1e; }
.pk-c .ix { position: absolute; left: .34em; top: .26em; display: grid; justify-items: center; line-height: 1; }
.pk-c .ix b { font: 700 1.6em/1 var(--num); letter-spacing: -.05em; }
.pk-c .ix i { font-style: normal; font-size: 1.15em; margin-top: .06em; }
.pk-c .pip { position: absolute; right: .45em; bottom: .3em; font-size: 2.9em; line-height: 1; }
.pk-c .face { position: absolute; right: .42em; bottom: .38em; width: 2.6em; height: 3.6em; border-radius: .2em; display: grid; place-items: center; border: .05em solid currentColor;
  background: linear-gradient(180deg, rgb(201 162 74 / .18), rgb(201 162 74 / .05)); box-shadow: inset 0 0 0 .12em rgb(255 255 255 / .6), inset 0 0 0 .17em rgb(201 162 74 / .45); }
.pk-c .face b { font: 400 2.1em/1 var(--brush); }
.pk-c.bk { background:
    radial-gradient(circle at 50% 50%, #fbe8a6 0 .38em, #b8862e .42em .5em, transparent .54em),
    radial-gradient(circle at 50% 50%, transparent 0 .78em, rgb(240 205 120 / .55) .8em .86em, transparent .9em),
    repeating-linear-gradient(45deg, rgb(240 205 120 / .3) 0 .06em, transparent .06em .62em),
    repeating-linear-gradient(-45deg, rgb(240 205 120 / .3) 0 .06em, transparent .06em .62em),
    radial-gradient(90% 60% at 30% 10%, rgb(255 150 110 / .35), transparent 70%),
    linear-gradient(165deg, #c23a26 0%, #8e1b12 55%, #5e0e08 100%);
  box-shadow: inset 0 0 0 .24em #fbf3df, inset 0 0 0 .31em #d4ab52, inset 0 0 0 .36em #5e0e08, inset 0 0 0 .05em rgb(110 76 28 / .5),
    0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .16em 0 rgb(60 36 8 / .55), 0 .38em .5em -.05em rgb(0 0 0 / .5); }
.pk-c.slot { background: rgb(0 30 18 / .35); box-shadow: inset 0 .12em .3em rgb(0 0 0 / .55), 0 .06em 0 rgb(200 255 220 / .12); }
.pk-c.slot::after { content: ''; position: absolute; inset: .35em; border-radius: .3em; border: .06em dashed rgb(240 205 120 / .3); }
.pk-c.dim { filter: brightness(.62) saturate(.6); }
.pk-c.best { translate: 0 -.9em; box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 0 0 .16em #e6bd5c, inset 0 .07em 0 #fff,
  0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .16em 0 rgb(60 36 8 / .55), 0 .9em 1em -.1em rgb(0 0 0 / .5), 0 0 1.3em .2em rgb(255 214 120 / .75); }
.pk-c.fold { filter: grayscale(.8) brightness(.5); }

/* 筹码：一枚一枚叠起来；::before 是侧面（带条纹），::after 是正面（中心圆 + 边上的镶块） */
.pk-stack { position: absolute; width: 0; height: 0; }
.pk-chip { position: absolute; width: 2.3em; height: 1.24em; translate: -50% -100%; }
.pk-chip::before, .pk-chip::after { content: ''; position: absolute; left: 0; right: 0; border-radius: 50%; }
.pk-chip::before { top: .3em; bottom: -.3em; background: linear-gradient(180deg, rgb(255 255 255 / .12), rgb(0 0 0 / .35)), repeating-linear-gradient(90deg, var(--cs) 0 .34em, var(--ce) .34em .5em);
  box-shadow: 0 .05em .08em rgb(0 0 0 / .55); }
.pk-chip::after { top: 0; bottom: 0;
  background: radial-gradient(60% 55% at 38% 32%, rgb(255 255 255 / .38), transparent 70%),
    radial-gradient(closest-side, var(--cf) 0 52%, var(--ce) 53% 58%, transparent 59%),
    repeating-conic-gradient(var(--ce) 0 14deg, var(--cf) 14deg 45deg);
  box-shadow: inset 0 0 0 .05em rgb(0 0 0 / .28), inset 0 -.04em 0 rgb(0 0 0 / .2); }
.pk-amt { font: 600 1em/1 var(--num); color: #fff4d8; padding: .28em .62em .32em; border-radius: .8em; white-space: nowrap; translate: 0 -50%;
  background: rgb(6 20 14 / .62); box-shadow: inset 0 .08em .2em rgb(0 0 0 / .6), 0 .06em 0 rgb(200 255 220 / .14); }
.pk-amt.l { translate: -100% -50%; }
.pk-amt > span { font-size: 1.25em; }
.pk-mark { width: 2.4em; height: 2.4em; translate: -50% -50%; border-radius: 50%; display: grid; place-items: center; font: 700 1em/1 var(--num); color: #2a1206;
  background: radial-gradient(circle at 36% 28%, #fffdf4, #efe2c2 55%, #c9b386); box-shadow: inset 0 0 0 .12em #fffaf0, inset 0 0 0 .18em rgb(150 110 50 / .55), 0 .16em 0 #8e7a52, 0 .22em 0 #3a2a10, 0 .35em .4em rgb(0 0 0 / .45); }
.pk-mark span { font-size: 1.15em; }
.pk-mark.sb, .pk-mark.bb { font-family: var(--sans); color: #fff4e0; background: radial-gradient(circle at 36% 28%, #6a8fd8, #3a5a96 55%, #22386a); box-shadow: inset 0 0 0 .12em rgb(255 255 255 / .35), 0 .16em 0 #1a2a50, 0 .22em 0 #0a1020, 0 .35em .4em rgb(0 0 0 / .45); }
.pk-mark.bb { background: radial-gradient(circle at 36% 28%, #f07a5e, #c8321f 55%, #7a140a); box-shadow: inset 0 0 0 .12em rgb(255 255 255 / .35), 0 .16em 0 #5a0e06, 0 .22em 0 #2a0402, 0 .35em .4em rgb(0 0 0 / .45); }
.pk-mark.sb span, .pk-mark.bb span { font-size: .86em; letter-spacing: -.04em; }

/* 底池 */
.pk-pot { translate: -50% 0; display: flex; align-items: center; gap: .7em; white-space: nowrap; }
.pk-pot .lab { display: grid; line-height: 1.05; }
.pk-pot small { font: 600 .95em/1.2 var(--sans); color: rgb(240 225 190 / .75); letter-spacing: .2em; }
.pk-pot b { font: 600 2.3em/1 var(--num); background: linear-gradient(180deg, #fffbe6 0%, #fde6a2 28%, #f0c966 50%, #c8983c 58%, #dcb256 76%, #fbeab0 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.pk-pot .pile { position: relative; width: 7em; height: 3.4em; }
.pk-side { translate: -50% 0; display: flex; gap: .6em; white-space: nowrap; }
.pk-side span { font: 600 1.05em/1 var(--num); color: #f2e3c2; padding: .3em .7em; border-radius: .9em; background: rgb(6 20 14 / .55); box-shadow: inset 0 .08em .2em rgb(0 0 0 / .6), 0 .06em 0 rgb(200 255 220 / .12); }

/* 左上角牌匾：第几手、哪一轮、盲注 */
.pk-info { display: flex; align-items: center; gap: .9em; padding: .5em 1em .55em .9em; border-radius: .9em; border: .14em solid transparent; white-space: nowrap; color: var(--text);
  background: var(--glint), var(--surface), var(--edge) border-box; box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .5em .7em rgb(0 0 0 / .5); }
:root[data-theme="light"] .pk-info, :root[data-theme="light"] .pk-seat, :root[data-theme="light"] .pk-ctl { box-shadow: var(--hi), 0 .18em 0 #8e6824, 0 .26em 0 .04em rgb(70 44 8 / .7), 0 .5em .7em rgb(40 14 4 / .4); }
.pk-info .kv { display: grid; justify-items: center; line-height: 1.05; }
.pk-info small { font: 600 .9em/1.25 var(--sans); color: var(--gold); letter-spacing: .16em; }
.pk-info b { font: 600 1.7em/1 var(--num); }
.pk-info .st { font: 400 1.9em/1 var(--brush); background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 .05em; }

/* 座位：名牌是一块小漆板；底牌插在名牌后面露出上半截；名牌下面挂一枚胜率牌 */
.pk-seat { translate: -50% -50%; display: flex; align-items: center; gap: .7em; padding: 0 .9em 0 .6em; border-radius: .95em; border: .14em solid transparent; color: var(--text);
  --edge-now: var(--edge); background: var(--glint), var(--surface), var(--edge-now) border-box;
  box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .55em .8em rgb(0 0 0 / .55); transition: box-shadow .3s, filter .3s; }
.pk-seat .coin { font-size: 1.4em; width: 2.15em; height: 2.15em; flex: none; font-family: var(--num); font-weight: 600; margin-bottom: .18em; }
.pk-seat .who { display: grid; gap: .28em; min-width: 0; flex: 1; }
.pk-seat .who b { font: 900 1.3em/1.1 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-seat .who span { font: 600 1em/1.1 var(--sans); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-seat .who span.hot { color: var(--zhu-2); }
.pk-seat .who span.gold { color: var(--gold-2); }
.pk-seat .stk { font: 600 1.75em/1 var(--num); font-variant-numeric: tabular-nums; }
.pk-seat.on { --edge-now: var(--edge-hi); box-shadow: var(--hi), 0 0 0 .1em #040100, 0 0 0 .36em rgb(42 11 8 / .9), 0 0 0 .46em rgb(240 205 120 / .75), 0 0 2em .3em rgb(240 205 120 / .38), 0 .55em .8em rgb(0 0 0 / .55); }
.pk-seat.win { --edge-now: var(--edge-hi); box-shadow: var(--hi), 0 0 0 .1em #040100, 0 0 0 .36em rgb(42 11 8 / .9), 0 0 0 .46em #f0cd78, 0 0 2.6em .6em rgb(255 214 120 / .55), 0 .55em .8em rgb(0 0 0 / .55); }
.pk-seat.folded { filter: saturate(.55) brightness(.78); }
.pk-seat.out { filter: grayscale(1) brightness(.6); }
.pk-seat .think { position: absolute; left: 50%; top: -.75em; translate: -50% 0; display: flex; gap: .25em; padding: .28em .5em; border-radius: .8em; background: var(--well-bg); box-shadow: var(--well-sh); z-index: 1; }
.pk-seat .think i { width: .38em; height: .38em; border-radius: 50%; background: var(--gold-metal); animation: pk-dot 1.2s ease-in-out infinite; }
.pk-seat .think i:nth-child(2) { animation-delay: .2s; } .pk-seat .think i:nth-child(3) { animation-delay: .4s; }
.pk-seat .won { position: absolute; right: -.4em; top: -1.1em; font: 600 1.2em/1 var(--num); color: var(--on-gold); padding: .28em .55em; border-radius: .3em; background: var(--gold-metal); box-shadow: var(--gold-key-sh); }
.pk-eq { translate: -50% 0; display: flex; align-items: center; gap: .45em; padding: .26em .55em .3em; border-radius: .9em; white-space: nowrap;
  background: rgb(10 4 2 / .72); box-shadow: inset 0 .08em .2em rgb(0 0 0 / .7), 0 .06em 0 rgb(255 224 176 / .16), 0 0 0 .06em rgb(240 205 120 / .22); }
.pk-eq .bar { width: 4.4em; height: .5em; border-radius: .3em; overflow: hidden; background: rgb(0 0 0 / .45); box-shadow: inset 0 .06em .12em rgb(0 0 0 / .6); }
.pk-eq .bar i { display: block; height: 100%; border-radius: .3em; background: linear-gradient(180deg, rgb(255 255 255 / .4), transparent 50%, rgb(0 0 0 / .2)), linear-gradient(90deg, #a67a2a, #f0cd78); }
.pk-eq b { font: 600 1.15em/1 var(--num); color: #f0cd78; min-width: 2.4em; text-align: right; }
.pk-eq.lead b { color: #ff8a6a; }
.pk-eq.lead .bar i { background: linear-gradient(180deg, rgb(255 255 255 / .4), transparent 50%, rgb(0 0 0 / .2)), linear-gradient(90deg, #8e1b12, #e2523d); }

/* 一手结果的横幅 */
.pk-banner { translate: -50% 0; max-width: 56em; padding: .7em 1.6em .75em; border-radius: 1.2em; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font: 600 1em/1.3 var(--sans); color: #2a1209; background: var(--paper-face); box-shadow: inset 0 .05em 0 rgb(255 255 255 / .85), 0 0 0 .05em rgb(120 84 30 / .55), 0 .12em 0 #b4955a, 0 .35em .5em rgb(0 0 0 / .45); }
.pk-banner > span { font-size: 1.25em; }

/* 全下：桌面压暗、横幅、胜率对比 */
.pk-dim { inset: 0; pointer-events: none; background: radial-gradient(60% 55% at 50% 46%, rgb(0 0 0 / .15), rgb(0 0 0 / .62)); }
.pk-allin { left: 50%; translate: -50% -50%; font: 700 1em/1 var(--num); letter-spacing: .06em; color: #fff2d6; white-space: nowrap; pointer-events: none;
  border: .2em solid transparent; border-radius: .7em;
  background: linear-gradient(180deg, rgb(255 255 255 / .28), transparent 46%) padding-box, linear-gradient(180deg, #e2523d, #8e1b12) padding-box, var(--gold-rim) border-box;
  box-shadow: inset 0 0 0 .1em rgb(112 14 6 / .8), 0 .3em 0 #4e0c06, 0 .4em 0 #000, 0 1em 2em rgb(0 0 0 / .6), 0 0 6em rgb(255 120 60 / .45);
  text-shadow: 0 -.1em 0 rgb(96 12 6 / .8), 0 .15em .25em rgb(60 6 2 / .6); }
.pk-allin > span { display: block; font-size: 5em; padding: .25em 1.2em .35em; }
.pk-allin small { font: 700 .4em/1 var(--sans); letter-spacing: .3em; margin-left: .6em; vertical-align: .55em; color: #ffe2a8; }
.pk-cmp { translate: -50% 0; display: grid; gap: .35em; padding: .55em .9em .6em; border-radius: .9em; background: rgb(8 4 2 / .62); box-shadow: inset 0 .08em .25em rgb(0 0 0 / .7), 0 .06em 0 rgb(255 224 176 / .14), 0 0 0 .08em rgb(240 205 120 / .35); }
.pk-cmp .hd { display: flex; justify-content: space-between; align-items: center; font: 700 .95em/1 var(--sans); letter-spacing: .2em; color: #f6dc94; }
.pk-cmp .hd i { font-style: normal; color: #ff8a6a; }
.pk-cmp .tug { display: grid; grid-template-columns: auto 1fr auto; gap: .6em; align-items: center; font: 600 1.15em/1 var(--num); color: #f2e3c2; white-space: nowrap; }
.pk-cmp .tug .bar { position: relative; height: .7em; border-radius: .4em; overflow: hidden; background: #2a2a2a; box-shadow: inset 0 .08em .15em rgb(0 0 0 / .7); display: flex; }
.pk-cmp .tug .bar i { display: block; height: 100%; }
.pk-cmp .tug .bar i.a { background: linear-gradient(180deg, rgb(255 255 255 / .35), transparent 50%, rgb(0 0 0 / .2)), linear-gradient(90deg, #8e1b12, #e2523d); }
.pk-cmp .tug .bar i.b { background: linear-gradient(180deg, rgb(255 255 255 / .35), transparent 50%, rgb(0 0 0 / .2)), linear-gradient(90deg, #f0cd78, #a67a2a); }
.pk-cmp .row { display: grid; grid-template-columns: 4.6em 1fr 3em; gap: .6em; align-items: center; font: 600 1.05em/1 var(--num); color: #f2e3c2; white-space: nowrap; }
.pk-cmp .row .bar { height: .55em; border-radius: .3em; overflow: hidden; background: rgb(0 0 0 / .5); }
.pk-cmp .row .bar i { display: block; height: 100%; background: linear-gradient(90deg, #a67a2a, #f0cd78); }
.pk-cmp .row b { text-align: right; }

/* 操作台：一块漆板，上排预设和滑杆，下排四个键 */
.pk-ctl { display: grid; grid-template-rows: auto auto; gap: .6em; padding: .7em .9em .8em; border-radius: 1em; border: .14em solid transparent; color: var(--text);
  background: var(--glint), var(--surface), var(--edge-hi) border-box; box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .6em 1em rgb(0 0 0 / .6); animation: pk-rise .35s ${EASE} both; }
.pk-ctl[hidden] { display: none; }
.pk-ctl .r1 { display: grid; grid-template-columns: minmax(0, 1fr) 5.6em; gap: .6em; align-items: center; }
.pk-ctl .r1.off { opacity: .45; pointer-events: none; }
.pk-ctl .pre { grid-column: 1 / -1; display: flex; gap: .3em; padding: .22em; border-radius: .6em; background: var(--well-bg); box-shadow: var(--well-sh); overflow: hidden; }
.pk-ctl .pre button { flex: 1; min-width: 0; border: 0; border-radius: .4em; background: transparent; color: var(--muted); font: 600 1em/1.7 var(--num); white-space: nowrap; cursor: pointer; padding: 0 .3em; }
.pk-ctl .pre button:hover { color: var(--text); }
.pk-ctl .pre button.on { background: var(--gold-metal); color: var(--on-gold); box-shadow: var(--gold-key-sh); }
.pk-ctl input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 1.8em; margin: 0; background: transparent; cursor: pointer; }
.pk-ctl input[type=range]::-webkit-slider-runnable-track { height: .55em; border-radius: .3em; background: linear-gradient(90deg, #8e1b12, #e2523d) 0 / var(--p, 0%) 100% no-repeat, var(--well-bg); box-shadow: var(--well-sh); }
.pk-ctl input[type=range]::-moz-range-track { height: .55em; border-radius: .3em; background: var(--well-bg); box-shadow: var(--well-sh); }
.pk-ctl input[type=range]::-moz-range-progress { height: .55em; border-radius: .3em; background: linear-gradient(90deg, #8e1b12, #e2523d); }
.pk-ctl input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 1.7em; height: 1.7em; margin-top: -.58em; border-radius: 50%; border: 0;
  background: radial-gradient(circle at 36% 28%, #fff6d6, #f0cd78 40%, #b98a2e 78%, #7c5918); box-shadow: inset 0 0 0 .12em rgb(255 246 214 / .6), inset 0 0 0 .2em rgb(120 80 14 / .5), 0 .12em 0 #6a4a14, 0 .2em .3em rgb(0 0 0 / .5); }
.pk-ctl input[type=range]::-moz-range-thumb { width: 1.7em; height: 1.7em; border-radius: 50%; border: 0; background: radial-gradient(circle at 36% 28%, #fff6d6, #f0cd78 40%, #b98a2e 78%, #7c5918); box-shadow: 0 .12em 0 #6a4a14, 0 .2em .3em rgb(0 0 0 / .5); }
.pk-ctl input[type=number] { font: 600 1.3em/1 var(--num); padding: .3em .4em; text-align: center; border-radius: .4em; -moz-appearance: textfield; }
.pk-ctl input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
.pk-ctl .r2 { display: grid; grid-template-columns: 1fr 1.25fr 1.45fr 1fr; gap: .55em; padding-bottom: .3em; }
.pk-ctl .btn { font-size: 1.15em; padding: .3em .4em; min-width: 0; --d: .2em; overflow: hidden; text-overflow: ellipsis; }
.pk.port .pk-ctl .btn { font-size: 1.45em; }
.pk.port .pk-ctl .pre button { font-size: 1.25em; }
.pk.port .pk-ctl input[type=number] { font-size: 1.5em; }

/* 开局提示、结算卡：桌面压暗，中间浮起一块纸牌匾 */
.pk-veil { inset: 0; pointer-events: none; border-radius: 1.2em; background: radial-gradient(62% 60% at 50% 47%, rgb(4 2 1 / .38), rgb(4 2 1 / .7)); }
.pk-pop { left: 50%; translate: -50% -50%; pointer-events: none; border: .16em solid transparent; border-radius: 1.3em; color: #2a1209; text-align: center;
  background: var(--paper-face) padding-box, var(--gold-rim, linear-gradient(180deg, #f6dc94, #a67a2a)) border-box;
  box-shadow: inset 0 .06em 0 rgb(255 255 255 / .85), 0 .2em 0 #8e6824, 0 .32em 0 .04em #2a1a06, 0 1.4em 2.4em rgb(0 0 0 / .6); }
.pk-pop .ttl { font: 400 3.6em/1 var(--brush); letter-spacing: .04em; color: #8e1b12; text-shadow: 0 .03em 0 rgb(255 255 255 / .6); }
.pk-pop .sub { margin-top: .55em; font: 600 1.15em/1.35 var(--sans); color: #5a3a1a; letter-spacing: .06em; white-space: nowrap; }
.pk-pop .sub b { font: 700 1.1em/1 var(--num); color: #2a1209; }
.pk-intro { padding: 1.3em 3em 1.2em; }
.pk-intro .ttl { font-size: 4.6em; }
.pk-sum { width: 40em; padding: 1.1em 1.4em 1.2em; display: grid; gap: .8em; }
.pk-sum .hd { display: flex; align-items: baseline; justify-content: center; gap: .7em; }
.pk-sum .hd .ttl { font-size: 2.6em; }
.pk-sum .hd small { font: 700 1em/1 var(--sans); letter-spacing: .3em; color: #8a6a3a; }
.pk-sum .bd { position: relative; height: 3.9em; display: flex; justify-content: center; gap: .35em; }
.pk-sum .bd .pk-c { position: relative; }
.pk-sum .rows { display: grid; gap: .3em; }
.pk-sum .rw { display: grid; grid-template-columns: 2.2em minmax(0, 1fr) 5.9em 7.4em 4.6em; align-items: center; gap: .6em; padding: .3em .6em; border-radius: .6em; text-align: left; background: rgb(120 84 30 / .08); }
.pk-sum .rw.win { background: linear-gradient(90deg, rgb(240 190 80 / .42), rgb(240 190 80 / .12)); box-shadow: inset 0 0 0 .08em rgb(166 122 42 / .6); }
.pk-sum .rw .no { width: 1.9em; height: 1.9em; border-radius: 50%; display: grid; place-items: center; font: 700 1em/1 var(--num); color: #fff4e0; background: radial-gradient(circle at 36% 28%, #e2523d, #8e1b12); box-shadow: inset 0 0 0 .1em rgb(255 255 255 / .3); }
.pk-sum .rw .nm { font: 900 1.2em/1.2 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-sum .rw .hc { position: relative; height: 3.15em; }
.pk-sum .rw .hc .pk-c { position: absolute; top: 0; }
.pk-sum .rw .hn { font: 700 1.1em/1.2 var(--sans); color: #5a3a1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-sum .rw.win .hn { color: #8e1b12; }
.pk-sum .rw .nt { font: 700 1.3em/1 var(--num); text-align: right; }
.pk-sum .rw .nt.up { color: #1f7a4c; } .pk-sum .rw .nt.dn { color: #a8321f; }
.pk-sum .ft { font: 600 1em/1.4 var(--sans); color: #6a4a2a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-sum .rw .pk-c.best { translate: 0 -.35em; }
@keyframes pk-popin { 0% { transform: scale(.82) translateY(.8em); opacity: 0; } 60% { transform: scale(1.02); opacity: 1; } 100% { transform: none; opacity: 1; } }
@keyframes pk-popout { to { transform: scale(.96) translateY(-.6em); opacity: 0; } }
@keyframes pk-veil { from { opacity: 0; } }

@keyframes pk-fly { from { transform: translate(var(--fx), var(--fy)) rotate(var(--fr, 0deg)) scale(.6); opacity: 0; } 30% { opacity: 1; } }
@keyframes pk-slide { from { transform: translate(var(--fx), var(--fy)); opacity: .3; } }
@keyframes pk-collect { to { transform: translate(var(--tx), var(--ty)) scale(.8); opacity: 0; } }
@keyframes pk-flipA { 0% { transform: perspective(20em) rotateY(0); opacity: 1; } 49.9% { transform: perspective(20em) rotateY(90deg); opacity: 1; } 50%, 100% { transform: perspective(20em) rotateY(90deg); opacity: 0; } }
@keyframes pk-flipB { 0%, 50% { transform: perspective(20em) rotateY(-90deg); opacity: 0; } 50.1% { opacity: 1; } 100% { transform: none; opacity: 1; } }
@keyframes pk-lift { from { translate: 0 0; box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), 0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .16em 0 rgb(60 36 8 / .55), 0 .38em .5em -.05em rgb(0 0 0 / .5); } }
@keyframes pk-dimin { from { opacity: .2; filter: none; } }
@keyframes pk-in { from { opacity: 0; } }
@keyframes pk-banner { 0% { transform: scale(2.4); opacity: 0; } 14% { transform: scale(.94); opacity: 1; } 22%, 72% { transform: scale(1); opacity: 1; } 100% { transform: scale(.9) translateY(-1em); opacity: 0; } }
@keyframes pk-rise { from { transform: translateY(1em); opacity: 0; } }
@keyframes pk-pop { 0% { transform: scale(.5); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } }
@keyframes pk-dot { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-.15em); } }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('pk-stage-style')) return;
  const st = document.createElement('style');
  st.id = 'pk-stage-style';
  st.textContent = CSS;
  document.head.append(st);
}

/** 建 DOM：el('div', { class, style, onclick }, ...子节点 / 文字) */
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** 按开始时刻 t0 播放动画；已经播完就什么也不做。重画时用负的延迟接着播 */
function play(node, name, dur, t0, delay = 0, ease = EASE) {
  if (t0 === null || t0 === undefined) return node;
  const passed = now() - t0;
  if (passed > delay + dur) return node;
  const a = `${name} ${dur}ms ${ease} ${Math.round(delay - passed)}ms both`;
  node.style.animation = node.style.animation ? `${node.style.animation}, ${a}` : a;
  return node;
}
const pos = (x, y) => `left:${+x.toFixed(3)}em;top:${+y.toFixed(3)}em`;

/** 一张牌；fs 为牌的 font-size（牌宽 = 5 × fs）；code 为 null 画牌背，'slot' 画空位 */
function cardEl(code, x, y, fs, cls = '') {
  const st = `left:${+(x / fs).toFixed(3)}em;top:${+(y / fs).toFixed(3)}em;font-size:${fs}em`;
  if (code === 'slot') return el('div', { class: `pk-c slot ${cls}`, style: st });
  if (!code) return el('div', { class: `pk-c bk ${cls}`, style: st });
  const r = RANK[code[0]] || code[0];
  const s = SUIT[code[1]];
  const face = r === 'J' || r === 'Q' || r === 'K';
  return el('div', { class: `pk-c${isRed(code) ? ' r' : ''} ${cls}`, style: st },
    el('div', { class: 'ix' }, el('b', {}, r), el('i', {}, s)),
    face ? el('div', { class: 'face' }, el('b', {}, r)) : el('div', { class: 'pip' }, s));
}

/** 一张会翻开的牌：牌背转到 90° 消失，牌面从 −90° 转出来 */
function flipCard(code, x, y, fs, cls, t0, delay, dur = 520) {
  const face = cardEl(code, x, y, fs, cls);
  if (t0 === null || now() - t0 > delay + dur) return [face];
  const back = cardEl(null, x, y, fs);
  play(back, 'pk-flipA', dur, t0, delay, 'linear');
  play(face, 'pk-flipB', dur, t0, delay, 'linear');
  return [back, face];
}

/** 把金额拆成筹码：返回 [[面额, 面色, 镶边, 侧面, 枚数]]，面额从大到小 */
function breakdown(amount, maxCols = 4) {
  let rest = Math.max(0, Math.round(amount));
  const cols = [];
  for (const [v, f, e, s] of DENOMS) {
    const k = Math.floor(rest / v);
    if (k > 0) { cols.push([v, f, e, s, k]); rest -= k * v; }
  }
  return cols.slice(0, maxCols);
}
/** 一堆筹码：(x, y) 是底部中心；按面额分几摞并排 */
function chips(amount, x, y, { maxCols = 4, maxPer = 7, cls = '' } = {}) {
  const box = el('div', { class: `pk-stack ${cls}`, style: pos(x, y) });
  const cols = breakdown(amount, maxCols);
  const gap = 1.95;
  const x0 = -((cols.length - 1) * gap) / 2;
  cols.forEach(([, f, e, s, k], ci) => {
    const n = Math.min(k, maxPer);
    for (let i = 0; i < n; i++) {
      const c = el('div', { class: 'pk-chip', style: `left:${x0 + ci * gap}em;top:${(ci % 2 ? 0.25 : 0) - i * 0.3}em;--cf:${f};--ce:${e};--cs:${s}` });
      box.append(c);
    }
  });
  return box;
}

const seatNo = (seat) => Number(String(seat).slice(1));
const short = (t, n) => { const a = [...String(t || '')]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join(''); };

const STREET_NAME = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌' };
const pickView = (v) => v && ({
  handNo: v.handNo, boardLen: v.board.length, over: !!v.over, showdown: !!v.result?.showdown,
  last: v.last ? { showdown: !!v.last.showdown, boardLen: v.last.board.length } : null,
});

export default {
  // 对局页用「牌桌 + 右侧聚光框 + 本手记录」版式：牌桌上已经有每个人的名牌、筹码和动作，两侧不再放选手卡
  hud: true,

  /** 回放、录制时两步之间额外停多久：和服务端的每手停顿是同一份时长 */
  pauseAfter: (a, b) => pauseBetween(pickView(a), pickView(b)),

  /** 聚光框头上的一行：筹码、位置 */
  seatLine(view, seat) {
    const p = view?.players?.find((q) => q.seat === seat);
    if (!p) return '';
    return [p.out && !p.inHand ? '已出局' : `筹码 ${p.stack}`, p.position && !view.over ? p.position : null].filter(Boolean).join(' · ');
  },

  /** 本手记录：按街分组，每条街标出这条街发的公共牌 */
  handLog(view) {
    if (!view?.players) return null;
    const groups = [];
    const cut = { flop: [0, 3], turn: [3, 4], river: [4, 5] };
    for (const e of view.log || []) {
      let g = groups[groups.length - 1];
      if (!g || g.street !== e.street) {
        const [a, b] = cut[e.street] || [0, 0];
        g = { street: e.street, name: STREET_NAME[e.street] || e.street, board: view.board.slice(a, b), items: [] };
        groups.push(g);
      }
      g.items.push({ seat: e.seat, text: e.text, blind: !!e.blind });
    }
    // 已经发了牌、但这条街还没人行动（或全下后直接发完）：也把这条街列出来
    for (const [st, [a, b]] of Object.entries(cut)) {
      if (view.board.length >= b && !groups.some((g) => g.street === st)) groups.push({ street: st, name: STREET_NAME[st], board: view.board.slice(a, b), items: [] });
    }
    const order = ['preflop', 'flop', 'turn', 'river'];
    groups.sort((x, y) => order.indexOf(x.street) - order.indexOf(y.street));
    return {
      title: `第 ${view.handNo} 手`, sub: `盲注 ${view.blinds.sb}/${view.blinds.bb} · 底池 ${view.pot}`,
      groups, count: (view.log || []).filter((e) => !e.blind).length, last: view.last ? `上一手：${view.last.text}` : null, result: view.result?.text || null,
    };
  },

  // 手机竖屏用竖版桌面，其余横版
  get aspect() { return typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? [10, 14] : [16, 10]; },

  createStage({ onAction }) {
    injectStyle();
    const root = el('div', { class: 'pk board-html', role: 'group', 'aria-label': '德州扑克牌桌' });
    const box = el('div', { class: 'pk-box' });
    const layer = el('div', { class: 'pk-layer' });
    root.append(box);

    // ---------- 操作台（只建一次，重画时不重建，拖动滑杆不会被打断） ----------
    const foldBtn = el('button', { class: 'btn', type: 'button' }, '弃牌');
    const callBtn = el('button', { class: 'btn', type: 'button' }, '跟注');
    const raiseBtn = el('button', { class: 'btn primary', type: 'button' }, '加注');
    const allinBtn = el('button', { class: 'btn', type: 'button' }, '全下');
    const range = el('input', { type: 'range', step: 1, 'aria-label': '加注金额' });
    const num = el('input', { type: 'number', step: 1, 'aria-label': '加注金额' });
    const presets = el('div', { class: 'pre' });
    const r1 = el('div', { class: 'r1' }, presets, range, num);
    const ctl = el('div', { class: 'pk-ctl', hidden: '' }, r1, el('div', { class: 'r2' }, foldBtn, callBtn, raiseBtn, allinBtn));
    for (const n of [ctl]) n.addEventListener('click', (e) => e.stopPropagation());
    box.append(layer, ctl);
    let cur = { ids: new Set(), legal: null, callId: null, verb: '加注到' };

    const amount = () => {
      const L = cur.legal;
      if (!L) return 0;
      const v = Math.round(Number(num.value));
      return Number.isFinite(v) ? Math.max(L.minTo, Math.min(L.maxTo, v)) : L.minTo;
    };
    const setAmount = (v, from) => {
      const L = cur.legal;
      if (!L) return;
      v = Math.max(L.minTo, Math.min(L.maxTo, Math.round(v)));
      if (from !== range) range.value = v;
      if (from !== num) num.value = v;
      range.style.setProperty('--p', `${L.maxTo > L.minTo ? ((v - L.minTo) / (L.maxTo - L.minTo)) * 100 : 100}%`);
      raiseBtn.textContent = v >= L.maxTo ? `全下 ${v}` : `${cur.verb} ${v}`;
      for (const b of presets.children) b.classList.toggle('on', Number(b.dataset.v) === v);
    };
    range.addEventListener('input', () => setAmount(Number(range.value), range));
    num.addEventListener('input', () => { if (num.value !== '') setAmount(Number(num.value), num); });
    num.addEventListener('change', () => setAmount(amount()));
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') raiseBtn.click(); });
    foldBtn.addEventListener('click', () => cur.ids.has('fold') && onAction('fold'));
    callBtn.addEventListener('click', () => cur.callId && onAction(cur.callId));
    allinBtn.addEventListener('click', () => cur.ids.has('allin') && onAction('allin'));
    raiseBtn.addEventListener('click', () => {
      const L = cur.legal;
      if (!L || !L.canRaise) return;
      const v = amount();
      onAction(v >= L.maxTo ? 'allin' : `raise:${v}`);
    });

    let ctlKey = '';
    function renderControls(view, movable, actions, L) {
      const show = !!movable && view.toAct === movable && Array.isArray(actions) && actions.length > 0;
      ctl.hidden = !show;
      if (!show) { ctlKey = ''; return; }
      ctl.style.cssText = `${pos(L.ctl.x, L.ctl.y)};width:${L.ctl.w}em;min-height:${L.ctl.h}em`;
      const key = `${view.handNo}|${view.log.length}|${actions.map((a) => a.id).join(',')}`;
      if (key === ctlKey) return; // 同一个决策点：不重置玩家拖到一半的金额
      ctlKey = key;
      const ids = new Set(actions.map((a) => a.id));
      const lg = view.legal;
      const byId = Object.fromEntries(actions.map((a) => [a.id, a]));
      cur = { ids, legal: lg, callId: ids.has('check') ? 'check' : ids.has('call') ? 'call' : null, verb: view.currentBet ? '加注到' : '下注' };
      foldBtn.disabled = !ids.has('fold');
      callBtn.disabled = !cur.callId;
      callBtn.textContent = ids.has('check') ? '过牌' : byId.call ? byId.call.label : '跟注';
      allinBtn.disabled = !ids.has('allin');
      allinBtn.textContent = '全下';
      allinBtn.title = byId.allin ? byId.allin.label : '';
      const raises = actions.filter((a) => a.id.startsWith('raise:'));
      const canRaise = !!(lg && lg.canRaise && lg.minTo < lg.maxTo);
      r1.classList.toggle('off', !canRaise);
      presets.replaceChildren(...raises.map((a) => el('button', { type: 'button', 'data-v': a.id.slice(6), title: a.label, onclick: () => setAmount(Number(a.id.slice(6))) }, a.hint || a.id.slice(6))));
      presets.hidden = !raises.length;
      if (lg) {
        range.min = num.min = lg.minTo;
        range.max = num.max = lg.maxTo;
        setAmount(lg.minTo);
      }
      raiseBtn.disabled = !canRaise;
      if (!canRaise) raiseBtn.textContent = cur.verb;
    }

    // ---------- 版式、状态 ----------
    let layoutName = 'land';
    let last = null;
    let timer = null;
    const fx = { prev: null, deal: null, board: { n: 0, t0: null, from: 0 }, bets: {}, collect: null, recap: null, allin: null, settle: null, intro: null };
    const redraw = () => last && draw(last.view, last.opts);
    let sumTimer = null;

    /** 结算卡的数据：哪几手牌亮了、牌型、这一手各人输赢 */
    function summaryOf(view, rc, src, best) {
      if (rc) {
        const lh = rc.lastHand;
        const seats = Object.keys(lh.shown || {});
        const rows = (seats.length ? seats : [...rc.winners]).map((s) => ({
          seat: s, name: rc.prev.players.find((q) => q.seat === s)?.name || s, cards: lh.shown?.[s] || null,
          hand: lh.hands?.[s] || (rc.winners.has(s) ? '赢下底池' : ''), net: lh.net?.[s] ?? null, win: rc.winners.has(s),
        }));
        // 输了筹码但没亮牌的人（弃牌）也列出来，按输赢排序
        for (const q of rc.prev.players) if (!rows.some((r) => r.seat === q.seat) && lh.net?.[q.seat]) rows.push({ seat: q.seat, name: q.name, cards: null, hand: '弃牌', net: lh.net[q.seat], win: false });
        return { no: lh.no, board: lh.board, best, rows: sortRows(rows), text: lh.text, showdown: !!lh.showdown };
      }
      const r = view.result;
      const win = new Set(r.winners);
      const rows = view.players.filter((q) => q.inHand).map((q) => ({
        seat: q.seat, name: q.name, cards: r.showdown && !q.folded ? q.cards : null, hand: q.handName || (win.has(q.seat) ? '赢下底池' : q.folded ? '弃牌' : ''),
        net: (q.won || 0) - (q.contrib || 0), win: win.has(q.seat),
      })).filter((x) => x.win || x.cards || x.net);
      return { no: view.handNo, board: view.board, best, rows: sortRows(rows), text: r.text, showdown: !!r.showdown, final: view.over };
    }
    const sortRows = (rows) => rows.sort((a, b) => (b.win - a.win) || ((b.net ?? 0) - (a.net ?? 0)));

    function summaryCard(S, L) {
      const card = el('div', { class: 'pk-pop pk-sum', style: `top:${L.table.cy}em` });
      card.append(el('div', { class: 'hd' }, el('span', { class: 'ttl' }, `第 ${S.no} 手 · 结算`), S.final ? el('small', {}, '终局') : null));
      if (S.board?.length) {
        const bd = el('div', { class: 'bd' });
        for (const c of S.board) bd.append(cardEl(c, 0, 0, 0.55, S.best.size ? (S.best.has(c) ? 'best' : 'dim') : ''));
        card.append(bd);
      }
      const rows = el('div', { class: 'rows' });
      for (const r of S.rows.slice(0, 6)) {
        const cs = el('div', { class: 'hc' });
        (r.cards || []).forEach((c, k) => cs.append(cardEl(c, k * 2.9, 0, 0.45, r.win && S.best.has(c) ? 'best' : '')));
        rows.append(el('div', { class: `rw${r.win ? ' win' : ''}` },
          el('span', { class: 'no' }, String(seatNo(r.seat))), el('span', { class: 'nm' }, r.name), cs,
          el('span', { class: 'hn' }, r.hand || ''),
          el('span', { class: `nt ${r.net > 0 ? 'up' : r.net < 0 ? 'dn' : ''}` }, r.net === null || r.net === undefined ? '' : `${r.net > 0 ? '+' : ''}${r.net}`)));
      }
      card.append(rows, el('div', { class: 'ft' }, S.text));
      return card;
    }

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(([e]) => {
        const { width, height } = e.contentRect;
        if (!width || !height) return;
        const name = height > width * 1.05 ? 'port' : 'land';
        if (name !== layoutName) { layoutName = name; root.classList.toggle('port', name === 'port'); redraw(); }
      }).observe(root);
    }

    /** 每个座位在桌上的位置（旋转到玩家本人在正下方） */
    function geometry(view, viewer, L) {
      const n = view.players.length;
      const rot = viewer ? Math.max(0, view.players.findIndex((p) => p.seat === viewer)) : 0;
      const g = {};
      const { cx, cy } = L.table;
      view.players.forEach((p, j) => {
        const k = (j - rot + n) % n;
        const th = ((90 + (k * 360) / n) * Math.PI) / 180;
        const x = Math.max(L.clampX[0], Math.min(L.clampX[1], cx + L.ring.rx * Math.cos(th)));
        const y = Math.max(L.clampY[0], Math.min(L.clampY[1], cy + L.ring.ry * Math.sin(th)));
        const tb = th + (L.bets.off * Math.PI) / 180;
        // by 是这摞筹码的底边（筹码往上叠，视觉中心在环上）
        const bx = cx + L.bets.rx * Math.cos(tb), by = cy + L.bets.ry * Math.sin(tb) + 1.2;
        const tm = th + (L.marks.off * Math.PI) / 180;
        const mx = cx + L.marks.rx * Math.cos(tm), my = cy + L.marks.ry * Math.sin(tm);
        g[p.seat] = { x, y, bx, by, mx, my, th };
      });
      return g;
    }

    const liveOf = (v) => v.players.filter((p) => p.inHand && !p.folded);
    const allinMoment = (v) => !!v && !v.result && liveOf(v).length >= 2 && liveOf(v).some((p) => p.allin);
    const sumBets = (v) => v.players.reduce((a, p) => a + (p.bet || 0), 0);

    /** 上一手的结算数据：赢家、赢家组成牌型的五张、没翻完的公共牌从第几张开始 */
    function recapOf(prev, view) {
      const lastHand = view.last;
      if (!lastHand || lastHand.no !== prev.handNo) return null;
      const shown = lastHand.shown || {};
      let winners = [], best = [];
      const seats = Object.keys(shown);
      if (seats.length) {
        const board = lastHand.board.map(fromCode);
        let top = -1;
        for (const s of seats) {
          const sc = evaluate([...shown[s].map(fromCode), ...board]);
          if (sc > top) { top = sc; winners = [s]; } else if (sc === top) winners.push(s);
        }
        for (const s of winners) best.push(...bestFive([...shown[s].map(fromCode), ...board]).map(codeOf));
      } else {
        // 其他人弃牌：赢家是这一手净赢的人（上一步之前还有两个人没弃牌，不能按那时的局面猜）
        const net = lastHand.net || {};
        const top = Math.max(0, ...Object.values(net));
        winners = Object.keys(net).filter((s) => net[s] === top && top > 0);
        if (!winners.length) winners = liveOf(prev).map((p) => p.seat).slice(0, 1);
      }
      return { prev, lastHand, winners: new Set(winners), best: new Set(best), from: prev.board.length, allin: allinMoment(prev), showdown: lastHand.showdown ?? seats.length > 0 };
    }

    /** 记录变化、决定这一帧要起哪些动画 */
    function track(view, opts) {
      const p = fx.prev;
      const t = now();
      const live = opts.animate !== false && p !== null;
      fx.prev = view;
      if (!live) {
        fx.recap = null; fx.collect = null; fx.deal = null; fx.settle = null; fx.allin = allinMoment(view) ? fx.allin : null;
        fx.board = { n: view.board.length, t0: null, from: view.board.length };
        fx.bets = {};
        // 打开页面时正好是一手的开头（还没人行动）：弹开局提示，和服务端的开局停顿对上
        fx.intro = opts.animate !== false && !view.over && !view.result && !view.log.some((e) => !e.blind) ? { t0: t, hand: view.handNo } : null;
        if (fx.intro) { fx.deal = t; clearTimeout(timer); timer = setTimeout(redraw, TM.DEAL + 30); }
        return;
      }
      const newHand = view.handNo !== p.handNo;
      if (newHand) {
        // 一手结束：先结算上一手，再发新一手
        const rc = view.handNo === p.handNo + 1 ? recapOf(p, view) : null;
        const runout = rc ? Math.max(0, (rc.lastHand.board.length - rc.from)) : 0;
        const streets = rc && rc.showdown ? streetsBetween(rc.from, rc.lastHand.board.length) : 0;
        // 时长和服务端的停顿是同一份（timing.js）：结算演完、结算卡停够，才发新一手
        const dur = rc ? endDur({ showdown: rc.showdown, streets }) : 0;
        fx.recap = rc ? { ...rc, t0: t, dur, runoutAt: TM.RUNOUT_AT, streets, runout, cardAt: cardAt({ showdown: rc.showdown, streets }), collectFrom: sumBets(p) > 0 ? p : null } : null;
        fx.deal = t + dur;
        fx.intro = view.over ? null : { t0: t + dur, hand: view.handNo };
        fx.board = { n: view.board.length, t0: null, from: 0 };
        fx.collect = null;
        fx.settle = null;
        fx.bets = Object.fromEntries(view.players.filter((q) => q.bet > 0).map((q) => [q.seat, t + dur + 500]));
        clearTimeout(timer);
        if (dur) timer = setTimeout(() => { redraw(); clearTimeout(timer); timer = setTimeout(redraw, TM.DEAL + 30); }, dur + 30);
        else { timer = setTimeout(redraw, TM.DEAL + 30); }
      } else {
        // 同一手：新的公共牌、下注、收池
        if (view.board.length > p.board.length) fx.board = { n: view.board.length, t0: t + (p.street !== view.street && sumBets(p) > 0 ? 380 : 0), from: p.board.length };
        if (view.street !== p.street && sumBets(p) > 0) fx.collect = { t0: t, prev: p };
        for (const q of view.players) {
          const o = p.players.find((x) => x.seat === q.seat);
          if (q.bet > (o?.bet || 0)) fx.bets[q.seat] = t;
        }
        if (view.result && !p.result) {
          // 最后一手结束（整场结束，不再发新一手）：同样翻完公共牌、亮底牌、弹结算卡，卡一直留着
          const flips = Math.max(0, view.board.length - p.board.length);
          const showdown = !!view.result.showdown;
          const streets = showdown ? streetsBetween(p.board.length, view.board.length) : 0;
          const reveal = new Set(view.players.filter((q) => q.cards && !p.players.find((o) => o.seat === q.seat)?.cards).map((q) => q.seat));
          fx.settle = { t0: t, flips, streets, reveal, cardAt: cardAt({ showdown, streets }) };
        }
      }
      const ai = allinMoment(view);
      if (ai && !fx.allin) fx.allin = t;
      if (!ai && !(fx.recap && fx.recap.allin)) fx.allin = null;
    }

    function seatEl(view, p, g, L, { recap = null, best = new Set(), winners = new Set(), showEq = true }) {
      const S = L.seat;
      const acting = !recap && view.toAct === p.seat;
      const win = winners.has(p.seat);
      const outNow = p.out && !p.inHand;
      const cls = `pk-seat${acting ? ' on' : ''}${win ? ' win' : ''}${p.folded && p.inHand && !outNow ? ' folded' : ''}${outNow ? ' out' : ''}`;
      // 第二行：本轮动作 / 牌型 / 状态
      let status = p.last || (p.position && !view.over ? p.position : '');
      let sc = '';
      if (outNow) status = '出局';
      else if (win && (recap || view.result)) { status = recap ? (recap.lastHand.hands?.[p.seat] || '赢下底池') : (p.handName || '赢下底池'); sc = 'gold'; }
      else if (p.handName) { status = p.handName; }
      else if (p.folded && p.inHand) status = '弃牌';
      else if (p.allin) { status = '全下'; sc = 'hot'; }
      // 结算期间：赢家已经拿到底池、新一手的盲注还没下
      const np = recap ? view.players.find((q) => q.seat === p.seat) : null;
      const stack = np ? np.stack + (np.contrib || 0) : p.stack;
      const node = el('div', { class: cls, style: `${pos(g.x, g.y)};width:${S.w}em;height:${S.h}em` },
        el('span', { class: 'coin' }, String(seatNo(p.seat))),
        el('div', { class: 'who' }, el('b', {}, p.name), el('span', { class: sc }, short(status, 8))),
        el('span', { class: 'stk' }, String(stack)),
        acting ? el('div', { class: 'think' }, el('i'), el('i'), el('i')) : null);
      const won = recap ? null : view.result && p.won > 0 ? p.won : null;
      if (won) node.append(el('span', { class: 'won' }, `+${won}`));
      return node;
    }

    function draw(view, opts) {
      const { movable = null, actions = null, viewer = null } = opts;
      const L = LAYOUTS[layoutName];
      const T = L.table;
      const g = geometry(view, viewer, L);
      const t = now();
      const rc = fx.recap && t - fx.recap.t0 < fx.recap.dur ? fx.recap : null;
      if (!rc && fx.recap) fx.recap = null;
      const src = rc ? rc.prev : view; // 结算期间座位上的牌按上一手画
      const kids = [];

      // 桌子
      kids.push(el('div', { class: 'pk-rail', style: `${pos(T.cx - T.rx - 1.6, T.cy - T.ry - 1.6)};width:${(T.rx + 1.6) * 2}em;height:${(T.ry + 1.6) * 2}em` }));
      kids.push(el('div', { class: 'pk-felt', style: `${pos(T.cx - T.rx + 0.3, T.cy - T.ry + 0.3)};width:${(T.rx - 0.3) * 2}em;height:${(T.ry - 0.3) * 2}em` }));
      kids.push(el('div', { class: 'pk-wm', style: pos(T.cx, T.cy + T.ry * 0.55) }, el('span', {}, '德州')));

      // 全下：压暗
      const ai = rc ? rc.allin : allinMoment(view);
      if (ai) kids.push(play(el('div', { class: 'pk-dim' }), 'pk-in', 500, fx.allin));

      // 左上角牌匾
      const street = rc ? '摊牌' : view.streetName;
      kids.push(el('div', { class: 'pk-info', style: pos(...L.info) },
        el('div', { class: 'kv' }, el('small', {}, '第几手'), el('b', {}, `${view.handNo}/${view.hands}`)),
        el('span', { class: 'st' }, street),
        el('div', { class: 'kv' }, el('small', {}, '盲注'), el('b', {}, `${view.blinds.sb}/${view.blinds.bb}`))));

      // 公共牌
      const B = L.board;
      const fs = B.cw / 5;
      const bw = B.cw * 5 + B.gap * 4;
      const bx0 = B.cx - bw / 2;
      const board = rc ? rc.lastHand.board : view.board;
      let best = new Set(), winners = new Set();
      if (rc) { best = rc.best; winners = rc.winners; } else if (view.result) {
        winners = new Set(view.result.winners);
        if (view.result.showdown) for (const p of view.players) if (winners.has(p.seat) && p.best) p.best.forEach((c) => best.add(c));
      }
      // 结算时：没翻完的公共牌依次翻开，然后五张抬起
      let liftAt = 0;
      const flipDelay = (k) => {
        if (rc) {
          if (k < rc.from) return null;
          const st = k < 3 ? 0 : k === 3 ? 1 : 2;
          const firstSt = rc.from < 3 ? 0 : rc.from === 3 ? 1 : 2;
          return rc.runoutAt + (st - firstSt) * TM.STREET + (k < 3 ? k * 160 : 0);
        }
        if (fx.settle && fx.settle.flips && fx.board.t0 !== null && k >= fx.board.from) {
          const from = fx.board.from;
          const st = k < 3 ? 0 : k === 3 ? 1 : 2;
          const firstSt = from < 3 ? 0 : from === 3 ? 1 : 2;
          return TM.RUNOUT_AT + (st - firstSt) * TM.STREET + (k < 3 ? k * 160 : 0);
        }
        if (fx.board.t0 === null || k < fx.board.from) return null;
        return k < 3 ? (k - Math.min(fx.board.from, 3)) * 170 : (k - fx.board.from) * 170;
      };
      const t0Board = rc ? rc.t0 : fx.board.t0;
      if (rc) liftAt = rc.runoutAt + rc.streets * TM.STREET + TM.LIFT;
      else if (fx.settle) liftAt = fx.settle.flips ? TM.RUNOUT_AT + fx.settle.streets * TM.STREET + TM.LIFT : 200;
      for (let k = 0; k < 5; k++) {
        const c = board[k];
        const x = bx0 + k * (B.cw + B.gap);
        if (!c) { kids.push(cardEl('slot', x, B.y, fs)); continue; }
        const isBest = best.has(c);
        const cls = best.size ? (isBest ? 'best' : 'dim') : '';
        const d = flipDelay(k);
        const nodes = d === null ? [cardEl(c, x, B.y, fs, cls)] : flipCard(c, x, B.y, fs, cls, t0Board, d);
        const face = nodes.at(-1);
        if (best.size) play(face, isBest ? 'pk-lift' : 'pk-dimin', 520, rc ? rc.t0 : fx.settle?.t0, liftAt);
        kids.push(...nodes);
      }

      // 底池：收进来的筹码（不含各人面前还没收的注）
      const P = L.pot;
      const betsNow = rc ? 0 : sumBets(view);
      const potAmt = rc ? rc.prev.pot : view.pot - betsNow;
      const potWrap = el('div', { class: 'pk-pot', style: pos(P.cx, P.y) });
      const pile = el('div', { class: 'pile' });
      // 结算：底池推向赢家（推完就不再画这堆筹码）
      const winSeat = [...winners][0];
      const settleT0 = rc ? rc.t0 : fx.settle?.t0 ?? null;
      const pushDone = (rc || view.result) && (settleT0 === null || t - settleT0 > liftAt + 1200);
      if (potAmt > 0 && !pushDone) pile.append(chips(potAmt, 3.5, 3.1, { maxCols: 4, maxPer: 8 }));
      potWrap.append(pile, el('div', { class: 'lab' }, el('small', {}, '底池'), el('b', {}, String(rc ? rc.prev.pot : view.pot))));
      if (winSeat && g[winSeat] && settleT0 !== null && !pushDone) {
        const w = g[winSeat];
        pile.style.setProperty('--tx', `${w.x - (P.cx - 0.2)}em`);
        pile.style.setProperty('--ty', `${w.y - (P.y + 1.7)}em`);
        play(pile, 'pk-collect', 700, settleT0, liftAt + 500, 'cubic-bezier(.5,0,.6,1)');
      }
      kids.push(potWrap);
      if (!rc && view.pots.length > 1) {
        kids.push(el('div', { class: 'pk-side', style: pos(P.cx, P.y + 4) }, ...view.pots.map((pp, k) => el('span', {}, `${k ? `边池 ${k}` : '主池'} ${pp.amount}`))));
      }

      // 一轮结束：上一轮的注收进底池
      if (!rc && fx.collect && t - fx.collect.t0 < 520) {
        for (const q of fx.collect.prev.players) {
          if (!q.bet || !g[q.seat]) continue;
          const s = g[q.seat];
          const st = chips(q.bet, s.bx, s.by, { maxCols: 3 });
          st.style.setProperty('--tx', `${P.cx - s.bx}em`);
          st.style.setProperty('--ty', `${P.y + 2.5 - s.by}em`);
          kids.push(play(st, 'pk-collect', 520, fx.collect.t0, 0, 'cubic-bezier(.5,0,.7,1)'));
        }
      }
      if (rc && rc.collectFrom && t - rc.t0 < 450) {
        for (const q of rc.collectFrom.players) {
          if (!q.bet || !g[q.seat]) continue;
          const s = g[q.seat];
          const st = chips(q.bet, s.bx, s.by, { maxCols: 3 });
          st.style.setProperty('--tx', `${P.cx - s.bx}em`);
          st.style.setProperty('--ty', `${P.y + 2.5 - s.by}em`);
          kids.push(play(st, 'pk-collect', 450, rc.t0, 0, 'cubic-bezier(.5,0,.7,1)'));
        }
      }

      // 各座位：标记（庄、小盲、大盲）、面前的注、底牌、名牌、胜率
      const players = src.players;
      const markOf = (seat) => (seat === src.button ? ['d', 'D'] : seat === src.sbSeat ? ['sb', '小盲'] : seat === src.bbSeat ? ['bb', '大盲'] : null);
      for (const p of players) {
        const s = g[p.seat];
        if (!s) continue;
        const outNow = p.out && !p.inHand;
        const mk = outNow || src.over ? null : markOf(p.seat);
        if (mk) kids.push(el('div', { class: `pk-mark ${mk[0]}`, style: pos(s.mx, s.my) }, el('span', {}, mk[1])));
        if (!rc && p.bet > 0) {
          const st = chips(p.bet, s.bx, s.by, { maxCols: 3, maxPer: 6 });
          const right = s.bx >= L.table.cx - 0.5;
          const amt = el('span', { class: `pk-amt${right ? '' : ' l'}`, style: pos(s.bx + (right ? 1.4 + (breakdown(p.bet, 3).length - 1) * 0.98 : -1.4 - (breakdown(p.bet, 3).length - 1) * 0.98), s.by - 0.9) }, el('span', {}, String(p.bet)));
          const t0 = fx.bets[p.seat];
          if (t0 !== undefined) {
            st.style.setProperty('--fx', `${s.x - s.bx}em`);
            st.style.setProperty('--fy', `${s.y - s.by}em`);
            play(st, 'pk-slide', 420, t0);
            play(amt, 'pk-in', 300, t0, 260);
          }
          kids.push(st, amt);
        }
      }
      for (const p of players) {
        const s = g[p.seat];
        if (!s) continue;
        const S = L.seat;
        // 底牌：插在名牌后面
        if (p.inHand && !(p.out && !p.inHand)) {
          // 玩家本人的底牌大一号、露得多
          const mine = !!viewer && p.seat === viewer;
          const cfs = (layoutName === 'port' ? 0.66 : 0.74) * (mine ? 1.3 : 1);
          const cw = cfs * 5, ch = cfs * 7;
          const cy = s.y - S.h / 2 - ch + (mine ? 0.9 : 1.5);
          // 摊牌：上一手亮出来的底牌在座位上翻开（玩家视角、观众视角原来看不到别人的牌）
          const shownNow = rc ? rc.lastHand.shown?.[p.seat] : null;
          const cards = shownNow || p.cards || [null, null];
          const flipIn = (rc && shownNow && !p.cards) || (!rc && fx.settle?.reveal?.has(p.seat));
          const win = winners.has(p.seat);
          cards.forEach((c, k) => {
            const x = s.x - cw / 2 + (k ? 1 : -1) * (mine ? 2.2 : 1.25);
            const cls = `${p.folded ? 'fold' : ''}${best.size && c && best.has(c) && win ? ' best' : ''}`;
            const nodes = flipIn ? flipCard(c, x, cy, cfs, cls, rc ? rc.t0 : fx.settle.t0, Math.max(0, TM.RUNOUT_AT - 250) + k * 120) : [cardEl(c, x, cy, cfs, cls)];
            for (const nd of nodes) { nd.style.rotate = `${k ? 7 : -7}deg`; nd.style.transformOrigin = '50% 100%'; }
            if (nodes.length > 1) { kids.push(nodes[0]); }
            const node = nodes.at(-1);
            if (!rc && fx.deal !== null) {
              node.style.setProperty('--fx', `${(T.cx - x - cw / 2) / cfs}em`);
              node.style.setProperty('--fy', `${(T.cy - cy - ch / 2) / cfs}em`);
              const order = (seatNo(p.seat) - seatNo(view.button) + players.length) % players.length;
              play(node, 'pk-fly', 420, fx.deal, (k * players.length + order) * 90);
            }
            kids.push(node);
          });
        }
        kids.push(seatEl(view, p, s, L, { recap: rc, winners }));
        // 胜率
        if (!rc && p.equity !== null && p.equity !== undefined && p.inHand && !p.folded) {
          const live = liveOf(view);
          const top = Math.max(...live.map((q) => q.equity ?? 0));
          const pct = Math.round(p.equity * 100);
          kids.push(el('div', { class: `pk-eq${p.equity === top && live.length > 1 ? ' lead' : ''}`, style: pos(s.x, s.y + S.h / 2 + 0.15) },
            el('span', { class: 'bar' }, el('i', { style: `width:${pct}%` })), el('b', {}, `${pct}%`)));
        }
      }

      // 一手结果：结算卡（翻完、抬牌之后弹出；摊牌时列出亮出的底牌和牌型）
      const resultText = rc ? rc.lastHand.text : view.result ? view.result.text : '';
      const sumAt = rc ? rc.cardAt : fx.settle ? fx.settle.cardAt : 0;
      const sumT0 = rc ? rc.t0 : fx.settle?.t0 ?? null;
      const sumOn = resultText && (sumT0 === null || t - sumT0 >= sumAt - 40);
      if (resultText) {
        // 结算卡出现前，横条只在卡片出现前不画；卡片出现后由 timer 重画
        if (!sumOn) { clearTimeout(sumTimer); sumTimer = setTimeout(redraw, sumAt - (t - sumT0) + 20); }
      }
      if (sumOn) {
        const summary = summaryOf(view, rc, src, best);
        const veil = el('div', { class: 'pk-veil' });
        const card = summaryCard(summary, L);
        if (sumT0 !== null) {
          play(veil, 'pk-veil', 380, sumT0, sumAt);
          play(card, 'pk-popin', 520, sumT0, sumAt, 'cubic-bezier(.2,1.2,.4,1)');
          if (rc) { play(veil, 'pk-popout', 320, rc.t0, rc.dur - 320, 'ease-in'); play(card, 'pk-popout', 320, rc.t0, rc.dur - 320, 'ease-in'); }
        }
        kids.push(veil, card);
      }
      // 新一手：开局提示（第几手、盲注、庄位），停留时间和服务端的开局停顿一样
      if (!rc && fx.intro && fx.intro.hand === view.handNo && t >= fx.intro.t0 - 40 && t - fx.intro.t0 < TM.DEAL) {
        const btn = view.players.find((q) => q.seat === view.button);
        const alive = view.players.filter((q) => !q.out).length;
        const veil = el('div', { class: 'pk-veil' });
        const card = el('div', { class: 'pk-pop pk-intro', style: `top:${T.cy - 1}em` },
          el('div', { class: 'ttl' }, `第 ${view.handNo} 手`),
          el('div', { class: 'sub' }, '盲注 ', el('b', {}, `${view.blinds.sb}/${view.blinds.bb}`), `　庄位 ${seatNo(view.button)} 号 ${short(btn?.name || '', 6)}　`, el('b', {}, String(alive)), ' 人在桌', view.hands ? `　共 ${view.hands} 手` : ''));
        for (const x of [veil, card]) {
          play(x, x === card ? 'pk-popin' : 'pk-veil', x === card ? 480 : 300, fx.intro.t0, 0, 'cubic-bezier(.2,1.2,.4,1)');
          play(x, 'pk-popout', 300, fx.intro.t0, TM.DEAL - 300, 'ease-in');
        }
        kids.push(veil, card);
      }

      // 全下：横幅、胜率对比
      if (ai) {
        const av = rc ? rc.prev : view;
        const live = liveOf(av).filter((q) => q.equity !== null && q.equity !== undefined);
        if (fx.allin !== null && t - fx.allin < 1900) {
          kids.push(play(el('div', { class: 'pk-allin', style: `top:${B.y + B.cw * 0.7}em` }, el('span', {}, 'ALL IN', el('small', {}, '全下'))), 'pk-banner', 1800, fx.allin, 0, 'ease-out'));
        }
        if (live.length >= 2 && !sumOn) {
          const C = L.cmp;
          const cmp = el('div', { class: 'pk-cmp', style: `${pos(C.cx, C.y)};width:${C.w}em` });
          if (live.length === 2) {
            const [a, b2] = live;
            const pa = Math.round(a.equity * 100), pb = Math.round(b2.equity * 100);
            cmp.append(el('div', { class: 'hd' }, el('span', {}, '胜率对比'), el('i', {}, 'ALL IN')),
              el('div', { class: 'tug' }, el('span', {}, `${a.name} ${pa}%`),
                el('span', { class: 'bar' }, el('i', { class: 'a', style: `width:${pa}%` }), el('i', { class: 'b', style: `width:${100 - pa}%` })),
                el('span', {}, `${pb}% ${b2.name}`)));
          } else {
            cmp.append(el('div', { class: 'hd' }, el('span', {}, '胜率对比'), el('i', {}, 'ALL IN')),
              ...live.sort((x, y) => y.equity - x.equity).map((q) => el('div', { class: 'row' }, el('span', {}, q.name), el('span', { class: 'bar' }, el('i', { style: `width:${Math.round(q.equity * 100)}%` })), el('b', {}, `${Math.round(q.equity * 100)}%`))));
          }
          kids.push(play(cmp, 'pk-rise', 450, fx.allin, 900));
        }
      }

      layer.replaceChildren(...kids);
      renderControls(view, movable, actions, L);
    }

    return {
      el: root,
      render(view, opts = {}) {
        // 对局页传来选手名时，名牌显示真名
        if (opts.players && Array.isArray(view?.players)) view = { ...view, players: view.players.map((q) => ({ ...q, name: opts.players[q.seat]?.name || q.name })) };
        last = { view, opts };
        track(view, opts);
        draw(view, opts);
      },
    };
  },
};
