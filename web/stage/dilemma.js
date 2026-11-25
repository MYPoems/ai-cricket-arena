// 重复囚徒困境画面：审讯室对坐。吊灯一盏、桌面一张；每轮两张牌扣在桌上，揭晓时同时翻开
// （宣纸牌面 + 书法字「合作」「背叛」，背叛时牌面裂开、泛红光），收益数字飞进上方分数；
// 喊话以对白气泡出现在各自牌的上方；底部一条「信任心电图」：合作是平稳的心跳，背叛是一下红色的乱跳。
// 牌面节奏：揭晓后的两张牌一直亮着，到下一轮进入「出牌」才收回扣下；已出牌的一方牌前亮一道金边。
// 隐藏信息：只用 view 里有的东西（玩家视角下看不到对方没公开的喊话和选择）。
// 玩家本人行动时，桌面中间出现输入框（喊话）或两张可点的牌（出牌）。

const NAMES = { a: '甲', b: '乙' };
const PAY = { C: { C: 3, D: 0 }, D: { C: 5, D: 1 } };
const VBW = 1000, VBH = 150; // 心电图的坐标
const YB = { a: 50, b: 112 }; // 两条心电图的基线

const STYLE = `
.dlm { position: relative; width: 100%; height: 100%; container-type: size; display: grid; place-items: center; user-select: none; }
.dlm-box { --t: #f2e3c2; --t2: rgb(242 227 194 / .62); --t3: rgb(242 227 194 / .4);
  position: relative; width: min(100cqw, 133.333cqh); aspect-ratio: 4 / 3; container-type: inline-size; overflow: hidden;
  border: 2px solid transparent; border-radius: 16px; color: var(--t); font-family: var(--sans);
  background:
    radial-gradient(46cqw 30cqw at 50% 40%, rgb(255 200 128 / .2), transparent 70%) padding-box,
    radial-gradient(120% 95% at 50% 42%, transparent 46%, rgb(0 0 0 / .72) 100%) padding-box,
    var(--grain) padding-box,
    linear-gradient(180deg, #1f0b07 0%, #170706 44%, #0e0403 52%, #090202 100%) padding-box,
    var(--edge) border-box;
  box-shadow: inset 0 2px 0 rgb(255 228 184 / .16), inset 0 -2px 0 rgb(0 0 0 / .5); }
:root[data-theme="light"] .dlm-box { background:
    radial-gradient(46cqw 30cqw at 50% 40%, rgb(255 210 140 / .26), transparent 70%) padding-box,
    radial-gradient(120% 95% at 50% 42%, transparent 50%, rgb(20 6 2 / .6) 100%) padding-box,
    var(--grain) padding-box,
    linear-gradient(180deg, #3a1a10 0%, #2c120b 44%, #1f0a06 52%, #150604 100%) padding-box,
    var(--edge) border-box; }
/* 墙上一道护墙板的线 */
.dlm-box::before { content: ''; position: absolute; left: 0; right: 0; top: 37.6cqw; height: 1px; background: rgb(0 0 0 / .5); box-shadow: 0 1px 0 rgb(255 220 170 / .06); }

/* ---- 吊灯 ---- */
.dlm-lamp { position: absolute; left: 50%; top: -1px; width: 0; height: 0; transform-origin: 0 0; animation: dlm-swing 7s ease-in-out infinite alternate; z-index: 3; pointer-events: none; }
@keyframes dlm-swing { from { rotate: -1.6deg; } to { rotate: 1.6deg; } }
.dlm-lamp .cord { position: absolute; left: -.12cqw; top: 0; width: .24cqw; height: 6.6cqw; background: linear-gradient(90deg, #000, #4a3a26, #000); }
.dlm-lamp .shade { position: absolute; left: -6.4cqw; top: 6.2cqw; width: 12.8cqw; height: 5.2cqw; clip-path: polygon(31% 0, 69% 0, 100% 100%, 0 100%);
  background: linear-gradient(90deg, #3e2a0a 0%, #b08030 16%, #fff0b8 30%, #c79c44 44%, #6a4a16 70%, #2a1c06 100%); }
.dlm-lamp .shade::after { content: ''; position: absolute; inset: auto 0 0 0; height: .5cqw; background: linear-gradient(90deg, #5e400f, #f7dc8e 30%, #8e6824 70%, #3e2a0a); }
.dlm-lamp .bulb { position: absolute; left: -2.2cqw; top: 10.4cqw; width: 4.4cqw; height: 1.8cqw; border-radius: 50%; background: radial-gradient(closest-side, #fffdf0, #ffe7a8 60%, rgb(255 220 150 / 0));
  box-shadow: 0 0 2.4cqw 1cqw rgb(255 214 140 / .55); }
.dlm-lamp .cone { position: absolute; left: -34cqw; top: 11cqw; width: 68cqw; height: 30cqw; clip-path: polygon(42% 0, 58% 0, 100% 100%, 0 100%);
  background: linear-gradient(180deg, rgb(255 230 176 / .26), rgb(255 214 150 / .09) 70%, rgb(255 214 150 / 0)); mix-blend-mode: screen; }

/* ---- 桌子 ---- */
.dlm-table { position: absolute; left: 5cqw; right: 5cqw; top: 38.6cqw; height: 13cqw; clip-path: polygon(10% 0, 90% 0, 100% 100%, 0 100%);
  background: radial-gradient(34cqw 9cqw at 50% 45%, rgb(255 214 150 / .34), transparent 70%), var(--grain), linear-gradient(180deg, #3e140b, #5a1f12 60%, #6a2616); }
.dlm-front { position: absolute; left: 5cqw; right: 5cqw; top: 51.6cqw; height: 3.2cqw; border-radius: 0 0 1cqw 1cqw;
  background: linear-gradient(180deg, #7a3a20 0, #7a3a20 1px, #4a170d 2px, #2a0b07 60%, #160403 100%);
  box-shadow: 0 .8cqw 1.6cqw rgb(0 0 0 / .65); }
.dlm-front::before { content: ''; position: absolute; left: 1.2cqw; right: 1.2cqw; top: .7cqw; height: 1px; background: linear-gradient(90deg, transparent, #c9a24a 12%, #f3d27e 30%, #8e6824 60%, #c9a24a 88%, transparent); opacity: .7; }

/* ---- 顶部：双方分数 ---- */
.dlm-head { position: absolute; left: 3cqw; right: 3cqw; top: 2cqw; display: flex; justify-content: space-between; pointer-events: none; z-index: 2; }
.dlm-side { display: flex; align-items: center; gap: 1.4cqw; }
.dlm-side.b { flex-direction: row-reverse; text-align: right; }
.dlm-side .coin { width: 4.6cqw; height: 4.6cqw; font: 400 2.6cqw/1 var(--brush); }
.dlm-side .sc { display: flex; align-items: baseline; gap: .6cqw; }
.dlm-side.b .sc { flex-direction: row-reverse; }
.dlm-side .num { font: 600 5.4cqw/1 var(--num); background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 1px 0 rgb(40 12 2 / .9)) drop-shadow(0 2px 2px rgb(0 0 0 / .5)); display: inline-block; }
.dlm-side .unit { font-size: max(10px, 1.4cqw); color: var(--t2); }
.dlm-side .st { margin-top: .5cqw; font: 500 max(9px, 1.25cqw)/1.3 var(--num); color: var(--t2); letter-spacing: .02em; white-space: nowrap; }
.dlm-side.win .num { filter: drop-shadow(0 0 1.2cqw rgb(243 210 126 / .6)) drop-shadow(0 1px 0 rgb(40 12 2 / .9)); }

/* ---- 牌 ---- */
.dlm-slot { position: absolute; top: 31cqw; width: 12.6cqw; height: 17.4cqw; perspective: 60cqw; z-index: 2; }
.dlm-slot.a { left: calc(24cqw - 6.3cqw); }
.dlm-slot.b { left: calc(76cqw - 6.3cqw); }
.dlm-slot::after { content: ''; position: absolute; left: 6%; right: 6%; bottom: -1.1cqw; height: 1.6cqw; border-radius: 50%; background: radial-gradient(closest-side, rgb(0 0 0 / .7), transparent); z-index: -1; }
.dlm-flip { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform .75s cubic-bezier(.3, .1, .2, 1), translate .3s; }
.dlm-slot.down .dlm-flip { transform: rotateY(180deg); }
.dlm-slot.played .dlm-flip { translate: 0 -.8cqw; }
.dlm-face, .dlm-back { position: absolute; inset: 0; border-radius: 1cqw; backface-visibility: hidden; -webkit-backface-visibility: hidden; overflow: hidden; }
.dlm-back { transform: rotateY(180deg);
  background:
    radial-gradient(circle at 50% 50%, transparent 3.1cqw, #d9b25e 3.1cqw, #d9b25e calc(3.1cqw + 1px), transparent calc(3.1cqw + 1px)),
    repeating-linear-gradient(45deg, rgb(217 178 94 / .14) 0 1px, transparent 1px .9cqw),
    repeating-linear-gradient(-45deg, rgb(217 178 94 / .14) 0 1px, transparent 1px .9cqw),
    radial-gradient(120% 70% at 30% 0%, rgb(255 210 160 / .22), transparent 60%),
    linear-gradient(180deg, #5c1a10, #2c0b07);
  box-shadow: inset 0 0 0 .35cqw #2a0b08, inset 0 0 0 calc(.35cqw + 1px) #c9a24a, inset 0 0 0 .75cqw #3a0f09, inset 0 0 0 calc(.75cqw + 1px) rgb(201 162 74 / .5), inset 0 2px 0 rgb(255 228 184 / .3); }
.dlm-back b { position: absolute; inset: 0; display: grid; place-items: center; font: 400 3.4cqw/1 var(--brush); background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; }
.dlm-slot.played .dlm-back { box-shadow: inset 0 0 0 .35cqw #2a0b08, inset 0 0 0 calc(.35cqw + 1px) #f3d27e, inset 0 0 0 .75cqw #3a0f09, inset 0 0 0 calc(.75cqw + 1px) rgb(243 210 126 / .7), 0 0 1.6cqw rgb(243 210 126 / .45); }
.dlm-face { background: var(--fiber), radial-gradient(120% 80% at 18% 0%, rgb(255 255 255 / .55), transparent 55%), linear-gradient(180deg, #fbf0d4 0%, #f2e0b6 60%, #e7d09e 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .85), inset 0 -1px 0 rgb(150 110 50 / .35), inset 0 0 0 1px rgb(120 84 30 / .55), inset 0 0 0 .5cqw rgb(255 250 235 / .3), inset 0 0 0 calc(.5cqw + 1px) rgb(154 116 32 / .35); }
.dlm-face .w { position: absolute; inset: 0; display: grid; place-items: center; writing-mode: vertical-rl; font: 400 4.6cqw/1.05 var(--brush); color: #2a1209; letter-spacing: .1em; }
.dlm-face.d .w { color: #b4241a; }
.dlm-face .u { position: absolute; left: 0; right: 0; bottom: .9cqw; text-align: center; font: 600 max(8px, 1.1cqw)/1 var(--num); color: rgb(42 18 9 / .55); }
.dlm-face .crack { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; }
.dlm-face.d .crack { opacity: 1; }
.dlm-face .crack path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.dlm-face .crack .k1 { stroke: #5c0e08; stroke-width: 1.6; }
.dlm-face .crack .k2 { stroke: #fff6e0; stroke-width: .8; opacity: .7; }
.dlm-slot.dd .dlm-face { animation: dlm-red 2.4s ease-out both; }
.dlm-slot.dd.static .dlm-face { animation: none; box-shadow: inset 0 0 0 1px rgb(120 84 30 / .55), inset 0 0 3cqw rgb(226 82 61 / .55); }
@keyframes dlm-red { 0%, 30% { box-shadow: inset 0 0 0 1px rgb(120 84 30 / .55), inset 0 0 0 rgb(226 82 61 / 0); } 45% { box-shadow: inset 0 0 0 1px rgb(120 84 30 / .55), inset 0 0 4.6cqw rgb(226 82 61 / .9); } 100% { box-shadow: inset 0 0 0 1px rgb(120 84 30 / .55), inset 0 0 3cqw rgb(226 82 61 / .55); } }
.dlm-slot.dd::before { content: ''; position: absolute; inset: -3.4cqw -3cqw; border-radius: 4cqw; background: radial-gradient(closest-side, rgb(255 86 56 / .9) 50%, rgb(226 82 61 / .35) 75%, transparent); z-index: -1; animation: dlm-glow 2.4s ease-out both; }
.dlm-slot.dd.static::before { animation: none; opacity: .7; }
@keyframes dlm-glow { 0%, 30% { opacity: 0; } 45% { opacity: 1; } 100% { opacity: .7; } }
.dlm-slot.dd .crack path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: dlm-crack .5s .5s ease-out forwards; }
.dlm-slot.dd.static .crack path { animation: none; stroke-dashoffset: 0; }
@keyframes dlm-crack { to { stroke-dashoffset: 0; } }
.dlm-cap { position: absolute; left: -3cqw; right: -3cqw; top: calc(100% + 1.2cqw); text-align: center; font: 500 max(9px, 1.25cqw)/1.2 var(--sans); color: var(--t2); white-space: nowrap; }
.dlm-cap.on { color: #f3d27e; }

/* ---- 对白气泡 ---- */
.dlm-say { position: absolute; bottom: calc(100% - 31cqw + 2cqw); max-width: 27cqw; min-width: 8cqw; padding: 1cqw 1.4cqw; border-radius: 1.2cqw; z-index: 4;
  font: 500 max(11px, 1.65cqw)/1.45 var(--serif); color: #2a1209; overflow-wrap: anywhere;
  background: var(--fiber), radial-gradient(120% 80% at 18% 0%, rgb(255 255 255 / .55), transparent 55%), linear-gradient(180deg, #fbf0d4 0%, #f2e0b6 60%, #e7d09e 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .85), 0 0 0 1px rgb(120 84 30 / .55), 0 2px 0 1px #b4955a, 0 .8cqw 1.4cqw rgb(0 0 0 / .55);
  transition: opacity .3s, translate .3s; }
.dlm-say.a { left: 9cqw; }
.dlm-say.b { right: 9cqw; text-align: right; }
.dlm-say::after { content: ''; position: absolute; top: 100%; width: 1.6cqw; height: 1.2cqw; background: #e9d3a3; clip-path: polygon(0 0, 100% 0, 50% 100%); }
.dlm-say.a::after { left: 13cqw; transform: translateX(-50%); }
.dlm-say.b::after { right: 13cqw; transform: translateX(50%); }
.dlm-say.off { opacity: 0; translate: 0 .6cqw; }
.dlm-say.faint { opacity: .55; }
.dlm-say.mute { color: rgb(42 18 9 / .55); font-style: normal; }
.dlm-say .dots { display: inline-flex; gap: .5cqw; }
.dlm-say .dots i { width: .7cqw; height: .7cqw; min-width: 4px; min-height: 4px; border-radius: 50%; background: rgb(42 18 9 / .55); animation: dlm-dot 1.2s infinite; }
.dlm-say .dots i:nth-child(2) { animation-delay: .2s; } .dlm-say .dots i:nth-child(3) { animation-delay: .4s; }
@keyframes dlm-dot { 0%, 60%, 100% { opacity: .3; translate: 0 0; } 30% { opacity: 1; translate: 0 -.3cqw; } }

/* ---- 桌沿铭牌：第几轮 ---- */
.dlm-plaque { position: absolute; left: 50%; top: 49.4cqw; translate: -50% 0; z-index: 3; display: flex; align-items: center; gap: 1cqw; padding: .55cqw 1.8cqw .65cqw; border-radius: .8cqw; border: 1px solid transparent; white-space: nowrap;
  background: linear-gradient(180deg, rgb(255 208 152 / .14), transparent 46%) padding-box, linear-gradient(180deg, #4a160e, #260806) padding-box, var(--edge) border-box;
  box-shadow: inset 0 1px 0 rgb(255 228 184 / .25), 0 2px 0 #3e2a0a, 0 3px 0 #000, 0 .8cqw 1.2cqw rgb(0 0 0 / .6); }
.dlm-plaque .r { font: 400 2.4cqw/1 var(--brush); background: var(--gold-text); -webkit-background-clip: text; background-clip: text; color: transparent; }
.dlm-plaque .p { font: 600 max(9px, 1.2cqw)/1 var(--sans); color: var(--t2); letter-spacing: .18em; }
.dlm-plaque .p.hot { color: #f3d27e; }

/* ---- 揭晓的收益数字、终局印 ---- */
.dlm-pay { position: absolute; z-index: 6; font: 600 3.4cqw/1 var(--num); translate: -50% -50%; pointer-events: none; text-shadow: 0 1px 0 rgb(0 0 0 / .7), 0 0 1.2cqw rgb(0 0 0 / .5); }
.dlm-pay.p5 { color: #f3d27e; } .dlm-pay.p3 { color: #9fe0bf; } .dlm-pay.p1 { color: #e9c7a0; } .dlm-pay.p0 { color: rgb(242 227 194 / .55); }
.dlm-seal { position: absolute; left: 50%; top: 34cqw; z-index: 5; width: 10cqw; height: 10cqw; margin-left: -5cqw; font-size: 4cqw; line-height: 1.05; text-align: center; writing-mode: vertical-rl; display: grid; place-items: center; transform: rotate(-8deg); }
.dlm-seal.draw { font-size: 3.4cqw; }

/* ---- 信任心电图 ---- */
.dlm-ecg { position: absolute; left: 3cqw; right: 3cqw; top: 58cqw; bottom: 2.6cqw; border-radius: 1.2cqw; overflow: hidden;
  background: radial-gradient(80% 120% at 50% 50%, rgb(60 140 100 / .1), transparent 70%), linear-gradient(180deg, #050101, #120504);
  box-shadow: inset 0 2px 6px rgb(0 0 0 / .9), inset 0 0 0 1px rgb(0 0 0 / .6), inset 0 -1px 0 rgb(255 224 176 / .06), 0 1px 0 rgb(255 224 176 / .12); }
.dlm-ecg svg { position: absolute; left: 4.6cqw; right: 1.4cqw; top: 0; bottom: 0; width: calc(100% - 6cqw); height: 100%; overflow: visible; }
.dlm-ecg .lab { position: absolute; left: 1.4cqw; font: 400 max(10px, 1.7cqw)/1 var(--brush); color: var(--t2); translate: 0 -50%; }
.dlm-ecg .cap { position: absolute; right: 1.6cqw; top: .9cqw; font: 600 max(8px, 1.05cqw)/1 var(--sans); color: var(--t3); letter-spacing: .3em; }
.dlm-ecg .grid { stroke: rgb(110 200 150 / .07); stroke-width: 1; vector-effect: non-scaling-stroke; }
.dlm-ecg .base { stroke: rgb(110 200 150 / .16); stroke-width: 1; vector-effect: non-scaling-stroke; stroke-dasharray: 2 4; }
.dlm-ecg .tr { fill: none; stroke-width: 1.8; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
.dlm-ecg .tr.c { stroke: #6fd3a2; }
.dlm-ecg .tr.d { stroke: #ff6a52; stroke-width: 2.2; }
.dlm-ecg .tr.new { animation: dlm-draw .7s ease-out both; }
@keyframes dlm-draw { from { clip-path: inset(-50% 100% -50% 0); } to { clip-path: inset(-50% 0 -50% 0); } }
.dlm-ecg .glow.c { stroke: rgb(111 211 162 / .18); stroke-width: 6; }
.dlm-ecg .glow.d { stroke: rgb(255 106 82 / .22); stroke-width: 7; }
.dlm-ecg .both-d { fill: rgb(226 82 61 / .1); }
.dlm-ecg .col { fill: transparent; }
.dlm-ecg .col:hover { fill: rgb(243 210 126 / .08); }
.dlm-ecg .pen { animation: dlm-pen 1.2s ease-in-out infinite; }
@keyframes dlm-pen { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.dlm-ecg .rn { font: 500 10px/1 var(--num); fill: rgb(242 227 194 / .3); }

/* ---- 小尺寸：手机上收起次要统计，大厅缩略图只留牌、分数和心电图 ---- */
@container (max-width: 520px) { .dlm-side .st .more { display: none; } .dlm-ecg .cap { display: none; } }
@container (max-width: 300px) { .dlm-side .st, .dlm-say, .dlm-cap, .dlm-ecg .lab { display: none; } .dlm-side .unit { display: none; } }

/* ---- 玩家本人操作 ---- */
.dlm-ctl { position: absolute; left: 50%; translate: -50% 0; z-index: 7; display: none; }
.dlm-ctl.on { display: flex; }
.dlm-ctl.talk { top: 41.4cqw; width: 36cqw; gap: .8cqw; align-items: center; }
.dlm-ctl.talk .btn.mute { padding-left: 1cqw; padding-right: 1cqw; }
.dlm-ctl.talk input { flex: 1; min-width: 0; font: 500 max(13px, 1.6cqw)/1.4 var(--serif); padding: .9cqw 1.4cqw; user-select: text; }
.dlm-ctl.talk .btn { flex: none; font-size: max(13px, 1.6cqw); }
.dlm-ctl.choose { top: 27.4cqw; gap: 3cqw; }
.dlm-pick { position: relative; width: 9.8cqw; height: 13.4cqw; min-width: 54px; min-height: 74px; padding: 0; border: 0; border-radius: .9cqw; cursor: pointer; writing-mode: vertical-rl;
  font: 400 3.6cqw/1.05 var(--brush); letter-spacing: .1em; color: #2a1209;
  background: var(--fiber), radial-gradient(120% 80% at 18% 0%, rgb(255 255 255 / .55), transparent 55%), linear-gradient(180deg, #fbf0d4 0%, #f2e0b6 60%, #e7d09e 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .85), 0 0 0 1px rgb(120 84 30 / .55), 0 2px 0 1px #b4955a, 0 4px 0 0 #8e7240, 0 .8cqw 1.2cqw rgb(0 0 0 / .6);
  transition: translate .15s var(--ease), box-shadow .15s var(--ease), filter .15s; }
.dlm-pick.d { color: #b4241a; }
.dlm-pick:hover:not(:disabled) { translate: 0 -.8cqw; box-shadow: inset 0 1px 0 rgb(255 255 255 / .85), 0 0 0 1px rgb(120 84 30 / .55), 0 2px 0 1px #b4955a, 0 4px 0 0 #8e7240, 0 1.6cqw 2cqw rgb(0 0 0 / .6), 0 0 0 .3cqw rgb(243 210 126 / .7); }
.dlm-pick.d:hover:not(:disabled) { box-shadow: inset 0 1px 0 rgb(255 255 255 / .85), 0 0 0 1px rgb(120 84 30 / .55), 0 2px 0 1px #b4955a, 0 4px 0 0 #8e7240, 0 1.6cqw 2cqw rgb(0 0 0 / .6), 0 0 2cqw rgb(226 82 61 / .7); }
.dlm-pick:active:not(:disabled) { translate: 0 2px; }
.dlm-pick:disabled { filter: saturate(.4) brightness(.8); cursor: default; }
.dlm-pick small { position: absolute; left: -2cqw; right: -2cqw; top: calc(100% + 1cqw); writing-mode: horizontal-tb; font: 500 max(9px, 1.15cqw)/1.35 var(--sans); letter-spacing: 0; color: rgb(242 227 194 / .62); white-space: nowrap; }
/* 窄屏：两张牌之间放不下输入框和两个按钮，喊话输入框改为横跨整张桌子，放到心电图的位置上（喊话时心电图让位），不压着两张牌和桌沿铭牌 */
@container (max-width: 760px) {
  .dlm-ctl.talk { top: auto; bottom: 2.6cqw; left: 3cqw; right: 3cqw; translate: none; width: auto; gap: 8px; }
  .dlm-box.talking .dlm-ecg { opacity: 0; pointer-events: none; }
}
/* 手机：按键 44px、输入框 16px 字（iOS 聚焦时不放大页面） */
@container (max-width: 520px) {
  .dlm-ctl.talk { top: auto; bottom: 2.6cqw; left: 3cqw; right: 3cqw; translate: none; width: auto; gap: 8px; }
  .dlm-ctl.talk input { font-size: 16px; padding: 6px 12px; min-height: 44px; }
  .dlm-ctl.talk .btn { font-size: 14px; min-height: 44px; padding-left: 14px; padding-right: 14px; }
  .dlm-box.talking .dlm-ecg { opacity: 0; pointer-events: none; }
  /* 出牌：两张牌下面的得分提示拆成两行，桌沿铭牌先让开（转播条和牌下已经写着「轮到你出牌」） */
  .dlm-ctl .dlm-pick small .s1 { display: none; } .dlm-ctl .dlm-pick small .s2 { display: inline; }
  .dlm-box.choosing .dlm-plaque { visibility: hidden; }
}
.dlm-ecg { transition: opacity .25s; }
.dlm-side .st .ln.ok { color: #6fd3a2; } .dlm-side .st .ln.no { color: #ff8a72; }
.dlm-pick small .s2 { display: none; }
`;

let styled = false;
function ensureStyle() {
  if (styled || typeof document === 'undefined') return;
  const s = document.createElement('style');
  s.dataset.stage = 'dilemma';
  s.textContent = STYLE;
  document.head.append(s);
  styled = true;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
const chars = (s) => [...String(s || '')].length;
const talkTitle = (t) => (t === null || t === undefined ? '?' : t ? `「${t}」` : '（不说）');
const choiceName = (c) => (c === 'C' ? '合作' : c === 'D' ? '背叛' : '?');
const other = (s) => (s === 'a' ? 'b' : 'a');

/** 裂纹：从一角斜劈下来，分出两三道细枝 */
const CRACK = `<svg class="crack" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
  <path class="k1" pathLength="1" d="M 72 -2 L 61 22 L 68 34 L 50 58 L 57 70 L 41 96 L 47 112 L 33 142"/>
  <path class="k1" pathLength="1" d="M 50 58 L 30 64 L 22 80"/>
  <path class="k1" pathLength="1" d="M 57 70 L 78 82 L 86 100"/>
  <path class="k2" pathLength="1" d="M 73 -1 L 62 23 L 69 35 L 51 59 L 58 71 L 42 97 L 48 113 L 34 141"/>
</svg>`;

/** 一次心跳：合作是规整的 PQRST，背叛是一下大幅的乱跳 */
function beat(x0, x1, y, c) {
  const cx = (x0 + x1) / 2, w = Math.min((x1 - x0) * 0.78, 44);
  const p = (dx, dy) => `${(cx + dx * w).toFixed(1)} ${(y + dy).toFixed(1)}`;
  if (c === 'D') return `M ${x0.toFixed(1)} ${y} L ${p(-0.42, 0)} L ${p(-0.3, 9)} L ${p(-0.16, -40)} L ${p(0, 34)} L ${p(0.14, -28)} L ${p(0.27, 12)} L ${p(0.38, -6)} L ${p(0.46, 0)} L ${x1.toFixed(1)} ${y}`;
  return `M ${x0.toFixed(1)} ${y} L ${p(-0.44, 0)} L ${p(-0.34, -5)} L ${p(-0.24, 0)} L ${p(-0.1, 0)} L ${p(-0.04, 4)} L ${p(0.03, -20)} L ${p(0.1, 7)} L ${p(0.16, 0)} L ${p(0.3, -6)} L ${p(0.42, 0)} L ${x1.toFixed(1)} ${y}`;
}

export default {
  aspect: [4, 3],
  seatColor: (seat) => (seat === 'a' ? 'var(--black-side)' : '#3559b5'),

  createStage({ onAction }) {
    ensureStyle();
    const el = document.createElement('div');
    el.className = 'dlm';
    el.innerHTML = `
      <div class="dlm-box">
        <div class="dlm-table"></div><div class="dlm-front"></div>
        <div class="dlm-lamp" aria-hidden="true"><i class="cone"></i><i class="cord"></i><i class="shade"></i><i class="bulb"></i></div>
        <div class="dlm-head">
          ${['a', 'b'].map((s) => `<div class="dlm-side ${s}"><span class="coin">${NAMES[s]}</span><div><div class="sc"><span class="num">0</span><span class="unit">分</span></div><div class="st"></div></div></div>`).join('')}
        </div>
        ${['a', 'b'].map((s) => `<div class="dlm-slot ${s} down"><div class="dlm-flip"><div class="dlm-face"><span class="w"></span>${CRACK}<span class="u"></span></div><div class="dlm-back"><b>囚</b></div></div><div class="dlm-cap"></div></div>`).join('')}
        ${['a', 'b'].map((s) => `<div class="dlm-say ${s} off"></div>`).join('')}
        <div class="dlm-plaque"><span class="r"></span><span class="p"></span></div>
        <div class="dlm-ecg"><svg viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="none" role="img" aria-label="信任心电图"></svg>
          <span class="lab" style="top:${(YB.a / VBH) * 100}%">甲</span><span class="lab" style="top:${(YB.b / VBH) * 100}%">乙</span><span class="cap">信任心电图</span></div>
        <div class="dlm-ctl talk"><input type="text" maxlength="30" autocomplete="off"><button type="button" class="btn primary">说</button><button type="button" class="btn ghost mute">不说话</button></div>
        <div class="dlm-ctl choose"><button type="button" class="dlm-pick c">合作<small></small></button><button type="button" class="dlm-pick d">背叛<small></small></button></div>
      </div>`;
    const box = el.querySelector('.dlm-box');
    const $ = (q) => box.querySelector(q);
    const side = { a: $('.dlm-side.a'), b: $('.dlm-side.b') };
    const num = { a: $('.dlm-side.a .num'), b: $('.dlm-side.b .num') };
    const stat = { a: $('.dlm-side.a .st'), b: $('.dlm-side.b .st') };
    const slot = { a: $('.dlm-slot.a'), b: $('.dlm-slot.b') };
    const say = { a: $('.dlm-say.a'), b: $('.dlm-say.b') };
    const plaqueR = $('.dlm-plaque .r'), plaqueP = $('.dlm-plaque .p');
    const ecg = $('.dlm-ecg svg');
    const talkBox = $('.dlm-ctl.talk'), chooseBox = $('.dlm-ctl.choose');
    const input = talkBox.querySelector('input'), sayBtn = talkBox.querySelector('button.primary'), muteBtn = talkBox.querySelector('button.mute');
    const btnC = $('.dlm-pick.c'), btnD = $('.dlm-pick.d');

    // ---------- 交互 ----------
    const buttons = [sayBtn, muteBtn, btnC, btnD];
    const submit = (action, after) => {
      if (buttons.some((b) => b.disabled)) return;
      buttons.forEach((b) => { b.disabled = true; });
      Promise.resolve(onAction(action)).catch(() => {}).finally(() => {
        buttons.forEach((b) => { b.disabled = false; });
        after?.();
      });
    };
    const sayNow = () => submit(input.value.replace(/[\r\n]+/g, ' ').trim(), () => { input.value = ''; });
    sayBtn.addEventListener('click', sayNow);
    // 这一轮不喊话：直接交一句空话（和输入框空着点「说」一样，但不用猜）
    muteBtn.addEventListener('click', () => submit('', () => { input.value = ''; }));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sayNow(); } });
    btnC.addEventListener('click', () => submit('C'));
    btnD.addEventListener('click', () => submit('D'));

    // ---------- 状态 ----------
    let shownHist = null;
    let shownScore = { a: 0, b: 0 };
    let scoreTimer = null;
    let cardsKey = '';

    function setScore(sc, pop) {
      for (const s of ['a', 'b']) {
        const changed = String(sc[s]) !== num[s].textContent;
        num[s].textContent = String(sc[s]);
        if (pop && changed && num[s].animate) num[s].animate([{ scale: 1.35 }, { scale: 1 }], { duration: 420, easing: 'cubic-bezier(.2, 1.6, .4, 1)' });
      }
      shownScore = { ...sc };
    }

    /** 牌：c 为 'C' / 'D' / null；down 扣着 */
    function setCard(s, c, pts) {
      const face = slot[s].querySelector('.dlm-face');
      face.classList.toggle('d', c === 'D');
      face.querySelector('.w').textContent = c ? choiceName(c) : '';
      face.querySelector('.u').textContent = pts === null || pts === undefined ? '' : `+${pts}`;
    }

    function flyPay(s, pts, delay) {
      const from = slot[s].getBoundingClientRect(), to = num[s].getBoundingClientRect(), b = box.getBoundingClientRect();
      if (!from.width || !b.width) return;
      const k = box.offsetWidth / b.width || 1; // 外层可能被缩放
      const sx = (from.left + from.width / 2 - b.left) * k, sy = (from.top + from.height * 0.35 - b.top) * k;
      const ex = (to.left + to.width / 2 - b.left) * k, ey = (to.top + to.height / 2 - b.top) * k;
      const t = document.createElement('span');
      t.className = `dlm-pay p${pts}`;
      t.textContent = `+${pts}`;
      t.style.left = `${sx}px`;
      t.style.top = `${sy}px`;
      box.append(t);
      if (!t.animate) { t.remove(); return; }
      const an = t.animate([
        { transform: 'translate(0, 0) scale(.6)', opacity: 0 },
        { transform: 'translate(0, -24px) scale(1.25)', opacity: 1, offset: 0.25 },
        { transform: 'translate(0, -24px) scale(1.15)', opacity: 1, offset: 0.4 },
        { transform: `translate(${ex - sx}px, ${ey - sy}px) scale(.7)`, opacity: 0.9, offset: 0.92 },
        { transform: `translate(${ex - sx}px, ${ey - sy}px) scale(.6)`, opacity: 0 },
      ], { duration: 1150, delay, easing: 'cubic-bezier(.4, 0, .3, 1)', fill: 'both' });
      an.onfinish = () => t.remove();
      setTimeout(() => t.remove(), delay + 1600);
    }

    function drawEcg(view, fresh) {
      const hist = view.history || [];
      const cur = !view.over && view.current;
      const n = Math.max(20, hist.length + (cur ? 1 : 0));
      const x0 = 6, x1 = VBW - 6, cw = (x1 - x0) / n;
      const out = [];
      for (let i = 1; i < n; i++) out.push(`<line class="grid" x1="${x0 + i * cw}" y1="0" x2="${x0 + i * cw}" y2="${VBH}"/>`);
      for (const s of ['a', 'b']) out.push(`<line class="base" x1="${x0}" y1="${YB[s]}" x2="${x1}" y2="${YB[s]}"/>`);
      hist.forEach((r, i) => {
        if (r.choice.a === 'D' && r.choice.b === 'D') out.push(`<rect class="both-d" x="${x0 + i * cw}" y="0" width="${cw}" height="${VBH}"/>`);
      });
      hist.forEach((r, i) => {
        const isNew = fresh && i === hist.length - 1;
        for (const s of ['a', 'b']) {
          const c = r.choice[s] === 'D' ? 'd' : 'c';
          const d = beat(x0 + i * cw, x0 + (i + 1) * cw, YB[s], r.choice[s]);
          out.push(`<path class="tr glow ${c}${isNew ? ' new' : ''}" d="${d}"/><path class="tr ${c}${isNew ? ' new' : ''}" d="${d}"/>`);
        }
      });
      const xe = x0 + hist.length * cw;
      if (!view.over) for (const s of ['a', 'b']) out.push(`<line class="base" x1="${xe}" y1="${YB[s]}" x2="${xe}" y2="${YB[s]}"/>`);
      hist.forEach((r, i) => {
        const title = `第 ${i + 1} 轮\n甲：${talkTitle(r.talk.a)} ${choiceName(r.choice.a)} +${r.pts.a}\n乙：${talkTitle(r.talk.b)} ${choiceName(r.choice.b)} +${r.pts.b}`;
        out.push(`<rect class="col" x="${x0 + i * cw}" y="0" width="${cw}" height="${VBH}"><title>${esc(title)}</title></rect>`);
      });
      ecg.innerHTML = out.join('');
      // 笔尖：画在 HTML 坐标里，免得被非等比缩放压扁
      ecg.parentElement.querySelectorAll('.pen').forEach((p) => p.remove());
      if (!view.over) {
        for (const s of ['a', 'b']) {
          const dot = document.createElement('i');
          dot.className = 'pen';
          dot.style.cssText = `position:absolute;left:calc(4.6cqw + (100% - 6cqw) * ${xe / VBW});top:${(YB[s] / VBH) * 100}%;width:.9cqw;height:.9cqw;min-width:5px;min-height:5px;border-radius:50%;translate:-50% -50%;background:#c9ffe2;box-shadow:0 0 .8cqw .3cqw rgb(111 211 162 / .8)`;
          ecg.parentElement.append(dot);
        }
      }
    }

    return {
      el,
      render(view, { movable = null, animate = true } = {}) {
        if (!view) return;
        const hist = view.history || [];
        const fresh = animate && shownHist !== null && hist.length === shownHist + 1;
        const first = shownHist === null;
        shownHist = hist.length;
        const last = hist[hist.length - 1] || null;
        const cur = view.over ? null : view.current;
        const viewer = view.viewer || null;

        // 顶部：分数、统计
        const st = view.stats || {};
        for (const s of ['a', 'b']) {
          const x = st[s];
          const n = hist.length;
          const avg = view.line && n ? (view.score?.[s] ?? 0) / n : null;
          const ln = avg === null ? '' : `<span class="ln ${avg >= view.line ? 'ok' : 'no'}" title="平均每轮 ${avg.toFixed(2)} 分；达标线是平均每轮 ${view.line} 分">均 ${avg.toFixed(1)}</span> · `;
          stat[s].innerHTML = x && x.played ? `${ln}<span>合作 ${pct(x.coopRate)}</span><span class="more"> · 报复 ${pct(x.retaliation)} · 先背叛 ${x.unprovoked}</span>` : `<span>合作 —</span>${view.line ? `<span class="more"> · 达标线均 ${view.line}</span>` : ''}`;
          side[s].classList.toggle('win', !!view.over && view.winner === s);
        }
        const sc = view.score || { a: 0, b: 0 };
        clearTimeout(scoreTimer);
        if (fresh && last) {
          // 揭晓：先显示上一轮的分，等收益数字飞到再加上
          setScore({ a: sc.a - last.pts.a, b: sc.b - last.pts.b }, false);
          scoreTimer = setTimeout(() => setScore(sc, true), 1650);
        } else setScore(sc, false);

        // 牌：揭晓后亮着，下一轮进入「出牌」才扣下
        const choosing = !!cur && view.phase === 'choose';
        const showLast = last && !choosing;
        const key = showLast ? `r${hist.length}` : `d${hist.length}`;
        const keyChanged = key !== cardsKey;
        cardsKey = key;
        for (const s of ['a', 'b']) {
          const sl = slot[s];
          const cap = sl.querySelector('.dlm-cap');
          if (showLast) {
            setCard(s, last.choice[s], last.pts[s]);
            if (fresh) {
              // 先扣着，下一帧同时翻开
              sl.classList.add('down');
              sl.classList.remove('dd', 'static', 'played');
              void sl.offsetWidth;
              sl.classList.remove('down');
              if (last.choice[s] === 'D') sl.classList.add('dd');
            } else {
              sl.classList.remove('down', 'played');
              sl.classList.toggle('dd', last.choice[s] === 'D');
              if (keyChanged || first) sl.classList.add('static');
            }
            cap.textContent = `第 ${hist.length} 轮`;
            cap.classList.remove('on');
          } else {
            if (keyChanged) sl.classList.remove('dd', 'static');
            sl.classList.add('down');
            const v = cur?.choice?.[s];
            const known = v !== null && v !== undefined;
            const pending = (view.pending || []).includes(s);
            sl.classList.toggle('played', choosing && (known || (!pending && (view.pending || []).length > 0)));
            if (choosing) {
              if (known && viewer === s) cap.textContent = `你出了「${choiceName(v)}」`;
              else if (known || (!pending && (view.pending || []).length > 0)) cap.textContent = '已出牌';
              else cap.textContent = movable === s ? '轮到你出牌' : '思量中…';
              cap.classList.toggle('on', sl.classList.contains('played'));
              sl.title = known && !viewer ? `暗牌：${choiceName(v)}` : '';
            } else {
              cap.textContent = view.over ? '' : '等待发牌';
              cap.classList.remove('on');
              sl.title = '';
            }
          }
        }
        if (fresh && last) {
          for (const s of ['a', 'b']) flyPay(s, last.pts[s], 820);
        }

        // 对白：本轮的喊话；终局时留着最后一轮的
        for (const s of ['a', 'b']) {
          const b = say[s];
          let talk = null, faint = false, typing = false;
          if (cur) {
            const t = cur.talk?.[s];
            if (t !== null && t !== undefined) { talk = t; faint = view.phase === 'talk'; }
            else if (view.phase === 'talk' && movable !== s) {
              // 轮流先手：只有正在说的那个人冒「…」；同时喊话（旧规则）时还没交的都冒
              const talker = view.first ? (cur.talk?.[view.first] == null ? view.first : other(view.first)) : null;
              typing = talker ? talker === s : ((view.pending || []).includes(s) || !viewer);
            }
          } else if (view.over && last) talk = last.talk[s];
          let html = '', cls = '';
          if (typing) html = '<span class="dots"><i></i><i></i><i></i></span>';
          else if (talk === '') { html = '（不说话）'; cls = 'mute'; } else if (talk) html = esc(talk);
          const next = `dlm-say ${s}${html ? '' : ' off'}${faint ? ' faint' : ''}${cls ? ` ${cls}` : ''}`;
          if (b.innerHTML !== html) b.innerHTML = html;
          if (b.className !== next) b.className = next;
          b.title = talk ? talk : '';
        }

        // 桌沿铭牌
        if (view.over) {
          plaqueR.textContent = `共 ${view.round} 轮`;
          const line = view.line ? view.line * view.round : null;
          const ok = line === null ? null : ['a', 'b'].filter((s) => (view.score?.[s] ?? 0) >= line);
          plaqueP.textContent = (view.winner ? `${NAMES[view.winner]}胜` : ok && !ok.length ? '两败俱伤' : '平局') + (line === null ? '' : ` · 达标线 ${line}`);
          plaqueP.className = 'p hot';
        } else {
          plaqueR.textContent = `第 ${view.round} 轮`;
          // 真人在局：牌匾上写明总轮数保密（到最后一轮也不会提前告诉你）
          const talkWho = view.phase === 'talk' && view.first ? `${NAMES[view.first]}先说` : '';
          plaqueP.textContent = `${view.phase === 'talk' ? '喊话' : '出牌'}${talkWho ? ` · ${talkWho}` : ''}${movable || (viewer && viewer !== '*') ? ' · 共几轮保密' : ''}`;
          plaqueP.className = `p${choosing ? ' hot' : ''}`;
        }
        box.querySelector('.dlm-seal')?.remove();
        if (view.over) {
          const seal = document.createElement('div');
          seal.className = `seal dlm-seal${view.winner ? '' : ' draw'}`;
          seal.textContent = view.winner ? `${NAMES[view.winner]}胜` : '平局';
          box.append(seal);
        }

        drawEcg(view, fresh);

        // 玩家本人
        const canTalk = !!movable && !view.over && view.phase === 'talk';
        const canChoose = !!movable && !view.over && view.phase === 'choose';
        if (movable) {
          input.placeholder = `对${NAMES[other(movable)]}说一句…`;
          const heard = view.first && view.first !== movable ? cur?.talk?.[view.first] : null;
          input.placeholder = heard != null ? `回${NAMES[other(movable)]}一句…` : `对${NAMES[other(movable)]}说一句…`;
          input.title = '可以不说话；一共打几轮双方都不知道，到最后一轮也不会提前告诉你';
          const payHint = (m) => `对方合 +${m.C}<span class="s1"> · 背 </span><span class="s2"><br>对方背 </span>+${m.D}`;
          btnC.querySelector('small').innerHTML = payHint(PAY.C);
          btnD.querySelector('small').innerHTML = payHint(PAY.D);
        }
        const wasTalk = talkBox.classList.contains('on');
        talkBox.classList.toggle('on', canTalk);
        chooseBox.classList.toggle('on', canChoose);
        box.classList.toggle('acting', canTalk || canChoose);
        box.classList.toggle('talking', canTalk);
        box.classList.toggle('choosing', canChoose);
        if (canTalk && !wasTalk) setTimeout(() => input.focus({ preventScroll: true }), 0);
      },
    };
  },

  /** 着法列表：和对局记录一一对应（每轮依次为甲喊、乙喊、甲选、乙选） */
  moveList(view) {
    const out = [];
    const short = (t) => (t ? (chars(t) > 6 ? `「${[...t].slice(0, 6).join('')}…」` : `「${t}」`) : '（不说）');
    const push = (seat, kind, v) => out.push({ seat, label: kind === 'talk' ? short(v) : choiceName(v) });
    // 规则 2 起喊话轮流先手：双数轮乙先说
    const order = (i) => ((view?.rules || 1) >= 2 && i % 2 === 0 ? ['b', 'a'] : ['a', 'b']);
    (view?.history || []).forEach((r, i) => {
      for (const s of order(i + 1)) push(s, 'talk', r.talk[s]);
      for (const s of ['a', 'b']) push(s, 'choice', r.choice[s]);
    });
    const cur = view?.current;
    if (cur) {
      for (const s of order(view.round)) if (cur.talk[s] !== null && cur.talk[s] !== undefined) push(s, 'talk', cur.talk[s]);
      for (const s of ['a', 'b']) if (cur.choice[s] !== null && cur.choice[s] !== undefined) push(s, 'choice', cur.choice[s]);
    }
    return out;
  },
};
