// 麻将画面：俯视一张深红漆面牌桌（金边），四家围坐。玩家本人坐下方（观众视角下方是 1 号位），出牌顺序是下 → 右 → 上 → 左。
// 每家：名牌（座位号、名字、庄、定缺徽章、累计分和本盘杠分）、手牌（观众上帝视角四家明牌；玩家视角别家是玉色牌背）、
// 副露（碰、明杠、补杠、暗杠；别家的暗杠扣着）、胡的那张（金框）。桌心一块控制台：牌墙剩几张、第几盘、指向当前出牌人的金光。
// 四家牌河围着控制台，六张一行，从桌心往自己那边排；最新打出的那张金色描边、弹出。碰、杠、胡、自摸时在那一家面前喊字。
// 一盘结束：先打「胡」或「流局」横幅，再升起结算卡（每家胡了什么、几番、花猪 / 查叫、手牌、本盘得失、累计分），之后是新一盘的开局提示。
// 这些停顿的时长在 games/mahjong/rules.js 的 FX 里，服务端按同一份时长停（interlude），回放按 pauseAfter 停。
// 玩家本人：定缺时三个按钮（张数最少的一门亮起）；出牌时点一张抬起、再点一下打出（或点「出牌」），打了能听牌的牌上挂「听」，
// 抬起时说明听什么、剩几张；有自摸、杠时多出按钮。别人打出牌时出现「胡 / 杠 / 碰 / 过」。
// 画面用 HTML 画：根节点是尺寸容器，里面一块 80×50em 的桌面（手机竖屏换 50×70em 的竖版），所有东西用 em 定位，等比缩放。牌面用内联 SVG 自绘。
// 同时行动（定缺、响应）交出去以后按钮先收起、显示「已选」，等局面变了再说，免得以为没点上又点一次。

import { FX, pauseBetween } from '/games/mahjong/rules.js';

const SEATS = ['p1', 'p2', 'p3', 'p4'];
const SUIT_CN = { m: '万', s: '条', p: '筒' };
const SUIT_COLOR = { m: '#c0392b', s: '#1f7a4a', p: '#1d4e9e' };
const COLORS = ['var(--red)', 'var(--black-side)', '#3559b5', '#9a5d24'];
const EASE = 'cubic-bezier(.2,.75,.1,1)';
const tName = (c) => (c ? `${c[0]}${SUIT_CN[c[1]]}` : '');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 牌面（viewBox 30×40） ----------
const B = '#1d4e9e', G = '#1f7a4a', R = '#c0392b', INK = '#1b2236';
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const dot = (x, y, r, c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x}" cy="${y}" r="${+(r * 0.64).toFixed(2)}" fill="#fffaf0"/><circle cx="${x}" cy="${y}" r="${+(r * 0.34).toFixed(2)}" fill="${c}"/>`;
const DOTS = {
  2: [[15, 11, 6, G], [15, 29, 6, B]],
  3: [[7.5, 8.5, 5, B], [15, 20, 5, R], [22.5, 31.5, 5, G]],
  4: [[9, 11, 5, B], [21, 11, 5, G], [9, 29, 5, G], [21, 29, 5, B]],
  5: [[8.5, 9.5, 4.6, B], [21.5, 9.5, 4.6, G], [15, 20, 4.6, R], [8.5, 30.5, 4.6, G], [21.5, 30.5, 4.6, B]],
  6: [[9, 7.5, 4.3, G], [21, 7.5, 4.3, G], [9, 21, 4.3, R], [21, 21, 4.3, R], [9, 32, 4.3, R], [21, 32, 4.3, R]],
  7: [[7, 6, 3.6, G], [15, 10, 3.6, G], [23, 14, 3.6, G], [9, 23.5, 4, R], [21, 23.5, 4, R], [9, 33, 4, R], [21, 33, 4, R]],
  8: [6.5, 15.5, 24.5, 33.5].flatMap((y) => [[9, y, 4, B], [21, y, 4, B]]),
  9: [[8, B], [20, R], [32, G]].flatMap(([y, c]) => [7, 15, 23].map((x) => [x, y, 3.8, c])),
};
const stick = (x, y, h, c) => `<rect x="${x - 1.7}" y="${y}" width="3.4" height="${h}" rx="1.6" fill="${c}"/><path d="M${x - 1.7} ${y + h / 2}h3.4M${x} ${y + 1.2}v${h - 2.4}" stroke="#fffaf0" stroke-width=".55" opacity=".7"/>`;
const STICKS = {
  2: [[15, 4.5, 10, G], [15, 25.5, 10, B]],
  3: [[15, 4.5, 10, G], [9, 25.5, 10, G], [21, 25.5, 10, G]],
  4: [[9, 4.5, 10, G], [21, 4.5, 10, B], [9, 25.5, 10, B], [21, 25.5, 10, G]],
  5: [[8, 4.5, 10, G], [22, 4.5, 10, B], [15, 15, 10, R], [8, 25.5, 10, B], [22, 25.5, 10, G]],
  6: [7, 15, 23].flatMap((x) => [[x, 4.5, 10, G], [x, 25.5, 10, B]]),
  7: [[15, 2, 8.5, R], ...[7, 15, 23].flatMap((x) => [[x, 13, 9.5, G], [x, 27.5, 9.5, G]])],
  8: [6, 12, 18, 24].flatMap((x, k) => [[x, 4.5, 10, k % 3 ? B : G], [x, 25.5, 10, k % 3 ? G : B]]),
  9: [7, 15, 23].flatMap((x) => [2.5, 15, 27.5].map((y) => [x, y, 10, x === 15 ? R : G])),
};
const BIRD = `<path d="M15 31C8.4 31 7.2 22.6 10 18.4c1.8-2.6 3-4.4 3-6.8 0-4 5.2-4.4 5.2-1 0 2 1.6 3.2 2.6 5.6 2.4 6.2.6 14.8-5.8 14.8Z" fill="${G}"/><path d="M11.6 20.6c2.2 3 6.2 3 8 0" stroke="#e6bd5c" stroke-width="1.2" fill="none"/><circle cx="16.4" cy="10.4" r="1" fill="#fffaf0"/><path d="M18.2 10.2 21.6 11.2 18.2 12Z" fill="#d9822b"/><path d="M14.2 7.2 13 3.6M15.8 6.8l.4-3.6M12.6 8.2 10.6 5.4" stroke="${R}" stroke-width="1.1" stroke-linecap="round"/><path d="M15 31l-4.4 5.6M15 31v6.6M15 31l4.4 5.6" stroke="${B}" stroke-width="1.8" stroke-linecap="round"/><circle cx="10.6" cy="36.6" r="1.5" fill="${R}"/><circle cx="15" cy="37.6" r="1.5" fill="${R}"/><circle cx="19.4" cy="36.6" r="1.5" fill="${R}"/>`;
const faceCache = new Map();
function faceSvg(code) {
  if (faceCache.has(code)) return faceCache.get(code);
  const n = Number(code[0]), s = code[1];
  let body;
  if (s === 'm') {
    body = `<text x="15" y="16.4" text-anchor="middle" font-size="14.5" font-weight="900" fill="${INK}" font-family="'Noto Serif SC Variable','Noto Serif SC',serif">${CN[n]}</text><text x="15" y="35.6" text-anchor="middle" font-size="16" font-weight="900" fill="${R}" font-family="'Noto Serif SC Variable','Noto Serif SC',serif">萬</text>`;
  } else if (s === 'p') {
    body = n === 1 ? `${dot(15, 20, 11, B)}<circle cx="15" cy="20" r="4.6" fill="none" stroke="${R}" stroke-width="1.4"/><circle cx="15" cy="20" r="8.6" fill="none" stroke="${G}" stroke-width=".9" stroke-dasharray="1.4 1.2"/>` : DOTS[n].map(([x, y, r, c]) => dot(x, y, r, c)).join('');
  } else {
    body = n === 1 ? BIRD : STICKS[n].map(([x, y, h, c]) => stick(x, y, h, c)).join('');
  }
  const svg = `<svg viewBox="0 0 30 40" aria-hidden="true">${body}</svg>`;
  faceCache.set(code, svg);
  return svg;
}

// ---------- 版式（单位 em；横版桌面 80×50，竖版 50×70） ----------
// 每个方位：hand 行的中心、方向（玩家自己从左到右在桌上怎么走）、牌宽、旋转、最长多少（副露多了整排缩小，不压名牌）；
// river 牌河起点（靠桌心那一行）、行往哪边长；plate 名牌左上角；shout 喊字的位置；seal「胡」章贴在名牌哪个角（朝桌心那边）
// 竖版（手机）：三家的名牌并排在上沿，左右两家的手牌竖在两边，玩家本人的名牌在左下、操作条在名牌上方、手牌最大。
const LAYOUTS = {
  land: {
    w: 80, h: 50, plateFs: 1,
    bottom: { hand: { cx: 40.6, cy: 44.8, dir: [1, 0], w: 3.25, rot: 0, max: 47 }, river: { cx: 40, cy: 29.8, along: [1, 0], grow: [0, 1] }, plate: [1.8, 42.4], shout: [40, 37.4], seal: 'n e', tag: 'up' },
    right: { hand: { cx: 74.6, cy: 24.6, dir: [0, -1], w: 1.95, rot: -90, max: 34 }, river: { cx: 48.2, cy: 23.6, along: [0, -1], grow: [1, 0] }, plate: [64.8, 42.4], shout: [65, 24.5], seal: 'n w', tag: 'up' },
    top: { hand: { cx: 40, cy: 5.4, dir: [-1, 0], w: 2.25, rot: 0, max: 48 }, river: { cx: 40, cy: 16.2, along: [1, 0], grow: [0, -1] }, plate: [64.8, 1.8], shout: [40, 11.6], seal: 's w', tag: '' },
    left: { hand: { cx: 5.4, cy: 24.6, dir: [0, 1], w: 1.95, rot: 90, max: 34 }, river: { cx: 31.8, cy: 23.6, along: [0, 1], grow: [-1, 0] }, plate: [1.8, 1.8], shout: [15, 24.5], seal: 's e', tag: 'side' },
    con: { cx: 40, cy: 23, w: 11.6, h: 9.2 },
    ctl: 'left:50%;top:75.2%', wait: 'left:50%;top:76.8%', ban: 23, pill: [63.4, 38.6],
  },
  port: {
    w: 50, h: 70, plateFs: 1.15,
    bottom: { hand: { cx: 25, cy: 62.8, dir: [1, 0], w: 3.3, rot: 0, max: 47.6 }, river: { cx: 25, cy: 35.6, along: [1, 0], grow: [0, 1] }, plate: [1, 52.4], shout: [25, 46.5], seal: 'c', tag: 'up' },
    right: { hand: { cx: 47.05, cy: 31, dir: [0, -1], w: 1.9, rot: -90, max: 42 }, river: { cx: 33.2, cy: 30, along: [0, -1], grow: [1, 0] }, plate: [33.6, 1], shout: [40.5, 30], seal: 'c', tag: '' },
    top: { hand: { cx: 25, cy: 11, dir: [-1, 0], w: 2.1, rot: 0, max: 45 }, river: { cx: 25, cy: 24.4, along: [1, 0], grow: [0, -1] }, plate: [17.3, 1], shout: [25, 15.5], seal: 'c', tag: '' },
    left: { hand: { cx: 2.95, cy: 31, dir: [0, 1], w: 1.9, rot: 90, max: 42 }, river: { cx: 16.8, cy: 30, along: [0, 1], grow: [-1, 0] }, plate: [1, 1], shout: [9.5, 30], seal: 'c', tag: '' },
    con: { cx: 25, cy: 30, w: 9.4, h: 7.4 },
    ctl: 'left:50%;top:73.14%;translate:-50% -100%', wait: 'left:50%;top:73.14%;translate:-50% -100%', ban: 30, pill: [48.6, 45.4],
  },
};
const RW = 2.02; // 牌河里一张牌的宽
const TH = 1.36; // 牌高 / 牌宽

// ---------- 样式 ----------
const CSS = `
.mj { position: relative; width: 100%; height: 100%; container-type: size; overflow: clip; overflow-clip-margin: .6em; user-select: none; -webkit-user-select: none; font-family: var(--serif); }
.mj-box { position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: min(100cqw, 160cqh); height: min(62.5cqw, 100cqh); font-size: min(1.25cqw, 2cqh); }
.mj.port .mj-box { width: min(100cqw, 71.43cqh); height: min(140cqw, 100cqh); font-size: min(2cqw, 1.4286cqh); }
.mj-box > * { position: absolute; }
.mj-rail { inset: .3em .3em .9em; border-radius: 2.6em; border: .2em solid transparent;
  background: radial-gradient(70% 60% at 18% 0%, rgb(255 214 170 / .2), transparent 62%) padding-box, linear-gradient(180deg, #4a1209 0%, #2b0905 46%, #170403 100%) padding-box, var(--edge) border-box;
  box-shadow: inset 0 .14em 0 rgb(255 226 184 / .28), inset 0 -.2em .3em rgb(0 0 0 / .6), 0 .3em 0 #3b1607, 0 .55em 0 #1a0703, 0 .62em 0 .06em #050100, 0 1em 1.2em rgb(0 0 0 / .55); }
.mj-top { inset: 1.7em 1.7em 2.3em; border-radius: 1.5em; overflow: hidden;
  background: var(--grain), radial-gradient(55% 42% at 20% -4%, rgb(255 210 160 / .16), transparent 70%), radial-gradient(48% 52% at 50% 46%, rgb(170 46 22 / .45), transparent 76%),
    repeating-linear-gradient(91deg, transparent 0 1.1em, rgb(0 0 0 / .07) 1.1em 1.2em, transparent 1.2em 2.3em, rgb(255 190 140 / .035) 2.3em 2.38em),
    radial-gradient(130% 95% at 50% 112%, rgb(0 0 0 / .6), transparent 60%), linear-gradient(180deg, #57170d 0%, #3a0e08 52%, #250705 100%);
  box-shadow: inset 0 .5em 1em rgb(0 0 0 / .65), inset 0 0 0 .08em rgb(0 0 0 / .7), 0 .08em 0 rgb(255 224 176 / .16); }
.mj-top::after { content: ''; position: absolute; inset: .7em; border-radius: .9em; border: .08em solid rgb(226 186 96 / .42); pointer-events: none; }
:root[data-theme="light"] .mj-rail { box-shadow: inset 0 .14em 0 rgb(255 226 184 / .28), inset 0 -.2em .3em rgb(0 0 0 / .6), 0 .3em 0 #6a4a16, 0 .55em 0 #3e2a0a, 0 .62em 0 .06em rgb(70 44 8 / .7), 0 1em 1.2em rgb(80 48 10 / .4); }

/* 牌：象牙面，下面露一层象牙厚度、一层玉色牌背，再落影。大小全由 font-size 决定（宽 1em、高 1.36em） */
.mj-t { position: absolute; width: 1em; height: 1.36em; border-radius: .13em; pointer-events: none;
  background: radial-gradient(120% 70% at 25% 0%, #fff, rgb(255 255 255 / 0) 60%), linear-gradient(172deg, #fffdf6 0%, #f6efdc 70%, #ebdfc2 100%);
  box-shadow: inset 0 0 0 .025em rgb(110 76 28 / .55), inset 0 .03em 0 #fff, 0 .05em 0 #e2d3ae, 0 .09em 0 #c9b88c, 0 .1em 0 #2f8a63, 0 .15em 0 #17573d, 0 .2em .22em rgb(0 0 0 / .5); }
.mj-t svg { position: absolute; left: .07em; top: .08em; width: .86em; height: 1.2em; }
.mj-t.bk { background: radial-gradient(90% 60% at 30% 12%, rgb(160 255 210 / .25), transparent 70%), linear-gradient(165deg, #2f9a6c 0%, #1b6b4a 55%, #0f4a32 100%);
  box-shadow: inset 0 0 0 .05em #e7f6ec, inset 0 0 0 .08em #d4ab52, inset 0 0 0 .1em rgb(15 74 50 / .9), 0 .05em 0 #e2d3ae, 0 .09em 0 #c9b88c, 0 .14em .2em rgb(0 0 0 / .5); }
.mj-t.bk::after { content: ''; position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: .34em; height: .34em; rotate: 45deg; border: .035em solid rgb(240 205 120 / .8); }
.mj-t.dim { filter: saturate(.25) brightness(.72); }
.mj-t.gone { opacity: .28; }
.mj-t.won { box-shadow: inset 0 0 0 .025em rgb(110 76 28 / .55), 0 .05em 0 #e2d3ae, 0 .09em 0 #c9b88c, 0 .1em 0 #2f8a63, 0 0 0 .07em #f0cd78, 0 0 .5em .1em rgb(255 214 120 / .7); }
.mj-t.hot { box-shadow: inset 0 0 0 .025em rgb(110 76 28 / .55), 0 .05em 0 #e2d3ae, 0 .09em 0 #c9b88c, 0 .1em 0 #2f8a63, 0 0 0 .06em #f6dc94, 0 0 .45em .08em rgb(255 214 120 / .75); }
.mj-t.hot::before { content: ''; position: absolute; left: 50%; top: -.36em; translate: -50% 0; border: .13em solid transparent; border-top: .18em solid #f6dc94; filter: drop-shadow(0 .03em .03em rgb(0 0 0 / .6)); animation: mj-bob 1s ease-in-out infinite; }
.mj-t.pick { pointer-events: auto; cursor: pointer; transition: translate .14s cubic-bezier(.2,1.2,.4,1); }
.mj-t.pick:hover { translate: 0 -.1em; }
.mj-t.sel { translate: 0 -.32em; box-shadow: inset 0 0 0 .025em rgb(110 76 28 / .55), 0 .05em 0 #e2d3ae, 0 .09em 0 #c9b88c, 0 .1em 0 #2f8a63, 0 0 0 .05em #e0b454, 0 0 .5em rgb(240 205 120 / .6); }
.mj-t.sel.pick:hover { translate: 0 -.36em; }
.mj-t.no { filter: saturate(.3) brightness(.62); cursor: not-allowed; }
.mj-t .ting { position: absolute; left: 50%; top: -.42em; translate: -50% 0; font: 700 .26em/1 var(--sans); padding: .2em .35em; border-radius: .6em; color: var(--on-gold); background: var(--gold-metal); box-shadow: 0 .1em .2em rgb(0 0 0 / .5); white-space: nowrap; }

/* 名牌 */
.mj-plate { width: 13.4em; height: 5.4em; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: .5em; padding: 0 .8em 0 .6em; border-radius: 1em; border: .14em solid transparent; color: var(--text); box-sizing: border-box;
  --edge-now: var(--edge); background: var(--glint), var(--surface), var(--edge-now) border-box;
  box-shadow: var(--hi), 0 .18em 0 #3e2a0a, 0 .26em 0 .04em #040100, 0 .55em .8em rgb(0 0 0 / .55); }
:root[data-theme="light"] .mj-plate { box-shadow: var(--hi), 0 .18em 0 #8e6824, 0 .26em 0 .04em rgb(70 44 8 / .7), 0 .55em .8em rgb(40 14 4 / .5); }
.mj-plate.on { --edge-now: var(--edge-hi); z-index: 2; }
.mj-plate.on::after { content: ''; position: absolute; inset: -.14em; z-index: -1; border-radius: inherit; pointer-events: none; opacity: 0;
  box-shadow: 0 0 0 .1em #040100, 0 0 0 .38em rgb(42 11 8 / .9), 0 0 0 .52em #f6dc94, 0 0 3em .7em rgb(255 214 120 / .5); animation: mj-turn 1.6s ease-in-out infinite; }
.mj-plate.hu { --edge-now: var(--edge-hi); }
.mj-plate .coin { font-size: 1.3em; width: 2em; height: 2em; flex: none; font-family: var(--num); font-weight: 600; }
.mj-plate .who { display: grid; gap: .3em; min-width: 0; }
.mj-plate .who b { font: 900 1.25em/1.1 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mj-plate .who span { display: flex; overflow: hidden; gap: .35em; align-items: center; font: 600 .9em/1 var(--sans); color: var(--muted); white-space: nowrap; }
.mj-plate .zhuang { font: 400 1.05em/1 var(--brush); color: #fff4e0; width: 1.45em; height: 1.45em; display: grid; place-items: center; border-radius: 50%;
  background: radial-gradient(circle at 34% 24%, #ff8a72, #d23a26 46%, #8e1b12); box-shadow: 0 0 0 .08em #e6bd5c; }
.mj-plate .que { font: 400 1.05em/1 var(--brush); width: 1.45em; height: 1.45em; display: grid; place-items: center; border-radius: .3em; color: #fffaf0; box-shadow: 0 0 0 .08em #e6bd5c, 0 .1em .2em rgb(0 0 0 / .4); }
.mj-plate .que.wait { background: rgb(10 3 2 / .5); color: rgb(242 227 194 / .6); font: 700 .8em/1 var(--sans); width: auto; padding: 0 .4em; }
.mj-plate .sc { display: grid; justify-items: end; gap: .15em; }
.mj-plate .sc b { font: 600 1.7em/1 var(--num); font-variant-numeric: tabular-nums; }
.mj-plate .sc small { font: 600 .85em/1 var(--num); color: var(--muted); }
.mj-plate .sc .up { color: #f6dc94; } .mj-plate .sc .dn { color: #ff9a80; }
/* 「胡」章贴在名牌朝桌心的那个角外面（n 上、s 下、e 右端、w 左端），不压分数；竖版压在座位号的角上 */
.mj-plate .seal { position: absolute; width: 2.2em; height: 2.2em; display: grid; place-items: center; border-radius: 50%; z-index: 3;
  font: 400 1.3em/1 var(--brush); color: #fff4e0; background: radial-gradient(circle at 34% 24%, #ff8a72, #d23a26 46%, #8e1b12);
  box-shadow: inset 0 .07em 0 rgb(255 220 200 / .6), 0 0 0 .08em #6a4a14, 0 0 0 .16em #e6bd5c, 0 .2em .3em .1em rgb(0 0 0 / .45); }
.mj-plate .seal.n { bottom: calc(100% + .15em); } .mj-plate .seal.s { top: calc(100% + .15em); }
.mj-plate .seal.e { right: .2em; } .mj-plate .seal.w { left: .2em; }
.mj-plate .seal.c { left: 1.05em; top: -.3em; font-size: .8em; }
.mj-plate .seal small { position: absolute; right: -.25em; bottom: -.2em; font: 700 .42em/1 var(--num); padding: .25em .4em; border-radius: .8em; color: var(--on-gold); background: var(--gold-metal); }
.mj-plate .tag { position: absolute; left: 50%; top: calc(100% + .45em); translate: -50% 0; display: flex; align-items: center; gap: .35em; white-space: nowrap; padding: .3em .8em .34em; border-radius: 1em;
  font: 700 1em/1 var(--sans); letter-spacing: .1em; color: var(--on-gold); background: var(--gold-metal); box-shadow: var(--gold-key-sh), 0 .3em .6em rgb(0 0 0 / .45); z-index: 3; }
.mj-plate .tag.up { top: auto; bottom: calc(100% + .45em); }
.mj-plate .tag.side { left: calc(100% + .6em); top: 50%; translate: 0 -50%; }
.mj-plate .tag.me { color: #fff4e0; background: linear-gradient(180deg, #e2523d, #8e1b12); }
.mj-plate .tag i { width: .34em; height: .34em; border-radius: 50%; background: currentColor; animation: mj-dot 1.2s ease-in-out infinite; }
.mj-plate .tag i:nth-child(2) { animation-delay: .2s; } .mj-plate .tag i:nth-child(3) { animation-delay: .4s; }
.mj-plate .tmr { position: absolute; right: -.5em; bottom: -.8em; font: 700 .95em/1 var(--num); padding: .25em .5em .28em; border-radius: .8em; color: #2a1206; z-index: 3;
  background: linear-gradient(180deg, #fff3c8, #f0cd78); box-shadow: 0 .1em 0 #8e6824, 0 .2em .4em rgb(0 0 0 / .4); font-variant-numeric: tabular-nums; }
.mj-plate .tmr.warm { background: linear-gradient(180deg, #ffd9a0, #f09a3c); }
.mj-plate .tmr.hot { color: #fff4e0; background: linear-gradient(180deg, #ff8a6a, #c42d1e); }

/* 桌心控制台：剩余牌数、第几盘；四边一道金光指向当前出牌的人 */
.mj-con { translate: -50% -50%; display: grid; place-items: center; align-content: center; gap: .3em; border-radius: 1.1em; border: .14em solid transparent; color: var(--text);
  background: radial-gradient(80% 70% at 50% 30%, rgb(255 220 170 / .1), transparent 70%) padding-box, linear-gradient(180deg, #1c0604, #0c0201) padding-box, var(--edge) border-box;
  box-shadow: inset 0 .3em .8em rgb(0 0 0 / .8), 0 .2em .5em rgb(0 0 0 / .6); }
.mj-con small { font: 600 .9em/1 var(--sans); letter-spacing: .2em; color: rgb(240 205 120 / .8); }
.mj-con b { font: 600 3em/1 var(--num); font-variant-numeric: tabular-nums; background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; }
.mj-con b.low { background: linear-gradient(180deg, #ffd9b0, #ff7a5a 50%, #d23a26); -webkit-background-clip: text; background-clip: text; }
.mj-con span { font: 600 .85em/1 var(--sans); color: rgb(242 227 194 / .72); letter-spacing: .08em; } /* 控制台在两种主题下都是深色，不用主题色 */
.mj-con .ray { position: absolute; border-radius: 1em; background: linear-gradient(90deg, transparent, #f6dc94, transparent); box-shadow: 0 0 .8em .2em rgb(255 214 120 / .55); animation: mj-turn 1.6s ease-in-out infinite; opacity: .4; }
.mj-con .ray.v { background: linear-gradient(180deg, transparent, #f6dc94, transparent); }

/* 喊字：碰、杠、胡、自摸 */
.mj-sh { translate: -50% -50%; z-index: 6; pointer-events: none; }
.mj-shout { display: block; font: 400 4.4em/1 var(--brush); letter-spacing: .06em; white-space: nowrap; padding: 0 .1em;
  background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 .03em 0 rgb(40 12 2 / .9)) drop-shadow(0 .06em .12em rgb(0 0 0 / .7)); }
.mj-shout.big { font-size: 6em; background: linear-gradient(180deg, #ffe6c8 0%, #ff9a6a 40%, #d23a26 62%, #ff7050 100%); -webkit-background-clip: text; background-clip: text; }
.mj-glow { translate: -50% -50%; width: 22em; height: 22em; border-radius: 50%; pointer-events: none; z-index: 5; mix-blend-mode: screen;
  background: radial-gradient(closest-side, rgb(255 246 210 / .8), rgb(255 200 110 / .45) 30%, rgb(240 140 60 / .15) 55%, transparent 72%); }

/* 横幅：胡了 / 流局 */
.mj-ban { left: 50%; translate: -50% -50%; z-index: 8; pointer-events: none; display: grid; justify-items: center; gap: .2em; padding: .5em 7em .8em; white-space: nowrap;
  background: linear-gradient(90deg, transparent, #e6bd5c 18%, #f6dc94 50%, #e6bd5c 82%, transparent) top / 100% .16em no-repeat,
    linear-gradient(90deg, transparent, #e6bd5c 18%, #f6dc94 50%, #e6bd5c 82%, transparent) bottom / 100% .16em no-repeat,
    linear-gradient(90deg, transparent, rgb(142 27 18 / .97) 16%, rgb(190 46 30) 50%, rgb(142 27 18 / .97) 84%, transparent); }
.mj-ban b { font: 400 5.6em/1.05 var(--brush); letter-spacing: .1em; background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 .1em; filter: drop-shadow(0 .03em 0 rgb(40 12 2 / .9)); }
.mj-ban span { font: 600 1.3em/1.2 var(--sans); letter-spacing: .16em; color: #fbe8c8; }

/* 结算卡 */
.mj-veil { inset: 1.7em 1.7em 2.3em; border-radius: 1.5em; background: rgb(8 2 1 / .5); z-index: 6; pointer-events: none; }
.mj-res { left: 50%; top: 4.2em; translate: -50% 0; width: 58em; z-index: 7; display: grid; gap: .6em; padding: 1em 1.4em 1.2em; border-radius: 1.2em; color: #3a1a0c; background: var(--paper-face); box-sizing: border-box;
  box-shadow: inset 0 .06em 0 rgb(255 255 255 / .85), inset 0 0 0 .06em rgb(120 84 30 / .45), 0 0 0 .3em rgb(42 11 8 / .55), 0 0 0 .38em rgb(226 186 96 / .55), 0 .15em 0 .38em #6a4a14, 0 1.2em 2.4em rgb(0 0 0 / .6); }
.mj-res .hd { display: flex; align-items: baseline; justify-content: center; gap: .8em; }
.mj-res .hd b { font: 400 3.2em/1.05 var(--brush); color: #a3261a; letter-spacing: .04em; }
.mj-res .hd span { font: 600 1.1em/1 var(--sans); color: #6a4a2a; letter-spacing: .08em; }
.mj-res .rows { display: grid; gap: .35em; }
.mj-res .row { display: grid; grid-template-columns: 1.9em 7.5em 12em minmax(0, 1fr) 4.6em 4.6em; align-items: center; gap: .6em; padding: .4em .7em .4em .5em; border-radius: .6em; min-height: 3.4em; }
.mj-res .row.win { background: linear-gradient(90deg, rgb(226 186 96 / .42), rgb(226 186 96 / .08)); box-shadow: inset .25em 0 0 #c8983c; }
.mj-res .row .n { width: 1.8em; height: 1.8em; border-radius: 50%; display: grid; place-items: center; font: 700 1em/1 var(--num); color: #fbe8c8; background: #6a2a14; }
.mj-res .row .nm { font: 700 1.2em/1.2 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mj-res .row .rs { display: grid; gap: .2em; font: 600 .95em/1.25 var(--sans); color: #6a4a2a; }
.mj-res .row .rs b { font: 400 1.5em/1 var(--brush); color: #a3261a; }
.mj-res .row .rs i { font-style: normal; font-size: .9em; color: #8a6a4a; }
.mj-res .row .tiles { position: relative; height: 2.6em; }
.mj-res .row .v { font: 700 1.6em/1 var(--num); text-align: right; font-variant-numeric: tabular-nums; color: #6a5a4a; }
.mj-res .row .v.up { color: #b4241a; }
.mj-res .row .tot { font: 600 1.15em/1 var(--num); text-align: right; color: #8a6a4a; }
.mj-res .row .tot small { display: block; font: 600 .7em/1.2 var(--sans); }
.mj.port .mj-res { top: 2.4em; width: 47em; padding: .9em 1em 1em; }
.mj.port .mj-res .row { grid-template-columns: 1.9em 6.6em minmax(0, 1fr) 4em 3.8em; row-gap: .35em; }
.mj.port .mj-res .row .tiles { grid-column: 2 / -1; grid-row: 2; }
.mj.port .mj-res .row .v { font-size: 1.45em; }
.mj-res .final { display: grid; gap: .3em; padding-top: .5em; border-top: .08em dashed rgb(120 84 30 / .4); }
.mj-res .final .ttl { font: 400 1.8em/1 var(--brush); color: #a3261a; text-align: center; }
.mj-res .final table { border-collapse: collapse; font: 600 1em/1.4 var(--num); color: #5a3a1a; justify-self: center; }
.mj-res .final td, .mj-res .final th { padding: .1em .7em; text-align: right; }
.mj-res .final th { font: 700 .85em/1.4 var(--sans); color: #8a6a4a; }
.mj-res .final td:first-child, .mj-res .final th:first-child { text-align: left; font-family: var(--serif); }
.mj-res .final tr.lead td { color: #a3261a; background: none; }
.mj-res .final tr, .mj-res .final td, .mj-res .final th { background: none; border: 0; }
.mj-x { position: absolute; right: .55em; top: .55em; width: 2.1em; height: 2.1em; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
  font: 700 1.05em/1 var(--sans); color: #6a4a2a; background: rgb(120 84 30 / .12); box-shadow: inset 0 0 0 .07em rgb(120 84 30 / .3); }
.mj-x:hover, .mj-x:focus-visible { color: #a3261a; background: rgb(120 84 30 / .22); }
.mj-pill { font: inherit; translate: -100% 0; display: flex; align-items: center; padding: .5em .95em .55em; border-radius: 1.2em; border: .12em solid transparent; cursor: pointer; z-index: 7; white-space: nowrap;
  color: var(--on-gold); background: var(--gold-metal) padding-box, linear-gradient(180deg, #fbe8a6, #8e6824) border-box; box-shadow: var(--gold-key-sh), 0 .3em .6em rgb(0 0 0 / .45); }
.mj-intro { left: 50%; top: 50%; translate: -50% -50%; z-index: 8; pointer-events: none; display: grid; justify-items: center; gap: .4em; padding: 1em 2.6em 1.2em; border-radius: 1.2em; border: .14em solid transparent;
  color: var(--text); background: var(--glint), var(--surface), var(--edge-hi) border-box; box-shadow: var(--hi), 0 .6em 1.4em rgb(0 0 0 / .6); }
.mj-intro b { font: 400 3.4em/1 var(--brush); background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 .1em; }
.mj-intro span { font: 600 1.1em/1 var(--sans); letter-spacing: .1em; color: var(--muted); }

/* 玩家本人的操作条 */
.mj-ctl { translate: -50% 0; width: max-content; z-index: 5; display: flex; align-items: center; gap: .8em; padding: .45em .6em .5em .9em; border-radius: 1.2em; white-space: nowrap;
  background: rgb(10 3 2 / .72); box-shadow: inset 0 .06em .2em rgb(0 0 0 / .6), 0 0 0 .08em rgb(240 205 120 / .38), 0 .4em 1em rgb(0 0 0 / .45); animation: mj-rise .3s ${EASE} both; }
.mj-ctl .tip { font: 700 1.1em/1.2 var(--sans); color: #f6dc94; letter-spacing: .05em; }
.mj-ctl .tip.muted { color: rgb(242 227 194 / .7); font-weight: 600; }
.mj-ctl .tip .mini { position: relative; display: inline-block; width: 2em; height: 2.72em; vertical-align: middle; margin: 0 .3em; }
.mj-ctl .btn { font-size: 1.3em; padding: .28em 1em; min-width: 3.6em; --d: .16em; }
.mj-ctl .btn .q { display: inline-block; width: .6em; height: .6em; border-radius: 50%; margin-right: .35em; vertical-align: .05em; }
.mj-pill > span, .mj-wait > span { font: 700 1.05em/1 var(--sans); letter-spacing: .08em; }
.mj-wait { translate: -50% 0; width: max-content; z-index: 4; pointer-events: none; color: #f6dc94; padding: .4em .9em; border-radius: 1em; background: rgb(10 3 2 / .6); white-space: nowrap; }

/* 竖版（手机）：名牌大一号；操作条在玩家名牌上方、按钮放大到手指点得准，放不下就折行 */
.mj.port .mj-plate { font-size: 1.15em; }
.mj.port .mj-ctl { font-size: 1.6em; flex-wrap: wrap; justify-content: center; gap: .45em .6em; max-width: 29.6em; white-space: normal; padding: .45em .6em; }
.mj.port .mj-ctl .btn { min-width: 3.2em; padding: .28em .75em; }
.mj.port .mj-ban { padding: .5em 3em .8em; }
.mj.port .mj-ban b { font-size: 4.6em; }
.mj.port .mj-ctl .tip.lbl { display: none; }
.mj.port .mj-wait { font-size: 1.4em; }
.mj.port .mj-intro { font-size: 1.15em; }

@keyframes mj-turn { 50% { opacity: 1; } }
@keyframes mj-dot { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-.15em); } }
@keyframes mj-bob { 50% { transform: translateY(.08em); } }
@keyframes mj-rise { from { transform: translateY(1em) scale(.92); opacity: 0; } }
@keyframes mj-drop { from { transform: translate(var(--fx, 0), var(--fy, 0)) scale(1.5); opacity: 0; } 55% { opacity: 1; } }
@keyframes mj-shout { 0% { transform: scale(.3); opacity: 0; } 14% { transform: scale(1.15); opacity: 1; } 22% { transform: none; } 80% { opacity: 1; } 100% { transform: translateY(-.3em); opacity: 0; } }
@keyframes mj-burst { 0% { transform: scale(.1); opacity: 0; } 15% { opacity: 1; } 100% { transform: scale(1.4); opacity: 0; } }
@keyframes mj-ban { 0% { transform: scaleX(.08); opacity: 0; } 14% { transform: scaleX(1.03); opacity: 1; } 22% { transform: none; } 84% { opacity: 1; } 100% { transform: translateY(-1em); opacity: 0; } }
@keyframes mj-pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } }
@keyframes mj-fade { from { opacity: 0; } }
@keyframes mj-out { to { opacity: 0; } }
@media (pointer: coarse) { .mj-x::before { content: ''; position: absolute; inset: -12px; } }
@media (prefers-reduced-motion: reduce) { .mj-plate.on::after, .mj-con .ray, .mj-t.hot::before { animation: none; opacity: 1; } }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('mj-style')) return;
  const st = document.createElement('style');
  st.id = 'mj-style';
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
  while (box.childNodes.length > fixed.length) box.lastChild.remove();
  box.append(...kids);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** 按开始时刻 t0 播放动画；已经播完就不播。重画时用负的延迟接着播 */
function play(node, name, dur, t0, delay = 0, ease = EASE) {
  if (t0 === null || t0 === undefined || reduced()) return node;
  const passed = now() - t0;
  if (passed > delay + dur) return node;
  node.style.animation = `${name} ${dur}ms ${ease} ${Math.round(delay - passed)}ms both`;
  return node;
}

/** 一张牌：中心 (cx, cy)，牌宽 w，旋转 rot；code 为 null 时是牌背 */
function tileEl(code, cx, cy, w, rot = 0, cls = '') {
  const h = w * TH;
  const n = el('div', { class: `mj-t${code ? '' : ' bk'}${cls ? ` ${cls}` : ''}`, style: `left:${+((cx - w / 2) / w).toFixed(3)}em;top:${+((cy - h / 2) / w).toFixed(3)}em;font-size:${w}em${rot ? `;rotate:${rot}deg` : ''}` });
  if (code) n.insertAdjacentHTML('afterbegin', faceSvg(code));
  return n;
}

const seatNo = (seat) => SEATS.indexOf(seat) + 1;
const sgn = (v) => (v > 0 ? `+${v}` : String(v));
const isLive = (opts) => ('live' in opts ? !!opts.live : opts.replay ? false : opts.clock && typeof opts.clock === 'object' ? Object.keys(opts.clock).length > 0 || !!opts.movable : true);

/** 画面和服务端停顿共用的局面摘要（字段和 games/mahjong/index.js 的 summary 一致） */
const pick = (v) => (v && v.players ? {
  handNo: v.handNo, que: !!v.queDone, wins: v.wins || 0, calls: v.calls || 0, over: !!v.over,
  end: v.last && (v.last.no !== v.handNo || v.over) ? v.last.end : null,
} : null);

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
    const ns = root.isConnected ? root.querySelectorAll('.mj-plate .tmr') : [];
    if (!ns.length) { clearInterval(timerTick); timerTick = null; return; }
    ns.forEach(paintTimer);
  }, 1000);
}


export default {
  // 对局页用「牌桌 + 右侧聚光框 + 本局记录」版式：牌桌上已有每家的名牌、分数和动作
  hud: true,

  turnTip(view) {
    if (view?.phase === 'que') return '选一门不要的牌（定缺）：张数最少的一门已经亮起。';
    if (view?.phase === 'react') return '别人打出的牌你可以要：胡、杠、碰，或者过。';
    return '轮到你出牌：点一张抬起，再点一下打出。挂「听」的牌打出去就听牌。';
  },

  seatLine(view, seat) {
    const p = view?.players?.find((q) => q.seat === seat);
    if (!p) return '';
    return [`累计 ${sgn(p.total)}`, p.dealer && !view.over ? '庄' : null, p.que ? `缺${SUIT_CN[p.que]}` : null, p.won ? `第 ${p.won.order} 个胡` : null].filter(Boolean).join(' · ');
  },

  /** 本盘记录：定缺一组，之后是行牌 */
  handLog(view) {
    if (!view?.players) return null;
    const groups = [];
    for (const e of view.log || []) {
      const que = /定缺/.test(e.text) && (!groups.length || groups.at(-1).street === 'que');
      const key = que ? 'que' : 'play';
      let g = groups.at(-1);
      if (!g || g.street !== key) { g = { street: key, name: que ? '定缺' : '行牌', board: [], items: [] }; groups.push(g); }
      g.items.push({ seat: e.seat, text: e.text });
    }
    const lastLine = view.last && view.last.no !== view.handNo ? `上一盘：${view.last.seats.map((x, j) => `${j + 1} 号 ${sgn(x.delta)}`).join('，')}` : null;
    const done = view.phase === 'done' && view.last && view.last.no === view.handNo;
    return {
      label: '本盘记录', title: `第 ${view.handNo} 盘`, sub: `共 ${view.hands} 盘 · 剩 ${view.wall} 张`,
      groups, count: (view.log || []).length, last: lastLine,
      result: done ? view.last.seats.map((x, j) => `${j + 1} 号 ${sgn(x.delta)}`).join('，') : null,
    };
  },

  pauseAfter: (a, b) => pauseBetween(pick(a), pick(b)),
  get aspect() { return typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? [10, 14] : [16, 10]; },
  seatColor: (seat, i) => COLORS[(i ?? SEATS.indexOf(seat)) % COLORS.length],

  createStage({ onAction }) {
    injectStyle();
    const root = el('div', { class: 'mj board-html', role: 'group', 'aria-label': '麻将牌桌' });
    const box = el('div', { class: 'mj-box' });
    root.append(box);
    const felt = [el('div', { class: 'mj-rail' }), el('div', { class: 'mj-top' })];
    let last = null;
    let sel = null; // 抬起的那张（手牌里的序号）
    let selKey = '';
    let resHidden = null;
    const fx = { prev: null, ev: { n: -1, hand: -1, t0: null }, settle: { key: '', t0: null }, que: null };
    const redraw = () => last && draw(last.view, last.opts);
    // 刚交出去的行动：同时行动（定缺、响应窗口）要等别人也答完局面才变，这期间按钮先收起来，免得以为没点上又点一次
    let sent = null; // { key, at, acked, tip }
    const stateKey = (v) => `${v.handNo}|${v.phase}|${v.ev?.n ?? -1}|${(v.log || []).length}`;
    function send(action, tip = null) {
      sent = { key: last ? stateKey(last.view) : '', at: now(), acked: false, tip };
      sel = null;
      onAction(action);
      redraw();
    }
    /** 每次重画前：局面变了、或者框架确认过又来要行动（上次没交上），就放开按钮 */
    function settleSent(view, opts) {
      if (!sent) return;
      if (stateKey(view) !== sent.key || now() - sent.at > 45000) { sent = null; return; }
      if (!opts.movable) sent.acked = true;
      else if (sent.acked) sent = null;
    }
    // 容器竖长（手机竖屏）时换竖版
    // 先按屏宽猜一个（和 aspect 一致），免得第一帧用横版画在竖的框里
    let LY = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? LAYOUTS.port : LAYOUTS.land;
    root.classList.toggle('port', LY === LAYOUTS.port);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(([e]) => {
        const { width, height } = e.contentRect;
        if (!width || !height) return;
        const next = height > width * 1.05 ? LAYOUTS.port : LAYOUTS.land;
        if (next !== LY) { LY = next; root.classList.toggle('port', next === LAYOUTS.port); redraw(); }
      }).observe(root);
    }

    const onEsc = (e) => {
      if (!root.isConnected) { document.removeEventListener('keydown', onEsc); return; }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const x = box.querySelector('.mj-x');
      if (!x || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      e.preventDefault();
      x.click();
    };
    document.addEventListener('keydown', onEsc);

    function track(view, opts) {
      const p = fx.prev;
      const t = now();
      const live = opts.animate !== false && p !== null && isLive(opts);
      const ev = view.ev;
      const evKey = ev ? ev.n : -1;
      if (evKey !== fx.ev.n || view.handNo !== fx.ev.hand) fx.ev = { n: evKey, hand: view.handNo, t0: live && ev ? t : null };
      const sk = view.last ? `${view.last.no}|${view.over ? 1 : 0}` : '';
      if (sk !== fx.settle.key) fx.settle = { key: sk, t0: live && view.last ? t : null };
      if (p && !p.queDone && view.queDone && view.handNo === p.handNo && live) fx.que = t;
      fx.prev = view;
    }

    /** 一家的一排：手牌（摸到的那张隔开）、胡的那张、副露 */
    function handRow(view, p, pos, { me, canPick, legal, hints }) {
      const H = LY[pos].hand;
      const big = pos === 'bottom';
      const w = H.w;
      const mw = big ? w * 0.78 : w; // 副露小一号
      // items：{ code, w, gap, cls, i（手牌里的序号，能点的牌才有） }
      const hand = p.hand;
      // 摸到的那张放最右边、隔开一点
      const drawnIdx = hand && p.drawn ? hand.lastIndexOf(p.drawn) : -1;
      const items = hand
        ? hand.map((c, k) => ({ code: c, w, gap: 0, i: k })).filter((it) => it.i !== drawnIdx)
        : Array.from({ length: p.count }, () => ({ code: null, w, gap: 0 }));
      if (drawnIdx >= 0) items.push({ code: p.drawn, w, gap: w * 0.3, i: drawnIdx });
      if (p.won) {
        // 胡的那张：手里已经含着它，去掉一张同样的（看不见的手牌去掉一张牌背），单独金框摆出来；胡了的人手牌在玩家视角扣着
        const k = hand ? items.findLastIndex((x) => x.code === p.won.t) : items.length - 1;
        if (k >= 0) items.splice(k, 1);
        items.push({ code: p.won.t, w, gap: w * 0.35, cls: 'won' });
      }
      let first = true;
      for (const m of p.melds) {
        const k = m.k === 'peng' ? 3 : 4;
        for (let j = 0; j < k; j++) {
          const face = m.k === 'an' && (j === 0 || j === 3) ? null : m.t; // 暗杠：两头扣着
          items.push({ code: face, w: mw, gap: j === 0 ? (first ? w * 0.45 : mw * 0.25) : 0 });
        }
        first = false;
      }
      let len = items.reduce((a, it) => a + it.w + it.gap, 0);
      // 副露多了（四个杠）整排等比缩小，不压到名牌
      if (len > H.max) {
        const k = H.max / len;
        for (const it of items) { it.w *= k; it.gap *= k; }
        len = H.max;
      }
      const [dx, dy] = H.dir;
      let acc = -len / 2;
      const out = [];
      items.forEach((it) => {
        acc += it.gap;
        const c = acc + it.w / 2;
        acc += it.w;
        const cx = H.cx + dx * c, cy = H.cy + dy * c;
        const pickable = canPick && it.i !== undefined && it.code;
        const idx = it.i;
        const ok = pickable && legal.has(it.code);
        const isSel = ok && sel === idx;
        const node = tileEl(it.code, cx, cy, it.w, H.rot, [it.cls, pickable ? (ok ? 'pick' : 'no') : '', isSel ? 'sel' : ''].filter(Boolean).join(' '));
        if (ok) {
          node.dataset.i = String(idx);
          node.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sel === idx) { send(`discard:${it.code}`); return; }
            sel = idx;
            redraw();
          });
          if (hints?.[it.code]) node.append(el('span', { class: 'ting' }, '听'));
        }
        out.push(node);
      });
      return out;
    }

    /** 一家的牌河：从桌心往自己那边排，六张一行（多了加宽，最多三行） */
    function riverEls(view, p, pos) {
      const R0 = LY[pos].river;
      const river = p.river.filter((r) => !r.gone);
      const per = Math.max(6, Math.ceil(river.length / 3));
      const out = [];
      const side = pos === 'left' || pos === 'right';
      const rot = side ? LY[pos].hand.rot : 0;
      const alongStep = RW + 0.04, crossStep = RW * TH + 0.08;
      const ld = view.lastDiscard;
      river.forEach((r, k) => {
        const row = Math.floor(k / per), col = k % per;
        const a = (col - (per - 1) / 2) * alongStep;
        const g = row * crossStep;
        const cx = R0.cx + R0.along[0] * a + R0.grow[0] * g;
        const cy = R0.cy + R0.along[1] * a + R0.grow[1] * g;
        const latest = ld && ld.seat === p.seat && k === river.length - 1 && !p.river.at(-1)?.gone && view.ev?.type === 'discard';
        const hot = ld && ld.seat === p.seat && k === river.length - 1 && !p.river.at(-1)?.gone;
        const node = tileEl(r.t, cx, cy, RW, rot, hot ? 'hot' : '');
        if (latest) play(node, 'mj-drop', 360, fx.ev.t0, 0, 'cubic-bezier(.2,1.2,.4,1)');
        out.push(node);
      });
      return out;
    }

    function plate(view, p, pos, { me, acting, live, t0 }) {
      const P = LY[pos];
      const [x, y] = P.plate.map((v) => +(v / LY.plateFs).toFixed(3));
      const turn = live && !view.over && (view.turn === p.seat || (view.phase === 'que' && p.queing));
      const name = view.names?.[p.seat] || p.name;
      const queEl = p.que ? el('span', { class: 'que', title: `缺${SUIT_CN[p.que]}`, style: `background:${SUIT_COLOR[p.que]}` }, SUIT_CN[p.que]) : view.phase === 'que' ? el('span', { class: 'que wait' }, p.queing ? '定缺中' : '已定缺') : null;
      if (queEl && p.que) play(queEl, 'mj-pop', 420, fx.que, SEATS.indexOf(p.seat) * 90, 'cubic-bezier(.2,1.5,.4,1)');
      const status = p.won ? p.won.title : view.phase === 'que' ? '' : `${p.count}张`;
      const node = el('div', { class: `mj-plate${turn ? ' on' : ''}${p.won ? ' hu' : ''}`, style: `left:${x}em;top:${y}em` },
        el('span', { class: 'coin' }, String(seatNo(p.seat))),
        el('div', { class: 'who' }, el('b', { title: name }, name), el('span', {}, p.dealer && !view.over ? el('span', { class: 'zhuang', title: '庄家' }, '庄') : null, queEl, status)),
        el('div', { class: 'sc' }, el('b', { class: p.total > 0 ? 'up' : p.total < 0 ? 'dn' : '' }, sgn(p.total)), p.delta ? el('small', {}, `本盘${sgn(p.delta)}`) : el('small', {}, '累计')),
        p.won ? el('div', { class: `seal ${P.seal}`, title: `第 ${p.won.order} 个胡` }, '胡', el('small', {}, String(p.won.order))) : null,
        turn && t0 && me !== p.seat ? thinkTimer(t0) : null,
        // 自己的回合：横版在名牌上挂「轮到你」；竖版操作条就在名牌上方，不再挂
        turn && view.phase !== 'que' && !(me === p.seat && acting && LY === LAYOUTS.port) ? el('div', { class: `tag${me === p.seat ? ' me' : ''}${P.tag ? ` ${P.tag}` : ''}` }, me === p.seat ? '轮到你' : '思考中', el('i'), el('i'), el('i')) : null);
      return node;
    }

    function consoleEl(view, posOf) {
      const C = LY.con;
      const wall = view.wall ?? 0;
      const kids = [el('small', {}, '余牌'), el('b', { class: wall <= 8 ? 'low' : '' }, String(wall)), el('span', {}, `第 ${view.handNo}/${view.hands} 盘`)];
      if (view.phase === 'react') kids.push(el('span', {}, '等待响应'));
      // 指向当前出牌人的金光
      const who = view.turn || (view.react ? null : null);
      if (who && !view.over) {
        const pos = posOf[who];
        const st = { bottom: `left:15%;right:15%;bottom:-.25em;height:.3em`, top: `left:15%;right:15%;top:-.25em;height:.3em`, left: `top:15%;bottom:15%;left:-.25em;width:.3em`, right: `top:15%;bottom:15%;right:-.25em;width:.3em` }[pos];
        kids.push(el('i', { class: `ray${pos === 'left' || pos === 'right' ? ' v' : ''}`, style: st }));
      }
      return el('div', { class: 'mj-con', style: `left:${C.cx}em;top:${C.cy}em;width:${C.w}em;height:${C.h}em` }, ...kids);
    }

    /** 结算卡：每家胡了什么、几番 / 流局查叫，手牌、本盘得失、累计；终局时下面加一张每盘得分表 */
    function settleCard(view, S, names) {
      const winners = S.seats.map((x, j) => ({ x, j })).filter((o) => o.x.won).sort((a, b) => a.x.won.order - b.x.won.order);
      const head = S.end === 'wall' ? `流局 · ${winners.length ? `${winners.length} 家胡了，` : ''}查叫` : '三家胡牌';
      const rows = S.seats.map((x, j) => {
        const seat = SEATS[j];
        const w = x.won;
        let rs;
        if (w) {
          rs = el('div', { class: 'rs' }, el('span', {}, el('b', {}, w.title), ` ${w.fan} 番`), el('i', {}, `第 ${w.order} 个胡 · ${w.zimo ? '自摸' : `${names(w.from)}点炮`} ${tName(w.t)}${w.items.length ? ` · ${w.items.map((it) => it.name).join(' ')}` : ''}`));
        } else {
          const st = { pig: '手里还有缺的那门，赔每家封顶', ting: `听 ${x.waits.map(tName).join(' ')}`, noting: '没听牌，赔听牌的人、退杠钱' }[x.status] || '最后一家没胡';
          rs = el('div', { class: 'rs' }, el('span', {}, el('b', {}, { pig: '花猪', ting: '听牌', noting: '未听' }[x.status] || '未胡')), el('i', {}, `${st}${x.que ? ` · 缺${x.que}` : ''}`));
        }
        // 手牌缩略：明牌 + 副露
        const tiles = el('div', { class: 'tiles' });
        const all = [...x.hand.map((c) => ({ c })), ...x.melds.flatMap((m, k) => Array.from({ length: m.k === 'peng' ? 3 : 4 }, (_, q) => ({ c: m.t, gap: q === 0 ? (k === 0 ? 0.5 : 0.3) : 0 })))];
        const tw = Math.min(1.45, 19.5 / Math.max(1, all.length));
        const wonIdx = w ? x.hand.lastIndexOf(w.t) : -1;
        let acc = 0;
        all.forEach((it, k) => {
          acc += it.gap || 0;
          tiles.append(tileEl(it.c, acc + tw / 2, tw * TH / 2, tw, 0, k === wonIdx ? 'won' : ''));
          acc += tw + 0.02;
        });
        return el('div', { class: `row${w ? ' win' : ''}` },
          el('span', { class: 'n' }, String(j + 1)), el('span', { class: 'nm', title: names(seat) }, names(seat)), rs, tiles,
          el('span', { class: `v${x.delta > 0 ? ' up' : ''}` }, sgn(x.delta)),
          el('span', { class: 'tot' }, sgn(x.total), el('small', {}, '累计')));
      });
      const card = el('div', { class: 'mj-res', role: 'status' },
        el('div', { class: 'hd' }, el('b', {}, `第 ${S.no} 盘`), el('span', {}, head)),
        el('div', { class: 'rows' }, ...rows));
      if (view.over && view.history?.length) {
        const tot = SEATS.map((_, j) => view.history.reduce((a, d) => a + d[j], 0));
        const top = Math.max(...tot);
        const table = el('table', {},
          el('tr', {}, el('th', {}, '选手'), ...view.history.map((_, k) => el('th', {}, `第${k + 1}盘`)), el('th', {}, '合计')),
          ...SEATS.map((s, j) => el('tr', { class: tot[j] === top ? 'lead' : '' }, el('td', {}, names(s)), ...view.history.map((d) => el('td', {}, sgn(d[j]))), el('td', {}, sgn(tot[j])))));
        card.append(el('div', { class: 'final' }, el('div', { class: 'ttl' }, '终局'), table));
      }
      return card;
    }

    function draw(view, opts) {
      const { movable = null, actions = null } = opts;
      const viewer = view.viewer && SEATS.includes(view.viewer) ? view.viewer : null;
      const me = viewer || 'p1';
      const i = SEATS.indexOf(me);
      const posOf = { [me]: 'bottom', [SEATS[(i + 1) % 4]]: 'right', [SEATS[(i + 2) % 4]]: 'top', [SEATS[(i + 3) % 4]]: 'left' };
      const liveNow = isLive(opts);
      settleSent(view, opts);
      const canAct = !!viewer && movable === me && Array.isArray(actions) && actions.length > 0 && !sent;
      const ids = new Set((actions || []).map((a) => a.id));
      const names = (s) => view.names?.[s] || `${seatNo(s)} 号位`;
      const T = now();
      const within = (t0, dur) => !reduced() && t0 !== null && t0 !== undefined && T - t0 < dur;
      const kids = [];

      kids.push(consoleEl(view, posOf));
      const mineP = view.players.find((p) => p.seat === me);
      // 出牌时能点的牌
      const turnMine = canAct && view.phase === 'turn';
      const legal = new Set(turnMine ? [...ids].filter((a) => a.startsWith('discard:')).map((a) => a.slice(8)) : []);
      const key = `${view.handNo}|${(view.log || []).length}`;
      if (key !== selKey) { selKey = key; sel = null; }
      if (!turnMine) sel = null;

      for (const p of view.players) {
        const pos = posOf[p.seat];
        kids.push(...riverEls(view, p, pos));
      }
      for (const p of view.players) {
        const pos = posOf[p.seat];
        kids.push(...handRow(view, p, pos, { me, canPick: turnMine && p.seat === me, legal, hints: p.seat === me ? view.hints : null }));
      }
      for (const p of view.players) kids.push(plate(view, p, posOf[p.seat], { me: viewer, acting: canAct, live: liveNow, t0: opts.clock?.[p.seat] || null }));

      // 喊字：碰、杠、胡、自摸
      const ev = view.ev;
      if (ev && within(fx.ev.t0, FX.HU) && ['peng', 'gang', 'hu', 'zimo'].includes(ev.type)) {
        const seats = ev.type === 'hu' ? ev.seats : [ev.seat];
        const big = ev.type === 'hu' || ev.type === 'zimo';
        const word = { peng: '碰', gang: '杠', hu: ev.rob ? '抢杠胡' : '胡', zimo: '自摸' }[ev.type];
        const dur = big ? FX.HU : FX.CALL;
        for (const s of seats) {
          const [sx0, sy] = LY[posOf[s]].shout;
          // 喊字和金光不出桌面（手机竖版两边很窄，出界会撑出横向滚动条）
          const half = (word.length * (big ? 6 : 4.4)) / 2 + 0.4;
          const sx = Math.min(LY.w - half, Math.max(half, sx0));
          const gx = Math.min(LY.w - 15.4, Math.max(15.4, sx0)); // 金光 22em、放大到 1.4 倍
          if (big) kids.push(play(el('div', { class: 'mj-glow', style: `left:${gx}em;top:${sy}em` }), 'mj-burst', 1200, fx.ev.t0, 0, 'ease-out'));
          kids.push(el('div', { class: 'mj-sh', style: `left:${sx}em;top:${sy}em` }, play(el('span', { class: `mj-shout${big ? ' big' : ''}` }, word), 'mj-shout', dur, fx.ev.t0, 0, 'linear')));
        }
        if (ev.type === 'hu' && seats.length > 1) {
          kids.push(play(el('div', { class: 'mj-ban', style: `top:${LY.ban}em` }, el('b', {}, seats.length === 3 ? '一炮三响' : '一炮双响'), el('span', {}, `${names(ev.from)}打出 ${tName(ev.t)}`)), 'mj-ban', FX.HU, fx.ev.t0, 150, 'ease-out'));
        }
      }

      // 一盘结束：横幅 → 结算卡 → 新一盘的开局提示
      const S = view.last;
      const settleAt = fx.settle.t0;
      const banDur = S?.end === 'wall' ? FX.WALL : FX.HU;
      const freshEnd = S && (S.no !== view.handNo || view.over);
      if (freshEnd && within(settleAt, banDur)) {
        const lastWin = S.seats.map((x, j) => ({ x, j })).filter((o) => o.x.won).sort((a, b) => b.x.won.order - a.x.won.order)[0];
        const ban = S.end === 'wall'
          ? el('div', { class: 'mj-ban', style: `top:${LY.ban}em` }, el('b', {}, '流局'), el('span', {}, '牌墙摸完 · 查花猪 · 查大叫'))
          : el('div', { class: 'mj-ban', style: `top:${LY.ban}em` }, el('b', {}, lastWin.x.won.zimo ? '自摸' : '胡'), el('span', {}, `${names(SEATS[lastWin.j])} ${lastWin.x.won.title} ${lastWin.x.won.fan} 番 · 三家胡牌，本盘结束`));
        kids.push(el('div', { class: 'mj-veil' }), play(ban, 'mj-ban', banDur, settleAt, 0, 'ease-out'));
      }
      // 结算卡：横幅之后自动弹出停 FX.SETTLE（终局一直留着）；✕ 收起后桌角留一枚小签，点开再看（不再自动消失）
      const resKey = S ? `${S.no}|${view.over ? 1 : 0}` : '';
      const inBanner = freshEnd && within(settleAt, banDur);
      const auto = settleAt !== null && T - settleAt < banDur + FX.SETTLE;
      const pinned = showPinned === resKey;
      if (freshEnd && !inBanner) {
        if (resHidden !== resKey && (view.over || auto || pinned)) {
          const card = settleCard(view, S, names);
          card.append(el('button', { class: 'mj-x', type: 'button', title: '收起（Esc）', 'aria-label': '收起结算卡', onclick: (e) => { e.stopPropagation(); resHidden = resKey; showPinned = null; redraw(); } }, '✕'));
          if (!pinned) {
            play(card, 'mj-rise', 420, settleAt, banDur);
            if (!view.over) play(card, 'mj-out', 300, settleAt, banDur + FX.SETTLE - 300, 'ease-in');
          }
          kids.push(card);
        } else {
          kids.push(el('button', { class: 'mj-pill', type: 'button', title: '展开结算', style: `left:${LY.pill[0]}em;top:${LY.pill[1]}em`, onclick: (e) => { e.stopPropagation(); resHidden = null; showPinned = resKey; redraw(); } }, el('span', {}, `${view.over ? '终局' : `第 ${S.no} 盘`}结算 ▸`)));
        }
      }
      // 新一盘开局提示（结算之后）
      if (S && S.no !== view.handNo && !view.over && settleAt !== null && within(settleAt, banDur + FX.SETTLE + FX.DEAL) && T - settleAt >= banDur + FX.SETTLE) {
        const intro = el('div', { class: 'mj-intro' }, el('b', {}, `第 ${view.handNo} 盘`), el('span', {}, `庄家 ${names(view.dealer)} · 共 ${view.hands} 盘`));
        play(intro, 'mj-pop', 420, settleAt, banDur + FX.SETTLE, 'cubic-bezier(.2,1.2,.4,1)');
        play(intro, 'mj-out', 300, settleAt, banDur + FX.SETTLE + FX.DEAL - 300, 'ease-in');
        kids.push(intro);
      }

      // 玩家本人的操作
      if (canAct) {
        const ctl = el('div', { class: 'mj-ctl', style: LY.ctl });
        if (view.phase === 'que') {
          const cnt = { m: 0, s: 0, p: 0 };
          for (const c of mineP.hand || []) cnt[c[1]]++;
          const min = Math.min(...Object.values(cnt));
          ctl.append(el('span', { class: 'tip muted lbl' }, '定缺'));
          for (const s of ['m', 's', 'p']) {
            const b = el('button', { type: 'button', class: `btn${cnt[s] === min ? ' primary' : ''}` }, el('i', { class: 'q', style: `background:${SUIT_COLOR[s]}` }), `缺${SUIT_CN[s]} · ${cnt[s]}`);
            b.addEventListener('click', (e) => { e.stopPropagation(); send(`que:${s}`, '等其他人定缺'); });
            ctl.append(b);
          }
        } else if (view.phase === 'react') {
          const mini = el('span', { class: 'mini' }, tileEl(view.react.t, 1, 1.36, 2));
          ctl.append(el('span', { class: 'tip' }, view.react.kind === 'rob' ? `${names(view.react.from)}补杠` : `${names(view.react.from)}打出`, mini));
          for (const a of ['hu', 'gang', 'peng', 'pass']) {
            if (!ids.has(a)) continue;
            const b = el('button', { type: 'button', class: `btn${a === ['hu', 'gang', 'peng'].find((x) => ids.has(x)) ? ' primary' : ''}` }, { hu: '胡', gang: '杠', peng: '碰', pass: '过' }[a]);
            b.addEventListener('click', (e) => { e.stopPropagation(); send(a, `已选：${{ hu: '胡', gang: '杠', peng: '碰', pass: '过' }[a]}`); });
            ctl.append(b);
          }
        } else {
          const extra = (actions || []).filter((a) => !a.id.startsWith('discard:'));
          let tip = '点一张抬起，再点一下打出', muted = true;
          const queLeft = mineP.que && (mineP.hand || []).some((c) => c[1] === mineP.que);
          if (queLeft) tip = `先打完${SUIT_CN[mineP.que]}`;
          if (sel !== null && mineP.hand) {
            const c = mineP.hand[sel];
            const h = view.hints?.[c];
            tip = h ? `打 ${tName(c)} 听 ${h.waits.map(tName).join(' ')} · 剩 ${h.left} 张` : `打 ${tName(c)}`;
            muted = !h;
          }
          ctl.append(el('span', { class: `tip${muted ? ' muted' : ''}` }, tip));
          for (const a of extra) {
            const b = el('button', { type: 'button', class: `btn${a.id === 'zimo' ? ' primary' : ''}` }, a.label);
            b.addEventListener('click', (e) => { e.stopPropagation(); send(a.id); });
            ctl.append(b);
          }
          const chosen = sel !== null && mineP.hand ? mineP.hand[sel] : null;
          const b = el('button', { type: 'button', class: `btn${extra.some((a) => a.id === 'zimo') ? '' : ' primary'}` }, '出牌');
          b.disabled = !chosen || !legal.has(chosen);
          b.addEventListener('click', (e) => { e.stopPropagation(); if (chosen && legal.has(chosen)) send(`discard:${chosen}`); });
          ctl.append(b);
        }
        kids.push(ctl);
      } else if (sent?.tip && viewer && !view.over) {
        kids.push(el('div', { class: 'mj-wait', style: LY.wait }, el('span', {}, sent.tip)));
      } else if (viewer && mineP && !view.over && view.phase !== 'done') {
        // 没轮到自己：听牌时提示听什么
        if (mineP.ting?.length && !mineP.won) kids.push(el('div', { class: 'mj-wait', style: LY.wait }, el('span', {}, `听 ${mineP.ting.map(tName).join(' ')}`)));
        else if (view.phase === 'que' && mineP.que) kids.push(el('div', { class: 'mj-wait', style: LY.wait }, el('span', {}, '等其他人定缺')));
      }

      setLayer(box, felt, kids);
      if (box.querySelector('.mj-plate .tmr')) startTimerTick(root);
    }
    let showPinned = null;

    // 点空白处放下抬起的牌
    box.addEventListener('click', (e) => { if (sel !== null && !e.target.closest?.('.mj-t, button')) { sel = null; redraw(); } });

    return {
      el: root,
      render(view, opts = {}) {
        if (opts.players) view = { ...view, names: Object.fromEntries(Object.entries(opts.players).map(([k, v]) => [k, v.name])) };
        last = { view, opts };
        track(view, opts);
        draw(view, opts);
      },
    };
  },
};
