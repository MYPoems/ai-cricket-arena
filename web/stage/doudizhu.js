// 斗地主画面：俯视一张深色漆木牌桌（金边、嵌金线），地主坐下方，两名农民在上方左右。
// 观众是上帝视角，三家手牌摊成扇形；玩家本人只看到自己的牌，另两家是朱漆描金的牌背。
// 顶部中间一块牌匾：底分、倍数（书法大字）、三张底牌。桌心是本轮最近的一手，它压过的上一手淡显在后面。
// 动效：出牌从手里飞到桌心按牌型排开；「不出」气泡；剩余张数跳动，剩 2 张以下标红「报单/报双」；炸弹时桌心炸开金光、倍数翻滚。
// 玩家本人行动时：点选手牌（选中的牌抬高），按钮「不出」「出牌」；叫分阶段为「不叫」「1 分」「2 分」「3 分」。
//
// 画面用 HTML 画：根节点是尺寸容器，里面一块固定比例的桌面，桌面上的东西一律用 em 定位（横版 80×50em，竖版 50×70em），
// 所以大厅缩略图、对局页、手机竖屏都是同一套画法等比缩放。动画按「开始时刻」续播：重画时用负的 animation-delay 接上，
// 所以对局推进、点选手牌导致的重画不会打断正在飞的牌。

const SEATS = ['p1', 'p2', 'p3'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王'];
const rankOf = (n) => RANKS.indexOf(n);
const isJoker = (n) => n === '小王' || n === '大王';
const COLORS = ['var(--red)', 'var(--black-side)', '#3559b5']; // 选手卡上的阵营色（随深浅色主题变）
// 斗地主不分花色，牌面上的花色只是装饰：同一组牌里同点数的第 k 张依次用 ♠♥♣♦
const SUITS = [['♠', 'b'], ['♥', 'r'], ['♣', 'b'], ['♦', 'r']];
const EASE = 'cubic-bezier(.2,.75,.1,1)';

// ---------- 版式（单位 em） ----------
// 每个座位：plate 名牌左上角，hand 手牌（cx 中心、y 顶边、cw 牌宽、maxW 最大总宽），bubble 气泡（ax 为 'l'/'r' 对齐），from 出牌起飞点
const LAYOUTS = {
  land: {
    w: 80, h: 50, plateW: 17.5,
    plaque: { cx: 40, y: 1.3 },
    left: { plate: [1.6, 1.6], hand: { cx: 15, y: 9.4, cw: 3.3, maxW: 26.5 }, bubble: [20.2, 2.6, 'l'], from: [15, 12] },
    right: { plate: [80 - 1.6 - 17.5, 1.6], hand: { cx: 65, y: 9.4, cw: 3.3, maxW: 26.5 }, bubble: [80 - 20.2, 2.6, 'r'], from: [65, 12] },
    bottom: { plate: [1.6, 40.6], hand: { cx: 44.8, y: 38.4, cw: 5.1, maxW: 47.6 }, bubble: [2.2, 35.2, 'l'], from: [44.8, 42] },
    prev: { cx: 40, y: 13.6, cw: 3.1, maxW: 30 },
    lead: { cx: 40, y: 19.2, cw: 4.7, maxW: 44 },
    ctl: { cx: 40, y: 32.6 },
    res: { cx: 40, y: 15.5 },
  },
  port: {
    w: 50, h: 70, plateW: 23.6,
    plaque: { cx: 25, y: 1 },
    left: { plate: [0.9, 8.2], hand: { cx: 12.7, y: 15.4, cw: 2.75, maxW: 23 }, bubble: [1.4, 21.4, 'l'], from: [12.7, 18] },
    right: { plate: [50 - 0.9 - 23.6, 8.2], hand: { cx: 37.3, y: 15.4, cw: 2.75, maxW: 23 }, bubble: [50 - 1.4, 21.4, 'r'], from: [37.3, 18] },
    bottom: { plate: [0.9, 47.4], hand: { cx: 25, y: 56, cw: 5.2, maxW: 48.4 }, bubble: [50 - 1.4, 48.4, 'r'], from: [25, 60] },
    prev: { cx: 25, y: 24.6, cw: 2.6, maxW: 36 },
    lead: { cx: 25, y: 29.4, cw: 4, maxW: 46 },
    ctl: { cx: 25, y: 41.6 },
    res: { cx: 25, y: 26 },
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
.ddz-c .face { position: absolute; inset: 1.05em .95em; border-radius: .2em; border: .05em solid currentColor; opacity: .9; display: grid; place-items: center;
  background: linear-gradient(180deg, rgb(201 162 74 / .16), rgb(201 162 74 / .04)); box-shadow: inset 0 0 0 .14em rgb(255 255 255 / .6), inset 0 0 0 .19em rgb(201 162 74 / .45); }
.ddz-c .face b { font: 400 2.5em/1 var(--brush); }
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
.ddz-play.stale .ddz-c, .ddz-play.prev .ddz-c { filter: none; }
.ddz-play.prev { opacity: .5; }
.ddz-play.stale { opacity: .42; }

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
.ddz-plate .who { display: grid; gap: .25em; min-width: 0; flex: 1; }
.ddz-plate .who b { font: 900 1.5em/1.15 var(--serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ddz-plate .who span { display: flex; align-items: center; gap: .45em; font: 600 1.05em/1 var(--sans); color: var(--muted); white-space: nowrap; }
.ddz-plate .tag { font: 700 1em/1 var(--sans); padding: .32em .55em; border-radius: .3em; color: var(--muted); background: var(--well-bg); box-shadow: var(--well-sh); }
.ddz-plate .seal { font-size: 1.05em; width: 2.5em; height: 2.5em; flex: none; writing-mode: vertical-rl; letter-spacing: -.08em; line-height: 1; margin: 0 -.2em 0 .1em; }
.ddz-plate .cnt { display: grid; justify-items: center; flex: none; min-width: 2.6em; }
.ddz-plate .cnt b { font: 600 2.5em/1 var(--num); color: var(--text); font-variant-numeric: tabular-nums; }
.ddz-plate .cnt small { font: 600 .9em/1.2 var(--sans); color: var(--muted); letter-spacing: .1em; }
.ddz-plate .cnt.warn b { color: var(--zhu-2); }
.ddz-plate .alarm { position: absolute; top: -.9em; right: .9em; font: 700 1em/1 var(--sans); color: #fff3e6; padding: .34em .6em; border-radius: .9em; letter-spacing: .12em;
  background: radial-gradient(circle at 34% 24%, #ff8a72, #d23a26 46%, #8e1b12); box-shadow: inset 0 .07em 0 rgb(255 220 200 / .6), 0 0 0 .08em #6a4a14, 0 0 0 .16em #e6bd5c, 0 .2em .3em .1em rgb(0 0 0 / .45);
  animation: ddz-alarm 1.1s ease-in-out infinite; }
.ddz-plate .think { position: absolute; left: 50%; bottom: -.95em; translate: -50% 0; display: flex; gap: .25em; padding: .3em .55em; border-radius: .8em; background: var(--well-bg); box-shadow: var(--well-sh); }
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

/* 结果 */
.ddz-res { translate: -50% 0; display: grid; justify-items: center; gap: .5em; pointer-events: none; text-align: center; isolation: isolate; z-index: 5; }
/* 结算字下垫一层暗漆晕，把最后一手牌压下去，字和牌不再打架 */
.ddz-res::before { content: ''; position: absolute; inset: -1.6em -5em; z-index: -1; border-radius: 50%; background: radial-gradient(closest-side, rgb(26 6 3 / .9), rgb(26 6 3 / .66) 62%, transparent); }
:root[data-theme="light"] .ddz-res::before { background: radial-gradient(closest-side, rgb(40 10 5 / .86), rgb(40 10 5 / .6) 62%, transparent); }
.ddz-res b { font: 400 6.4em/1.05 var(--brush); background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 .1em;
  filter: drop-shadow(0 .03em 0 rgb(40 12 2 / .9)) drop-shadow(0 .08em .1em rgb(0 0 0 / .6)); }
.ddz-res span { font: 600 1.4em/1.3 var(--sans); color: #f2e3c2; letter-spacing: .14em; padding: .35em 1em; border-radius: 1em; background: rgb(10 3 2 / .55); box-shadow: inset 0 .05em .2em rgb(0 0 0 / .6), 0 .06em 0 rgb(255 224 176 / .14); }

/* 操作按钮：用设计系统的漆木键，尺寸跟着桌面缩放 */
.ddz-ctl { translate: -50% 0; display: flex; gap: 1.2em; padding-bottom: .4em; }
.ddz-ctl .btn { font-size: 1.45em; padding: .3em 1.2em; min-width: 5.2em; --d: .18em; }

@keyframes ddz-fly { from { transform: translate(var(--fx), var(--fy)) rotate(var(--fr, 0deg)) scale(.72); opacity: .25; } 60% { opacity: 1; } }
@keyframes ddz-deal { from { transform: translate(var(--fx), var(--fy)) scale(.6); opacity: 0; } }
@keyframes ddz-pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } }
@keyframes ddz-jump { 0% { transform: translateY(0) scale(1); } 35% { transform: translateY(-.35em) scale(1.35); color: #f6dc94; } 100% { transform: none; } }
@keyframes ddz-roll { 0% { transform: perspective(10em) rotateX(-90deg) translateY(-.2em); opacity: 0; } 55% { transform: perspective(10em) rotateX(18deg) scale(1.25); opacity: 1; } 100% { transform: none; } }
@keyframes ddz-flip { 0% { transform: perspective(14em) rotateY(90deg); } 100% { transform: none; } }
@keyframes ddz-burst { 0% { transform: scale(.1); opacity: 0; } 12% { opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
@keyframes ddz-rays { 0% { transform: scale(.3) rotate(0deg); opacity: 0; } 15% { opacity: 1; } 100% { transform: scale(1.25) rotate(40deg); opacity: 0; } }
@keyframes ddz-shake { 0%, 100% { transform: none; } 20% { transform: translate(.25em, -.15em); } 40% { transform: translate(-.2em, .15em); } 60% { transform: translate(.12em, .1em); } 80% { transform: translate(-.08em, -.06em); } }
@keyframes ddz-alarm { 50% { transform: scale(1.12); box-shadow: inset 0 .07em 0 rgb(255 220 200 / .6), 0 0 0 .08em #6a4a14, 0 0 0 .16em #e6bd5c, 0 0 1em .3em rgb(226 82 61 / .55); } }
@keyframes ddz-dot { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-.15em); } }
@keyframes ddz-rise { from { transform: translateY(1em) scale(.9); opacity: 0; } }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('ddz-style')) return;
  const st = document.createElement('style');
  st.id = 'ddz-style';
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
  node.style.animation = `${name} ${dur}ms ${ease} ${Math.round(delay - passed)}ms both`;
  return node;
}

/** 牌按大到小；同点数的第 k 张给第 k 个花色 */
const desc = (names) => names.slice().sort((a, b) => rankOf(b) - rankOf(a));
const ascId = (names) => names.slice().sort((a, b) => rankOf(a) - rankOf(b)).join(' ');
function withSuits(names) {
  const seen = {};
  return names.map((n) => { const k = seen[n] || 0; seen[n] = k + 1; return { n, s: SUITS[k % 4] }; });
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
    face ? el('div', { class: 'face' }, el('b', {}, n)) : el('div', { class: `pip${n === 'A' ? ' a' : ''}` }, s[0]),
    el('div', { class: 'ix br' }, el('b', {}, n), el('i', {}, s[0])));
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

const playKey = (seat, t) => (t && t.cards ? `${seat}:${t.cards.join(',')}` : '');

export default {
  // 对局页用「牌桌 + 右侧聚光框 + 本局记录」版式：牌桌上已有每家的名牌、剩牌和出牌，两侧不再放选手卡
  hud: true,

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
      label: '本局记录', title: '本局', sub: view.landlord ? `底分 ${view.bid} · ${view.multiplier} 倍` : '叫地主',
      groups, count: (view.bids?.length || 0) + (view.plays?.length || 0), last: null,
      result: r ? `${r.landlordWins ? '地主' : '农民'}胜 · ${r.multiplier} 倍${r.spring ? ' · 春天' : r.anti ? ' · 反春' : ''} · 每家 ${r.score} 分` : null,
    };
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
    const fx = { prev: null, lead: { key: '', t0: null }, boom: null, mult: null, flip: null, counts: {}, cnt: {}, bubbles: {}, bub: {} };

    const redraw = () => last && draw(last.view, last.opts);
    box.addEventListener('click', () => { if (sel.size) { sel = new Set(); redraw(); } });

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
        fx.lead = { key, t0: live && lead && !lead.stale ? t : null };
        if (live && lead && !lead.stale && /炸弹|王炸/.test(lead.t.type || '')) fx.boom = t;
      }
      if (p && (view.multiplier || 1) !== (p.multiplier || 1) && live) fx.mult = t;
      if (p && !p.landlord && view.landlord && live) fx.flip = t;
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
    /** 被桌心那一手压过的上一手：从出牌人往回数，第一个出了牌的座位 */
    function prevOf(view, lead) {
      if (!lead || lead.stale) return null;
      const table = view.table || {};
      const i = SEATS.indexOf(lead.seat);
      for (const k of [2, 1]) {
        const s = SEATS[(i + k) % 3];
        if (table[s]?.cards) return { seat: s, t: table[s] };
        if (!table[s]?.pass) break;
      }
      return null;
    }

    function plate(view, seat, pos, L) {
      const role = view.roles?.[seat];
      const count = view.counts?.[seat] ?? 0;
      const turn = view.turn === seat;
      const won = view.result && (view.result.landlordWins ? role === '地主' : role === '农民');
      const idx = SEATS.indexOf(seat);
      const name = view.seatNames?.[seat] || seat;
      const cnt = el('b', {}, String(count));
      play(cnt, 'ddz-jump', 520, fx.cnt[seat], 0, 'ease-out');
      const warn = view.phase === 'play' && count > 0 && count <= 2;
      const roleEl = role === '地主' ? el('span', { class: 'seal', title: '地主' }, '地主') : null;
      const bid = view.bids?.filter((b) => b.seat === seat).at(-1);
      const status = role || (view.phase === 'bid' ? (bid ? (bid.bid ? `叫 ${bid.bid} 分` : '不叫') : view.first === seat ? '首叫' : '等待叫分') : '');
      return el('div', { class: `ddz-plate${turn ? ' on' : ''}${won ? ' win' : ''}`, style: `left:${pos.plate[0]}em;top:${pos.plate[1]}em;width:${L.plateW}em` },
        el('span', { class: 'coin' }, String(idx + 1)),
        el('div', { class: 'who' }, el('b', { title: name }, name), el('span', {}, status)),
        roleEl,
        el('div', { class: `cnt${warn ? ' warn' : ''}` }, cnt, el('small', {}, '张')),
        warn ? el('div', { class: 'alarm' }, count === 1 ? '报单' : '报双') : null,
        turn ? el('div', { class: 'think' }, el('i'), el('i'), el('i')) : null);
    }

    /** 一家的手牌：明牌成扇形，暗牌是牌背 */
    function hand(view, seat, pos, { mine = false, pick = false, d = null } = {}) {
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
        if (pick) node.addEventListener('click', (e) => { e.stopPropagation(); if (sel.has(i)) sel.delete(i); else sel.add(i); redraw(); });
        out.push(node);
      });
      return out;
    }

    /** 桌上的一手牌：按牌型横排；animate 时从出牌人手里飞出来 */
    function playRow(t, spot, { cls = '', from = null, t0 = null } = {}) {
      const cards = withSuits(t.cards);
      const geo = spread(cards.length, spot, { step: spot.cw * 0.56, fan: false });
      const fs = spot.cw / 5;
      const g = el('div', { class: `ddz-play ${cls}`, style: 'inset:0' });
      cards.forEach((c, i) => {
        const node = cardEl(c, geo[i].x, geo[i].y, fs);
        if (from && t0 !== null) {
          node.style.setProperty('--fx', `${(from[0] - geo[i].x - spot.cw / 2) / fs}em`);
          node.style.setProperty('--fy', `${(from[1] - geo[i].y - spot.cw * 0.7) / fs}em`);
          node.style.setProperty('--fr', `${(i - (cards.length - 1) / 2) * -6}deg`);
          play(node, 'ddz-fly', 460, t0, i * 22);
        }
        g.append(node);
      });
      return g;
    }

    function plaque(view, L) {
      const known = !!view.landlord && Array.isArray(view.bottom);
      const bot = el('div', { class: 'bot' });
      for (let i = 0; i < 3; i++) {
        const nm = known ? view.bottom[i] : null;
        const c = cardEl(nm ? withSuits(view.bottom)[i] : { n: null }, 0, 0, layoutName === 'port' ? 0.5 : 0.56);
        if (nm) play(c, 'ddz-flip', 520, fx.flip, i * 140);
        bot.append(c);
      }
      const mult = el('span', { class: `mult${(view.multiplier || 1) > 1 ? ' hot' : ''}` }, `${cnNum(view.multiplier || 1)}倍`);
      play(mult, 'ddz-roll', 700, fx.mult, 0, 'cubic-bezier(.2,1.4,.4,1)');
      return el('div', { class: 'ddz-plq', style: `left:${L.plaque.cx}em;top:${L.plaque.y}em` },
        el('div', { class: 'kv' }, el('small', {}, view.deals ? `重发 ${view.deals}` : '底分'), el('b', {}, view.bid ? String(view.bid) : '—')),
        el('div', { class: 'kv' }, el('small', {}, '倍数'), mult),
        el('i', { class: 'sep' }),
        el('div', { class: 'kv' }, el('small', {}, '底牌'), bot));
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
      root.classList.toggle('can-move', canAct);

      const kids = [el('div', { class: 'ddz-rail' }), el('div', { class: 'ddz-top' }), el('div', { class: 'ddz-wm' }, '斗')];

      // 桌心：上一手（淡）、这一手、牌型标签、炸弹金光
      const lead = leadOf(view);
      const prev = prevOf(view, lead);
      const c = L.lead;
      const leadH = c.cw * 1.4;
      kids.push(el('div', { class: 'ddz-glow', style: `left:${c.cx}em;top:${c.y + leadH / 2}em;width:${c.maxW * 0.9}em;height:${leadH * 2.6}em` }));
      const center = []; // 桌心的牌最后画，飞行中的牌压在手牌上面
      if (prev) center.push(playRow(prev.t, L.prev, { cls: 'prev' }));
      if (lead) {
        const boom = /炸弹|王炸/.test(lead.t.type || '');
        const row = playRow(lead.t, c, { cls: lead.stale ? 'stale' : '', from: spots[lead.seat]?.from, t0: fx.lead.t0 });
        if (boom && fx.boom !== null) play(row, 'ddz-shake', 420, fx.boom, 380, 'linear');
        center.push(row);
        const who = view.roles?.[lead.seat] || '';
        kids.push(el('div', { class: `ddz-lbl${boom ? ' boom' : ''}`, style: `left:${c.cx}em;top:${c.y + leadH + 0.9}em` },
          el('span', {}, `${view.seatNames?.[lead.seat] || lead.seat}${who ? ` · ${who}` : ''}`), el('b', {}, lead.t.type || ''), lead.stale ? el('span', {}, '上一轮') : null));
        if (boom && fx.boom !== null && now() - fx.boom < 1500) {
          const cy = c.y + leadH / 2;
          kids.push(play(el('div', { class: 'ddz-burst', style: `left:${c.cx}em;top:${cy}em` }), 'ddz-burst', 1100, fx.boom, 300, 'ease-out'));
          kids.push(play(el('div', { class: 'ddz-rays', style: `left:${c.cx}em;top:${cy}em` }), 'ddz-rays', 1300, fx.boom, 300, 'ease-out'));
        }
      }

      // 三家：名牌、手牌、气泡
      const handKids = [];
      for (const s of SEATS) {
        const pos = spots[s];
        kids.push(plate(view, s, pos, L));
        const mine = s === me && !!view.hands?.[s];
        if (mine && s === viewer) {
          const d = desc(view.hands[s]);
          const key = `${s}|${d.join(',')}`;
          if (key !== handKey) { sel = new Set(); handKey = key; }
          if (!canAct || view.phase !== 'play') sel = new Set();
          handKids.push(...hand(view, s, pos, { mine: true, pick: canAct && view.phase === 'play', d }));
        } else {
          handKids.push(...hand(view, s, pos));
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
      kids.push(plaque(view, L));

      // 结果
      if (view.result) {
        const r = view.result;
        const tail = [r.spring ? '春天' : r.anti ? '反春' : null, `${view.bid} 分 × ${r.multiplier}`, `共 ${r.score} 分`].filter(Boolean).join(' · ');
        kids.push(el('div', { class: 'ddz-res', style: `left:${L.res.cx}em;top:${L.res.y}em;animation:ddz-rise .6s ${EASE} both` },
          el('b', {}, r.landlordWins ? '地主胜' : '农民胜'), el('span', {}, tail)));
      }

      // 玩家本人的操作
      if (canAct) {
        const ctl = el('div', { class: 'ddz-ctl', style: `left:${L.ctl.cx}em;top:${L.ctl.y}em` });
        if (view.phase === 'bid') {
          for (const [id, lb] of [['叫0', '不叫'], ['叫1', '1 分'], ['叫2', '2 分'], ['叫3', '3 分']]) {
            ctl.append(button(lb, { primary: id === '叫3', off: !ids.has(id), onClick: () => onAction(id) }));
          }
        } else {
          const d = desc(view.hands[me]);
          const chosen = ascId([...sel].map((k) => d[k]));
          ctl.append(
            button('不出', { off: !ids.has('不出'), onClick: () => { sel = new Set(); onAction('不出'); } }),
            button('出牌', { primary: true, off: !sel.size || !ids.has(chosen), onClick: () => { sel = new Set(); onAction(chosen); } }),
          );
        }
        kids.push(ctl);
      }
      box.replaceChildren(...kids);
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
