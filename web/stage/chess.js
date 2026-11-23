// 国际象棋画面：深漆描金外框 + 象牙 / 檀木格子 + 自绘 Staunton 造型的矢量棋子。
//
// 材质按设计系统「一盏灯在左上方」：外框是镶金边的乌漆板、下沿露出铜色侧壁，坐标 a–h、1–8 印在框上；
// 棋盘面略凹进框里（上、左边沿内阴影）；白方象牙色、黑方乌木色描金边，左侧一道高光，脚下一团投影。
// 棋子外形放在每个棋盘自己的 <defs> 里（id 带实例前缀），每个棋子只是一个 <use>，不用滤镜。
//
// 动效：走子滑动（略抬起）；吃子时被吃的子淡出飞走；易位时王车同动；升变时兵滑到底线后变身、金光一闪；
// 被将军的王格红光呼吸。上一步起点、落点淡金色；棋盘内容不变的重复 render 不重建棋子，动画不会被打断。
// 玩家本人执子时：点选、合法落点（圆点 / 吃子圈）、升变选择（后车象马）。

import { parseFen, legalMoves, moveToUci } from '/games/chess/rules.js';
import { arrowPath } from '../js/board.js';

const NS = 'http://www.w3.org/2000/svg';
const S = 64;          // 格宽
const F = 30;          // 外框宽度（印坐标）
const T = 6;           // 外框侧壁厚度
const W = F * 2 + S * 8;     // 572
const H = W + T;             // 578
const FILES = 'abcdefgh';
const PROMOS = ['q', 'r', 'b', 'n'];

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
};
const stops = (...list) => list.map(([o, c, a = 1]) => svg('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }));
const sideOf = (p) => (p ? (p < 'a' ? 'w' : 'b') : null);
const sqName = (s) => FILES[s & 7] + ((s >> 3) + 1);
const parseSq = (t) => FILES.indexOf(t[0]) + (Number(t[1]) - 1) * 8;
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Staunton 棋子外形 ----------
// 画在 100×100 的格子里，中轴 x=50，底座落在 y≈93。每种棋子由几块部件从后往前叠（各自描边，前面的盖住后面的），
// 再加几道细节线（领口、马眼、象帽的刻缝）。
const BASE = (x0, x1, top = 83) => `M ${x0 + 2} 93 H ${x1 - 2} Q ${x1 + 1} 93 ${x1} 90 L ${x1 - 3} ${top + 2} Q ${x1 - 4} ${top} ${x1 - 7} ${top} H ${x0 + 7} Q ${x0 + 4} ${top} ${x0 + 3} ${top + 2} L ${x0} 90 Q ${x0 - 1} 93 ${x0 + 2} 93 Z`;
const RING = (x0, x1, y0, y1) => `M ${x0} ${y1} Q ${x0 - 1} ${(y0 + y1) / 2} ${x0 + 2} ${y0} H ${x1 - 2} Q ${x1 + 1} ${(y0 + y1) / 2} ${x1} ${y1} Z`;
const ELL = (cx, cy, rx, ry) => `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;

const SHAPES = {
  p: {
    parts: [
      ELL(50, 42, 12.5, 12.5),
      'M 31 84 C 33 74, 41 69, 43 58 L 57 58 C 59 69, 67 74, 69 84 Z',
      ELL(50, 58, 13.5, 3.6),
      BASE(23, 77),
    ],
    lines: [],
  },
  r: {
    parts: [
      'M 34 79 L 36.5 48 L 63.5 48 L 66 79 Z',
      'M 29 49 H 71 L 69 42 H 31 Z',
      'M 29 43 V 24 H 37.5 V 30.5 H 45.5 V 24 H 54.5 V 30.5 H 62.5 V 24 H 71 V 43 Z',
      RING(28, 72, 77, 84),
      BASE(21, 79),
    ],
    lines: ['M 33 36.5 H 67'],
  },
  b: {
    parts: [
      'M 36 80 C 38 71, 43 66, 44.5 58 L 55.5 58 C 57 66, 62 71, 64 80 Z',
      'M 50 18 C 61 27, 65.5 37, 61.5 46 C 59.5 50.5, 55 53.5, 50 53.5 C 45 53.5, 40.5 50.5, 38.5 46 C 34.5 37, 39 27, 50 18 Z',
      ELL(50, 14.5, 4.2, 4.2),
      ELL(50, 55.5, 9.5, 2.6),
      ELL(50, 59.5, 13, 3.3),
      RING(29, 71, 78, 84),
      BASE(23, 77),
    ],
    lines: ['M 52.5 28 L 58 39.5'],
  },
  q: {
    parts: [
      'M 35 80 C 38 69, 41.5 57, 39.5 45 L 60.5 45 C 58.5 57, 62 69, 65 80 Z',
      'M 31 47 L 24 25 L 37 37.5 L 37.5 19 L 46 34.5 L 50 15.5 L 54 34.5 L 62.5 19 L 63 37.5 L 76 25 L 69 47 Z',
      ELL(24, 23.5, 3.6, 3.6), ELL(37.5, 17.5, 3.6, 3.6), ELL(50, 13.5, 3.8, 3.8), ELL(62.5, 17.5, 3.6, 3.6), ELL(76, 23.5, 3.6, 3.6),
      ELL(50, 47.5, 19.5, 3.8),
      ELL(50, 54, 13, 3),
      RING(27, 73, 78, 84),
      BASE(20, 80),
    ],
    lines: [],
  },
  k: {
    parts: [
      'M 46.8 31 V 22.5 H 41.5 V 17 H 46.8 V 10.5 H 53.2 V 17 H 58.5 V 22.5 H 53.2 V 31 Z',
      'M 35 80 C 38 69, 41.5 59, 40 47 L 60 47 C 58.5 59, 62 69, 65 80 Z',
      'M 32.5 49 C 27 39, 32 29.5, 42 29.5 H 58 C 68 29.5, 73 39, 67.5 49 Z',
      ELL(50, 49, 18.5, 3.8),
      ELL(50, 55.5, 12.5, 3),
      RING(26, 74, 78, 84),
      BASE(19, 81),
    ],
    lines: ['M 36 40 H 64'],
  },
  n: {
    parts: [
      // 马头向左：胸口 → 喉 → 下颌 → 嘴 → 鼻梁 → 额头 → 耳朵 → 后脑 → 鬃毛 → 背
      'M 35 81 C 35.5 71, 41 64.5, 45.5 57.5 C 41.5 56.5, 38 55, 35 54.5 C 30 54.5, 25.5 56, 21 53.5 C 16.5 51, 15 46.5, 17.5 43 C 20 39.5, 22 36, 26 31.5 C 30 27, 33.5 23.5, 38.5 20.5 L 43 8.5 L 48.5 18 C 60.5 17, 70.5 26.5, 73.5 38.5 C 76.5 51, 74.5 66, 71.5 81 Z',
      RING(27, 73, 78, 84),
      BASE(22, 78),
    ],
    lines: ['M 17.5 47.5 C 20 48.5, 23 48.5, 25.5 47.5', 'M 49 20 C 59 25, 64.5 34, 66.5 46', 'M 30 54.5 C 33 51, 36.5 48, 41 46.5'],
    dots: [[36.5, 31.5, 2.4, 1.7], [21.5, 43.2, 1.3, 1.1]],
  },
};
// 左侧高光带只盖主体部件，避免叠在接缝上
const SHEEN_PARTS = { p: [0, 1], r: [0, 2], b: [0, 1], q: [0, 1], k: [1, 2], n: [0] };

const STYLE = `
svg.board.chs { overflow: visible; }
/* 大厅缩略图：格子行高不随棋盘的固有高度撑开，棋盘按比例缩进卡片 */
.mthumb > .board-wrap > svg.board.chs { position: absolute; inset: 0; }
svg.board.chs .ch-coord { font: 600 15px/1 var(--num); fill: #e8c674; text-anchor: middle; dominant-baseline: central; }
svg.board.chs .ch-pc { cursor: default; }
svg.board.chs.can-move .ch-pc.mine { cursor: pointer; }
svg.board.chs .ch-bd, svg.board.chs .ch-sh { transition: transform .18s var(--ease), opacity .18s; }
svg.board.chs .ch-pc.sel .ch-bd { transform: translate(-1px, -5px) scale(1.06); }
svg.board.chs .ch-pc.sel .ch-sh { transform: translate(4px, 3px) scale(1.15); opacity: .5; }
svg.board.chs .ch-last { fill: #f0c75e; }
svg.board.chs .ch-last.from { opacity: .26; }
svg.board.chs .ch-last.to { opacity: .4; }
svg.board.chs .ch-last-edge { fill: none; stroke: #f6d685; stroke-width: 2; opacity: .75; }
svg.board.chs .ch-fresh { animation: ch-in .26s .22s both; }
svg.board.chs .ch-sel { fill: #f0c75e; opacity: .45; }
svg.board.chs .ch-check { animation: ch-breathe 1.5s ease-in-out infinite; }
svg.board.chs .ch-dot { fill: rgb(40 18 6 / .42); pointer-events: none; }
svg.board.chs .ch-cap { fill: none; stroke: rgb(40 18 6 / .45); stroke-width: 5; pointer-events: none; }
svg.board.chs .ch-hit { fill: transparent; cursor: pointer; }
svg.board.chs .ch-hit:hover { fill: rgb(240 205 120 / .3); }
svg.board.chs .ch-arrow { fill: #2f7a68; fill-opacity: .82; stroke: #123a30; stroke-width: 1.2; stroke-opacity: .6; }
svg.board.chs .ch-arrow.hint { fill: #1c120c; fill-opacity: .5; stroke: none; }
svg.board.chs .ch-promo-bg { fill: #0b0302; opacity: .62; cursor: pointer; }
svg.board.chs .ch-promo-opt { cursor: pointer; }
svg.board.chs .ch-promo-opt .tile { stroke-width: 1.6; }
svg.board.chs .ch-promo-opt:hover .tile { stroke-width: 3; }
svg.board.chs .ch-promo-opt:hover .ch-bd { transform: translateY(-3px) scale(1.06); }
:root[data-theme="light"] svg.board.chs .ch-promo-bg { fill: #f3e8d0; opacity: .7; }
@keyframes ch-in { from { opacity: 0; } }
@keyframes ch-breathe { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
`;
let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
}

let seq = 0;

/** 合法着法：优先用服务端给的 actions，没有时用规则代码从 FEN 算 */
function legalIds(view, actions) {
  if (Array.isArray(actions)) return actions.map((a) => a.id);
  try { return legalMoves(parseFen(view.fen)).map(moveToUci); } catch { return []; }
}

function createStage({ onAction }) {
  injectStyle();
  const id = `ch${++seq}-`;
  const url = (n) => `url(#${id}${n})`;
  let flipped = false;
  let view = { board: new Array(64).fill(null), side: 'w', moves: [] };
  let opts = { movable: null, arrows: [] };
  let selected = null;
  let promo = null; // { from, to }
  let sig = null;
  const els = new Map();

  const X = (s) => F + (flipped ? 7 - (s & 7) : s & 7) * S + S / 2;
  const Y = (s) => F + (flipped ? s >> 3 : 7 - (s >> 3)) * S + S / 2;

  const el = svg('svg', { class: 'board chs', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '国际象棋棋盘' });

  // ---------- defs ----------
  const defs = svg('defs', {},
    svg('linearGradient', { id: id + 'lac', x1: 0, y1: 0, x2: 0, y2: 1 },
      ...stops([0, '#3a1610'], [0.35, '#24100b'], [1, '#130705'])),
    svg('radialGradient', { id: id + 'lac-sheen', cx: 0.16, cy: 0, r: 0.75, gradientTransform: 'scale(1 .7)' },
      ...stops([0, '#ffe2bc', 0.24], [0.5, '#ffd6aa', 0.05], [1, '#ffd6aa', 0])),
    svg('linearGradient', { id: id + 'gold', x1: 0, y1: 0, x2: 1, y2: 1 },
      ...stops([0, '#fff3c8'], [0.08, '#ecc668'], [0.22, '#b08030'], [0.42, '#5e400f'], [0.56, '#7c5a1c'], [0.78, '#c79c44'], [0.9, '#efd28a'], [1, '#8e6824'])),
    // 象牙格、檀木格（渐变跨整个棋盘，左上亮）
    svg('linearGradient', { id: id + 'ivory', x1: F, y1: F, x2: F + 8 * S, y2: F + 8 * S, gradientUnits: 'userSpaceOnUse' },
      ...stops([0, '#fbf0d6'], [0.5, '#f0dfba'], [1, '#e0c99c'])),
    svg('linearGradient', { id: id + 'sandal', x1: F, y1: F, x2: F + 8 * S, y2: F + 8 * S, gradientUnits: 'userSpaceOnUse' },
      ...stops([0, '#b46c40'], [0.5, '#9c5631'], [1, '#7c3f20'])),
    svg('radialGradient', { id: id + 'field-light', cx: 0.18, cy: 0.06, r: 0.95 },
      ...stops([0, '#fff8e4', 0.28], [0.5, '#fff8e4', 0.04], [1, '#2a0e02', 0.2])),
    svg('linearGradient', { id: id + 'in-top', x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops([0, '#000', 0.5], [1, '#000', 0])),
    svg('linearGradient', { id: id + 'in-left', x1: 0, y1: 0, x2: 1, y2: 0 }, ...stops([0, '#000', 0.38], [1, '#000', 0])),
    // 棋子：象牙、乌木（左亮右暗）、左侧高光带、乌木的描金边
    svg('linearGradient', { id: id + 'p-w', x1: 18, y1: 0, x2: 84, y2: 0, gradientUnits: 'userSpaceOnUse' },
      ...stops([0, '#fffdf4'], [0.32, '#f8ecd0'], [0.66, '#e2cc9e'], [1, '#a98955'])),
    svg('linearGradient', { id: id + 'p-b', x1: 18, y1: 0, x2: 84, y2: 0, gradientUnits: 'userSpaceOnUse' },
      ...stops([0, '#8c776a'], [0.26, '#4a3a32'], [0.58, '#211814'], [1, '#090605'])),
    svg('linearGradient', { id: id + 'p-shade', x1: 0, y1: 8, x2: 0, y2: 94, gradientUnits: 'userSpaceOnUse' },
      ...stops([0, '#fff', 0.14], [0.45, '#fff', 0], [0.8, '#2a1400', 0.06], [1, '#2a1400', 0.22])),
    svg('linearGradient', { id: id + 'sheen', x1: 18, y1: 0, x2: 84, y2: 0, gradientUnits: 'userSpaceOnUse' },
      ...stops([0.12, '#fff', 0], [0.27, '#fff', 0.55], [0.36, '#fff', 0.1], [0.44, '#fff', 0])),
    svg('linearGradient', { id: id + 'sheen-b', x1: 18, y1: 0, x2: 84, y2: 0, gradientUnits: 'userSpaceOnUse' },
      ...stops([0.12, '#ffe8c0', 0], [0.26, '#ffe8c0', 0.5], [0.34, '#ffe8c0', 0.12], [0.44, '#ffe8c0', 0])),
    svg('linearGradient', { id: id + 'rim-b', x1: 0, y1: 8, x2: 0, y2: 94, gradientUnits: 'userSpaceOnUse' },
      ...stops([0, '#f6dc94'], [0.5, '#c4963e'], [1, '#7a5618'])),
    svg('radialGradient', { id: id + 'p-shadow' },
      ...stops([0, '#140600', 0.6], [0.6, '#140600', 0.3], [1, '#140600', 0])),
    svg('radialGradient', { id: id + 'check' },
      ...stops([0, '#ff6a48', 0.95], [0.5, '#e2523d', 0.6], [1, '#c42d1e', 0.05])),
    svg('radialGradient', { id: id + 'flash' },
      ...stops([0, '#fffbe6', 1], [0.35, '#f6d685', 0.85], [1, '#f0c75e', 0])),
  );
  // 12 种棋子：每种画成一组，<use> 引用
  for (const side of ['w', 'b']) {
    for (const [t, shape] of Object.entries(SHAPES)) {
      const white = side === 'w';
      const g = svg('g', { id: `${id}${side}${t}`, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      for (const d of shape.parts) {
        g.append(svg('path', { d, fill: url(`p-${side}`), stroke: white ? '#4a2e14' : url('rim-b'), 'stroke-width': white ? 1.7 : 1.5 }));
      }
      for (const i of SHEEN_PARTS[t]) g.append(svg('path', { d: shape.parts[i], fill: url(white ? 'sheen' : 'sheen-b') }));
      for (const i of SHEEN_PARTS[t]) g.append(svg('path', { d: shape.parts[i], fill: url('p-shade') }));
      for (const d of shape.lines) g.append(svg('path', { d, fill: 'none', stroke: white ? '#4a2e14' : '#d9b260', 'stroke-width': 1.4, 'stroke-opacity': white ? 0.8 : 0.75 }));
      for (const [cx, cy, rx, ry] of shape.dots || []) g.append(svg('ellipse', { cx, cy, rx, ry, fill: white ? '#3a220e' : '#f0cf80' }));
      defs.append(g);
    }
  }
  el.append(defs);

  // ---------- 外框 + 棋盘面（只画一次）----------
  const N = S * 8;
  el.append(
    svg('rect', { x: 0, y: T, width: W, height: W, rx: 18, fill: '#040100' }),
    svg('rect', { x: 1, y: T - 1, width: W - 2, height: W - 1, rx: 17, fill: '#3e2a0a' }),
    svg('rect', { x: 1, y: 2, width: W - 2, height: W - 2, rx: 17, fill: '#6a4a16' }),
    svg('rect', { x: 0, y: 0, width: W, height: W, rx: 18, fill: url('gold') }),
    svg('rect', { x: 2, y: 2, width: W - 4, height: W - 4, rx: 16, fill: url('lac') }),
    svg('rect', { x: 2, y: 2, width: W - 4, height: W - 4, rx: 16, fill: url('lac-sheen') }),
    svg('path', { d: `M 20 3.2 H ${W - 20}`, stroke: '#ffe4b8', 'stroke-opacity': 0.3, 'stroke-width': 1.2 }),
    svg('rect', { x: F - 7, y: F - 7, width: N + 14, height: N + 14, rx: 9, fill: 'none', stroke: url('gold'), 'stroke-width': 1.2, opacity: 0.85 }),
    svg('rect', { x: F - 2.5, y: F - 2.5, width: N + 5, height: N + 5, rx: 3, fill: 'none', stroke: url('gold'), 'stroke-width': 2.4 }),
    svg('rect', { x: F, y: F, width: N, height: N, fill: url('ivory') }),
  );
  const dark = svg('g', { fill: url('sandal') });
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    // 屏幕上的格子颜色与翻转无关（a1 为深格）
    if ((f + r) % 2 === 1) dark.append(svg('rect', { x: F + f * S, y: F + r * S, width: S, height: S }));
  }
  el.append(dark);
  // 檀木纹：只落在深格上
  const clip = svg('clipPath', { id: id + 'dark' });
  for (const r of dark.children) clip.append(svg('rect', { x: r.getAttribute('x'), y: r.getAttribute('y'), width: S, height: S }));
  defs.append(clip);
  const rand = rng(29);
  const grain = svg('g', { 'clip-path': url('dark'), fill: 'none' });
  for (let i = 0; i < 64; i++) {
    const y = F + (i + rand()) * (N / 64), a = 1.5 + rand() * 4;
    const k = rand();
    grain.append(svg('path', {
      d: `M ${F - 4} ${y} C ${F + N * 0.3} ${y - a}, ${F + N * 0.62} ${y + a}, ${F + N + 4} ${y + (rand() - 0.5) * 5}`,
      stroke: k < 0.8 ? '#3a1206' : '#e8a070', 'stroke-opacity': k < 0.8 ? 0.12 + rand() * 0.18 : 0.14, 'stroke-width': 0.5 + rand() * 1.6,
    }));
  }
  // 象牙格上极淡的纵向纹理
  const ivoryGrain = svg('g', { fill: 'none', stroke: '#b89660', 'stroke-opacity': 0.08 });
  for (let i = 0; i < 40; i++) {
    const x = F + (i + rand()) * (N / 40);
    ivoryGrain.append(svg('path', { d: `M ${x} ${F} C ${x + 3} ${F + N * 0.4}, ${x - 3} ${F + N * 0.7}, ${x + 1} ${F + N}`, 'stroke-width': 0.6 + rand() }));
  }
  el.append(ivoryGrain, grain,
    svg('rect', { x: F, y: F, width: N, height: N, fill: url('field-light') }),
    // 棋盘面凹在框里：上、左内阴影，下沿一道反光
    svg('rect', { x: F, y: F, width: N, height: 7, fill: url('in-top') }),
    svg('rect', { x: F, y: F, width: 6, height: N, fill: url('in-left') }),
    svg('path', { d: `M ${F} ${F + N - 0.5} H ${F + N}`, stroke: '#fff2cc', 'stroke-opacity': 0.35, 'stroke-width': 1 }),
  );

  const coords = svg('g');
  const below = svg('g', { 'pointer-events': 'none' });   // 上一步、选中、将军
  const ghosts = svg('g', { 'pointer-events': 'none' });  // 被吃的子、升变前的兵
  const pieces = svg('g');
  const overlay = svg('g');                               // 合法落点
  const arrows = svg('g', { 'pointer-events': 'none' });
  const fx = svg('g', { 'pointer-events': 'none' });      // 升变闪光
  const promoLayer = svg('g');
  el.append(coords, below, ghosts, pieces, overlay, arrows, fx, promoLayer);

  function drawCoords() {
    coords.replaceChildren();
    for (let i = 0; i < 8; i++) {
      coords.append(svg('text', { class: 'ch-coord', x: X(i), y: F + N + F / 2 + 1 }, FILES[i]));
      coords.append(svg('text', { class: 'ch-coord', x: F / 2, y: Y(i * 8) }, String(i + 1)));
    }
  }

  function pieceEl(p, s, x, y) {
    const side = sideOf(p);
    const g = svg('g', { class: `ch-pc ${side}`, 'data-sq': s });
    g.append(
      svg('ellipse', { class: 'ch-sh', cx: 2.5, cy: 26, rx: 21, ry: 6.5, fill: url('p-shadow') }),
      svg('g', { class: 'ch-bd' }, svg('use', { href: `#${id}${side}${p.toLowerCase()}`, transform: 'translate(-33 -34.6) scale(.66)' })),
    );
    g.style.transform = `translate(${x}px, ${y}px)`;
    return g;
  }

  function targets() {
    if (selected === null || !opts.movable) return [];
    const from = sqName(selected);
    const out = new Map();
    for (const mid of legalIds(view, opts.actions)) {
      if (!mid.startsWith(from)) continue;
      const to = parseSq(mid.slice(2, 4));
      if (!out.has(to)) out.set(to, []);
      out.get(to).push(mid);
    }
    return [...out].map(([to, ids]) => ({ to, ids }));
  }

  /** 认出上一步：普通走子、吃子、吃过路兵、易位、升变。认不出（跳步、回退）就不播动画 */
  function readMove(prev, b, last) {
    if (!prev || !last) return null;
    const diff = [];
    for (let i = 0; i < 64; i++) if (prev[i] !== b[i]) diff.push(i);
    const { from, to } = last;
    const p = prev[from];
    if (!p || b[from] || !b[to] || sideOf(b[to]) !== sideOf(p)) return null;
    const m = { from, to, piece: p, captured: prev[to] ? { p: prev[to], sq: to } : null, rook: null, promo: null };
    const type = p.toLowerCase();
    if (type === 'k' && Math.abs((to & 7) - (from & 7)) === 2) {
      const rank = from & ~7, kingSide = (to & 7) > (from & 7);
      m.rook = { from: rank + (kingSide ? 7 : 0), to: rank + (kingSide ? 5 : 3) };
    } else if (type === 'p' && (to & 7) !== (from & 7) && !prev[to]) {
      const cap = (from & ~7) | (to & 7);
      m.captured = { p: prev[cap], sq: cap };
    }
    if (type === 'p' && b[to] !== p) m.promo = b[to];
    const expect = new Set([from, to]);
    if (m.rook) { expect.add(m.rook.from); expect.add(m.rook.to); }
    if (m.captured) expect.add(m.captured.sq);
    if (diff.length !== expect.size || diff.some((i) => !expect.has(i))) return null;
    return m;
  }

  function buildPieces(prevBoard, last, animate) {
    const b = view.board;
    const mv = animate && !reduceMotion() ? readMove(prevBoard, b, last) : null;
    for (const a of el.getAnimations?.({ subtree: true }) || []) if (a.id === 'ch-move') a.cancel();
    ghosts.replaceChildren();
    fx.replaceChildren();
    pieces.replaceChildren();
    els.clear();
    const top = [];
    for (let s = 0; s < 64; s++) {
      if (!b[s]) continue;
      const g = pieceEl(b[s], s, X(s), Y(s));
      els.set(s, g);
      if (mv && (s === mv.to || s === mv.rook?.to)) top.push(g);
      else pieces.append(g);
    }
    pieces.append(...top);
    if (!mv) return false;

    const at = (x, y) => `translate(${x}px, ${y}px)`;
    const dist = Math.hypot(X(mv.to) - X(mv.from), Y(mv.to) - Y(mv.from)) / S;
    const dur = Math.round(300 + Math.min(dist, 7) * 18);
    const run = (node, frames, o = {}) => { const a = node.animate(frames, { duration: dur, ...o }); a.id = 'ch-move'; return a; };
    const slide = (node, from, to, o) => {
      const main = run(node, [
        { transform: at(X(from), Y(from)) },
        { transform: at(X(from), Y(from)), offset: 0.12, easing: 'cubic-bezier(.45,0,.2,1)' },
        { transform: at(X(to), Y(to)), offset: 0.82 },
        { transform: at(X(to), Y(to)) },
      ], o);
      const lift = 'translate(-1px, -5px) scale(1.06)';
      run(node.querySelector('.ch-bd'), [
        { transform: 'none' }, { transform: lift, offset: 0.14 }, { transform: lift, offset: 0.78 },
        { transform: 'translate(0, 1px) scale(.97)', offset: 0.9 }, { transform: 'none' },
      ], { easing: 'ease-out', ...o });
      run(node.querySelector('.ch-sh'), [
        { transform: 'none', opacity: 1 }, { transform: 'translate(5px, 3px) scale(1.18)', opacity: 0.45, offset: 0.14 },
        { transform: 'translate(5px, 3px) scale(1.18)', opacity: 0.45, offset: 0.78 }, { transform: 'none', opacity: 1 },
      ], { easing: 'ease-out', ...o });
      return main;
    };

    if (mv.promo) {
      // 兵先滑到底线，到位后变成新棋子，金光一闪
      const pawn = pieceEl(mv.piece, -1, X(mv.to), Y(mv.to));
      pawn.removeAttribute('data-sq');
      ghosts.append(pawn);
      slide(pawn, mv.from, mv.to, { fill: 'forwards' }).onfinish = () => pawn.remove();
      const nu = els.get(mv.to);
      run(nu, [{ opacity: 0 }, { opacity: 0, offset: 0.92 }, { opacity: 1 }], { duration: dur + 60 });
      run(nu.querySelector('.ch-bd'), [{ transform: 'scale(1.35)' }, { transform: 'scale(1.35)', offset: 0.6 }, { transform: 'scale(.96)', offset: 0.85 }, { transform: 'none' }], { duration: dur + 320, easing: 'ease-out' });
      const flash = svg('circle', { cx: X(mv.to), cy: Y(mv.to), r: S * 0.9, fill: url('flash') });
      flash.style.transformBox = 'fill-box';
      flash.style.transformOrigin = 'center';
      fx.append(flash);
      const fa = flash.animate([{ opacity: 0, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(.3)', offset: 0.45 }, { opacity: 1, transform: 'scale(.9)', offset: 0.6 }, { opacity: 0, transform: 'scale(1.5)' }],
        { duration: dur + 520, easing: 'ease-out', fill: 'forwards' });
      fa.id = 'ch-move';
      fa.onfinish = () => flash.remove();
    } else {
      slide(els.get(mv.to), mv.from, mv.to);
    }
    if (mv.rook) {
      // 易位：王车同时起落
      slide(els.get(mv.rook.to), mv.rook.from, mv.rook.to);
    }
    if (mv.captured?.p) {
      const sx = X(mv.captured.sq), sy = Y(mv.captured.sq);
      const ghost = pieceEl(mv.captured.p, -1, sx, sy);
      ghost.removeAttribute('data-sq');
      ghosts.prepend(ghost);
      const dx = X(mv.to) - X(mv.from), dy = Y(mv.to) - Y(mv.from), len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const a = ghost.animate([
        { transform: at(sx, sy), opacity: 1 },
        { transform: at(sx, sy), opacity: 1, offset: 0.55, easing: 'cubic-bezier(.2,.6,.3,1)' },
        { transform: `${at(sx + ux * 30, sy + uy * 30 - 12)} rotate(${ux >= 0 ? 24 : -24}deg) scale(.7)`, opacity: 0 },
      ], { duration: dur + 260, fill: 'forwards' });
      a.id = 'ch-move';
      a.onfinish = () => ghost.remove();
    }
    return true;
  }

  function sqRect(s, cls, extra = {}) {
    return svg('rect', { class: cls, x: X(s) - S / 2, y: Y(s) - S / 2, width: S, height: S, ...extra });
  }

  function drawMarks(last, fresh) {
    below.replaceChildren();
    const b = view.board;
    if (last) {
      const g = svg('g', { class: fresh ? 'ch-fresh' : null });
      g.append(sqRect(last.from, 'ch-last from'), sqRect(last.to, 'ch-last to'));
      g.append(svg('rect', { class: 'ch-last-edge', x: X(last.to) - S / 2 + 1.5, y: Y(last.to) - S / 2 + 1.5, width: S - 3, height: S - 3, rx: 2 }));
      below.append(g);
    }
    if (selected !== null) below.append(sqRect(selected, 'ch-sel'));
    const checkedKing = view.inCheck ? b.indexOf(view.side === 'w' ? 'K' : 'k') : -1;
    if (checkedKing >= 0) {
      below.append(svg('circle', { class: 'ch-check', cx: X(checkedKing), cy: Y(checkedKing), r: S * 0.62, fill: url('check') }));
    }
  }

  function drawTargets() {
    overlay.replaceChildren();
    for (const t of targets()) {
      const cx = X(t.to), cy = Y(t.to);
      const cap = view.board[t.to] || t.ids.some((m) => m.slice(2, 4) === view.ep);
      overlay.append(cap ? svg('circle', { class: 'ch-cap', cx, cy, r: S / 2 - 4 }) : svg('circle', { class: 'ch-dot', cx, cy, r: 9 }));
      overlay.append(svg('rect', { class: 'ch-hit', x: cx - S / 2, y: cy - S / 2, width: S, height: S, 'data-to': t.to }));
    }
  }

  function drawArrows() {
    arrows.replaceChildren();
    for (const a of opts.arrows || []) {
      const mid = a.iccs || a.uci;
      if (!/^[a-h][1-8][a-h][1-8]/.test(mid || '')) continue;
      const f = parseSq(mid.slice(0, 2)), t = parseSq(mid.slice(2, 4));
      arrows.append(svg('path', { class: `ch-arrow${a.kind === 'best' ? '' : ' hint'}`, d: arrowPath(X(f), Y(f), X(t), Y(t), { w: 11, hw: 28, hl: 24, start: 16, end: 8 }) }));
    }
  }

  /** 升变选择：在目标格所在列朝棋盘中间排开后、车、象、马，每个是一块描金漆牌 */
  function drawPromo() {
    promoLayer.replaceChildren();
    if (!promo || !opts.movable) return;
    promoLayer.append(svg('rect', { class: 'ch-promo-bg', 'data-promo-cancel': 1, x: 0, y: 0, width: W, height: H, rx: 18 }));
    const side = opts.movable;
    const down = Y(promo.to) < W / 2; // 目标格在屏幕上半部分，选项往下排
    PROMOS.forEach((p, i) => {
      const cx = X(promo.to), cy = Y(promo.to) + (down ? i : -i) * S;
      const letter = side === 'w' ? p.toUpperCase() : p;
      const pc = pieceEl(letter, -1, cx, cy);
      pc.removeAttribute('data-sq');
      promoLayer.append(svg('g', { class: 'ch-promo-opt', 'data-promo': p },
        svg('rect', { class: 'tile', x: cx - S / 2 + 2, y: cy - S / 2 + 2, width: S - 4, height: S - 4, rx: 8, fill: url(side === 'w' ? 'lac' : 'ivory'), stroke: url('gold') }),
        pc));
    });
  }

  function draw(animate) {
    const b = view.board;
    const lastId = view.lastMove || view.moves?.[view.moves.length - 1]?.uci || null;
    const last = lastId ? { from: parseSq(lastId.slice(0, 2)), to: parseSq(lastId.slice(2, 4)) } : null;
    const s = b.join(',') + (flipped ? '|f' : '');
    let moved = false;
    if (s !== sig) {
      moved = buildPieces(sig === null ? null : prevBoard, last, animate);
      sig = s;
    }
    for (const [sqi, g] of els) {
      g.classList.toggle('sel', sqi === selected);
      g.classList.toggle('mine', !!opts.movable && sideOf(b[sqi]) === opts.movable);
    }
    drawMarks(last, moved);
    drawTargets();
    drawArrows();
    drawPromo();
  }

  let prevBoard = null;

  el.addEventListener('click', (e) => {
    const movable = opts.movable;
    if (!movable) return;
    if (promo) {
      const opt = e.target.closest('[data-promo]');
      const pr = promo;
      promo = null;
      selected = null;
      if (opt) onAction(`${sqName(pr.from)}${sqName(pr.to)}${opt.getAttribute('data-promo')}`);
      draw(false);
      return;
    }
    const hit = e.target.closest('[data-to]');
    if (hit && selected !== null) {
      const to = Number(hit.getAttribute('data-to'));
      const t = targets().find((x) => x.to === to);
      if (t && t.ids.length > 1) { promo = { from: selected, to }; draw(false); return; }
      selected = null;
      if (t) onAction(t.ids[0]);
      draw(false);
      return;
    }
    const pc = e.target.closest('.ch-pc[data-sq]');
    if (pc) {
      const s = Number(pc.getAttribute('data-sq'));
      if (sideOf(view.board[s]) === movable) {
        selected = selected === s ? null : s;
        draw(false);
        return;
      }
    }
    if (selected !== null) { selected = null; draw(false); }
  });

  drawCoords();
  return {
    el,
    setFlipped(v) {
      if (flipped === !!v) return;
      flipped = !!v;
      sig = null;
      drawCoords();
      draw(false);
    },
    render(v, { movable = null, actions = null, arrows: ar = [], animate = true } = {}) {
      prevBoard = view.board;
      const changed = (v.fen || '') !== (view.fen || '');
      view = { ...v, ep: (v.fen || '').split(' ')[3] };
      opts = { movable, actions, arrows: ar };
      if (!movable || changed) { selected = null; promo = null; }
      if (selected !== null && sideOf(view.board[selected]) !== movable) selected = null;
      el.classList.toggle('can-move', !!movable);
      draw(animate && changed);
    },
  };
}

export default {
  aspect: [W, H],
  seatColor: (seat) => (seat === 'w' ? '#8a857a' : 'var(--black-side)'),
  /** 玩家执黑时棋盘翻转，让自己在下方 */
  flipFor: (seat) => seat === 'b',
  createStage,
  moveList: (view) => (view.moves || []).map((m) => ({ seat: m.side, label: m.san })),
};
