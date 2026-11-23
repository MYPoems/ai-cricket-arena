// 黑白棋画面：纸面 8×8 格、墨线、黑白棋子；玩家本人可落子处画淡墨小点，最后一手标朱红小方块，
// 本手翻转的棋子做一个很短的翻面动画。

const NS = 'http://www.w3.org/2000/svg';
const S = 60; // 格宽
const M = 32; // 边距（放坐标）
const N = 8;
const W = M * 2 + S * N;
const BAR = 26; // 下方子数栏
const H = W + BAR;
const COLS = 'abcdefgh';
const R = S * 0.4; // 棋子半径
const FILL = { b: '#131311', w: '#fbf8f1' };

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  return el;
};
const label = (x, y) => `${COLS[x]}${y + 1}`;
const parse = (l) => (l && /^[a-h][1-8]$/i.test(l) ? { x: COLS.indexOf(l[0].toLowerCase()), y: Number(l[1]) - 1 } : null);
const CX = (x) => M + x * S + S / 2;
const CY = (y) => M + (N - 1 - y) * S + S / 2;

const CSS = `
svg.board.othello .oth-stone { stroke: #131311; stroke-width: 1.4; transform-box: fill-box; transform-origin: center; }
svg.board.othello .oth-stone.b { fill: ${FILL.b}; }
svg.board.othello .oth-stone.w { fill: ${FILL.w}; }
svg.board.othello .oth-star { fill: var(--board-line); stroke: none; }
svg.board.othello .oth-dot { fill: var(--board-line); opacity: .28; pointer-events: none; }
svg.board.othello .oth-last { fill: #c8321b; pointer-events: none; }
svg.board.othello .oth-best { fill: none; stroke: #c8321b; stroke-width: 2.4; stroke-dasharray: 4 4; pointer-events: none; }
svg.board.othello .oth-ghost { opacity: .35; pointer-events: none; stroke: #131311; stroke-width: 1.4; }
svg.board.othello .oth-bar { font: 500 13px/1 var(--mono); fill: var(--muted); }
svg.board.othello .oth-bar .pass { fill: var(--red); }
svg.board.othello.can-move .oth-hit { cursor: pointer; }
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

export default {
  aspect: [W, H],
  seatColor: (seat) => (seat === 'b' ? 'var(--black-side)' : '#8a857a'),

  createStage({ onAction }) {
    injectStyle();
    const el = svg('svg', { class: 'board othello', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '黑白棋棋盘' });
    el.append(svg('rect', { class: 'bg', x: 0, y: 0, width: W, height: W, fill: 'var(--wood-1)' }));
    const grid = svg('g', { class: 'grid' });
    for (let i = 0; i <= N; i++) {
      grid.append(svg('line', { x1: M, y1: M + i * S, x2: M + N * S, y2: M + i * S }));
      grid.append(svg('line', { x1: M + i * S, y1: M, x2: M + i * S, y2: M + N * S }));
    }
    grid.append(svg('rect', { class: 'frame', x: M, y: M, width: S * N, height: S * N }));
    for (const [gx, gy] of [[2, 2], [6, 2], [2, 6], [6, 6]]) grid.append(svg('circle', { class: 'oth-star', cx: M + gx * S, cy: M + gy * S, r: 4 }));
    const coords = svg('g');
    for (let i = 0; i < N; i++) {
      const t1 = svg('text', { class: 'coord', x: CX(i), y: W - 11, 'text-anchor': 'middle' }); t1.textContent = COLS[i]; coords.append(t1);
      const t2 = svg('text', { class: 'coord', x: M / 2, y: CY(i), 'text-anchor': 'middle', 'dominant-baseline': 'central' }); t2.textContent = String(i + 1); coords.append(t2);
    }
    const dots = svg('g');
    const stones = svg('g');
    const overlay = svg('g');
    const ghost = svg('circle', { class: 'oth-ghost', r: R, cx: -100, cy: -100 });
    const bar = svg('g', { class: 'oth-bar' });
    const hit = svg('rect', { class: 'oth-hit', x: M, y: M, width: S * N, height: S * N, fill: 'transparent' });
    el.append(grid, coords, dots, stones, overlay, ghost, hit, bar);

    let movable = null;
    let legal = new Set();
    let shownKey = null;

    const cellAt = (evt) => {
      const pt = el.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(el.getScreenCTM().inverse());
      const x = Math.floor((p.x - M) / S), y = N - 1 - Math.floor((p.y - M) / S);
      return x >= 0 && x < N && y >= 0 && y < N ? label(x, y) : null;
    };
    const hideGhost = () => ghost.setAttribute('cx', -100);
    hit.addEventListener('mousemove', (evt) => {
      const l = movable ? cellAt(evt) : null;
      if (l && legal.has(l)) {
        const p = parse(l);
        ghost.setAttribute('cx', CX(p.x)); ghost.setAttribute('cy', CY(p.y));
        ghost.setAttribute('fill', FILL[movable]);
        hit.style.cursor = 'pointer';
      } else { hideGhost(); hit.style.cursor = 'default'; }
    });
    hit.addEventListener('mouseleave', hideGhost);
    hit.addEventListener('click', (evt) => {
      if (!movable) return;
      const l = cellAt(evt);
      if (l && legal.has(l)) { hideGhost(); onAction(l); }
    });

    return {
      el,
      render(view, { movable: mv = null, actions = null, arrows = [], animate = true } = {}) {
        movable = mv;
        legal = new Set(mv ? (actions ? actions.map((a) => a.id) : view.legal || []) : []);
        el.classList.toggle('can-move', !!mv);
        if (!mv) hideGhost();

        const moves = view.moves || [];
        const key = `${moves.length}:${view.lastMove || ''}`;
        const fresh = animate && shownKey !== null && key !== shownKey && Number(shownKey.split(':')[0]) === moves.length - 1;
        shownKey = key;
        const flipped = new Set(fresh ? view.flipped || [] : []);

        stones.replaceChildren();
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const c = view.board[y * N + x];
          if (!c) continue;
          const l = label(x, y);
          const st = svg('circle', { class: `oth-stone ${c}`, cx: CX(x), cy: CY(y), r: R });
          stones.append(st);
          if (!fresh || !st.animate) continue;
          if (flipped.has(l)) {
            const from = FILL[c === 'b' ? 'w' : 'b'], to = FILL[c];
            st.animate([
              { transform: 'scaleX(1)', fill: from },
              { transform: 'scaleX(0.05)', fill: from, offset: 0.5 },
              { transform: 'scaleX(0.05)', fill: to, offset: 0.51 },
              { transform: 'scaleX(1)', fill: to },
            ], { duration: 260, delay: 90, easing: 'ease-in-out', fill: 'backwards' });
          } else if (l === view.lastMove) {
            st.animate([{ transform: 'scale(0.6)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 120, easing: 'ease-out' });
          }
        }

        dots.replaceChildren();
        for (const l of legal) {
          const p = parse(l);
          if (p) dots.append(svg('circle', { class: 'oth-dot', cx: CX(p.x), cy: CY(p.y), r: 5 }));
        }

        overlay.replaceChildren();
        const last = parse(view.lastMove);
        if (last) overlay.append(svg('rect', { class: 'oth-last', x: CX(last.x) - 4, y: CY(last.y) - 4, width: 8, height: 8 }));
        for (const ar of arrows) {
          const p = parse(ar.iccs);
          if (p) overlay.append(svg('circle', { class: 'oth-best', cx: CX(p.x), cy: CY(p.y), r: R - 4 }));
        }

        bar.replaceChildren();
        const cnt = view.counts || { b: 0, w: 0 };
        const left = svg('text', { x: M, y: W + BAR / 2, 'dominant-baseline': 'central' });
        left.textContent = `黑 ${cnt.b}　白 ${cnt.w}`;
        bar.append(left);
        if (view.pass && !view.over) {
          const right = svg('text', { class: 'pass', x: W - M, y: W + BAR / 2, 'text-anchor': 'end', 'dominant-baseline': 'central' });
          right.textContent = `${view.pass === 'b' ? '黑方' : '白方'}无处可下，跳过一手`;
          bar.append(right);
        }
      },
    };
  },

  moveList: (view) => (view.moves || []).map((m) => ({ seat: m.side, label: m.label })),
};
