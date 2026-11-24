// 德州扑克画面：漆边绿绢椭圆桌（桌沿有厚度、嵌两道金线），座位均匀环绕（2–6 人），按钮位、大小盲标在座位前。
// 实体筹码按面额配色（1 象牙、5 朱、25 青、100 墨、500 紫），一枚一枚叠起来，侧面露出条纹。
// 上帝视角：在局玩家的底牌翻开，名牌下面是实时胜率；玩家视角只看得到自己的底牌。
// 动效：新一手发牌飞入；翻牌三张依次翻开，转牌、河牌单张翻；下注时筹码从座位滑到桌前，一轮结束收进底池；
// 一手结束（摊牌）：收注 → 按顺序一家一家亮底牌（最后加注的人先亮）→ 补翻公共牌（大底池全下时转牌、河牌前多停）→ 五张牌抬起、牌型徽章弹出、输家的牌变淡
// → 主池、各边池依次推给各自的赢家；有人全下时桌面压暗、「ALL IN」横幅、胜率对比。终局那一手的结算卡可以切到全场统计。
// 玩家本人行动时右下角是操作台：弃牌、过牌/跟注、加注（预设 + 滑杆 + 数字）、全下；没轮到时那里换成预选操作（过牌/弃牌、跟注 X、跟任何注），
// 轮到时自动出手。防误点：跟注额刚变时跟注键锁 1 秒，加注超过剩余筹码 1/3 或全下要再点一次确认。右上角可切换按筹码 / 大盲数（BB）显示。
// 每一手开始弹开局提示（第几手、盲注、庄位），结束弹结算卡（公共牌、亮出的底牌和牌型、各人输赢）；
// 停多久见 games/poker/timing.js——服务端按同一份时长停下来等，画面演完才轮到下一个人。
//
// 画面用 HTML 画：根节点是尺寸容器，桌面固定比例（横版 80×50em，竖版 50×70em），里面一律用 em 定位，等比缩放。
// 动画按「开始时刻」续播：重画时用负的 animation-delay 接上，对局推进不会打断正在进行的动画。

import { fromCode, bestFive, code as codeOf } from '/games/poker/cards.js';
import { T as TM, schedule, endInfo, pauseBetween } from '/games/poker/timing.js';

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
    ring: { rx: 35.5, ry: 20.4 },
    seat: { w: 15.4, h: 4.9 }, clampX: [8.4, 71.6], clampY: [8.8, 44.4],
    board: { cx: 40, y: 16.2, cw: 5.3, gap: 0.65 },
    pot: { cx: 40, y: 24.1 }, info: [1.4, 1.2], cmp: { cx: 40, y: 27.8, w: 26 }, act: { cx: 40, y: 31.4 }, push: 27.7, badge: 32.1,
    ctl: { x: 50.6, y: 39.9, w: 29, h: 9.6 }, pill: [1.4, 45.4],
  },
  port: {
    w: 50, h: 70,
    table: { cx: 25, cy: 30.5, rx: 19.5, ry: 25 },
    ring: { rx: 21, ry: 25.2 },
    seat: { w: 13.8, h: 4.6 }, clampX: [7.4, 42.6], clampY: [8.8, 54.8],
    board: { cx: 25, y: 22, cw: 4.3, gap: 0.45 },
    pot: { cx: 25, y: 28.6 }, info: [1, 1], cmp: { cx: 25, y: 32.4, w: 28 }, act: { cx: 25, y: 36.4 }, push: 32.2, badge: 36.8,
    ctl: { x: 1, y: 60.4, w: 48, h: 9.2 }, pill: [1, 65.4],
  },
};

// ---------- 样式 ----------
const CSS = `
.pk { position: relative; width: 100%; height: 100%; container-type: size; user-select: none; -webkit-user-select: none; font-family: var(--sans); }
.pk-box { position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: min(100cqw, 160cqh); height: min(62.5cqw, 100cqh); font-size: min(1.25cqw, 2cqh); }
.pk.port .pk-box { width: min(100cqw, 71.43cqh); height: min(140cqw, 100cqh); font-size: min(2cqw, 1.4286cqh); }
.pk-box > *, .pk-layer > * { position: absolute; } /* 这些元素用 em 定位：字号写在子元素上，自己不要改 font-size */
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
/* 人头牌（J/Q/K）：右下角一块描金双线框，框顶一枚冠饰（K 王冠、Q 后冠、J 羽帽），中间衬线大字母，下面花色 */
.pk-c .face { position: absolute; right: .4em; bottom: .36em; width: 2.75em; height: 4.05em; border-radius: .22em; display: grid; grid-template-rows: .95em 1fr .95em; justify-items: center; align-items: center;
  padding: .2em 0 .16em; box-sizing: border-box;
  background: radial-gradient(90% 60% at 50% 42%, rgb(255 255 255 / .85), transparent 70%), linear-gradient(180deg, rgb(232 196 112 / .3), rgb(201 162 74 / .12));
  box-shadow: inset 0 0 0 .05em currentColor, inset 0 0 0 .13em #fffaf0, inset 0 0 0 .18em rgb(186 142 52 / .85), 0 .03em .06em rgb(90 60 14 / .25); }
.pk-c .face svg { width: 1.9em; height: .95em; overflow: visible; }
.pk-c .face b { font: 900 2.05em/1 var(--serif); letter-spacing: -.02em; text-shadow: 0 .04em 0 rgb(255 255 255 / .9); }
.pk-c .face i { font-style: normal; font-size: .9em; line-height: 1; }
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
.pk-seat .who { display: grid; gap: .28em; min-width: 4em; flex: 1 1 auto; }
.pk-seat .who b { font: 900 1.3em/1.1 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 竖版名牌窄：收紧留白、铜钱和筹码数，名字放得下四个字；再长就折成两行 */
.pk.port .pk-seat { gap: .42em; padding: 0 .6em 0 .45em; }
.pk.port .pk-seat .coin { font-size: 1.22em; }
.pk.port .pk-seat .stk { font-size: 1.55em; }
.pk.port .pk-seat .who { gap: .18em; }
.pk.port .pk-seat .who b { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-height: 1.04; word-break: break-all; }
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
  background: var(--glint), var(--surface), var(--edge-hi) border-box; box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .6em 1em rgb(0 0 0 / .6); animation: pk-ctlin .28s ${EASE} both; transform-origin: 50% 100%; }
/* 出手区原地淡入、略放大：不往下位移（位移那一下会伸出页面底部，Windows 上闪出滚动条，整张牌桌跟着缩放抖动） */
@keyframes pk-ctlin { from { opacity: 0; transform: scale(.96); } }
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
/* 按键提示：按钮右上角一个小角标（触屏上不显示） */
.pk-ctl .btn[data-key]::after { content: attr(data-key); position: absolute; right: .3em; top: .2em; font: 700 .6em/1 var(--num); opacity: .55; }
@media (hover: none) { .pk-ctl .btn[data-key]::after { display: none; } }
.pk.port .pk-ctl .btn { font-size: 1.45em; }
.pk.port .pk-ctl .pre button { font-size: 1.25em; }
.pk.port .pk-ctl input[type=number] { font-size: 1.5em; }

/* 轮到谁：名牌外一圈细金边（静止，不闪不呼吸），桌布上靠近他的地方亮起一片很淡的台灯光晕；头上挂「思考中」「轮到你」 */
.pk-pool { width: 24em; height: 12em; translate: -50% -50%; pointer-events: none; border-radius: 50%;
  background: radial-gradient(closest-side, rgb(255 230 170 / .17), rgb(255 230 170 / .07) 55%, rgb(255 230 170 / 0)); }
@keyframes pk-poolin { from { opacity: 0; transform: scale(.8); } }
.pk-seat.on { z-index: 2; }
.pk-seat.on::after { content: ''; position: absolute; inset: -.12em; z-index: -1; border-radius: inherit; pointer-events: none;
  box-shadow: 0 0 0 .09em #140703, 0 0 0 .22em #e8c46a, 0 .5em 1.5em -.25em rgb(255 205 120 / .4); animation: pk-onin .3s ease-out both; }
@keyframes pk-onin { from { opacity: 0; transform: scale(1.05); } }
.pk-seat .who span.turn { color: #f6dc94; } .pk-seat .who span.turn::after { content: '…'; display: inline-block; animation: pk-dot 1.2s ease-in-out infinite; }
.pk-seat .who span.me { color: #ff8a6a; font-weight: 800; }
/* 浅色主题的名牌是宣纸色：金字、朱字换深一档（对比度 ≥ 4.5:1） */
:root[data-theme="light"] .pk-seat .who span.turn { color: #7a4e0c; }
:root[data-theme="light"] .pk-seat .who span.me { color: #a3261a; }
.pk-seat .tag { position: absolute; left: 50%; bottom: calc(100% + .45em); translate: -50% 0; display: flex; align-items: center; gap: .4em; white-space: nowrap; padding: .32em .8em .36em; border-radius: 1em;
  font: 700 1.05em/1 var(--sans); letter-spacing: .1em; color: var(--on-gold); background: var(--gold-metal); box-shadow: var(--gold-key-sh), 0 .3em .6em rgb(0 0 0 / .45); z-index: 3; }
.pk-seat .tag::after { content: ''; position: absolute; left: 50%; top: 100%; translate: -50% 0; border: .4em solid transparent; border-top-color: #c8983c; }
.pk-seat .tag.me { color: #fff4e0; background: linear-gradient(180deg, #e2523d, #8e1b12); box-shadow: inset 0 .06em 0 rgb(255 220 200 / .5), 0 0 1.2em rgb(255 120 80 / .55); }
.pk-seat .tag.me::after { border-top-color: #8e1b12; }
.pk-seat .tag i { width: .36em; height: .36em; border-radius: 50%; background: currentColor; animation: pk-dot 1.2s ease-in-out infinite; }
.pk-seat .tag i:nth-child(2) { animation-delay: .2s; } .pk-seat .tag i:nth-child(3) { animation-delay: .4s; }
.pk.port .pk-seat .tag { bottom: auto; top: calc(100% + .45em); }
.pk.port .pk-seat .tag::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: #c8983c; }
.pk-seat .tmr { position: absolute; right: -.5em; top: -.85em; font: 700 1em/1 var(--num); padding: .25em .5em .28em; border-radius: .8em; color: #2a1206; z-index: 3;
  background: linear-gradient(180deg, #fff3c8, #f0cd78); box-shadow: 0 .1em 0 #8e6824, 0 .2em .4em rgb(0 0 0 / .4); font-variant-numeric: tabular-nums; }
.pk-seat .tmr.warm { background: linear-gradient(180deg, #ffd9a0, #f09a3c); }
.pk-seat .tmr.hot { color: #fff4e0; background: linear-gradient(180deg, #ff8a6a, #c42d1e); animation: tmr-pulse 1s ease-in-out infinite; }
@keyframes tmr-pulse { 50% { transform: scale(1.12); } }
/* 桌心：刚才那一手（谁、做了什么），每出一手弹一次 */
.pk-act { translate: -50% -50%; display: flex; align-items: center; gap: .7em; padding: .45em 1.3em .45em .5em; border-radius: 2em; white-space: nowrap; pointer-events: none;
  background: rgb(8 4 2 / .7); box-shadow: inset 0 .08em .25em rgb(0 0 0 / .7), 0 .06em 0 rgb(255 224 176 / .14), 0 0 0 .08em rgb(240 205 120 / .4), 0 .5em 1.2em rgb(0 0 0 / .45); }
.pk-act .no { width: 2.1em; height: 2.1em; border-radius: 50%; display: grid; place-items: center; font: 700 1.1em/1 var(--num); color: #2a1206;
  background: radial-gradient(circle at 36% 28%, #fff6d6, #f0cd78 50%, #a67a2a); box-shadow: inset 0 0 0 .1em rgb(255 246 214 / .6), 0 .1em 0 #6a4a14; }
.pk-act .nm { font: 700 1.25em/1 var(--serif); color: #f2e3c2; max-width: 8em; overflow: hidden; text-overflow: ellipsis; }
.pk-act .tx { font: 400 2.3em/1 var(--brush); background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; padding: .05em .05em 0; }
.pk-act.fold .tx { background: none; color: rgb(220 210 190 / .7); }
.pk-act.raise .tx, .pk-act.allin .tx { background: linear-gradient(180deg, #ffd2b8, #ff7a5a 50%, #e2523d); -webkit-background-clip: text; background-clip: text; }
.pk-act.allin { box-shadow: inset 0 .08em .25em rgb(0 0 0 / .7), 0 0 0 .1em #e2523d, 0 0 1.6em rgb(255 110 70 / .5); }
@keyframes pk-actin { 0% { transform: scale(.6) translateY(.6em); opacity: 0; } 55% { transform: scale(1.08); opacity: 1; } 100% { transform: none; } }

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
/* 结算卡右上角的关闭键；收起后桌角留一枚「结算 ▸」小签，点开再看 */
.pk-x { position: absolute; right: .5em; top: .5em; width: 2.1em; height: 2.1em; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer; pointer-events: auto; z-index: 2;
  font: 700 1.05em/1 var(--sans); color: #6a4a2a; background: rgb(120 84 30 / .12); box-shadow: inset 0 0 0 .07em rgb(120 84 30 / .3); transition: background-color .15s, color .15s; }
.pk-x:hover, .pk-x:focus-visible { color: #8e1b12; background: rgb(120 84 30 / .22); }
.pk-pill { display: flex; align-items: center; gap: .45em; padding: .5em .95em .55em; border-radius: 1.2em; border: .12em solid transparent; cursor: pointer; z-index: 6; white-space: nowrap;
  font: 700 1em/1 var(--sans); letter-spacing: .1em; color: var(--on-gold); background: var(--gold-metal) padding-box, linear-gradient(180deg, #fbe8a6, #8e6824) border-box;
  box-shadow: var(--gold-key-sh), 0 .3em .6em rgb(0 0 0 / .45); animation: pk-rise .3s ${EASE} both; }
.pk-pill:hover { filter: brightness(1.06); }
.pk-pill > span { font-size: 1.1em; }
.pk.port .pk-pill > span { font-size: 1.4em; }
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
/* 摊牌：亮牌时看得到的牌跳一下，抬牌后输家的牌变淡；牌型徽章；大底池全下时牌背鼓动；分池的标签；收注时底池鼓一下 */
.pk-c.lose { opacity: .45; }
@keyframes pk-lose { from { opacity: 1; } }
@keyframes pk-show { 40% { scale: 1.12; } }
@keyframes pk-sweat { 25%, 75% { scale: 1.06; } 50% { scale: 1; } }
@keyframes pk-bump { 50% { transform: scale(1.08); } }
.pk-badge { translate: -50% -50%; display: flex; align-items: baseline; gap: .6em; padding: .42em 1.3em .48em; border-radius: 2em; white-space: nowrap; pointer-events: none;
  color: var(--on-gold); background: var(--gold-metal); box-shadow: var(--gold-key-sh), 0 0 0 .1em rgb(40 14 4 / .6), 0 .5em 1.4em rgb(0 0 0 / .55), 0 0 2.2em rgb(255 214 120 / .35); }
.pk-badge small { font: 700 1em/1 var(--sans); letter-spacing: .12em; opacity: .78; }
.pk-badge b { font: 400 2.3em/1 var(--brush); letter-spacing: .02em; }
@keyframes pk-badge { 0% { transform: scale(.5); opacity: 0; } 39% { transform: scale(1.18); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
.pk-push { translate: -50% 0; display: flex; align-items: baseline; gap: .45em; padding: .36em 1em .4em; border-radius: 1em; white-space: nowrap; pointer-events: none;
  font: 700 1em/1 var(--sans); letter-spacing: .06em; color: #f6dc94; background: rgb(8 4 2 / .72); box-shadow: inset 0 .08em .25em rgb(0 0 0 / .7), 0 0 0 .08em rgb(240 205 120 / .45); }
.pk-push span { font-size: 1.1em; }
.pk-push b { font: 600 1.25em/1 var(--num); color: #fff4d8; letter-spacing: 0; }
.pk-push.ret { color: rgb(240 225 190 / .75); }
.pk-seat.bbm .stk { font-size: 1.4em; }

/* 右上角：筹码 / 大盲数切换 */
.pk-bbt { translate: -100% 0; display: flex; gap: .15em; padding: .2em; border-radius: .8em; border: .12em solid transparent; cursor: pointer; z-index: 4;
  font: 700 1em/1 var(--num); color: var(--muted); background: var(--glint), var(--surface), var(--edge) border-box;
  box-shadow: var(--hi), 0 .14em 0 #3e2a0a, 0 .35em .5em rgb(0 0 0 / .45); }
.pk-bbt span { font-size: .95em; white-space: nowrap; padding: .38em .62em; border-radius: .6em; transition: background-color .2s, color .2s; }
.pk-bbt:not(.bb) .c, .pk-bbt.bb .b { color: var(--on-gold); background: var(--gold-metal); box-shadow: var(--gold-key-sh); }
.pk-bbt:hover { color: var(--text); }
.pk.port .pk-bbt span { font-size: 1.2em; }

/* 预选操作：没轮到你时先勾好，轮到时自动出手 */
.pk-preact { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5em; padding: .5em .6em; border-radius: 1em; border: .14em solid transparent;
  background: var(--glint), var(--surface), var(--edge) border-box; box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .6em 1em rgb(0 0 0 / .5); animation: pk-rise .3s ${EASE} both; }
.pk-preact[hidden] { display: none; }
.pk-preact .pa { display: flex; align-items: center; justify-content: center; gap: .45em; min-width: 0; border: 0; border-radius: .6em; padding: 0 .5em; cursor: pointer;
  font: 700 1.05em/1 var(--sans); color: var(--muted); background: var(--well-bg); box-shadow: var(--well-sh); white-space: nowrap; overflow: hidden; }
.pk-preact .pa span { overflow: hidden; text-overflow: ellipsis; }
.pk-preact .pa:hover { color: var(--text); }
.pk-preact .pa .box { position: relative; flex: none; width: 1em; height: 1em; border-radius: .25em; box-shadow: inset 0 0 0 .12em currentColor; }
.pk-preact .pa.on { color: var(--on-gold); background: var(--gold-metal); box-shadow: var(--gold-key-sh); }
.pk-preact .pa.on .box::after { content: '✓'; position: absolute; inset: 0; display: grid; place-items: center; font: 900 .9em/1 var(--sans); }
.pk.port .pk-preact .pa { font-size: 1.3em; }

/* 防误点：跟注额刚变时跟注键锁 1 秒（底边一道进度条），大额加注 / 全下要再点一次 */
.pk-ctl .btn { position: relative; }
.pk-ctl .btn.cool::before { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: .2em; background: var(--gold-2, #f0cd78); transform-origin: 0 50%; animation: pk-cool 1s linear both; }
@keyframes pk-cool { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.pk-ctl .btn.arm { animation: pk-arm .9s ease-in-out infinite; }
@keyframes pk-arm { 50% { scale: 1.05; } }

/* 终局：结算卡上切「本手 / 全场统计」 */
.pk-sum .tabs { justify-self: center; display: flex; gap: .25em; padding: .22em; border-radius: .8em; background: rgb(120 84 30 / .14); box-shadow: inset 0 .06em .15em rgb(80 50 10 / .25); }
.pk-sum .tabs button { pointer-events: auto; border: 0; background: transparent; cursor: pointer; padding: .45em 1.1em; border-radius: .6em; font: 700 1em/1 var(--sans); letter-spacing: .12em; color: #7a5a2a; }
.pk-sum .tabs button.on { color: #8e1b12; background: #fffaf0; box-shadow: 0 .08em .2em rgb(80 50 10 / .35); }
/* 盖掉全站 .tabs 的下划线、下边距和手机上的 44px 最小高度（这里是一块小分段键） */
.pk-sum .tabs { margin: 0; border: 0; overflow: visible; }
.pk-sum .tabs button { min-height: 0; }
.pk-sum .tabs .on::after { display: none; }
.pk-stats { width: 56em; }
.pk-stats .tb { display: grid; gap: .28em; }
.pk-stats .th, .pk-stats .tr { display: grid; grid-template-columns: 2em minmax(0, 1fr) 5.6em 6.6em 2.8em 3.4em 3.4em 3.8em 5.4em; align-items: center; gap: .55em; padding: .28em .6em; text-align: right; white-space: nowrap; }
/* 表头、行本身不设字号（列宽用 em，字号写在格子上，两边才对得齐） */
.pk-stats .th { padding-top: 0; padding-bottom: 0; }
.pk-stats .th > span { font: 700 .88em/1.2 var(--sans); letter-spacing: .06em; color: #8a6a3a; }
.pk-stats .th span:nth-child(2), .pk-stats .tr .nm { text-align: left; }
.pk-stats .tr { border-radius: .6em; background: rgb(120 84 30 / .08); color: #3a2410; }
.pk-stats .tr > span { font: 600 1.05em/1.2 var(--num); font-variant-numeric: tabular-nums; }
.pk-stats .tr.lead { background: linear-gradient(90deg, rgb(240 190 80 / .42), rgb(240 190 80 / .12)); box-shadow: inset 0 0 0 .08em rgb(166 122 42 / .6); }
.pk-stats .tr > .no { width: 1.9em; height: 1.9em; border-radius: 50%; display: grid; place-items: center; font: 700 .95em/1 var(--num); color: #fff4e0; background: radial-gradient(circle at 36% 28%, #e2523d, #8e1b12); box-shadow: inset 0 0 0 .1em rgb(255 255 255 / .3); }
.pk-stats .tr > .nm { font: 900 1.1em/1.2 var(--serif); overflow: hidden; text-overflow: ellipsis; }
.pk-stats .tr > .nt { font-size: 1.15em; }
.pk-stats .tr .nt.up { color: #1f7a4c; } .pk-stats .tr .nt.dn { color: #a8321f; }
.pk-stats .tr > .spk { display: block; height: 1.7em; color: #8a6a3a; }
.pk-stats .spk.up { color: #1f7a4c; } .pk-stats .spk.dn { color: #a8321f; }
.pk-stats .spk svg { display: block; width: 100%; height: 100%; overflow: visible; }
.pk-stats .spk polyline { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.pk-stats .spk line { stroke: rgb(120 84 30 / .4); stroke-width: 1; stroke-dasharray: 2 2; vector-effect: non-scaling-stroke; }
.pk.port .pk-stats { width: 47.5em; }
/* 竖版：去掉走势列，字放大 */
.pk.port .pk-stats > * { font-size: 1.12em; }
.pk.port .pk-stats .th, .pk.port .pk-stats .tr { grid-template-columns: 1.9em minmax(0, 1fr) 4.6em 2.4em 3.2em 3.2em 3.4em 4.4em; gap: .4em; padding-left: .4em; padding-right: .4em; }
.pk.port .pk-stats .tr > .spk, .pk.port .pk-stats .th > span:nth-child(4) { display: none; }

/* 浅色主题：结算卡背后的压暗换成暖墨色，不是一层黑 */
:root[data-theme="light"] .pk-veil { background: radial-gradient(62% 60% at 50% 47%, rgb(42 18 9 / .3), rgb(42 18 9 / .45)); }
/* 跟注额刚变、跟注键锁着的那 1 秒：按 C 或点按钮时浮一句说明 */
.pk-cooltip { position: absolute; left: 50%; bottom: calc(100% + .5em); translate: -50% 0; z-index: 3; padding: .4em .9em; border-radius: .6em; white-space: nowrap; pointer-events: none;
  font: 600 1em/1.3 var(--sans); color: #fff3d6; background: rgb(42 12 6 / .92); box-shadow: 0 0 0 .08em rgb(240 205 120 / .55), 0 .3em .6em rgb(0 0 0 / .45); animation: pk-rise .2s ${EASE} both; }
.pk-cooltip[hidden] { display: none; }
.pk.port .pk-cooltip { font-size: 1.3em; }
/* 触屏：结算卡的 ✕、本手 / 全场统计切换键，命中区扩到 44px 以上（外观不变） */
@media (pointer: coarse) {
  .pk-x::before, .pk-sum .tabs button::before { content: ''; position: absolute; inset: -12px; }
  .pk-sum .tabs button { position: relative; }
}
/* 手机竖屏：操作台的按钮至少 40px 高 */
@media (max-width: 700px) {
  .pk-ctl .r2 .btn { min-height: 40px; }
}

@media (prefers-reduced-motion: reduce) {
  .pk-seat.on::after, .pk-seat .think i, .pk-seat .tag i, .pk-seat .tmr.hot, .pk-seat .who span.turn::after, .pk-ctl .btn.arm, .pk-cooltip { animation: none !important; }
}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('pk-stage-style')) return;
  const st = document.createElement('style');
  st.id = 'pk-stage-style';
  st.textContent = CSS;
  document.head.append(st);
}

/** 建 DOM：el('div', { class, style, onclick }, ...子节点 / 文字) */
/** 容器里前面几个固定节点不动，只把后面的动态节点换成 kids */
function setLayer(box, fixed, kids) {
  if (!fixed.every((n, i) => box.childNodes[i] === n)) { box.replaceChildren(...fixed, ...kids); return; }
  if (box.childNodes.length > fixed.length) {
    const r = document.createRange();
    r.setStartAfter(fixed.at(-1));
    r.setEndAfter(box.lastChild);
    r.deleteContents();
  }
  box.append(...kids);
}

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
    face ? faceEl(r, s) : el('div', { class: 'pip' }, s));
}

// 人头牌的冠饰：K 王冠、Q 后冠、J 羽帽（金面，描边用牌的红 / 黑）
const CROWN = {
  K: '<path d="M2.5 9.2 1.6 2.6l5 3.4L10 .9l3.4 5.1 5-3.4-.9 6.6z"/><path d="M3 9.2h14" stroke-width="1.3"/><circle cx="1.6" cy="2.4" r="1"/><circle cx="10" cy=".8" r="1"/><circle cx="18.4" cy="2.4" r="1"/>',
  Q: '<path d="M2.6 9.2C2.6 5.4 5.6 2.7 10 2.7s7.4 2.7 7.4 6.5z"/><path d="M3 9.2h14" stroke-width="1.3"/><path d="M6 6.2 10 4.3l4 1.9" fill="none"/><circle cx="10" cy="1.3" r="1.1"/>',
  J: '<path d="M2.4 9.2c0-2.8 3-4.9 7.6-4.9s7.6 2.1 7.6 4.9z"/><path d="M3 9.2h14" stroke-width="1.3"/><path d="M12.6 4.6C13.8 1.6 16.6.4 19.2 1.1c-1.3 1.1-2.8 2.4-4.4 4" fill="none"/>',
};
function faceEl(r, s) {
  const f = el('div', { class: 'face' });
  f.innerHTML = `<svg viewBox="0 0 20 10" aria-hidden="true" fill="#e6bd5c" stroke="currentColor" stroke-width=".9" stroke-linejoin="round" stroke-linecap="round">${CROWN[r]}</svg>`;
  f.append(el('b', {}, r), el('i', {}, s));
  return f;
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


/** 思考计时：行动者名牌上的「12s」，每秒自己更新（不重画整张桌）；越久越热：30 秒后橙、90 秒后红 */
function thinkTimer(t0) {
  const n = el('span', { class: 'tmr', 'data-t0': String(t0) });
  paintTimer(n);
  return n;
}
function paintTimer(n) {
  const s = Math.max(0, Math.floor((Date.now() - Number(n.dataset.t0)) / 1000));
  n.textContent = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
  n.classList.toggle('warm', s >= 30 && s < 90);
  n.classList.toggle('hot', s >= 90);
}
let timerTick = null;
function startTimerTick(root) {
  clearInterval(timerTick);
  timerTick = setInterval(() => {
    const ns = root.isConnected ? root.querySelectorAll('.tmr') : [];
    if (!ns.length) { clearInterval(timerTick); timerTick = null; return; }
    ns.forEach(paintTimer);
  }, 1000);
}
const seatNo = (seat) => Number(String(seat).slice(1));
const short = (t, n) => { const a = [...String(t || '')]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join(''); };

const STREET_NAME = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌' };
/** 和服务端 interlude 用同样的字段算停顿（见 timing.js 的 pauseBetween） */
const pickView = (v) => v && ({
  handNo: v.handNo, boardLen: v.board.length, over: !!v.over, bb: v.blinds?.bb,
  last: v.last ? { showdown: !!v.last.showdown, boardLen: v.last.board.length, shown: Object.keys(v.last.shown || {}).length, pots: v.last.pots?.length || 1, pot: v.last.pot ?? 0 } : null,
  done: v.result ? { showdown: !!v.result.showdown, boardLen: v.board.length, shown: v.result.shown?.length ?? 0, pots: v.result.pots?.length || 1, pot: v.pot } : null,
});
/**
 * 画的是不是「正在进行的最新局面」：对局页传 opts.live 时以它为准；
 * 否则复盘回放（opts.replay）不是；对局页的 opts.clock 只在实时对局里非空；缩略图等不传 clock 的地方按实时算
 */
const isLive = (opts) => ('live' in opts ? !!opts.live
  : opts.replay ? false
    : opts.clock && typeof opts.clock === 'object' ? Object.keys(opts.clock).length > 0 || !!opts.movable
      : true);
/** 按大盲数显示：250 → 125BB，25 → 12.5BB */
const fmtBB = (v, bb) => `${Math.round((v / bb) * 10) / 10}BB`;

export default {
  // 对局页用「牌桌 + 右侧聚光框 + 本手记录」版式：牌桌上已经有每个人的名牌、筹码和动作，两侧不再放选手卡
  hud: true,
  // 手机竖屏的操作台在牌桌下方，桌面在右下角
  turnTip: () => (typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? '轮到你了：在牌桌下方的操作台出手。' : '轮到你了：在牌桌右下角的操作台出手。'),

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

    // ---------- 筹码 / 大盲数切换（桌面右上角，记在本地） ----------
    let bbMode = false;
    try { bbMode = localStorage.getItem('pk-bb-units') === '1'; } catch { /* 读不到本地存储就按筹码显示 */ }
    let money = (v) => String(v);
    const bbBtn = el('button', { class: 'pk-bbt', type: 'button', title: '切换：筹码数 / 大盲数（BB）', 'aria-label': '切换筹码数和大盲数显示' },
      el('span', { class: 'c' }, '筹码'), el('span', { class: 'b' }, 'BB'));
    bbBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bbMode = !bbMode;
      try { localStorage.setItem('pk-bb-units', bbMode ? '1' : '0'); } catch { /* 存不下就只在这一页有效 */ }
      redraw();
    });

    // ---------- 操作台（只建一次，重画时不重建，拖动滑杆不会被打断） ----------
    const foldBtn = el('button', { class: 'btn', type: 'button' }, '弃牌');
    const callBtn = el('button', { class: 'btn', type: 'button' }, '跟注');
    const raiseBtn = el('button', { class: 'btn primary', type: 'button' }, '加注');
    const allinBtn = el('button', { class: 'btn', type: 'button' }, '全下');
    const range = el('input', { type: 'range', step: 1, 'aria-label': '加注金额' });
    const num = el('input', { type: 'number', step: 1, 'aria-label': '加注金额' });
    const presets = el('div', { class: 'pre' });
    const r1 = el('div', { class: 'r1' }, presets, range, num);
    const coolTip = el('div', { class: 'pk-cooltip', role: 'status', hidden: '' }, '跟注额刚变，1 秒后可按');
    const r2 = el('div', { class: 'r2' }, foldBtn, callBtn, raiseBtn, allinBtn, coolTip);
    r2.style.position = 'relative';
    const ctl = el('div', { class: 'pk-ctl', hidden: '' }, r1, r2);
    // 锁着的跟注键：按 C、空格或点它时说明为什么没反应（禁用的按钮收不到点击，听外层）
    let coolTipTimer = null;
    const showCool = () => { coolTip.hidden = false; clearTimeout(coolTipTimer); coolTipTimer = setTimeout(() => { coolTip.hidden = true; }, 1200); };
    r2.addEventListener('pointerdown', (e) => {
      if (!callBtn.classList.contains('cool')) return;
      const r = callBtn.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) showCool();
    });
    ctl.addEventListener('click', (e) => e.stopPropagation());

    // ---------- 预选操作（还没轮到你时先勾好，轮到时自动出手） ----------
    const preBtn = (k, text) => el('button', { type: 'button', class: 'pa', role: 'checkbox', 'aria-checked': 'false', 'data-k': k }, el('i', { class: 'box' }), el('span', {}, text));
    const preCF = preBtn('cf', '过牌/弃牌');
    const preCall = preBtn('call', '跟注');
    const preAny = preBtn('any', '跟任何注');
    const preBox = el('div', { class: 'pk-preact', hidden: '' }, preCF, preCall, preAny);
    let pre = { kind: null, amt: 0, hand: null };
    let preX = 0; // 现在要跟多少（不是你行动时按桌面算）
    const paintPre = () => {
      for (const b of [preCF, preCall, preAny]) {
        const on = b.dataset.k === pre.kind;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    };
    for (const b of [preCF, preCall, preAny]) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = b.dataset.k;
        pre = pre.kind === k ? { ...pre, kind: null } : { ...pre, kind: k, amt: preX };
        paintPre();
      });
    }
    preBox.addEventListener('click', (e) => e.stopPropagation());
    box.append(layer, bbBtn, preBox, ctl);

    let cur = { ids: new Set(), legal: null, callId: null, verb: '加注到' };

    // 防误点：大额加注（≥ 剩余筹码的 1/3）、全下要在 3 秒内再点一次
    let armed = null;
    const disarm = () => {
      if (!armed) return;
      clearTimeout(armed.timer);
      armed.btn.textContent = armed.text;
      armed.btn.classList.remove('arm');
      armed = null;
    };
    const confirmed = (btn) => {
      if (armed && armed.btn === btn) { disarm(); return true; }
      disarm();
      armed = { btn, text: btn.textContent, timer: setTimeout(disarm, 3000) };
      btn.textContent = '再点确认';
      btn.classList.add('arm');
      return false;
    };
    const bigBet = (to) => {
      const L = cur.legal;
      if (!L) return false;
      const bet = L.bet || 0;
      const stack = L.maxTo - bet;
      return stack > 0 && to - bet >= stack / 3;
    };

    const amount = () => {
      const L = cur.legal;
      if (!L) return 0;
      const v = Math.round(Number(num.value));
      return Number.isFinite(v) ? Math.max(L.minTo, Math.min(L.maxTo, v)) : L.minTo;
    };
    const setAmount = (v, from) => {
      const L = cur.legal;
      if (!L) return;
      if (armed && armed.btn === raiseBtn) disarm();
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
    foldBtn.addEventListener('click', () => { disarm(); if (cur.ids.has('fold')) onAction('fold'); });
    callBtn.addEventListener('click', () => { disarm(); if (cur.callId && !callBtn.disabled) onAction(cur.callId); });
    allinBtn.addEventListener('click', () => {
      if (!cur.ids.has('allin') || !confirmed(allinBtn)) return;
      onAction('allin');
    });
    raiseBtn.addEventListener('click', () => {
      const L = cur.legal;
      if (!L || !L.canRaise) return;
      const v = amount();
      if (bigBet(v) && !confirmed(raiseBtn)) return;
      onAction(v >= L.maxTo ? 'allin' : `raise:${v}`);
    });

    // 快捷键：F 弃牌、C 或空格 过牌/跟注、R 加注、A 全下、1–5 选加注预设（在输入框里打字时不抢键）
    const KEYS = { f: foldBtn, c: callBtn, ' ': callBtn, r: raiseBtn, a: allinBtn };
    const kbd = (b, k) => { b.dataset.key = k; };
    kbd(foldBtn, 'F'); kbd(callBtn, 'C'); kbd(raiseBtn, 'R'); kbd(allinBtn, 'A');
    const onKey = (e) => {
      if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (ctl.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target?.tagName;
      if ((tag === 'INPUT' && e.target.type !== 'range') || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (/^[1-5]$/.test(k)) { const b = presets.children[Number(k) - 1]; if (b) { e.preventDefault(); b.click(); } return; }
      const b = KEYS[k];
      if (b === callBtn && callBtn.classList.contains('cool')) { e.preventDefault(); showCool(); return; }
      if (b && !b.disabled) { e.preventDefault(); b.classList.add('is-active'); setTimeout(() => b.classList.remove('is-active'), 120); b.click(); }
    };
    document.addEventListener('keydown', onKey);

    /** 预选的操作在轮到你时对应哪个行动；「跟注 X」的金额变了就不出手 */
    function preFire(p, ids, lg) {
      const toCall = lg ? lg.toCall : 0;
      const short = lg ? lg.maxTo - (lg.bet || 0) <= lg.owe : false;
      const callId = ids.has('check') ? 'check' : ids.has('call') ? 'call' : short && ids.has('allin') ? 'allin' : null;
      if (p.kind === 'cf') return ids.has('check') ? 'check' : ids.has('fold') ? 'fold' : null;
      if (p.kind === 'any') return callId;
      if (p.kind === 'call') return toCall === p.amt ? callId : null;
      return null;
    }

    let ctlKey = '';
    let lastOwe = null; // 上一次画桌面时你要跟的数：轮到你时金额变了，跟注键先锁 1 秒
    let coolTimer = null;
    // 手机竖屏上操作台比版式里留的位置高（按键至少 40px）：超出牌桌底边的那一截原来被下面的聚光框盖住，
    // 「弃牌 / 跟注 / 加注」的下半截点不到。量出超出多少，给牌桌那一栏（.stage-board）留出同样的下边距；
    // 只增不减——轮到我、不轮到我时页面不上下跳；换版式（横竖屏）时重量
    let ctlReserve = 0;
    let ctlReserveFor = '';
    let ctlRaf = 0;
    function reserveForControls() {
      if (ctlRaf || typeof requestAnimationFrame !== 'function') return;
      ctlRaf = requestAnimationFrame(() => {
        ctlRaf = 0;
        const wrap = root.closest('.stage-board') || root.parentElement;
        if (!wrap || ctl.hidden) return;
        if (ctlReserveFor !== layoutName) { ctlReserveFor = layoutName; ctlReserve = 0; wrap.style.marginBottom = ''; }
        if (layoutName !== 'port') return; // 横版式里操作台在牌桌右下角，位置是留够的
        const over = Math.ceil(ctl.getBoundingClientRect().bottom - root.getBoundingClientRect().bottom) + 8;
        if (over > ctlReserve + 1 && over > 8) { ctlReserve = over; wrap.style.marginBottom = `${over}px`; }
      });
    }
    function renderControls(view, movable, actions, L) {
      const show = !!movable && view.toAct === movable && Array.isArray(actions) && actions.length > 0;
      ctl.hidden = !show;
      if (!show) { ctlKey = ''; disarm(); return; }
      ctl.style.cssText = `${pos(L.ctl.x, L.ctl.y)};width:${L.ctl.w}em;min-height:${L.ctl.h}em`;
      reserveForControls();
      const key = `${view.handNo}|${view.log.length}|${actions.map((a) => a.id).join(',')}`;
      if (key === ctlKey) return; // 同一个决策点：不重置玩家拖到一半的金额
      ctlKey = key;
      disarm();
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
      presets.replaceChildren(...raises.map((a, k) => el('button', { type: 'button', 'data-v': a.id.slice(6), title: `${a.label}（快捷键 ${k + 1}）`, onclick: () => setAmount(Number(a.id.slice(6))) }, a.hint || a.id.slice(6))));
      presets.hidden = !raises.length;
      if (lg) {
        range.min = num.min = lg.minTo;
        range.max = num.max = lg.maxTo;
        setAmount(lg.minTo);
      }
      raiseBtn.disabled = !canRaise;
      if (!canRaise) raiseBtn.textContent = cur.verb;
      clearTimeout(coolTimer);
      callBtn.classList.remove('cool');
      // 预选了操作：轮到你时自动出手（稍停一下让你看见）
      const fire = pre.kind && pre.hand === view.handNo ? preFire(pre, ids, lg) : null;
      pre = { ...pre, kind: null };
      paintPre();
      if (fire) {
        setTimeout(() => { if (ctlKey === key && !ctl.hidden) onAction(fire); }, 300);
        return;
      }
      // 防误点：要跟的数刚变过，跟注键先锁 1 秒
      const before = lastOwe && lastOwe.hand === view.handNo ? lastOwe.v : null;
      if (cur.callId === 'call' && lg && before !== null && before !== lg.toCall) {
        callBtn.disabled = true;
        callBtn.classList.add('cool');
        coolTimer = setTimeout(() => {
          callBtn.classList.remove('cool');
          coolTip.hidden = true;
          if (ctlKey === key) callBtn.disabled = !cur.callId;
        }, 1000);
      }
    }

    /** 预选操作面板：你在这手里、还没轮到你时出现 */
    function renderPre(view, opts, L, busy) {
      const viewer = opts.viewer;
      const me = viewer ? view.players.find((q) => q.seat === viewer) : null;
      if (pre.hand !== view.handNo) pre = { kind: null, amt: 0, hand: view.handNo };
      const inHand = !!me && me.inHand && !me.folded && !me.allin && !view.result && !view.over;
      if (inHand) preX = Math.min(Math.max(0, (view.currentBet || 0) - (me.bet || 0)), me.stack);
      if (!inHand) pre = { ...pre, kind: null };
      // 「跟注 X」：要跟的数变了就自动取消
      if (pre.kind === 'call' && pre.amt !== preX) pre = { ...pre, kind: null };
      const show = inHand && isLive(opts) && !busy && !!view.toAct && view.toAct !== viewer;
      preBox.hidden = !show;
      if (show) {
        const h = 3.9;
        preBox.style.cssText = `${pos(L.ctl.x, L.ctl.y + L.ctl.h - h)};width:${L.ctl.w}em;height:${h}em`;
        preCall.lastChild.textContent = preX > 0 ? `跟注 ${money(preX)}` : '过牌';
      }
      paintPre();
    }

    // ---------- 版式、状态 ----------
    let layoutName = 'land';
    let last = null;
    let timer = null;
    const fx = { prev: null, deal: null, board: { n: 0, t0: null, from: 0 }, bets: {}, collect: null, end: null, allin: null, intro: null, act: { key: '', t0: null }, beam: { key: '', t0: null }, wakes: [] };
    const redraw = () => last && draw(last.view, last.opts);
    const tables = {}; // 横版、竖版的桌子（栏杆、桌布、水印）
    let sumTab = null; // 终局结算卡看哪一页：null 自动（先看这一手，停够后换到全场统计）
    let sumHidden = null; // 收起的是哪一张结算卡（`第几手|是否终局`）：收起后桌角留「结算 ▸」小签
    // Esc 收起结算卡（牌桌在页面上、没有弹窗挡着时）
    const onEsc = (e) => {
      if (!root.isConnected) { document.removeEventListener('keydown', onEsc); return; }
      if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const x = layer.querySelector('.pk-x') || last?.opts?.dock?.querySelector('.pk-x');
      if (!x || !root.getClientRects().length || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      e.preventDefault();
      x.click();
    };
    document.addEventListener('keydown', onEsc);

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
        g[p.seat] = { x, y, th };
      });
      return g;
    }

    // ---------- 庄位 / 盲注标、面前的注：沿「座位 → 底池」方向找空位 ----------
    // 先把桌上固定的东西（公共牌、底池、桌心那一手、各家名牌、底牌、胜率条）记成矩形，
    // 候选位置按偏好排好（注在离座位约 35% 处、标在名牌旁边），挑第一个谁也不压、又在桌面里的；都压到就挑压得最少的。
    const overlapArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    /** 一摞注（底部中心 bx, by）和金额标签占的矩形；side 为 1 标签在右、-1 在左 */
    function betBoxes(bx, by, amount, side) {
      const cols = breakdown(amount, 3);
      const n = Math.max(1, cols.length);
      const k = Math.min(6, Math.max(1, ...cols.map((c) => c[4])));
      const w = (n - 1) * 1.95 + 2.3;
      const chipsBox = [bx - w / 2, by - 1.24 - (k - 1) * 0.3 - (n > 1 ? 0.25 : 0), bx + w / 2, by + 0.6];
      const lw = String(money(amount)).length * 0.72 + 1.4;
      const lx = bx + side * (1.4 + (n - 1) * 0.98);
      const ly = by - 0.9;
      return [chipsBox, side > 0 ? [lx, ly - 0.9, lx + lw, ly + 0.9] : [lx - lw, ly - 0.9, lx, ly + 0.9]];
    }
    function chipSpots(view, viewer, g, L, markSeats) {
      const S = L.seat, T = L.table, P = L.pot, B = L.board;
      const bw = B.cw * 5 + B.gap * 4;
      const obs = [
        [B.cx - bw / 2 - 0.4, B.y - 0.4, B.cx + bw / 2 + 0.4, B.y + B.cw * 1.4 + 0.4], // 公共牌
        [P.cx - 6.6, P.y - 0.3, P.cx + 6.6, P.y + 3.7], // 底池
        [L.act.cx - 9.5, L.act.y - 1.5, L.act.cx + 9.5, L.act.y + 1.5], // 桌心那一手
      ];
      for (const p of view.players) {
        const s = g[p.seat];
        if (!s) continue;
        const mine = !!viewer && p.seat === viewer;
        const cfs = (layoutName === 'port' ? 0.66 : 0.74) * (mine ? 1.3 : 1);
        const cw = cfs * 5, ch = cfs * 7;
        const cy = s.y - S.h / 2 - ch + (mine ? 0.9 : 1.5);
        const sp = mine ? 2.2 : 1.25;
        obs.push([s.x - S.w / 2 - 0.3, s.y - S.h / 2 - 0.3, s.x + S.w / 2 + 0.3, s.y + S.h / 2 + 0.3]); // 名牌
        obs.push([s.x - 4.4, s.y + S.h / 2, s.x + 4.4, s.y + S.h / 2 + 2]); // 胜率条
        obs.push([s.x - cw / 2 - sp - 1.2, cy - 0.4, s.x + cw / 2 + sp + 1.2, s.y - S.h / 2]); // 底牌（两张各斜 7°，上角往外探）
      }
      const inFelt = (b) => [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]
        .every(([x, y]) => ((x - T.cx) / (T.rx - 1)) ** 2 + ((y - T.cy) / (T.ry - 1)) ** 2 <= 1);
      const cost = (boxes, list) => boxes.reduce((a, b) => a + (inFelt(b) ? 0 : 40) + list.reduce((c, o) => c + overlapArea(b, o), 0), 0);
      const C = [P.cx, P.y + 1.7];
      /** 从座位朝桌心的方向转 deg 度（屏幕坐标，顺时针为正），走 d 远 */
      const toward = (s, d, deg) => {
        const dx = C[0] - s.x, dy = C[1] - s.y, len = Math.hypot(dx, dy) || 1;
        const a = (deg * Math.PI) / 180, ux = dx / len, uy = dy / len;
        return [s.x + d * (ux * Math.cos(a) - uy * Math.sin(a)), s.y + d * (ux * Math.sin(a) + uy * Math.cos(a)), len];
      };
      const best = (cands, boxesOf, list) => {
        let pick = null;
        for (const c of cands.sort((a, b) => a.pen - b.pen)) {
          const k = cost(boxesOf(c), list);
          if (k === 0) return c;
          if (!pick || k < pick.k) pick = { ...c, k };
        }
        return pick;
      };
      const markBox = (x, y) => [x - 1.3, y - 1.3, x + 1.3, y + 1.65];
      /** 这个点离别家比离自己家还近（看着像别人的）：降低优先 */
      const nearer = (x, y, seat) => {
        const own = Math.hypot(x - g[seat].x, y - g[seat].y);
        return Object.entries(g).some(([k, o]) => k !== seat && Math.hypot(x - o.x, y - o.y) < own);
      };
      const marks = {};
      const markObs = [];
      for (const seat of markSeats) {
        const s = g[seat];
        if (!s) continue;
        const cands = [];
        for (const side of [-1, 1]) for (const d of [9, 10.5, 12, 13.5, 7.5, 6]) for (const deg of [35, 22, 50, 10, 65, 0]) {
          const [x, y] = toward(s, d, side * deg);
          cands.push({ x, y, pen: Math.abs(d - 9) / 2 + Math.abs(deg - 30) / 15 + (side > 0 ? 2 : 0) + (nearer(x, y, seat) ? 4 : 0) });
        }
        const m = best(cands, (c) => [markBox(c.x, c.y)], [...obs, ...markObs]);
        marks[seat] = m;
        markObs.push(markBox(m.x, m.y));
      }
      const bets = new Map();
      return {
        mark: (seat) => marks[seat],
        /** 一家面前这摞注放哪：{ bx, by（底部中心）, side（标签在哪边） } */
        bet(seat, amount) {
          const key = `${seat}|${amount}`;
          if (bets.has(key)) return bets.get(key);
          const s = g[seat];
          const len = toward(s, 0, 0)[2];
          const pref = s.x >= T.cx - 0.5 ? 1 : -1;
          const cands = [];
          for (const f of [0.35, 0.42, 0.3, 0.5, 0.25, 0.58, 0.2]) for (const deg of [0, 12, 24, 36, 48]) for (const sg of deg ? [1, -1] : [1]) for (const side of [pref, -pref]) {
            const [x, y] = toward(s, len * f, sg * deg);
            cands.push({ bx: x, by: y + 1.1, side, pen: Math.abs(f - 0.35) * 10 + deg / 12 + (sg < 0 ? 0.6 : 0) + (side !== pref ? 0.8 : 0) + (nearer(x, y, seat) ? 4 : 0) });
          }
          const b = best(cands, (c) => betBoxes(c.bx, c.by, amount, c.side), [...obs, ...markObs]);
          bets.set(key, b);
          return b;
        },
      };
    }

    const liveOf = (v) => v.players.filter((p) => p.inHand && !p.folded);
    /** 这一手里最近的一次行动（盲注不算） */
    const lastAct = (v) => [...(v.log || [])].reverse().find((e) => !e.blind) || null;
    const actKind = (text) => (/全下/.test(text) ? 'allin' : /弃牌/.test(text) ? 'fold' : /加注|下注/.test(text) ? 'raise' : /跟注/.test(text) ? 'call' : 'check');
    const allinMoment = (v) => !!v && !v.result && liveOf(v).length >= 2 && liveOf(v).some((p) => p.allin);
    const sumBets = (v) => v.players.reduce((a, p) => a + (p.bet || 0), 0);

    // ---------- 一手结束的演出 ----------
    // 结算开始（t0）后：收注 → 一家一家亮牌 → 补翻公共牌 → 抬牌、牌型徽章、输家牌变淡 → 主池、边池依次推给赢家 → 结算卡。
    // 时刻表来自 timing.js 的 schedule，和服务端停顿同一份。终局那一手（final）演完后结算卡一直留着。

    /** 亮牌顺序：最后一条街最后加注的人先亮，没人加注就从庄位左边顺时针 */
    function revealOrder(src, log, seats) {
      const acts = (log || []).filter((e) => !e.blind);
      const st = acts.length ? acts[acts.length - 1].street : null;
      const agg = [...acts].reverse().find((e) => e.street === st && /加注|下注/.test(e.text))?.seat;
      const ring = src.players.map((q) => q.seat);
      const n = ring.length;
      let start = agg && seats.includes(agg) ? ring.indexOf(agg) : (ring.indexOf(src.button) + 1) % n;
      if (start < 0) start = 0;
      const out = [];
      for (let k = 0; k < n; k++) { const s = ring[(start + k) % n]; if (seats.includes(s)) out.push(s); }
      return out;
    }

    function buildEnd(o) {
      let pots = Array.isArray(o.pots) && o.pots.length ? o.pots : null;
      if (!pots) {
        // 没有分池数据：按净赢的人估一个池
        const net = o.net || {};
        const top = Math.max(0, ...Object.values(net));
        let ws = Object.keys(net).filter((s) => net[s] === top && top > 0);
        if (!ws.length) ws = Object.keys(o.shown).slice(0, 1);
        const amount = o.pot || 0;
        const share = ws.length ? Math.floor(amount / ws.length) : 0;
        pots = ws.length ? [{ amount, winners: ws, shares: ws.map((_, k) => share + (k ? 0 : amount - share * ws.length)), uncalled: false, hand: null }] : [];
      }
      const shownSeats = Object.keys(o.shown);
      const winners = new Set(pots.filter((p) => !p.uncalled).flatMap((p) => p.winners));
      if (!winners.size) pots.forEach((p) => p.winners.forEach((w) => winners.add(w)));
      const best = new Set();
      if (o.showdown) {
        const board = o.board.map(fromCode);
        for (const s of winners) if (o.shown[s]) bestFive([...o.shown[s].map(fromCode), ...board]).forEach((c) => best.add(codeOf(c)));
      }
      const info = endInfo(o.from, { showdown: o.showdown, boardLen: o.board.length, shown: shownSeats.length, pots: pots.length, pot: o.pot }, o.bb);
      const sched = schedule(info);
      const payout = {};
      pots.forEach((p) => p.winners.forEach((w, k) => { payout[w] = (payout[w] || 0) + (p.shares?.[k] ?? 0); }));
      const main = pots.find((p) => !p.uncalled && p.hand);
      return {
        ...o, pots, winners, best, info, sched, payout, big: info.big,
        losers: new Set(o.showdown ? shownSeats.filter((s) => !winners.has(s)) : []),
        order: o.showdown ? revealOrder(o.src, o.log, shownSeats) : [],
        streets: ['flop', 'turn', 'river'].slice(3 - info.streets),
        potTotal: pots.reduce((a, p) => a + p.amount, 0),
        badge: o.showdown && main ? { hand: main.hand, who: main.winners } : null,
        dur: o.final ? Infinity : sched.end,
        static: o.t0 === null,
        t0: o.t0 === null ? -1e9 : o.t0,
      };
    }

    /** 上一手的结算（新一手已经开始）：座位按上一步画，亮出的底牌、分池从 view.last 来 */
    function endFromLast(prev, view, t0) {
      const lh = view.last;
      if (!lh || lh.no !== prev.handNo) return null;
      return buildEnd({
        t0, final: false, no: lh.no, src: prev, log: prev.log, collectFrom: sumBets(prev) > 0 ? prev : null, allin: allinMoment(prev),
        board: lh.board, from: prev.board.length, showdown: !!lh.showdown, shown: lh.shown || {}, hands: lh.hands || {}, net: lh.net || {},
        pots: lh.pots, pot: lh.pot ?? prev.pot, text: lh.text, bb: view.blinds?.bb,
        finalStack: Object.fromEntries(view.players.map((q) => [q.seat, q.stack + (q.contrib || 0)])),
        faceDown: new Set(prev.players.filter((q) => !q.cards).map((q) => q.seat)),
      });
    }

    /** 终局那一手的结算（view.result）；prev 为 null 时不演动画，直接画结束的样子 */
    function endFromResult(prev, view, t0) {
      const r = view.result;
      const seats = r.showdown ? (r.shown || liveOf(view).map((q) => q.seat)) : [];
      const shown = {}, hands = {}, net = {}, finalStack = {};
      for (const q of view.players) {
        if (seats.includes(q.seat) && q.cards) { shown[q.seat] = q.cards; if (q.handName) hands[q.seat] = q.handName; }
        if (q.inHand) net[q.seat] = (q.won || 0) - (q.contrib || 0);
        finalStack[q.seat] = q.stack;
      }
      return buildEnd({
        t0: prev ? t0 : null, final: true, no: view.handNo, src: view, log: view.log, collectFrom: prev && sumBets(prev) > 0 ? prev : null, allin: prev ? allinMoment(prev) : false,
        board: view.board, from: prev ? prev.board.length : view.board.length, showdown: !!r.showdown, shown, hands, net,
        pots: r.pots, pot: view.pot, text: r.text, bb: view.blinds?.bb, finalStack,
        faceDown: new Set(prev ? prev.players.filter((q) => !q.cards).map((q) => q.seat) : []),
      });
    }

    /** 公共牌第 k 张在结算里什么时候翻（不用翻返回 null） */
    const flipAt = (E, k) => {
      if (!E.showdown || k < E.from) return null;
      const j = E.streets.indexOf(k < 3 ? 'flop' : k === 3 ? 'turn' : 'river');
      return j < 0 ? null : E.sched.streetAt[j] + (k < 3 ? k * 160 : 0);
    };
    /** 到 t 为止推到这个座位的筹码（withReturn：算不算退回的未跟注部分） */
    const arrivedOf = (E, seat, t, withReturn = true) => {
      let v = 0;
      E.pots.forEach((p, i) => {
        if (t - E.t0 < E.sched.push[i] + TM.PUSH - 80 || (p.uncalled && !withReturn)) return;
        p.winners.forEach((w, k) => { if (w === seat) v += p.shares?.[k] ?? 0; });
      });
      return v;
    };

    /** 演出里画面要变的时刻：到点重画一次（动画本身靠负延迟续播，不会跳） */
    function wake(E) {
      for (const id of fx.wakes) clearTimeout(id);
      fx.wakes = [];
      if (!E || E.static) return;
      const S = E.sched;
      const marks = [...S.reveal.map((x) => x + TM.CARD_GAP + TM.FLIP), S.liftAt, ...S.push, ...S.push.map((x) => x + TM.PUSH - 80), ...S.push.map((x) => x + TM.PUSH), S.cardAt - 40];
      if (E.final) marks.push(S.end);
      const base = E.t0 - now();
      for (const m of marks) if (base + m > 0) fx.wakes.push(setTimeout(redraw, base + m + 16));
    }

    const sameView = (a, b) => a.handNo === b.handNo && a.log.length === b.log.length && a.board.length === b.board.length
      && !!a.result === !!b.result && a.toAct === b.toAct && !!a.over === !!b.over;

    /** 记录变化、决定这一帧要起哪些动画 */
    function track(view, opts) {
      const p = fx.prev;
      const t = now();
      if (!view.over) sumTab = null;
      if (p && sameView(p, view)) { fx.prev = view; return; } // 同一个局面重画：动画照常续播
      const live = opts.animate !== false && p !== null;
      fx.prev = view;
      if (!live) {
        fx.collect = null; fx.deal = null; fx.allin = allinMoment(view) ? fx.allin : null;
        fx.end = view.result ? endFromResult(null, view, null) : null;
        wake(null);
        fx.board = { n: view.board.length, t0: null, from: view.board.length };
        fx.bets = {};
        // 打开页面时正好是一手的开头（还没人行动）：弹开局提示，和服务端的开局停顿对上
        fx.intro = opts.animate !== false && !view.over && !view.result && !view.log.some((e) => !e.blind) ? { t0: t, hand: view.handNo } : null;
        if (fx.intro) { fx.deal = t; clearTimeout(timer); timer = setTimeout(redraw, TM.DEAL + 30); }
        return;
      }
      const newHand = view.handNo !== p.handNo;
      if (newHand) {
        // 一手结束：先演上一手的结算，再发新一手（时长和服务端的停顿是同一份）
        const E = view.handNo === p.handNo + 1 ? endFromLast(p, view, t) : null;
        const dur = E ? E.dur : 0;
        fx.end = E;
        wake(E);
        fx.deal = t + dur;
        fx.intro = view.over ? null : { t0: t + dur, hand: view.handNo };
        fx.board = { n: view.board.length, t0: null, from: 0 };
        fx.collect = null;
        fx.bets = Object.fromEntries(view.players.filter((q) => q.bet > 0).map((q) => [q.seat, t + dur + 500]));
        clearTimeout(timer);
        if (dur) timer = setTimeout(() => { redraw(); clearTimeout(timer); timer = setTimeout(redraw, TM.DEAL + 30); }, dur + 30);
        else { timer = setTimeout(redraw, TM.DEAL + 30); }
      } else {
        // 同一手：新的公共牌、下注、收池
        if (view.board.length > p.board.length) fx.board = { n: view.board.length, t0: t + (p.street !== view.street && sumBets(p) > 0 ? 380 : 0), from: p.board.length };
        if (view.street !== p.street && sumBets(p) > 0 && !view.result) fx.collect = { t0: t, prev: p };
        for (const q of view.players) {
          const o = p.players.find((x) => x.seat === q.seat);
          if (q.bet > (o?.bet || 0)) fx.bets[q.seat] = t;
        }
        if (view.result && !p.result) {
          // 最后一手结束（整场结束，不再发新一手）：同样亮牌、翻完公共牌、分池、弹结算卡，卡一直留着
          fx.end = endFromResult(p, view, t);
          wake(fx.end);
        }
      }
      if (view.result && !fx.end?.final) { fx.end = endFromResult(null, view, null); wake(null); }
      // 桌心的「刚才那一手」、照向行动者的光：换了才演进场
      const la = lastAct(view);
      const ak = la ? `${view.handNo}|${view.log.length}` : '';
      if (ak !== fx.act.key) fx.act = { key: ak, t0: live ? t : null };
      const bk = view.toAct ? `${view.handNo}|${view.toAct}|${view.log.length}` : '';
      if (bk !== fx.beam.key) fx.beam = { key: bk, t0: live || !fx.prev ? t : null };
      const ai = allinMoment(view);
      if (ai && !fx.allin) fx.allin = t;
      if (!ai && !(fx.end && fx.end.allin)) fx.allin = null;
    }

    function seatEl(view, p, g, L, { E = null, t = 0, winners = new Set(), me = null, t0 = null, live = true }) {
      const S = L.seat;
      // 复盘、回放看的是过去的局面：不挂「思考中」、不打光
      const acting = live && !E && !view.result && view.toAct === p.seat;
      const win = winners.has(p.seat);
      const outNow = p.out && !p.inHand;
      const cls = `pk-seat${acting ? ' on' : ''}${win ? ' win' : ''}${p.folded && p.inHand && !outNow ? ' folded' : ''}${outNow ? ' out' : ''}${bbMode ? ' bbm' : ''}`;
      // 第二行：本轮动作 / 牌型 / 状态
      let status = p.last || (p.position && !view.over ? p.position : '');
      let sc = '';
      if (outNow) status = '出局';
      else if (E) {
        // 结算中：亮牌之后才显示牌型，抬牌之后赢家变金
        const ri = E.order.indexOf(p.seat);
        // 还要补翻公共牌时，牌型等翻完再说（不然先剧透了）
        const shownAt = ri < 0 ? null : E.streets.length ? E.sched.liftAt : E.sched.reveal[ri] + TM.CARD_GAP + TM.FLIP;
        if (win) { status = E.hands[p.seat] || '赢下底池'; sc = 'gold'; }
        else if (shownAt !== null && t - E.t0 >= shownAt - 20 && E.hands[p.seat]) status = E.hands[p.seat];
        else if (p.folded && p.inHand) status = '弃牌';
        else if (p.allin) { status = '全下'; sc = 'hot'; }
      }
      else if (p.handName) { status = p.handName; }
      else if (p.folded && p.inHand) status = '弃牌';
      else if (p.allin) { status = '全下'; sc = 'hot'; }
      // 轮到他：第二行换成「思考中…」（金）或「轮到你」（朱），名牌外圈呼吸发亮
      if (acting) { status = me === p.seat ? '轮到你' : '思考中'; sc = me === p.seat ? 'me' : 'turn'; }
      // 结算期间：筹码从结算前的数开始，池推到了才加上
      const stack = E && E.finalStack[p.seat] !== undefined ? E.finalStack[p.seat] - (E.payout[p.seat] || 0) + arrivedOf(E, p.seat, t) : p.stack;
      const node = el('div', { class: cls, style: `${pos(g.x, g.y)};width:${S.w}em;height:${S.h}em` },
        el('span', { class: 'coin' }, String(seatNo(p.seat))),
        el('div', { class: 'who' }, el('b', {}, p.name), el('span', { class: sc }, short(status, 8))),
        el('span', { class: 'stk' }, money(stack)),
        acting ? el('div', { class: 'think' }, el('i'), el('i'), el('i')) : null);
      const won = E ? arrivedOf(E, p.seat, t, false) : 0;
      if (won > 0) node.append(el('span', { class: 'won' }, `+${money(won)}`));
      if (acting && t0) node.append(thinkTimer(t0));
      return node;
    }

    /** 结算卡的数据：哪几手牌亮了、牌型、这一手各人输赢 */
    function summaryOf(E) {
      const nameOf = (s) => E.src.players.find((q) => q.seat === s)?.name || s;
      const seats = Object.keys(E.shown);
      const rows = (seats.length ? seats : [...E.winners]).map((s) => ({
        seat: s, name: nameOf(s), cards: E.shown[s] || null, hand: E.hands[s] || (E.winners.has(s) ? '赢下底池' : ''), net: E.net[s] ?? null, win: E.winners.has(s),
      }));
      // 输了筹码但没亮牌的人（弃牌）也列出来，按输赢排序
      for (const q of E.src.players) if (!rows.some((r) => r.seat === q.seat) && E.net[q.seat]) rows.push({ seat: q.seat, name: q.name, cards: null, hand: '弃牌', net: E.net[q.seat], win: false });
      return { no: E.no, board: E.board, best: E.best, rows: sortRows(rows), text: E.text, showdown: E.showdown, final: E.final };
    }
    const sortRows = (rows) => rows.sort((a, b) => (b.win - a.win) || ((b.net ?? 0) - (a.net ?? 0)));
    const signed = (v) => `${v > 0 ? '+' : ''}${money(v)}`;

    function summaryCard(S, L, tabs) {
      const card = el('div', { class: 'pk-pop pk-sum', style: `top:${L.table.cy}em` });
      if (tabs) card.append(tabs);
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
          el('span', { class: `nt ${r.net > 0 ? 'up' : r.net < 0 ? 'dn' : ''}` }, r.net === null || r.net === undefined ? '' : signed(r.net))));
      }
      card.append(rows, el('div', { class: 'ft' }, S.text));
      return card;
    }

    /** 累计盈亏小曲线：各人用同一个纵向比例，0 线虚线 */
    function spark(curve, lim) {
      const NS = 'http://www.w3.org/2000/svg';
      const pts = [0, ...curve];
      const W = 60, H = 20;
      const x = (k) => (pts.length > 1 ? (k / (pts.length - 1)) * W : W / 2);
      const y = (v) => H / 2 - (v / lim) * (H / 2 - 1.5);
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      const base = document.createElementNS(NS, 'line');
      for (const [k, v] of Object.entries({ x1: 0, x2: W, y1: H / 2, y2: H / 2 })) base.setAttribute(k, v);
      const pl = document.createElementNS(NS, 'polyline');
      pl.setAttribute('points', pts.map((v, k) => `${x(k).toFixed(2)},${y(v).toFixed(2)}`).join(' '));
      svg.append(base, pl);
      const end = pts[pts.length - 1];
      return el('span', { class: `spk${end > 0 ? ' up' : end < 0 ? ' dn' : ''}` }, svg);
    }

    /** 全场统计：净胜、走势、手数、入池率、翻前加注率、摊牌胜/次、赢过的最大底池 */
    function statsCard(view, L, tabs) {
      const st = view.stats;
      const card = el('div', { class: 'pk-pop pk-sum pk-stats', style: `top:${L.table.cy}em` });
      card.append(tabs, el('div', { class: 'hd' }, el('span', { class: 'ttl' }, '全场统计'), el('small', {}, `共 ${st.hands} 手`)));
      const rows = st.players.slice().sort((a, b) => b.net - a.net);
      const lim = Math.max(1, ...rows.flatMap((r) => r.curve.map((v) => Math.abs(v))));
      const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
      const tb = el('div', { class: 'tb', role: 'table' });
      tb.append(el('div', { class: 'th', role: 'row' }, ...['', '选手', '净胜', '走势', '手数', '入池', '加注', '摊牌胜', '最大底池'].map((h) => el('span', { role: 'columnheader' }, h))));
      rows.forEach((r, k) => {
        const name = view.players.find((q) => q.seat === r.seat)?.name || r.name;
        tb.append(el('div', { class: `tr${k === 0 && r.net > 0 ? ' lead' : ''}`, role: 'row' },
          el('span', { class: 'no' }, String(seatNo(r.seat))), el('span', { class: 'nm' }, name),
          el('span', { class: `nt ${r.net > 0 ? 'up' : r.net < 0 ? 'dn' : ''}` }, signed(r.net)),
          spark(r.curve, lim),
          el('span', {}, String(r.played)), el('span', { title: '入池率 VPIP：翻牌前主动跟注或加注的手数占比' }, pct(r.vpip, r.played)),
          el('span', { title: '翻牌前加注率 PFR' }, pct(r.pfr, r.played)),
          el('span', { title: '摊牌赢的次数 / 摊牌次数' }, r.sd ? `${r.sdWon}/${r.sd}` : '–'), el('span', {}, r.best ? money(r.best) : '–')));
      });
      card.append(tb);
      return card;
    }
    function tabsEl(cur) {
      const mk = (id, text) => el('button', { type: 'button', role: 'tab', 'aria-selected': cur === id ? 'true' : 'false', class: cur === id ? 'on' : '', onclick: (e) => { e.stopPropagation(); sumTab = id; redraw(); } }, text);
      return el('div', { class: 'tabs', role: 'tablist' }, mk('hand', '本手'), mk('stats', '全场统计'));
    }

    function draw(view, opts) {
      const { movable = null, actions = null, viewer = null } = opts;
      const L = LAYOUTS[layoutName];
      const T = L.table;
      const g = geometry(view, viewer, L);
      const t = now();
      let E = fx.end;
      // 在局的真人：一手结算演完、下一手开始后，结算卡留在桌上，等他自己点 ✕（或 Esc）关；观众照旧自动收起
      const seated = !!viewer && viewer !== '*' && view.players.some((q) => q.seat === viewer);
      if (E && !E.final && t - E.t0 >= E.dur) {
        if (seated) fx.keep = { key: `${E.no}|`, S: summaryOf(E) };
        fx.end = E = null;
      }
      if (E || !seated) fx.keep = E ? fx.keep : null;
      const at = (ms) => !!E && t - E.t0 >= ms;
      const bbv = view.blinds?.bb || 1;
      money = (v) => (bbMode ? fmtBB(v, bbv) : String(v));
      const src = E ? E.src : view; // 结算期间座位上的牌按结算前那一步画
      const markOf = (seat) => (seat === src.button ? ['d', 'D'] : seat === src.sbSeat ? ['sb', '小盲'] : seat === src.bbSeat ? ['bb', '大盲'] : null);
      const markSeats = src.over ? [] : src.players.filter((p) => !(p.out && !p.inHand) && markOf(p.seat)).map((p) => p.seat);
      const spots = chipSpots(src, viewer, g, L, markSeats);
      const kids = [];

      // 桌子：栏杆、桌布、水印只随横竖版变，按版式各建一次（每步重建整张桌子会重排、重绘大块渐变）
      const table = tables[layoutName] ||= [
        el('div', { class: 'pk-rail', style: `${pos(T.cx - T.rx - 1.6, T.cy - T.ry - 1.6)};width:${(T.rx + 1.6) * 2}em;height:${(T.ry + 1.6) * 2}em` }),
        el('div', { class: 'pk-felt', style: `${pos(T.cx - T.rx + 0.3, T.cy - T.ry + 0.3)};width:${(T.rx - 0.3) * 2}em;height:${(T.ry - 0.3) * 2}em` }),
        el('div', { class: 'pk-wm', style: pos(T.cx, T.cy + T.ry * 0.55) }, el('span', {}, '德州'))];
      const liveNow = isLive(opts);
      if (liveNow && !E && !view.result && view.toAct && g[view.toAct]) {
        // 光晕落在桌心到他座位连线的 2/3 处：桌布靠近他的那一块
        const s = g[view.toAct];
        const pool = el('div', { class: 'pk-pool', style: pos(T.cx + (s.x - T.cx) * 0.62, T.cy + (s.y - T.cy) * 0.62) });
        play(pool, 'pk-poolin', 420, fx.beam.t0, 0, 'ease-out');
        kids.push(pool);
      }

      // 全下：压暗
      const ai = E ? E.allin : allinMoment(view);
      if (ai) kids.push(play(el('div', { class: 'pk-dim' }), 'pk-in', 500, fx.allin));

      // 左上角牌匾；右上角筹码 / BB 切换
      const street = E ? (E.showdown ? '摊牌' : '结束') : view.streetName;
      kids.push(el('div', { class: 'pk-info', style: pos(...L.info) },
        el('div', { class: 'kv' }, el('small', {}, '第几手'), el('b', {}, `${E ? E.no : view.handNo}/${view.hands}`)),
        el('span', { class: 'st' }, street),
        el('div', { class: 'kv' }, el('small', {}, '盲注'), el('b', {}, `${view.blinds.sb}/${view.blinds.bb}`))));
      bbBtn.style.cssText = pos(L.w - L.info[0], L.info[1] + 0.35);
      bbBtn.classList.toggle('bb', bbMode);
      bbBtn.setAttribute('aria-pressed', bbMode ? 'true' : 'false');

      // 公共牌
      const B = L.board;
      const fs = B.cw / 5;
      const bw = B.cw * 5 + B.gap * 4;
      const bx0 = B.cx - bw / 2;
      const board = E ? E.board : view.board;
      const lifted = !!E && at(E.sched.liftAt);
      const best = lifted ? E.best : new Set();
      const winners = lifted ? E.winners : new Set();
      for (let k = 0; k < 5; k++) {
        const c = board[k];
        const x = bx0 + k * (B.cw + B.gap);
        if (!c) { kids.push(cardEl('slot', x, B.y, fs)); continue; }
        const cls = best.size ? (best.has(c) ? 'best' : 'dim') : '';
        let d = null, t0b = null;
        if (E) { d = flipAt(E, k); t0b = E.t0; }
        else if (fx.board.t0 !== null && k >= fx.board.from) { d = k < 3 ? (k - Math.min(fx.board.from, 3)) * 170 : (k - fx.board.from) * 170; t0b = fx.board.t0; }
        const nodes = d === null ? [cardEl(c, x, B.y, fs, cls)] : flipCard(c, x, B.y, fs, cls, t0b, d);
        // 大底池全下：转牌、河牌翻开前多停一秒，牌背轻轻鼓动
        if (E && E.big && d !== null && k >= 3 && nodes.length > 1) play(nodes[0], 'pk-sweat', TM.BIG_WAIT, E.t0, d - TM.BIG_WAIT, 'ease-in-out');
        if (best.size) play(nodes.at(-1), best.has(c) ? 'pk-lift' : 'pk-dimin', 520, E.t0, E.sched.liftAt);
        kids.push(...nodes);
      }

      // 底池：收进来的筹码（不含各人面前还没收的注）；结算时按池推走，剩多少画多少
      const P = L.pot;
      let potShown, potPile;
      if (E) {
        let gone = 0;
        E.pots.forEach((pp, i) => { if (at(E.sched.push[i])) gone += pp.amount; });
        potShown = potPile = Math.max(0, E.potTotal - gone);
      } else {
        potPile = view.pot - sumBets(view);
        potShown = view.pot;
      }
      if (!E || potShown > 0) {
        const potWrap = el('div', { class: 'pk-pot', style: pos(P.cx, P.y) });
        const pile = el('div', { class: 'pile' });
        if (potPile > 0) pile.append(chips(potPile, 3.5, 3.1, { maxCols: 4, maxPer: 8 }));
        potWrap.append(pile, el('div', { class: 'lab' }, el('small', {}, '底池'), el('b', {}, money(potShown))));
        // 注收进底池时鼓一下
        if (E) { if (E.collectFrom) play(potWrap, 'pk-bump', 400, E.t0, 400, 'ease-out'); }
        else if (fx.collect) play(potWrap, 'pk-bump', 400, fx.collect.t0, 480, 'ease-out');
        kids.push(potWrap);
      }
      if (!E && view.pots.length > 1) {
        kids.push(el('div', { class: 'pk-side', style: pos(P.cx, P.y + 4) }, ...view.pots.map((pp, k) => el('span', {}, `${k ? `边池 ${k}` : '主池'} ${money(pp.amount)}`))));
      }
      // 分池：主池、各边池依次推给各自的赢家，桌心挂一行「边池 1 → 3 号」
      if (E) {
        const contested = E.pots.filter((q) => !q.uncalled).length;
        E.pots.forEach((pp, i) => {
          const a = E.sched.push[i];
          if (!at(a) || at(a + TM.PUSH)) return;
          const sx = P.cx - 2.4, sy = P.y + 3.1;
          pp.winners.forEach((w, k) => {
            const s = g[w];
            const amt = pp.shares?.[k] ?? 0;
            if (!s || !amt) return;
            const st = chips(amt, sx, sy, { maxCols: 3, maxPer: 6 });
            st.style.setProperty('--tx', `${s.x - sx}em`);
            st.style.setProperty('--ty', `${s.y - sy}em`);
            kids.push(play(st, 'pk-collect', TM.PUSH - 60, E.t0, a, 'cubic-bezier(.5,0,.6,1)'));
          });
          const name = pp.uncalled ? '退回' : contested > 1 ? (i === 0 ? '主池' : `边池 ${i}`) : '底池';
          kids.push(play(el('div', { class: `pk-push${pp.uncalled ? ' ret' : ''}`, style: pos(P.cx, L.push) },
            el('span', {}, name), el('b', {}, money(pp.amount)), el('span', {}, `→ ${pp.winners.map((w) => seatNo(w)).join('、')} 号`)), 'pk-rise', 260, E.t0, a));
        });
      }

      // 一轮结束：上一轮的注收进底池
      const collect = (prev, t0, dur) => {
        for (const q of prev.players) {
          if (!q.bet || !g[q.seat]) continue;
          const b = spots.bet(q.seat, q.bet);
          const st = chips(q.bet, b.bx, b.by, { maxCols: 3, maxPer: 6 });
          st.style.setProperty('--tx', `${P.cx - b.bx}em`);
          st.style.setProperty('--ty', `${P.y + 2.5 - b.by}em`);
          kids.push(play(st, 'pk-collect', dur, t0, 0, 'cubic-bezier(.5,0,.7,1)'));
        }
      };
      if (!E && fx.collect && t - fx.collect.t0 < 520) collect(fx.collect.prev, fx.collect.t0, 520);
      if (E && E.collectFrom && t - E.t0 < 450) collect(E.collectFrom, E.t0, 450);

      // 各座位：标记（庄、小盲、大盲）、面前的注、底牌、名牌、胜率
      const players = src.players;
      for (const p of players) {
        const s = g[p.seat];
        if (!s) continue;
        const mk = markSeats.includes(p.seat) ? markOf(p.seat) : null;
        const m = mk ? spots.mark(p.seat) : null;
        if (m) kids.push(el('div', { class: `pk-mark ${mk[0]}`, style: pos(m.x, m.y) }, el('span', {}, mk[1])));
        if (!E && p.bet > 0) {
          const b = spots.bet(p.seat, p.bet);
          const st = chips(p.bet, b.bx, b.by, { maxCols: 3, maxPer: 6 });
          const right = b.side > 0;
          const off = 1.4 + (breakdown(p.bet, 3).length - 1) * 0.98;
          const amt = el('span', { class: `pk-amt${right ? '' : ' l'}`, style: pos(b.bx + (right ? off : -off), b.by - 0.9) }, el('span', {}, money(p.bet)));
          const t0 = fx.bets[p.seat];
          if (t0 !== undefined) {
            st.style.setProperty('--fx', `${s.x - b.bx}em`);
            st.style.setProperty('--fy', `${s.y - b.by}em`);
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
          // 摊牌：按亮牌顺序一家一家翻开（原来看不到的牌翻过来，看得到的牌跳一下）；抬牌后输家的牌变淡
          const shownNow = E ? E.shown[p.seat] || null : null;
          const cards = shownNow || p.cards || [null, null];
          const ri = E ? E.order.indexOf(p.seat) : -1;
          const rAt = ri >= 0 ? E.sched.reveal[ri] : null;
          const flipIn = rAt !== null && !!shownNow && E.faceDown.has(p.seat);
          const lose = !!E && lifted && E.losers.has(p.seat);
          const win = winners.has(p.seat);
          cards.forEach((c, k) => {
            const x = s.x - cw / 2 + (k ? 1 : -1) * (mine ? 2.2 : 1.25);
            const cls = `${p.folded ? 'fold' : ''}${best.size && c && best.has(c) && win ? ' best' : ''}${lose ? ' lose' : ''}`;
            const nodes = flipIn ? flipCard(c, x, cy, cfs, cls, E.t0, rAt + k * TM.CARD_GAP, TM.FLIP) : [cardEl(c, x, cy, cfs, cls)];
            for (const nd of nodes) { nd.style.rotate = `${k ? 7 : -7}deg`; nd.style.transformOrigin = '50% 100%'; }
            if (nodes.length > 1) { kids.push(nodes[0]); }
            const node = nodes.at(-1);
            if (rAt !== null && !flipIn) play(node, 'pk-show', 380, E.t0, rAt + k * TM.CARD_GAP, 'ease-out');
            if (lose) play(node, 'pk-lose', 450, E.t0, E.sched.liftAt, 'ease-out');
            if (!E && fx.deal !== null) {
              node.style.setProperty('--fx', `${(T.cx - x - cw / 2) / cfs}em`);
              node.style.setProperty('--fy', `${(T.cy - cy - ch / 2) / cfs}em`);
              const order = (seatNo(p.seat) - seatNo(view.button) + players.length) % players.length;
              play(node, 'pk-fly', 420, fx.deal, (k * players.length + order) * 90);
            }
            kids.push(node);
          });
        }
        kids.push(seatEl(view, p, s, L, { E, t, winners, me: movable && movable === viewer ? viewer : null, t0: opts.clock?.[p.seat] || null, live: liveNow }));
        // 胜率
        if (!E && p.equity !== null && p.equity !== undefined && p.inHand && !p.folded) {
          const live = liveOf(view);
          const top = Math.max(...live.map((q) => q.equity ?? 0));
          const pct = Math.round(p.equity * 100);
          kids.push(el('div', { class: `pk-eq${p.equity === top && live.length > 1 ? ' lead' : ''}`, style: pos(s.x, s.y + S.h / 2 + 0.15) },
            el('span', { class: 'bar' }, el('i', { style: `width:${pct}%` })), el('b', {}, `${pct}%`)));
        }
      }

      // 桌心：刚才那一手（谁、做了什么）。全下胜率对比、结算时让位
      const la = !E && !view.result ? lastAct(view) : null;
      if (la && !(ai && liveOf(view).filter((q) => q.equity !== null && q.equity !== undefined).length >= 2)) {
        const who = view.players.find((q) => q.seat === la.seat);
        const box2 = el('div', { class: `pk-act ${actKind(la.text)}`, style: pos(L.act.cx, L.act.y) },
          el('span', { class: 'no' }, String(seatNo(la.seat))), el('span', { class: 'nm' }, short(who?.name || '', 6)), el('span', { class: 'tx' }, la.text));
        play(box2, 'pk-actin', 460, fx.act.t0, 0, 'cubic-bezier(.2,1.3,.4,1)');
        kids.push(box2);
      }
      // 摊牌：牌型徽章（赢下主池的牌型）在公共牌下方弹出
      if (E && E.badge && lifted) {
        const who = `${E.badge.who.map((w) => seatNo(w)).join('、')} 号${E.badge.who.length > 1 ? ' 平分' : ''}`;
        kids.push(play(el('div', { class: 'pk-badge', style: pos(L.act.cx, L.badge) }, el('small', {}, who), el('b', {}, E.badge.hand)), 'pk-badge', 280, E.t0, E.sched.liftAt, 'ease-out'));
      }

      // 一手结果：结算卡（分完池之后弹出；摊牌时列出亮出的底牌和牌型）；终局那一手可以切到全场统计
      const sumOn = !!E && at(E.sched.cardAt - 40);
      const sumKey = E ? `${E.no}|${E.final ? 'f' : ''}` : '';
      if (sumOn && sumHidden === sumKey) {
        // 收起了：桌角留一枚小签，点开再看
        kids.push(el('button', { class: 'pk-pill', type: 'button', title: '展开结算', style: pos(L.pill[0], L.pill[1]), onclick: (e) => { e.stopPropagation(); sumHidden = null; redraw(); } },
          el('span', {}, E.final ? '结算 ▸' : `第 ${E.no} 手结算 ▸`)));
      } else if (sumOn) {
        const veil = el('div', { class: 'pk-veil' });
        const hasStats = E.final && view.over && !!view.stats;
        const autoStats = E.static || at(E.sched.end);
        const tab = hasStats ? sumTab || (autoStats ? 'stats' : 'hand') : 'hand';
        const tabs = hasStats ? tabsEl(tab) : null;
        const card = tab === 'stats' ? statsCard(view, L, tabs) : summaryCard(summaryOf(E), L, tabs);
        card.append(el('button', { class: 'pk-x', type: 'button', title: '收起（Esc）', 'aria-label': '收起结算卡', onclick: (e) => { e.stopPropagation(); sumHidden = sumKey; redraw(); } }, '✕'));
        play(veil, 'pk-veil', 380, E.t0, E.sched.cardAt);
        play(card, 'pk-popin', 520, E.t0, E.sched.cardAt, 'cubic-bezier(.2,1.2,.4,1)');
        if (tab === 'stats' && !sumTab) play(card, 'pk-in', 360, E.t0, E.sched.end);
        // 观众：一手结束前卡片淡出；在局的真人：只撤掉压暗，卡片留着
        if (!E.final) { play(veil, 'pk-popout', 320, E.t0, E.dur - 320, 'ease-in'); if (!seated) play(card, 'pk-popout', 320, E.t0, E.dur - 320, 'ease-in'); }
        kids.push(veil, card);
      }
      // 上一手的结算卡（下一手已经开始，在局的真人才有）：挪到牌桌右侧那一栏（opts.dock，聚光框和本手记录之间），
      // 不挡公共牌、底牌和出手区；点 ✕（或 Esc）关掉，桌角留一枚小签，点了再放回右栏
      const keepKey = !E && fx.keep && sumHidden !== fx.keep.key ? fx.keep.key : null;
      if (!E && fx.keep && sumHidden === fx.keep.key) {
        kids.push(el('button', { class: 'pk-pill', type: 'button', title: '展开上一手结算', style: pos(L.pill[0], L.pill[1]), onclick: (e) => { e.stopPropagation(); sumHidden = null; redraw(); } },
          el('span', {}, `第 ${fx.keep.S.no} 手结算 ▸`)));
      }
      const dock = opts.dock;
      if (dock && dock.dataset.key !== (keepKey || '')) {
        dock.dataset.key = keepKey || '';
        if (!keepKey) dock.replaceChildren();
        else {
          const card = summaryCard(fx.keep.S, L, null);
          card.classList.add('kept');
          card.removeAttribute('style');
          card.append(el('button', { class: 'pk-x', type: 'button', title: '关闭（Esc）', 'aria-label': '关闭上一手结算卡', onclick: (e) => { e.stopPropagation(); sumHidden = keepKey; redraw(); } }, '✕'));
          dock.replaceChildren(card);
        }
      }
      // 新一手：开局提示（第几手、盲注、庄位），停留时间和服务端的开局停顿一样
      if (!E && fx.intro && fx.intro.hand === view.handNo && t >= fx.intro.t0 - 40 && t - fx.intro.t0 < TM.DEAL) {
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

      // 全下：横幅、胜率对比（抬牌、分池时让位给牌型徽章）
      if (ai) {
        const av = E ? E.src : view;
        const live = liveOf(av).filter((q) => q.equity !== null && q.equity !== undefined);
        if (fx.allin !== null && t - fx.allin < 1900) {
          kids.push(play(el('div', { class: 'pk-allin', style: `top:${B.y + B.cw * 0.7}em` }, el('span', {}, 'ALL IN', el('small', {}, '全下'))), 'pk-banner', 1800, fx.allin, 0, 'ease-out'));
        }
        if (live.length >= 2 && !sumOn && !lifted) {
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

      setLayer(layer, table, kids);
      if (layer.querySelector('.tmr')) startTimerTick(root);
      renderControls(view, movable, actions, L);
      renderPre(view, opts, L, !!E);
      // 还没轮到你时记下你要跟多少：轮到你时比一比，变了就锁一下跟注键
      const meNow = viewer ? view.players.find((q) => q.seat === viewer) : null;
      if (!meNow || !meNow.inHand || view.result) lastOwe = null;
      else if (view.toAct !== viewer) lastOwe = { hand: view.handNo, v: Math.min(Math.max(0, (view.currentBet || 0) - (meNow.bet || 0)), meNow.stack) };
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
