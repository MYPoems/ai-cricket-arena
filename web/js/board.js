// SVG 象棋棋盘：朱漆托盘 + 榧木棋盘 + 有厚度的木棋。直接复用服务端的同一份规则代码来提示合法落点。
//
// 材质按设计系统「一盏灯在左上方」来画：
// · 托盘是镶金边的朱漆板，下沿露出铜色侧壁；坐标印在托盘上。
// · 棋盘是一块倒了角的榧木板：上、左两条倒角受光，右、下两条压暗，底边露出木板厚度；格线是刻线（暗线 + 右下一道亮线）。
// · 棋子是木饼：侧壁、受光顶面、刻槽圈和刻字（字是凹的，右下沿受光）。
// 所有渐变、棋子外形都放在每个棋盘自己的 <defs> 里（id 带实例前缀，同页多个棋盘互不干扰），棋子本身只是 <use> + 两行字，不用滤镜。
//
// 动效：落子「抬起 → 平移 → 下压回弹」约 0.35 秒（Web Animations）；吃子时被吃的子淡出飞走；
// 上一步起点留朱砂点、落点金圈；被将军的帅/将红光呼吸。棋盘内容不变的重复 render 不重建棋子，动画不会被打断。

import { legalTargets, fileOf, rankOf, sq, iccsToMove, sideOf } from '/games/xiangqi/rules.js';

const NS = 'http://www.w3.org/2000/svg';
const S = 60;          // 格距
const P = 38;          // 木板边到外圈格线
const F = 24;          // 漆托盘宽度（坐标印在这里）
const T = 6;           // 托盘侧壁厚度
const R = 27;          // 棋子半径
const BW = P * 2 + S * 8;   // 木板宽 556
const BH = P * 2 + S * 9;   // 木板高 616
const W = BW + F * 2;       // 604
const FH = BH + F * 2;      // 托盘面高 664
const H = FH + T;           // 670
const GX = F + P, GY = F + P; // 格线原点
const CHARS = { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵', k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒' };

export const XQ_SIZE = [W, H];

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
};
const stops = (...list) => list.map(([o, c, a = 1]) => svg('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }));

/** 可复现的伪随机数，木纹每次画出来一样 */
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

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const STYLE = `
svg.board.xq { overflow: visible; }
/* 大厅缩略图：格子行高不随棋盘的固有高度撑开，棋盘按比例缩进卡片 */
.mthumb > .board-wrap > svg.board.xq { position: absolute; inset: 0; }
svg.board.xq .xq-coord { font: 600 15px/1 var(--num); fill: #e8c674; letter-spacing: .02em; }
svg.board.xq .xq-river { font-family: var(--brush); font-size: 40px; letter-spacing: 18px; }
svg.board.xq .xq-pc { cursor: default; }
svg.board.xq.can-move .xq-pc.mine { cursor: pointer; }
svg.board.xq .xq-pc text { font: 900 31px/1 var(--serif); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
svg.board.xq .xq-pc.r .xq-t { fill: #b3261a; }
svg.board.xq .xq-pc.b .xq-t { fill: #1f140f; }
svg.board.xq .xq-pc .xq-tl { fill: #fff6dc; opacity: .85; }
svg.board.xq .xq-bd, svg.board.xq .xq-sh { transition: transform .18s var(--ease), opacity .18s; }
svg.board.xq .xq-pc.sel .xq-bd { transform: translate(-1px, -6px) scale(1.06); }
svg.board.xq .xq-pc.sel .xq-sh { transform: translate(5px, 8px) scale(1.1); opacity: .55; }
svg.board.xq .xq-from { fill: var(--zhu); }
svg.board.xq .xq-to { fill: none; stroke-width: 3.2; }
svg.board.xq .xq-to-glow { fill: none; stroke: #ffd977; stroke-width: 9; opacity: .32; }
svg.board.xq .xq-fresh { animation: xq-in .28s .3s both; }
svg.board.xq .xq-sel-ring { fill: none; stroke: #f0cd78; stroke-width: 2.4; opacity: .9; }
svg.board.xq .xq-check { animation: xq-breathe 1.5s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
svg.board.xq .xq-check-ring { fill: none; stroke: var(--zhu-2); stroke-width: 2.6; animation: xq-breathe 1.5s ease-in-out infinite; }
svg.board.xq .xq-dot { fill: rgb(52 24 6 / .5); pointer-events: none; }
svg.board.xq .xq-cap { fill: none; stroke: rgb(52 24 6 / .55); stroke-width: 4; pointer-events: none; }
svg.board.xq .xq-hit { fill: transparent; cursor: pointer; }
svg.board.xq .xq-hit:hover { fill: rgb(240 205 120 / .22); }
svg.board.xq .xq-arrow { fill: #2f7a68; fill-opacity: .82; stroke: #123a30; stroke-width: 1.2; stroke-opacity: .6; }
svg.board.xq .xq-arrow.hint { fill: #3a2214; fill-opacity: .5; stroke: none; }
@keyframes xq-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes xq-breathe { 0%, 100% { opacity: .5; transform: scale(.94); } 50% { opacity: 1; transform: scale(1.04); } }
`;
let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
}

let seq = 0;

/** 箭头多边形：杆宽 w，箭头宽 hw、长 hl；起点让开棋子中心一点 */
export function arrowPath(x1, y1, x2, y2, { w = 10, hw = 26, hl = 22, start = 14, end = 6 } = {}) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const sx = x1 + ux * start, sy = y1 + uy * start;
  const ex = x2 - ux * end, ey = y2 - uy * end;
  const bx = ex - ux * hl, by = ey - uy * hl;
  const p = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  return `M ${p(sx + nx * w / 2, sy + ny * w / 2)} L ${p(bx + nx * w / 2, by + ny * w / 2)} L ${p(bx + nx * hw / 2, by + ny * hw / 2)} L ${p(ex, ey)} `
    + `L ${p(bx - nx * hw / 2, by - ny * hw / 2)} L ${p(bx - nx * w / 2, by - ny * w / 2)} L ${p(sx - nx * w / 2, sy - ny * w / 2)} Z`;
}

export class Board {
  constructor({ onMove = null } = {}) {
    injectStyle();
    this.onMove = onMove;
    this.flipped = false;
    this.state = { board: new Array(90).fill(null), side: 'r' };
    this.selected = null;
    this.sig = null;
    this.els = new Map(); // 格 → 棋子元素
    this.id = `xq${++seq}-`;
    this.el = svg('svg', { class: 'board xq', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '象棋棋盘' });
    this.#drawStatic();
    this.below = svg('g');                 // 朱砂点、将军红光
    this.ghosts = svg('g', { 'pointer-events': 'none' }); // 被吃的子
    this.pieces = svg('g');
    this.above = svg('g', { 'pointer-events': 'none' }); // 落点金圈、选中圈
    this.overlay = svg('g');               // 合法落点
    this.arrows = svg('g', { 'pointer-events': 'none' });
    this.el.append(this.below, this.ghosts, this.pieces, this.above, this.overlay, this.arrows);
    this.el.addEventListener('click', (e) => this.#click(e));
  }

  url(name) { return `url(#${this.id}${name})`; }
  x(f) { return GX + (this.flipped ? 8 - f : f) * S; }
  y(r) { return GY + (this.flipped ? r : 9 - r) * S; }

  #defs() {
    const id = (n) => this.id + n;
    const defs = svg('defs');
    defs.append(
      // 托盘：朱漆，上亮下暗
      svg('linearGradient', { id: id('lac'), x1: 0, y1: 0, x2: 0, y2: 1 },
        ...stops([0, '#6a1f13'], [0.3, '#4a140c'], [0.72, '#300c07'], [1, '#210806'])),
      svg('radialGradient', { id: id('lac-sheen'), cx: 0.16, cy: 0, r: 0.75, gradientTransform: 'scale(1 .7)' },
        ...stops([0, '#ffe2bc', 0.26], [0.5, '#ffd6aa', 0.06], [1, '#ffd6aa', 0])),
      // 描金：上亮下暗再回亮
      svg('linearGradient', { id: id('gold'), x1: 0, y1: 0, x2: 1, y2: 1 },
        ...stops([0, '#fff3c8'], [0.08, '#ecc668'], [0.22, '#b08030'], [0.42, '#5e400f'], [0.56, '#7c5a1c'], [0.78, '#c79c44'], [0.9, '#efd28a'], [1, '#8e6824'])),
      svg('linearGradient', { id: id('gold-v'), x1: 0, y1: 0, x2: 0, y2: 1 },
        ...stops([0, '#fff7d2'], [0.3, '#f1cf7c'], [0.5, '#c8943a'], [0.56, '#b78430'], [0.8, '#e2b85e'], [1, '#f6dc96'])),
      // 榧木：金黄，左上受光
      svg('linearGradient', { id: id('wood'), x1: 0, y1: 0, x2: 1, y2: 1 },
        ...stops([0, '#f0cb8c'], [0.45, '#e0b06a'], [1, '#c48a48'])),
      svg('radialGradient', { id: id('wood-light'), cx: 0.2, cy: 0.08, r: 0.9 },
        ...stops([0, '#fff6dc', 0.42], [0.45, '#fff0cc', 0.08], [1, '#5a2e0c', 0.16])),
      svg('clipPath', { id: id('wood-clip') }, svg('rect', { x: F, y: F, width: BW, height: BH, rx: 5 })),
      // 棋子：侧壁、顶面、边沿高光
      svg('linearGradient', { id: id('p-side'), x1: 0, y1: 0, x2: 0, y2: 1 },
        ...stops([0, '#b07b3c'], [1, '#6a3f17'])),
      svg('radialGradient', { id: id('p-top'), cx: 0.36, cy: 0.3, r: 0.78 },
        ...stops([0, '#fff1cf'], [0.55, '#efd29c'], [0.88, '#d8ae6a'], [1, '#c39352'])),
      svg('linearGradient', { id: id('p-rim'), x1: 0.15, y1: 0.05, x2: 0.85, y2: 0.95 },
        ...stops([0, '#fffbe8', 0.95], [0.42, '#fff4d8', 0.1], [0.6, '#5a3010', 0.08], [1, '#4a2408', 0.6])),
      svg('radialGradient', { id: id('p-shadow') },
        ...stops([0, '#1e0a00', 0.55], [0.62, '#1e0a00', 0.32], [1, '#1e0a00', 0])),
      svg('clipPath', { id: id('p-clip') }, svg('circle', { r: R })),
      svg('linearGradient', { id: id('ring'), x1: 0, y1: 0, x2: 0, y2: 1 },
        ...stops([0, '#fff6d0'], [0.45, '#f6d27a'], [1, '#d9a443'])),
      // 将军红光
      svg('radialGradient', { id: id('check') },
        ...stops([0, '#ff5a3c', 0.85], [0.55, '#e2523d', 0.5], [1, '#c42d1e', 0])),
    );
    // 两种棋子坯：红字的刻槽圈是朱色，黑字的是墨色
    for (const side of ['r', 'b']) {
      const ink = side === 'r' ? '#a8291c' : '#2a1a12';
      defs.append(svg('g', { id: id(`disc-${side}`) },
        svg('circle', { cy: 4.5, r: R, fill: this.url('p-side') }),
        svg('circle', { cy: 4.5, r: R, fill: 'none', stroke: '#3c1f08', 'stroke-opacity': 0.55, 'stroke-width': 1 }),
        svg('circle', { r: R, fill: this.url('p-top') }),
        svg('g', { 'clip-path': this.url('p-clip'), fill: 'none', stroke: '#9a6428', 'stroke-opacity': 0.13, 'stroke-width': 1.1 },
          svg('path', { d: `M -30 -12 C -12 -16, 8 -8, 30 -14 M -30 -2 C -10 -6, 12 2, 30 -4 M -30 9 C -12 5, 10 13, 30 7 M -30 19 C -8 15, 12 22, 30 17` })),
        svg('circle', { r: R - 0.7, fill: 'none', stroke: this.url('p-rim'), 'stroke-width': 1.5 }),
        svg('circle', { cx: 0.7, cy: 0.9, r: 21.5, fill: 'none', stroke: '#fff4d6', 'stroke-opacity': 0.75, 'stroke-width': 1 }),
        svg('circle', { r: 21.5, fill: 'none', stroke: ink, 'stroke-width': 1.5 }),
      ));
    }
    return defs;
  }

  #drawStatic() {
    this.el.append(this.#defs());
    const u = (n) => this.url(n);
    // 托盘侧壁（铜色两层）+ 托盘面
    this.el.append(
      svg('rect', { x: 0, y: T, width: W, height: FH, rx: 18, fill: '#040100' }),
      svg('rect', { x: 1, y: T - 1, width: W - 2, height: FH - 1, rx: 17, fill: '#3e2a0a' }),
      svg('rect', { x: 1, y: 2, width: W - 2, height: FH - 2, rx: 17, fill: '#6a4a16' }),
      svg('rect', { x: 0, y: 0, width: W, height: FH, rx: 18, fill: u('gold') }),
      svg('rect', { x: 2, y: 2, width: W - 4, height: FH - 4, rx: 16, fill: u('lac') }),
      svg('rect', { x: 2, y: 2, width: W - 4, height: FH - 4, rx: 16, fill: u('lac-sheen') }),
      // 顶边一道亮线
      svg('path', { d: `M 20 3.2 H ${W - 20}`, stroke: '#ffe4b8', 'stroke-opacity': 0.32, 'stroke-width': 1.2 }),
      // 托盘内圈描金细线（同心圆角）
      svg('rect', { x: F - 8, y: F - 8, width: BW + 16, height: BH + 16, rx: 10, fill: 'none', stroke: u('gold'), 'stroke-width': 1.2, opacity: 0.85 }),
    );
    // 棋盘投在托盘上的影子（几层半透明矩形，不用滤镜）
    for (const [d, a] of [[5, 0.18], [3.5, 0.22], [2, 0.3]]) {
      this.el.append(svg('rect', { x: F + d * 0.4, y: F + d, width: BW, height: BH, rx: 6, fill: '#0a0200', opacity: a }));
    }
    // 木板厚度：底边露出的深色木侧
    this.el.append(svg('rect', { x: F, y: F + 4, width: BW, height: BH, rx: 5, fill: '#6a3c14' }), svg('rect', { x: F, y: F + 2, width: BW, height: BH, rx: 5, fill: '#9a6428' }));
    // 木板面 + 木纹
    const wood = svg('g', { 'clip-path': u('wood-clip') });
    wood.append(svg('rect', { x: F, y: F, width: BW, height: BH, fill: u('wood') }));
    const rand = rng(17);
    const grain = svg('g', { fill: 'none' });
    // 宽的明暗带（木材的花纹）+ 细的年轮线，大体横向走、略带起伏
    for (let i = 0; i < 14; i++) {
      const y = F + (i + rand()) * (BH / 14);
      const a = 4 + rand() * 10;
      grain.append(svg('path', {
        d: `M ${F - 10} ${y} C ${F + BW * 0.25} ${y - a}, ${F + BW * 0.55} ${y + a}, ${F + BW + 10} ${y - a * 0.4}`,
        stroke: rand() < 0.5 ? '#fff3d0' : '#9a5a20', 'stroke-opacity': 0.07 + rand() * 0.07, 'stroke-width': 8 + rand() * 18,
      }));
    }
    for (let i = 0; i < 70; i++) {
      const y = F + (i + rand() * 0.9) * (BH / 70);
      const a = 1.5 + rand() * 5, ph = rand() * 0.3;
      const k = rand();
      grain.append(svg('path', {
        d: `M ${F - 10} ${y} C ${F + BW * (0.2 + ph)} ${y - a}, ${F + BW * (0.5 + ph)} ${y + a * 1.2}, ${F + BW + 10} ${y + (rand() - 0.5) * 6}`,
        stroke: k < 0.82 ? '#7a3e10' : '#fff6dc', 'stroke-opacity': k < 0.82 ? 0.1 + rand() * 0.18 : 0.22, 'stroke-width': 0.5 + rand() * 1.8,
      }));
    }
    wood.append(grain, svg('rect', { x: F, y: F, width: BW, height: BH, fill: u('wood-light') }));
    // 倒角：上、左受光，右、下压暗
    const c = 5, x0 = F, y0 = F, x1 = F + BW, y1 = F + BH;
    wood.append(
      svg('polygon', { points: `${x0},${y0} ${x1},${y0} ${x1 - c},${y0 + c} ${x0 + c},${y0 + c}`, fill: '#fff8e2', opacity: 0.55 }),
      svg('polygon', { points: `${x0},${y0} ${x0 + c},${y0 + c} ${x0 + c},${y1 - c} ${x0},${y1}`, fill: '#fff4d6', opacity: 0.3 }),
      svg('polygon', { points: `${x1},${y0} ${x1},${y1} ${x1 - c},${y1 - c} ${x1 - c},${y0 + c}`, fill: '#5a2e0c', opacity: 0.22 }),
      svg('polygon', { points: `${x0},${y1} ${x1},${y1} ${x1 - c},${y1 - c} ${x0 + c},${y1 - c}`, fill: '#4a2206', opacity: 0.38 }),
    );
    this.el.append(wood, svg('rect', { x: F + 0.5, y: F + 0.5, width: BW - 1, height: BH - 1, rx: 5, fill: 'none', stroke: '#3a1a06', 'stroke-opacity': 0.55 }));

    // 格线：一条路径画两遍——先画右下偏一点的亮线，再画暗线，像刻进木头里
    const gx = (f) => GX + f * S, gy = (r) => GY + r * S;
    let d = '';
    for (let r = 0; r < 10; r++) d += `M ${gx(0)} ${gy(r)} H ${gx(8)} `;
    for (let f = 1; f < 8; f++) d += `M ${gx(f)} ${gy(0)} V ${gy(4)} M ${gx(f)} ${gy(5)} V ${gy(9)} `;
    for (const top of [0, 7]) d += `M ${gx(3)} ${gy(top)} L ${gx(5)} ${gy(top + 2)} M ${gx(5)} ${gy(top)} L ${gx(3)} ${gy(top + 2)} `;
    const marks = [[1, 2], [7, 2], [1, 7], [7, 7], ...[0, 2, 4, 6, 8].flatMap((f) => [[f, 3], [f, 6]])];
    for (const [f, row] of marks) {
      const cx = gx(f), cy = gy(row), e = 5, l = 10;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if ((f === 0 && sx < 0) || (f === 8 && sx > 0)) continue;
        d += `M ${cx + sx * e} ${cy + sy * (e + l)} V ${cy + sy * e} H ${cx + sx * (e + l)} `;
      }
    }
    const frame = `M ${gx(0)} ${gy(0)} H ${gx(8)} V ${gy(9)} H ${gx(0)} Z`;
    const outer = `M ${gx(0) - 7} ${gy(0) - 7} H ${gx(8) + 7} V ${gy(9) + 7} H ${gx(0) - 7} Z`;
    const carve = (path, width) => [
      svg('path', { d: path, fill: 'none', stroke: '#fff3d2', 'stroke-opacity': 0.6, 'stroke-width': width, transform: 'translate(.9 1)' }),
      svg('path', { d: path, fill: 'none', stroke: '#5a2a0a', 'stroke-opacity': 0.88, 'stroke-width': width }),
    ];
    this.el.append(svg('g', { 'stroke-linecap': 'square' }, ...carve(d, 1.3), ...carve(frame, 2.2), ...carve(outer, 3)));

    // 楚河汉界：书法，刻字
    const ry = GY + 4.5 * S;
    for (const [f, text] of [[2, '楚 河'], [6, '漢 界']]) {
      const at = { class: 'xq-river', x: gx(f) + 9, y: ry, 'text-anchor': 'middle', 'dominant-baseline': 'central' };
      this.el.append(
        svg('text', { ...at, fill: '#fff3d2', 'fill-opacity': 0.55, transform: 'translate(1 1.2)' }, text),
        svg('text', { ...at, fill: '#5a2a0a', 'fill-opacity': 0.82 }, text),
      );
    }
    this.coords = svg('g');
    this.el.append(this.coords);
    this.#drawCoords();
  }

  #drawCoords() {
    this.coords.replaceChildren();
    for (let f = 0; f < 9; f++) {
      this.coords.append(svg('text', { class: 'xq-coord', x: this.x(f), y: F + BH + F / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, String.fromCharCode(97 + f)));
    }
    for (let r = 0; r < 10; r++) {
      this.coords.append(svg('text', { class: 'xq-coord', x: F / 2, y: this.y(r), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, String(r)));
    }
  }

  setFlipped(v) {
    if (this.flipped === !!v) return;
    this.flipped = !!v;
    this.sig = null;
    this.#drawCoords();
    this.render(this.state, { animate: false });
  }

  /**
   * state: { board, side, lastMove, inCheck, movable: 'r'|'b'|null, arrows: [{ iccs, kind }] }
   */
  render(state, { animate = true } = {}) {
    const prev = this.state;
    this.state = state;
    if (this.selected !== null && (!state.movable || state.board[this.selected] !== prev.board?.[this.selected])) this.selected = null;
    this.el.classList.toggle('can-move', !!state.movable);
    const last = state.lastMove ? iccsToMove(state.lastMove) : null;
    const sig = state.board.join(',') + (this.flipped ? '|f' : '');
    let moved = false;
    if (sig !== this.sig) {
      moved = this.#buildPieces(this.sig === null ? null : prev.board, last, animate);
      this.sig = sig;
    }
    // 选中、可走、被将军只改 class，不重建
    const kingInCheck = state.inCheck ? state.board.findIndex((p) => p === (state.side === 'r' ? 'K' : 'k')) : -1;
    for (const [s, g] of this.els) {
      g.classList.toggle('sel', s === this.selected);
      g.classList.toggle('mine', !!state.movable && sideOf(state.board[s]) === state.movable);
    }
    this.#drawMarks(last, kingInCheck, moved);
    this.#drawTargets();
    this.#drawArrows();
  }

  #piece(p, s) {
    const g = svg('g', { class: `xq-pc ${sideOf(p)}`, 'data-sq': s });
    const ch = CHARS[p];
    g.append(
      svg('ellipse', { class: 'xq-sh', cx: 2.5, cy: 6, rx: R + 1, ry: R, fill: this.url('p-shadow') }),
      svg('g', { class: 'xq-bd' },
        svg('use', { href: `#${this.id}disc-${sideOf(p)}` }),
        svg('text', { class: 'xq-tl', x: 0.8, y: 1.9 }, ch),
        svg('text', { class: 'xq-t', y: 1 }, ch)),
    );
    g.style.transform = `translate(${this.x(fileOf(s))}px, ${this.y(rankOf(s))}px)`;
    return g;
  }

  /** 重建棋子；能认出「上一步」时做落子动画。返回是否在播动画 */
  #buildPieces(prevBoard, last, animate) {
    const board = this.state.board;
    let mover = null, captured = null;
    if (animate && last && prevBoard && !reduceMotion()) {
      const diff = [];
      for (let i = 0; i < 90; i++) if (prevBoard[i] !== board[i]) diff.push(i);
      if (diff.length === 2 && diff.includes(last.from) && diff.includes(last.to) && prevBoard[last.from] === board[last.to] && !board[last.from]) {
        mover = last;
        captured = prevBoard[last.to] || null;
      }
    }
    for (const a of this.el.getAnimations?.({ subtree: true }) || []) if (a.id === 'xq-move') a.cancel();
    this.ghosts.replaceChildren();
    this.pieces.replaceChildren();
    this.els.clear();
    let moverEl = null;
    for (let s = 0; s < 90; s++) {
      const p = board[s];
      if (!p) continue;
      const g = this.#piece(p, s);
      this.els.set(s, g);
      if (mover && s === mover.to) moverEl = g;
      else this.pieces.append(g);
    }
    if (!mover) return false;
    this.pieces.append(moverEl); // 走动的子画在最上面

    const fx = this.x(fileOf(mover.from)), fy = this.y(rankOf(mover.from));
    const tx = this.x(fileOf(mover.to)), ty = this.y(rankOf(mover.to));
    const dist = Math.hypot(tx - fx, ty - fy) / S;
    const dur = Math.round(330 + Math.min(dist, 9) * 12);
    const at = (x, y) => `translate(${x}px, ${y}px)`;
    const run = (el, frames, opts) => { const a = el.animate(frames, { duration: dur, ...opts }); a.id = 'xq-move'; return a; };
    run(moverEl, [
      { transform: at(fx, fy) },
      { transform: at(fx, fy), offset: 0.2, easing: 'cubic-bezier(.45,0,.2,1)' },
      { transform: at(tx, ty), offset: 0.74 },
      { transform: at(tx, ty) },
    ]);
    const lift = 'translate(-1px, -7px) scale(1.07)';
    run(moverEl.querySelector('.xq-bd'), [
      { transform: 'none' },
      { transform: lift, offset: 0.2 },
      { transform: lift, offset: 0.72 },
      { transform: 'translate(0, 1.5px) scale(.965)', offset: 0.86 },
      { transform: 'none' },
    ], { easing: 'ease-out' });
    run(moverEl.querySelector('.xq-sh'), [
      { transform: 'none', opacity: 1 },
      { transform: 'translate(6px, 9px) scale(1.12)', opacity: 0.5, offset: 0.2 },
      { transform: 'translate(6px, 9px) scale(1.12)', opacity: 0.5, offset: 0.72 },
      { transform: 'scale(.94)', opacity: 1, offset: 0.86 },
      { transform: 'none', opacity: 1 },
    ], { easing: 'ease-out' });

    if (captured) {
      // 被吃的子：等走子落下时被撞开，顺着来势飞出、淡出
      const ghost = this.#piece(captured, mover.to);
      ghost.removeAttribute('data-sq');
      this.ghosts.append(ghost);
      const ux = (tx - fx) / (dist * S || 1), uy = (ty - fy) / (dist * S || 1);
      const a = ghost.animate([
        { transform: at(tx, ty), opacity: 1 },
        { transform: at(tx, ty), opacity: 1, offset: 0.5, easing: 'cubic-bezier(.2,.6,.3,1)' },
        { transform: `${at(tx + ux * 34, ty + uy * 34 - 14)} rotate(${ux >= 0 ? 28 : -28}deg) scale(.72)`, opacity: 0 },
      ], { duration: dur + 260, fill: 'forwards' });
      a.id = 'xq-move';
      a.onfinish = () => ghost.remove();
    }
    return true;
  }

  #drawMarks(last, kingInCheck, fresh) {
    this.below.replaceChildren();
    this.above.replaceChildren();
    const cls = fresh ? ' xq-fresh' : '';
    if (last) {
      const fx = this.x(fileOf(last.from)), fy = this.y(rankOf(last.from));
      this.below.append(svg('g', { class: cls.trim() || null },
        svg('circle', { class: 'xq-from', cx: fx, cy: fy, r: 6.5 }),
        svg('circle', { cx: fx - 1.8, cy: fy - 2, r: 2, fill: '#fff', opacity: 0.45 })));
      if (this.state.board[last.to]) {
        const tx = this.x(fileOf(last.to)), ty = this.y(rankOf(last.to));
        this.above.append(svg('g', { class: cls.trim() || null },
          svg('circle', { class: 'xq-to-glow', cx: tx, cy: ty, r: R + 4.5 }),
          svg('circle', { class: 'xq-to', cx: tx, cy: ty, r: R + 4.5, stroke: this.url('ring') })));
      }
    }
    if (kingInCheck >= 0) {
      const cx = this.x(fileOf(kingInCheck)), cy = this.y(rankOf(kingInCheck));
      this.below.append(svg('circle', { class: 'xq-check', cx, cy, r: R + 16, fill: this.url('check') }));
      this.above.append(svg('circle', { class: 'xq-check-ring', cx, cy, r: R + 4 }));
    }
    if (this.selected !== null) {
      this.above.append(svg('circle', { class: 'xq-sel-ring', cx: this.x(fileOf(this.selected)), cy: this.y(rankOf(this.selected)) - 3, r: R + 5 }));
    }
  }

  #drawTargets() {
    this.overlay.replaceChildren();
    if (this.selected === null || !this.state.movable) return;
    const pos = { board: this.state.board, side: this.state.movable, halfmove: 0, fullmove: 1 };
    for (const t of legalTargets(pos, this.selected)) {
      const cx = this.x(fileOf(t)), cy = this.y(rankOf(t));
      if (this.state.board[t]) this.overlay.append(svg('circle', { class: 'xq-cap', cx, cy, r: R + 3 }));
      else this.overlay.append(svg('circle', { class: 'xq-dot', cx, cy, r: 9 }));
      this.overlay.append(svg('circle', { class: 'xq-hit', cx, cy, r: R + 2, 'data-to': t }));
    }
  }

  #drawArrows() {
    this.arrows.replaceChildren();
    for (const a of this.state.arrows || []) {
      const m = iccsToMove(a.iccs);
      if (!m) continue;
      const d = arrowPath(this.x(fileOf(m.from)), this.y(rankOf(m.from)), this.x(fileOf(m.to)), this.y(rankOf(m.to)));
      this.arrows.append(svg('path', { class: `xq-arrow${a.kind === 'best' ? '' : ' hint'}`, d }));
    }
  }

  #click(e) {
    const movable = this.state.movable;
    if (!movable || !this.onMove) return;
    const t = e.target.closest('[data-to]');
    if (t && this.selected !== null) {
      const to = Number(t.getAttribute('data-to'));
      const from = this.selected;
      this.selected = null;
      const iccs = `${String.fromCharCode(97 + fileOf(from))}${rankOf(from)}${String.fromCharCode(97 + fileOf(to))}${rankOf(to)}`;
      this.onMove(iccs);
      this.render(this.state, { animate: false });
      return;
    }
    const pc = e.target.closest('.xq-pc[data-sq]');
    if (pc) {
      const s = Number(pc.getAttribute('data-sq'));
      if (sideOf(this.state.board[s]) === movable) {
        this.selected = this.selected === s ? null : s;
        this.render(this.state, { animate: false });
        return;
      }
    }
    if (this.selected !== null) {
      this.selected = null;
      this.render(this.state, { animate: false });
    }
  }
}

export { sq };
