// 四子棋画面：7×6 格的纸面棋盘、圆孔，朱红子与墨色子；落子从上方掉落，连四画朱红线。
// 玩家本人点击列落子，悬停时在列顶显示半透明的预览子。

const NS = 'http://www.w3.org/2000/svg';
const COLS = 7;
const ROWS = 6;
const S = 64; // 格宽
const M = 18; // 左右边距
const TOP = 58; // 棋盘上方：预览子和最佳着法标记
const R = 25; // 棋子半径
const W = M * 2 + S * COLS;
const H = TOP + S * ROWS + 34;
const FILL = { r: '#c8321b', b: '#131311' };

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  return el;
};
const CX = (c) => M + c * S + S / 2;
const CY = (r) => TOP + (ROWS - 1 - r) * S + S / 2;
const PY = TOP / 2; // 预览子的高度

const CSS = `
svg.board.connect4 .c4-plate { fill: var(--wood-1); stroke: var(--board-line); stroke-width: 2.6; }
svg.board.connect4 .c4-hole { fill: var(--wood-2); stroke: var(--board-line); stroke-width: 1.1; }
svg.board.connect4 .c4-stone { stroke-width: 1.4; }
svg.board.connect4 .c4-stone.r { fill: ${FILL.r}; stroke: #8e2412; }
svg.board.connect4 .c4-stone.b { fill: ${FILL.b}; stroke: #131311; }
svg.board.connect4 .c4-last { fill: #f2efe7; pointer-events: none; }
svg.board.connect4 .c4-win-under { stroke: #f2efe7; stroke-width: 10; stroke-linecap: square; }
svg.board.connect4 .c4-win { stroke: #c8321b; stroke-width: 5; stroke-linecap: square; }
svg.board.connect4 .c4-best { fill: none; stroke: #c8321b; stroke-width: 2.4; stroke-dasharray: 4 4; }
svg.board.connect4 .c4-ghost { opacity: .4; pointer-events: none; }
svg.board.connect4 .c4-col { fill: var(--board-line); opacity: 0; pointer-events: none; }
svg.board.connect4 .c4-col.on { opacity: .05; }
svg.board.connect4 .c4-num { font: 500 13px/1 var(--mono); fill: var(--muted); }
svg.board.connect4 .c4-hit.on { cursor: pointer; }
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

export default {
  aspect: [W, H],
  seatColor: (seat) => (seat === 'r' ? 'var(--red)' : 'var(--black-side)'),

  createStage({ onAction }) {
    injectStyle();
    const el = svg('svg', { class: 'board connect4', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '四子棋棋盘' });
    const plate = svg('g');
    plate.append(svg('rect', { class: 'c4-plate', x: M, y: TOP, width: S * COLS, height: S * ROWS }));
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) plate.append(svg('circle', { class: 'c4-hole', cx: CX(c), cy: CY(r), r: R + 2 }));
    const nums = svg('g');
    for (let c = 0; c < COLS; c++) {
      const t = svg('text', { class: 'c4-num', x: CX(c), y: TOP + S * ROWS + 20, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = String(c + 1);
      nums.append(t);
    }
    const colHi = svg('rect', { class: 'c4-col', x: -S, y: TOP, width: S, height: S * ROWS });
    const stones = svg('g');
    const overlay = svg('g');
    const ghost = svg('circle', { class: 'c4-ghost', r: R, cx: -100, cy: PY });
    const hit = svg('rect', { class: 'c4-hit', x: M, y: 0, width: S * COLS, height: TOP + S * ROWS, fill: 'transparent' });
    el.append(plate, colHi, stones, overlay, ghost, nums, hit);

    let movable = null;
    let legal = new Set();
    let shownKey = null;

    const colAt = (evt) => {
      const pt = el.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(el.getScreenCTM().inverse());
      const c = Math.floor((p.x - M) / S);
      return c >= 0 && c < COLS ? c : null;
    };
    const clearHover = () => { ghost.setAttribute('cx', -100); colHi.classList.remove('on'); hit.classList.remove('on'); };
    hit.addEventListener('mousemove', (evt) => {
      const c = movable ? colAt(evt) : null;
      if (c !== null && legal.has(String(c + 1))) {
        ghost.setAttribute('cx', CX(c));
        ghost.setAttribute('fill', FILL[movable]);
        colHi.setAttribute('x', M + c * S);
        colHi.classList.add('on');
        hit.classList.add('on');
      } else clearHover();
    });
    hit.addEventListener('mouseleave', clearHover);
    hit.addEventListener('click', (evt) => {
      if (!movable) return;
      const c = colAt(evt);
      if (c !== null && legal.has(String(c + 1))) { clearHover(); onAction(String(c + 1)); }
    });

    return {
      el,
      render(view, { movable: mv = null, actions = null, arrows = [], animate = true } = {}) {
        movable = mv;
        if (mv) {
          const ids = actions ? actions.map((a) => a.id) : Array.from({ length: COLS }, (_, c) => c).filter((c) => !view.board[(ROWS - 1) * COLS + c]).map((c) => String(c + 1));
          legal = new Set(ids);
        } else { legal = new Set(); clearHover(); }

        const moves = view.moves || [];
        const lm = view.lastMove;
        const key = `${moves.length}:${lm ? `${lm.col},${lm.row}` : ''}`;
        const fresh = animate && shownKey !== null && key !== shownKey && Number(shownKey.split(':')[0]) === moves.length - 1;
        shownKey = key;

        stones.replaceChildren();
        let dropping = null;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const v = view.board[r * COLS + c];
          if (!v) continue;
          const st = svg('circle', { class: `c4-stone ${v}`, cx: CX(c), cy: CY(r), r: R });
          stones.append(st);
          if (fresh && lm && lm.col === c && lm.row === r) dropping = st;
        }
        if (dropping?.animate) {
          const fall = CY(lm.row) - PY;
          dropping.animate([{ transform: `translateY(${-fall}px)` }, { transform: 'translateY(0)' }],
            { duration: 140 + 30 * (ROWS - lm.row), easing: 'cubic-bezier(.55, 0, 1, .45)' });
        }

        overlay.replaceChildren();
        if (lm) overlay.append(svg('rect', { class: 'c4-last', x: CX(lm.col) - 3.5, y: CY(lm.row) - 3.5, width: 7, height: 7 }));
        if (view.winLine?.length) {
          const [a, b] = [view.winLine[0], view.winLine[view.winLine.length - 1]];
          const line = { x1: CX(a[0]), y1: CY(a[1]), x2: CX(b[0]), y2: CY(b[1]) };
          const under = svg('line', { class: 'c4-win-under', ...line });
          const top = svg('line', { class: 'c4-win', ...line });
          overlay.append(under, top);
          if (fresh && top.animate) {
            const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
            for (const l of [under, top]) {
              l.setAttribute('stroke-dasharray', `${len} ${len}`);
              l.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 260, delay: 260, easing: 'ease-out', fill: 'backwards' });
            }
          }
        }
        for (const ar of arrows) {
          const c = Number(ar.iccs) - 1;
          if (c >= 0 && c < COLS) overlay.append(svg('circle', { class: 'c4-best', cx: CX(c), cy: PY, r: R - 4 }));
        }
      },
    };
  },

  moveList: (view) => (view.moves || []).map((m) => ({ seat: m.side, label: m.label })),
};
