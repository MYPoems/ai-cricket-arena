// 四子棋画面：立起来的漆木框架（有厚度，孔边倒角），圆孔透光；朱、金两色立体棋子。
// 落子从顶上加速掉下、回弹两次；连成四子时四颗发光、金线划过，其余棋子变暗。
// 玩家本人下时：悬停某列整列淡亮，顶上显示预览子，孔里虚线圈出会落到的位置。

const NS = 'http://www.w3.org/2000/svg';
const COLS = 7;
const ROWS = 6;
const S = 66; // 孔距
const PX = 12; // 框比底座窄的那一截
const F = 22; // 框的左右边
const PV = 16; // 框的上下边
const TOP = 76; // 框上方：预览子、最佳着法
const HR = 26.5; // 孔半径
const SR = 25; // 棋子半径
const W = PX * 2 + F * 2 + S * COLS;
const FY0 = TOP; // 框顶
const FY1 = TOP + PV * 2 + S * ROWS; // 框底
const BASE = 34; // 底座
const H = FY1 + BASE + 8;
const PY = TOP / 2 + 2; // 预览子的高度
const CX = (c) => PX + F + c * S + S / 2;
const CY = (r) => TOP + PV + (ROWS - 1 - r) * S + S / 2;

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
};
const stops = (...list) => list.map(([o, c, a = 1]) => svg('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }));

const CSS = `
svg.board.connect4 .c4-st { pointer-events: none; transition: opacity .5s, filter .5s; }
svg.board.connect4 .c4-veil { fill: #120302; opacity: 0; transition: opacity .6s .3s; pointer-events: none; }
svg.board.connect4.won .c4-veil { opacity: .16; }
/* 终局：没连上的子退后一步（半透明、去点饱和），不再压成一片黑 */
svg.board.connect4.won .c4-st:not(.win) { opacity: .55; filter: saturate(.7); }
svg.board.connect4 .c4-num { font: 600 15px/1 var(--num); fill: #e6c578; fill-opacity: .7; }
svg.board.connect4 .c4-last { fill: #fff3d8; fill-opacity: .9; stroke: #3a0d06; stroke-opacity: .45; stroke-width: 1; pointer-events: none; }
svg.board.connect4 .c4-best { fill: none; stroke: #f3d27e; stroke-width: 2.4; stroke-dasharray: 4 4; pointer-events: none; }
svg.board.connect4 .c4-ghost { opacity: .55; pointer-events: none; }
svg.board.connect4 .c4-land { fill: none; stroke: #fff0c0; stroke-width: 2; stroke-dasharray: 5 5; opacity: .8; pointer-events: none; animation: c4-spin 6s linear infinite; transform-box: fill-box; transform-origin: center; }
@keyframes c4-spin { to { transform: rotate(360deg); } }
svg.board.connect4 .c4-col { fill: #ffe6a8; opacity: 0; pointer-events: none; transition: opacity .15s; }
svg.board.connect4 .c4-col.on { opacity: .16; }
svg.board.connect4 .c4-hit.on { cursor: pointer; }
/* 触屏两步落子：第一下选中一列（预览子轻轻呼吸），再点同一列才投下 */
svg.board.connect4.pre .c4-ghost { animation: c4-pre 1.1s ease-in-out infinite; }
svg.board.connect4.pre .c4-col.on { opacity: .24; }
@keyframes c4-pre { 0%, 100% { opacity: .5; } 50% { opacity: .9; } }
@media (prefers-reduced-motion: reduce) { svg.board.connect4.pre .c4-ghost { animation: none; } }
svg.board.connect4 .c4-win-glow { stroke: #f3d27e; stroke-opacity: .28; stroke-width: 18; stroke-linecap: round; fill: none; }
svg.board.connect4 .c4-win-line { stroke: #fff3cf; stroke-width: 5; stroke-linecap: round; fill: none; }
svg.board.connect4 .c4-halo { pointer-events: none; animation: c4-halo 1.8s ease-in-out infinite; }
@keyframes c4-halo { 0%, 100% { opacity: .75; } 50% { opacity: 1; } }
`;
let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.dataset.stage = 'connect4';
  st.textContent = CSS;
  document.head.append(st);
}

let seq = 0;

/** 框面：外圆角矩形挖掉 42 个圆孔（evenodd） */
function framePath() {
  const x0 = PX, y0 = FY0, x1 = W - PX, y1 = FY1, r = 16;
  let d = `M ${x0 + r} ${y0} H ${x1 - r} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} V ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} H ${x0 + r} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} V ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`;
  for (let c = 0; c < COLS; c++) for (let rr = 0; rr < ROWS; rr++) {
    const cx = CX(c), cy = CY(rr);
    d += ` M ${cx - HR} ${cy} A ${HR} ${HR} 0 1 0 ${cx + HR} ${cy} A ${HR} ${HR} 0 1 0 ${cx - HR} ${cy} Z`;
  }
  return d;
}

export default {
  aspect: [W, H],
  seatColor: (seat) => (seat === 'r' ? 'var(--zhu-2)' : 'var(--gold-2)'),

  createStage({ onAction }) {
    injectStyle();
    const id = `c4${++seq}`;
    const ref = (n) => `url(#${id}-${n})`;
    const el = svg('svg', { class: 'board connect4', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '四子棋棋盘' });

    const defs = svg('defs', {},
      svg('linearGradient', { id: `${id}-lac`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#5a170e'], ['.3', '#3c0f09'], ['1', '#1c0504'])),
      svg('radialGradient', { id: `${id}-lacsheen`, cx: '.12', cy: '-.04', r: '.55' }, ...stops(['0', '#ffd9a8', '.22'], ['.5', '#ffd9a8', '.05'], ['1', '#ffd9a8', '0'])),
      svg('linearGradient', { id: `${id}-edge`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#fff3c8'], ['.07', '#ecc668'], ['.2', '#b08030'], ['.4', '#5e400f'], ['.54', '#46300a'], ['.68', '#7c5a1c'], ['.82', '#c79c44'], ['.91', '#efd28a'], ['1', '#8e6824'])),
      // 孔后的光：中间暖、四周暗
      svg('radialGradient', { id: `${id}-back`, cx: '.45', cy: '.4', r: '.75' }, ...stops(['0', '#fff0c8', '.78'], ['.45', '#f0b46a', '.42'], ['.8', '#8a3a1a', '.55'], ['1', '#3a1208', '.9'])),
      // 孔的倒角：光从左上来，左上内壁背光、右下内壁受光
      svg('linearGradient', { id: `${id}-bevel`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#0a0201'], ['.45', '#2a0a05'], ['.7', '#9a6a2a'], ['1', '#f3d27e'])),
      svg('radialGradient', { id: `${id}-shade`, cx: '.5', cy: '.5', r: '.5', fx: '.62', fy: '.68' }, ...stops(['0', '#000', '0'], ['.72', '#000', '0'], ['.9', '#0a0201', '.35'], ['1', '#0a0201', '.75'])),
      svg('linearGradient', { id: `${id}-baseTop`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#8a3a22'], ['1', '#5a1c10'])),
      svg('linearGradient', { id: `${id}-baseFace`, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops(['0', '#3a0e08'], ['1', '#160403'])),
      // 朱子、金子
      svg('radialGradient', { id: `${id}-r`, cx: '.4', cy: '.35', r: '.72', fx: '.34', fy: '.27' }, ...stops(['0', '#ff9f86'], ['.3', '#ea4a32'], ['.7', '#b52a1a'], ['1', '#5e0f08'])),
      svg('radialGradient', { id: `${id}-b`, cx: '.4', cy: '.35', r: '.72', fx: '.34', fy: '.27' }, ...stops(['0', '#fff6cf'], ['.3', '#f2cf72'], ['.7', '#c3923a'], ['1', '#5e3e0c'])),
      svg('linearGradient', { id: `${id}-rimr`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#5a0c06', '.55'], ['1', '#ffb7a2', '.5'])),
      svg('linearGradient', { id: `${id}-rimb`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#6a4208', '.55'], ['1', '#fff4cf', '.6'])),
      svg('radialGradient', { id: `${id}-spec`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#ffffff', '.8'], ['1', '#ffffff', '0'])),
      svg('radialGradient', { id: `${id}-halo`, cx: '.5', cy: '.5', r: '.5' }, ...stops(['0', '#fff6d8', '0'], ['.5', '#fff6d8', '0'], ['.62', '#fff0c0', '.85'], ['.78', '#f3d27e', '.45'], ['1', '#e0b454', '0'])),
    );
    // 棋子：本体 + 一圈压出来的凹槽 + 高光
    const stone = (c) => svg('g', { id: `${id}-s${c}` },
      svg('circle', { r: SR, fill: ref(c) }),
      svg('circle', { r: SR * 0.66, fill: 'none', stroke: ref(`rim${c}`), 'stroke-width': 2.4 }),
      svg('ellipse', { cx: -SR * 0.36, cy: -SR * 0.44, rx: SR * 0.38, ry: SR * 0.22, fill: ref('spec'), transform: `rotate(-32 ${-SR * 0.36} ${-SR * 0.44})` }));
    defs.append(stone('r'), stone('b'));
    el.append(defs);

    // ---------- 底座、透光背板、棋子、框面 ----------
    const base = svg('g', {},
      svg('rect', { x: 0, y: FY1 - 6, width: W, height: 14, rx: 6, fill: ref('baseTop') }),
      svg('rect', { x: 0, y: FY1 + 6, width: W, height: BASE - 4, rx: 8, fill: ref('baseFace') }),
      svg('rect', { x: 0.75, y: FY1 + 6.75, width: W - 1.5, height: BASE - 5.5, rx: 7.25, fill: 'none', stroke: ref('edge'), 'stroke-width': 1.5 }),
      svg('rect', { x: 8, y: FY1 + 7.5, width: W - 16, height: 1, fill: '#ffe2b0', 'fill-opacity': '.3' }));
    const nums = svg('g', { class: 'c4-num' });
    for (let c = 0; c < COLS; c++) {
      nums.append(svg('text', { x: CX(c), y: FY1 + 6 + (BASE - 4) / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' }));
      nums.lastChild.textContent = String(c + 1);
    }
    const back = svg('rect', { x: PX + 6, y: FY0 + 6, width: W - 2 * PX - 12, height: FY1 - FY0 - 12, fill: ref('back') });
    const stonesG = svg('g');
    const veil = svg('rect', { class: 'c4-veil', x: PX, y: FY0, width: W - 2 * PX, height: FY1 - FY0 });
    const stonesWin = svg('g');
    const fp = framePath();
    const frame = svg('g', { 'pointer-events': 'none' },
      svg('path', { d: fp, 'fill-rule': 'evenodd', fill: ref('lac') }),
      svg('path', { d: fp, 'fill-rule': 'evenodd', fill: ref('lacsheen') }),
      svg('rect', { x: PX + 1.25, y: FY0 + 1.25, width: W - 2 * PX - 2.5, height: FY1 - FY0 - 2.5, rx: 14.75, fill: 'none', stroke: ref('edge'), 'stroke-width': 2.5 }),
      svg('rect', { x: PX + 6.5, y: FY0 + 6.5, width: W - 2 * PX - 13, height: FY1 - FY0 - 13, rx: 9.5, fill: 'none', stroke: '#d9b25e', 'stroke-opacity': '.35', 'stroke-width': 1 }));
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      frame.append(
        svg('circle', { cx: CX(c), cy: CY(r), r: HR - 0.5, fill: ref('shade') }),
        svg('circle', { cx: CX(c), cy: CY(r), r: HR + 1, fill: 'none', stroke: ref('bevel'), 'stroke-width': 3 }));
    }
    const colHi = svg('rect', { class: 'c4-col', x: -S, y: 0, width: S, height: FY1 });
    const glow = svg('g', { 'pointer-events': 'none' });
    const marks = svg('g', { 'pointer-events': 'none' });
    const ghost = svg('use', { class: 'c4-ghost', href: `#${id}-sr`, x: -200, y: PY });
    const land = svg('circle', { class: 'c4-land', r: SR - 3, cx: -200, cy: -200 });
    const hit = svg('rect', { class: 'c4-hit', x: PX, y: 0, width: W - 2 * PX, height: FY1, fill: 'transparent' });
    el.append(base, nums, back, stonesG, veil, stonesWin, frame, colHi, glow, marks, land, ghost, hit);

    // ---------- 交互 ----------
    let movable = null;
    let legal = new Set();
    let board = [];
    const colAt = (evt) => {
      const ctm = el.getScreenCTM();
      if (!ctm) return null;
      const pt = el.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      const c = Math.floor((p.x - PX - F) / S);
      return c >= 0 && c < COLS ? c : null;
    };
    const heightOf = (c) => { let r = 0; while (r < ROWS && board[r * COLS + c]) r++; return r; };
    let preCol = null; // 触屏上第一下点的列，再点同一列才投子
    const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    /** 触屏（或手指点的）要两步确认；桌面鼠标仍是点一下就投 */
    const twoStep = (evt) => !!coarse?.matches || evt.pointerType === 'touch' || evt.pointerType === 'pen';
    const clearHover = () => {
      preCol = null;
      el.classList.remove('pre');
      ghost.setAttribute('x', -200);
      land.setAttribute('cx', -200);
      colHi.classList.remove('on');
      hit.classList.remove('on');
    };
    const showCol = (c) => {
      ghost.setAttribute('href', `#${id}-s${movable}`);
      ghost.setAttribute('x', CX(c));
      colHi.setAttribute('x', CX(c) - S / 2);
      colHi.classList.add('on');
      hit.classList.add('on');
      const r = heightOf(c);
      if (r < ROWS) { land.setAttribute('cx', CX(c)); land.setAttribute('cy', CY(r)); }
    };
    hit.addEventListener('pointermove', (evt) => {
      if (evt.pointerType !== 'mouse') return; // 手指划过不画悬停，触屏用两步确认
      const c = movable ? colAt(evt) : null;
      if (c !== null && legal.has(String(c + 1))) showCol(c);
      else clearHover();
    });
    hit.addEventListener('pointerleave', (evt) => { if (evt.pointerType === 'mouse') clearHover(); });
    hit.addEventListener('click', (evt) => {
      if (!movable) return;
      const c = colAt(evt);
      if (c === null || !legal.has(String(c + 1))) { if (twoStep(evt)) clearHover(); return; }
      if (twoStep(evt) && preCol !== c) {
        clearHover();
        showCol(c);
        preCol = c;
        el.classList.add('pre');
        return;
      }
      clearHover();
      onAction(String(c + 1));
    });

    // ---------- 增量画子 ----------
    const cells = new Array(COLS * ROWS).fill(null); // { v, g }
    let shownMoves = null;
    let shownWin = '';

    function drop(g, r) {
      if (!g.animate) return;
      const fall = CY(r) - PY;
      const ms = 380 + 46 * (ROWS - r);
      g.animate([
        { transform: `translateY(${-fall}px)`, easing: 'cubic-bezier(.5, 0, .9, .5)' },
        { transform: 'translateY(0)', offset: 0.6, easing: 'cubic-bezier(.2, .6, .4, 1)' },
        { transform: `translateY(${-Math.min(22, fall * 0.12)}px)`, offset: 0.75, easing: 'cubic-bezier(.6, 0, .9, .5)' },
        { transform: 'translateY(0)', offset: 0.87, easing: 'cubic-bezier(.2, .6, .4, 1)' },
        { transform: `translateY(${-Math.min(7, fall * 0.04)}px)`, offset: 0.94, easing: 'cubic-bezier(.6, 0, .9, .5)' },
        { transform: 'translateY(0)' },
      ], { duration: ms });
      return ms;
    }

    return {
      el,
      render(view, { movable: mv = null, actions = null, arrows = [], animate = true } = {}) {
        board = view.board || [];
        movable = mv;
        if (mv) {
          const ids = actions ? actions.map((a) => a.id) : Array.from({ length: COLS }, (_, c) => c).filter((c) => !board[(ROWS - 1) * COLS + c]).map((c) => String(c + 1));
          legal = new Set(ids);
          if (preCol !== null) {
            // 预览的列还能下就跟着棋盘更新落点圈，满了就收起
            if (legal.has(String(preCol + 1))) showCol(preCol); else clearHover();
          }
        } else { legal = new Set(); clearHover(); }

        const moves = view.moves || [];
        const lm = view.lastMove;
        const fresh = animate && shownMoves !== null && moves.length === shownMoves + 1;
        shownMoves = moves.length;
        const lastI = lm ? lm.row * COLS + lm.col : -1;
        const winSet = new Set((view.winLine || []).map(([c, r]) => r * COLS + c));

        let dropMs = 0;
        for (let i = 0; i < COLS * ROWS; i++) {
          const v = board[i] || null;
          const cur = cells[i];
          if (cur && cur.v === v) {
            const want = winSet.has(i) ? stonesWin : stonesG;
            if (cur.g.parentNode !== want) want.append(cur.g);
            continue;
          }
          if (cur) { cur.g.remove(); cells[i] = null; }
          if (!v) continue;
          const c = i % COLS, r = Math.floor(i / COLS);
          const inner = svg('use', { href: `#${id}-s${v}` });
          const g = svg('g', { class: `c4-st${winSet.has(i) ? ' win' : ''}`, transform: `translate(${CX(c)} ${CY(r)})` }, inner);
          (winSet.has(i) ? stonesWin : stonesG).append(g);
          cells[i] = { v, g };
          if (fresh && i === lastI) dropMs = drop(inner, r) || 0;
        }
        el.classList.toggle('won', winSet.size > 0);

        marks.replaceChildren();
        if (lm && cells[lastI] && !winSet.size) {
          const dot = svg('circle', { class: 'c4-last', cx: CX(lm.col), cy: CY(lm.row), r: 4 });
          marks.append(dot);
          if (dropMs && dot.animate) dot.animate([{ opacity: 0 }, { opacity: 0, offset: 0.9 }, { opacity: 1 }], { duration: dropMs });
        }
        for (const ar of arrows) {
          const c = Number(ar.iccs) - 1;
          if (c >= 0 && c < COLS) marks.append(svg('circle', { class: 'c4-best', cx: CX(c), cy: PY, r: SR - 2 }));
        }

        const key = (view.winLine || []).map((p) => p.join(':')).join(',');
        if (key !== shownWin) {
          shownWin = key;
          glow.replaceChildren();
          if (view.winLine?.length) {
            const pts = view.winLine.map(([c, r]) => ({ x: CX(c), y: CY(r) }));
            const [a0, b0] = [pts[0], pts[pts.length - 1]];
            const dx = b0.x - a0.x, dy = b0.y - a0.y;
            pts.sort((p, q) => (p.x * dx + p.y * dy) - (q.x * dx + q.y * dy));
            const a = pts[0], b = pts[pts.length - 1];
            const halos = pts.map((p) => svg('circle', { class: 'c4-halo', cx: p.x, cy: p.y, r: HR + 12, fill: ref('halo') }));
            const line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
            const lines = [svg('line', { class: 'c4-win-glow', ...line }), svg('line', { class: 'c4-win-line', ...line })];
            glow.append(...halos, ...lines);
            if (fresh && lines[0].animate) {
              const base = dropMs + 60;
              const len = Math.hypot(b.x - a.x, b.y - a.y);
              for (const l of lines) {
                l.setAttribute('stroke-dasharray', `${len} ${len}`);
                l.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 520, delay: base + 200, easing: 'cubic-bezier(.5, 0, .2, 1)', fill: 'backwards' });
              }
              halos.forEach((h, k) => h.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: base + k * 130, easing: 'ease-out', fill: 'backwards' }));
            }
          }
        }
      },
    };
  },

  moveList: (view) => (view.moves || []).map((m) => ({ seat: m.side, label: m.label })),
};
