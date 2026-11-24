// 黑白棋画面：朱漆木框 + 绿呢盘面，双面立体棋子（侧边露出另一面的颜色）。
// 顶部框上是黑白子数对比；轮到的一方可落点亮金色幽光；翻子从落点沿各方向依次连锁翻转（每颗间隔 60ms）。
// 玩家本人可落子时，悬停可落点显示半透明预览子。棋子按格子增量更新，同一局面重画不会打断动画。

const NS = 'http://www.w3.org/2000/svg';
const N = 8;
const S = 60; // 格宽
const F = 26; // 左、右、下框宽（坐标刻在框上）
const HB = 66; // 上框：子数对比
const W = F * 2 + S * N;
const FH = HB + S * N + F; // 框的高度
const T = 11; // 前沿厚度
const H = FH + T;
const COLS = 'abcdefgh';
const R = S * 0.41; // 棋子半径
const STEP = 60; // 连锁翻转的间隔

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
};
const stops = (...list) => list.map(([o, c, a = 1]) => svg('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }));
const label = (x, y) => `${COLS[x]}${y + 1}`;
const parse = (l) => (l && /^[a-h][1-8]$/i.test(l) ? { x: COLS.indexOf(l[0].toLowerCase()), y: Number(l[1]) - 1 } : null);
const CX = (x) => F + x * S + S / 2;
const CY = (y) => HB + (N - 1 - y) * S + S / 2;

// 呢面的绒：细密的明暗点，栅格化一次后当图片贴
const FELT = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' seed='5' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .78  0 0 0 0 1  0 0 0 0 .86  1.1 0 0 0 -.52'/></filter><filter id='d' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='.6' numOctaves='2' seed='9' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 .05  0 0 0 0 .02  1.6 0 0 0 -.66'/></filter><rect width='100%' height='100%' filter='url(#d)'/><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}`;

const CSS = `
svg.board.othello .bg { stroke: none; }
svg.board.othello .oth-coord { font: 500 12.5px/1 var(--num); fill: #e6c578; fill-opacity: .62; letter-spacing: .04em; }
svg.board.othello .oth-num { font: 600 34px/1 var(--num); letter-spacing: .01em; }
svg.board.othello .oth-num-sh { fill: #1a0403; fill-opacity: .9; }
svg.board.othello .oth-tag { font: 400 17px/1 var(--brush); fill: #e6c578; fill-opacity: .7; }
svg.board.othello .oth-win { font: 400 19px/1 var(--brush); fill: #f3d27e; letter-spacing: .2em; }
svg.board.othello .oth-pass { font: 600 12.5px/1 var(--sans); fill: #f08a74; letter-spacing: .12em; }
/* 可落点：金色实心圆点，约格宽的 35%，半透明 */
svg.board.othello .oth-legal { pointer-events: none; fill: #f3d27e; opacity: .55; stroke: #fff2c0; stroke-opacity: .5; stroke-width: 1; }
/* 触屏两步落子：第一下先放一颗预览子（轻轻呼吸），再点同一格才落下 */
svg.board.othello .oth-pre { pointer-events: none; }
svg.board.othello .oth-pre use { animation: oth-pre 1.1s ease-in-out infinite; }
svg.board.othello .oth-pre circle { fill: none; stroke: #f3d27e; stroke-width: 2.4; transform-box: fill-box; transform-origin: center; animation: oth-pre-ring 1.1s ease-out infinite; }
@keyframes oth-pre { 0%, 100% { opacity: .62; } 50% { opacity: .9; } }
@keyframes oth-pre-ring { from { transform: scale(.9); opacity: .9; } to { transform: scale(1.35); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { svg.board.othello .oth-pre use, svg.board.othello .oth-pre circle { animation: none; } }
@media (max-width: 640px) { svg.board.othello .oth-coord { font-size: 17px; fill-opacity: .85; } }
svg.board.othello .oth-st, svg.board.othello .oth-mark { pointer-events: none; }
svg.board.othello .oth-last { fill: #e2523d; stroke: #ffe9c8; stroke-width: 1.3; stroke-opacity: .8; }
svg.board.othello .oth-best { fill: none; stroke: #f3d27e; stroke-width: 2.4; stroke-dasharray: 4 4; }
svg.board.othello .oth-ghost { opacity: .55; pointer-events: none; }
svg.board.othello .oth-combo { font: 400 30px/1 var(--brush); fill: #fbe4a2; stroke: #3a0d06; stroke-width: 4; paint-order: stroke; pointer-events: none; }
svg.board.othello .oth-banner text { font: 700 17px/1 var(--sans); fill: #fbeab0; letter-spacing: .18em; }
svg.board.othello.can-move .oth-hit.on { cursor: pointer; }
`;
let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.dataset.stage = 'othello';
  st.textContent = CSS;
  document.head.append(st);
}

let seq = 0;

export default {
  aspect: [W, H],
  seatColor: (seat) => (seat === 'b' ? 'var(--black-side)' : '#8a857a'),

  createStage({ onAction }) {
    injectStyle();
    const id = `oth${++seq}`;
    const ref = (n) => `url(#${id}-${n})`;
    const el = svg('svg', { class: 'board othello', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '黑白棋棋盘' });

    // ---------- 渐变与棋子 ----------
    const defs = svg('defs', {},
      svg('linearGradient', { id: `${id}-lac`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#6a1d12'], ['.3', '#47110a'], ['1', '#220604'])),
      svg('radialGradient', { id: `${id}-lacsheen`, cx: '.14', cy: '-.02', r: '.5' }, ...stops(['0', '#ffd9a8', '.2'], ['.5', '#ffd9a8', '.05'], ['1', '#ffd9a8', '0'])),
      svg('linearGradient', { id: `${id}-side`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#3e0f09'], ['1', '#160403'])),
      svg('linearGradient', { id: `${id}-edge`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#fff3c8'], ['.07', '#ecc668'], ['.2', '#b08030'], ['.4', '#5e400f'], ['.54', '#46300a'], ['.68', '#7c5a1c'], ['.82', '#c79c44'], ['.91', '#efd28a'], ['1', '#8e6824'])),
      svg('linearGradient', { id: `${id}-gold`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#fffbe6'], ['.28', '#fde6a2'], ['.5', '#f0c966'], ['.58', '#c8983c'], ['.76', '#dcb256'], ['1', '#fbeab0'])),
      svg('radialGradient', { id: `${id}-felt`, cx: '.42', cy: '.38', r: '.78' }, ...stops(['0', '#2f8a63'], ['.55', '#226e4d'], ['1', '#123f2b'])),
      svg('radialGradient', { id: `${id}-feltlight`, cx: '.18', cy: '.04', r: '.8' }, ...stops(['0', '#e6ffe8', '.16'], ['.6', '#e6ffe8', '.03'], ['1', '#e6ffe8', '0'])),
      svg('linearGradient', { id: `${id}-inT`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#020a06', '.7'], ['1', '#020a06', '0'])),
      svg('linearGradient', { id: `${id}-inL`, x1: 0, y1: 0, x2: 1, y2: 0 }, ...stops(['0', '#020a06', '.5'], ['1', '#020a06', '0'])),
      svg('clipPath', { id: `${id}-feltclip` }, svg('rect', { x: F, y: HB, width: S * N, height: S * N, rx: 4 })),
      // 槽：子数对比条
      svg('linearGradient', { id: `${id}-well`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#050101'], ['1', '#1a0705'])),
      svg('linearGradient', { id: `${id}-barB`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#4a4642'], ['.5', '#1a1817'], ['1', '#060505'])),
      svg('linearGradient', { id: `${id}-barW`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#ffffff'], ['.5', '#efe9dc'], ['1', '#bfb39a'])),
      // 棋面
      svg('radialGradient', { id: `${id}-fb`, cx: '.42', cy: '.36', r: '.7', fx: '.36', fy: '.28' }, ...stops(['0', '#5a5551'], ['.38', '#26231f'], ['.85', '#0c0b0a'], ['1', '#000000'])),
      svg('radialGradient', { id: `${id}-fw`, cx: '.42', cy: '.36', r: '.7', fx: '.36', fy: '.28' }, ...stops(['0', '#ffffff'], ['.45', '#f7f3ea'], ['.85', '#dcd4c2'], ['1', '#b3a688'])),
      svg('linearGradient', { id: `${id}-eb`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#2a2622'], ['1', '#050404'])),
      svg('linearGradient', { id: `${id}-ew`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#f4efe2'], ['1', '#a39579'])),
      svg('radialGradient', { id: `${id}-spec`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#ffffff', '.85'], ['1', '#ffffff', '0'])),
      svg('radialGradient', { id: `${id}-sh`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#000a04', '.75'], ['.72', '#000a04', '.5'], ['.88', '#000a04', '.18'], ['1', '#000a04', '0'])),
      svg('radialGradient', { id: `${id}-legal`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#fff2c0', '.95'], ['.25', '#f3d27e', '.7'], ['.6', '#e0b454', '.18'], ['1', '#e0b454', '0'])),
    );
    // 一面朝上的整颗子：侧边（下面那一面的颜色）+ 面 + 高光
    const face = (top) => {
      const under = top === 'b' ? 'w' : 'b';
      return svg('g', { id: `${id}-d${top}` },
        svg('circle', { cy: 3.4, r: R, fill: ref(`e${under}`) }),
        svg('circle', { cy: 1.6, r: R, fill: ref(`e${top}`) }),
        svg('circle', { r: R, fill: ref(`f${top}`) }),
        svg('circle', { r: R * 0.78, fill: 'none', stroke: top === 'b' ? '#ffffff' : '#7a6a4c', 'stroke-opacity': top === 'b' ? '.06' : '.16', 'stroke-width': 1 }),
        svg('ellipse', { cx: -R * 0.34, cy: -R * 0.4, rx: R * 0.36, ry: R * 0.2, fill: ref('spec'), opacity: top === 'b' ? '.28' : '.9', transform: `rotate(-32 ${-R * 0.34} ${-R * 0.4})` }));
    };
    defs.append(face('b'), face('w'), svg('circle', { id: `${id}-ss`, r: R + 3, fill: ref('sh') }));
    el.append(defs);

    // ---------- 框与呢面 ----------
    const fx = F, fy = HB, fs = S * N;
    el.append(
      svg('rect', { x: 0, y: 14, width: W, height: H - 14, rx: 20, fill: ref('side') }),
      svg('rect', { x: 10, y: H - 3.2, width: W - 20, height: 1, fill: '#ffd8a8', 'fill-opacity': '.12' }),
      svg('rect', { class: 'bg', x: 0, y: 0, width: W, height: FH, rx: 20, fill: ref('lac') }),
      svg('rect', { x: 0, y: 0, width: W, height: FH, rx: 20, fill: ref('lacsheen') }),
      svg('rect', { x: 1.25, y: 1.25, width: W - 2.5, height: FH - 2.5, rx: 18.75, fill: 'none', stroke: ref('edge'), 'stroke-width': 2.5 }),
      svg('rect', { x: 6.5, y: 6.5, width: W - 13, height: FH - 13, rx: 13.5, fill: 'none', stroke: '#d9b25e', 'stroke-opacity': '.4', 'stroke-width': 1 }),
      // 呢面下沉一截：外圈一道金线，再是绒面
      svg('rect', { x: fx - 3, y: fy - 3, width: fs + 6, height: fs + 6, rx: 7, fill: 'none', stroke: ref('edge'), 'stroke-width': 1.6 }),
      svg('rect', { x: fx, y: fy, width: fs, height: fs, rx: 4, fill: ref('felt') }),
      svg('g', { 'clip-path': ref('feltclip') },
        svg('image', { href: FELT, x: fx, y: fy, width: fs, height: fs, preserveAspectRatio: 'none', opacity: '.32' }),
        svg('rect', { x: fx, y: fy, width: fs, height: fs, fill: ref('feltlight') }),
        svg('rect', { x: fx, y: fy, width: fs, height: 12, fill: ref('inT') }),
        svg('rect', { x: fx, y: fy, width: 9, height: fs, fill: ref('inL') }),
        svg('rect', { x: fx, y: fy + fs - 1.5, width: fs, height: 1.5, fill: '#d8ffe6', 'fill-opacity': '.18' })),
    );
    const grid = svg('g', { 'pointer-events': 'none' });
    for (let i = 1; i < N; i++) {
      // 刻线：一道暗线贴一道亮线
      grid.append(svg('line', { x1: fx, y1: fy + i * S, x2: fx + fs, y2: fy + i * S, stroke: '#04160d', 'stroke-opacity': '.62', 'stroke-width': 1.5 }));
      grid.append(svg('line', { x1: fx, y1: fy + i * S + 1.3, x2: fx + fs, y2: fy + i * S + 1.3, stroke: '#bff5d6', 'stroke-opacity': '.09', 'stroke-width': 1 }));
      grid.append(svg('line', { x1: fx + i * S, y1: fy, x2: fx + i * S, y2: fy + fs, stroke: '#04160d', 'stroke-opacity': '.62', 'stroke-width': 1.5 }));
      grid.append(svg('line', { x1: fx + i * S + 1.3, y1: fy, x2: fx + i * S + 1.3, y2: fy + fs, stroke: '#bff5d6', 'stroke-opacity': '.09', 'stroke-width': 1 }));
    }
    for (const [gx, gy] of [[2, 2], [6, 2], [2, 6], [6, 6]]) grid.append(svg('circle', { cx: fx + gx * S, cy: fy + gy * S, r: 3.8, fill: '#04160d', 'fill-opacity': '.75' }));
    const coords = svg('g', { class: 'oth-coord' });
    for (let i = 0; i < N; i++) {
      coords.append(svg('text', { x: CX(i), y: fy + fs + F / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' }));
      coords.lastChild.textContent = COLS[i];
      coords.append(svg('text', { x: F / 2 + 0.5, y: CY(i), 'text-anchor': 'middle', 'dominant-baseline': 'central' }));
      coords.lastChild.textContent = String(i + 1);
    }

    // ---------- 上框：子数对比 ----------
    const head = svg('g');
    const by = 32; // 条的中线
    const bx0 = F + 112, bx1 = W - F - 112, bw = bx1 - bx0;
    const iconB = svg('use', { href: `#${id}-db`, transform: `translate(${F + 20} ${by}) scale(.62)` });
    const iconW = svg('use', { href: `#${id}-dw`, transform: `translate(${W - F - 20} ${by}) scale(.62)` });
    const numB = svg('text', { class: 'oth-num', x: F + 42, y: by + 1, 'dominant-baseline': 'central', fill: ref('gold') });
    const numBs = svg('text', { class: 'oth-num oth-num-sh', x: F + 42, y: by + 2.6, 'dominant-baseline': 'central' });
    const numW = svg('text', { class: 'oth-num', x: W - F - 42, y: by + 1, 'text-anchor': 'end', 'dominant-baseline': 'central', fill: ref('gold') });
    const numWs = svg('text', { class: 'oth-num oth-num-sh', x: W - F - 42, y: by + 2.6, 'text-anchor': 'end', 'dominant-baseline': 'central' });
    const fillB = svg('rect', { x: bx0, y: by - 5, height: 10, width: bw / 2, fill: ref('barB') });
    const fillW = svg('rect', { x: bx0 + bw / 2, y: by - 5, height: 10, width: bw / 2, fill: ref('barW') });
    const knot = svg('rect', { x: bx0 + bw / 2 - 1.5, y: by - 9, width: 3, height: 18, rx: 1.5, fill: ref('gold') });
    const passT = svg('text', { class: 'oth-pass', x: W / 2, y: by + 18, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    head.append(
      svg('rect', { x: bx0 - 4, y: by - 8, width: bw + 8, height: 16, rx: 8, fill: ref('well') }),
      svg('rect', { x: bx0 - 4, y: by + 8, width: bw + 8, height: 1, fill: '#ffd8a8', 'fill-opacity': '.16' }),
      fillB, fillW,
      svg('line', { x1: bx0 + bw / 2, y1: by - 5, x2: bx0 + bw / 2, y2: by + 5, stroke: '#c9a24a', 'stroke-opacity': '.5', 'stroke-width': 1 }),
      knot, iconB, iconW, numBs, numB, numWs, numW, passT,
    );
    const barClip = svg('clipPath', { id: `${id}-barclip` }, svg('rect', { x: bx0, y: by - 5, width: bw, height: 10, rx: 5 }));
    defs.append(barClip);
    fillB.setAttribute('clip-path', ref('barclip'));
    fillW.setAttribute('clip-path', ref('barclip'));

    const legalG = svg('g');
    const shadows = svg('g');
    const stonesG = svg('g');
    const marks = svg('g');
    const fx2 = svg('g', { 'pointer-events': 'none' });
    const ghost = svg('use', { class: 'oth-ghost', href: `#${id}-db`, x: -200, y: -200 });
    const preDisc = svg('use', { href: `#${id}-db` });
    const preRing = svg('circle', { r: R + 3 });
    const pre = svg('g', { class: 'oth-pre', display: 'none' }, preDisc, preRing);
    const hit = svg('rect', { class: 'oth-hit', x: fx, y: fy, width: fs, height: fs, fill: 'transparent' });
    el.append(grid, coords, head, legalG, shadows, stonesG, marks, ghost, pre, fx2, hit);

    // ---------- 交互 ----------
    let movable = null;
    let legal = new Set();
    let preAt = null; // 触屏上第一下点的格，再点同一格才落子
    const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    /** 触屏（或手指点的）要两步确认；桌面鼠标仍是点一下就落 */
    const twoStep = (evt) => !!coarse?.matches || evt.pointerType === 'touch' || evt.pointerType === 'pen';
    const showPre = (l) => {
      preAt = l;
      const p = parse(l);
      if (!p) { pre.setAttribute('display', 'none'); return; }
      preDisc.setAttribute('href', `#${id}-d${movable}`);
      preDisc.setAttribute('x', CX(p.x)); preDisc.setAttribute('y', CY(p.y));
      preRing.setAttribute('cx', CX(p.x)); preRing.setAttribute('cy', CY(p.y));
      pre.removeAttribute('display');
    };
    const cellAt = (evt) => {
      const ctm = el.getScreenCTM();
      if (!ctm) return null;
      const pt = el.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      const x = Math.floor((p.x - fx) / S), y = N - 1 - Math.floor((p.y - fy) / S);
      return x >= 0 && x < N && y >= 0 && y < N ? label(x, y) : null;
    };
    const hideGhost = () => { ghost.setAttribute('x', -200); ghost.setAttribute('y', -200); hit.classList.remove('on'); };
    hit.addEventListener('pointermove', (evt) => {
      if (evt.pointerType !== 'mouse') return; // 手指划过不画悬停子，触屏用预览子
      const l = movable ? cellAt(evt) : null;
      if (l && legal.has(l)) {
        const p = parse(l);
        ghost.setAttribute('href', `#${id}-d${movable}`);
        ghost.setAttribute('x', CX(p.x)); ghost.setAttribute('y', CY(p.y));
        hit.classList.add('on');
      } else hideGhost();
    });
    hit.addEventListener('pointerleave', hideGhost);
    hit.addEventListener('click', (evt) => {
      if (!movable) return;
      const l = cellAt(evt);
      if (!l || !legal.has(l)) { if (twoStep(evt)) showPre(null); return; }
      if (twoStep(evt) && preAt !== l) { hideGhost(); showPre(l); return; }
      hideGhost();
      showPre(null);
      onAction(l);
    });

    // ---------- 增量画子 ----------
    const cells = new Array(N * N).fill(null); // { c, g, disc, sh }
    let shownMoves = null;

    function place(i, c) {
      const x = i % N, y = Math.floor(i / N);
      const sh = svg('use', { href: `#${id}-ss`, x: CX(x) + 2.6, y: CY(y) + 5 });
      const disc = svg('g', {}, svg('use', { href: `#${id}-d${c}` }));
      const g = svg('g', { class: 'oth-st', transform: `translate(${CX(x)} ${CY(y)})` }, disc);
      shadows.append(sh);
      stonesG.append(g);
      cells[i] = { c, g, disc, sh };
    }
    function flip(i, from, to, delay) {
      const cell = cells[i];
      if (!cell?.disc.animate) return;
      const a = svg('use', { href: `#${id}-d${from}` });
      const b = cell.disc.lastChild;
      cell.disc.prepend(a);
      const t = { duration: 380, delay, easing: 'cubic-bezier(.45, 0, .35, 1)', fill: 'backwards' };
      // 立起来翻：压扁、抬高、在中点换面；斜一点让它像在转
      cell.disc.animate([
        { transform: 'translateY(0) scaleX(1) skewY(0deg)' },
        { transform: 'translateY(-11px) scaleX(.05) skewY(-8deg)', offset: 0.5 },
        { transform: 'translateY(0) scaleX(1) skewY(0deg)' },
      ], t);
      const hold = (o) => [{ opacity: o }, { opacity: o, offset: 0.5 }, { opacity: 1 - o, offset: 0.5001 }, { opacity: 1 - o }];
      const an = a.animate(hold(1), { ...t, fill: 'both' });
      b.animate(hold(0), t);
      an.onfinish = () => a.remove();
      setTimeout(() => a.remove(), delay + 600);
      const x = Number(cell.sh.getAttribute('x')), y = Number(cell.sh.getAttribute('y'));
      cell.sh.animate([
        { transformOrigin: `${x}px ${y}px`, transform: 'translate(0, 0) scaleX(1)', opacity: 1 },
        { transformOrigin: `${x}px ${y}px`, transform: 'translate(5px, 9px) scaleX(.35)', opacity: 0.45, offset: 0.5 },
        { transformOrigin: `${x}px ${y}px`, transform: 'translate(0, 0) scaleX(1)', opacity: 1 },
      ], t);
    }
    function drop(i) {
      const cell = cells[i];
      if (!cell?.disc.animate) return;
      cell.disc.animate([
        { transform: 'translateY(-16px) scale(1.18)', opacity: 0 },
        { transform: 'translateY(-4px) scale(1.05)', opacity: 1, offset: 0.6 },
        { transform: 'translateY(0) scale(.97)', offset: 0.85 },
        { transform: 'translateY(0) scale(1)' },
      ], { duration: 260, easing: 'cubic-bezier(.4, 0, .7, 1)' });
      const x = Number(cell.sh.getAttribute('x')), y = Number(cell.sh.getAttribute('y'));
      cell.sh.animate([
        { transformOrigin: `${x}px ${y}px`, transform: 'translate(7px, 12px) scale(1.3)', opacity: 0 },
        { transformOrigin: `${x}px ${y}px`, transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ], { duration: 260, easing: 'cubic-bezier(.4, 0, .7, 1)' });
    }
    function combo(p, n, delay) {
      const t = svg('text', { class: 'oth-combo', x: CX(p.x), y: CY(p.y) - R - 6, 'text-anchor': 'middle' });
      t.textContent = `连翻 ×${n}`;
      fx2.append(t);
      if (!t.animate) { setTimeout(() => t.remove(), 1600); return; }
      const an = t.animate([
        { transform: 'translateY(8px)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1, offset: 0.2 },
        { transform: 'translateY(-10px)', opacity: 1, offset: 0.75 },
        { transform: 'translateY(-22px)', opacity: 0 },
      ], { duration: 1500, delay, easing: 'ease-out', fill: 'both' });
      an.onfinish = () => t.remove();
    }
    function banner(text) {
      const g = svg('g', { class: 'oth-banner' },
        svg('rect', { x: fx + 40, y: fy + fs / 2 - 22, width: fs - 80, height: 44, rx: 10, fill: ref('lac'), stroke: ref('edge'), 'stroke-width': 1.6 }),
        svg('text', { x: W / 2, y: fy + fs / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' }));
      g.lastChild.textContent = text;
      fx2.append(g);
      if (!g.animate) { setTimeout(() => g.remove(), 2200); return; }
      const an = g.animate([
        { transform: 'translateX(-60px)', opacity: 0 },
        { transform: 'translateX(0)', opacity: 1, offset: 0.18 },
        { transform: 'translateX(0)', opacity: 1, offset: 0.8 },
        { transform: 'translateX(60px)', opacity: 0 },
      ], { duration: 2200, easing: 'ease-in-out', fill: 'both' });
      an.onfinish = () => g.remove();
    }

    return {
      el,
      render(view, { movable: mv = null, actions = null, arrows = [], animate = true } = {}) {
        movable = mv;
        legal = new Set(mv ? (actions ? actions.map((a) => a.id) : view.legal || []) : []);
        el.classList.toggle('can-move', !!mv);
        if (!mv) hideGhost();
        if (preAt && !legal.has(preAt)) showPre(null);

        const moves = view.moves || [];
        const fresh = animate && shownMoves !== null && moves.length === shownMoves + 1;
        shownMoves = moves.length;
        const lastP = parse(view.lastMove);
        const lastI = lastP ? lastP.y * N + lastP.x : -1;
        const flipped = new Set(fresh ? view.flipped || [] : []);

        for (let i = 0; i < N * N; i++) {
          const c = view.board[i] || null;
          const cur = cells[i];
          if (cur && cur.c === c) continue;
          const l = label(i % N, Math.floor(i / N));
          if (cur && c && fresh && flipped.has(l)) {
            // 原地翻面
            cur.disc.lastChild.setAttribute('href', `#${id}-d${c}`);
            cur.c = c;
            const d = Math.max(Math.abs((i % N) - lastP.x), Math.abs(Math.floor(i / N) - lastP.y));
            flip(i, c === 'b' ? 'w' : 'b', c, 120 + (d - 1) * STEP);
            continue;
          }
          if (cur) { cur.g.remove(); cur.sh.remove(); cells[i] = null; }
          if (c) {
            place(i, c);
            if (fresh && i === lastI) drop(i);
          }
        }
        if (fresh && flipped.size >= 5 && lastP) combo(lastP, flipped.size, 200);
        if (fresh && view.pass && !view.over) banner(`${view.pass === 'b' ? '黑方' : '白方'}无处可下 · 跳过一手`);

        // 可落点：轮到的一方
        legalG.replaceChildren();
        const show = view.over ? [] : mv ? [...legal] : view.legal || [];
        for (const l of show) {
          const p = parse(l);
          if (p) legalG.append(svg('circle', { class: 'oth-legal', cx: CX(p.x), cy: CY(p.y), r: S * 0.175 }));
        }

        marks.replaceChildren();
        if (lastP && cells[lastI]) marks.append(svg('circle', { class: 'oth-last', cx: CX(lastP.x), cy: CY(lastP.y), r: 4.4 }));
        for (const ar of arrows) {
          const p = parse(ar.iccs);
          if (p) marks.append(svg('circle', { class: 'oth-best', cx: CX(p.x), cy: CY(p.y), r: R + 2 }));
        }

        // 子数对比
        const cnt = view.counts || { b: view.board.filter((c) => c === 'b').length, w: view.board.filter((c) => c === 'w').length };
        const tot = Math.max(1, cnt.b + cnt.w);
        const wb = bw * (cnt.b / tot);
        for (const [t, v] of [[numB, cnt.b], [numBs, cnt.b], [numW, cnt.w], [numWs, cnt.w]]) t.textContent = String(v);
        const animBar = fresh && fillB.animate;
        const prevW = Number(fillB.getAttribute('width'));
        fillB.setAttribute('width', wb);
        fillW.setAttribute('x', bx0 + wb);
        fillW.setAttribute('width', bw - wb);
        knot.setAttribute('x', bx0 + wb - 1.5);
        if (animBar && Math.abs(prevW - wb) > 0.5) {
          const o = { duration: 420, delay: 140, easing: 'cubic-bezier(.3, .7, .2, 1)', fill: 'backwards' };
          const dx = prevW - wb;
          fillB.animate([{ transform: `scaleX(${prevW / Math.max(wb, 0.01)})`, transformOrigin: `${bx0}px 0` }, { transform: 'scaleX(1)', transformOrigin: `${bx0}px 0` }], o);
          knot.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], o);
        }
        const winner = view.over ? (cnt.b > cnt.w ? 'b' : cnt.w > cnt.b ? 'w' : null) : null;
        passT.setAttribute('class', view.over ? 'oth-win' : 'oth-pass');
        passT.textContent = view.over ? (winner ? `${winner === 'b' ? '黑' : '白'}胜` : '和局')
          : view.pass ? `${view.pass === 'b' ? '黑方' : '白方'}跳过一手` : '';
      },
    };
  },

  moveList: (view) => (view.moves || []).map((m) => ({ seat: m.side, label: m.label })),
};
