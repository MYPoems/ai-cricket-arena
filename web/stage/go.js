// 围棋画面：榧木棋盘（木纹、漆框、厚度），四边坐标、星位；黑子哑光石、白子贝壳瓷光，带投影和立体高光。
// 顶上漆框里是双方提子数（真人行动时中间是「虚手」键）；落子轻落，被提的子原地淡出；最后一手一个小红点。
// 终局：每个点画归属小方块，死子半透明加叉，中间写结果。棋子按点增量更新，同一局面重画不会打断动画。
// 棋盘路数（9 / 13 / 19）来自 view.size，画面尺寸固定，路数变了整张重画：格距按「木面 − 四边坐标带」除以路数算，
// 边线外留半格放边上的子，再往外才是坐标，所以哪种路数棋子都不出木面、不压坐标。
// 真人：鼠标悬停预览子（禁着点画红叉、点了说原因，劫点常驻一个小方框），触屏先放预览子（带十字线），再点一下或按顶栏「落子」确认；
// 「虚手」要点两下（第二下才提交，对方刚虚手时写明「确认终局」）。顶栏右侧「手数」开关：棋子上写第几手。

const NS = 'http://www.w3.org/2000/svg';
const COLS = 'ABCDEFGHJKLMNOPQRST';
const W = 760; // 棋盘宽（含漆框）
const F = 20; // 漆框宽
// 手机竖屏上整张盘只有三百多像素宽：顶栏和坐标按比例放大（模块加载时定，画面比例随之固定）
const NARROW = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
const K = NARROW ? 1.5 : 1; // 顶栏字号、按键的放大倍数
const CB = NARROW ? 27 : 24; // 木面四边的坐标带宽
const HB = NARROW ? 86 : 58; // 顶上漆框：提子数、虚手键、结果
const HC = (HB + F) / 2; // 顶栏内容的中线
const T = 11; // 前沿厚度
const H = HB + W + T;

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
};
const stops = (...list) => list.map(([o, c, a = 1]) => svg('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }));

const GRAIN = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><filter id='g' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='0.0028 0.14' numOctaves='4' seed='23' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .36  0 0 0 0 .17  0 0 0 0 .04  0 0 0 1.5 -.62'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`)}`;
const FLECK = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='f' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='0.02 0.9' numOctaves='2' seed='7' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .42  0 0 0 0 .22  0 0 0 0 .06  0 0 0 1.4 -.66'/></filter><rect width='100%' height='100%' filter='url(#f)'/></svg>`)}`;

const CSS = `
svg.board.go-board .bg { stroke: none; }
svg.board.go-board .go-grid line { stroke: #4b230a; stroke-width: 1.15; stroke-opacity: .85; }
svg.board.go-board .go-grid .edge { stroke-width: 2.3; stroke-opacity: .9; fill: none; stroke: #4b230a; }
svg.board.go-board .go-grid .star { fill: #3b1a06; }
svg.board.go-board .go-coord { font: 600 13px/1 var(--num); fill: #5a2d0c; fill-opacity: .8; }
svg.board.go-board .go-coord .on { fill: #b3200f; fill-opacity: 1; font-weight: 700; }
svg.board.go-board .go-st, svg.board.go-board .go-mark, svg.board.go-board .go-terr, svg.board.go-board .go-fade { pointer-events: none; }
svg.board.go-board .go-last { fill: #e2523d; stroke: #fff1d6; stroke-width: 1.2; stroke-opacity: .7; }
svg.board.go-board .go-best { fill: none; stroke: #c42d1e; stroke-width: 2.4; stroke-dasharray: 4 4; }
svg.board.go-board .go-ghost { opacity: .5; pointer-events: none; }
svg.board.go-board .go-dead { opacity: .55; }
svg.board.go-board .go-dead-sh { opacity: .25; }
svg.board.go-board .go-x { stroke: #d2301f; stroke-linecap: round; fill: none; }
svg.board.go-board .go-n { font: 600 10px/1 var(--num); pointer-events: none; }
svg.board.go-board .go-n.b { fill: #f4ecdc; }
svg.board.go-board .go-n.w { fill: #1d1712; }
svg.board.go-board .go-n.b.last { fill: #ff8a70; }
svg.board.go-board .go-n.w.last { fill: #cf2a18; }
svg.board.go-board .go-ko { fill: none; stroke: #b3200f; stroke-width: 2; stroke-opacity: .8; pointer-events: none; }
svg.board.go-board .go-ban { stroke: #c42d1e; stroke-width: 3; stroke-linecap: round; fill: none; opacity: .75; pointer-events: none; }
svg.board.go-board .go-tip { pointer-events: none; }
svg.board.go-board .go-tip rect { fill: #2a0806; fill-opacity: .94; stroke: #e2b656; stroke-opacity: .7; stroke-width: 1; }
svg.board.go-board .go-tip text { font: 600 calc(14px * var(--k)) / 1 var(--sans, sans-serif); fill: #ffe9b8; letter-spacing: .06em; }
svg.board.go-board .go-myturn { fill: none; stroke: #f6d27a; stroke-width: 3; display: none; pointer-events: none; }
svg.board.go-board.can-move .go-myturn { display: inline; animation: go-myturn 1.8s ease-in-out infinite; }
svg.board.go-board .go-turn { fill: none; stroke: #f6d27a; stroke-width: 2; stroke-opacity: .95; }
svg.board.go-board .go-chip { cursor: pointer; }
svg.board.go-board .go-chip rect.f { fill: #1a0503; fill-opacity: .45; stroke: #d9b25e; stroke-opacity: .55; stroke-width: 1; }
svg.board.go-board .go-chip text { font: 600 calc(14px * var(--k)) / 1 var(--sans, sans-serif); fill: #e6c578; fill-opacity: .8; letter-spacing: .12em; pointer-events: none; }
svg.board.go-board .go-chip:hover rect.f { stroke-opacity: .95; }
svg.board.go-board .go-chip.on rect.f { fill: #e9c463; fill-opacity: 1; stroke: #fff3c8; }
svg.board.go-board .go-chip.on text { fill: #3a0d06; fill-opacity: 1; }
svg.board.go-board .go-chip:focus { outline: none; }
svg.board.go-board .go-chip:focus-visible rect.f { stroke: #fff; stroke-width: 2; stroke-opacity: 1; }
svg.board.go-board .go-terr.b { fill: #15110e; fill-opacity: .82; }
svg.board.go-board .go-terr.w { fill: #fbf8f0; fill-opacity: .9; stroke: #8f8166; stroke-width: .8; }
svg.board.go-board .go-cap { font: 600 calc(19px * var(--k)) / 1 var(--num); fill: #f6dfa8; letter-spacing: .04em; }
svg.board.go-board .go-cap-tag { font: 400 calc(17px * var(--k)) / 1 var(--brush, serif); fill: #e6c578; fill-opacity: .85; }
svg.board.go-board .go-status { font: 400 calc(21px * var(--k)) / 1 var(--brush, serif); fill: #f3d27e; letter-spacing: .14em; }
svg.board.go-board .go-status.note { font: 600 calc(15px * var(--k)) / 1 var(--sans, sans-serif); fill: #f6957f; letter-spacing: .1em; }
svg.board.go-board .go-btn { cursor: pointer; }
svg.board.go-board .go-btn rect.f { fill: #f0c966; stroke: #fff3c8; stroke-opacity: .6; stroke-width: 1; }
svg.board.go-board .go-btn:hover rect.f, svg.board.go-board .go-btn:focus-visible rect.f { fill: #fde6a2; }
svg.board.go-board .go-btn:focus { outline: none; }
svg.board.go-board .go-btn:focus-visible rect.f { stroke: #fff; stroke-width: 2; }
svg.board.go-board .go-btn text { font: 600 calc(17px * var(--k)) / 1 var(--sans, sans-serif); fill: #3a0d06; letter-spacing: .3em; pointer-events: none; }
svg.board.go-board .go-btn.armed rect.f { fill: #d8402c; stroke: #ffd9c8; }
svg.board.go-board .go-btn.armed:hover rect.f, svg.board.go-board .go-btn.armed:focus-visible rect.f { fill: #ec5a44; }
svg.board.go-board .go-btn.armed text { fill: #fff6e6; letter-spacing: .16em; }
svg.board.go-board .go-btn.confirm text { letter-spacing: .1em; }
svg.board.go-board.can-move .go-hit { cursor: pointer; }
svg.board.go-board .go-pre { pointer-events: none; }
svg.board.go-board .go-pre use { animation: go-pre 1.1s ease-in-out infinite; }
svg.board.go-board .go-pre line { stroke: #b3200f; stroke-width: 1.6; stroke-opacity: .7; }
svg.board.go-board .go-pre circle { fill: none; stroke: #f3d27e; stroke-width: 2.2; transform-box: fill-box; transform-origin: center; animation: go-pre-ring 1.1s ease-out infinite; }
@keyframes go-pre { 0%, 100% { opacity: .62; } 50% { opacity: .9; } }
@keyframes go-myturn { 0%, 100% { stroke-opacity: .15; } 50% { stroke-opacity: .75; } }
@keyframes go-pre-ring { from { transform: scale(.9); opacity: .9; } to { transform: scale(1.45); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { svg.board.go-board .go-pre use, svg.board.go-board .go-pre circle { animation: none; } svg.board.go-board.can-move .go-myturn { animation: none; stroke-opacity: .5; } }
@media (max-width: 640px) { svg.board.go-board .go-grid line { stroke-width: 1.7; } svg.board.go-board .go-grid .edge { stroke-width: 3; } svg.board.go-board .go-coord { fill-opacity: .9; } }
`;
let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.dataset.stage = 'go';
  st.textContent = CSS;
  document.head.append(st);
}

let seq = 0;

export default {
  aspect: [W, H],
  seatColor: (seat) => (seat === 'b' ? 'var(--black-side)' : '#8a857a'),

  createStage({ onAction }) {
    injectStyle();
    const id = `go${++seq}`;
    const ref = (n) => `url(#${id}-${n})`;
    const el = svg('svg', { class: 'board go-board', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '围棋棋盘', style: `--k: ${K}` });

    let N = 0, S = 0, R = 0, G0 = F + CB;
    const X = (x) => G0 + x * S;
    const Y = (y) => HB + G0 + (N - 1 - y) * S;
    const parse = (l) => {
      const m = /^([A-HJ-T])(\d{1,2})$/i.exec(l || '');
      if (!m) return null;
      const x = COLS.indexOf(m[1].toUpperCase()), y = Number(m[2]) - 1;
      return x < N && y >= 0 && y < N ? { x, y } : null;
    };
    const labelOf = (x, y) => `${COLS[x]}${y + 1}`;

    const defs = svg('defs');
    el.append(defs);
    // 固定的漆框、木面
    el.append(
      svg('rect', { x: 0, y: 14, width: W, height: H - 14, rx: 24, fill: ref('side') }),
      svg('rect', { x: 10, y: H - 3.2, width: W - 20, height: 1, fill: '#ffd8a8', 'fill-opacity': '.12' }),
      svg('rect', { class: 'bg', x: 0, y: 0, width: W, height: HB + W, rx: 24, fill: ref('lac') }),
      svg('rect', { x: 0, y: 0, width: W, height: HB + W, rx: 24, fill: ref('lacsheen') }),
      svg('rect', { x: 1.25, y: 1.25, width: W - 2.5, height: HB + W - 2.5, rx: 22.75, fill: 'none', stroke: ref('edge'), 'stroke-width': 2.5 }),
      svg('rect', { x: 6.5, y: 6.5, width: W - 13, height: HB + W - 13, rx: 17.5, fill: 'none', stroke: '#d9b25e', 'stroke-opacity': '.45', 'stroke-width': 1 }),
      svg('rect', { x: F, y: HB + F, width: W - 2 * F, height: W - 2 * F, rx: 4, fill: ref('wood') }),
      svg('g', { 'clip-path': ref('woodclip') },
        svg('image', { href: GRAIN, x: F, y: HB + F, width: W - 2 * F, height: W - 2 * F, preserveAspectRatio: 'none', opacity: '.3' }),
        svg('image', { href: FLECK, x: F, y: HB + F, width: W - 2 * F, height: W - 2 * F, preserveAspectRatio: 'none', opacity: '.35' }),
        svg('rect', { x: F, y: HB + F, width: W - 2 * F, height: W - 2 * F, fill: ref('woodlight') }),
        svg('rect', { x: F, y: HB + F, width: W - 2 * F, height: 9, fill: ref('inT') }),
        svg('rect', { x: F, y: HB + F, width: 7, height: W - 2 * F, fill: ref('inL') }),
        svg('rect', { x: F, y: HB + W - F - 1.5, width: W - 2 * F, height: 1.5, fill: '#fff4dc', 'fill-opacity': '.5' }),
        svg('rect', { x: W - F - 1.2, y: HB + F, width: 1.2, height: W - 2 * F, fill: '#fff4dc', 'fill-opacity': '.35' })),
      svg('rect', { x: F - 0.5, y: HB + F - 0.5, width: W - 2 * F + 1, height: W - 2 * F + 1, rx: 4.5, fill: 'none', stroke: '#1c0602', 'stroke-opacity': '.7', 'stroke-width': 1 }),
    );
    const grid = svg('g', { class: 'go-grid' });
    const coords = svg('g', { class: 'go-coord' });
    const terrG = svg('g');
    const shadows = svg('g');
    const stonesG = svg('g');
    const fadeG = svg('g');
    const numsG = svg('g');
    const marks = svg('g');
    const ghost = svg('use', { class: 'go-ghost', x: -200, y: -200 });
    const ban = svg('path', { class: 'go-ban', display: 'none' });
    const preH = svg('line'), preV = svg('line');
    const preStone = svg('use');
    const preRing = svg('circle');
    const pre = svg('g', { class: 'go-pre', display: 'none' }, preH, preV, preStone, preRing);
    // 轮到本人：木面四周一圈金光
    const myTurn = svg('rect', { class: 'go-myturn', x: F + 2, y: HB + F + 2, width: W - 2 * F - 4, height: W - 2 * F - 4, rx: 3 });
    // 顶栏：左黑右白的提子数，中间状态或虚手键，右侧手数开关
    const head = svg('g');
    const BW = 116 * K, BH = 34 * K;
    const btnText = svg('text', { x: W / 2, y: HC + 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    const btn = svg('g', { class: 'go-btn', role: 'button', tabindex: 0, display: 'none' },
      svg('rect', { x: W / 2 - BW / 2 - 12, y: 7, width: BW + 24, height: HB + F - 12, fill: 'transparent' }),
      svg('rect', { class: 'f', x: W / 2 - BW / 2, y: HC - BH / 2, width: BW, height: BH }),
      btnText);
    const CX = W / 2 + (NARROW ? 134 : 150), CW = (NARROW ? 46 : 56) * K, CH = 24 * K;
    const chipText = svg('text', { x: CX, y: HC + 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    chipText.textContent = '手数';
    const chip = svg('g', { class: 'go-chip', role: 'switch', tabindex: 0, 'aria-label': '显示手数', 'aria-checked': 'false' },
      svg('rect', { x: CX - CW / 2 - 6, y: 7, width: CW + 12, height: HB + F - 12, fill: 'transparent' }),
      svg('rect', { class: 'f', x: CX - CW / 2, y: HC - CH / 2, width: CW, height: CH, rx: CH / 2 }),
      chipText);
    const tipRect = svg('rect', { rx: 4 }), tipText = svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    const tip = svg('g', { class: 'go-tip', display: 'none' }, tipRect, tipText);
    const hit = svg('rect', { class: 'go-hit', x: F, y: HB + F, width: W - 2 * F, height: W - 2 * F, fill: 'transparent' });
    el.append(grid, coords, myTurn, terrG, shadows, stonesG, fadeG, numsG, marks, ghost, ban, pre, head, chip, btn, hit, tip);

    function buildDefs() {
      defs.replaceChildren(
        svg('linearGradient', { id: `${id}-lac`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#6a1d12'], ['.3', '#47110a'], ['1', '#220604'])),
        svg('radialGradient', { id: `${id}-lacsheen`, cx: '.14', cy: '-.02', r: '.5' }, ...stops(['0', '#ffd9a8', '.2'], ['.5', '#ffd9a8', '.05'], ['1', '#ffd9a8', '0'])),
        svg('linearGradient', { id: `${id}-side`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#3e0f09'], ['1', '#160403'])),
        svg('linearGradient', { id: `${id}-edge`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#fff3c8'], ['.07', '#ecc668'], ['.2', '#b08030'], ['.4', '#5e400f'], ['.54', '#46300a'], ['.68', '#7c5a1c'], ['.82', '#c79c44'], ['.91', '#efd28a'], ['1', '#8e6824'])),
        svg('linearGradient', { id: `${id}-wood`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#ecc283'], ['.45', '#dcaa66'], ['1', '#c58f4e'])),
        svg('radialGradient', { id: `${id}-woodlight`, cx: '.2', cy: '.08', r: '.85' }, ...stops(['0', '#fff6e0', '.42'], ['.55', '#fff6e0', '.08'], ['1', '#fff6e0', '0'])),
        svg('linearGradient', { id: `${id}-inT`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#2a0c02', '.5'], ['1', '#2a0c02', '0'])),
        svg('linearGradient', { id: `${id}-inL`, x1: 0, y1: 0, x2: 1, y2: 0 }, ...stops(['0', '#2a0c02', '.36'], ['1', '#2a0c02', '0'])),
        svg('clipPath', { id: `${id}-woodclip` }, svg('rect', { x: F, y: HB + F, width: W - 2 * F, height: W - 2 * F, rx: 4 })),
        svg('radialGradient', { id: `${id}-b`, cx: '.4', cy: '.36', r: '.68', fx: '.34', fy: '.27' }, ...stops(['0', '#68625c'], ['.3', '#34302d'], ['.72', '#141211'], ['.93', '#0a0908'], ['1', '#3a2a1c'])),
        svg('radialGradient', { id: `${id}-bs`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#ffffff', '.2'], ['1', '#ffffff', '0'])),
        svg('radialGradient', { id: `${id}-w`, cx: '.42', cy: '.38', r: '.7', fx: '.36', fy: '.3' }, ...stops(['0', '#ffffff'], ['.42', '#fbf8f0'], ['.8', '#e7e0cf'], ['.95', '#c9bea4'], ['1', '#a99a7c'])),
        svg('radialGradient', { id: `${id}-ws`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#ffffff', '.95'], ['.6', '#ffffff', '.35'], ['1', '#ffffff', '0'])),
        svg('radialGradient', { id: `${id}-sh`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#1a0800', '.7'], ['.72', '#1a0800', '.5'], ['.86', '#1a0800', '.2'], ['1', '#1a0800', '0'])),
        svg('g', { id: `${id}-sb` },
          svg('circle', { r: R, fill: ref('b') }),
          svg('ellipse', { cx: -R * 0.3, cy: -R * 0.38, rx: R * 0.5, ry: R * 0.36, fill: ref('bs'), transform: `rotate(-28 ${-R * 0.3} ${-R * 0.38})` })),
        svg('g', { id: `${id}-sw` },
          svg('circle', { r: R, fill: ref('w') }),
          svg('ellipse', { cx: -R * 0.32, cy: -R * 0.42, rx: R * 0.36, ry: R * 0.22, fill: ref('ws'), transform: `rotate(-30 ${-R * 0.32} ${-R * 0.42})` }),
          svg('circle', { r: R - 0.4, fill: 'none', stroke: '#8f8166', 'stroke-width': '.8', 'stroke-opacity': '.45' })),
        svg('circle', { id: `${id}-ss`, r: R + 2.5, fill: ref('sh') }),
        // 顶栏上的小棋子（大小固定）
        svg('g', { id: `${id}-ib` }, svg('circle', { r: 13 * K, fill: ref('b') }), svg('ellipse', { cx: -4 * K, cy: -5 * K, rx: 6.5 * K, ry: 4.5 * K, fill: ref('bs') })),
        svg('g', { id: `${id}-iw` }, svg('circle', { r: 13 * K, fill: ref('w') }), svg('ellipse', { cx: -4 * K, cy: -5 * K, rx: 5 * K, ry: 3 * K, fill: ref('ws') })),
      );
    }

    /** 路数变了：重建网格、坐标、棋子模板 */
    function setup(size) {
      // 木面去掉四边坐标带后平分成 N 格：边线外正好留半格
      N = size; S = (W - 2 * F - 2 * CB) / N; R = S * 0.47; G0 = F + CB + S / 2;
      buildDefs();
      grid.replaceChildren();
      for (let i = 0; i < N; i++) {
        grid.append(svg('line', { x1: X(0), y1: Y(i), x2: X(N - 1), y2: Y(i) }));
        grid.append(svg('line', { x1: X(i), y1: Y(0), x2: X(i), y2: Y(N - 1) }));
      }
      grid.append(svg('rect', { class: 'edge', x: X(0), y: Y(N - 1), width: S * (N - 1), height: S * (N - 1) }));
      coords.replaceChildren();
      coords.setAttribute('style', `font-size: ${NARROW ? (N > 13 ? 19 : 21) : N <= 9 ? 17 : N <= 13 ? 15.5 : 14}px`);
      const off = S / 2 + CB / 2 - 1; // 坐标在边上的子外面
      colT = []; rowT = [];
      for (let i = 0; i < N; i++) {
        colT[i] = []; rowT[i] = [];
        for (const [x, y] of [[X(i), Y(0) + off], [X(i), Y(N - 1) - off], [X(0) - off, Y(i)], [X(N - 1) + off, Y(i)]]) {
          const t = svg('text', { x, y: y + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
          const row = y === Y(i);
          t.textContent = row ? String(i + 1) : COLS[i];
          (row ? rowT : colT)[i].push(t);
          coords.append(t);
        }
      }
      hot = null;
      for (const c of cells) if (c) { c.st.remove(); c.sh.remove(); }
      cells = new Array(N * N).fill(null);
      shownMoves = null;
      fadeG.replaceChildren();
      ghost.setAttribute('href', `#${id}-sb`);
      preRing.setAttribute('r', R + 2);
      const d = R * 0.36;
      ban.setAttribute('d', `M ${-d} ${-d} L ${d} ${d} M ${d} ${-d} L ${-d} ${d}`);
      ban.setAttribute('display', 'none');
      showPre(null);
      hideTip();
    }

    // ---------- 交互 ----------
    let board = [];
    let movable = null;
    let legal = null; // 真人可以落子的点（Set，来自 actions）；null 表示只看空点
    let preAt = null; // 触屏上第一下点的位置，再点同一点或按顶栏「落子」才提交
    let colT = [], rowT = [], hot = null;
    let lastView = null;
    let lastPass = null;
    let armed = false, armTimer = 0; // 「虚手」点过一下，等第二下
    let showNums = false;
    try { showNums = localStorage.getItem('go.nums') === '1'; } catch { /* 存不了就不记 */ }
    const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    const twoStep = (evt) => !!coarse?.matches || evt.pointerType === 'touch' || evt.pointerType === 'pen';
    const canPlay = (p) => p && !board[p.y * N + p.x] && (!legal || legal.has(labelOf(p.x, p.y)));

    /** 悬停、预览的那个点：四边对应的坐标变红 */
    const setHot = (p) => {
      if (hot && p && hot.x === p.x && hot.y === p.y) return;
      if (hot) for (const t of [...(colT[hot.x] || []), ...(rowT[hot.y] || [])]) t.classList.remove('on');
      hot = p ? { x: p.x, y: p.y } : null;
      if (hot) for (const t of [...colT[hot.x], ...rowT[hot.y]]) t.classList.add('on');
    };
    const syncBtn = () => {
      if (!movable) { btn.setAttribute('display', 'none'); return; }
      btn.removeAttribute('display');
      const mode = preAt ? 'confirm' : armed ? 'armed' : 'pass';
      btn.setAttribute('class', `go-btn ${mode}`);
      const label = preAt ? `落子 ${labelOf(preAt.x, preAt.y)}` : armed ? (lastPass ? '确认终局' : '确认虚手') : '虚手';
      btnText.textContent = label;
      btn.setAttribute('aria-label', label);
    };
    const disarm = () => { clearTimeout(armTimer); if (armed) { armed = false; syncBtn(); } };
    const showPre = (p) => {
      preAt = p;
      if (!p) { pre.setAttribute('display', 'none'); syncBtn(); return; }
      const x = X(p.x), y = Y(p.y);
      preStone.setAttribute('href', `#${id}-s${movable}`);
      preStone.setAttribute('x', x); preStone.setAttribute('y', y);
      preRing.setAttribute('cx', x); preRing.setAttribute('cy', y);
      for (const [l, a] of [[preH, { x1: X(0), y1: y, x2: X(N - 1), y2: y }], [preV, { x1: x, y1: Y(0), x2: x, y2: Y(N - 1) }]]) for (const k in a) l.setAttribute(k, a[k]);
      pre.removeAttribute('display');
      armed = false; clearTimeout(armTimer);
      setHot(p);
      syncBtn();
    };
    const pointAt = (evt) => {
      const ctm = el.getScreenCTM();
      if (!ctm || !N) return null;
      const pt = el.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      const x = Math.round((p.x - G0) / S), y = N - 1 - Math.round((p.y - HB - G0) / S);
      return x >= 0 && x < N && y >= 0 && y < N ? { x, y } : null;
    };
    const hideGhost = () => { ghost.setAttribute('x', -200); ghost.setAttribute('y', -200); ban.setAttribute('display', 'none'); hit.style.cursor = ''; };

    // 禁着点的原因：落下去不提子又没有气是自杀，其余（能提子却不让下）是同形再现
    const nbrs = (i) => {
      const x = i % N, y = (i - x) / N, o = [];
      if (x > 0) o.push(i - 1);
      if (x < N - 1) o.push(i + 1);
      if (y > 0) o.push(i - N);
      if (y < N - 1) o.push(i + N);
      return o;
    };
    const hasLib = (bd, i) => {
      const seen = new Set([i]), todo = [i];
      while (todo.length) {
        for (const n of nbrs(todo.pop())) {
          if (!bd[n]) return true;
          if (bd[n] === bd[i] && !seen.has(n)) { seen.add(n); todo.push(n); }
        }
      }
      return false;
    };
    const banKind = (i, c) => {
      const bd = board.slice();
      bd[i] = c;
      const takes = nbrs(i).some((n) => bd[n] && bd[n] !== c && !hasLib(bd, n));
      return !takes && !hasLib(bd, i) ? 'suicide' : 'ko';
    };
    const banned = (p) => !!(p && movable && legal && !board[p.y * N + p.x] && !legal.has(labelOf(p.x, p.y)));

    let tipTimer = 0;
    function hideTip() { clearTimeout(tipTimer); tip.setAttribute('display', 'none'); }
    function showTip(p, msg) {
      const fs = 14 * K, w = msg.length * fs * 1.08 + 26, h = fs + 18;
      const cx = Math.min(W - F - w / 2 - 4, Math.max(F + w / 2 + 4, X(p.x)));
      let cy = Y(p.y) - R - h / 2 - 8;
      if (cy - h / 2 < HB + F + 4) cy = Y(p.y) + R + h / 2 + 8;
      for (const [k, v] of Object.entries({ x: cx - w / 2, y: cy - h / 2, width: w, height: h })) tipRect.setAttribute(k, v);
      tipText.setAttribute('x', cx); tipText.setAttribute('y', cy + 1);
      tipText.textContent = msg;
      tip.removeAttribute('display');
      tip.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 2200);
    }
    const showBan = (p) => {
      ban.setAttribute('transform', `translate(${X(p.x)} ${Y(p.y)})`);
      ban.removeAttribute('display');
    };

    hit.addEventListener('pointermove', (evt) => {
      if (evt.pointerType !== 'mouse') return; // 手指划过不画悬停子，触屏用预览子
      const p = pointAt(evt);
      if (!preAt) setHot(p);
      if (!movable) return;
      if (canPlay(p)) {
        ban.setAttribute('display', 'none');
        hit.style.cursor = '';
        ghost.setAttribute('href', `#${id}-s${movable}`);
        ghost.setAttribute('x', X(p.x)); ghost.setAttribute('y', Y(p.y));
      } else {
        hideGhost();
        if (p) hit.style.cursor = 'not-allowed';
        if (banned(p)) showBan(p);
      }
    });
    hit.addEventListener('pointerleave', () => { hideGhost(); if (!preAt) setHot(null); });
    hit.addEventListener('click', (evt) => {
      if (!movable) return;
      disarm();
      const p = pointAt(evt);
      if (!canPlay(p)) {
        // 点在别处：收起预览子；点在禁着点上：说原因
        hideGhost();
        showPre(null);
        if (banned(p)) {
          showBan(p);
          showTip(p, banKind(p.y * N + p.x, movable) === 'suicide' ? '这里没有气，不能下' : '打劫：要先在别处下一手');
        }
        return;
      }
      hideTip();
      if (twoStep(evt) && !(preAt && preAt.x === p.x && preAt.y === p.y)) { hideGhost(); showPre(p); return; }
      hideGhost();
      showPre(null);
      onAction(labelOf(p.x, p.y));
    });

    // 中间的键：平时是「虚手」（点两下才提交，虚手两次就终局）；触屏放了预览子时变成「落子 D4」
    const press = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!movable) return;
      hideGhost(); hideTip();
      if (preAt) { const p = preAt; showPre(null); onAction(labelOf(p.x, p.y)); return; }
      if (!armed) {
        armed = true;
        clearTimeout(armTimer);
        armTimer = setTimeout(disarm, 4000);
        syncBtn();
        return;
      }
      disarm();
      onAction('pass');
    };
    btn.addEventListener('click', press);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') press(e); else if (e.key === 'Escape') disarm(); });
    btn.addEventListener('blur', disarm);

    const syncChip = () => { chip.classList.toggle('on', showNums); chip.setAttribute('aria-checked', String(showNums)); };
    const toggleNums = (e) => {
      e.preventDefault(); e.stopPropagation();
      showNums = !showNums;
      try { localStorage.setItem('go.nums', showNums ? '1' : '0'); } catch { /* 存不了就不记 */ }
      syncChip();
      if (lastView) drawMarks(lastView, lastArrows);
    };
    chip.addEventListener('click', toggleNums);
    chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggleNums(e); });
    syncChip();

    // ---------- 增量画子 ----------
    let cells = [];
    let shownMoves = null;

    function place(i, c) {
      const x = i % N, y = Math.floor(i / N);
      const sh = svg('use', { href: `#${id}-ss`, x: X(x) + R * 0.12, y: Y(y) + R * 0.2 });
      const st = svg('use', { class: `go-st ${c}`, href: `#${id}-s${c}`, x: X(x), y: Y(y) });
      shadows.append(sh);
      stonesG.append(st);
      cells[i] = { c, st, sh };
    }
    function drop(i) {
      const cell = cells[i];
      if (!cell?.st.animate) return;
      const o = { transformOrigin: `${X(i % N)}px ${Y(Math.floor(i / N))}px` };
      cell.st.animate([
        { ...o, transform: 'translate(-2px, -14px) scale(1.14)', opacity: 0 },
        { ...o, transform: 'translate(-1px, -4px) scale(1.05)', opacity: 1, offset: 0.55 },
        { ...o, transform: 'translate(0, 0) scale(.98)', offset: 0.85 },
        { ...o, transform: 'translate(0, 0) scale(1)' },
      ], { duration: 280, easing: 'cubic-bezier(.4, 0, .7, 1)' });
      cell.sh.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280 });
    }
    /** 被提的子：在原处留一颗，淡出后移除 */
    function fadeOut(x, y, c, delay) {
      const st = svg('use', { class: 'go-fade', href: `#${id}-s${c}`, x: X(x), y: Y(y) });
      fadeG.append(st);
      if (!st.animate) { st.remove(); return; }
      const o = { transformOrigin: `${X(x)}px ${Y(y)}px` };
      const a = st.animate([{ ...o, opacity: 1, transform: 'scale(1)' }, { ...o, opacity: 0.85, transform: 'scale(1.06) translateY(-3px)', offset: 0.3 }, { ...o, opacity: 0, transform: 'scale(.8) translateY(-10px)' }], { duration: 560, delay, easing: 'ease-in', fill: 'both' });
      a.onfinish = () => st.remove();
      setTimeout(() => st.remove(), delay + 900);
    }

    function stoneIcon(c, x, y) { return svg('use', { href: `#${id}-i${c}`, x, y }); }
    function text(cls, x, y, s, anchor = 'middle') {
      const t = svg('text', { class: cls, x, y, 'text-anchor': anchor, 'dominant-baseline': 'central' });
      t.textContent = s;
      return t;
    }

    function drawHead(view, mv) {
      head.replaceChildren();
      const cy = HC;
      // 进行中：双方提子数；终局：双方数子（白方含贴目）
      const caps = view.caps || { b: 0, w: 0 };
      const fin = view.final;
      const tag = fin ? '' : '提';
      // 手机上顶栏放不下：终局的子数不带「子」字、字号收一档
      const unit = NARROW ? '' : ' 子';
      const nb = fin ? `${fin.b}${unit}` : String(caps.b);
      const nw = fin ? `${fin.w}+${fmtNum(fin.komi)}${unit}` : String(caps.w);
      const ix = 33 + 13 * K, tx = ix + 13 * K + 9, nx = fin ? tx : tx + 15 * K + 6;
      head.append(
        stoneIcon('b', ix, cy), text('go-cap-tag', tx, cy + 1, tag, 'start'), text('go-cap', nx, cy + 1, nb, 'start'),
        stoneIcon('w', W - ix, cy), text('go-cap-tag', W - tx, cy + 1, tag, 'end'), text('go-cap', W - nx, cy + 1, nw, 'end'),
      );
      if (fin && NARROW) for (const t of head.querySelectorAll('.go-cap')) t.setAttribute('style', 'font-size: 24px');
      // 轮到谁：那一方的小棋子外面一圈金线
      if (!view.over && (view.side === 'b' || view.side === 'w')) head.append(svg('circle', { class: 'go-turn', cx: view.side === 'b' ? ix : W - ix, cy, r: 13 * K + 3.5 }));
      const passNote = view.lastPass ? `${view.lastPass === 'b' ? '黑方' : '白方'}虚手` : '';
      if (mv) {
        // 中间是虚手键，对方刚虚手的提示挪到键的左边
        if (passNote) head.append(text('go-status note', (tx + 15 * K + 30 + W / 2 - BW / 2) / 2, cy + 1, passNote));
        return;
      }
      const f = view.final;
      if (f) {
        const m = f.margin;
        // 结果文字和规则模块一致（「黑胜 1.5 目」）
        const t = text('go-status', W / 2, cy + 1, f.result || (m === 0 ? '和棋' : `${m > 0 ? '黑' : '白'}胜 ${fmtNum(Math.abs(m))} 目`));
        if (NARROW) t.setAttribute('style', 'font-size: 25px; letter-spacing: .06em');
        t.append(svg('title', {}, `黑 ${f.b} 子，白 ${f.w} 子 + 贴 ${fmtNum(f.komi)}`));
        head.append(t);
      } else if (view.resigned) {
        head.append(text('go-status', W / 2, cy + 1, `${view.resigned === 'b' ? '黑' : '白'}方认输`));
      } else if (passNote) {
        head.append(text('go-status note', W / 2, cy + 1, passNote));
      }
    }

    /** 棋子上面的标记：死子叉、手数或最后一手红点、劫点、引擎推荐点 */
    let lastArrows = [];
    function drawMarks(view, arrows) {
      lastArrows = arrows;
      const moves = view.moves || [];
      const dead = new Set(view.final?.dead || []);
      const lastP = parse(view.lastMove);
      const lastI = lastP ? lastP.y * N + lastP.x : -1;
      marks.replaceChildren();
      numsG.replaceChildren();
      for (const l of dead) {
        const p = parse(l);
        if (!p) continue;
        const d = R * 0.36;
        marks.append(svg('path', { class: 'go-x', 'stroke-width': Math.max(2.2, R * 0.13), d: `M ${X(p.x) - d} ${Y(p.y) - d} L ${X(p.x) + d} ${Y(p.y) + d} M ${X(p.x) + d} ${Y(p.y) - d} L ${X(p.x) - d} ${Y(p.y) + d}` }));
      }
      if (showNums) {
        // 每个点上现在这颗子是第几手下的（提掉又下回来的取后一次）
        const at = new Map();
        moves.forEach((m, k) => { const p = parse(m.label); if (p) at.set(p.y * N + p.x, k + 1); });
        for (const [i, n] of at) {
          const c = board[i];
          if (!c || dead.has(labelOf(i % N, Math.floor(i / N)))) continue;
          const t = text(`go-n ${c}${i === lastI && !view.final ? ' last' : ''}`, X(i % N), Y(Math.floor(i / N)) + R * 0.05, String(n));
          t.setAttribute('style', `font-size: ${(R * (n < 10 ? 1.05 : n < 100 ? 0.98 : 0.78)).toFixed(1)}px`);
          numsG.append(t);
        }
      } else if (lastP && cells[lastI] && !view.final) {
        marks.append(svg('circle', { class: 'go-last', cx: X(lastP.x), cy: Y(lastP.y), r: Math.max(3, R * 0.22) }));
      }
      // 劫点：view.ko（观众、回放也看得到）；老记录没有这个字段时，轮到本人才自己算
      if (Array.isArray(view.ko) && !view.final) {
        const q = Math.max(4, R * 0.3);
        for (const k of view.ko) {
          const p = parse(k);
          if (p && !board[p.y * N + p.x]) marks.append(svg('rect', { class: 'go-ko', x: X(p.x) - q, y: Y(p.y) - q, width: 2 * q, height: 2 * q }));
        }
      } else if (movable && legal) {
        const q = Math.max(4, R * 0.3);
        for (let i = 0; i < N * N; i++) {
          if (board[i] || legal.has(labelOf(i % N, Math.floor(i / N))) || banKind(i, movable) !== 'ko') continue;
          marks.append(svg('rect', { class: 'go-ko', x: X(i % N) - q, y: Y(Math.floor(i / N)) - q, width: 2 * q, height: 2 * q }));
        }
      }
      for (const ar of arrows) {
        const p = parse(ar.iccs);
        if (p) marks.append(svg('circle', { class: 'go-best', cx: X(p.x), cy: Y(p.y), r: R * 0.8 }));
      }
    }

    function drawFinal(view) {
      terrG.replaceChildren();
      const f = view.final;
      if (!f) return;
      const q = S * 0.3;
      for (let i = 0; i < N * N; i++) {
        const o = f.owner[i];
        const x = i % N, y = Math.floor(i / N);
        if (o && !board[i]) terrG.append(svg('rect', { class: `go-terr ${o}`, x: X(x) - q / 2, y: Y(y) - q / 2, width: q, height: q }));
      }
    }

    return {
      el,
      render(view, { movable: mv = null, actions = null, arrows = [], animate = true } = {}) {
        if (!view?.size) return;
        if (view.size !== N) setup(view.size);
        board = view.board || [];
        movable = mv;
        legal = mv && Array.isArray(actions) ? new Set(actions.map((a) => a.id)) : null;
        lastView = view;
        lastPass = view.lastPass || null;
        el.classList.toggle('can-move', !!mv);
        el.setAttribute('role', mv ? 'group' : 'img');
        const moves = view.moves || [];
        const moved = shownMoves !== moves.length;
        if (!mv || moved) { hideGhost(); hideTip(); disarm(); }
        if (preAt && !(mv && canPlay(preAt))) showPre(null);
        if (!preAt && moved) setHot(null);
        syncBtn();

        const fresh = animate && shownMoves !== null && moves.length === shownMoves + 1;
        if (!fresh && moved) fadeG.replaceChildren(); // 跳着看（拖进度条）时不留上一个局面的淡出子
        shownMoves = moves.length;
        const lastP = parse(view.lastMove);
        const lastI = lastP ? lastP.y * N + lastP.x : -1;
        const capturedSet = fresh ? new Set(view.captured || []) : new Set();
        const dead = new Set(view.final?.dead || []);

        for (let i = 0; i < N * N; i++) {
          const c = board[i] || null;
          const cur = cells[i];
          if (cur && cur.c === c) {
            const d = dead.has(labelOf(i % N, Math.floor(i / N)));
            cur.st.classList.toggle('go-dead', d);
            cur.sh.classList.toggle('go-dead-sh', d);
            continue;
          }
          if (cur) {
            cur.st.remove(); cur.sh.remove(); cells[i] = null;
            const x = i % N, y = Math.floor(i / N);
            if (!c && capturedSet.has(labelOf(x, y))) fadeOut(x, y, cur.c, 180);
          }
          if (c) {
            place(i, c);
            if (dead.has(labelOf(i % N, Math.floor(i / N)))) { cells[i].st.classList.add('go-dead'); cells[i].sh.classList.add('go-dead-sh'); }
            if (fresh && i === lastI) drop(i);
          }
        }

        drawMarks(view, arrows);
        if (!grid.querySelector('.star') || grid.dataset.n !== String(N)) {
          for (const s of grid.querySelectorAll('.star')) s.remove();
          for (const l of view.stars || []) {
            const p = parse(l);
            if (p) grid.append(svg('circle', { class: 'star', cx: X(p.x), cy: Y(p.y), r: Math.max(3.2, S * 0.065) }));
          }
          grid.dataset.n = String(N);
        }
        drawFinal(view);
        drawHead(view, mv);
      },
    };
  },

  moveList: (view) => (view.moves || []).map((m) => ({ seat: m.side, label: m.label })),
};

function fmtNum(x) {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}
