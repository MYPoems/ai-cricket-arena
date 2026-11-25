// 掼蛋画面：俯视一张深色漆木牌桌（金边、嵌金线），四家围坐，对家是队友。下方是玩家本人（观众视角是 1 号位），
// 上方是他的队友，左右是两名对手。观众是上帝视角，四家手牌都摊开；玩家本人只看到自己的牌，别家是朱漆描金的牌背。
// 左上角一块牌匾：第几盘、本盘打几（书法大字）、两队级数；右上角记牌器（两副牌，每个点数别家还剩几张）。
// 下方自己的手牌理好：同点数叠成一列（从左到右大王 → 2），级牌标「级」、红桃级牌（逢人配）标「配」。
// 桌心是本轮最近的一手（逢人配标出它当的点数），被压过的牌缩小退到出牌人面前；「不出」是气泡；剩 10 张以内名牌上「报牌」。
// 进贡还贡：一盘开始时桌心列出谁贡给谁什么牌、谁还了什么（还的牌只有双方看得见），抗贡另写；一盘结束升起结算卡
// （名次、升几级、过 A），整场结束是终局卡。真人出手：点选或横划选牌，按钮「不出」「提示」「重选」「出牌」；
// 选中的牌有几种组法（逢人配）时，按钮上方列出各种组法，点一个再出。还贡阶段点一张能还的牌再点「还贡」。
// 画面用 HTML 画，桌面上的东西一律用 em 定位（横版 80×50em，竖版 50×70em），缩略图、对局页、手机竖屏同一套画法等比缩放。

import { FX, fxDuration, cardFromName, interpret, beats, codeOf, playId, typeText, keyText, isBomb } from '/games/guandan/rules.js';

const SEATS = ['p1', 'p2', 'p3', 'p4'];
const TEAM_COLOR = { A: 'var(--red)', B: '#3559b5' };
const EASE = 'cubic-bezier(.2,.75,.1,1)';
const CD_SECS = 30;
const AUTO_PASS_MS = 1200;
const END_HOLD = FX.endHold; // 一盘打完先看清最后一手，再升起结算卡
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const teamOfSeat = (s) => (s === 'p1' || s === 'p3' ? 'A' : 'B');
const partnerOf = (s) => SEATS[(SEATS.indexOf(s) + 2) % 4];

// ---------- 版式（单位 em） ----------
// 每个座位：plate 名牌左上角；hand 别家手牌（cx 中心、y 顶边、cw 牌宽、maxW 最大总宽）；from 出牌起飞点；
// front 面前那一手（x 对齐点、al 'l'/'r'/'c'、maxW）；bubble 气泡（x, y, 'l'/'r'/'c'）。
// mine 自己的手牌区（x0..x1 宽度里按列排，bottom 为底边）
const LAYOUTS = {
  land: {
    w: 80, h: 50, plateW: 17.5, plateH: 5.6,
    plaque: [1.6, 1.4], counter: [78.4, 1.4],
    top: { plate: [31.25, 1.4], hand: { cx: 40, y: 7.9, cw: 2.6, maxW: 30 }, from: [40, 9], front: { x: 40, y: 12.4, al: 'c', maxW: 22 }, bubble: [49.6, 2.6, 'l'] },
    left: { plate: [1.6, 12.6], hand: { cx: 13.5, y: 19.2, cw: 2.5, maxW: 23.6 }, from: [12, 21], front: { x: 3.4, y: 25.4, al: 'l', maxW: 19 }, bubble: [3.4, 25.6, 'l'] },
    right: { plate: [80 - 1.6 - 17.5, 12.6], hand: { cx: 66.5, y: 19.2, cw: 2.5, maxW: 23.6 }, from: [68, 21], front: { x: 76.6, y: 25.4, al: 'r', maxW: 19 }, bubble: [76.6, 25.6, 'r'] },
    bottom: { plate: [1.6, 41.8], from: [48, 42], front: { x: 2.4, y: 33.6, al: 'l', maxW: 17 }, bubble: [2.4, 35, 'l'] },
    frontCw: 2.6,
    mine: { x0: 20.6, x1: 78.6, bottom: 48.4, cwMax: 4.3, colH: 11.2 },
    lead: { cx: 40, y: 17.4, cw: 4.3, maxW: 33 },
    res: { cx: 40, y: 8.2, w: 38 },
    trib: { cx: 40, y: 15.2, w: 34 },
    res2: { cx: 22.4, y: 8.2, w: 33 }, trib2: { cx: 59.4, y: 9.6, w: 32 },
    pill: [78.4, 44.2],
  },
  port: {
    w: 50, h: 70, plateW: 23.6, plateH: 5,
    plaque: [0.9, 0.9], counter: null,
    top: { plate: [25.5, 0.9], hand: { cx: 25, y: 7.2, cw: 2.3, maxW: 46 }, from: [25, 9], front: { x: 25, y: 23.4, al: 'c', maxW: 14 }, bubble: [25, 23.6, 'c'] },
    left: { plate: [0.9, 11.8], hand: { cx: 12.7, y: 17.6, cw: 2.1, maxW: 22.6 }, from: [12, 19], front: { x: 1.4, y: 23.4, al: 'l', maxW: 14 }, bubble: [1.4, 23.6, 'l'] },
    right: { plate: [25.5, 11.8], hand: { cx: 37.3, y: 17.6, cw: 2.1, maxW: 22.6 }, from: [38, 19], front: { x: 48.6, y: 23.4, al: 'r', maxW: 14 }, bubble: [48.6, 23.6, 'r'] },
    bottom: { plate: [0.9, 38.4], from: [25, 60], front: { x: 48.6, y: 38.6, al: 'r', maxW: 22 }, bubble: [48.6, 39.2, 'r'] },
    frontCw: 2.4,
    mine: { x0: 0.8, x1: 49.2, bottom: 69.2, cwMax: 5.4, colH: 16 },
    lead: { cx: 25, y: 28.6, cw: 3.8, maxW: 46 },
    res: { cx: 25, y: 14, w: 46 },
    trib: { cx: 25, y: 26.4, w: 44 },
    res2: { cx: 25, y: 7.4, w: 46 }, trib2: { cx: 25, y: 31.4, w: 42 },
    pill: [49.2, 33],
    ctlScale: 1.4,
  },
};

// ---------- 样式 ----------
const CSS = `
.gd { position: relative; width: 100%; height: 100%; container-type: size; user-select: none; -webkit-user-select: none; font-family: var(--serif); overflow: clip; overflow-clip-margin: .6em; }
.gd-box { position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: min(100cqw, 160cqh); height: min(62.5cqw, 100cqh); font-size: min(1.25cqw, 2cqh); }
.gd.port .gd-box { width: min(100cqw, 71.43cqh); height: min(140cqw, 100cqh); font-size: min(2cqw, 1.4286cqh); }
.gd-box > * { position: absolute; }
.gd-rail { inset: .3em .3em .9em; border-radius: 2.6em; border: .2em solid transparent;
  background: radial-gradient(70% 60% at 18% 0%, rgb(255 214 170 / .2), transparent 62%) padding-box, linear-gradient(180deg, #4a1209 0%, #2b0905 46%, #170403 100%) padding-box, var(--edge) border-box;
  box-shadow: inset 0 .14em 0 rgb(255 226 184 / .28), inset 0 -.2em .3em rgb(0 0 0 / .6), 0 .3em 0 #3b1607, 0 .55em 0 #1a0703, 0 .62em 0 .06em #050100, 0 1em 1.2em rgb(0 0 0 / .55); }
:root[data-theme="light"] .gd-rail { box-shadow: inset 0 .14em 0 rgb(255 226 184 / .28), inset 0 -.2em .3em rgb(0 0 0 / .6), 0 .3em 0 #6a4a16, 0 .55em 0 #3e2a0a, 0 .62em 0 .06em rgb(70 44 8 / .7), 0 1em 1.2em rgb(80 48 10 / .4); }
.gd-top { inset: 1.7em 1.7em 2.3em; border-radius: 1.5em; overflow: hidden;
  background: var(--grain), radial-gradient(55% 42% at 20% -4%, rgb(255 210 160 / .18), transparent 70%), radial-gradient(62% 58% at 50% 46%, rgb(170 46 22 / .42), transparent 76%),
    repeating-linear-gradient(91deg, transparent 0 1.1em, rgb(0 0 0 / .07) 1.1em 1.2em, transparent 1.2em 2.3em, rgb(255 190 140 / .035) 2.3em 2.38em),
    radial-gradient(130% 95% at 50% 112%, rgb(0 0 0 / .6), transparent 60%), linear-gradient(180deg, #57170d 0%, #3a0e08 52%, #250705 100%);
  box-shadow: inset 0 .5em 1em rgb(0 0 0 / .65), inset 0 0 0 .08em rgb(0 0 0 / .7), 0 .08em 0 rgb(255 224 176 / .16); }
.gd-top::after { content: ''; position: absolute; inset: .7em; border-radius: .9em; border: .08em solid rgb(226 186 96 / .42); pointer-events: none; }
.gd-wm { font: 400 22em/1 var(--brush); color: rgb(240 205 120 / .045); left: 50%; top: 50%; translate: -50% -50%; pointer-events: none; }
.gd.port .gd-wm { font-size: 18em; top: 44%; }

/* 牌（牌宽 5em、高 7em，大小由 font-size 决定） */
.gd-c { position: absolute; width: 5em; height: 7em; border-radius: .46em; color: #1c1310;
  background: radial-gradient(120% 70% at 20% 0%, #fff, rgb(255 255 255 / 0) 60%), linear-gradient(172deg, #fffcf3 0%, #f6eedb 72%, #ecdfc1 100%);
  box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 .07em 0 #fff, 0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .16em 0 rgb(60 36 8 / .55), 0 .35em .5em -.05em rgb(0 0 0 / .5); }
.gd-c.r { color: #c42d1e; }
.gd-c .ix { position: absolute; left: .32em; top: .26em; display: grid; justify-items: center; line-height: 1; }
.gd-c.ten .lv { left: 2.05em; }
.gd-c .ix b { font: 700 1.45em/1 var(--num); letter-spacing: -.04em; }
.gd-c .ix i { font-style: normal; font-size: 1.05em; margin-top: .08em; }
.gd-c .ix.br { left: auto; top: auto; right: .32em; bottom: .26em; rotate: 180deg; }
.gd-c .pip { position: absolute; left: 50%; top: 52%; translate: -50% -50%; font-size: 2.7em; line-height: 1; }
.gd-c .face { position: absolute; inset: 1.15em .95em; border-radius: .24em; display: grid; grid-template-rows: 1.05em 1fr 1em; justify-items: center; align-items: center; padding: .22em 0 .2em;
  background: radial-gradient(90% 60% at 50% 44%, rgb(255 255 255 / .85), transparent 70%), linear-gradient(180deg, rgb(232 196 112 / .3), rgb(201 162 74 / .12));
  box-shadow: inset 0 0 0 .05em currentColor, inset 0 0 0 .14em #fffaf0, inset 0 0 0 .2em rgb(186 142 52 / .85); }
.gd-c .face svg { width: 2.1em; height: 1.05em; overflow: visible; }
.gd-c .face b { font: 900 2.3em/1 var(--serif); }
.gd-c .face i { font-style: normal; font-size: 1em; line-height: 1; }
.gd-c.jk .ix { font: 400 1.05em/1.02 var(--brush); writing-mode: vertical-rl; letter-spacing: -.05em; }
.gd-c.jk .emb { position: absolute; left: 50%; top: 53%; translate: -50% -50%; border-radius: 50%; display: grid; place-items: center;
  font: 400 1.9em/1 var(--brush); width: 1.55em; height: 1.55em; box-shadow: inset 0 0 0 .07em currentColor, inset 0 0 0 .2em rgb(255 255 255 / .8), inset 0 0 0 .26em rgb(201 162 74 / .7);
  background: radial-gradient(circle at 35% 30%, rgb(255 255 255 / .9), rgb(240 205 120 / .25) 70%); }
/* 级牌、逢人配的角标；逢人配在桌上时下面写它当的点数 */
/* 角标放在点数右边：牌叠着摆（手牌一列列压住、桌上一手横排）时也露在外面 */
.gd-c .lv { position: absolute; left: 1.72em; top: .3em; font: 700 .82em/1 var(--sans); padding: .16em .2em; border-radius: .22em; color: #6a4a14; background: linear-gradient(180deg, #fbe8a6, #e0b454); box-shadow: 0 0 0 .05em #8e6824; }
.gd-c .lv.w { color: #fff4e0; background: linear-gradient(180deg, #e2523d, #8e1b12); box-shadow: 0 0 0 .05em #e6bd5c; }
.gd-c .as { position: absolute; left: .2em; bottom: 1.5em; font: 700 1.05em/1 var(--sans); white-space: nowrap; color: #fff4e0; padding: .18em .35em; border-radius: .5em; background: rgb(142 27 18 / .9); }
.gd-c.bk { background:
    radial-gradient(circle at 50% 50%, #fbe8a6 0 .38em, #b8862e .42em .5em, transparent .54em),
    radial-gradient(circle at 50% 50%, transparent 0 .78em, rgb(240 205 120 / .55) .8em .86em, transparent .9em),
    repeating-linear-gradient(45deg, rgb(240 205 120 / .3) 0 .06em, transparent .06em .62em),
    repeating-linear-gradient(-45deg, rgb(240 205 120 / .3) 0 .06em, transparent .06em .62em),
    linear-gradient(165deg, #c23a26 0%, #8e1b12 55%, #5e0e08 100%);
  box-shadow: inset 0 0 0 .24em #fbf3df, inset 0 0 0 .31em #d4ab52, inset 0 0 0 .36em #5e0e08, 0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .3em .4em -.05em rgb(0 0 0 / .5); }
.gd-c.pick { cursor: pointer; transition: translate .16s cubic-bezier(.2,1.2,.4,1), box-shadow .16s; }
.gd.can-move .gd-c.pick { touch-action: none; }
.gd-c.pick:hover { translate: 0 -.25em; }
.gd-c.sel { translate: 0 -.9em; box-shadow: inset 0 0 0 .05em rgb(110 76 28 / .5), inset 0 0 0 .16em #e0b454, inset 0 .07em 0 #fff, 0 .06em 0 #e4d7b6, 0 .12em 0 #c6b388, 0 .5em .7em -.05em rgb(0 0 0 / .55), 0 0 .9em rgb(240 205 120 / .6); }
.gd-c.sel.pick:hover { translate: 0 -1.05em; }
.gd-c.dim { filter: brightness(.62) saturate(.6); }
.gd-play.stale { opacity: .42; }
.gd-play, .gd-lbl, .gd-bub, .gd-tip, .gd-glow, .gd-burst, .gd-rays { pointer-events: none; }

/* 牌匾：第几盘、打几、两队级数 */
.gd-plq { display: grid; grid-template-columns: auto auto; align-items: center; gap: .2em 1em; padding: .5em 1em .55em 1.1em; border-radius: 1em; border: .14em solid transparent; white-space: nowrap;
  background: var(--glint), var(--surface), var(--edge) border-box; box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .5em .7em rgb(0 0 0 / .55); color: var(--text); }
.gd-plq .lvl { grid-row: 1 / 3; display: grid; justify-items: center; line-height: 1; }
.gd-plq .lvl small { font: 600 .95em/1.2 var(--sans); letter-spacing: .14em; color: var(--gold); }
.gd-plq .lvl b { font: 400 3em/1.05 var(--brush); background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 .1em; }
.gd-plq .tm { display: flex; align-items: center; gap: .45em; font: 600 1.05em/1.2 var(--sans); color: var(--muted); }
.gd-plq .tm i { width: .7em; height: .7em; border-radius: 50%; background: var(--tc); box-shadow: 0 0 0 .1em rgb(255 255 255 / .25); }
.gd-plq .tm b { font: 600 1.45em/1 var(--num); color: var(--text); min-width: 1.4em; }
.gd-plq .tm.on b { color: var(--gold); }
.gd-plq .tm em { font-style: normal; font: 700 .8em/1 var(--sans); color: #fff4e0; background: #a3261a; padding: .2em .35em; border-radius: .3em; }
:root[data-theme="light"] .gd-plate, :root[data-theme="light"] .gd-plq { box-shadow: var(--hi), 0 .18em 0 #8e6824, 0 .26em 0 .04em rgb(70 44 8 / .7), 0 .55em .8em rgb(40 14 4 / .5); }

/* 名牌 */
.gd-plate { display: flex; align-items: center; gap: .8em; padding: 0 1em 0 .7em; border-radius: 1em; border: .14em solid transparent; color: var(--text); --edge-now: var(--edge);
  background: var(--glint), var(--surface), var(--edge-now) border-box;
  box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .55em .8em rgb(0 0 0 / .55); }
.gd-plate.on { --edge-now: var(--edge-hi); z-index: 2; box-shadow: var(--hi), 0 0 0 .1em #040100, 0 0 0 .38em rgb(42 11 8 / .9), 0 0 0 .48em rgb(240 205 120 / .75), 0 0 2em .3em rgb(240 205 120 / .38), 0 .55em .8em rgb(0 0 0 / .55); }
.gd-plate.on::after { content: ''; position: absolute; inset: -.14em; z-index: -1; border-radius: inherit; pointer-events: none; opacity: 0;
  box-shadow: 0 0 0 .1em #040100, 0 0 0 .38em rgb(42 11 8 / .9), 0 0 0 .52em #f6dc94, 0 0 3.2em .8em rgb(255 214 120 / .55); animation: gd-turn 1.6s ease-in-out infinite; }
.gd-plate.done { opacity: .78; }
.gd-plate .coin { position: relative; font-size: 1.45em; width: 2.1em; height: 2.1em; flex: none; font-family: var(--num); font-weight: 600; }
.gd-plate .coin::after { content: ''; position: absolute; right: -.15em; bottom: -.1em; width: .62em; height: .62em; border-radius: 50%; background: var(--tc); box-shadow: 0 0 0 .1em #2a0b08; }
.gd-plate .who { display: grid; gap: .25em; min-width: 3em; flex: 1 1 auto; }
.gd-plate .who b { font: 900 1.4em/1.15 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gd-plate .who span { font: 600 1em/1 var(--sans); color: var(--muted); white-space: nowrap; }
.gd.port .gd-plate .who b { font-size: 1.3em; }
.gd-plate .cnt { display: grid; justify-items: center; flex: none; min-width: 2.4em; }
.gd-plate .cnt b { font: 600 2.3em/1 var(--num); color: var(--text); font-variant-numeric: tabular-nums; }
.gd-plate .cnt small { font: 600 .85em/1.2 var(--sans); color: var(--muted); letter-spacing: .1em; }
.gd-plate .cnt.warn b { color: var(--zhu-2); }
.gd-plate .pos { font: 400 1.9em/1 var(--brush); color: var(--gold); flex: none; }
.gd-plate .alarm { position: absolute; top: -.85em; right: .9em; font: 700 .95em/1 var(--sans); color: #fff3e6; padding: .32em .55em; border-radius: .9em; letter-spacing: .1em;
  background: radial-gradient(circle at 34% 24%, #ff8a72, #d23a26 46%, #8e1b12); box-shadow: inset 0 .07em 0 rgb(255 220 200 / .6), 0 0 0 .08em #6a4a14, 0 0 0 .16em #e6bd5c, 0 .2em .3em .1em rgb(0 0 0 / .45); }
.gd-plate .alarm.hot { animation: gd-alarm 1.1s ease-in-out infinite; }
.gd-plate .tag { position: absolute; left: 50%; top: calc(100% + .5em); translate: -50% 0; display: flex; align-items: center; gap: .4em; white-space: nowrap; padding: .34em .85em .38em; border-radius: 1em;
  font: 700 1.05em/1 var(--sans); letter-spacing: .1em; color: var(--on-gold); background: var(--gold-metal); box-shadow: 0 .3em .6em rgb(0 0 0 / .45); z-index: 3; animation: gd-pop .36s cubic-bezier(.2,1.5,.4,1) both; }
.gd-plate .tag.me { color: #fff4e0; background: linear-gradient(180deg, #e2523d, #8e1b12); }
.gd-plate .tag.up { top: auto; bottom: calc(100% + .5em); }
.gd-plate .tag i { width: .36em; height: .36em; border-radius: 50%; background: currentColor; animation: gd-dot 1.2s ease-in-out infinite; }
.gd-plate .tag i:nth-child(2) { animation-delay: .2s; } .gd-plate .tag i:nth-child(3) { animation-delay: .4s; }
.gd-plate .tmr { position: absolute; right: -.5em; top: -.85em; font: 700 1em/1 var(--num); padding: .25em .5em .28em; border-radius: .8em; color: #2a1206; z-index: 3;
  background: linear-gradient(180deg, #fff3c8, #f0cd78); box-shadow: 0 .1em 0 #8e6824, 0 .2em .4em rgb(0 0 0 / .4); font-variant-numeric: tabular-nums; }
.gd-plate .tmr.warm { background: linear-gradient(180deg, #ffd9a0, #f09a3c); }
.gd-plate .tmr.hot { color: #fff4e0; background: linear-gradient(180deg, #ff8a6a, #c42d1e); }

/* 气泡 */
.gd-bub { padding: .7em 1.6em .9em; border-radius: 1.4em; font: 400 1em/1 var(--brush); color: #3a1a0c; white-space: nowrap; background: var(--paper-face); z-index: 3;
  box-shadow: inset 0 .05em 0 rgb(255 255 255 / .85), 0 0 0 .05em rgb(120 84 30 / .55), 0 .1em 0 #b4955a, 0 .3em .45em rgb(0 0 0 / .5); }
.gd-bub.r { translate: -100% 0; } .gd-bub.c { translate: -50% 0; }
.gd-bub > span { font-size: 1.8em; }
.gd-bub.stale { opacity: .5; }
.gd-bub.wind { color: #a3261a; }

.gd-lbl { translate: -50% 0; display: flex; align-items: center; gap: .7em; font: 600 1em/1 var(--sans); color: rgb(242 227 194 / .78); white-space: nowrap; letter-spacing: .08em; }
.gd-lbl > span { font-size: 1.15em; }
.gd-lbl b { font: 400 1.7em/1 var(--brush); color: #f6dc94; }
.gd-lbl em { font: 700 .95em/1 var(--sans); font-style: normal; letter-spacing: .1em; color: #2a1206; padding: .3em .55em; border-radius: .9em; background: linear-gradient(180deg, #fff3c8, #f0cd78); }
.gd i.no { flex: none; width: 1.55em; height: 1.55em; border-radius: 50%; display: inline-grid; place-items: center; font: 700 .95em/1 var(--num); font-style: normal; color: #fbe8c8; background: var(--tc); box-shadow: 0 0 0 .08em rgb(255 255 255 / .3); }
.gd-paper .lastp { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: .3em .55em; font: 600 1.05em/1.2 var(--sans); color: #6a4a2a; }
.gd-paper .lastp small { font: 700 .9em/1 var(--sans); letter-spacing: .1em; color: #fff4e0; background: #6a4a2a; padding: .3em .5em; border-radius: .3em; }
.gd-paper .lastp .nm { font: 700 1.05em/1.2 var(--serif); color: #3a1a0c; white-space: nowrap; max-width: 9em; overflow: hidden; text-overflow: ellipsis; }
.gd-paper .lastp .ty { font: 400 1.4em/1 var(--brush); color: #a3261a; white-space: nowrap; }
.gd-paper .mini { position: relative; flex: none; height: 3.08em; }
.gd.ended .gd-paper.final { opacity: 0; visibility: hidden; }
.gd-paper.final { transition: opacity .3s, visibility .3s; }
.gd-lbl.boom b { color: #ff8a6a; }
.gd-glow { translate: -50% -50%; border-radius: 50%; background: radial-gradient(closest-side, rgb(255 214 140 / .2), rgb(255 190 110 / .07) 60%, transparent); }
.gd-burst { translate: -50% -50%; width: 34em; height: 34em; border-radius: 50%; mix-blend-mode: screen; z-index: 4;
  background: radial-gradient(closest-side, rgb(255 250 220 / .95), rgb(255 214 120 / .7) 18%, rgb(240 140 60 / .35) 42%, transparent 70%); }
.gd-rays { translate: -50% -50%; width: 42em; height: 42em; border-radius: 50%; mix-blend-mode: screen; z-index: 4;
  background: repeating-conic-gradient(from 0deg, rgb(255 226 150 / .5) 0deg 4deg, transparent 4deg 18deg);
  -webkit-mask: radial-gradient(closest-side, transparent 18%, #000 30%, transparent 72%); mask: radial-gradient(closest-side, transparent 18%, #000 30%, transparent 72%); }

/* 记牌器 */
.gd-cnt { translate: -100% 0; display: grid; grid-template-columns: auto repeat(8, 2.15em); gap: .14em .1em; padding: .3em .45em .32em .3em; border-radius: .8em; white-space: nowrap;
  background: rgb(10 3 2 / .58); box-shadow: inset 0 .06em .2em rgb(0 0 0 / .6), 0 .06em 0 rgb(255 224 176 / .12); }
.gd-cnt small { grid-row: 1 / 3; writing-mode: vertical-rl; font: 600 .95em/1 var(--sans); letter-spacing: .12em; color: rgb(240 205 120 / .82); padding: 0 .25em; align-self: center; }
.gd-cnt .c { display: grid; justify-items: center; padding: .14em 0 .18em; border-radius: .4em; }
.gd-cnt .c i { font: 600 1em/1.1 var(--num); font-style: normal; color: rgb(242 227 194 / .78); }
.gd-cnt .c.j i, .gd-cnt .c.l i { font-family: var(--sans); font-size: .92em; }
.gd-cnt .c b { font: 700 1.25em/1.05 var(--num); color: #f2e3c2; }
.gd-cnt .c.z { opacity: .28; }
.gd-cnt .c.l { background: rgb(240 205 120 / .16); box-shadow: inset 0 0 0 .06em rgb(240 205 120 / .45); }
.gd-cnt .c.l b { color: #f6dc94; }

/* 进贡还贡面板、结算卡、终局卡：一张宣纸 */
.gd-paper { translate: -50% 0; z-index: 7; display: grid; gap: .6em; padding: .9em 1.4em 1.1em; border-radius: 1.2em; color: #3a1a0c; background: var(--paper-face);
  box-shadow: inset 0 .06em 0 rgb(255 255 255 / .85), inset 0 0 0 .06em rgb(120 84 30 / .45), 0 0 0 .3em rgb(42 11 8 / .55), 0 0 0 .38em rgb(226 186 96 / .55), 0 .15em 0 .38em #6a4a14, 0 1.2em 2.4em rgb(0 0 0 / .6); }
.gd-paper .hd { display: flex; align-items: center; justify-content: center; gap: .5em; }
.gd-paper .hd b { font: 400 3.2em/1.05 var(--brush); color: #a3261a; letter-spacing: .04em; }
.gd-paper .hd small { font: 600 1.1em/1 var(--sans); color: #6a4a2a; letter-spacing: .1em; }
.gd-paper .hd em { font: 700 1.05em/1 var(--sans); font-style: normal; letter-spacing: .12em; color: #fff4e0; padding: .38em .55em; border-radius: .3em; rotate: -8deg; background: linear-gradient(180deg, #d23a26, #8e1b12); }
.gd-paper .ln { display: flex; justify-content: center; align-items: baseline; flex-wrap: wrap; gap: .3em .6em; padding: .5em .8em; border-radius: .6em; font: 600 1.1em/1.35 var(--sans); color: #6a4a2a; background: rgb(120 84 30 / .08); box-shadow: inset 0 0 0 .06em rgb(120 84 30 / .28); }
.gd-paper .ln b { font: 700 1.3em/1 var(--num); color: #a3261a; }
.gd-paper .rows { display: grid; gap: .28em; }
.gd-paper .row { display: grid; grid-template-columns: 3.2em 1.8em minmax(0, 1fr) auto; align-items: center; gap: .6em; padding: .32em .8em .32em .5em; border-radius: .6em; }
.gd-paper .row.win { background: linear-gradient(90deg, rgb(226 186 96 / .42), rgb(226 186 96 / .1)); box-shadow: inset .25em 0 0 #c8983c; }
.gd-paper .row .p { font: 400 1.5em/1 var(--brush); color: #a3261a; text-align: center; }
.gd-paper .row .n { width: 1.8em; height: 1.8em; border-radius: 50%; display: grid; place-items: center; font: 700 1em/1 var(--num); color: #fbe8c8; background: var(--tc); }
.gd-paper .row .nm { font: 700 1.2em/1.2 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gd-paper .row .lf { font: 600 1em/1 var(--sans); color: #8a6a4a; white-space: nowrap; }
.gd-paper .tr { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; align-items: center; gap: .5em; font: 600 1.1em/1.2 var(--sans); color: #6a4a2a; }
.gd-paper .tr .nm { display: flex; align-items: center; gap: .35em; min-width: 0; font: 700 1.1em/1.2 var(--serif); color: #3a1a0c; white-space: nowrap; }
.gd-paper .tr .nm > span { overflow: hidden; text-overflow: ellipsis; }
.gd-paper .tr .ar { color: #a08060; }
.gd-paper .tr .k { font: 700 .95em/1 var(--sans); letter-spacing: .1em; padding: .3em .5em; border-radius: .3em; color: #fff4e0; background: #a3261a; }
.gd-paper .tr .k.back { background: #6a4a2a; }
.gd-paper .tr .slot { position: relative; width: 2.2em; height: 3.08em; }
.gd-paper .tr .slot .gd-c { left: 0; top: 0; }
.gd-paper .tr .wait { font: 600 .95em/1 var(--sans); color: #a08060; }
.gd-x { position: absolute; right: .55em; top: .55em; width: 2.1em; height: 2.1em; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
  font: 700 1.05em/1 var(--sans); color: #6a4a2a; background: rgb(120 84 30 / .12); box-shadow: inset 0 0 0 .07em rgb(120 84 30 / .3); }
.gd-x:hover, .gd-x:focus-visible { color: #a3261a; background: rgb(120 84 30 / .22); }
.gd-pill { translate: -100% 0; display: flex; align-items: center; padding: .5em .95em .55em; border-radius: 1.2em; border: .12em solid transparent; cursor: pointer; z-index: 7; white-space: nowrap;
  font: 700 1em/1 var(--sans); letter-spacing: .1em; color: var(--on-gold); background: var(--gold-metal) padding-box, linear-gradient(180deg, #fbe8a6, #8e6824) border-box; box-shadow: 0 .3em .6em rgb(0 0 0 / .45); animation: gd-rise .3s ${EASE} both; }
.gd-pill > span { font-size: 1.15em; }

/* 操作区 */
.gd-ctl { translate: -50% 0; display: flex; gap: .8em; align-items: center; z-index: 6; animation: gd-rise .35s ${EASE} both; }
.gd-ctl.sent { pointer-events: none; opacity: .55; transition: opacity .2s; }
.gd-ctl .btn { font-size: 1.35em; padding: .3em 1em; min-width: 4.2em; --d: .18em; }
.gd-ctl .btn.auto { position: relative; overflow: hidden; }
.gd-ctl .btn.auto::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: .22em; background: currentColor; opacity: .6; transform-origin: 0 50%; animation: gd-auto var(--auto, 1200ms) linear var(--auto-delay, 0ms) both; }
.gd-tip { translate: -50% 0; white-space: nowrap; display: flex; gap: .5em; align-items: center; z-index: 6; }
.gd-tip > span { display: block; font: 700 1.2em/1 var(--sans); letter-spacing: .06em; color: #f6dc94; padding: .42em 1em; border-radius: 1em; background: rgb(10 3 2 / .66); box-shadow: inset 0 .05em .2em rgb(0 0 0 / .6); }
.gd-tip.bad > span { color: #ff9a80; }
.gd-tip.muted > span { color: rgb(242 227 194 / .72); font-weight: 600; }
.gd-tip.ok > span::before { content: '✓ '; color: #8fd6a4; }
.gd-tip button { pointer-events: auto; cursor: pointer; border: 0; font: 700 1.1em/1 var(--sans); padding: .45em .8em; border-radius: 1em; color: rgb(242 227 194 / .85); background: rgb(10 3 2 / .66); box-shadow: inset 0 0 0 .08em rgb(240 205 120 / .35); }
.gd-tip button.on { color: var(--on-gold); background: var(--gold-metal); box-shadow: none; }
.gd-cd { position: relative; flex: none; width: 2.6em; height: 2.6em; display: grid; place-items: center; --cd: #f0cd78; }
.gd-cd svg { position: absolute; inset: 0; width: 100%; height: 100%; rotate: -90deg; overflow: visible; }
.gd-cd circle { stroke-width: 3.4; }
.gd-cd .bg { fill: rgb(10 3 2 / .62); stroke: rgb(240 205 120 / .16); }
.gd-cd .fg { fill: none; stroke: var(--cd); stroke-linecap: round; }
.gd-cd b { position: relative; font: 700 1.15em/1 var(--num); color: var(--cd); }
.gd-cd.amber { --cd: #f09a3c; } .gd-cd.red { --cd: #ff6a4a; }

@keyframes gd-fly { from { transform: translate(var(--fx), var(--fy)) scale(var(--fs, .72)); opacity: var(--fo, .25); } 60% { opacity: 1; } }
@keyframes gd-pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } }
@keyframes gd-jump { 0% { transform: none; } 35% { transform: translateY(-.35em) scale(1.35); color: #f6dc94; } 100% { transform: none; } }
@keyframes gd-burst { 0% { transform: scale(.1); opacity: 0; } 12% { opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
@keyframes gd-rays { 0% { transform: scale(.3) rotate(0deg); opacity: 0; } 15% { opacity: 1; } 100% { transform: scale(1.25) rotate(40deg); opacity: 0; } }
@keyframes gd-shake { 0%, 100% { transform: none; } 20% { transform: translate(.25em, -.15em); } 40% { transform: translate(-.2em, .15em); } 60% { transform: translate(.12em, .1em); } 80% { transform: translate(-.08em, -.06em); } }
@keyframes gd-alarm { 50% { transform: scale(1.12); } }
@keyframes gd-dot { 0%, 100% { opacity: .3; transform: none; } 50% { opacity: 1; transform: translateY(-.15em); } }
@keyframes gd-rise { from { transform: translateY(1em) scale(.92); opacity: 0; } }
@keyframes gd-turn { 50% { opacity: 1; } }
@keyframes gd-auto { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@keyframes gd-cd { from { stroke-dashoffset: 0; } to { stroke-dashoffset: var(--len); } }
@keyframes gd-give { 0% { transform: translate(var(--gx), var(--gy)) scale(.6); opacity: 0; } 20% { opacity: 1; } }
@media (pointer: coarse) { .gd-x::before { content: ''; position: absolute; inset: -12px; } }
@media (prefers-reduced-motion: reduce) { .gd-plate.on::after, .gd-plate .alarm.hot { animation: none; } .gd-cd .fg { animation: none !important; } }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('gd-style')) return;
  const st = document.createElement('style');
  st.id = 'gd-style';
  st.textContent = CSS;
  document.head.append(st);
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
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function play(node, name, dur, t0, delay = 0, ease = EASE) {
  if (t0 === null || t0 === undefined) return node;
  const passed = now() - t0;
  if (passed > delay + dur) return node;
  node.style.animation = `${name} ${dur}ms ${ease} ${Math.round(delay - passed)}ms both`;
  return node;
}

const SUIT_OF = { '♠': 'b', '♥': 'r', '♣': 'b', '♦': 'r' };
const CROWN = {
  K: '<path d="M2.5 9.2 1.6 2.6l5 3.4L10 .9l3.4 5.1 5-3.4-.9 6.6z"/><path d="M3 9.2h14" stroke-width="1.3"/><circle cx="1.6" cy="2.4" r="1"/><circle cx="10" cy=".8" r="1"/><circle cx="18.4" cy="2.4" r="1"/>',
  Q: '<path d="M2.6 9.2C2.6 5.4 5.6 2.7 10 2.7s7.4 2.7 7.4 6.5z"/><path d="M3 9.2h14" stroke-width="1.3"/><path d="M6 6.2 10 4.3l4 1.9" fill="none"/><circle cx="10" cy="1.3" r="1.1"/>',
  J: '<path d="M2.4 9.2c0-2.8 3-4.9 7.6-4.9s7.6 2.1 7.6 4.9z"/><path d="M3 9.2h14" stroke-width="1.3"/><path d="M12.6 4.6C13.8 1.6 16.6.4 19.2 1.1c-1.3 1.1-2.8 2.4-4.4 4" fill="none"/>',
};

/**
 * 一张牌。name 为「♠5」「小王」或 null（牌背）；x、y 为桌面 em 坐标，fs 为牌的 font-size（牌宽 = 5 × fs）。
 * level 为本盘级数的点数名：级牌角上标「级」，红桃级牌标「配」；as 为逢人配在这一手里当的点数
 */
function cardEl(name, x, y, fs, { cls = '', level = null, as = '' } = {}) {
  const st = `left:${+(x / fs).toFixed(3)}em;top:${+(y / fs).toFixed(3)}em;font-size:${fs}em`;
  if (!name) return el('div', { class: `gd-c bk ${cls}`, style: st });
  if (name === '小王' || name === '大王') {
    const big = name === '大王';
    return el('div', { class: `gd-c jk${big ? ' r' : ''} ${cls}`, style: st }, el('div', { class: 'ix' }, name), el('div', { class: 'emb' }, '王'), el('div', { class: 'ix br' }, name));
  }
  const s = name[0];
  const r = name.slice(1);
  const face = r === 'J' || r === 'Q' || r === 'K';
  const wild = level && r === level && s === '♥';
  const lvTag = level && r === level ? el('span', { class: `lv${wild ? ' w' : ''}` }, wild ? '配' : '级') : null;
  let mid;
  if (face) {
    mid = el('div', { class: 'face' });
    mid.innerHTML = `<svg viewBox="0 0 20 10" aria-hidden="true" fill="#e6bd5c" stroke="currentColor" stroke-width=".9" stroke-linejoin="round" stroke-linecap="round">${CROWN[r]}</svg>`;
    mid.append(el('b', {}, r), el('i', {}, s));
  } else mid = el('div', { class: 'pip' }, s);
  return el('div', { class: `gd-c${SUIT_OF[s] === 'r' ? ' r' : ''}${r === '10' ? ' ten' : ''} ${cls}`, style: st },
    el('div', { class: 'ix' }, el('b', {}, r), el('i', {}, s)), mid, lvTag, as ? el('span', { class: 'as' }, `当${as}`) : null);
}

/** n 张牌在 maxW 里摊开（fan 为扇形） */
function spread(n, { cx, y, cw, maxW }, { step = cw * 0.52, fan = true } = {}) {
  if (!n) return [];
  const st = n > 1 ? Math.min(step, (maxW - cw) / (n - 1)) : 0;
  const total = cw + st * (n - 1);
  const x0 = cx - total / 2;
  const mid = (n - 1) / 2;
  const deg = fan ? Math.min(1.2, 18 / Math.max(n, 1)) : 0;
  const sag = fan ? Math.min(0.9, 0.05 * n) * (cw / 4) : 0;
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

// 思考计时、真人出手的软倒计时（同斗地主）
function thinkTimer(t0) { const n = el('span', { class: 'tmr', 'data-t0': String(t0) }); paintTimer(n); return n; }
function paintTimer(n) {
  const s = Math.max(0, Math.floor((Date.now() - Number(n.dataset.t0)) / 1000));
  n.textContent = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
  n.classList.toggle('warm', s >= 30 && s < 90);
  n.classList.toggle('hot', s >= 90);
}
const CD_LEN = +(2 * Math.PI * 15).toFixed(2);
function countdown(t0) {
  const n = el('div', { class: 'gd-cd', 'data-t0': String(t0), title: `建议 ${CD_SECS} 秒内出手（只是提醒，不会自动出牌）`, role: 'timer' });
  n.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15"/><circle class="fg" cx="18" cy="18" r="15" stroke-dasharray="${CD_LEN}"/></svg><b></b>`;
  const fg = n.querySelector('.fg');
  fg.style.setProperty('--len', String(CD_LEN));
  fg.style.animation = `gd-cd ${CD_SECS}s linear ${-Math.min(Date.now() - t0, CD_SECS * 1000)}ms both`;
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
    const ns = root.isConnected ? root.querySelectorAll('.tmr, .gd-cd') : [];
    if (!ns.length) { clearInterval(timerTick); timerTick = null; return; }
    ns.forEach((n) => (n.classList.contains('tmr') ? paintTimer(n) : paintCountdown(n)));
  }, 1000);
}

const isLive = (opts) => ('live' in opts ? !!opts.live
  : opts.replay ? false
    : opts.clock && typeof opts.clock === 'object' ? Object.keys(opts.clock).length > 0 || !!opts.movable
      : true);

/** 局面摘要（回放停顿与服务端停顿用同一份 fxDuration） */
const fxSum = (v) => (v && v.seats ? { hand: v.handNo, phase: v.phase, plays: v.plays?.length || 0, bomb: !!v.plays?.at(-1)?.bomb, over: !!v.over } : null);
const posName = (i) => ['头游', '二游', '三游', '末游'][i];

const UP = { 2: 3, 3: 2, 4: 1 };
const HOW = { 2: '队友二游（双下）', 3: '队友三游', 4: '队友末游' };
/**
 * 一盘结算：升几级和原因。返回文字片段（数字加粗），例如
 * 「1·3 队头游 + 队友二游（双下）：升 3 级 2 → 5 · 下一盘打 5」
 */
function settleParts(h, teamNames, next = true) {
  if (!h) return [];
  const T = teamNames[h.team];
  if (h.passA) return [`${T}打 A 拿头游、${HOW[h.partnerPos]}：`, ['b', '打过 A']];
  const out = [`${T}头游 + ${HOW[h.partnerPos]}：`];
  if (h.up) {
    out.push(['b', `升 ${h.up} 级`], ` ${h.before[h.team]} → ${h.after[h.team]}`);
    if (h.up < UP[h.partnerPos]) out.push('（升到 A 为止）');
  } else out.push('已经打到 A，不再升级');
  if (h.aFail) out.push(`；${teamNames[h.aFail]}打 A 未过${h.reset ? '三次，退回 2' : ''}`);
  if (next) out.push(` · 下一盘打 ${h.after[h.team]}`);
  return out;
}
const settleLine = (h, teamNames, next) => settleParts(h, teamNames, next).map((x) => (Array.isArray(x) ? x[1] : x)).join('');
const settleSpans = (h, teamNames, next) => settleParts(h, teamNames, next).map((x) => (Array.isArray(x) ? el('b', {}, x[1]) : x));
/** 座位号小圆片（名字重复时靠它分清是谁） */
const seatNo = (seat) => el('i', { class: 'no', style: `--tc:${TEAM_COLOR[teamOfSeat(seat)]}` }, String(SEATS.indexOf(seat) + 1));
/** 结算卡里的一排小牌 */
function miniRow(t, level) {
  const step = 1.3;
  const box = el('span', { class: 'mini', style: `width:${(2.2 + step * (t.cards.length - 1)).toFixed(2)}em` });
  t.cards.forEach((name, i) => box.append(cardEl(name, i * step, 0, 0.44, { level })));
  return box;
}

export default {
  hud: true,

  turnTip(view) {
    const nm = (x) => view?.seatNames?.[x] || x;
    if (view?.phase === 'back') {
      const b = view.tribute?.backs.find((x) => x.from === view.viewer);
      return b ? `轮到你还贡：还给${nm(b.to)}一张不超过 10 的牌。` : '轮到你还贡。';
    }
    if (view?.lead && !view.stale) return `轮到你：压过${nm(view.lead.seat)}的${view.lead.type}${view.lead.key ? ` ${view.lead.key}` : ''}，或者不出。`;
    return view?.wind && view.wind === view.viewer ? '轮到你接风领出。' : '轮到你领出。';
  },

  seatLine(view, seat) {
    if (!view?.counts) return '';
    const pos = view.roles?.[seat];
    return [view.teamNames?.[view.teamOf?.[seat]], pos || `剩 ${view.counts[seat]} 张`].filter(Boolean).join(' · ');
  },

  /** 本盘记录：进贡还贡一组，之后每一轮一组 */
  handLog(view) {
    if (!view?.seats) return null;
    const groups = [];
    const t = view.tribute;
    let backs = 0;
    if (t) {
      const items = [];
      if (t.anti) items.push({ seat: t.antiBy[0] || t.leader, text: '抗贡（两张大王）', blind: true });
      for (const p of t.pays) items.push({ seat: p.from, text: `进贡 ${p.card} → ${view.seatNames[p.to]}`, blind: true });
      for (const b of t.backs) if (b.done) { backs++; items.push({ seat: b.from, text: `还贡 ${b.card || '（暗牌）'} → ${view.seatNames[b.to]}` }); }
      groups.push({ street: 'trib', name: t.anti ? '抗贡' : '进贡', board: [], items });
    }
    for (const p of view.plays || []) {
      let g = groups.at(-1);
      if (!g || g.street !== `t${p.trick}`) { g = { street: `t${p.trick}`, name: `第 ${p.trick} 轮`, board: [], items: [] }; groups.push(g); }
      g.items.push({ seat: p.seat, text: p.cards ? `${p.type} ${p.cards.map((c, i) => (p.as?.[i] ? `${c}(当${p.as[i]})` : c)).join(' ')}` : '不出' });
    }
    const prev = view.history?.at(-1);
    const r = view.result;
    return {
      label: '本盘记录', title: `第 ${view.handNo}/${view.total} 盘`, sub: `打 ${view.level} · ${view.teamNames.A} ${view.levels.A} / ${view.teamNames.B} ${view.levels.B}`,
      groups, count: backs + (view.plays?.length || 0),
      last: prev && !r ? `上一盘：${settleLine(prev, view.teamNames, false)}` : null,
      result: r ? `${view.teamNames[r.winnerTeam]}胜 · ${r.passA ? '打过 A' : `${view.teamNames.A} ${r.levels.A} / ${view.teamNames.B} ${r.levels.B}`}` : null,
    };
  },

  pauseAfter(prev, view) { return fxDuration(fxSum(prev), fxSum(view)); },

  get aspect() { return typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? [10, 14] : [16, 10]; },
  seatColor: (seat) => TEAM_COLOR[teamOfSeat(seat)],

  createStage({ onAction: submit }) {
    injectStyle();
    const root = el('div', { class: 'gd board-html', role: 'group', 'aria-label': '掼蛋牌桌' });
    const box = el('div', { class: 'gd-box' });
    root.append(box);
    let layoutName = 'land';
    let last = null;
    let sel = new Set();
    let handKey = '';
    let hintIdx = -1, hintKey = '';
    let pickCode = null; // 逢人配多种组法时选的那一种
    let resHidden = null;
    let autoPass = { key: '', timer: null };
    // 交出去之后、新局面到来之前不能再点（连点会重复提交）；4 秒还没动静就恢复，以防提交失败
    let sent = { key: '', t: 0 };
    let stepNow = '';
    const onAction = (id) => { sent = { key: stepNow, t: Date.now() }; setTimeout(() => redraw(), 4100); submit(id); };
    const fx = { prev: null, lead: { key: '', t0: null }, boom: null, front: {}, cnt: {}, bub: {}, bubKey: {}, settle: { key: '', t0: null }, trib: { key: '', t0: null }, turn: { key: '', t0: 0 } };
    const felt = [el('div', { class: 'gd-rail' }), el('div', { class: 'gd-top' }), el('div', { class: 'gd-wm' }, '掼')];
    const redraw = () => last && draw(last.view, last.opts);

    const onEsc = (e) => {
      if (!root.isConnected) { document.removeEventListener('keydown', onEsc); return; }
      if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const x = box.querySelector('.gd-x');
      if (!x || !root.getClientRects().length || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      e.preventDefault();
      x.click();
    };
    document.addEventListener('keydown', onEsc);

    // 选牌：按下一张牌开始，划过的牌都跟第一张一样（选上或取消）；还贡时只能选一张；点空白处清空
    let drag = null;
    let single = false;
    const setSel = (i, on, node) => { if (on) sel.add(i); else sel.delete(i); node?.classList.toggle('sel', on); hintIdx = -1; pickCode = null; };
    box.addEventListener('pointerdown', (e) => {
      const c = e.target.closest?.('.gd-c.pick');
      if (!c) { if (sel.size && !e.target.closest?.('button')) { sel = new Set(); hintIdx = -1; pickCode = null; redraw(); } return; }
      e.preventDefault();
      const i = Number(c.dataset.i);
      if (single) { sel = sel.has(i) ? new Set() : new Set([i]); redraw(); return; }
      drag = { on: !sel.has(i), seen: new Set([i]) };
      setSel(i, drag.on, c);
      try { box.setPointerCapture(e.pointerId); } catch { /* 旧浏览器 */ }
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const c = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.gd-c.pick');
      if (!c) return;
      const i = Number(c.dataset.i);
      if (drag.seen.has(i)) return;
      drag.seen.add(i);
      setSel(i, drag.on, c);
    });
    const endDrag = () => { if (!drag) return; drag = null; redraw(); };
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);
    box.addEventListener('lostpointercapture', endDrag);

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(([e]) => {
        const { width, height } = e.contentRect;
        if (!width || !height) return;
        const name = height > width * 1.05 ? 'port' : 'land';
        if (name !== layoutName) { layoutName = name; root.classList.toggle('port', name === 'port'); redraw(); }
      }).observe(root);
    }

    /** 下方是谁、四个方位 */
    function spotsOf(view) {
      const viewer = view.viewer && SEATS.includes(view.viewer) ? view.viewer : null;
      const me = viewer || 'p1';
      const i = SEATS.indexOf(me);
      return { me, viewer, pos: { [me]: 'bottom', [SEATS[(i + 1) % 4]]: 'right', [SEATS[(i + 2) % 4]]: 'top', [SEATS[(i + 3) % 4]]: 'left' } };
    }

    function leadOf(view) {
      const e = endPlay(view);
      if (e) return e;
      if (view.lead && !view.stale) return { seat: view.lead.seat, t: view.lead, stale: false, end: !!view.over };
      const table = view.table || {};
      const who = view.wind ? partnerOf(view.wind) : view.turn;
      if (who && table[who]?.cards) return { seat: who, t: table[who], stale: !!view.stale };
      const any = SEATS.find((s) => table[s]?.cards);
      return any ? { seat: any, t: table[any], stale: !!view.stale } : null;
    }
    /** 一盘刚打完（新一盘还没人出牌）：上一盘最后那一手 */
    function endPlay(view) {
      const h = view.history?.at(-1);
      if (view.over || view.plays?.length || !h?.last || h.hand !== view.handNo - 1) return null;
      return { seat: h.last.seat, t: h.last, stale: false, end: true };
    }
    function frontsOf(view, lead) {
      const out = {};
      if (view.stale || view.phase !== 'play') return out;
      for (const s of SEATS) {
        const t = view.table?.[s];
        if (!t?.cards || view.turn === s) continue;
        if (lead && !lead.stale && lead.seat === s) continue;
        out[s] = t;
      }
      return out;
    }

    function track(view, animate) {
      const p = fx.prev;
      const t = now();
      const live = animate !== false && p !== null;
      const lead = leadOf(view);
      const key = lead ? `${view.handNo}|${view.trickNo}|${lead.seat}|${lead.t.cards.join(',')}` : '';
      if (key !== fx.lead.key) {
        const fresh = live && lead && !lead.stale;
        fx.lead = { key, t0: fresh ? t : null };
        fx.boom = fresh && lead.t.bomb ? t : null;
      }
      const fr = frontsOf(view, lead);
      for (const s of SEATS) {
        const k = fr[s] ? `${view.handNo}|${view.trickNo}|${fr[s].cards.join(',')}` : '';
        if (k !== (fx.front[s]?.key || '')) fx.front[s] = { key: k, t0: live && k ? t : null };
        if (p && p.counts?.[s] !== view.counts?.[s] && live) fx.cnt[s] = t;
        const b = view.table?.[s];
        const bk = b?.pass ? `${view.handNo}|${view.trickNo}|pass` : view.wind === s ? `${view.handNo}|${view.trickNo}|wind` : '';
        if (bk !== (fx.bubKey[s] || '')) { fx.bubKey[s] = bk; fx.bub[s] = live && bk && !view.stale ? t : null; }
      }
      const sk = view.history?.length ? `${view.history.length}` : '';
      if (sk !== fx.settle.key) fx.settle = { key: sk, t0: live && sk ? t : null };
      const tk = view.tribute ? `${view.handNo}|${view.tribute.backs.filter((b) => b.done).length}` : '';
      if (tk !== fx.trib.key) fx.trib = { key: tk, t0: live && tk ? t : null };
      fx.prev = view;
    }

    // 对局页的终局卡（框架画的）浮在牌桌上时，先藏起自己的终局卡，免得两张叠在一起；那张收起后再露出来
    let endObs = null;
    function watchEndCard() {
      if (endObs || typeof MutationObserver !== 'function') return;
      const host = root.closest('.board-wrap') || root.closest('.stage') || root.parentElement;
      if (!host) return;
      const sync = () => root.classList.toggle('ended', !!host.querySelector('.end-card'));
      endObs = new MutationObserver(sync);
      endObs.observe(host, { childList: true, subtree: true });
      sync();
    }

    function plate(view, seat, where, L, { me, t0, live, canAct }) {
      const pos = L[where];
      const team = view.teamOf?.[seat] || teamOfSeat(seat);
      const count = view.counts?.[seat] ?? 0;
      const done = view.finished?.includes(seat);
      const turn = live && !view.over && (view.phase === 'back' ? view.pending?.includes(seat) : view.turn === seat);
      const name = view.seatNames?.[seat] || seat;
      const cnt = el('b', {}, String(count));
      play(cnt, 'gd-jump', 520, fx.cnt[seat], 0, 'ease-out');
      const warn = view.phase === 'play' && !done && count > 0 && count <= 10;
      const status = done ? view.teamNames?.[team] : `${view.teamNames?.[team] || ''}${seat === partnerOf(me) && view.viewer ? ' · 队友' : ''}`;
      const won = view.result && view.result.winnerTeam === team;
      return el('div', { class: `gd-plate${turn ? ' on' : ''}${done ? ' done' : ''}`, style: `left:${pos.plate[0]}em;top:${pos.plate[1]}em;width:${L.plateW}em;height:${L.plateH}em;--tc:${TEAM_COLOR[team]}${won ? ';--edge-now:var(--edge-hi)' : ''}` },
        el('span', { class: 'coin' }, String(SEATS.indexOf(seat) + 1)),
        el('div', { class: 'who' }, el('b', { title: name }, name), el('span', {}, status)),
        done ? el('span', { class: 'pos' }, view.roles?.[seat] || '') : el('div', { class: `cnt${warn ? ' warn' : ''}` }, cnt, el('small', {}, '张')),
        warn ? el('div', { class: `alarm${count <= 3 ? ' hot' : ''}` }, `报 ${count}`) : null,
        turn && t0 && !(canAct && seat === me) ? thinkTimer(t0) : null,
        turn ? el('div', { class: `tag${canAct && seat === me ? ' me' : ''}${where === 'bottom' ? ' up' : ''}` }, canAct && seat === me ? '轮到你' : view.phase === 'back' ? '还贡中' : '思考中', el('i'), el('i'), el('i')) : null);
    }

    /** 别家的手牌：明牌摊开，暗牌是一叠牌背 */
    function otherHand(view, seat, where, L) {
      const h = L[where].hand;
      const names = view.hands?.[seat];
      const n = names ? names.length : Math.min(view.counts?.[seat] ?? 0, 12);
      const fs = h.cw / 5;
      const geo = spread(n, names ? h : { ...h, maxW: Math.min(h.maxW, h.cw * 3) }, { step: names ? h.cw * 0.42 : h.cw * 0.14, fan: !!names });
      return geo.map((g, i) => {
        const node = cardEl(names ? names[i] : null, g.x, g.y, fs, { level: view.level });
        if (g.rot) node.style.rotate = `${g.rot}deg`;
        node.style.transformOrigin = '50% 120%';
        return node;
      });
    }

    /** 自己的手牌：同点数叠成一列，从左到右牌力从大到小；返回 { nodes, top: 最高一列的顶边 } */
    function myHand(view, seat, L, pick, single, eligible) {
      const M = L.mine;
      const d = view.hands[seat];
      const cols = [];
      d.forEach((n, i) => {
        const r = n === '小王' || n === '大王' ? n : n.slice(1);
        const c = cols.at(-1);
        if (c && c.r === r) c.items.push(i); else cols.push({ r, items: [i] });
      });
      // 列多时允许左右压住一部分（每列至少露出 6 成，角上的点数花色看得见），牌能大一些（手机竖屏尤其）
      const width = M.x1 - M.x0;
      const nc = Math.max(cols.length, 1);
      const cw = Math.min(M.cwMax, width / (0.6 * (nc - 1) + 1));
      const gap = nc > 1 ? Math.min(cw * 1.08, (width - cw) / (nc - 1)) : 0;
      const total = gap * (cols.length - 1) + cw;
      const x0 = M.x0 + (width - total) / 2;
      const ch = cw * 1.4;
      const maxK = Math.max(1, ...cols.map((c) => c.items.length));
      const vstep = Math.min(cw * 0.36, (M.colH - ch) / Math.max(1, maxK - 1));
      const fs = cw / 5;
      const nodes = [];
      let top = M.bottom;
      cols.forEach((c, ci) => {
        const k = c.items.length;
        c.items.forEach((idx, j) => {
          const y = M.bottom - ch - (k - 1 - j) * vstep;
          top = Math.min(top, y);
          const on = sel.has(idx);
          const ok = !single || eligible.has(d[idx]);
          const node = cardEl(d[idx], x0 + ci * gap, y, fs, { cls: `${pick && ok ? 'pick' : ''}${on ? ' sel' : ''}${single && !ok ? ' dim' : ''}`, level: view.level });
          if (pick && ok) node.dataset.i = String(idx);
          nodes.push(node);
        });
      });
      return { nodes, top: top - 0.9 };
    }

    /** 桌上的一手：按给的顺序横排；from 为起飞点，fromPts 为每张的起点 */
    function playRow(t, spot, level, { cls = '', from = null, fromPts = null, fromScale = null, dur = FX.fly, t0 = null, step = 0.56 } = {}) {
      const n = t.cards.length;
      const geo = spread(n, spot, { step: spot.cw * step, fan: false });
      const fs = spot.cw / 5;
      const g = el('div', { class: `gd-play ${cls}`, style: 'inset:0' });
      t.cards.forEach((name, i) => {
        const node = cardEl(name, geo[i].x, geo[i].y, fs, { level, as: t.as?.[i] || '' });
        const p0 = fromPts ? fromPts[i] : from;
        if (p0 && t0 !== null && t0 !== undefined) {
          node.style.setProperty('--fx', `${(p0[0] - geo[i].x - spot.cw / 2) / fs}em`);
          node.style.setProperty('--fy', `${(p0[1] - geo[i].y - spot.cw * 0.7) / fs}em`);
          if (fromScale) { node.style.setProperty('--fs', String(+fromScale.toFixed(3))); node.style.setProperty('--fo', '1'); }
          play(node, 'gd-fly', dur, t0, i * (fromPts ? 10 : 22));
        }
        g.append(node);
      });
      return g;
    }
    function frontSpot(n, f, L) {
      const cw = L.frontCw;
      const st = n > 1 ? Math.min(cw * 0.5, (f.maxW - cw) / (n - 1)) : 0;
      const total = cw + st * (n - 1);
      return { cx: f.al === 'l' ? f.x + total / 2 : f.al === 'r' ? f.x - total / 2 : f.x, y: f.y, cw, maxW: f.maxW };
    }

    function plaque(view, L) {
      const tm = (t) => el('div', { class: `tm${view.levelTeam === t ? ' on' : ''}`, style: `--tc:${TEAM_COLOR[t]}` },
        el('i'), el('span', {}, view.teamNames[t]), el('b', {}, view.levels[t]),
        view.levels[t] === 'A' && view.aFails?.[t] ? el('em', {}, `A${view.aFails[t] + 1}`) : null);
      return el('div', { class: 'gd-plq', style: `left:${L.plaque[0]}em;top:${L.plaque[1]}em` },
        el('div', { class: 'lvl' }, el('small', {}, `第 ${view.handNo}/${view.total} 盘`), el('b', {}, `打${view.level}`)),
        tm('A'), tm('B'));
    }

    /** 记牌器：每个点数别家还剩几张（两副牌；玩家视角扣掉自己手里的） */
    function counter(view, viewer, L) {
      if (!L.counter) return null;
      const lv = view.level;
      const ranks = ['大王', '小王', lv, ...RANK_ORDER.slice().reverse().filter((r) => r !== lv)];
      const left = Object.fromEntries(ranks.map((r) => [r, r === '大王' || r === '小王' ? 2 : 8]));
      const rk = (n) => (n === '小王' || n === '大王' ? n : n.slice(1));
      for (const p of view.plays || []) for (const n of p.cards || []) left[rk(n)]--;
      if (viewer && view.hands?.[viewer]) for (const n of view.hands[viewer]) left[rk(n)]--;
      const cols = ranks.map((r, i) => {
        const v = Math.max(0, left[r]);
        const lab = r === '大王' ? '大' : r === '小王' ? '小' : r;
        return el('span', { class: `c${v === 0 ? ' z' : ''}${i < 2 ? ' j' : ''}${i === 2 ? ' l' : ''}` }, el('i', {}, i === 2 ? `${lab}级` : lab), el('b', {}, String(v)));
      });
      return el('div', { class: 'gd-cnt', title: viewer ? '记牌器：除了你手里的，别家还有几张' : '记牌器：每个点数还有几张没出', style: `left:${L.counter[0]}em;top:${L.counter[1]}em;grid-template-columns:auto repeat(8, 2.15em)` },
        el('small', {}, viewer ? '别家剩' : '未出'), ...cols);
    }

    /** 进贡还贡面板 */
    function tributePanel(view, L, spot, hold = 0) {
      const t = view.tribute;
      const nm = (s) => view.seatNames?.[s] || s;
      const mini = (name) => el('span', { class: 'slot' }, cardEl(name, 0, 0, 0.44, { level: view.level }));
      const rows = [];
      if (t.anti) {
        const no = (x) => `${SEATS.indexOf(x) + 1} 号位`;
        rows.push(el('div', { class: 'ln' }, t.antiBy.length > 1 ? `${t.antiBy.map(no).join('、')}各有一张大王，不进贡` : `${no(t.antiBy[0])}手里有两张大王，不进贡`));
      } else {
        const who = (x) => el('span', { class: 'nm' }, seatNo(x), el('span', {}, nm(x)));
        for (const p of t.pays) rows.push(el('div', { class: 'tr' }, who(p.from), el('span', { class: 'k' }, '进贡'), who(p.to), mini(p.card)));
        for (const b of t.backs) rows.push(el('div', { class: 'tr' }, who(b.from), el('span', { class: 'k back' }, '还贡'), who(b.to),
          b.done ? (b.card ? mini(b.card) : el('span', { class: 'wait' }, '暗牌')) : el('span', { class: 'wait' }, '…')));
      }
      const leadTxt = `${SEATS.indexOf(t.leader) + 1} 号位先出`;
      const box = el('div', { class: 'gd-paper', style: `font-size:.92em;left:${spot.cx / 0.92}em;top:${spot.y / 0.92}em;width:${spot.w / 0.92}em` },
        el('div', { class: 'hd' }, el('b', {}, t.anti ? '抗贡' : '进贡'), el('small', {}, leadTxt)), el('div', { class: 'rows' }, ...rows));
      play(box, 'gd-rise', 500, fx.trib.t0, hold, EASE);
      return box;
    }

    /** 一盘结算卡（final 时是终局卡） */
    function settleCard(view, h, spot, final) {
      const nm = (s) => view.seatNames?.[s] || s;
      const rows = h.order.map((s, i) => el('div', { class: `row${view.teamOf[s] === h.team ? ' win' : ''}` },
        el('span', { class: 'p' }, posName(i)), el('span', { class: 'n', style: `--tc:${TEAM_COLOR[view.teamOf[s]]}` }, String(SEATS.indexOf(s) + 1)),
        el('span', { class: 'nm', title: nm(s) }, nm(s)), el('span', { class: 'lf' }, h.left?.[s] ? `剩 ${h.left[s]} 张` : '')));
      const r = view.result;
      const hd = final
        ? el('div', { class: 'hd' }, el('b', {}, `${view.teamNames[r.winnerTeam]}胜`), r.passA ? el('em', {}, '过 A') : null)
        : el('div', { class: 'hd' }, el('small', {}, `第 ${h.hand} 盘 · 打 ${h.level}`), el('b', {}, h.passA ? '过 A' : h.partnerPos === 2 ? '双下' : `${view.teamNames[h.team]}头游`));
      const lines = [el('div', { class: 'ln' }, ...settleSpans(h, view.teamNames, !final))];
      if (h.last) {
        const lt = h.last;
        lines.push(el('div', { class: 'lastp' }, el('small', {}, '最后一手'), seatNo(lt.seat), el('span', { class: 'nm' }, nm(lt.seat)),
          el('span', { class: 'ty' }, `${lt.type}${lt.key ? ` ${lt.key}` : ''}`), miniRow(lt, view.level)));
      }
      if (final) lines.push(el('div', { class: 'ln' }, `${view.teamNames.A} `, el('b', {}, r.levels.A), ` · ${view.teamNames.B} `, el('b', {}, r.levels.B), `（共 ${r.hands} 盘）`));
      const card = el('div', { class: `gd-paper${final ? ' final' : ''}`, style: `left:${spot.cx}em;top:${spot.y}em;width:${spot.w}em`, role: 'status' }, hd, ...lines, el('div', { class: 'rows' }, ...rows));
      play(card, 'gd-rise', 600, fx.settle.t0, END_HOLD, EASE);
      return card;
    }

    /** 当前选中的牌能组成哪些能出的组法（逢人配可能有几种），按跟牌取小、领出取大排好 */
    function optionsFor(view, names) {
      if (!names.length) return [];
      const lv = view.levelRank;
      const cards = names.map(cardFromName);
      if (cards.some((c) => c < 0)) return [];
      const lastC = view.lead && !view.stale ? view.lead.combo : null;
      const list = interpret(cards, lv).filter((x) => beats(x, lastC));
      const strength = (x) => (isBomb(x) ? 1e6 + (x.type === 'kings' ? 1e5 : x.type === 'sflush' ? 550 + x.key : x.n * 100 + x.key) : x.key);
      list.sort((a, b) => (lastC ? strength(a) - strength(b) : strength(b) - strength(a)));
      return list.map((x) => ({ combo: x, id: playId(cards, x, lv), text: `${typeText(x)}${keyText(x, lv) ? ` ${keyText(x, lv)}` : ''}` }));
    }

    function draw(view, opts) {
      const { movable = null, actions = null } = opts;
      const L = LAYOUTS[layoutName];
      const { me, viewer, pos } = spotsOf(view);
      const canAct = !!viewer && movable === me && Array.isArray(actions) && actions.length > 0;
      const liveNow = isLive(opts);
      const calm = reduced();
      const T = now();
      const within = (t0, dur) => !calm && t0 !== null && t0 !== undefined && T - t0 < dur;
      root.classList.toggle('can-move', canAct);
      const kids = [];
      const center = [];
      let autoKeep = false;

      // 桌心
      const lead = view.phase === 'play' || view.over || endPlay(view) ? leadOf(view) : null;
      const c = L.lead;
      const leadH = c.cw * 1.4;
      kids.push(el('div', { class: 'gd-glow', style: `left:${c.cx}em;top:${c.y + leadH / 2}em;width:${c.maxW * 0.9}em;height:${leadH * 2.6}em` }));
      if (lead && !(view.over && !view.plays?.length)) {
        const row = playRow(lead.t, c, view.level, { cls: lead.stale ? 'stale' : '', from: L[pos[lead.seat]]?.from, t0: fx.lead.t0 });
        if (lead.t.bomb && fx.boom !== null) play(row, 'gd-shake', 420, fx.boom, 380, 'linear');
        center.push(row);
        kids.push(el('div', { class: `gd-lbl${lead.t.bomb ? ' boom' : ''}`, style: `left:${c.cx}em;top:${c.y + leadH + 0.8}em` },
          seatNo(lead.seat), el('span', {}, view.seatNames?.[lead.seat] || lead.seat), el('b', {}, lead.t.type || ''), lead.t.key ? el('span', {}, lead.t.key) : null,
          lead.stale ? el('span', {}, '上一轮') : lead.end ? el('em', {}, '最后一手') : null));
        if (lead.t.bomb && within(fx.boom, 1500)) {
          const cy = c.y + leadH / 2;
          kids.push(play(el('div', { class: 'gd-burst', style: `left:${c.cx}em;top:${cy}em` }), 'gd-burst', 1100, fx.boom, 300, 'ease-out'));
          kids.push(play(el('div', { class: 'gd-rays', style: `left:${c.cx}em;top:${cy}em` }), 'gd-rays', 1300, fx.boom, 300, 'ease-out'));
        }
      }
      // 各家面前那一手
      const fronts = frontsOf(view, lead);
      for (const s of SEATS) {
        const t = fronts[s];
        if (!t) continue;
        const f = L[pos[s]].front;
        const spot = frontSpot(t.cards.length, f, L);
        const cg = spread(t.cards.length, c, { step: c.cw * 0.56, fan: false });
        center.push(playRow(t, spot, view.level, { cls: 'front', step: 0.5, fromPts: cg.map((g) => [g.x + c.cw / 2, g.y + c.cw * 0.7]), fromScale: c.cw / spot.cw, dur: 420, t0: fx.front[s]?.t0 }));
      }

      // 四家：名牌、手牌、气泡
      const handKids = [];
      let mineTop = L.mine.bottom - L.mine.colH;
      single = false;
      let eligible = new Set();
      if (canAct && view.phase === 'back') {
        single = true;
        eligible = new Set(actions.map((a) => String(a.id).replace(/^还贡\s*/, '')));
      }
      for (const s of SEATS) {
        const where = pos[s];
        kids.push(plate(view, s, where, L, { me, t0: opts.clock?.[s] || null, live: liveNow, canAct }));
        if (where === 'bottom') {
          if (view.hands?.[s]) {
            const d = view.hands[s];
            const key = `${view.handNo}|${view.phase}|${d.join(',')}`;
            if (key !== handKey) { sel = new Set(); handKey = key; pickCode = null; }
            if (!canAct) sel = new Set();
            const h = myHand(view, s, L, canAct, single, eligible);
            handKids.push(...h.nodes);
            mineTop = h.top;
          } else {
            // 观众的不剧透视角：下方也是牌背
            handKids.push(...otherHand(view, s, 'top', { ...L, top: { ...L.top, hand: { cx: (L.mine.x0 + L.mine.x1) / 2, y: L.mine.bottom - 6, cw: 3, maxW: 20 } } }));
          }
        } else {
          handKids.push(...otherHand(view, s, where, L));
        }
        const b = view.table?.[s];
        const wind = view.wind === s;
        if ((b?.pass && view.phase === 'play') || wind) {
          const [bx, by, ax] = L[where].bubble;
          const bub = el('div', { class: `gd-bub ${ax}${view.stale && !wind ? ' stale' : ''}${wind ? ' wind' : ''}`, style: `left:${bx}em;top:${by}em` }, el('span', {}, wind ? '接风' : '不出'));
          play(bub, 'gd-pop', 360, fx.bub[s], 0, 'cubic-bezier(.2,1.5,.4,1)');
          kids.push(bub);
        }
      }
      kids.push(...handKids, ...center);
      kids.push(plaque(view, L));
      const cnt = counter(view, viewer, L);
      if (cnt && view.phase === 'play') kids.push(cnt);

      // 进贡还贡：还贡阶段和这一盘还没人出牌时
      const fresh = view.phase !== 'over' && !(view.plays?.length);
      // 结算卡：一盘刚打完（新一盘还没人出牌）或整场结束；和进贡面板同时在时左右（竖版上下）分开摆
      const h = view.history?.at(-1);
      const showRes = h && (view.over || fresh);
      const both = showRes && view.tribute && fresh && resHidden !== `${view.history.length}|`;
      if (view.tribute && fresh) kids.push(tributePanel(view, L, both ? L.trib2 : L.trib, showRes && fx.settle.t0 !== null && fx.trib.t0 !== null && Math.abs(fx.settle.t0 - fx.trib.t0) < 50 ? END_HOLD : 0));
      if (showRes) {
        const key = `${view.history.length}|${view.over ? 'o' : ''}`;
        if (resHidden === key) {
          kids.push(el('button', { class: 'gd-pill', type: 'button', title: '展开结算', style: `left:${L.pill[0]}em;top:${L.pill[1]}em`, onclick: (e) => { e.stopPropagation(); resHidden = null; redraw(); } }, el('span', {}, view.over ? '终局 ▸' : '结算 ▸')));
        } else {
          const card = settleCard(view, h, both ? L.res2 : L.res, view.over);
          card.append(el('button', { class: 'gd-x', type: 'button', title: '收起（Esc）', 'aria-label': '收起结算卡', onclick: (e) => { e.stopPropagation(); resHidden = key; redraw(); } }, '✕'));
          kids.push(card);
        }
      }

      // 玩家本人的操作
      if (canAct) {
        // 手机竖屏整张桌子缩得小，按钮和提示放大一些，手指点得到
        const k = L.ctlScale || 1;
        const cx = (L.mine.x0 + L.mine.x1) / 2;
        const ctlY = Math.max(mineTop - 3.6 * k, L.lead.y + L.lead.cw * 1.4 + 2.6);
        const ctl = el('div', { class: 'gd-ctl', style: `font-size:${k}em;left:${cx / k}em;top:${ctlY / k}em` });
        const stepKey = `${view.handNo}|${view.phase}|${view.plays?.length || 0}|${view.tribute?.backs.filter((b) => b.done).length || 0}`;
        if (fx.turn.key !== stepKey) fx.turn = { key: stepKey, t0: Date.now() };
        stepNow = stepKey;
        const waiting = sent.key === stepKey && Date.now() - sent.t < 4000;
        if (waiting) ctl.classList.add('sent');
        ctl.append(countdown(opts.clock?.[me] || fx.turn.t0));
        const d = view.hands[me];
        const chosen = [...sel].sort((a, b) => a - b).map((k) => d[k]);
        let tip, tcls, chips = null;
        if (view.phase === 'back') {
          const to = view.tribute?.backs.find((b) => b.from === me)?.to;
          const ok = chosen.length === 1 && eligible.has(chosen[0]);
          tip = ok ? `还给${view.seatNames?.[to] || to}：${chosen[0]}` : `还给${view.seatNames?.[to] || to}`;
          tcls = ok ? 'ok' : 'muted';
          ctl.append(
            button('提示', { onClick: () => { const n = String(actions[0].id).replace(/^还贡\s*/, ''); sel = new Set([d.indexOf(n)]); redraw(); } }),
            button('还贡', { primary: true, off: !ok, onClick: () => { const n = chosen[0]; sel = new Set(); onAction(`还贡 ${n}`); } }));
        } else {
          const list = actions.filter((a) => a.id !== 'pass');
          const canPass = actions.some((a) => a.id === 'pass');
          const key = list.map((a) => a.id).join('|');
          if (key !== hintKey) { hintKey = key; hintIdx = -1; }
          const opts2 = optionsFor(view, chosen);
          const pick = opts2.find((o) => codeOf(o.combo) === pickCode) || opts2[0] || null;
          if (!list.length) { tip = canPass ? '要不起' : ''; tcls = 'muted'; }
          else if (!sel.size) { tip = ''; tcls = 'muted'; }
          else if (pick) { tip = pick.text; tcls = 'ok'; }
          else { tip = canPass && optionsFor({ ...view, lead: null }, chosen).length ? '压不过' : '不成牌型'; tcls = 'bad'; }
          if (opts2.length > 1) {
            chips = opts2.map((o) => {
              const b = el('button', { type: 'button', class: o === pick ? 'on' : '', 'aria-pressed': String(o === pick) }, o === pick ? `✓ 作${o.text}` : `作${o.text}`);
              b.addEventListener('click', (e) => { e.stopPropagation(); pickCode = codeOf(o.combo); redraw(); });
              return b;
            });
          }
          if (!list.length) {
            const pass = () => { clearTimeout(autoPass.timer); autoPass = { key: stepKey, timer: null, done: true }; sel = new Set(); onAction('pass'); };
            const b = button('不出', { primary: true, onClick: () => { if (!autoPass.done || autoPass.key !== stepKey) pass(); } });
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
            const toIdx = (id) => {
              const used = new Set();
              for (const n of String(id).split('=')[0].split(' ')) {
                const k = d.findIndex((x, j) => x === n && !used.has(j));
                if (k >= 0) used.add(k);
              }
              return used;
            };
            ctl.append(...[
              canPass ? button('不出', { onClick: () => { sel = new Set(); onAction('pass'); } }) : null,
              button('提示', { onClick: () => { hintIdx = (hintIdx + 1) % list.length; sel = toIdx(list[hintIdx].id); pickCode = String(list[hintIdx].id).split('=')[1] || null; redraw(); } }),
              sel.size ? button('重选', { onClick: () => { sel = new Set(); hintIdx = -1; pickCode = null; redraw(); } }) : null,
              button('出牌', { primary: true, off: !pick, onClick: () => { const id = pick.id; sel = new Set(); hintIdx = -1; pickCode = null; onAction(id); } }),
            ].filter(Boolean));
          }
        }
        // 有几种组法时只列组法（选中的那个高亮），不再重复写一遍牌型
        if (tip || chips) kids.push(el('div', { class: `gd-tip ${tcls}`, style: `font-size:${k}em;left:${cx / k}em;top:${(ctlY - 2.9 * k) / k}em` }, chips ? null : el('span', {}, tip), ...(chips || [])));
        kids.push(ctl);
      }
      if (!autoKeep && autoPass.key) { clearTimeout(autoPass.timer); autoPass = { key: '', timer: null }; }
      setLayer(box, felt, kids);
      if (view.over) watchEndCard();
      if (box.querySelector('.tmr, .gd-cd')) startTimerTick(root);
    }

    return {
      el: root,
      render(view, opts = {}) {
        if (opts.players) view = { ...view, seatNames: { ...view.seatNames, ...Object.fromEntries(Object.entries(opts.players).map(([k, v]) => [k, v.name])) } };
        last = { view, opts };
        track(view, opts.animate);
        draw(view, opts);
      },
    };
  },
};
