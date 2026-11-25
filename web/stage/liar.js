// 吹牛左轮画面：俯视一张深红漆面圆桌（金边、嵌金线），座位均匀环绕（2–4 人，玩家本人在正下方）。
// 桌心左边一块牌匾翻着本轮桌牌（Q/K/A），右边是越叠越高的暗牌堆，堆下挂着上一手的声称（几张、称是什么；上帝视角另标出真实牌面）。
// 每块名牌右侧嵌一只左轮弹巢（6 格）：扣过的格子是空膛，下一枪那一格转到正上方；中弹的那格是红的。
// 上帝视角每家手牌明着摆在名牌旁；玩家视角只看得到自己的牌，别家是牌背。
// 质疑时的揭晓（时刻表见 games/liar/index.js 的 T / revealPlan，服务端按同一份时长停顿）：
// 「质疑！」横幅 → 上一手的牌一张张翻开（假牌描红）→ 判定印章（说谎！/ 是真的）→ 桌面压暗、输家的弹巢放大转动、屏息 → 扣扳机（咔哒 / 砰！震屏）
// → 新一轮翻开桌牌。子弹结果在扣扳机那一刻之前画面上看不出来（名牌上的弹巢也是那一刻才更新）。
// 玩家本人行动时：手牌放大，点选 1–3 张（再点取消），「出牌」当作桌牌打出；能质疑时「质疑」。
//
// 画面用 HTML 画：根节点是尺寸容器，桌面固定比例（横版 80×50em，竖版 50×70em），里面一律用 em 定位，等比缩放。
// 动画按「开始时刻」续播：重画时用负的 animation-delay 接上，对局推进不会打断正在进行的动画。

import { T as TM, revealPlan, pauseBetween } from '/games/liar/index.js';
import { sfx } from '/js/sound.js';

const EASE = 'cubic-bezier(.2,.75,.1,1)';
const JOKER = '鬼';
const CH = 6;

// ---------- 版式（单位 em） ----------
const LAYOUTS = {
  land: {
    w: 80, h: 50,
    table: { cx: 40, cy: 23, rx: 31, ry: 16.6 },
    ring: { rx: 34.5, ry: 20.6 }, clampX: [10.2, 69.8], clampY: [5.2, 44.6],
    plate: { w: 19, h: 5 },
    plaque: [32, 21.6], pile: [44.5, 23.6], claim: [44.5, 28.4], pcount: [50.9, 22.8], show: [45, 18.4], drum: [40, 21.6], stamp: [45, 28.8],
    hand: { cw: 2.4 }, mine: { cx: 40, y: 34.8, cw: 4.4 }, ctl: { cx: 40, y: 30.1 }, last: [1.2, 1.2], pill: [1.2, 45.6],
  },
  port: {
    w: 50, h: 70,
    table: { cx: 25, cy: 31, rx: 21.5, ry: 25 },
    ring: { rx: 21.5, ry: 27.6 }, clampX: [9.6, 40.4], clampY: [5, 59],
    plate: { w: 18.4, h: 5 },
    plaque: [25, 19.6], pile: [25, 31.4], claim: [25, 37.4], pcount: [25, 34.1], show: [25, 28.4], drum: [25, 29], stamp: [25, 38],
    hand: { cw: 2.3 }, mine: { cx: 25, y: 47, cw: 4.4 }, ctl: { cx: 25, y: 41 }, last: [1, 64.4], pill: [1, 64.4],
  },
};

// ---------- 样式 ----------
const CSS = `
.lr { position: relative; width: 100%; height: 100%; container-type: size; user-select: none; -webkit-user-select: none; font-family: var(--sans); }
.lr-box { position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: min(100cqw, 160cqh); height: min(62.5cqw, 100cqh); font-size: min(1.25cqw, 2cqh); }
.lr.port .lr-box { width: min(100cqw, 71.43cqh); height: min(140cqw, 100cqh); font-size: min(2cqw, 1.4286cqh); }
.lr-box > *, .lr-layer > * { position: absolute; }
.lr-layer { inset: 0; }

/* 桌子：漆木桌沿（外描金），深红漆面下沉，嵌一圈金线 */
.lr-rail { border-radius: 50%; border: .22em solid transparent;
  background: radial-gradient(60% 50% at 26% 8%, rgb(255 214 170 / .22), transparent 60%) padding-box,
    linear-gradient(180deg, #4a120a 0%, #2a0805 50%, #160403 100%) padding-box, var(--edge) border-box;
  box-shadow: inset 0 .16em 0 rgb(255 226 184 / .3), inset 0 -.25em .4em rgb(0 0 0 / .55),
    0 .35em 0 #3b1607, 0 .7em 0 #1a0703, 0 .78em 0 .06em #050100, 0 1.4em 1.6em rgb(0 0 0 / .55); }
:root[data-theme="light"] .lr-rail { box-shadow: inset 0 .16em 0 rgb(255 226 184 / .3), inset 0 -.25em .4em rgb(0 0 0 / .55),
  0 .35em 0 #6a4a16, 0 .7em 0 #3e2a0a, 0 .78em 0 .06em rgb(70 44 8 / .7), 0 1.4em 1.6em rgb(80 48 10 / .42); }
.lr-felt { border-radius: 50%; overflow: hidden;
  background: var(--grain),
    radial-gradient(46% 40% at 32% 22%, rgb(255 190 160 / .16), transparent 70%),
    radial-gradient(70% 70% at 50% 46%, transparent 38%, rgb(30 0 0 / .6) 100%),
    repeating-linear-gradient(90deg, rgb(0 0 0 / .05) 0 .07em, transparent .07em .26em),
    linear-gradient(180deg, #8e1d14 0%, #6c140d 55%, #470b07 100%);
  box-shadow: inset 0 .7em 1.2em rgb(0 0 0 / .6), inset 0 0 0 .08em rgb(0 0 0 / .65), 0 0 0 .12em rgb(226 186 96 / .6), 0 0 0 .3em rgb(20 4 2 / .5); }
.lr-felt::after { content: ''; position: absolute; inset: 1.5em; border-radius: 50%; border: .08em solid rgb(240 205 120 / .32); box-shadow: inset 0 .06em 0 rgb(0 0 0 / .35); }
.lr-wm { font: 400 1em/1 var(--brush); color: rgb(255 220 160 / .07); translate: -50% -50%; pointer-events: none; letter-spacing: .1em; white-space: nowrap; }
.lr-wm > span { font-size: 7em; }

/* 牌：白卡纸、圆角；font-size 决定大小（牌宽 5em、高 7em） */
.lr-c { position: absolute; width: 5em; height: 7em; border-radius: .5em; color: #1c1310;
  background: radial-gradient(120% 70% at 20% 0%, #fff, rgb(255 255 255 / 0) 60%), linear-gradient(172deg, #fffcf3 0%, #f6eedb 72%, #ecdfc1 100%);
  box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 .07em 0 #fff, 0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .16em 0 rgb(60 36 8 / .55), 0 .38em .5em -.05em rgb(0 0 0 / .5); }
.lr-c.r { color: #c42d1e; }
.lr-c .ix { position: absolute; left: .4em; top: .3em; font: 700 1.5em/1 var(--num); letter-spacing: -.04em; }
.lr-c .ix.br { left: auto; top: auto; right: .4em; bottom: .3em; rotate: 180deg; }
.lr-c .mid { position: absolute; inset: 1.1em .8em; border-radius: .3em; display: grid; justify-items: center; align-content: center; gap: .1em;
  background: radial-gradient(90% 60% at 50% 42%, rgb(255 255 255 / .85), transparent 70%), linear-gradient(180deg, rgb(232 196 112 / .3), rgb(201 162 74 / .12));
  box-shadow: inset 0 0 0 .05em currentColor, inset 0 0 0 .13em #fffaf0, inset 0 0 0 .18em rgb(186 142 52 / .85); }
.lr-c .mid svg { width: 2.2em; height: 1.1em; overflow: visible; }
.lr-c .mid b { font: 900 2.4em/1 var(--serif); }
.lr-c.jk .mid { background: radial-gradient(90% 70% at 50% 40%, #fff6d6, #f0cd78 70%, #c8983c); }
.lr-c.jk .mid b { font: 400 2.9em/1 var(--brush); color: #a3261a; }
.lr-c.jk .mid small { font: 700 .72em/1 var(--sans); letter-spacing: .2em; color: #7a1a10; }
.lr-c.bk { background:
    radial-gradient(circle at 50% 50%, #fbe8a6 0 .38em, #b8862e .42em .5em, transparent .54em),
    repeating-linear-gradient(45deg, rgb(240 205 120 / .3) 0 .06em, transparent .06em .62em),
    repeating-linear-gradient(-45deg, rgb(240 205 120 / .3) 0 .06em, transparent .06em .62em),
    linear-gradient(165deg, #2a2420 0%, #17110e 60%, #0c0807 100%);
  box-shadow: inset 0 0 0 .24em #f3e6c4, inset 0 0 0 .31em #d4ab52, inset 0 0 0 .36em #17110e, 0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .16em 0 rgb(60 36 8 / .55), 0 .3em .4em -.05em rgb(0 0 0 / .55); }
.lr-c.pick { cursor: pointer; transition: translate .14s ease-out, box-shadow .14s; }
.lr-c.pick:hover { translate: 0 -.25em; }
.lr-c.sel { translate: 0 -1.1em; box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 0 0 .18em #e6bd5c, 0 .12em 0 #c6b388, 0 .9em 1em -.1em rgb(0 0 0 / .5), 0 0 1.2em .2em rgb(255 214 120 / .7); }
.lr-c.sel:hover { translate: 0 -1.1em; }
.lr-c.lie { box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 0 0 .22em #e2523d, 0 .16em 0 rgb(60 36 8 / .55), 0 0 1.4em .3em rgb(255 80 50 / .7); }
.lr-c.ok { box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 0 0 .2em #e6bd5c, 0 .16em 0 rgb(60 36 8 / .55), 0 0 1.2em .2em rgb(255 214 120 / .6); }
.lr-c.dim { filter: brightness(.55) saturate(.5); }

/* 牌匾（桌牌）、牌堆数、声称 */
.lr-plaque { translate: -50% -50%; display: grid; justify-items: center; gap: .35em; padding: .55em .8em .6em; border-radius: .9em; border: .14em solid transparent; color: var(--text);
  background: var(--glint), var(--surface), var(--edge) border-box; box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .5em .7em rgb(0 0 0 / .5); }
.lr-plaque small { font: 700 .9em/1 var(--sans); color: var(--gold); letter-spacing: .3em; padding-left: .3em; }
.lr-plaque .slot { position: relative; width: 4.4em; height: 6.16em; }
.lr-plaque .rd { font: 400 1.5em/1 var(--brush); background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lr-pcount { translate: -50% 0; font: 600 1em/1 var(--num); color: #f6e2b6; padding: .3em .7em; border-radius: .9em; white-space: nowrap; background: rgb(20 4 2 / .6); box-shadow: inset 0 .08em .2em rgb(0 0 0 / .6), 0 .06em 0 rgb(255 224 176 / .14); }
.lr-claim { translate: -50% -50%; display: flex; align-items: center; gap: .6em; padding: .4em 1.1em .4em .45em; border-radius: 2em; white-space: nowrap; pointer-events: none;
  background: rgb(14 3 2 / .72); box-shadow: inset 0 .08em .25em rgb(0 0 0 / .7), 0 0 0 .08em rgb(240 205 120 / .4), 0 .5em 1.2em rgb(0 0 0 / .45); }
.lr-claim .no { width: 2em; height: 2em; border-radius: 50%; display: grid; place-items: center; font: 700 1.05em/1 var(--num); color: #2a1206;
  background: radial-gradient(circle at 36% 28%, #fff6d6, #f0cd78 50%, #a67a2a); box-shadow: inset 0 0 0 .1em rgb(255 246 214 / .6), 0 .1em 0 #6a4a14; }
.lr-claim .tx { font: 700 1.2em/1 var(--sans); color: #f2e3c2; }
.lr-claim .tx b { font: 400 1.6em/1 var(--brush); background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 .08em; }
.lr-claim .real { font: 600 .95em/1 var(--num); color: #c9b48a; padding-left: .6em; border-left: .06em solid rgb(240 205 120 / .3); }
.lr-claim .real i { font-style: normal; color: #ff8a6a; }

/* 名牌：漆板；左边铜钱号码，中间名字和状态，右边嵌一只左轮弹巢 */
.lr-seat { translate: -50% -50%; display: flex; align-items: center; gap: .6em; padding: 0 .55em 0 .55em; border-radius: .95em; border: .14em solid transparent; color: var(--text); box-sizing: border-box;
  --edge-now: var(--edge); background: var(--glint), var(--surface), var(--edge-now) border-box;
  box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .55em .8em rgb(0 0 0 / .55); transition: filter .3s; }
:root[data-theme="light"] .lr-seat, :root[data-theme="light"] .lr-plaque, :root[data-theme="light"] .lr-ctl, :root[data-theme="light"] .lr-last { box-shadow: var(--hi), 0 .18em 0 #8e6824, 0 .26em 0 .04em rgb(70 44 8 / .7), 0 .5em .7em rgb(40 14 4 / .4); }
.lr-seat .coin { font-size: 1.35em; width: 2.1em; height: 2.1em; flex: none; font-family: var(--num); font-weight: 600; margin-bottom: .16em; }
.lr-seat .who { display: grid; gap: .28em; min-width: 0; flex: 1 1 auto; }
.lr-seat .who b { font: 900 1.25em/1.1 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lr-seat .who span { font: 600 .95em/1.1 var(--sans); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lr-seat .who span.hot { color: var(--zhu-2); }
.lr-seat .gun { flex: none; display: grid; justify-items: center; gap: .1em; }
.lr-seat .gun svg { width: 3.3em; height: 3.3em; display: block; }
.lr-seat .gun small { font: 700 .78em/1 var(--num); color: var(--gold-2); letter-spacing: .04em; }
.lr-seat.on { --edge-now: var(--edge-hi); z-index: 2; }
.lr-seat.on::after { content: ''; position: absolute; inset: -.12em; z-index: -1; border-radius: inherit; pointer-events: none;
  box-shadow: 0 0 0 .09em #140703, 0 0 0 .22em #e8c46a, 0 .5em 1.5em -.25em rgb(255 205 120 / .4); animation: lr-in .3s ease-out both; }
.lr-seat.loser { box-shadow: var(--hi), 0 0 0 .1em #040100, 0 0 0 .3em #e2523d, 0 0 2em .4em rgb(255 90 60 / .5); z-index: 3; }
.lr-seat.out { filter: grayscale(1) brightness(.55); }
.lr-seat.win { --edge-now: var(--edge-hi); box-shadow: var(--hi), 0 0 0 .1em #040100, 0 0 0 .36em rgb(42 11 8 / .9), 0 0 0 .46em #f0cd78, 0 0 2.6em .6em rgb(255 214 120 / .55); }
.lr-seat .seal { position: absolute; right: 4.2em; top: 50%; translate: 0 -50%; rotate: -12deg; font: 400 1.6em/1 var(--brush); color: #e2523d; padding: .1em .3em; border: .1em solid #e2523d; border-radius: .2em; opacity: .9; }
.lr-seat .tag { position: absolute; left: 50%; bottom: calc(100% + .45em); translate: -50% 0; display: flex; align-items: center; gap: .4em; white-space: nowrap; padding: .32em .8em .36em; border-radius: 1em;
  font: 700 1.05em/1 var(--sans); letter-spacing: .1em; color: var(--on-gold); background: var(--gold-metal); box-shadow: var(--gold-key-sh), 0 .3em .6em rgb(0 0 0 / .45); z-index: 3; }
.lr-seat .tag::after { content: ''; position: absolute; left: 50%; top: 100%; translate: -50% 0; border: .4em solid transparent; border-top-color: #c8983c; }
.lr-seat .tag.me { color: #fff4e0; background: linear-gradient(180deg, #e2523d, #8e1b12); box-shadow: inset 0 .06em 0 rgb(255 220 200 / .5), 0 0 1.2em rgb(255 120 80 / .55); }
.lr-seat .tag.me::after { border-top-color: #8e1b12; }
.lr-seat .tag.dn { bottom: auto; top: calc(100% + .45em); }
.lr-seat .tag.dn::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: #c8983c; }
.lr-seat .tag.me.dn::after { border-bottom-color: #8e1b12; }
.lr-seat .tag i { width: .36em; height: .36em; border-radius: 50%; background: currentColor; animation: lr-dot 1.2s ease-in-out infinite; }
.lr-seat .tag i:nth-child(2) { animation-delay: .2s; } .lr-seat .tag i:nth-child(3) { animation-delay: .4s; }
.lr-seat .tmr { position: absolute; right: -.5em; top: -.85em; font: 700 1em/1 var(--num); padding: .25em .5em .28em; border-radius: .8em; color: #2a1206; z-index: 3;
  background: linear-gradient(180deg, #fff3c8, #f0cd78); box-shadow: 0 .1em 0 #8e6824, 0 .2em .4em rgb(0 0 0 / .4); font-variant-numeric: tabular-nums; }
.lr-seat .tmr.dn { top: auto; bottom: -.85em; }
.lr-seat .tmr.warm { background: linear-gradient(180deg, #ffd9a0, #f09a3c); }
.lr-seat .tmr.hot { color: #fff4e0; background: linear-gradient(180deg, #ff8a6a, #c42d1e); }

/* 弹巢（SVG）：枪身发黑的钢、下一枪那格转到正上方；黄铜底火是还没扣过的格子，空膛是扣过的，红的是中弹那格 */
.lr-gunsvg .body { fill: url(#lr-steel); stroke: #e0b454; stroke-width: .7; }
.lr-gunsvg .live { fill: url(#lr-brass); stroke: #3a2408; stroke-width: .5; }
.lr-gunsvg .spent { fill: #0b0605; stroke: #6a5a44; stroke-width: .5; }
.lr-gunsvg .shot { fill: #e2523d; stroke: #ffd0b8; stroke-width: .6; }
.lr-gunsvg .axle { fill: #2a221c; stroke: #c9a24a; stroke-width: .5; }
.lr-gunsvg .pin { fill: #f0cd78; }

/* 揭晓：横幅、翻开的牌、印章、压暗、大弹巢、结果 */
.lr-veil { inset: 0; pointer-events: none; border-radius: 1.2em; background: radial-gradient(62% 60% at 50% 46%, rgb(4 2 1 / .42), rgb(4 2 1 / .78)); }
.lr-banner { translate: -50% -50%; white-space: nowrap; pointer-events: none; border: .2em solid transparent; border-radius: .7em; color: #fff2d6;
  background: linear-gradient(180deg, rgb(255 255 255 / .28), transparent 46%) padding-box, linear-gradient(180deg, #e2523d, #8e1b12) padding-box, var(--gold-rim) border-box;
  box-shadow: inset 0 0 0 .1em rgb(112 14 6 / .8), 0 .3em 0 #4e0c06, 0 .4em 0 #000, 0 1em 2em rgb(0 0 0 / .6), 0 0 5em rgb(255 120 60 / .45); text-shadow: 0 -.1em 0 rgb(96 12 6 / .8); }
.lr-banner > span { display: block; font: 400 4.2em/1 var(--brush); padding: .2em .9em .25em; }
.lr-banner small { display: block; text-align: center; font: 700 1.05em/1 var(--sans); letter-spacing: .2em; padding: 0 1em .7em; color: #ffe2a8; }
.lr-stamp { translate: -50% -50%; white-space: nowrap; pointer-events: none; text-align: center; }
.lr-stamp b { display: block; font: 400 4em/1 var(--brush); padding: .1em .4em; border: .08em solid currentColor; border-radius: .2em; rotate: -6deg; }
.lr-stamp.lie b { color: #ff6a4a; text-shadow: 0 0 .4em rgb(255 60 30 / .6); }
.lr-stamp.ok b { color: #f6dc94; text-shadow: 0 0 .4em rgb(255 214 120 / .5); }
.lr-stamp small { display: block; margin-top: .7em; font: 700 1.15em/1.2 var(--sans); color: #f2e3c2; letter-spacing: .08em; }
.lr-drum { translate: -50% -50%; display: grid; justify-items: center; gap: .6em; pointer-events: none; }
.lr-drum .wheel { width: 13em; height: 13em; filter: drop-shadow(0 .5em 1em rgb(0 0 0 / .6)); }
.lr-drum .wheel { position: relative; }
.lr-drum .wheel .spin, .lr-drum .wheel .pin { position: absolute; inset: 0; }
.lr-drum .wheel svg { width: 100%; height: 100%; display: block; }
.lr-drum .cap { font: 700 1.25em/1.3 var(--sans); color: #f2e3c2; white-space: nowrap; letter-spacing: .06em; text-align: center; }
.lr-drum .cap b { font: 600 1.3em/1 var(--num); color: #ff8a6a; }
.lr-bang { translate: -50% -50%; pointer-events: none; white-space: nowrap; text-align: center; }
.lr-bang b { display: block; font: 400 7em/1 var(--brush); }
.lr-bang.dead b { color: #ff5a3a; text-shadow: 0 0 .25em rgb(255 60 20 / .8), 0 .05em 0 #4e0c06; }
.lr-bang.click b { font-size: 4.6em; color: #f6dc94; text-shadow: 0 .05em 0 #3e2a0a, 0 0 .4em rgb(255 214 120 / .4); }
.lr-bang small { display: block; margin-top: .3em; font: 700 1.3em/1.2 var(--sans); color: #fff2d6; letter-spacing: .1em; }
.lr-flash { inset: 0; pointer-events: none; border-radius: 1.2em; background: radial-gradient(60% 60% at 50% 45%, rgb(255 240 200 / .9), rgb(255 60 30 / .6) 50%, rgb(120 0 0 / .4)); }

/* 弹出的纸牌匾：新一轮翻桌牌、终局 */
.lr-pop { left: 50%; translate: -50% -50%; border: .16em solid transparent; border-radius: 1.3em; color: #2a1209; text-align: center;
  background: var(--paper-face) padding-box, var(--gold-rim, linear-gradient(180deg, #f6dc94, #a67a2a)) border-box;
  box-shadow: inset 0 .06em 0 rgb(255 255 255 / .85), 0 .2em 0 #8e6824, 0 .32em 0 .04em #2a1a06, 0 1.4em 2.4em rgb(0 0 0 / .6); }
.lr-pop .ttl { font: 400 3.4em/1 var(--brush); color: #8e1b12; }
.lr-pop .sub { margin-top: .5em; font: 600 1.15em/1.35 var(--sans); color: #5a3a1a; white-space: nowrap; }
.lr-intro { padding: 1.1em 2.6em 1.2em; pointer-events: none; display: grid; justify-items: center; }
.lr-intro .slot { position: relative; width: 5em; height: 7em; margin-top: .7em; }
.lr-sum { width: 34em; padding: 1.1em 1.4em 1.2em; display: grid; gap: .7em; }
.lr-sum .rows { display: grid; gap: .3em; }
.lr-sum .rw { display: grid; grid-template-columns: 2.4em minmax(0, 1fr) auto; align-items: center; gap: .7em; padding: .35em .7em; border-radius: .6em; text-align: left; background: rgb(120 84 30 / .08); }
.lr-sum .rw.win { background: linear-gradient(90deg, rgb(240 190 80 / .42), rgb(240 190 80 / .12)); box-shadow: inset 0 0 0 .08em rgb(166 122 42 / .6); }
.lr-sum .rw .rk { font: 400 1.6em/1 var(--brush); color: #8e1b12; text-align: center; }
.lr-sum .rw .nm { font: 900 1.2em/1.2 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lr-sum .rw .st { font: 700 1em/1.2 var(--sans); color: #5a3a1a; white-space: nowrap; }
.lr-x { position: absolute; right: .5em; top: .5em; width: 2.1em; height: 2.1em; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer; z-index: 2;
  font: 700 1.05em/1 var(--sans); color: #6a4a2a; background: rgb(120 84 30 / .12); box-shadow: inset 0 0 0 .07em rgb(120 84 30 / .3); }
.lr-x:hover, .lr-x:focus-visible { color: #8e1b12; background: rgb(120 84 30 / .22); }
.lr-pill { display: flex; align-items: center; gap: .45em; padding: .5em .95em .55em; border-radius: 1.2em; border: .12em solid transparent; cursor: pointer; z-index: 6; white-space: nowrap;
  font: 700 1.05em/1 var(--sans); letter-spacing: .1em; color: var(--on-gold); background: var(--gold-metal) padding-box, linear-gradient(180deg, #fbe8a6, #8e6824) border-box; box-shadow: var(--gold-key-sh), 0 .3em .6em rgb(0 0 0 / .45); }

/* 上一次质疑：左上角一块小牌匾 */
.lr-last { display: grid; gap: .3em; padding: .5em .8em .55em; border-radius: .8em; border: .12em solid transparent; color: var(--text); max-width: 21em;
  background: var(--glint), var(--surface), var(--edge) border-box; box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .45em .6em rgb(0 0 0 / .45); }
.lr-last small { font: 700 .82em/1 var(--sans); color: var(--gold); letter-spacing: .2em; }
.lr-last span { font: 600 .95em/1.3 var(--sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lr-last span i { font-style: normal; color: var(--zhu-2); }

/* 操作台 */
.lr-ctl { translate: -50% 0; display: flex; gap: .7em; padding: .45em .6em; border-radius: 1em; border: .14em solid transparent;
  background: var(--glint), var(--surface), var(--edge-hi) border-box; box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .6em 1em rgb(0 0 0 / .6); z-index: 4; animation: lr-in .25s ease-out both; }
.lr-ctl .btn { font-size: 1.2em; padding: .25em 1.1em; min-width: 6.5em; --d: .2em; }
.lr-ctl .btn.call { color: #fff4e0; background: linear-gradient(180deg, #e2523d, #8e1b12) padding-box, var(--gold-rim) border-box; }
.lr.port .lr-ctl .btn { font-size: 1.45em; }

@keyframes lr-in { from { opacity: 0; } }
@keyframes lr-out { to { opacity: 0; } }
@keyframes lr-dot { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-.15em); } }
@keyframes lr-slide { from { transform: translate(var(--fx), var(--fy)) rotate(-20deg); opacity: .2; } }
@keyframes lr-flipA { 0% { transform: perspective(20em) rotateY(0); opacity: 1; } 49.9% { transform: perspective(20em) rotateY(90deg); opacity: 1; } 50%, 100% { transform: perspective(20em) rotateY(90deg); opacity: 0; } }
@keyframes lr-flipB { 0%, 50% { transform: perspective(20em) rotateY(-90deg); opacity: 0; } 50.1% { opacity: 1; } 100% { transform: none; opacity: 1; } }
@keyframes lr-lift { from { transform: translate(var(--fx), var(--fy)) scale(.6); } }
@keyframes lr-banner { 0% { transform: scale(1.8); opacity: 0; } 18% { transform: scale(.96); opacity: 1; } 26% { transform: none; } }
@keyframes lr-stamp { 0% { transform: scale(2.4); opacity: 0; } 60% { transform: scale(.94); opacity: 1; } 100% { transform: none; opacity: 1; } }
@keyframes lr-popin { 0% { transform: scale(.82) translateY(.8em); opacity: 0; } 60% { transform: scale(1.02); opacity: 1; } 100% { transform: none; opacity: 1; } }
@keyframes lr-spin { from { transform: rotate(-1140deg); } }
@keyframes lr-beat { 0%, 100% { transform: scale(1); } 12% { transform: scale(1.045); } 24% { transform: scale(1); } 36% { transform: scale(1.03); } }
@keyframes lr-shake { 0%, 100% { translate: -50% -50%; } 15% { translate: calc(-50% - .6em) calc(-50% + .3em); } 30% { translate: calc(-50% + .5em) calc(-50% - .4em); } 45% { translate: calc(-50% - .4em) calc(-50% + .2em); } 60% { translate: calc(-50% + .3em) -50%; } 80% { translate: calc(-50% - .15em) -50%; } }
@keyframes lr-flash { 0% { opacity: 0; } 8% { opacity: 1; } 100% { opacity: 0; } }
@keyframes lr-click { 0% { transform: scale(.7); opacity: 0; } 30% { transform: scale(1.06); opacity: 1; } 100% { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .lr-seat .tag i, .lr-drum .wheel, .lr-box { animation: none !important; }
}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('lr-stage-style')) return;
  const st = document.createElement('style');
  st.id = 'lr-stage-style';
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
/** 容器里前面几个固定节点不动，只把后面的动态节点换成 kids */
function setLayer(box, fixed, kids) {
  if (!fixed.every((n, i) => box.childNodes[i] === n)) { box.replaceChildren(...fixed, ...kids); return; }
  while (box.childNodes.length > fixed.length) box.lastChild.remove();
  box.append(...kids);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** 按开始时刻 t0 播放动画；已经播完就什么也不做。重画时用负的延迟接着播；同一个节点可以叠几段 */
function play(node, name, dur, t0, delay = 0, ease = EASE) {
  if (t0 === null || t0 === undefined) return node;
  const passed = now() - t0;
  if (passed > delay + dur) return node;
  const a = `${name} ${dur}ms ${ease} ${Math.round(delay - passed)}ms both`;
  node.style.animation = node.style.animation ? `${node.style.animation}, ${a}` : a;
  return node;
}
const pos = (x, y) => `left:${+x.toFixed(3)}em;top:${+y.toFixed(3)}em`;
const short = (t, n) => { const a = [...String(t || '')]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join(''); };
const seatNo = (seat) => Number(String(seat).replace(/\D/g, '')) || 0;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 画的是不是「正在进行的最新局面」（和德州、斗地主同一个判断） */
const isLive = (opts) => ('live' in opts ? !!opts.live
  : opts.replay ? false
    : opts.clock && typeof opts.clock === 'object' ? Object.keys(opts.clock).length > 0 || !!opts.movable
      : true);
/** 整局结束了没有（view.result 在质疑刚结算、下一手还没出时也有值，表示「结算中」；旧版服务端没有 over 字段） */
const ended = (v) => !!v && (v.over !== undefined ? !!v.over : !!v.result);
const summary = (v) => (v && Array.isArray(v.history) ? { challenges: v.history.length, n: v.history.at(-1)?.cards.length || 0, dead: !!v.history.at(-1)?.dead, over: ended(v) } : null);
const fracText = (pulls) => (pulls >= CH - 1 ? '必中' : `1/${CH - pulls}`);

/**
 * 揭晓还没演到扣扳机时，聚光框头上那一行（seatLine）也按质疑前的局面写，免得框里先写出「已出局」。
 * 牌桌开演一次揭晓时记下：{ key: 质疑次数, round, src: 质疑前的局面, until: 扣扳机的时刻, end: 演完的时刻（Date.now 毫秒） }。
 * 本局记录里这次质疑的结果也等演完再写。
 */
let hold = null;

/** 思考计时：行动者名牌上的「12s」，每秒自己更新 */
function thinkTimer(t0, down = false) {
  const n = el('span', { class: `tmr${down ? ' dn' : ''}`, 'data-t0': String(t0) });
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

// ---------- 牌 ----------
// 人头牌的冠饰：K 王冠、Q 后冠；A 是一枚菱形徽
const CROWN = {
  K: '<path d="M2.5 9.2 1.6 2.6l5 3.4L10 .9l3.4 5.1 5-3.4-.9 6.6z"/><path d="M3 9.2h14" stroke-width="1.3"/><circle cx="1.6" cy="2.4" r="1"/><circle cx="10" cy=".8" r="1"/><circle cx="18.4" cy="2.4" r="1"/>',
  Q: '<path d="M2.6 9.2C2.6 5.4 5.6 2.7 10 2.7s7.4 2.7 7.4 6.5z"/><path d="M3 9.2h14" stroke-width="1.3"/><path d="M6 6.2 10 4.3l4 1.9" fill="none"/><circle cx="10" cy="1.3" r="1.1"/>',
  A: '<path d="M10 .4 14 5 10 9.6 6 5z"/><path d="M2 5h4M14 5h4" stroke-width="1.1"/><circle cx="10" cy="5" r="1.2" fill="currentColor"/>',
};
/** 一张牌；fs 为牌的 font-size（牌宽 = 5 × fs）；rank 为 null 画牌背 */
function cardEl(rank, x, y, fs, cls = '') {
  const st = `left:${+(x / fs).toFixed(3)}em;top:${+(y / fs).toFixed(3)}em;font-size:${fs}em`;
  if (!rank) return el('div', { class: `lr-c bk ${cls}`, style: st });
  if (rank === JOKER) {
    return el('div', { class: `lr-c jk r ${cls}`, style: st },
      el('div', { class: 'ix' }, '鬼'), el('div', { class: 'mid' }, el('b', {}, '鬼'), el('small', {}, '万能')), el('div', { class: 'ix br' }, '鬼'));
  }
  const mid = el('div', { class: 'mid' });
  mid.innerHTML = `<svg viewBox="0 0 20 10" aria-hidden="true" fill="#e6bd5c" stroke="currentColor" stroke-width=".9" stroke-linejoin="round" stroke-linecap="round">${CROWN[rank] || ''}</svg>`;
  mid.append(el('b', {}, rank));
  return el('div', { class: `lr-c${rank === 'Q' ? ' r' : ''} ${cls}`, style: st }, el('div', { class: 'ix' }, rank), mid, el('div', { class: 'ix br' }, rank));
}
/** 一张会翻开的牌：牌背转到 90° 消失，牌面从 −90° 转出来 */
function flipCard(rank, x, y, fs, cls, t0, delay, dur = TM.FLIP) {
  const face = cardEl(rank, x, y, fs, cls);
  if (t0 === null || now() - t0 > delay + dur) return [face];
  const back = cardEl(null, x, y, fs);
  play(back, 'lr-flipA', dur, t0, delay, 'linear');
  play(face, 'lr-flipB', dur, t0, delay, 'linear');
  return [back, face];
}

// ---------- 左轮弹巢 ----------
// 6 格；chamber i 是第 i+1 次扣扳机打的那一格。pulls 次之后下一格转到正上方（旋转 −60° × pulls）。
// shot：中弹的那一格（下标）；spentUpTo：前几格已经打过。
let gradSeq = 0;
function gunSvg({ pulls = 0, shot = -1, rot = null, pin = true } = {}) {
  const id = ++gradSeq;
  const turn = rot === null ? -60 * pulls : rot;
  let holes = '';
  for (let i = 0; i < CH; i++) {
    const a = ((-90 + 60 * i) * Math.PI) / 180;
    const cls = i === shot ? 'shot' : i < pulls ? 'spent' : 'live';
    holes += `<circle class="${cls}" cx="${(6.3 * Math.cos(a)).toFixed(2)}" cy="${(6.3 * Math.sin(a)).toFixed(2)}" r="2.45"/>`;
  }
  // 两道渐变：钢（枪身）、黄铜（底火）。每个 SVG 用自己的 id，避免页面上几个弹巢互相引用
  const svg = `<svg class="lr-gunsvg" viewBox="-12.5 -13.5 25 26" aria-hidden="true">
<defs><radialGradient id="lr-steel-${id}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#6e6660"/><stop offset=".55" stop-color="#2b2622"/><stop offset="1" stop-color="#110d0b"/></radialGradient>
<radialGradient id="lr-brass-${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff2c0"/><stop offset=".5" stop-color="#d9a84a"/><stop offset="1" stop-color="#7a5418"/></radialGradient></defs>
${pin ? '<path class="pin" d="M0 -10.2 -1.7 -13.2H1.7z"/>' : ''}
<g transform="rotate(${turn})"><circle class="body" r="10.6" style="fill:url(#lr-steel-${id})"/>${holes.replaceAll('class="live"', `class="live" style="fill:url(#lr-brass-${id})"`)}<circle class="axle" r="1.7"/></g></svg>`;
  return svg;
}

export default {
  // 对局页用「牌桌 + 右侧聚光框 + 本局记录」版式
  hud: true,
  turnTip(view) {
    if (view?.mustCall) return '其他人都没牌了：只能点「质疑」，翻开上一手。';
    if (view?.canCall) return '点选 1–3 张手牌按「出牌」，当作桌牌打出（可以说谎）；不信上一手就按「质疑」。';
    return '本轮由你先出：点选 1–3 张手牌，按「出牌」当作桌牌打出（可以说谎）。';
  },

  /** 聚光框头上的一行：手牌、左轮 */
  seatLine(view, seat) {
    if (hold && Date.now() < hold.until && view?.history?.length === hold.key && view.round === hold.round) view = hold.src;
    const r = view?.revolvers?.[seat];
    if (!r) return '';
    if (!r.alive) return `已出局 · 扣了 ${r.pulls} 枪`;
    return `手牌 ${view.counts?.[seat] ?? 0} 张 · 左轮已扣 ${r.pulls} 枪（下一枪 ${fracText(r.pulls)}）`;
  },

  /** 本局记录：每一轮一组。最近一次质疑的结果要等画面演完（或下一手出现）才写进来，免得扳机还没扣就剧透 */
  handLog(view) {
    if (!Array.isArray(view?.log)) return null;
    const tag = (s) => `${seatNo(s)} 号`;
    const groups = [];
    const hs = view.history || [];
    let k = 0;
    view.log.forEach((e, i) => {
      let g = groups.at(-1);
      if (!g || g.round !== e.round) {
        const h = hs.find((x) => x.round === e.round);
        g = { round: e.round, street: `r${e.round}`, name: `第 ${e.round} 轮 · 桌牌 ${h ? h.table : view.round === e.round ? view.table : '?'}`, board: [], items: [] };
        groups.push(g);
      }
      if (e.kind === 'play') g.items.push({ seat: e.seat, text: `出 ${e.n} 张${e.cards ? `（${e.cards.join(' ')}）` : ''}` });
      else {
        const h = hs[k++];
        // 之后又有人出过牌，或者牌桌上这次揭晓已经演完（打开页面时直接看到的结果没有演出）
        const playing = hold && hold.key === hs.length && k === hs.length && Date.now() < hold.end;
        const settled = h && (i < view.log.length - 1 || !playing);
        g.items.push({ seat: e.seat, text: settled ? `质疑 ${tag(e.accused)} → ${h.lie ? '说谎' : '是真的'}，${tag(h.loser)}${h.dead ? '中弹出局' : '咔哒'}` : `质疑 ${tag(e.accused)}` });
      }
    });
    // 揭晓还没演完：表头按质疑前的局面写（新一轮的桌牌、还剩几人都先不说）
    const head = hold && hold.key === hs.length && view.round === hold.round && Date.now() < hold.end ? hold.src : view;
    const alive = (head.alive || []).length;
    return {
      label: '本局记录', title: `第 ${head.round} 轮`, sub: `桌牌 ${head.table} · 还剩 ${alive} 人`,
      groups, count: view.log.length, last: null,
      result: null,
    };
  },

  /** 回放时这一步之后多停多久：质疑揭晓、新一轮翻桌牌，和服务端停顿同一份时长 */
  pauseAfter: (a, b) => pauseBetween(summary(a), summary(b)),

  // 手机竖屏用竖版桌面，其余横版
  get aspect() { return typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? [10, 14] : [16, 10]; },

  createStage({ onAction }) {
    injectStyle();
    const root = el('div', { class: 'lr board-html', role: 'group', 'aria-label': '吹牛左轮牌桌' });
    const box = el('div', { class: 'lr-box' });
    const layer = el('div', { class: 'lr-layer' });
    box.append(layer);
    root.append(box);

    let layoutName = 'land';
    let last = null;
    const tables = {};
    // 动效状态：E 揭晓、intro 新一轮翻桌牌、play 刚出的一手
    const fx = { prev: null, E: null, intro: null, play: null, over: null, wakes: new Map(), sounds: [] };
    let sel = new Set(); // 选中的手牌下标
    let selKey = '';
    let sumHidden = false; // 终局卡收起了
    const redraw = () => last && draw(last.view, last.opts);

    // 对局页结束时会在牌桌上弹自己的终局卡（你赢了 / 再来一局）：它在的时候不叠我们的名次卡；它被收起后，名次卡也收成按钮
    const SUM_DELAY = 3200; // 刚演完最后一枪，等对局页的终局卡先出来（它在结束后约 2.6 秒弹出）
    let pageCard = false;
    let cardObs = null;
    function watchPageCard() {
      if (cardObs || typeof MutationObserver !== 'function' || !root.isConnected) return;
      const host = root.closest('.board-wrap') || root.closest('.stage') || root.parentElement;
      if (!host) return;
      const check = () => {
        const has = !!host.querySelector('.end-card');
        if (has === pageCard) return;
        if (pageCard && !has) sumHidden = true;
        pageCard = has;
        redraw();
      };
      cardObs = new MutationObserver(check);
      cardObs.observe(host, { childList: true, subtree: false });
      check();
    }

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(([e]) => {
        const { width, height } = e.contentRect;
        if (!width || !height) return;
        const name = height > width * 1.05 ? 'port' : 'land';
        if (name !== layoutName) { layoutName = name; root.classList.toggle('port', name === 'port'); redraw(); }
      }).observe(root);
    }

    /** 在某个时刻（performance.now 的毫秒）重画一次：揭晓的各段要换画面 */
    function wake(at) {
      const key = Math.round(at);
      if (fx.wakes.has(key)) return;
      const ms = Math.max(0, at - now());
      fx.wakes.set(key, setTimeout(() => { fx.wakes.delete(key); if (root.isConnected || !last) redraw(); }, ms + 16));
    }
    function clearTimers() {
      for (const t of fx.wakes.values()) clearTimeout(t);
      fx.wakes.clear();
      for (const t of fx.sounds) clearTimeout(t);
      fx.sounds = [];
    }
    const sound = (name, at) => { fx.sounds.push(setTimeout(() => { if (root.isConnected) sfx(name); }, Math.max(0, at - now()))); };

    function track(view, opts) {
      const p = fx.prev;
      const t = now();
      const anim = opts.animate !== false && !!p && p !== view && !reduced();
      const hl = view.history?.length || 0;
      const phl = p?.history?.length || 0;
      if (anim && hl === phl + 1 && (isLive(opts) || opts.replay)) {
        // 刚有人质疑：用质疑前的局面演揭晓
        clearTimers();
        const h = view.history.at(-1);
        const plan = revealPlan(h.cards.length, h.dead);
        fx.E = { t0: t, src: p, h, plan, key: hl };
        hold = { key: hl, round: view.round, src: p, until: Date.now() + plan.shotAt, end: Date.now() + plan.end };
        fx.intro = ended(view) ? null : { t0: t + plan.end, round: view.round, table: view.table, lead: view.lead };
        fx.play = null;
        for (const at of [plan.flipAt, plan.verdictAt, plan.aimAt, plan.aimAt + 320, plan.shotAt, plan.end]) wake(t + at);
        if (fx.intro) wake(fx.intro.t0 + TM.DEAL);
        for (let i = 0; i < h.cards.length; i++) sound('card', t + plan.flipAt + i * TM.FLIP_GAP);
        sound(h.dead ? 'bomb' : 'chip', t + plan.shotAt);
        if (h.dead) sound('out', t + plan.shotAt + 500);
      } else if (hl !== phl || view.round !== p?.round) {
        // 跳着看（复盘拖动、第一次打开）：不演揭晓
        if (!fx.E || fx.E.key !== hl) { fx.E = null; clearTimers(); }
        const fresh = !p && isLive(opts) && view.round === 1 && !hl && !(view.pile || []).length;
        fx.intro = fresh ? { t0: t, round: view.round, table: view.table, lead: view.lead } : fx.E ? fx.intro : null;
        if (fresh) wake(t + TM.DEAL);
      }
      if (anim && p && view.round === p.round && hl === phl && (view.pile?.length || 0) === (p.pile?.length || 0) + 1) {
        fx.play = { t0: t, idx: view.pile.length - 1 };
      }
      if (!ended(view)) { sumHidden = false; fx.over = null; }
      else if (anim && !ended(p)) fx.over = fx.E ? fx.E.t0 + fx.E.plan.end : t;
      fx.prev = view;
    }

    /** 每个座位在桌上的位置（旋转到玩家本人在正下方） */
    function geometry(view, viewer, L) {
      const n = view.seats.length;
      const rot = viewer && view.seats.includes(viewer) ? view.seats.indexOf(viewer) : 0;
      const g = {};
      const { cx, cy } = L.table;
      view.seats.forEach((s, j) => {
        const k = (j - rot + n) % n;
        const th = ((90 + (k * 360) / n) * Math.PI) / 180;
        const x = Math.max(L.clampX[0], Math.min(L.clampX[1], cx + L.ring.rx * Math.cos(th)));
        const y = Math.max(L.clampY[0], Math.min(L.clampY[1], cy + L.ring.ry * Math.sin(th)));
        g[s] = { x, y, k, top: y < cy - L.table.ry * 0.5 };
      });
      return g;
    }

    function plate(view, seat, s, L, { name, gun, turn, me, t0, win, loser, out }) {
      const P = L.plate;
      const cnt = view.counts?.[seat] ?? 0;
      const status = out ? '已出局' : ended(view) ? (win ? '活到最后' : '') : cnt ? `手牌 ${cnt} 张` : '出完了';
      const g = el('div', { class: 'gun', title: `左轮已扣 ${gun.pulls} 枪${out ? '' : `，下一枪中弹概率 ${fracText(gun.pulls)}`}` });
      g.innerHTML = gunSvg({ pulls: gun.pulls, shot: gun.shot });
      g.append(el('small', {}, `${gun.pulls}/${CH}`));
      const mustCall = turn && view.mustCall;
      return el('div', { class: `lr-seat${turn ? ' on' : ''}${win ? ' win' : ''}${loser ? ' loser' : ''}${out ? ' out' : ''}`, style: `${pos(s.x, s.y)};width:${P.w}em;height:${P.h}em` },
        el('span', { class: 'coin' }, String(seatNo(seat))),
        el('div', { class: 'who' }, el('b', { title: name }, name), el('span', { class: cnt <= 1 && !out && !ended(view) ? 'hot' : '' }, status)),
        g,
        out ? el('span', { class: 'seal' }, '出局') : null,
        turn && t0 ? thinkTimer(t0, !s.top) : null, // 计时和标签一样放在背对手牌的那一侧
        // 「思考中 / 轮到你」挂在名牌背对手牌的那一侧，不压牌（上方座位的牌在名牌下面，标签就在上面）
        turn ? el('div', { class: `tag${me ? ' me' : ''}${s.top ? '' : ' dn'}` }, me ? (mustCall ? '轮到你：只能质疑' : '轮到你') : mustCall ? '要质疑了' : '思考中', el('i'), el('i'), el('i')) : null);
    }

    /** 一家的手牌：明牌或牌背，摆在名牌靠桌心一侧（下方座位在名牌上面，上方座位在名牌下面，左右两侧在名牌上面） */
    function handCards(view, seat, s, L, { mine = false, pick = false } = {}) {
      const names = view.hands?.[seat];
      const count = view.counts?.[seat] ?? 0;
      if (!count) return [];
      const big = mine && pick;
      const cw = big ? L.mine.cw : L.hand.cw;
      const ch = cw * 1.4;
      const fs = cw / 5;
      const step = big ? cw * 1.08 : names ? cw * 0.72 : cw * 0.42;
      const total = cw + step * (count - 1);
      const cx = big ? L.mine.cx : s.x;
      const y = big ? L.mine.y : s.top ? s.y + L.plate.h / 2 + 0.5 : s.y - L.plate.h / 2 - 0.5 - ch;
      const x0 = cx - total / 2;
      const out = [];
      for (let i = 0; i < count; i++) {
        const r = names ? names[i] : null;
        const node = cardEl(r, x0 + i * step, y, fs, `${pick ? 'pick' : ''}${pick && sel.has(i) ? ' sel' : ''}`);
        if (pick) {
          node.setAttribute('role', 'checkbox');
          node.setAttribute('aria-checked', sel.has(i) ? 'true' : 'false');
          node.setAttribute('aria-label', r === JOKER ? '鬼牌' : r);
          node.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sel.has(i)) sel.delete(i);
            else if (sel.size < 3) sel.add(i);
            redraw();
          });
        }
        out.push(node);
      }
      return out;
    }

    /** 牌堆：每一手是一小叠牌背，一层层往上叠；位置、角度由牌的序号定（每次画都一样） */
    function pileEls(pile, L, g, { skipLast = false, t0 = null, fromSeat = null } = {}) {
      const [px, py] = L.pile;
      const cw = 3.1, fs = cw / 5;
      const out = [];
      let i = 0;
      pile.forEach((p, pi) => {
        if (skipLast && pi === pile.length - 1) return;
        for (let c = 0; c < p.n; c++, i++) {
          const jx = Math.sin(i * 12.9898) * 0.9;
          const rot = Math.sin(i * 78.233) * 16;
          const x = px - cw / 2 + jx;
          const y = py - cw * 1.4 / 2 - i * 0.2;
          const node = cardEl(null, x, y, fs);
          node.style.rotate = `${rot.toFixed(1)}deg`;
          if (t0 !== null && pi === pile.length - 1 && fromSeat && g[fromSeat]) {
            node.style.setProperty('--fx', `${((g[fromSeat].x - px) / fs).toFixed(2)}em`);
            node.style.setProperty('--fy', `${((g[fromSeat].y - py) / fs).toFixed(2)}em`);
            play(node, 'lr-slide', 520, t0, c * 90);
          }
          out.push(node);
        }
      });
      return { nodes: out, total: i };
    }

    function plaqueEl(round, table, L, t0 = null) {
      const slot = el('div', { class: 'slot' });
      const nodes = flipCard(table, 0, 0, 4.4 / 5, '', t0, 300, 600);
      slot.append(...nodes);
      return el('div', { class: 'lr-plaque', style: pos(...L.plaque) }, el('small', {}, '桌牌'), slot, el('span', { class: 'rd' }, `第 ${round} 轮`));
    }

    function claimEl(view, L, nameOf) {
      const lp = view.pile?.at(-1);
      if (!lp) return null;
      const real = lp.cards ? el('span', { class: 'real' }, '实为 ', ...lp.cards.flatMap((c, i) => [i ? ' ' : '', c === view.table || c === JOKER ? c : el('i', {}, c)])) : null;
      const node = el('div', { class: 'lr-claim', style: pos(...L.claim) },
        el('span', { class: 'no' }, String(seatNo(lp.seat))),
        el('span', { class: 'tx' }, `${short(nameOf(lp.seat), 6)} 出 ${lp.n} 张 · 称 `, el('b', {}, view.table)), real);
      return node;
    }

    function lastEl(view, L, nameOf) {
      const h = view.history?.at(-1);
      if (!h) return null;
      const tag = (s) => `${seatNo(s)} 号`;
      return el('div', { class: 'lr-last', style: pos(...L.last) },
        el('small', {}, `上次质疑 · 第 ${h.round} 轮 · 桌牌 ${h.table}`),
        el('span', {}, `${tag(h.caller)}质疑${tag(h.accused)}：${h.cards.join(' ')} → `, h.lie ? el('i', {}, '说谎') : '是真的'),
        el('span', {}, `${tag(h.loser)} ${short(nameOf(h.loser), 5)} 扣第 ${h.pull} 枪：`, h.dead ? el('i', {}, '中弹出局') : '咔哒'));
    }

    function draw(view, opts) {
      const { movable = null, actions = null, viewer = null } = opts;
      const L = LAYOUTS[layoutName];
      const T = L.table;
      const t = now();
      const nameOf = (s) => opts.players?.[s]?.name || view.seatNames?.[s] || `${seatNo(s)} 号位`;
      let E = fx.E;
      if (E && t - E.t0 >= E.plan.end) fx.E = E = null;
      const at = (ms) => !!E && t - E.t0 >= ms;
      const src = E ? E.src : view; // 揭晓期间桌面按质疑前那一步画
      const g = geometry(view, viewer, L);
      const liveNow = isLive(opts);
      const kids = [];
      box.style.animation = '';

      const table = tables[layoutName] ||= [
        el('div', { class: 'lr-rail', style: `${pos(T.cx - T.rx - 1.6, T.cy - T.ry - 1.6)};width:${(T.rx + 1.6) * 2}em;height:${(T.ry + 1.6) * 2}em` }),
        el('div', { class: 'lr-felt', style: `${pos(T.cx - T.rx + 0.3, T.cy - T.ry + 0.3)};width:${(T.rx - 0.3) * 2}em;height:${(T.ry - 0.3) * 2}em` }),
        el('div', { class: 'lr-wm', style: pos(T.cx, T.cy + T.ry * 0.62) }, el('span', {}, '吹牛'))];

      // 桌牌牌匾：新一轮开始时翻开
      const intro = !E && fx.intro && fx.intro.round === view.round && t >= fx.intro.t0 - 40 && t - fx.intro.t0 < TM.DEAL ? fx.intro : null;
      kids.push(plaqueEl(src.round, src.table, L, intro ? intro.t0 : null));

      // 牌堆（揭晓时上一手被翻到桌心，不在堆里）
      const pileSrc = src.pile || [];
      const { nodes: pileNodes, total } = pileEls(pileSrc, L, g, { skipLast: !!E && at(E.plan.flipAt), t0: !E && fx.play && fx.play.idx === pileSrc.length - 1 ? fx.play.t0 : null, fromSeat: pileSrc.at(-1)?.seat });
      kids.push(...pileNodes);
      if (total) kids.push(el('div', { class: 'lr-pcount', style: pos(...L.pcount) }, `牌堆 ${total} 张`));
      if (!E) { const c = claimEl(src, L, nameOf); if (c) kids.push(play(c, 'lr-in', 300, fx.play?.t0 ?? null, 380)); }

      // 上次质疑的结果（不在揭晓、翻桌牌的时候）
      if (!E && !intro && !ended(view)) { const le = lastEl(view, L, nameOf); if (le) kids.push(le); }

      // 各座位：手牌、名牌（弹巢在扣扳机那一刻才更新）
      const shotDone = !E || at(E.plan.shotAt);
      for (const seat of view.seats) {
        const s = g[seat];
        const rv = (shotDone ? view : src).revolvers?.[seat] || { pulls: 0, alive: true };
        const out = !rv.alive;
        const dead = out ? view.history?.find((h) => h.loser === seat && h.dead) : null;
        const gun = { pulls: rv.pulls, shot: dead ? dead.pull - 1 : -1 };
        const handView = E ? src : view;
        const mine = !!viewer && seat === viewer;
        const pick = mine && !E && movable === seat && Array.isArray(actions) && actions.some((a) => a.id !== 'call');
        if (!out) kids.push(...handCards(handView, seat, s, L, { mine, pick }));
        const turn = !E && liveNow && !ended(view) && view.turn === seat;
        kids.push(plate(handView, seat, s, L, {
          name: nameOf(seat), gun, turn, me: turn && movable === seat, t0: opts.clock?.[seat] || null,
          win: ended(view) && view.result?.winner === seat && !E, loser: !!E && at(E.plan.verdictAt) && E.h.loser === seat, out,
        }));
      }

      // ---------- 揭晓 ----------
      if (E) {
        const { plan, h } = E;
        const tag = (x) => `${seatNo(x)} 号 ${short(nameOf(x), 6)}`;
        if (!at(plan.flipAt + 320)) {
          const b = el('div', { class: 'lr-banner', style: pos(T.cx, T.cy - 2) }, el('span', {}, '质疑！'), el('small', {}, `${tag(h.caller)} 不信 ${tag(h.accused)}`));
          play(b, 'lr-banner', 700, E.t0, 0, 'ease-out');
          play(b, 'lr-out', 300, E.t0, plan.flipAt);
          kids.push(b);
        }
        if (at(plan.flipAt - 40)) {
          const veil = el('div', { class: 'lr-veil' });
          play(veil, 'lr-in', 400, E.t0, plan.flipAt);
          play(veil, 'lr-out', 300, E.t0, plan.end - 300);
          kids.push(veil);
        }
        // 翻开上一手：从牌堆抬到桌心上方，一张张翻；判定后假牌描红、真牌描金
        if (at(plan.flipAt - 40) && !at(plan.aimAt + 320)) {
          const cw = 4.6, fs = cw / 5, gap = 0.9;
          const tot = h.cards.length * cw + (h.cards.length - 1) * gap;
          const [sx, sy] = L.show;
          const judged = at(plan.verdictAt);
          h.cards.forEach((c, i) => {
            const x = sx - tot / 2 + i * (cw + gap);
            const y = sy - cw * 0.7;
            const cls = judged ? (c === h.table || c === JOKER ? 'ok' : 'lie') : '';
            const nodes = flipCard(c, x, y, fs, cls, E.t0, plan.flipAt + i * TM.FLIP_GAP);
            for (const nd of nodes) {
              play(nd, 'lr-out', 300, E.t0, plan.aimAt);
            }
            kids.push(...nodes);
          });
          if (judged) {
            const st = el('div', { class: `lr-stamp ${h.lie ? 'lie' : 'ok'}`, style: pos(...L.stamp) },
              el('b', {}, h.lie ? '说谎！' : '是真的'), el('small', {}, `${tag(h.loser)} 扣扳机`));
            play(st, 'lr-stamp', 420, E.t0, plan.verdictAt, 'cubic-bezier(.2,1.3,.4,1)');
            play(st, 'lr-out', 300, E.t0, plan.aimAt);
            kids.push(st);
          }
        }
        // 举枪：输家的弹巢放大、转几圈停住、心跳一样鼓动；扣扳机：咔哒或砰
        if (at(plan.aimAt - 40)) {
          const before = h.pull - 1;
          const shot = at(plan.shotAt);
          const spin = el('div', { class: 'spin' });
          spin.innerHTML = gunSvg({ pulls: shot ? h.pull : before, shot: shot && h.dead ? h.pull - 1 : -1, rot: -60 * before, pin: false });
          const pinEl = el('div', { class: 'pin' });
          pinEl.innerHTML = '<svg viewBox="-12.5 -13.5 25 26" aria-hidden="true"><path fill="#f0cd78" stroke="#3a2408" stroke-width=".4" d="M0 -10.2 -1.9 -13.4H1.9z"/></svg>';
          const wheel = el('div', { class: 'wheel' }, spin, pinEl);
          play(spin, 'lr-spin', TM.AIM - 500, E.t0, plan.aimAt, 'cubic-bezier(.15,.6,.25,1)');
          play(wheel, 'lr-beat', 900, E.t0, plan.aimAt + TM.AIM - 900, 'ease-in-out');
          const dr = el('div', { class: 'lr-drum', style: pos(...L.drum) }, wheel,
            el('div', { class: 'cap' }, `${tag(h.loser)} · 第 ${h.pull} 枪 · 中弹概率 `, el('b', {}, fracText(before))));
          play(dr, 'lr-popin', 420, E.t0, plan.aimAt, 'cubic-bezier(.2,1.2,.4,1)');
          play(dr, 'lr-out', 300, E.t0, plan.end - 300);
          kids.push(dr);
          if (shot) {
            const bang = el('div', { class: `lr-bang ${h.dead ? 'dead' : 'click'}`, style: pos(L.drum[0], L.drum[1] - 1) },
              el('b', {}, h.dead ? '砰！' : '咔哒'), el('small', {}, h.dead ? `${tag(h.loser)} 出局` : '空膛，活下来了'));
            play(bang, h.dead ? 'lr-stamp' : 'lr-click', 380, E.t0, plan.shotAt, 'cubic-bezier(.2,1.3,.4,1)');
            play(bang, 'lr-out', 300, E.t0, plan.end - 300);
            kids.push(bang);
            if (h.dead && !at(plan.shotAt + 800)) {
              kids.push(play(el('div', { class: 'lr-flash' }), 'lr-flash', 800, E.t0, plan.shotAt, 'ease-out'));
              play(box, 'lr-shake', 520, E.t0, plan.shotAt, 'linear');
            }
          }
        }
      }

      // 新一轮：翻桌牌的牌匾
      if (intro) {
        const veil = el('div', { class: 'lr-veil' });
        const slot = el('div', { class: 'slot' });
        slot.append(...flipCard(intro.table, 0, 0, 1, '', intro.t0, 350, 600));
        const card = el('div', { class: 'lr-pop lr-intro', style: `top:${T.cy - 1}em` },
          el('div', { class: 'ttl' }, `第 ${intro.round} 轮`), slot,
          el('div', { class: 'sub' }, `桌牌 ${intro.table} · ${seatNo(intro.lead)} 号 ${short(nameOf(intro.lead), 6)} 先出`));
        for (const x of [veil, card]) {
          play(x, x === card ? 'lr-popin' : 'lr-in', x === card ? 480 : 300, intro.t0, 0, 'cubic-bezier(.2,1.2,.4,1)');
          play(x, 'lr-out', 300, intro.t0, TM.DEAL - 300, 'ease-in');
        }
        kids.push(veil, card);
      }

      // 终局：名次卡（揭晓演完之后）
      const sumAt = fx.over !== null && !opts.replay ? fx.over + SUM_DELAY : null;
      if (sumAt !== null && t < sumAt && !pageCard) wake(sumAt);
      if (ended(view) && view.result && !E && !pageCard && (sumAt === null || t >= sumAt - 40)) {
        const r = view.result;
        if (sumHidden) {
          kids.push(el('button', { class: 'lr-pill', type: 'button', style: pos(...L.pill), onclick: (e) => { e.stopPropagation(); sumHidden = false; redraw(); } }, '名次 ▸'));
        } else {
          const order = Object.entries(r.ranks).sort((a, b) => a[1] - b[1]);
          const roundOut = (s) => view.history.find((h) => h.loser === s && h.dead);
          const card = el('div', { class: 'lr-pop lr-sum', style: `top:${T.cy}em` },
            el('div', { class: 'ttl' }, `${short(nameOf(r.winner), 8)} 活到最后`),
            el('div', { class: 'rows' }, ...order.map(([s, rk]) => el('div', { class: `rw${s === r.winner ? ' win' : ''}` },
              el('span', { class: 'rk' }, String(rk)), el('span', { class: 'nm' }, `${seatNo(s)} 号 ${nameOf(s)}`),
              el('span', { class: 'st' }, s === r.winner ? `扣了 ${view.revolvers[s].pulls} 枪都没响` : `第 ${roundOut(s)?.round ?? '?'} 轮中弹`)))),
            el('button', { class: 'lr-x', type: 'button', title: '收起', 'aria-label': '收起名次卡', onclick: (e) => { e.stopPropagation(); sumHidden = true; redraw(); } }, '✕'));
          kids.push(play(card, 'lr-popin', 520, sumAt ?? fx.over, 0, 'cubic-bezier(.2,1.2,.4,1)'));
        }
      }

      // 操作台：玩家本人轮到时
      const show = !E && !!movable && view.turn === movable && Array.isArray(actions) && actions.length > 0;
      if (show) {
        const hand = view.hands?.[movable] || [];
        const key = `${view.round}|${hand.join(',')}|${view.pile?.length || 0}`;
        if (key !== selKey) { selKey = key; sel = new Set(); }
        const ids = new Set(actions.map((a) => a.id));
        const chosen = [...sel].map((i) => hand[i]).filter(Boolean);
        const order = ['Q', 'K', 'A', JOKER];
        const face = chosen.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(' ');
        // 出牌的行动 id 是暗码，牌面在 cards 里（旧版服务端的 id 就是牌面）
        const id = (actions.find((a) => a.cards === face) || actions.find((a) => a.id === face))?.id;
        const canPlay = chosen.length >= 1 && !!id;
        const btns = [];
        if (ids.has('call')) {
          const lp = view.pile?.at(-1);
          const b = el('button', { type: 'button', class: 'btn call' }, lp ? `质疑 ${seatNo(lp.seat)} 号` : '质疑');
          b.addEventListener('click', (e) => { e.stopPropagation(); sel = new Set(); onAction('call'); });
          btns.push(b);
        }
        if (!view.mustCall) {
          const b = el('button', { type: 'button', class: 'btn primary' }, chosen.length ? `出 ${chosen.length} 张 · 称 ${view.table}` : '出牌');
          b.disabled = !canPlay;
          b.addEventListener('click', (e) => { e.stopPropagation(); if (!canPlay) return; sel = new Set(); onAction(id); });
          btns.push(b);
        }
        kids.push(el('div', { class: 'lr-ctl', style: pos(L.ctl.cx, L.ctl.y) }, ...btns));
      } else selKey = '';

      setLayer(layer, table, kids);
      if (layer.querySelector('.tmr')) startTimerTick(root);
    }

    return {
      el: root,
      render(view, opts = {}) {
        if (!view || !Array.isArray(view.seats)) return;
        last = { view, opts };
        watchPageCard();
        track(view, opts);
        draw(view, opts);
      },
    };
  },
};
