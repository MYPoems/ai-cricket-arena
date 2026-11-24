// 斗地主画面：俯视一张深色漆木牌桌（金边、嵌金线），地主坐下方，两名农民在上方左右。
// 观众是上帝视角，三家手牌摊成扇形；玩家本人只看到自己的牌，另两家是朱漆描金的牌背。
// 顶部中间一块牌匾：底分、倍数（书法大字）、三张底牌。桌心是本轮最近的一手（主体在前、带的牌在后）；
// 被压过的牌缩小退到出牌人面前，轮到他再出或这一轮结束时收走；「不出」是气泡。
// 动效：出牌从手里飞到桌心按牌型排开；剩余张数跳动，剩 2 张以下标红「报单/报双」；炸弹时桌心炸开金光、倍数翻滚；
// 定地主时三张底牌在桌心翻开、飞给地主（地主在下方时新到的三张抬起一会儿再落下）；飞机横穿牌桌、王炸火箭升空并震桌、
// 顺子 / 连对一道光扫过；春天 / 反春先打横幅再出结算卡。结算卡写清叫分 × 炸弹 × 春天 = 每家分数，和每家得失。
// 这些特效的时长在 games/doudizhu/rules.js 的 FX 里，服务端按同一份时长停顿（interlude），回放按 pauseAfter 停顿。
// 玩家本人行动时：手牌放大，按钮左边一圈 30 秒软倒计时（只提醒，不会自动出牌）；点选或横着划过一串牌连选（选中的牌抬高），按钮「不出」「提示」「重选」「出牌」，
// 按钮上方实时说明选中的是什么牌型、能不能出；「提示」依次给出能出的牌（小的先，炸弹最后）。
// 叫分阶段为「不叫」「1 分」「2 分」「3 分」。
//
// 画面用 HTML 画：根节点是尺寸容器，里面一块固定比例的桌面，桌面上的东西一律用 em 定位（横版 80×50em，竖版 50×70em），
// 所以大厅缩略图、对局页、手机竖屏都是同一套画法等比缩放。动画按「开始时刻」续播：重画时用负的 animation-delay 接上，
// 所以对局推进、点选手牌导致的重画不会打断正在飞的牌。

import { FX, fxDuration, TYPE_NAMES } from '/games/doudizhu/rules.js';

const SEATS = ['p1', 'p2', 'p3'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王'];
const rankOf = (n) => RANKS.indexOf(n);
const isJoker = (n) => n === '小王' || n === '大王';
const COLORS = ['var(--red)', 'var(--black-side)', '#3559b5']; // 选手卡上的阵营色（随深浅色主题变）
// 斗地主不分花色，牌面上的花色只是装饰：同一组牌里同点数的第 k 张依次用 ♠♥♣♦
const SUITS = [['♠', 'b'], ['♥', 'r'], ['♣', 'b'], ['♦', 'r']];
const EASE = 'cubic-bezier(.2,.75,.1,1)';
const TYPE_KEY = Object.fromEntries(Object.entries(TYPE_NAMES).map(([k, v]) => [v, k])); // 「飞机带单」→ plane1
const CD_SECS = 30; // 真人出手的软倒计时
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 版式（单位 em） ----------
// 每个座位：plate 名牌左上角，hand 手牌（cx 中心、y 顶边、cw 牌宽、maxW 最大总宽），bubble 气泡（ax 为 'l'/'r' 对齐），from 出牌起飞点，
// front 面前那一手（x 为对齐边、al 为 'l'/'r'，牌宽 frontCw、最大总宽 frontMaxW）。ban 春天横幅的中线
const LAYOUTS = {
  land: {
    w: 80, h: 50, plateW: 17.5,
    plaque: { cx: 40, y: 1.3 },
    left: { plate: [1.6, 1.6], hand: { cx: 15, y: 9.4, cw: 3.3, maxW: 26.5 }, bubble: [20.2, 2.6, 'l'], from: [15, 12], front: { x: 3.4, y: 15.9, al: 'l' } },
    right: { plate: [80 - 1.6 - 17.5, 1.6], hand: { cx: 65, y: 9.4, cw: 3.3, maxW: 26.5 }, bubble: [80 - 20.2, 2.6, 'r'], from: [65, 12], front: { x: 80 - 3.4, y: 15.9, al: 'r' } },
    bottom: { plate: [1.6, 40.6], hand: { cx: 44.8, y: 38.4, cw: 5.1, maxW: 47.6 }, bubble: [2.2, 35.2, 'l'], from: [44.8, 42], front: { x: 2.4, y: 34.4, al: 'l', maxW: 17.8 } },
    frontCw: 3.3, frontMaxW: 19.5,
    // 轮到玩家本人出牌时的手牌：放大、铺宽，整张露出更多，好点
    mine: { cx: 49.6, y: 36.6, cw: 6.2, maxW: 55 }, ctlMine: 31.5,
    lead: { cx: 40, y: 19.2, cw: 4.7, maxW: 44 },
    ctl: { cx: 40, y: 32.6 },
    res: { cx: 40, y: 11.4, w: 34 },
    ban: 22.5,
    counter: { cx: 40, y: 8.7 },
    pill: [78.2, 44.6],
  },
  port: {
    w: 50, h: 70, plateW: 23.6,
    plaque: { cx: 25, y: 1 },
    left: { plate: [0.9, 8.2], hand: { cx: 12.7, y: 15.4, cw: 2.75, maxW: 23 }, bubble: [1.4, 21.4, 'l'], from: [12.7, 18], front: { x: 1.4, y: 21.4, al: 'l' } },
    right: { plate: [50 - 0.9 - 23.6, 8.2], hand: { cx: 37.3, y: 15.4, cw: 2.75, maxW: 23 }, bubble: [50 - 1.4, 21.4, 'r'], from: [37.3, 18], front: { x: 50 - 1.4, y: 21.4, al: 'r' } },
    bottom: { plate: [0.9, 47.4], hand: { cx: 25, y: 56, cw: 5.2, maxW: 48.4 }, bubble: [50 - 1.4, 48.4, 'r'], from: [25, 60], front: { x: 50 - 1.4, y: 48.4, al: 'r', maxW: 22.6 } },
    frontCw: 3.4, frontMaxW: 21.6,
    mine: { cx: 25, y: 54.6, cw: 5.9, maxW: 49 }, ctlMine: 40.4,
    lead: { cx: 25, y: 29.4, cw: 4, maxW: 46 },
    ctl: { cx: 25, y: 41.6 },
    res: { cx: 25, y: 25.2, w: 42 },
    ban: 33,
    pill: [48.8, 64.8],
  },
};

// ---------- 样式 ----------
const CSS = `
.ddz { position: relative; width: 100%; height: 100%; container-type: size; user-select: none; -webkit-user-select: none; font-family: var(--serif); }
.ddz-box { position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: min(100cqw, 160cqh); height: min(62.5cqw, 100cqh); font-size: min(1.25cqw, 2cqh); }
.ddz.port .ddz-box { width: min(100cqw, 71.43cqh); height: min(140cqw, 100cqh); font-size: min(2cqw, 1.4286cqh); }
.ddz-box > * { position: absolute; }

/* 桌子：外圈是漆木桌沿（描金外边），里面一块下沉的桌面，桌面四周再嵌一道细金线 */
.ddz-rail { inset: .3em .3em .9em; border-radius: 2.6em; border: .2em solid transparent;
  background:
    radial-gradient(70% 60% at 18% 0%, rgb(255 214 170 / .2), transparent 62%) padding-box,
    linear-gradient(180deg, #4a1209 0%, #2b0905 46%, #170403 100%) padding-box,
    var(--edge) border-box;
  box-shadow: inset 0 .14em 0 rgb(255 226 184 / .28), inset 0 -.2em .3em rgb(0 0 0 / .6),
    0 .3em 0 #3b1607, 0 .55em 0 #1a0703, 0 .62em 0 .06em #050100, 0 1em 1.2em rgb(0 0 0 / .55); }
.ddz-top { inset: 1.7em 1.7em 2.3em; border-radius: 1.5em; overflow: hidden;
  background:
    var(--grain),
    radial-gradient(55% 42% at 20% -4%, rgb(255 210 160 / .18), transparent 70%),
    radial-gradient(62% 58% at 50% 46%, rgb(170 46 22 / .42), transparent 76%),
    repeating-linear-gradient(91deg, transparent 0 1.1em, rgb(0 0 0 / .07) 1.1em 1.2em, transparent 1.2em 2.3em, rgb(255 190 140 / .035) 2.3em 2.38em),
    radial-gradient(130% 95% at 50% 112%, rgb(0 0 0 / .6), transparent 60%),
    linear-gradient(180deg, #57170d 0%, #3a0e08 52%, #250705 100%);
  box-shadow: inset 0 .5em 1em rgb(0 0 0 / .65), inset 0 0 0 .08em rgb(0 0 0 / .7), 0 .08em 0 rgb(255 224 176 / .16); }
.ddz-top::after { content: ''; position: absolute; inset: .7em; border-radius: .9em; border: .08em solid rgb(226 186 96 / .42);
  box-shadow: inset 0 .08em 0 rgb(0 0 0 / .45), 0 .08em 0 rgb(255 228 184 / .08); pointer-events: none; }
.ddz-wm { font: 400 22em/1 var(--brush); color: rgb(240 205 120 / .045); left: 50%; top: 52%; translate: -50% -50%; pointer-events: none; }
.ddz.port .ddz-wm { font-size: 18em; top: 46%; }
:root[data-theme="light"] .ddz-rail { box-shadow: inset 0 .14em 0 rgb(255 226 184 / .28), inset 0 -.2em .3em rgb(0 0 0 / .6),
  0 .3em 0 #6a4a16, 0 .55em 0 #3e2a0a, 0 .62em 0 .06em rgb(70 44 8 / .7), 0 1em 1.2em rgb(80 48 10 / .4); }

/* 牌：白卡纸，边上露出一沓卡纸的厚度，再落影。牌面大小全由 font-size 决定（牌宽 5em、高 7em） */
.ddz-c { position: absolute; width: 5em; height: 7em; border-radius: .46em; color: #1c1310;
  background: radial-gradient(120% 70% at 20% 0%, #fff, rgb(255 255 255 / 0) 60%), linear-gradient(172deg, #fffcf3 0%, #f6eedb 72%, #ecdfc1 100%);
  box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 .07em 0 #fff, inset 0 -.08em .1em rgb(150 110 50 / .18),
    0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .16em 0 rgb(60 36 8 / .55), 0 .35em .5em -.05em rgb(0 0 0 / .5); }
.ddz-c.r { color: #c42d1e; }
.ddz-c .ix { position: absolute; left: .32em; top: .26em; display: grid; justify-items: center; line-height: 1; }
.ddz-c .ix b { font: 700 1.45em/1 var(--num); letter-spacing: -.04em; }
.ddz-c .ix i { font-style: normal; font-size: 1.05em; margin-top: .08em; }
.ddz-c .ix.br { left: auto; top: auto; right: .32em; bottom: .26em; rotate: 180deg; }
.ddz-c .pip { position: absolute; left: 50%; top: 52%; translate: -50% -50%; font-size: 2.7em; line-height: 1; }
.ddz-c .pip.a { font-size: 3.5em; }
/* 人头牌（J/Q/K）：中间一块描金双线框，框顶一枚冠饰（K 王冠、Q 后冠、J 羽帽），中间衬线大字母，下面花色 */
.ddz-c .face { position: absolute; inset: 1.15em .95em; border-radius: .24em; display: grid; grid-template-rows: 1.05em 1fr 1em; justify-items: center; align-items: center; padding: .22em 0 .2em;
  background: radial-gradient(90% 60% at 50% 44%, rgb(255 255 255 / .85), transparent 70%), linear-gradient(180deg, rgb(232 196 112 / .3), rgb(201 162 74 / .12));
  box-shadow: inset 0 0 0 .05em currentColor, inset 0 0 0 .14em #fffaf0, inset 0 0 0 .2em rgb(186 142 52 / .85), 0 .03em .06em rgb(90 60 14 / .25); }
.ddz-c .face svg { width: 2.1em; height: 1.05em; overflow: visible; }
.ddz-c .face b { font: 900 2.3em/1 var(--serif); letter-spacing: -.02em; text-shadow: 0 .04em 0 rgb(255 255 255 / .9); }
.ddz-c .face i { font-style: normal; font-size: 1em; line-height: 1; }
.ddz-c.jk .ix { font: 400 1.05em/1.02 var(--brush); writing-mode: vertical-rl; letter-spacing: -.05em; }
.ddz-c.jk .emb { position: absolute; left: 50%; top: 53%; translate: -50% -50%; border-radius: 50%; display: grid; place-items: center;
  font: 400 1.9em/1 var(--brush); width: 1.55em; height: 1.55em; box-shadow: inset 0 0 0 .07em currentColor, inset 0 0 0 .2em rgb(255 255 255 / .8), inset 0 0 0 .26em rgb(201 162 74 / .7);
  background: radial-gradient(circle at 35% 30%, rgb(255 255 255 / .9), rgb(240 205 120 / .25) 70%); }
/* 牌背：朱漆描金。白边、金线、斜格回纹、中间一枚金钱 */
.ddz-c.bk { background:
    radial-gradient(circle at 50% 50%, #fbe8a6 0 .38em, #b8862e .42em .5em, transparent .54em),
    radial-gradient(circle at 50% 50%, transparent 0 .78em, rgb(240 205 120 / .55) .8em .86em, transparent .9em),
    repeating-linear-gradient(45deg, rgb(240 205 120 / .3) 0 .06em, transparent .06em .62em),
    repeating-linear-gradient(-45deg, rgb(240 205 120 / .3) 0 .06em, transparent .06em .62em),
    radial-gradient(90% 60% at 30% 10%, rgb(255 150 110 / .35), transparent 70%),
    linear-gradient(165deg, #c23a26 0%, #8e1b12 55%, #5e0e08 100%);
  box-shadow: inset 0 0 0 .24em #fbf3df, inset 0 0 0 .31em #d4ab52, inset 0 0 0 .36em #5e0e08, inset 0 0 0 .05em rgb(110 76 28 / .5),
    0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .16em 0 rgb(60 36 8 / .55), 0 .35em .5em -.05em rgb(0 0 0 / .5); }
.ddz-c.pick { cursor: pointer; }
.ddz-c.pick:hover { translate: 0 -.3em; }
.ddz-c.sel { translate: 0 -1.3em; box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 0 0 .14em #e0b454, inset 0 .07em 0 #fff,
  0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .16em 0 rgb(60 36 8 / .55), 0 .6em .8em -.05em rgb(0 0 0 / .55), 0 0 .9em rgb(240 205 120 / .55); }
.ddz-c.sel.pick:hover { translate: 0 -1.5em; }
.ddz-play.stale { opacity: .42; }
/* 桌上的牌、底牌交接、牌型标签、气泡、提示只是画面：铺满桌面的出牌层不能挡住手牌（出过牌后点不到、划不动手牌） */
.ddz-play, .ddz-give, .ddz-lbl, .ddz-bub, .ddz-tip { pointer-events: none; }
/* 面前那一手：小一号、阴影浅一些 */
.ddz-play.front .ddz-c { box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 .07em 0 #fff, 0 .08em 0 #c6b388, 0 .12em 0 rgb(60 36 8 / .55), 0 .3em .4em -.05em rgb(0 0 0 / .5); }

/* 牌匾：底分、倍数、底牌 */
.ddz-plq { display: flex; align-items: center; gap: 1.1em; padding: .55em 1.1em .6em 1.3em; border-radius: 1em; translate: -50% 0; border: .14em solid transparent; white-space: nowrap;
  background: var(--glint), var(--surface), var(--edge) border-box; box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .5em .7em rgb(0 0 0 / .55); color: var(--text); }
.ddz-plq .kv { display: grid; justify-items: center; line-height: 1.05; }
.ddz-plq .kv small { font: 600 .95em/1.2 var(--sans); letter-spacing: .18em; color: var(--gold); }
.ddz-plq .kv b { font: 600 2.1em/1.1 var(--num); color: var(--text); }
.ddz-plq .mult { font: 400 2.7em/1.05 var(--brush); letter-spacing: -.02em; background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 .1em; text-shadow: none; }
.ddz-plq .mult.hot { background: linear-gradient(180deg, #ffd9b0 0%, #ff7a5a 40%, #d23a26 62%, #f2604a 100%); -webkit-background-clip: text; background-clip: text; }
.ddz-plq .bot { display: flex; gap: .35em; padding: .35em .45em; border-radius: .6em; background: var(--well-bg); box-shadow: var(--well-sh); }
.ddz-plq .bot .ddz-c { position: relative; }
.ddz-plq .bot .ddz-fw { position: relative; width: 5em; height: 7em; }
.ddz-plq .bot .ddz-fw .ddz-c { position: absolute; }
.ddz-plq .sep { width: .1em; align-self: stretch; margin: .3em 0; background: linear-gradient(180deg, transparent, var(--groove-d), transparent); box-shadow: .08em 0 0 var(--groove-l); }

/* 名牌：一块小漆板。轮到谁，谁的金边变亮、外面套一圈光 */
.ddz-plate { height: 5.6em; display: flex; align-items: center; gap: .9em; padding: 0 1.1em 0 .8em; border-radius: 1em; border: .14em solid transparent; color: var(--text);
  --edge-now: var(--edge);
  background: var(--glint), var(--surface), var(--edge-now) border-box;
  box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .55em .8em rgb(0 0 0 / .55); transition: box-shadow .3s; }
.ddz.port .ddz-plate { height: 5em; }
:root[data-theme="light"] .ddz-plate, :root[data-theme="light"] .ddz-plq { box-shadow: var(--hi), 0 .18em 0 #8e6824, 0 .26em 0 .04em rgb(70 44 8 / .7), 0 .55em .8em rgb(40 14 4 / .5); }
.ddz-plate.on { --edge-now: var(--edge-hi); box-shadow: var(--hi), 0 0 0 .1em #040100, 0 0 0 .38em rgb(42 11 8 / .9), 0 0 0 .48em rgb(240 205 120 / .75), 0 0 2em .3em rgb(240 205 120 / .38), 0 .55em .8em rgb(0 0 0 / .55); }
.ddz-plate.win { --edge-now: var(--edge-hi); }
.ddz-plate .coin { font-size: 1.55em; width: 2.1em; height: 2.1em; flex: none; font-family: var(--num); font-weight: 600; margin-bottom: .2em; }
.ddz-plate .who { display: grid; gap: .25em; min-width: 4em; flex: 1 1 auto; }
.ddz-plate .who b { font: 900 1.5em/1.15 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ddz-plate .who span { display: flex; align-items: center; gap: .45em; font: 600 1.05em/1 var(--sans); color: var(--muted); white-space: nowrap; }
.ddz-plate .tag { font: 700 1em/1 var(--sans); padding: .32em .55em; border-radius: .3em; color: var(--muted); background: var(--well-bg); box-shadow: var(--well-sh); }
/* 地主印章：铜钱右下角的小角标，不占名字的宽度 */
.ddz-plate .coin .seal { position: absolute; right: -.42em; bottom: -.3em; width: 1.5em; height: 1.5em; font: 400 .68em/1 var(--brush); z-index: 1; }
/* 竖版：名字长了折成两行 */
.ddz.port .ddz-plate .who b { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-height: 1.08; word-break: break-all; }
.ddz-plate .cnt { display: grid; justify-items: center; flex: none; min-width: 2.6em; }
.ddz-plate .cnt b { font: 600 2.5em/1 var(--num); color: var(--text); font-variant-numeric: tabular-nums; }
.ddz-plate .cnt small { font: 600 .9em/1.2 var(--sans); color: var(--muted); letter-spacing: .1em; }
.ddz-plate .cnt.warn b { color: var(--zhu-2); }
.ddz-plate .alarm { position: absolute; top: -.9em; right: .9em; font: 700 1em/1 var(--sans); color: #fff3e6; padding: .34em .6em; border-radius: .9em; letter-spacing: .12em;
  background: radial-gradient(circle at 34% 24%, #ff8a72, #d23a26 46%, #8e1b12); box-shadow: inset 0 .07em 0 rgb(255 220 200 / .6), 0 0 0 .08em #6a4a14, 0 0 0 .16em #e6bd5c, 0 .2em .3em .1em rgb(0 0 0 / .45);
  animation: ddz-alarm 1.1s ease-in-out infinite; }
.ddz-plate .think { position: absolute; left: 50%; bottom: -.95em; translate: -50% 0; display: flex; gap: .25em; padding: .3em .55em; border-radius: .8em; background: var(--well-bg); box-shadow: var(--well-sh); }
/* 轮到谁：名牌外圈呼吸发亮，挂一块「思考中」「轮到你」 */
.ddz-plate.on { z-index: 2; }
.ddz-plate.on::after { content: ''; position: absolute; inset: -.14em; z-index: -1; border-radius: inherit; pointer-events: none; opacity: 0; will-change: opacity;
  box-shadow: 0 0 0 .1em #040100, 0 0 0 .38em rgb(42 11 8 / .9), 0 0 0 .52em #f6dc94, 0 0 3.2em .8em rgb(255 214 120 / .55); animation: ddz-turn 1.6s ease-in-out infinite; }
@keyframes ddz-turn { 50% { opacity: 1; } }
.ddz-plate .tag { position: absolute; left: 50%; top: calc(100% + .5em); translate: -50% 0; display: flex; align-items: center; gap: .4em; white-space: nowrap; padding: .34em .85em .38em; border-radius: 1em;
  font: 700 1.1em/1 var(--sans); letter-spacing: .1em; color: var(--on-gold); background: var(--gold-metal); box-shadow: var(--gold-key-sh), 0 .3em .6em rgb(0 0 0 / .45); z-index: 3; animation: ddz-pop .36s cubic-bezier(.2,1.5,.4,1) both; }
.ddz-plate .tag::before { content: ''; position: absolute; left: 50%; bottom: 100%; translate: -50% 0; border: .4em solid transparent; border-bottom-color: #f0cd78; }
.ddz-plate .tag.me { color: #fff4e0; background: linear-gradient(180deg, #e2523d, #8e1b12); box-shadow: inset 0 .06em 0 rgb(255 220 200 / .5), 0 0 1.2em rgb(255 120 80 / .55); }
.ddz-plate .tag.me::before { border-bottom-color: #e2523d; }
.ddz-plate .tag.up { top: auto; bottom: calc(100% + .5em); }
.ddz-plate .tag.up::before { bottom: auto; top: 100%; border-bottom-color: transparent; border-top-color: #c8983c; }
.ddz-plate .tag.me.up::before { border-top-color: #8e1b12; }
.ddz-plate .tag i { width: .36em; height: .36em; border-radius: 50%; background: currentColor; animation: ddz-dot 1.2s ease-in-out infinite; }
.ddz-plate .tag i:nth-child(2) { animation-delay: .2s; } .ddz-plate .tag i:nth-child(3) { animation-delay: .4s; }
.ddz-plate .think i { width: .4em; height: .4em; border-radius: 50%; background: var(--gold-metal); animation: ddz-dot 1.2s ease-in-out infinite; }
.ddz-plate .think i:nth-child(2) { animation-delay: .2s; } .ddz-plate .think i:nth-child(3) { animation-delay: .4s; }

/* 气泡：一小张宣纸，书法字 */
.ddz-bub { padding: .9em 2em 1.1em; border-radius: 1.4em; font: 400 1em/1 var(--brush); color: #3a1a0c; white-space: nowrap; background: var(--paper-face);
  box-shadow: inset 0 .05em 0 rgb(255 255 255 / .85), 0 0 0 .05em rgb(120 84 30 / .55), 0 .1em 0 #b4955a, 0 .3em .45em rgb(0 0 0 / .5); }
.ddz-bub.r { translate: -100% 0; }
.ddz-bub > span { font-size: 2em; }
.ddz-bub.bid { color: #b4241a; }
.ddz-bub.stale { opacity: .5; }

/* 桌心那一手下面的牌型标签 */
.ddz-lbl { translate: -50% 0; display: flex; align-items: center; gap: .7em; font: 600 1em/1 var(--sans); color: rgb(242 227 194 / .78); white-space: nowrap; letter-spacing: .08em; }
.ddz-lbl > span { font-size: 1.15em; }
.ddz-lbl b { font: 400 1.7em/1 var(--brush); letter-spacing: .04em; color: #f6dc94; }
.ddz-lbl.boom b { color: #ff8a6a; }
.ddz-glow { translate: -50% -50%; border-radius: 50%; pointer-events: none; background: radial-gradient(closest-side, rgb(255 214 140 / .22), rgb(255 190 110 / .08) 60%, transparent); }

/* 炸弹：桌心炸开一团金光和一圈光芒 */
.ddz-burst { translate: -50% -50%; width: 36em; height: 36em; border-radius: 50%; pointer-events: none; mix-blend-mode: screen;
  background: radial-gradient(closest-side, rgb(255 250 220 / .95), rgb(255 214 120 / .7) 18%, rgb(240 140 60 / .35) 42%, transparent 70%); }
.ddz-rays { translate: -50% -50%; width: 44em; height: 44em; border-radius: 50%; pointer-events: none; mix-blend-mode: screen;
  background: repeating-conic-gradient(from 0deg, rgb(255 226 150 / .5) 0deg 4deg, transparent 4deg 18deg);
  -webkit-mask: radial-gradient(closest-side, transparent 18%, #000 30%, transparent 72%); mask: radial-gradient(closest-side, transparent 18%, #000 30%, transparent 72%); }

/* 结算卡：一张宣纸。标题（谁胜）、倍数算式、每家得失 */
.ddz-res { translate: -50% 0; z-index: 7; display: grid; gap: .75em; padding: 1em 1.5em 1.25em; border-radius: 1.2em; pointer-events: none; color: #3a1a0c;
  background: var(--paper-face);
  box-shadow: inset 0 .06em 0 rgb(255 255 255 / .85), inset 0 0 0 .06em rgb(120 84 30 / .45), 0 0 0 .3em rgb(42 11 8 / .55), 0 0 0 .38em rgb(226 186 96 / .55),
    0 .15em 0 .38em #6a4a14, 0 1.2em 2.4em rgb(0 0 0 / .6); }
.ddz-res .hd { display: flex; align-items: center; justify-content: center; gap: .5em; }
.ddz-res .hd b { font: 400 4.3em/1.05 var(--brush); color: #a3261a; letter-spacing: .04em; }
.ddz-res .hd em { font: 700 1.05em/1 var(--sans); font-style: normal; letter-spacing: .12em; color: #fff4e0; padding: .38em .55em; border-radius: .3em; rotate: -8deg;
  background: linear-gradient(180deg, #d23a26, #8e1b12); box-shadow: inset 0 0 0 .1em rgb(255 220 200 / .35), 0 .1em .2em rgb(0 0 0 / .3); }
.ddz-res .fx { display: flex; justify-content: center; align-items: baseline; flex-wrap: wrap; gap: .35em .5em; padding: .55em .8em; border-radius: .6em;
  font: 600 1.1em/1.3 var(--sans); color: #6a4a2a; background: rgb(120 84 30 / .08); box-shadow: inset 0 0 0 .06em rgb(120 84 30 / .28); white-space: nowrap; }
.ddz-res .fx b { font: 700 1.5em/1 var(--num); color: #3a1a0c; margin-left: .15em; }
.ddz-res .fx small { font-size: .8em; color: #8a6a4a; }
.ddz-res .fx i { font-style: normal; color: #a08060; font-weight: 400; }
.ddz-res .fx .tot b { color: #a3261a; }
.ddz-res .rows { display: grid; gap: .3em; }
.ddz-res .row { display: grid; grid-template-columns: 2em minmax(0, 1fr) auto 1.6em 4.2em; align-items: center; gap: .6em; padding: .4em .8em .4em .6em; border-radius: .6em; }
.ddz-res .row.win { background: linear-gradient(90deg, rgb(226 186 96 / .42), rgb(226 186 96 / .1)); box-shadow: inset .25em 0 0 #c8983c; }
.ddz-res .row .n { width: 1.8em; height: 1.8em; border-radius: 50%; display: grid; place-items: center; font: 700 1.05em/1 var(--num); color: #fbe8c8; background: #6a2a14; }
.ddz-res .row .nm { font: 700 1.3em/1.2 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ddz-res .row .rl { font: 700 .95em/1 var(--sans); letter-spacing: .1em; padding: .3em .5em; border-radius: .3em; color: #6a4a2a; background: rgb(120 84 30 / .12); }
.ddz-res .row .rl.ll { color: #fff4e0; background: #a3261a; }
.ddz-res .row .w { font: 400 1.6em/1 var(--brush); color: #a3261a; text-align: center; }
.ddz-res .row .sc { font: 700 1.75em/1 var(--num); text-align: right; font-variant-numeric: tabular-nums; color: #6a5a4a; }
.ddz-res .row.win .sc { color: #b4241a; }

/* 结算卡右上角的关闭键；收起后桌角留一枚「结算 ▸」小签，点开再看 */
.ddz-x { position: absolute; right: .55em; top: .55em; width: 2.1em; height: 2.1em; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer; pointer-events: auto;
  font: 700 1.05em/1 var(--sans); color: #6a4a2a; background: rgb(120 84 30 / .12); box-shadow: inset 0 0 0 .07em rgb(120 84 30 / .3); transition: background-color .15s, color .15s; }
.ddz-x:hover, .ddz-x:focus-visible { color: #a3261a; background: rgb(120 84 30 / .22); }
.ddz-pill { translate: -100% 0; display: flex; align-items: center; padding: .5em .95em .55em; border-radius: 1.2em; border: .12em solid transparent; cursor: pointer; z-index: 7; white-space: nowrap;
  font: 700 1em/1 var(--sans); letter-spacing: .1em; color: var(--on-gold); background: var(--gold-metal) padding-box, linear-gradient(180deg, #fbe8a6, #8e6824) border-box;
  box-shadow: var(--gold-key-sh), 0 .3em .6em rgb(0 0 0 / .45); animation: ddz-rise .3s ${EASE} both; }
.ddz-pill:hover { filter: brightness(1.06); }
.ddz-pill > span { font-size: 1.2em; }
.ddz.port .ddz-pill > span { font-size: 1.45em; }
/* 只能「要不起」时：按钮底边一道进度条走空后自动出手 */
.ddz-ctl .btn.auto { position: relative; overflow: hidden; }
.ddz-ctl .btn.auto::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: .22em; background: currentColor; opacity: .6; transform-origin: 0 50%; animation: ddz-auto var(--auto, 1200ms) linear var(--auto-delay, 0ms) both; }
@keyframes ddz-auto { from { transform: scaleX(1); } to { transform: scaleX(0); } }

/* 春天 / 反春横幅：结算卡之前横着打开一条朱红绸带 */
.ddz-ban { left: 50%; translate: -50% -50%; z-index: 8; pointer-events: none; display: grid; justify-items: center; gap: .2em; padding: .5em 7em .8em; white-space: nowrap;
  background:
    linear-gradient(90deg, transparent, #e6bd5c 18%, #f6dc94 50%, #e6bd5c 82%, transparent) top / 100% .16em no-repeat,
    linear-gradient(90deg, transparent, #e6bd5c 18%, #f6dc94 50%, #e6bd5c 82%, transparent) bottom / 100% .16em no-repeat,
    linear-gradient(90deg, transparent, rgb(142 27 18 / .97) 16%, rgb(190 46 30) 50%, rgb(142 27 18 / .97) 84%, transparent); }
.ddz-ban b { font: 400 7em/1.05 var(--brush); letter-spacing: .1em; background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 .1em;
  filter: drop-shadow(0 .03em 0 rgb(40 12 2 / .9)) drop-shadow(0 .06em .1em rgb(0 0 0 / .6)); }
.ddz-ban span { font: 600 1.3em/1.2 var(--sans); letter-spacing: .2em; color: #fbe8c8; }

/* 特效层：和桌面一样大、裁掉出界的部分（飞机从桌外飞进来，火箭冲出桌面） */
.ddz-fxc { inset: 1.7em 1.7em 2.3em; border-radius: 1.5em; overflow: hidden; pointer-events: none; z-index: 4; }
.ddz-fxc > * { position: absolute; }
.ddz-jet { left: 0; width: 24em; height: 5em; display: flex; align-items: center; }
.ddz-jet i { flex: 1; height: .45em; border-radius: .5em; background: linear-gradient(90deg, transparent, rgb(255 236 190 / .22) 35%, rgb(255 240 200 / .9)); }
.ddz-jet svg { width: 9em; height: 4.5em; flex: none; margin-left: -.6em; filter: drop-shadow(0 .3em .3em rgb(0 0 0 / .5)); }
.ddz-rkt { width: 3.6em; height: 12em; translate: -50% 0; }
.ddz-rkt svg { display: block; width: 3.6em; height: 7.6em; filter: drop-shadow(0 0 .6em rgb(255 190 110 / .7)); }
.ddz-rkt i { display: block; width: 1.6em; height: 4.4em; margin: -2.7em auto 0; border-radius: 50% 50% 50% 50% / 25% 25% 75% 75%;
  background: radial-gradient(60% 50% at 50% 15%, #fffbe8, #ffd56a 40%, rgb(255 110 50 / .8) 70%, transparent); transform-origin: 50% 0; animation: ddz-flame .12s ease-in-out infinite alternate; }
.ddz-sweep { overflow: hidden; border-radius: .5em; pointer-events: none; }
.ddz-sweep i { position: absolute; top: -10%; bottom: -10%; left: 0; width: 40%; background: linear-gradient(90deg, transparent, rgb(240 176 60 / .38) 25%, rgb(255 214 120 / .7) 50%, rgb(240 176 60 / .38) 75%, transparent); }

/* 底牌交接：桌心三张牌翻开，再飞给地主 */
.ddz-give { width: 5em; height: 7em; z-index: 6; }
.ddz-give > .ddz-c { left: 0; top: 0; }

/* 真人出手的软倒计时：一圈慢慢走空，≤10 秒琥珀、≤5 秒红；只提醒，不会自动出牌 */
.ddz-cd { position: relative; flex: none; width: 2.7em; height: 2.7em; display: grid; place-items: center; align-self: center; --cd: #f0cd78; }
.ddz-cd svg { position: absolute; inset: 0; width: 100%; height: 100%; rotate: -90deg; overflow: visible; }
.ddz-cd circle { stroke-width: 3.4; }
.ddz-cd .bg { fill: rgb(10 3 2 / .62); stroke: rgb(240 205 120 / .16); }
.ddz-cd .fg { fill: none; stroke: var(--cd); stroke-linecap: round; transition: stroke .3s; }
.ddz-cd b { position: relative; font: 700 1.2em/1 var(--num); color: var(--cd); font-variant-numeric: tabular-nums; transition: color .3s; }
.ddz-cd.amber { --cd: #f09a3c; }
.ddz-cd.red { --cd: #ff6a4a; animation: tmr-pulse 1s ease-in-out infinite; }

/* 操作按钮：用设计系统的漆木键，尺寸跟着桌面缩放 */
.ddz-ctl { translate: -50% 0; display: flex; gap: .9em; padding-bottom: .4em; animation: ddz-rise .35s ${EASE} both; }
.ddz-ctl .btn { font-size: 1.45em; padding: .3em 1.1em; min-width: 4.6em; --d: .18em; }
.ddz-ctl .btn.ghost { min-width: 3.6em; }
.ddz-plate .tmr { position: absolute; right: -.5em; top: -.85em; font: 700 1em/1 var(--num); padding: .25em .5em .28em; border-radius: .8em; color: #2a1206; z-index: 3;
  background: linear-gradient(180deg, #fff3c8, #f0cd78); box-shadow: 0 .1em 0 #8e6824, 0 .2em .4em rgb(0 0 0 / .4); font-variant-numeric: tabular-nums; }
.ddz-plate .tmr.warm { background: linear-gradient(180deg, #ffd9a0, #f09a3c); }
.ddz-plate .tmr.hot { color: #fff4e0; background: linear-gradient(180deg, #ff8a6a, #c42d1e); animation: tmr-pulse 1s ease-in-out infinite; }
@keyframes tmr-pulse { 50% { transform: scale(1.12); } }
/* 记牌器：牌匾下方两排（大王 … 10 / 9 … 3），左边竖写「别家剩」 */
.ddz-cnt { translate: -50% 0; display: grid; grid-template-columns: auto repeat(8, 2.2em); gap: .14em .1em; padding: .3em .45em .32em .3em; border-radius: .8em; white-space: nowrap; pointer-events: auto;
  background: rgb(10 3 2 / .58); box-shadow: inset 0 .06em .2em rgb(0 0 0 / .6), 0 .06em 0 rgb(255 224 176 / .12); }
.ddz-cnt small { grid-row: 1 / 3; writing-mode: vertical-rl; font: 600 .95em/1 var(--sans); letter-spacing: .12em; color: rgb(240 205 120 / .82); padding: 0 .25em; align-self: center; }
.ddz-cnt .c { display: grid; justify-items: center; padding: .14em 0 .18em; border-radius: .4em; }
.ddz-cnt .c i { font: 600 1em/1.1 var(--num); font-style: normal; color: rgb(242 227 194 / .78); }
.ddz-cnt .c.j i { font-family: var(--sans); font-size: .95em; }
.ddz-cnt .c b { font: 700 1.3em/1.05 var(--num); color: #f2e3c2; }
.ddz-cnt .c.z { opacity: .28; }
.ddz-cnt .c.f { background: rgb(240 205 120 / .16); box-shadow: inset 0 0 0 .06em rgb(240 205 120 / .45); }
.ddz-cnt .c.f b { color: #f6dc94; }

/* 按钮上方的说明：选中的牌型 / 为什么不能出 */
.ddz-tip { translate: -50% 0; white-space: nowrap; }
.ddz-tip > span { display: block; font: 700 1.25em/1 var(--sans); letter-spacing: .08em; color: #f6dc94; padding: .42em 1em; border-radius: 1em;
  background: rgb(10 3 2 / .62); box-shadow: inset 0 .05em .2em rgb(0 0 0 / .6), 0 .06em 0 rgb(255 224 176 / .14); pointer-events: none; transition: color .2s; }
.ddz-tip.bad > span { color: #ff9a80; }
.ddz-tip.muted > span { color: rgb(242 227 194 / .72); font-weight: 600; }
.ddz-tip.ok > span::before { content: '✓ '; color: #8fd6a4; }
/* 能点的手牌：触屏上横划连选，不让页面跟着滚 */
.ddz.can-move .ddz-c.pick { touch-action: none; }
.ddz-c.pick { transition: translate .16s cubic-bezier(.2,1.2,.4,1), box-shadow .16s; }

@keyframes ddz-fly { from { transform: translate(var(--fx), var(--fy)) rotate(var(--fr, 0deg)) scale(var(--fs, .72)); opacity: var(--fo, .25); } 60% { opacity: 1; } }
@keyframes ddz-deal { from { transform: translate(var(--fx), var(--fy)) scale(.6); opacity: 0; } }
@keyframes ddz-pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } }
@keyframes ddz-jump { 0% { transform: translateY(0) scale(1); } 35% { transform: translateY(-.35em) scale(1.35); color: #f6dc94; } 100% { transform: none; } }
@keyframes ddz-roll { 0% { transform: perspective(10em) rotateX(-90deg) translateY(-.2em); opacity: 0; } 55% { transform: perspective(10em) rotateX(18deg) scale(1.25); opacity: 1; } 100% { transform: none; } }
@keyframes ddz-burst { 0% { transform: scale(.1); opacity: 0; } 12% { opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
@keyframes ddz-rays { 0% { transform: scale(.3) rotate(0deg); opacity: 0; } 15% { opacity: 1; } 100% { transform: scale(1.25) rotate(40deg); opacity: 0; } }
@keyframes ddz-shake { 0%, 100% { transform: none; } 20% { transform: translate(.25em, -.15em); } 40% { transform: translate(-.2em, .15em); } 60% { transform: translate(.12em, .1em); } 80% { transform: translate(-.08em, -.06em); } }
@keyframes ddz-alarm { 50% { transform: scale(1.12); box-shadow: inset 0 .07em 0 rgb(255 220 200 / .6), 0 0 0 .08em #6a4a14, 0 0 0 .16em #e6bd5c, 0 0 1em .3em rgb(226 82 61 / .55); } }
@keyframes ddz-dot { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-.15em); } }
@keyframes ddz-rise { from { transform: translateY(1em) scale(.9); opacity: 0; } }
@keyframes ddz-give { 0% { transform: scale(.4); opacity: 0; animation-timing-function: cubic-bezier(.2,1.4,.4,1); } 16% { transform: none; opacity: 1; }
  68% { transform: none; animation-timing-function: cubic-bezier(.55,0,.35,1); } 94% { opacity: 1; } 100% { transform: translate(var(--tx), var(--ty)) scale(.5); opacity: 0; } }
@keyframes ddz-flipout { 0% { transform: perspective(14em) rotateY(0deg); } 99% { opacity: 1; } 100% { transform: perspective(14em) rotateY(90deg); opacity: 0; } }
@keyframes ddz-flipin { 0% { transform: perspective(14em) rotateY(-90deg); } 100% { transform: perspective(14em) rotateY(0deg); } }
@keyframes ddz-lift { 0% { opacity: 0; transform: translateY(-2.1em); } 10% { opacity: 1; transform: translateY(-2.1em); } 82% { transform: translateY(-2.1em); animation-timing-function: cubic-bezier(.5,0,.6,1.4); } 100% { transform: none; } }
@keyframes ddz-jet { 0% { transform: translate(var(--x0), 1.6em) rotate(-3deg); opacity: 0; } 8% { opacity: 1; } 88% { opacity: 1; } 100% { transform: translate(var(--x1), -2.2em) rotate(-3deg); opacity: 0; } }
@keyframes ddz-rkt { 0% { transform: translateY(2em) scale(.5); opacity: 0; } 12% { transform: none; opacity: 1; } 86% { opacity: 1; } 100% { transform: translateY(var(--up)); opacity: 0; } }
@keyframes ddz-flame { to { transform: scaleY(1.25) scaleX(.85); } }
@keyframes ddz-sweep { 0% { transform: translateX(-110%) skewX(-18deg); opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translateX(300%) skewX(-18deg); opacity: 0; } }
@keyframes ddz-ban { 0% { transform: scaleX(.08); opacity: 0; } 14% { transform: scaleX(1.03); opacity: 1; } 22% { transform: none; } 82% { transform: none; opacity: 1; } 100% { transform: translateY(-1.4em) scale(1.03); opacity: 0; } }
@keyframes ddz-cd { from { stroke-dashoffset: 0; } to { stroke-dashoffset: var(--len); } }

/* 触屏：结算卡的 ✕ 命中区扩到 44px 以上（外观不变） */
@media (pointer: coarse) { .ddz-x::before { content: ''; position: absolute; inset: -12px; } }
/* 少动效：特效本来就不画；倒计时圈按秒跳 */
@media (prefers-reduced-motion: reduce) {
  .ddz-cd .fg { animation: none !important; }
  .ddz-cd.red { animation: none; }
  .ddz-plate.on::after { animation: none; }
}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('ddz-style')) return;
  const st = document.createElement('style');
  st.id = 'ddz-style';
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
  node.style.animation = `${name} ${dur}ms ${ease} ${Math.round(delay - passed)}ms both`;
  return node;
}

/** 牌按大到小；同点数的第 k 张给第 k 个花色 */
const desc = (names) => names.slice().sort((a, b) => rankOf(b) - rankOf(a));
const ascId = (names) => names.slice().sort((a, b) => rankOf(a) - rankOf(b)).join(' ');
// 花色按点数错开（点数 × 3 再加上同点数的第几张，模 4）：一手顺子不会全是 ♠，同一张牌每次画都是同一个花色
function withSuits(names) {
  const seen = {};
  return names.map((n) => { const k = seen[n] || 0; seen[n] = k + 1; return { n, s: SUITS[(Math.max(0, rankOf(n)) * 3 + k) % 4] }; });
}

/** 一张牌；fs 是牌的 font-size（牌宽 = 5 × fs） */
function cardEl({ n, s }, x, y, fs, cls = '') {
  // left/top 按牌自己的 font-size 折算回桌面的 em
  const st = `left:${+(x / fs).toFixed(3)}em;top:${+(y / fs).toFixed(3)}em;font-size:${fs}em`;
  if (n === null) return el('div', { class: `ddz-c bk ${cls}`, style: st });
  if (isJoker(n)) {
    const big = n === '大王';
    return el('div', { class: `ddz-c jk${big ? ' r' : ''} ${cls}`, style: st },
      el('div', { class: 'ix' }, big ? '大王' : '小王'), el('div', { class: 'emb' }, '王'), el('div', { class: 'ix br' }, big ? '大王' : '小王'));
  }
  const red = s[1] === 'r';
  const face = n === 'J' || n === 'Q' || n === 'K';
  return el('div', { class: `ddz-c${red ? ' r' : ''} ${cls}`, style: st },
    el('div', { class: 'ix' }, el('b', {}, n), el('i', {}, s[0])),
    face ? faceEl(n, s[0]) : el('div', { class: `pip${n === 'A' ? ' a' : ''}` }, s[0]),
    el('div', { class: 'ix br' }, el('b', {}, n), el('i', {}, s[0])));
}

// 人头牌的冠饰：K 王冠、Q 后冠、J 羽帽（金面，描边用牌的红 / 黑）
const CROWN = {
  K: '<path d="M2.5 9.2 1.6 2.6l5 3.4L10 .9l3.4 5.1 5-3.4-.9 6.6z"/><path d="M3 9.2h14" stroke-width="1.3"/><circle cx="1.6" cy="2.4" r="1"/><circle cx="10" cy=".8" r="1"/><circle cx="18.4" cy="2.4" r="1"/>',
  Q: '<path d="M2.6 9.2C2.6 5.4 5.6 2.7 10 2.7s7.4 2.7 7.4 6.5z"/><path d="M3 9.2h14" stroke-width="1.3"/><path d="M6 6.2 10 4.3l4 1.9" fill="none"/><circle cx="10" cy="1.3" r="1.1"/>',
  J: '<path d="M2.4 9.2c0-2.8 3-4.9 7.6-4.9s7.6 2.1 7.6 4.9z"/><path d="M3 9.2h14" stroke-width="1.3"/><path d="M12.6 4.6C13.8 1.6 16.6.4 19.2 1.1c-1.3 1.1-2.8 2.4-4.4 4" fill="none"/>',
};
function faceEl(r, suit) {
  const f = el('div', { class: 'face' });
  f.innerHTML = `<svg viewBox="0 0 20 10" aria-hidden="true" fill="#e6bd5c" stroke="currentColor" stroke-width=".9" stroke-linejoin="round" stroke-linecap="round">${CROWN[r]}</svg>`;
  f.append(el('b', {}, r), el('i', {}, suit));
  return f;
}

/** 牌的几何：n 张牌在 maxW 宽度里摊开，返回每张左上角和旋转角；fan 为 true 时成扇形 */
function spread(n, { cx, y, cw, maxW }, { step = cw * 0.52, fan = true } = {}) {
  if (!n) return [];
  const st = n > 1 ? Math.min(step, (maxW - cw) / (n - 1)) : 0;
  const total = cw + st * (n - 1);
  const x0 = cx - total / 2;
  const mid = (n - 1) / 2;
  const deg = fan ? Math.min(1.7, 24 / Math.max(n, 1)) : 0;
  const sag = fan ? Math.min(1.1, 0.07 * n) * (cw / 4) : 0;
  return Array.from({ length: n }, (_, i) => {
    const t = mid ? (i - mid) / mid : 0;
    return { x: x0 + i * st, y: y + sag * t * t, rot: (i - mid) * deg };
  });
}

function button(label, { primary = false, off = false, onClick }) {
  const b = el('button', { type: 'button', class: `btn${primary ? ' primary' : ''}` }, label);
  b.disabled = !!off;
  b.addEventListener('click', (e) => { e.stopPropagation(); if (!off) onClick(); });
  return b;
}

/** 倍数写成中文：2 → 二，16 → 十六，128 → 一百二十八 */
function cnNum(n) {
  const D = '〇一二三四五六七八九';
  if (n < 10) return D[n];
  if (n < 20) return `十${n % 10 ? D[n % 10] : ''}`;
  if (n < 100) return `${D[Math.floor(n / 10)]}十${n % 10 ? D[n % 10] : ''}`;
  return String(n);
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
/** 真人出手的软倒计时：一圈 30 秒走空，按秒更新数字和颜色（≤10 秒琥珀、≤5 秒红）；到 0 只是停在 0，不会替人出牌 */
const CD_LEN = +(2 * Math.PI * 15).toFixed(2);
function countdown(t0) {
  const n = el('div', { class: 'ddz-cd', 'data-t0': String(t0), title: `建议 ${CD_SECS} 秒内出手（只是提醒，不会自动出牌）`, role: 'timer' });
  n.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15"/><circle class="fg" cx="18" cy="18" r="15" stroke-dasharray="${CD_LEN}"/></svg><b></b>`;
  // 圈用 CSS 动画连续走（负延迟接上已经过去的时间，重画不跳）；少动效时由每秒的 paint 直接设位置
  const ms = Date.now() - t0;
  const fg = n.querySelector('.fg');
  fg.style.setProperty('--len', String(CD_LEN));
  fg.style.animation = `ddz-cd ${CD_SECS}s linear ${-Math.min(ms, CD_SECS * 1000)}ms both`;
  paintCountdown(n);
  return n;
}
function paintCountdown(n) {
  const ms = Date.now() - Number(n.dataset.t0);
  const left = Math.max(0, Math.ceil(CD_SECS - ms / 1000));
  n.querySelector('b').textContent = String(left);
  n.querySelector('.fg').style.strokeDashoffset = String(+(CD_LEN * Math.min(1, ms / (CD_SECS * 1000))).toFixed(2));
  n.classList.toggle('amber', left <= 10 && left > 5);
  n.classList.toggle('red', left <= 5);
}
let timerTick = null;
function startTimerTick(root) {
  clearInterval(timerTick);
  timerTick = setInterval(() => {
    const ns = root.isConnected ? root.querySelectorAll('.tmr, .ddz-cd') : [];
    if (!ns.length) { clearInterval(timerTick); timerTick = null; return; }
    ns.forEach((n) => (n.classList.contains('tmr') ? paintTimer(n) : paintCountdown(n)));
  }, 1000);
}

/** 底牌翻面：先是牌背转到 90°，换成牌面再转回来。返回叠在一起的 [牌背, 牌面]（牌的 font-size 为 1em，套在外层里定大小） */
function flipPair(card, t0, delay) {
  const back = cardEl({ n: null }, 0, 0, 1);
  const face = cardEl(card, 0, 0, 1);
  play(back, 'ddz-flipout', 200, t0, delay, 'ease-in');
  play(face, 'ddz-flipin', 200, t0, delay + 200, 'ease-out');
  return [back, face];
}
const flipDone = (t0, delay) => t0 === null || t0 === undefined || now() - t0 > delay + 420;

/** 地主手里新到的三张底牌在手牌（从大到小）里的位置 */
function bottomIdx(d, bottom) {
  const used = new Set();
  for (const n of bottom || []) {
    const k = d.findIndex((x, j) => x === n && !used.has(j));
    if (k >= 0) used.add(k);
  }
  return used;
}

// 特效用的小图：俯视的飞机、火箭
const JET_SVG = '<svg viewBox="0 0 64 32" aria-hidden="true"><path fill="#f6dc94" stroke="#6a4a14" stroke-width="1.2" stroke-linejoin="round" d="M4 14.2H15L9 6.5H13.5L21 14.2H30L23 2H29.5L42 14.2H54C60 14.2 63 15.2 63 16S60 17.8 54 17.8H42L29.5 30H23L30 17.8H21L13.5 25.5H9L15 17.8H4Z"/><path fill="#c8983c" d="M44 15h12c2 0 3 .5 3 1s-1 1-3 1H44z"/></svg>';
const ROCKET_SVG = '<svg viewBox="0 0 36 76" aria-hidden="true"><path fill="#fbf3df" stroke="#6a4a14" stroke-width="1.4" d="M18 2C26 10 28 24 27 44H9C8 24 10 10 18 2Z"/><path fill="#d23a26" stroke="#6a4a14" stroke-width="1.4" d="M18 2C22.5 6.5 25 12 26 18H10C11 12 13.5 6.5 18 2Z"/><circle cx="18" cy="27" r="4.2" fill="#3559b5" stroke="#e6bd5c" stroke-width="1.6"/><path fill="#d23a26" stroke="#6a4a14" stroke-width="1.4" d="M9 34L2 50L9 47ZM27 34L34 50L27 47ZM14 44H22L20.5 50H15.5Z"/></svg>';
const playKey = (seat, t) => (t && t.cards ? `${seat}:${t.cards.join(',')}` : '');
/**
 * 画的是不是「正在进行的最新局面」：对局页传 opts.live 时以它为准；
 * 否则复盘回放（opts.replay）不是；对局页的 opts.clock 只在实时对局里非空；缩略图等不传 clock 的地方按实时算
 */
const isLive = (opts) => ('live' in opts ? !!opts.live
  : opts.replay ? false
    : opts.clock && typeof opts.clock === 'object' ? Object.keys(opts.clock).length > 0 || !!opts.movable
      : true);

export default {
  // 对局页用「牌桌 + 右侧聚光框 + 本局记录」版式：牌桌上已有每家的名牌、剩牌和出牌，两侧不再放选手卡
  hud: true,
  /** 聚光框里「轮到你」下面的一句说明：叫分时讲叫分，出牌时讲怎么选牌 */
  turnTip(view) {
    if (view?.phase === 'bid') return '看手牌决定叫几分：叫得越高输赢越大；不想当地主就点「不叫」。';
    return '轮到你了：点选手牌，或按住横着划过一串牌连选，再点「出牌」。拿不准就点「提示」，会依次给出能出的牌。';
  },

  /** 聚光框头上的一行：地主/农民、剩几张 */
  seatLine(view, seat) {
    if (!view?.counts) return '';
    const role = view.landlord ? (view.landlord === seat ? '地主' : '农民') : view.phase === 'bid' ? '叫分中' : '';
    return [role, `剩 ${view.counts[seat]} 张`].filter(Boolean).join(' · ');
  },

  /** 本局记录：叫分一组，之后每一轮一组 */
  handLog(view) {
    if (!view?.seats) return null;
    const groups = [];
    if (view.bids?.length) groups.push({ street: 'bid', name: view.deals ? `叫分 · 第 ${view.deals + 1} 次发牌` : '叫分', board: [], items: view.bids.map((b) => ({ seat: b.seat, text: b.bid ? `叫 ${b.bid} 分` : '不叫' })) });
    for (const p of view.plays || []) {
      let g = groups[groups.length - 1];
      if (!g || g.street !== `t${p.trick}`) { g = { street: `t${p.trick}`, name: `第 ${cnNum(p.trick)} 轮`, board: [], items: [] }; groups.push(g); }
      g.items.push({ seat: p.seat, text: p.cards ? `${p.type} ${p.cards.join(' ')}` : '不出' });
    }
    const r = view.result;
    return {
      label: '本局记录', title: '本局', sub: view.landlord ? `底分 ${view.bid} · ×${view.multiplier}` : '叫地主',
      groups, count: (view.bids?.length || 0) + (view.plays?.length || 0), last: null,
      result: r ? `${r.landlordWins ? '地主' : '农民'}胜 · ×${r.multiplier}${r.spring ? ' · 春天' : r.anti ? ' · 反春' : ''} · 每家 ${r.score} 分` : null,
    };
  },

  /** 回放时这一步之后多停多久（毫秒）：画面特效要演完（底牌交接、飞机、王炸、炸弹、春天横幅），不随倍速缩短 */
  pauseAfter(prev, view) {
    const sum = (v) => (v && v.seats ? {
      landlord: !!v.landlord, plays: v.plays?.length || 0, last: TYPE_KEY[v.plays?.at(-1)?.type] || null,
      over: !!v.result, banner: !!(v.result?.spring || v.result?.anti),
    } : null);
    return fxDuration(sum(prev), sum(view));
  },

  // 手机竖屏用竖版桌面，其余横版
  get aspect() { return typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? [10, 14] : [16, 10]; },
  seatColor: (seat, i) => COLORS[(i ?? SEATS.indexOf(seat)) % COLORS.length],

  createStage({ onAction }) {
    injectStyle();
    const root = el('div', { class: 'ddz board-html', role: 'group', 'aria-label': '斗地主牌桌' });
    const box = el('div', { class: 'ddz-box' });
    root.append(box);

    let sel = new Set();
    let handKey = '';
    let last = null; // { view, opts }
    let layoutName = 'land';
    // 动画的开始时刻与上一画面的记录
    const fx = {
      prev: null, lead: { key: '', t0: null }, boom: null, plane: null, rocket: null, sweep: null, mult: null, flip: null, over: null,
      counts: {}, cnt: {}, bubbles: {}, bub: {}, front: {}, turn: { key: '', t0: 0 },
    };

    const redraw = () => last && draw(last.view, last.opts);
    // 桌布、栏杆、水印：不随局面变，只建一次（每步重建整张桌子会重排、重绘大块渐变）
    const felt = [el('div', { class: 'ddz-rail' }), el('div', { class: 'ddz-top' }), el('div', { class: 'ddz-wm' }, '斗')];
    let resHidden = null; // 收起的是哪一张结算卡：收起后桌角留「结算 ▸」小签
    // Esc 收起结算卡（牌桌在页面上、没有弹窗挡着时）
    const onEsc = (e) => {
      if (!root.isConnected) { document.removeEventListener('keydown', onEsc); return; }
      if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const x = box.querySelector('.ddz-x');
      if (!x || !root.getClientRects().length || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      e.preventDefault();
      x.click();
    };
    document.addEventListener('keydown', onEsc);
    // 只能「要不起」时自动出手：{ key: 这一步, timer }
    let autoPass = { key: '', timer: null };
    const AUTO_PASS_MS = 1200;
    let hintIdx = -1; // 「提示」给到第几个
    let hintKey = '';

    // 选牌：按下一张牌开始，横着划过的牌都跟第一张一样（选上或取消）；点空白处清空
    let drag = null;
    const setSel = (i, on, node) => { if (on) sel.add(i); else sel.delete(i); node?.classList.toggle('sel', on); hintIdx = -1; };
    box.addEventListener('pointerdown', (e) => {
      const c = e.target.closest?.('.ddz-c.pick');
      if (!c) { if (sel.size && !e.target.closest?.('button')) { sel = new Set(); hintIdx = -1; redraw(); } return; }
      e.preventDefault();
      const i = Number(c.dataset.i);
      drag = { on: !sel.has(i), seen: new Set([i]), wasEmpty: sel.size === 0 };
      setSel(i, drag.on, c);
      try { box.setPointerCapture(e.pointerId); } catch { /* 旧浏览器 */ }
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const c = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.ddz-c.pick');
      if (!c) return;
      const i = Number(c.dataset.i);
      if (drag.seen.has(i)) return;
      drag.seen.add(i);
      setSel(i, drag.on, c);
    });
    const endDrag = () => {
      if (!drag) return;
      const d0 = drag;
      drag = null;
      if (d0.wasEmpty && d0.on && d0.seen.size === 1) autoComplete([...d0.seen][0]);
      redraw();
    };
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);
    box.addEventListener('lostpointercapture', endDrag);

    /**
     * 能出的牌，按「提示」的顺序（参照成熟斗地主的提示算法）：
     * 炸弹、王炸放最后；尽量不拆对子、三张（拆开的点数越少越靠前）；再按主牌点数从小到大——
     * 主牌是这一手里张数最多的点数（三带一「3 7 7 7」的主牌是 7，不是带的 3）。
     * 自己领出时先按牌型：单 → 对 → 连对 → 顺子 → 飞机 → 三张、三带 → 四带 → 炸弹 → 王炸。
     */
    const LEAD_ORDER = ['单张', '对子', '连对', '顺子', '飞机', '飞机带单', '飞机带对', '三张', '三带一', '三带二', '四带二', '四带两对', '炸弹', '王炸'];
    function hintList(actions, d = [], leading = false) {
      const inHand = {};
      for (const n of d) inHand[n] = (inHand[n] || 0) + 1;
      return (actions || []).filter((a) => a.id !== '不出').map((a) => {
        const type = String(a.label || '').split(' ')[0];
        const names = a.id.split(' ');
        const cnt = {};
        for (const n of names) cnt[n] = (cnt[n] || 0) + 1;
        const top = Math.max(...Object.values(cnt));
        const main = Math.min(...Object.keys(cnt).filter((n) => cnt[n] === top).map(rankOf));
        const breaks = Object.keys(cnt).filter((n) => (inHand[n] || 0) > cnt[n]).length;
        const bomb = type === '王炸' ? 2 : type === '炸弹' ? 1 : 0;
        const order = leading ? LEAD_ORDER.indexOf(type) : 0;
        return { a, main, breaks, bomb, order, n: names.length };
      }).sort((x, y) => (x.bomb - y.bomb) || (x.order - y.order) || (x.breaks - y.breaks) || (x.main - y.main) || (x.n - y.n)).map((x) => x.a);
    }
    let cur = null; // 当前决策点：{ list, d, leading }，给「点一下补全」用

    /**
     * 点一下补全（只在一张都没选时）：只在跟牌（要压过上家）时，选上包含这张的最省牌的一手（提示顺序里的第一手）；
     * 领出时点一下就只选这一张——炸弹、顺子用拖选或「提示」，不替人拆牌。
     */
    function autoComplete(i) {
      if (!cur || cur.leading) return;
      const name = cur.d[i];
      const pick = cur.list.find((a) => a.id.split(' ').includes(name));
      if (!pick) return;
      const ids = pickIds(pick.id, cur.d);
      // 被点的那张一定要在里面（同点数有几张时，换成被点的那张）
      if (!ids.has(i)) { const same = [...ids].find((k) => cur.d[k] === name); if (same !== undefined) { ids.delete(same); ids.add(i); } }
      sel = ids;
    }
    /** 把一手牌（id 是从小到大的牌名）对应到手牌里的位置 */
    function pickIds(id, d) {
      const used = new Set();
      for (const n of id.split(' ')) {
        const k = d.findIndex((x, j) => x === n && !used.has(j));
        if (k >= 0) used.add(k);
      }
      return used;
    }

    // 容器变成竖长时换竖版
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(([e]) => {
        const { width, height } = e.contentRect;
        if (!width || !height) return;
        const name = height > width * 1.05 ? 'port' : 'land';
        if (name !== layoutName) { layoutName = name; root.classList.toggle('port', name === 'port'); redraw(); }
      }).observe(root);
    }

    /** 记录变化、决定这一帧要不要起动画 */
    function track(view, animate) {
      const p = fx.prev;
      const t = now();
      const live = animate !== false && p !== null;
      // 桌心那一手
      const lead = leadOf(view);
      const key = lead ? `${view.trickNo}|${playKey(lead.seat, lead.t)}` : '';
      if (key !== fx.lead.key) {
        const fresh = live && lead && !lead.stale;
        const type = fresh ? lead.t.type || '' : '';
        fx.lead = { key, t0: fresh ? t : null };
        fx.boom = /炸弹|王炸/.test(type) ? t : null;
        fx.rocket = type === '王炸' ? t : null;
        fx.plane = /^飞机/.test(type) ? t : null;
        fx.sweep = type === '顺子' || type === '连对' ? t : null;
      }
      if (p && (view.multiplier || 1) !== (p.multiplier || 1) && live) fx.mult = t;
      if (p && !p.landlord && view.landlord && live) fx.flip = t;
      if (!view.landlord) fx.flip = null;
      if (p && !p.result && view.result && live) fx.over = t;
      if (!view.result) fx.over = null;
      // 各家面前那一手：被压过时从桌心退回来
      const fr = frontsOf(view, lead);
      for (const s of SEATS) {
        const k = fr[s] ? `${view.trickNo}|${playKey(s, fr[s])}` : '';
        if (k !== (fx.front[s]?.key || '')) fx.front[s] = { key: k, t0: live && k ? t : null };
      }
      for (const s of SEATS) {
        const c = view.counts?.[s];
        if (p && p.counts?.[s] !== c && live) fx.cnt[s] = t;
        const b = view.table?.[s];
        const bk = b ? (b.cards ? '' : `${view.trickNo}|${b.text || (b.pass ? '不出' : '')}|${view.bids?.length || 0}`) : '';
        if (bk !== (fx.bubbles[s] || '')) { fx.bubbles[s] = bk; fx.bub[s] = live && bk && !view.stale ? t : null; }
      }
      fx.prev = view;
    }

    /** 桌心那一手：本轮最近出的牌；新一轮还没人出时是上一轮的最后一手（淡显） */
    function leadOf(view) {
      if (view.phase === 'bid') return null;
      const table = view.table || {};
      if (!view.stale && view.lead) return { seat: view.lead.seat, t: { cards: view.lead.cards, type: view.lead.type }, stale: false };
      // 上一轮（或终局时最后一轮）：赢下这一轮的人就是下一轮的领出人；终局时是出完牌的赢家
      const who = view.result ? view.result.winner : view.turn;
      if (who && table[who]?.cards) return { seat: who, t: table[who], stale: !!view.stale };
      const any = SEATS.find((s) => table[s]?.cards);
      return any ? { seat: any, t: table[any], stale: !!view.stale } : null;
    }
    /** 各家面前那一手：本轮自己最近出的牌。桌心那一手的主人不重复摆；轮到谁再出，谁面前的收走；新一轮开始全部收走 */
    function frontsOf(view, lead) {
      const out = {};
      if (view.phase === 'bid' || view.stale) return out;
      for (const s of SEATS) {
        const t = view.table?.[s];
        if (!t?.cards || view.turn === s) continue;
        if (lead && !lead.stale && lead.seat === s) continue;
        out[s] = t;
      }
      return out;
    }

    function plate(view, seat, pos, L, { me = null, bottom = false, t0 = null, live = true } = {}) {
      const role = view.roles?.[seat];
      const count = view.counts?.[seat] ?? 0;
      // 复盘、回放看的是过去的局面：不挂「思考中」、名牌不发亮
      const turn = live && !view.result && view.turn === seat;
      const won = view.result && (view.result.landlordWins ? role === '地主' : role === '农民');
      const idx = SEATS.indexOf(seat);
      const name = view.seatNames?.[seat] || seat;
      const cnt = el('b', {}, String(count));
      play(cnt, 'ddz-jump', 520, fx.cnt[seat], 0, 'ease-out');
      const warn = view.phase === 'play' && count > 0 && count <= 2;
      const roleEl = role === '地主' ? el('span', { class: 'seal', title: '地主', 'aria-label': '地主' }, '地') : null;
      const bid = view.bids?.filter((b) => b.seat === seat).at(-1);
      const status = role || (view.phase === 'bid' ? (bid ? (bid.bid ? `叫 ${bid.bid} 分` : '不叫') : view.first === seat ? '首叫' : '等待叫分') : '');
      return el('div', { class: `ddz-plate${turn ? ' on' : ''}${won ? ' win' : ''}`, style: `left:${pos.plate[0]}em;top:${pos.plate[1]}em;width:${L.plateW}em` },
        el('span', { class: 'coin' }, String(idx + 1), roleEl),
        el('div', { class: 'who' }, el('b', { title: name }, name), el('span', {}, status)),
        el('div', { class: `cnt${warn ? ' warn' : ''}` }, cnt, el('small', {}, '张')),
        warn ? el('div', { class: 'alarm' }, count === 1 ? '报单' : '报双') : null,
        turn && t0 ? thinkTimer(t0) : null,
        turn ? el('div', { class: `tag${me === seat ? ' me' : ''}${bottom ? ' up' : ''}` }, me === seat ? '轮到你' : view.phase === 'bid' ? '叫分中' : '思考中', el('i'), el('i'), el('i')) : null);
    }

    /** 一家的手牌：明牌成扇形，暗牌是牌背 */
    function hand(view, seat, pos, { mine = false, pick = false, d = null, lift = null } = {}) {
      const names = view.hands?.[seat];
      const out = [];
      const count = view.counts?.[seat] ?? 0;
      const h = pos.hand;
      const fs = h.cw / 5;
      const cards = names ? withSuits(d || desc(names)) : Array.from({ length: count }, () => ({ n: null }));
      const geo = spread(cards.length, h, { step: names ? h.cw * (mine ? 0.5 : 0.42) : h.cw * 0.22 });
      cards.forEach((c, i) => {
        const g = geo[i];
        const on = mine && sel.has(i);
        const node = cardEl(c, g.x, g.y, fs, `${pick ? 'pick' : ''}${on ? ' sel' : ''}`);
        if (g.rot) node.style.rotate = `${g.rot}deg`;
        node.style.transformOrigin = '50% 120%';
        if (pick) node.dataset.i = String(i);
        // 定地主：新到的三张先藏着（底牌还在桌心飞），飞到后抬起约 0.3 张牌高，停一会儿再落下
        if (lift?.has(i)) play(node, 'ddz-lift', FX.lift + 200, fx.flip, FX.handover - 150, 'ease-out');
        out.push(node);
      });
      return out;
    }

    /** 桌上的一手牌：按牌型横排；animate 时从出牌人手里飞出来 */
    /**
     * 桌上的一手牌：按给的顺序横排（主体在前、带的牌在后）。from 为起飞点（从出牌人手里飞出来），
     * 或 fromPts 为每张牌的起点（被压过的牌从桌心缩回出牌人面前），起始放大 fromScale 倍
     */
    function playRow(t, spot, { cls = '', from = null, fromPts = null, fromScale = null, step = 0.56, dur = FX.fly, t0 = null } = {}) {
      const cards = withSuits(t.cards);
      const geo = spread(cards.length, spot, { step: spot.cw * step, fan: false });
      const fs = spot.cw / 5;
      const g = el('div', { class: `ddz-play ${cls}`, style: 'inset:0' });
      cards.forEach((c, i) => {
        const node = cardEl(c, geo[i].x, geo[i].y, fs);
        const p0 = fromPts ? fromPts[i] : from;
        if (p0 && t0 !== null && t0 !== undefined) {
          node.style.setProperty('--fx', `${(p0[0] - geo[i].x - spot.cw / 2) / fs}em`);
          node.style.setProperty('--fy', `${(p0[1] - geo[i].y - spot.cw * 0.7) / fs}em`);
          node.style.setProperty('--fr', fromPts ? '0deg' : `${(i - (cards.length - 1) / 2) * -6}deg`);
          if (fromScale) { node.style.setProperty('--fs', String(+fromScale.toFixed(3))); node.style.setProperty('--fo', '1'); }
          play(node, 'ddz-fly', dur, t0, i * (fromPts ? 10 : 22));
        }
        g.append(node);
      });
      return g;
    }

    /** 一行牌的几何：n 张、牌宽 cw、步长 step，在 spot 里按 al 对齐（'l' 左边齐 x、'r' 右边齐 x） */
    function frontSpot(n, f, L) {
      const cw = L.frontCw;
      const maxW = f.maxW || L.frontMaxW;
      const st = n > 1 ? Math.min(cw * 0.56, (maxW - cw) / (n - 1)) : 0;
      const total = cw + st * (n - 1);
      return { cx: f.al === 'l' ? f.x + total / 2 : f.al === 'r' ? f.x - total / 2 : f.x, y: f.y, cw, maxW };
    }

    /** 记牌器：每个点数还剩几张没出（玩家视角再扣掉自己手里的）；剩 4 张的标金，可能有炸弹 */
    function counter(view, viewer, L) {
      const left = Object.fromEntries(RANKS.map((r) => [r, r === '小王' || r === '大王' ? 1 : 4]));
      for (const p of view.plays || []) for (const n of p.cards || []) left[n]--;
      if (viewer && view.hands?.[viewer]) for (const n of view.hands[viewer]) left[n]--;
      const cols = RANKS.slice().reverse().map((r) => {
        const v = Math.max(0, left[r]);
        const lab = r === '大王' ? '大' : r === '小王' ? '小' : r;
        return el('span', { class: `c${v === 0 ? ' z' : v === 4 ? ' f' : ''}${r === '大王' || r === '小王' ? ' j' : ''}` }, el('i', {}, lab), el('b', {}, String(v)));
      });
      return el('div', { class: 'ddz-cnt', title: viewer ? '记牌器：除了你手里的，别家还有几张' : '记牌器：每个点数还有几张没出', style: `left:${L.counter.cx}em;top:${L.counter.y}em` },
        el('small', {}, viewer ? '别家剩' : '未出'), ...cols);
    }

    function plaque(view, L) {
      const known = !!view.landlord && Array.isArray(view.bottom);
      const bot = el('div', { class: 'bot' });
      for (let i = 0; i < 3; i++) {
        const nm = known ? view.bottom[i] : null;
        const fs = layoutName === 'port' ? 0.5 : 0.56;
        const delay = 350 + i * 120; // 和桌心那三张同时翻
        if (nm && !flipDone(fx.flip, delay) && !reduced()) bot.append(el('span', { class: 'ddz-fw', style: `font-size:${fs}em` }, ...flipPair(withSuits(view.bottom)[i], fx.flip, delay)));
        else bot.append(cardEl(nm ? withSuits(view.bottom)[i] : { n: null }, 0, 0, fs));
      }
      // 倍数在牌匾、本局记录、结算卡上一律写「×4」
      const mult = el('span', { class: `mult${(view.multiplier || 1) > 1 ? ' hot' : ''}` }, `×${view.multiplier || 1}`);
      play(mult, 'ddz-roll', 700, fx.mult, 0, 'cubic-bezier(.2,1.4,.4,1)');
      return el('div', { class: 'ddz-plq', style: `left:${L.plaque.cx}em;top:${L.plaque.y}em` },
        el('div', { class: 'kv' }, el('small', {}, view.deals ? `重发 ${view.deals}` : '底分'), el('b', {}, view.bid ? String(view.bid) : '—')),
        el('div', { class: 'kv' }, el('small', {}, '倍数'), mult),
        el('i', { class: 'sep' }),
        el('div', { class: 'kv' }, el('small', {}, '底牌'), bot));
    }

    /** 结算卡：谁胜、倍数算式（叫分 × 2^炸弹数 × 春天 = 每家分数）、每家得失（地主一家顶两家） */
    function settleCard(view, r, L) {
      const bid = r.bid ?? view.bid;
      const bombs = r.bombs ?? view.bombs ?? 0;
      const per = r.score;
      const ll = view.landlord;
      const scores = r.scores || Object.fromEntries(SEATS.map((s) => [s, (s === ll ? 2 : -1) * (r.landlordWins ? 1 : -1) * per]));
      const term = (label, v, note) => el('span', {}, label, el('b', {}, v), note ? el('small', {}, note) : null);
      const fxRow = el('div', { class: 'fx' },
        term('叫分', String(bid)),
        el('i', {}, '×'), term('炸弹', `×${2 ** bombs}`, bombs ? `（${bombs} 个）` : '（无）'),
        r.spring || r.anti ? [el('i', {}, '×'), term(r.spring ? '春天' : '反春', '×2')] : null,
        el('i', {}, '='), el('span', { class: 'tot' }, '每家', el('b', {}, String(per)), '分'));
      const order = ll ? [ll, ...SEATS.filter((s) => s !== ll)] : SEATS;
      const rows = order.map((s) => {
        const won = (s === ll) === r.landlordWins;
        const v = scores[s] || 0;
        const name = view.seatNames?.[s] || s;
        return el('div', { class: `row${won ? ' win' : ''}` },
          el('span', { class: 'n' }, String(SEATS.indexOf(s) + 1)),
          el('span', { class: 'nm', title: name }, name),
          el('span', { class: `rl${s === ll ? ' ll' : ''}` }, s === ll ? '地主 ×2' : '农民'),
          el('span', { class: 'w' }, won ? '胜' : ''),
          el('span', { class: 'sc' }, v > 0 ? `+${v}` : String(v)));
      });
      return el('div', { class: 'ddz-res', style: `left:${L.res.cx}em;top:${L.res.y}em;width:${L.res.w}em`, role: 'status' },
        el('div', { class: 'hd' }, el('b', {}, r.landlordWins ? '地主胜' : '农民胜'), r.spring ? el('em', {}, '春天') : r.anti ? el('em', {}, '反春') : null),
        fxRow, el('div', { class: 'rows' }, ...rows));
    }

    function draw(view, opts) {
      const { movable = null, actions = null } = opts;
      const L = LAYOUTS[layoutName];
      const viewer = view.viewer && SEATS.includes(view.viewer) ? view.viewer : null;
      // 下方的座位：玩家本人；观众视角是地主（还没定地主时是 1 号位）
      const me = viewer || view.landlord || 'p1';
      const i = SEATS.indexOf(me);
      const right = SEATS[(i + 1) % 3]; // 下家
      const leftS = SEATS[(i + 2) % 3]; // 上家
      const spots = { [leftS]: L.left, [right]: L.right, [me]: L.bottom };
      const canAct = !!viewer && movable === me && Array.isArray(actions) && actions.length > 0;
      const ids = new Set((actions || []).map((a) => a.id));
      const liveNow = isLive(opts);
      let autoKeep = false; // 这一帧还是「只能要不起」的那一步
      root.classList.toggle('can-move', canAct);

      const kids = [];
      const calm = reduced();
      const T = now();
      const within = (t0, dur) => !calm && t0 !== null && t0 !== undefined && T - t0 < dur;

      // 桌心：本轮最近的一手、牌型标签、炸弹金光；被压过的牌退到出牌人面前
      const lead = leadOf(view);
      const c = L.lead;
      const leadH = c.cw * 1.4;
      kids.push(el('div', { class: 'ddz-glow', style: `left:${c.cx}em;top:${c.y + leadH / 2}em;width:${c.maxW * 0.9}em;height:${leadH * 2.6}em` }));
      const center = []; // 桌心的牌最后画，飞行中的牌压在手牌上面
      const fxc = el('div', { class: 'ddz-fxc' }); // 飞机、火箭：裁在桌面里
      const ox = 1.7, oy = 1.7; // 特效层相对桌面的偏移（同 .ddz-fxc 的 inset）
      const leadGeo = lead ? spread(lead.t.cards.length, c, { step: c.cw * 0.56, fan: false }) : [];
      if (lead) {
        const boom = /炸弹|王炸/.test(lead.t.type || '');
        const row = playRow(lead.t, c, { cls: lead.stale ? 'stale' : '', from: spots[lead.seat]?.from, t0: fx.lead.t0 });
        if (boom && fx.boom !== null) play(row, 'ddz-shake', 420, fx.boom, 380, 'linear');
        center.push(row);
        const who = view.roles?.[lead.seat] || '';
        kids.push(el('div', { class: `ddz-lbl${boom ? ' boom' : ''}`, style: `left:${c.cx}em;top:${c.y + leadH + 0.9}em` },
          el('span', {}, `${view.seatNames?.[lead.seat] || lead.seat}${who ? ` · ${who}` : ''}`), el('b', {}, lead.t.type || ''), lead.stale ? el('span', {}, '上一轮') : null));
        if (boom && fx.boom !== null && T - fx.boom < 1500) {
          const cy = c.y + leadH / 2;
          kids.push(play(el('div', { class: 'ddz-burst', style: `left:${c.cx}em;top:${cy}em` }), 'ddz-burst', 1100, fx.boom, 300, 'ease-out'));
          kids.push(play(el('div', { class: 'ddz-rays', style: `left:${c.cx}em;top:${cy}em` }), 'ddz-rays', 1300, fx.boom, 300, 'ease-out'));
        }
        // 顺子、连对：牌落定后一道光扫过
        if (within(fx.sweep, FX.fly + FX.sweep)) {
          const x0 = leadGeo[0].x, w = leadGeo.at(-1).x + c.cw - x0;
          const band = play(el('i'), 'ddz-sweep', FX.sweep, fx.sweep, FX.fly - 80, 'ease-in-out');
          center.push(el('div', { class: 'ddz-sweep', style: `left:${x0}em;top:${c.y}em;width:${w}em;height:${leadH}em` }, band));
        }
        // 飞机：一架飞机拖着尾迹横穿牌桌
        if (within(fx.plane, FX.fly + FX.plane)) {
          const j = el('div', { class: 'ddz-jet', style: `top:${c.y - 1.6 - oy}em` }, el('i'));
          j.insertAdjacentHTML('beforeend', JET_SVG);
          j.style.setProperty('--x0', '-24em');
          j.style.setProperty('--x1', `${L.w - 2 * ox + 2}em`);
          fxc.append(play(j, 'ddz-jet', FX.plane, fx.plane, FX.fly - 100, 'cubic-bezier(.35,.15,.65,.9)'));
        }
        // 王炸：火箭从桌心升空，整张桌子一震
        if (within(fx.rocket, FX.fly + FX.rocket + 100)) {
          const r = el('div', { class: 'ddz-rkt', style: `left:${c.cx - ox}em;top:${c.y - 2.4 - oy}em` }, el('i'));
          r.insertAdjacentHTML('afterbegin', ROCKET_SVG);
          r.style.setProperty('--up', `${-(c.y + 12)}em`);
          fxc.append(play(r, 'ddz-rkt', FX.rocket, fx.rocket, FX.fly - 120, 'cubic-bezier(.55,0,.85,.55)'));
        }
      }
      if (within(fx.rocket, FX.fly + 700)) play(box, 'ddz-shake', 560, fx.rocket, FX.fly + 60, 'linear');
      else box.style.animation = '';

      // 各家面前那一手（缩小、略叠），被压过时从桌心缩回来
      const fronts = frontsOf(view, lead);
      for (const s of SEATS) {
        const t = fronts[s];
        const f = spots[s].front;
        if (!t || !f) continue;
        const spot = frontSpot(t.cards.length, f, L);
        // 起点：这手牌在桌心时每张的位置（张数相同，几何一致）
        const cg = spread(t.cards.length, c, { step: c.cw * 0.56, fan: false });
        center.push(playRow(t, spot, { cls: 'front', step: 0.56, fromPts: cg.map((g) => [g.x + c.cw / 2, g.y + c.cw * 0.7]), fromScale: c.cw / spot.cw, dur: 420, t0: fx.front[s]?.t0 }));
      }

      // 定地主：三张底牌在桌心翻开，再飞给地主
      const handing = view.landlord && Array.isArray(view.bottom) && within(fx.flip, FX.handover);
      if (handing) {
        const to = spots[view.landlord]?.from || [c.cx, c.y];
        const fs = c.cw / 5;
        const geo = spread(3, { cx: c.cx, y: c.y, cw: c.cw, maxW: c.cw * 3.6 }, { step: c.cw * 1.18, fan: false });
        withSuits(view.bottom).forEach((card, i) => {
          const g = geo[i];
          const w = el('div', { class: 'ddz-give', style: `left:${+(g.x / fs).toFixed(3)}em;top:${+(g.y / fs).toFixed(3)}em;font-size:${fs}em` }, ...flipPair(card, fx.flip, 350 + i * 120));
          w.style.setProperty('--tx', `${((to[0] - g.x - c.cw / 2) / fs).toFixed(3)}em`);
          w.style.setProperty('--ty', `${((to[1] - g.y - c.cw * 0.7) / fs).toFixed(3)}em`);
          center.push(play(w, 'ddz-give', FX.handover, fx.flip, 0, 'linear'));
        });
      }

      // 三家：名牌、手牌、气泡
      const handKids = [];
      for (const s of SEATS) {
        const pos = spots[s];
        // 真人自己出手时用按钮旁的倒计时，名牌上不再挂计时
        kids.push(plate(view, s, pos, L, { me: canAct ? me : null, bottom: s === me, t0: canAct && s === me ? null : opts.clock?.[s] || null, live: liveNow }));
        const mine = s === me && !!view.hands?.[s];
        // 地主坐在下方、手牌看得见：新到的三张抬起一会儿
        const lift = s === me && s === view.landlord && view.hands?.[s] && Array.isArray(view.bottom) && within(fx.flip, FX.handover + FX.lift + 200) ? (d) => bottomIdx(d, view.bottom) : null;
        if (mine && s === viewer) {
          const d = desc(view.hands[s]);
          const key = `${s}|${d.join(',')}`;
          if (key !== handKey) { sel = new Set(); handKey = key; }
          if (!canAct || view.phase !== 'play') sel = new Set();
          const big = canAct && view.phase === 'play' && L.mine ? { ...pos, hand: L.mine } : pos;
          handKids.push(...hand(view, s, big, { mine: true, pick: canAct && view.phase === 'play', d, lift: lift?.(d) }));
        } else {
          handKids.push(...hand(view, s, pos, { lift: view.hands?.[s] ? lift?.(desc(view.hands[s])) : null }));
        }
        const t = view.table?.[s];
        if (t && !t.cards && (t.text || t.pass)) {
          const [bx, by, ax] = pos.bubble;
          const b = el('div', { class: `ddz-bub ${ax}${t.bid ? ' bid' : ''}${view.stale ? ' stale' : ''}`, style: `left:${bx}em;top:${by}em` }, el('span', {}, (t.text || '不出').replace(/\s*(\d)\s*/g, (_, d) => '〇一二三'[d] || d)));
          play(b, 'ddz-pop', 360, fx.bub[s], 0, 'cubic-bezier(.2,1.5,.4,1)');
          kids.push(b);
        }
      }
      kids.push(...handKids, ...center);
      if (fxc.childNodes.length) kids.push(fxc);
      kids.push(plaque(view, L));
      if (view.phase === 'play' && L.counter) kids.push(counter(view, viewer, L));

      // 结果：春天 / 反春先打横幅，再升起结算卡
      if (view.result) {
        const r = view.result;
        const special = r.spring || r.anti;
        if (special && within(fx.over, FX.bannerDelay + FX.banner)) {
          const ban = el('div', { class: 'ddz-ban', style: `top:${L.ban}em` }, el('b', {}, r.spring ? '春天' : '反春'),
            el('span', {}, r.spring ? '农民一张没出，地主就出完了 · 倍数 ×2' : '地主只出了一手，农民就出完了 · 倍数 ×2'));
          kids.push(play(ban, 'ddz-ban', FX.banner, fx.over, FX.bannerDelay, 'ease-out'));
        }
        const resKey = `${view.plays?.length || 0}|${r.winner || ''}|${r.score ?? ''}`;
        if (resHidden === resKey) {
          // 收起了：桌角留一枚小签，点开再看
          kids.push(el('button', { class: 'ddz-pill', type: 'button', title: '展开结算', style: `left:${L.pill[0]}em;top:${L.pill[1]}em`, onclick: (e) => { e.stopPropagation(); resHidden = null; redraw(); } }, el('span', {}, '结算 ▸')));
        } else {
          const card = settleCard(view, r, L);
          card.append(el('button', { class: 'ddz-x', type: 'button', title: '收起（Esc）', 'aria-label': '收起结算卡', onclick: (e) => { e.stopPropagation(); resHidden = resKey; redraw(); } }, '✕'));
          play(card, 'ddz-rise', FX.card, fx.over, special && !calm ? FX.bannerDelay + FX.banner : FX.fly, EASE);
          kids.push(card);
        }
      }

      // 玩家本人的操作
      if (canAct) {
        // 出牌时手牌放大、往上抬，按钮跟着上移，抬起的牌不压按钮
        const ctlY = view.phase === 'play' && L.ctlMine ? L.ctlMine : L.ctl.y;
        const ctl = el('div', { class: 'ddz-ctl', style: `left:${L.ctl.cx}em;top:${ctlY}em` });
        // 这一步从什么时候开始等：对局页给的计时优先，没有时按本地第一次画出按钮的时刻
        const stepKey = `${view.phase}|${view.deals || 0}|${view.bids?.length || 0}|${view.plays?.length || 0}`;
        if (fx.turn.key !== stepKey) fx.turn = { key: stepKey, t0: Date.now() };
        ctl.append(countdown(opts.clock?.[me] || fx.turn.t0));
        if (view.phase === 'bid') {
          for (const [id, lb] of [['叫0', '不叫'], ['叫1', '1 分'], ['叫2', '2 分'], ['叫3', '3 分']]) {
            ctl.append(button(lb, { primary: id === '叫3', off: !ids.has(id), onClick: () => onAction(id) }));
          }
        } else {
          const d = desc(view.hands[me]);
          const chosen = ascId([...sel].map((k) => d[k]));
          const canPass0 = ids.has('不出');
          const list = hintList(actions, d, !canPass0);
          cur = { list, d, leading: !canPass0 };
          const key = list.map((a) => a.id).join('|');
          if (key !== hintKey) { hintKey = key; hintIdx = -1; }
          const canPass = ids.has('不出');
          const match = list.find((a) => a.id === chosen);
          // 说明：选了什么、能不能出；一张没选时告诉玩家怎么操作
          let tip, tcls;
          if (!list.length) { tip = canPass ? '没有压得过的牌，自动「要不起」' : '没有压得过的牌'; tcls = 'muted'; }
          else if (!sel.size) { tip = canPass ? '选牌压过上家，或点「提示」' : '该你领出：选牌，或点「提示」'; tcls = 'muted'; }
          else if (match) { tip = match.label; tcls = 'ok'; }
          else { tip = canPass ? '不成牌型，或压不过上家' : '这几张不成牌型'; tcls = 'bad'; }
          kids.push(el('div', { class: `ddz-tip ${tcls}`, style: `left:${L.ctl.cx}em;top:${ctlY - 2.9}em` }, el('span', {}, tip)));
          if (!list.length) {
            const pass = () => { clearTimeout(autoPass.timer); autoPass = { key: stepKey, t0: autoPass.t0, timer: null, done: true }; sel = new Set(); onAction('不出'); };
            const b = button('要不起', { primary: true, onClick: () => { if (!autoPass.done || autoPass.key !== stepKey) pass(); } });
            // 只能「要不起」：停 1.2 秒让人看见，再自动出手；这一步变了（轮到别人、复盘）就取消。点按钮立即出手
            if (canPass) {
              if (autoPass.key !== stepKey) {
                clearTimeout(autoPass.timer);
                autoPass = { key: stepKey, t0: Date.now(), timer: setTimeout(() => { if (autoPass.key === stepKey && !autoPass.done && root.isConnected) pass(); }, AUTO_PASS_MS), done: false };
              }
              autoKeep = true;
              if (!autoPass.done) {
                b.classList.add('auto');
                b.style.setProperty('--auto', `${AUTO_PASS_MS}ms`);
                b.style.setProperty('--auto-delay', `${-Math.min(AUTO_PASS_MS, Date.now() - autoPass.t0)}ms`);
              }
            }
            ctl.append(b);
          } else {
            ctl.append(...[
              canPass ? button('不出', { onClick: () => { sel = new Set(); onAction('不出'); } }) : null,
              button('提示', { onClick: () => { hintIdx = (hintIdx + 1) % list.length; sel = pickIds(list[hintIdx].id, d); redraw(); } }),
              sel.size ? button('重选', { onClick: () => { sel = new Set(); hintIdx = -1; redraw(); } }) : null,
              button('出牌', { primary: true, off: !match, onClick: () => { sel = new Set(); hintIdx = -1; onAction(chosen); } }),
            ].filter(Boolean));
          }
        }
        kids.push(ctl);
      }
      // 不再是「只能要不起」的那一步：取消还没出手的自动要不起
      if (!autoKeep && autoPass.key) { clearTimeout(autoPass.timer); autoPass = { key: '', timer: null }; }
      setLayer(box, felt, kids);
      if (box.querySelector('.tmr, .ddz-cd')) startTimerTick(root);
    }

    return {
      el: root,
      render(view, opts = {}) {
        // 对局页传来选手名时，名牌显示真名（没有时仍是「1 号位」）
        if (opts.players) view = { ...view, seatNames: { ...view.seatNames, ...Object.fromEntries(Object.entries(opts.players).map(([k, v]) => [k, v.name])) } };
        last = { view, opts };
        track(view, opts.animate);
        draw(view, opts);
      },
    };
  },
};
