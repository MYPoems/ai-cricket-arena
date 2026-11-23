// 五子棋画面：纸面棋盘、墨线、黑白子；最后一手标朱红点，连五画朱红线。

const NS = 'http://www.w3.org/2000/svg';
const S = 40; // 格距
const M = 36; // 边距
const N = 15;
const W = M * 2 + S * (N - 1);
const COLS = 'ABCDEFGHIJKLMNO';
const STARS = [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]];

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  return el;
};
const label = (x, y) => `${COLS[x]}${y + 1}`;
const parse = (l) => (l ? { x: COLS.indexOf(l[0]), y: Number(l.slice(1)) - 1 } : null);

export default {
  aspect: [W, W],
  seatColor: (seat) => (seat === 'b' ? 'var(--black-side)' : '#8a857a'),

  createStage({ onAction }) {
    const el = svg('svg', { class: 'board gomoku', viewBox: `0 0 ${W} ${W}`, role: 'img', 'aria-label': '五子棋棋盘' });
    el.append(svg('rect', { class: 'bg', x: 0, y: 0, width: W, height: W, fill: 'var(--wood-1)' }));
    const grid = svg('g', { class: 'grid' });
    const X = (x) => M + x * S;
    const Y = (y) => M + (N - 1 - y) * S;
    for (let i = 0; i < N; i++) {
      grid.append(svg('line', { x1: X(0), y1: Y(i), x2: X(N - 1), y2: Y(i) }));
      grid.append(svg('line', { x1: X(i), y1: Y(0), x2: X(i), y2: Y(N - 1) }));
    }
    grid.append(svg('rect', { class: 'frame', x: X(0), y: Y(N - 1), width: S * (N - 1), height: S * (N - 1) }));
    for (const [x, y] of STARS) grid.append(svg('circle', { class: 'star', cx: X(x), cy: Y(y), r: 3.6 }));
    const coords = svg('g');
    for (let i = 0; i < N; i++) {
      const t1 = svg('text', { class: 'coord', x: X(i), y: W - 10, 'text-anchor': 'middle' }); t1.textContent = COLS[i]; coords.append(t1);
      const t2 = svg('text', { class: 'coord', x: 14, y: Y(i), 'text-anchor': 'middle', 'dominant-baseline': 'central' }); t2.textContent = String(i + 1); coords.append(t2);
    }
    const stones = svg('g');
    const overlay = svg('g');
    const ghost = svg('circle', { class: 'ghost', r: 16, cx: -100, cy: -100 });
    el.append(grid, coords, stones, overlay, ghost);

    let state = { board: [], movable: null };
    const pointAt = (evt) => {
      const pt = el.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(el.getScreenCTM().inverse());
      const x = Math.round((p.x - M) / S), y = N - 1 - Math.round((p.y - M) / S);
      return x >= 0 && x < N && y >= 0 && y < N ? { x, y } : null;
    };
    el.addEventListener('mousemove', (evt) => {
      const p = state.movable ? pointAt(evt) : null;
      if (p && !state.board[p.y * N + p.x]) {
        ghost.setAttribute('cx', X(p.x)); ghost.setAttribute('cy', Y(p.y));
        ghost.setAttribute('class', `ghost ${state.movable}`);
      } else { ghost.setAttribute('cx', -100); }
    });
    el.addEventListener('mouseleave', () => ghost.setAttribute('cx', -100));
    el.addEventListener('click', (evt) => {
      if (!state.movable) return;
      const p = pointAt(evt);
      if (p && !state.board[p.y * N + p.x]) { ghost.setAttribute('cx', -100); onAction(label(p.x, p.y)); }
    });

    return {
      el,
      render(view, { movable = null, arrows = [] } = {}) {
        state = { board: view.board, movable };
        el.classList.toggle('can-move', !!movable);
        stones.replaceChildren();
        const order = new Map((view.moves || []).map((m, i) => [m.label, i + 1]));
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const c = view.board[y * N + x];
          if (!c) continue;
          stones.append(svg('circle', { class: `stone ${c}`, cx: X(x), cy: Y(y), r: 17 }));
          const no = order.get(label(x, y));
          if (no && view.moves.length <= 60) {
            const t = svg('text', { class: `stone-no ${c}`, x: X(x), y: Y(y) + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
            t.textContent = no;
            stones.append(t);
          }
        }
        overlay.replaceChildren();
        const last = parse(view.lastMove);
        if (last) overlay.append(svg('rect', { class: 'last-mark', x: X(last.x) - 4, y: Y(last.y) - 4, width: 8, height: 8 }));
        if (view.winLine?.length) {
          const a = parse(view.winLine[0]), b = parse(view.winLine[view.winLine.length - 1]);
          overlay.append(svg('line', { class: 'win-line', x1: X(a.x), y1: Y(a.y), x2: X(b.x), y2: Y(b.y) }));
        }
        for (const ar of arrows) {
          const p = parse(ar.iccs);
          if (p) overlay.append(svg('circle', { class: 'best-dot', cx: X(p.x), cy: Y(p.y), r: 9 }));
        }
      },
    };
  },

  moveList: (view) => (view.moves || []).map((m) => ({ seat: m.side, label: m.label })),
};
