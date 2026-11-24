// 五子棋画面：榧木棋盘（木纹、漆框、看得见厚度），黑子哑光石、白子贝壳瓷光，棋子有立体和投影。
// 落子从上方轻落 + 涟漪；冲四、活三的关键点淡红光圈；五连时金线从第一子划到第五子，五颗子依次亮起。
// 棋子按格子做增量更新：同一局面重画不会打断正在播的动画。

const NS = 'http://www.w3.org/2000/svg';
const N = 15;
const S = 40; // 格距
const F = 20; // 漆框宽
const PAD = 36; // 木面上网格外的留边（放坐标）
const G0 = F + PAD; // 第一条线的位置
const W = G0 * 2 + S * (N - 1);
const T = 11; // 棋盘前沿露出的厚度
const H = W + T;
const R = 18.4; // 棋子半径
const COLS = 'ABCDEFGHIJKLMNO';
const STARS = [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]];
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
};
const stops = (...list) => list.map(([o, c, a = 1]) => svg('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }));
const label = (x, y) => `${COLS[x]}${y + 1}`;
const parse = (l) => {
  const m = /^([A-O])(\d{1,2})$/i.exec(l || '');
  return m ? { x: COLS.indexOf(m[1].toUpperCase()), y: Number(m[2]) - 1 } : null;
};
const X = (x) => G0 + x * S;
const Y = (y) => G0 + (N - 1 - y) * S;

// 榧木纹：一张拉长的噪声图，浏览器只栅格化一次，之后当普通图片贴
const GRAIN = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><filter id='g' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='0.0028 0.14' numOctaves='4' seed='11' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .36  0 0 0 0 .17  0 0 0 0 .04  0 0 0 1.5 -.62'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`)}`;
const FLECK = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='f' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='0.02 0.9' numOctaves='2' seed='4' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .42  0 0 0 0 .22  0 0 0 0 .06  0 0 0 1.4 -.66'/></filter><rect width='100%' height='100%' filter='url(#f)'/></svg>`)}`;

const CSS = `
svg.board.gomoku .bg { stroke: none; }
svg.board.gomoku .gk-grid line { stroke: #4b230a; stroke-width: 1.15; stroke-opacity: .82; }
svg.board.gomoku .gk-grid .edge { stroke-width: 2.3; stroke-opacity: .9; fill: none; stroke: #4b230a; }
svg.board.gomoku .gk-grid .star { fill: #3b1a06; }
svg.board.gomoku .gk-coord { font: 500 13px/1 var(--num); fill: #6b3a14; fill-opacity: .72; }
svg.board.gomoku .gk-st, svg.board.gomoku .gk-mark, svg.board.gomoku .gk-threat { pointer-events: none; }
svg.board.gomoku .gk-threat { animation: gk-breathe 2.6s ease-in-out infinite; }
svg.board.gomoku .gk-threat.four { animation-duration: 1.4s; }
@keyframes gk-breathe { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
svg.board.gomoku .gk-last { fill: #e2523d; stroke: #fff1d6; stroke-width: 1.2; stroke-opacity: .7; }
svg.board.gomoku .gk-best { fill: none; stroke: #c42d1e; stroke-width: 2.4; stroke-dasharray: 4 4; }
svg.board.gomoku .gk-ghost { opacity: .5; pointer-events: none; }
/* 触屏两步落子：第一下先放一颗预览子（轻轻呼吸），再点同一点才落下 */
svg.board.gomoku .gk-pre { pointer-events: none; }
svg.board.gomoku .gk-pre use { animation: gk-pre 1.1s ease-in-out infinite; }
svg.board.gomoku .gk-pre circle { fill: none; stroke: #f3d27e; stroke-width: 2.2; transform-box: fill-box; transform-origin: center; animation: gk-pre-ring 1.1s ease-out infinite; }
@keyframes gk-pre { 0%, 100% { opacity: .62; } 50% { opacity: .9; } }
@keyframes gk-pre-ring { from { transform: scale(.9); opacity: .9; } to { transform: scale(1.45); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { svg.board.gomoku .gk-pre use, svg.board.gomoku .gk-pre circle { animation: none; } }
@media (max-width: 640px) { svg.board.gomoku .gk-coord { font-size: 18px; fill-opacity: .82; } }
svg.board.gomoku.can-move { cursor: pointer; }
svg.board.gomoku .gk-ripple { fill: none; stroke: #fff4d8; stroke-width: 2; vector-effect: non-scaling-stroke; pointer-events: none; }
svg.board.gomoku .gk-win-glow { stroke: #f3d27e; stroke-opacity: .2; stroke-width: 11; stroke-linecap: round; fill: none; }
svg.board.gomoku .gk-win-line { stroke: #ffe9a8; stroke-width: 4; stroke-linecap: round; fill: none; }
svg.board.gomoku .gk-win-core { stroke: #c99a3e; stroke-width: 1.4; stroke-linecap: round; fill: none; }
`;
let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.dataset.stage = 'gomoku';
  st.textContent = CSS;
  document.head.append(st);
}

let seq = 0;

/** 冲四、活三的关键点：落在这里，c 方就成五（four），或成活四（three） */
function threatsFor(board, c) {
  const at = (x, y) => (x >= 0 && x < N && y >= 0 && y < N ? board[y * N + x] : 'X');
  const four = new Set(), three = new Set();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (board[y * N + x]) continue;
    for (const [dx, dy] of DIRS) {
      const L = (t) => (t === 0 ? c : at(x + dx * t, y + dy * t));
      let run = 1;
      for (let t = 1; L(t) === c; t++) run++;
      for (let t = -1; L(t) === c; t--) run++;
      if (run >= 5) { four.add(y * N + x); break; }
      for (let s = -3; s <= 0; s++) {
        if (L(s) === c && L(s + 1) === c && L(s + 2) === c && L(s + 3) === c && L(s - 1) === null && L(s + 4) === null) { three.add(y * N + x); break; }
      }
    }
  }
  for (const i of four) three.delete(i);
  return { four, three };
}

export default {
  aspect: [W, H],
  seatColor: (seat) => (seat === 'b' ? 'var(--black-side)' : '#8a857a'),

  createStage({ onAction }) {
    injectStyle();
    const id = `gk${++seq}`;
    const ref = (n) => `url(#${id}-${n})`;
    const el = svg('svg', { class: 'board gomoku', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '五子棋棋盘' });

    // ---------- 共用的渐变 ----------
    const defs = svg('defs', {},
      svg('linearGradient', { id: `${id}-lac`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#6a1d12'], ['.3', '#47110a'], ['1', '#220604'])),
      svg('radialGradient', { id: `${id}-lacsheen`, cx: '.14', cy: '-.02', r: '.5' }, ...stops(['0', '#ffd9a8', '.2'], ['.5', '#ffd9a8', '.05'], ['1', '#ffd9a8', '0'])),
      svg('linearGradient', { id: `${id}-side`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#3e0f09'], ['1', '#160403'])),
      svg('linearGradient', { id: `${id}-edge`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#fff3c8'], ['.07', '#ecc668'], ['.2', '#b08030'], ['.4', '#5e400f'], ['.54', '#46300a'], ['.68', '#7c5a1c'], ['.82', '#c79c44'], ['.91', '#efd28a'], ['1', '#8e6824'])),
      svg('linearGradient', { id: `${id}-wood`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#ecc283'], ['.45', '#dcaa66'], ['1', '#c58f4e'])),
      svg('radialGradient', { id: `${id}-woodlight`, cx: '.2', cy: '.08', r: '.85' }, ...stops(['0', '#fff6e0', '.42'], ['.55', '#fff6e0', '.08'], ['1', '#fff6e0', '0'])),
      svg('linearGradient', { id: `${id}-inT`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#2a0c02', '.5'], ['1', '#2a0c02', '0'])),
      svg('linearGradient', { id: `${id}-inL`, x1: 0, y1: 0, x2: 1, y2: 0 }, ...stops(['0', '#2a0c02', '.36'], ['1', '#2a0c02', '0'])),
      svg('clipPath', { id: `${id}-woodclip` }, svg('rect', { x: F, y: F, width: W - 2 * F, height: W - 2 * F, rx: 4 })),
      // 黑子：哑光石，宽而柔的高光，下沿一圈棋盘反上来的暖光
      svg('radialGradient', { id: `${id}-b`, cx: '.4', cy: '.36', r: '.68', fx: '.34', fy: '.27' }, ...stops(['0', '#68625c'], ['.3', '#34302d'], ['.72', '#141211'], ['.93', '#0a0908'], ['1', '#3a2a1c'])),
      svg('radialGradient', { id: `${id}-bs`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#ffffff', '.2'], ['1', '#ffffff', '0'])),
      // 白子：贝壳瓷光，亮而小的高光，边缘带一点米色
      svg('radialGradient', { id: `${id}-w`, cx: '.42', cy: '.38', r: '.7', fx: '.36', fy: '.3' }, ...stops(['0', '#ffffff'], ['.42', '#fbf8f0'], ['.8', '#e7e0cf'], ['.95', '#c9bea4'], ['1', '#a99a7c'])),
      svg('radialGradient', { id: `${id}-ws`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#ffffff', '.95'], ['.6', '#ffffff', '.35'], ['1', '#ffffff', '0'])),
      svg('radialGradient', { id: `${id}-sh`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#1a0800', '.7'], ['.72', '#1a0800', '.5'], ['.86', '#1a0800', '.2'], ['1', '#1a0800', '0'])),
      svg('radialGradient', { id: `${id}-threat`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#e2523d', '0'], ['.5', '#e2523d', '.06'], ['.8', '#e2523d', '.5'], ['1', '#e2523d', '0'])),
      svg('radialGradient', { id: `${id}-glow`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#fff3c8', '0'], ['.62', '#fff3c8', '0'], ['.74', '#f3d27e', '.95'], ['1', '#e0b454', '0'])),
    );
    // 棋子本体：<use> 复用，每颗子只是一个位移
    const shell = svg('g', { fill: 'none', stroke: '#a89a7c', 'stroke-width': '.45', 'stroke-opacity': '.16' },
      svg('path', { d: `M ${-R * 0.82} ${R * 0.1} Q 0 ${-R * 0.42} ${R * 0.84} ${R * 0.06}` }),
      svg('path', { d: `M ${-R * 0.88} ${R * 0.34} Q 0 ${-R * 0.12} ${R * 0.9} ${R * 0.3}` }),
      svg('path', { d: `M ${-R * 0.8} ${R * 0.58} Q 0 ${R * 0.18} ${R * 0.82} ${R * 0.55}` }),
      svg('path', { d: `M ${-R * 0.66} ${R * 0.76} Q 0 ${R * 0.42} ${R * 0.68} ${R * 0.74}` }),
      svg('path', { d: `M ${-R * 0.7} ${-R * 0.2} Q 0 ${-R * 0.66} ${R * 0.72} ${-R * 0.22}` }));
    defs.append(
      svg('g', { id: `${id}-sb` },
        svg('circle', { r: R, fill: ref('b') }),
        svg('ellipse', { cx: -R * 0.3, cy: -R * 0.38, rx: R * 0.5, ry: R * 0.36, fill: ref('bs'), transform: `rotate(-28 ${-R * 0.3} ${-R * 0.38})` })),
      svg('g', { id: `${id}-sw` },
        svg('circle', { r: R, fill: ref('w') }),
        shell,
        svg('ellipse', { cx: -R * 0.32, cy: -R * 0.42, rx: R * 0.36, ry: R * 0.22, fill: ref('ws'), transform: `rotate(-30 ${-R * 0.32} ${-R * 0.42})` }),
        svg('circle', { r: R - 0.4, fill: 'none', stroke: '#8f8166', 'stroke-width': '.8', 'stroke-opacity': '.45' })),
      svg('circle', { id: `${id}-ss`, r: R + 3, fill: ref('sh') }),
    );
    el.append(defs);

    // ---------- 棋盘：厚度、漆框、木面 ----------
    el.append(
      svg('rect', { x: 0, y: 14, width: W, height: H - 14, rx: 24, fill: ref('side') }),
      svg('rect', { x: 10, y: H - 3.2, width: W - 20, height: 1, fill: '#ffd8a8', 'fill-opacity': '.12' }),
      svg('rect', { class: 'bg', x: 0, y: 0, width: W, height: W, rx: 24, fill: ref('lac') }),
      svg('rect', { x: 0, y: 0, width: W, height: W, rx: 24, fill: ref('lacsheen') }),
      svg('rect', { x: 1.25, y: 1.25, width: W - 2.5, height: W - 2.5, rx: 22.75, fill: 'none', stroke: ref('edge'), 'stroke-width': 2.5 }),
      svg('rect', { x: 6.5, y: 6.5, width: W - 13, height: W - 13, rx: 17.5, fill: 'none', stroke: '#d9b25e', 'stroke-opacity': '.45', 'stroke-width': 1 }),
      svg('rect', { x: F, y: F, width: W - 2 * F, height: W - 2 * F, rx: 4, fill: ref('wood') }),
      svg('g', { 'clip-path': ref('woodclip') },
        svg('image', { href: GRAIN, x: F, y: F, width: W - 2 * F, height: W - 2 * F, preserveAspectRatio: 'none', opacity: '.3' }),
        svg('image', { href: FLECK, x: F, y: F, width: W - 2 * F, height: W - 2 * F, preserveAspectRatio: 'none', opacity: '.35' }),
        svg('rect', { x: F, y: F, width: W - 2 * F, height: W - 2 * F, fill: ref('woodlight') }),
        // 木面嵌在漆框里：上沿、左沿压一道影，下沿、右沿一道受光
        svg('rect', { x: F, y: F, width: W - 2 * F, height: 9, fill: ref('inT') }),
        svg('rect', { x: F, y: F, width: 7, height: W - 2 * F, fill: ref('inL') }),
        svg('rect', { x: F, y: W - F - 1.5, width: W - 2 * F, height: 1.5, fill: '#fff4dc', 'fill-opacity': '.5' }),
        svg('rect', { x: W - F - 1.2, y: F, width: 1.2, height: W - 2 * F, fill: '#fff4dc', 'fill-opacity': '.35' })),
      svg('rect', { x: F - 0.5, y: F - 0.5, width: W - 2 * F + 1, height: W - 2 * F + 1, rx: 4.5, fill: 'none', stroke: '#1c0602', 'stroke-opacity': '.7', 'stroke-width': 1 }),
    );
    const grid = svg('g', { class: 'gk-grid' });
    for (let i = 0; i < N; i++) {
      grid.append(svg('line', { x1: X(0), y1: Y(i), x2: X(N - 1), y2: Y(i) }));
      grid.append(svg('line', { x1: X(i), y1: Y(0), x2: X(i), y2: Y(N - 1) }));
    }
    grid.append(svg('rect', { class: 'edge', x: X(0), y: Y(N - 1), width: S * (N - 1), height: S * (N - 1) }));
    for (const [x, y] of STARS) grid.append(svg('circle', { class: 'star', cx: X(x), cy: Y(y), r: 4.6 }));
    const coords = svg('g', { class: 'gk-coord' });
    for (let i = 0; i < N; i++) {
      coords.append(svg('text', { x: X(i), y: Y(0) + 25, 'text-anchor': 'middle', 'dominant-baseline': 'central' }));
      coords.lastChild.textContent = COLS[i];
      coords.append(svg('text', { x: X(0) - 24, y: Y(i), 'text-anchor': 'middle', 'dominant-baseline': 'central' }));
      coords.lastChild.textContent = String(i + 1);
    }
    const threatsG = svg('g');
    const shadows = svg('g');
    const stonesG = svg('g');
    const marks = svg('g');
    const winG = svg('g');
    const ghost = svg('use', { class: 'gk-ghost', href: `#${id}-sb`, x: -200, y: -200 });
    const preStone = svg('use', { href: `#${id}-sb` });
    const preRing = svg('circle', { r: R + 2 });
    const pre = svg('g', { class: 'gk-pre', display: 'none' }, preStone, preRing);
    el.append(grid, coords, threatsG, shadows, stonesG, winG, marks, ghost, pre);

    // ---------- 交互 ----------
    let board = [];
    let movable = null;
    let preAt = null; // 触屏上第一下点的位置 { x, y }，再点同一点才落子
    const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    /** 触屏（或手指点的）要两步确认；桌面鼠标仍是点一下就落 */
    const twoStep = (evt) => !!coarse?.matches || evt.pointerType === 'touch' || evt.pointerType === 'pen';
    const showPre = (p) => {
      preAt = p;
      if (!p) { pre.setAttribute('display', 'none'); return; }
      preStone.setAttribute('href', `#${id}-s${movable}`);
      preStone.setAttribute('x', X(p.x)); preStone.setAttribute('y', Y(p.y));
      preRing.setAttribute('cx', X(p.x)); preRing.setAttribute('cy', Y(p.y));
      pre.removeAttribute('display');
    };
    const pointAt = (evt) => {
      const ctm = el.getScreenCTM();
      if (!ctm) return null;
      const pt = el.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      const x = Math.round((p.x - G0) / S), y = N - 1 - Math.round((p.y - G0) / S);
      return x >= 0 && x < N && y >= 0 && y < N ? { x, y } : null;
    };
    const hideGhost = () => { ghost.setAttribute('x', -200); ghost.setAttribute('y', -200); };
    el.addEventListener('pointermove', (evt) => {
      if (evt.pointerType !== 'mouse') return; // 手指划过不画悬停子，触屏用预览子
      const p = movable ? pointAt(evt) : null;
      if (p && !board[p.y * N + p.x]) {
        ghost.setAttribute('href', `#${id}-s${movable}`);
        ghost.setAttribute('x', X(p.x)); ghost.setAttribute('y', Y(p.y));
      } else hideGhost();
    });
    el.addEventListener('pointerleave', hideGhost);
    el.addEventListener('click', (evt) => {
      if (!movable) return;
      const p = pointAt(evt);
      if (!p || board[p.y * N + p.x]) return;
      if (twoStep(evt) && !(preAt && preAt.x === p.x && preAt.y === p.y)) { hideGhost(); showPre(p); return; }
      hideGhost();
      showPre(null);
      onAction(label(p.x, p.y));
    });

    // ---------- 增量画子 ----------
    const cells = new Array(N * N).fill(null); // { c, st, sh }
    let shownMoves = null;
    let shownWin = '';

    function place(i, c) {
      const x = i % N, y = Math.floor(i / N);
      const sh = svg('use', { href: `#${id}-ss`, x: X(x) + 2.6, y: Y(y) + 4.2 });
      const st = svg('use', { class: `gk-st ${c}`, href: `#${id}-s${c}`, x: X(x), y: Y(y) });
      shadows.append(sh);
      stonesG.append(st);
      cells[i] = { c, st, sh };
    }
    function drop(i) {
      const cell = cells[i];
      if (!cell?.st.animate) return;
      const x = X(i % N), y = Y(Math.floor(i / N));
      const o = { transformOrigin: `${x}px ${y}px` };
      cell.st.animate([
        { ...o, transform: 'translate(-3px, -18px) scale(1.16)', opacity: 0 },
        { ...o, transform: 'translate(-1px, -6px) scale(1.06)', opacity: 1, offset: 0.55 },
        { ...o, transform: 'translate(0, 0) scale(.97)', offset: 0.85 },
        { ...o, transform: 'translate(0, 0) scale(1)' },
      ], { duration: 300, easing: 'cubic-bezier(.4, 0, .7, 1)' });
      cell.sh.animate([
        { ...o, transform: 'translate(7px, 12px) scale(1.3)', opacity: 0 },
        { ...o, transform: 'translate(3px, 5px) scale(1.12)', opacity: 0.5, offset: 0.55 },
        { ...o, transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ], { duration: 300, easing: 'cubic-bezier(.4, 0, .7, 1)' });
      for (const [delay, to, a] of [[230, 2.3, 0.85], [360, 3.1, 0.45]]) {
        const ring = svg('circle', { class: 'gk-ripple', cx: x, cy: y, r: R });
        marks.before(ring);
        const anim = ring.animate([
          { transformOrigin: `${x}px ${y}px`, transform: 'scale(1)', opacity: a },
          { transformOrigin: `${x}px ${y}px`, transform: `scale(${to})`, opacity: 0 },
        ], { duration: 820, delay, easing: 'cubic-bezier(.15, .7, .3, 1)', fill: 'both' });
        anim.onfinish = () => ring.remove();
        setTimeout(() => ring.remove(), delay + 1200);
      }
    }

    function drawWin(view, fresh) {
      const key = (view.winLine || []).join(',');
      if (key === shownWin) return;
      shownWin = key;
      winG.replaceChildren();
      if (!key) return;
      const pts = view.winLine.map(parse).filter(Boolean);
      if (pts.length < 2) return;
      // 沿连线方向排序，金线从一头划到另一头
      const [dx, dy] = [pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y];
      pts.sort((a, b) => (a.x * dx + a.y * dy) - (b.x * dx + b.y * dy));
      const a = pts[0], b = pts[pts.length - 1];
      const line = { x1: X(a.x), y1: Y(a.y), x2: X(b.x), y2: Y(b.y) };
      const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
      const glows = pts.map((p) => svg('circle', { cx: X(p.x), cy: Y(p.y), r: R + 6, fill: ref('glow') }));
      const strokes = ['gk-win-glow', 'gk-win-line', 'gk-win-core'].map((c) => svg('line', { class: c, ...line }));
      winG.append(...glows, ...strokes);
      if (!fresh || !strokes[0].animate) return;
      const base = 340;
      for (const s of strokes) {
        s.setAttribute('stroke-dasharray', `${len} ${len}`);
        s.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 620, delay: base, easing: 'cubic-bezier(.5, 0, .2, 1)', fill: 'backwards' });
      }
      glows.forEach((g, k) => {
        const o = { transformOrigin: `${g.getAttribute('cx')}px ${g.getAttribute('cy')}px` };
        g.animate([
          { ...o, opacity: 0, transform: 'scale(.6)' },
          { ...o, opacity: 1, transform: 'scale(1.18)', offset: 0.45 },
          { ...o, opacity: 1, transform: 'scale(1)' },
        ], { duration: 520, delay: base + k * (620 / Math.max(1, pts.length - 1)), easing: 'ease-out', fill: 'backwards' });
      });
    }

    return {
      el,
      render(view, { movable: mv = null, arrows = [], animate = true } = {}) {
        board = view.board || [];
        movable = mv;
        el.classList.toggle('can-move', !!mv);
        if (!mv) hideGhost();
        if (preAt && (!mv || board[preAt.y * N + preAt.x])) showPre(null);

        const moves = view.moves || [];
        const fresh = animate && shownMoves !== null && moves.length === shownMoves + 1;
        shownMoves = moves.length;
        const lastP = parse(view.lastMove);
        const lastI = lastP ? lastP.y * N + lastP.x : -1;

        for (let i = 0; i < N * N; i++) {
          const c = board[i] || null;
          const cur = cells[i];
          if (cur && cur.c === c) continue;
          if (cur) { cur.st.remove(); cur.sh.remove(); cells[i] = null; }
          if (c) {
            place(i, c);
            if (fresh && i === lastI) drop(i);
          }
        }

        marks.replaceChildren();
        if (lastP && cells[lastI]) marks.append(svg('circle', { class: 'gk-last', cx: X(lastP.x), cy: Y(lastP.y), r: 3.6 }));
        for (const ar of arrows) {
          const p = parse(ar.iccs);
          if (p) marks.append(svg('circle', { class: 'gk-best', cx: X(p.x), cy: Y(p.y), r: R - 3 }));
        }

        threatsG.replaceChildren();
        if (!view.winLine?.length && moves.length >= 5) {
          const seen = new Set();
          for (const c of ['b', 'w']) {
            const { four, three } = threatsFor(board, c);
            for (const [set, cls] of [[four, 'four'], [three, 'three']]) for (const i of set) {
              if (seen.has(i)) continue;
              seen.add(i);
              threatsG.append(svg('circle', { class: `gk-threat ${cls}`, cx: X(i % N), cy: Y(Math.floor(i / N)), r: cls === 'four' ? R + 3 : R, fill: ref('threat') }));
            }
          }
        }

        drawWin(view, fresh);
      },
    };
  },

  moveList: (view) => (view.moves || []).map((m) => ({ seat: m.side, label: m.label })),
};
