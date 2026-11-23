// SVG 象棋棋盘。直接复用服务端的同一份规则代码来提示合法落点。

import { legalTargets, fileOf, rankOf, sq, iccsToMove, sideOf } from '/games/xiangqi/rules.js';

const NS = 'http://www.w3.org/2000/svg';
const S = 60; // 格距
const M = 46; // 边距
const W = M * 2 + S * 8;
const H = M * 2 + S * 9;
const CHARS = { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵', k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒' };

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
};

export class Board {
  constructor({ onMove = null } = {}) {
    this.onMove = onMove;
    this.flipped = false;
    this.state = { board: new Array(90).fill(null), side: 'r' };
    this.selected = null;
    this.el = svg('svg', { class: 'board', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '象棋棋盘' });
    this.#drawGrid();
    this.marks = svg('g');
    this.pieces = svg('g');
    this.overlay = svg('g');
    this.arrows = svg('g', { 'pointer-events': 'none' });
    this.el.append(this.marks, this.pieces, this.overlay, this.arrows);
    this.el.addEventListener('click', (e) => this.#click(e));
  }

  x(f) { return M + (this.flipped ? 8 - f : f) * S; }
  y(r) { return M + (this.flipped ? r : 9 - r) * S; }

  #drawGrid() {
    const g = svg('g', { class: 'grid' });
    const defs = svg('defs', {},
      svg('marker', { id: 'arrowhead', viewBox: '0 0 10 10', refX: '5', refY: '5', markerWidth: '3.2', markerHeight: '3.2', orient: 'auto-start-reverse' },
        svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'currentColor', style: 'fill: var(--accent-2)' })),
    );
    // 木纹：底色渐变 + 几道浅色纹理
    defs.append(
      svg('linearGradient', { id: 'wood', x1: '0', y1: '0', x2: '1', y2: '1' },
        svg('stop', { offset: '0', style: 'stop-color: var(--wood-1)' }),
        svg('stop', { offset: '1', style: 'stop-color: var(--wood-2)' })),
      svg('radialGradient', { id: 'disc', cx: '0.4', cy: '0.35', r: '0.7' },
        svg('stop', { offset: '0', style: 'stop-color: var(--piece-hi)' }),
        svg('stop', { offset: '1', style: 'stop-color: var(--piece)' })),
    );
    this.el.append(defs, svg('rect', { class: 'bg', x: 0, y: 0, width: W, height: H, rx: 16, fill: 'url(#wood)' }));
    const grain = svg('g', { class: 'grain' });
    for (let i = 0; i < 9; i++) {
      const y = 30 + i * 72 + (i % 3) * 9;
      grain.append(svg('path', { d: `M 0 ${y} C ${W * 0.3} ${y - 14}, ${W * 0.6} ${y + 16}, ${W} ${y - 4}` }));
    }
    this.el.append(grain);
    g.append(svg('rect', { class: 'frame', x: M - 6, y: M - 6, width: S * 8 + 12, height: S * 9 + 12 }));
    for (let r = 0; r < 10; r++) g.append(svg('line', { x1: M, y1: M + r * S, x2: M + 8 * S, y2: M + r * S }));
    for (let f = 0; f < 9; f++) {
      const x = M + f * S;
      if (f === 0 || f === 8) g.append(svg('line', { x1: x, y1: M, x2: x, y2: M + 9 * S }));
      else {
        g.append(svg('line', { x1: x, y1: M, x2: x, y2: M + 4 * S }));
        g.append(svg('line', { x1: x, y1: M + 5 * S, x2: x, y2: M + 9 * S }));
      }
    }
    // 九宫斜线
    for (const top of [0, 7]) {
      const y0 = M + top * S;
      g.append(svg('line', { x1: M + 3 * S, y1: y0, x2: M + 5 * S, y2: y0 + 2 * S }));
      g.append(svg('line', { x1: M + 5 * S, y1: y0, x2: M + 3 * S, y2: y0 + 2 * S }));
    }
    // 兵炮位标记
    const marks = [[1, 2], [7, 2], [1, 7], [7, 7], ...[0, 2, 4, 6, 8].flatMap((f) => [[f, 3], [f, 6]])];
    for (const [f, row] of marks) {
      const cx = M + f * S, cy = M + row * S, d = 5, l = 10;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if ((f === 0 && sx < 0) || (f === 8 && sx > 0)) continue;
        g.append(svg('path', { d: `M ${cx + sx * d} ${cy + sy * (d + l)} V ${cy + sy * d} H ${cx + sx * (d + l)}`, 'stroke-width': 1.3 }));
      }
    }
    this.el.append(g);
    const river = svg('g');
    river.append(svg('text', { class: 'river', x: M + 2 * S, y: M + 4.5 * S, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, document.createTextNode('楚 河')));
    river.append(svg('text', { class: 'river', x: M + 6 * S, y: M + 4.5 * S, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, document.createTextNode('汉 界')));
    this.el.append(river);
    this.coords = svg('g');
    this.el.append(this.coords);
    this.#drawCoords();
  }

  #drawCoords() {
    this.coords.replaceChildren();
    for (let f = 0; f < 9; f++) {
      this.coords.append(svg('text', { class: 'coord', x: this.x(f), y: H - 14, 'text-anchor': 'middle' }, document.createTextNode(String.fromCharCode(97 + f))));
    }
    for (let r = 0; r < 10; r++) {
      this.coords.append(svg('text', { class: 'coord', x: 16, y: this.y(r), 'dominant-baseline': 'central', 'text-anchor': 'middle' }, document.createTextNode(String(r))));
    }
  }

  setFlipped(v) {
    if (this.flipped === v) return;
    this.flipped = v;
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
    const last = state.lastMove ? iccsToMove(state.lastMove) : null;

    this.marks.replaceChildren();
    if (last) {
      // 起点：空位上的小圆点；落点：棋子外的四角括弧。两者形状不同、范围都在本格之内，相邻时不会重叠
      this.marks.append(svg('circle', { class: 'last-from', cx: this.x(fileOf(last.from)), cy: this.y(rankOf(last.from)), r: 7 }));
      const cx = this.x(fileOf(last.to)), cy = this.y(rankOf(last.to)), e = 27, l = 8;
      const d = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) =>
        `M ${cx + sx * e} ${cy + sy * (e - l)} V ${cy + sy * e} H ${cx + sx * (e - l)}`).join(' ');
      this.marks.append(svg('path', { class: 'last-to', d }));
    }

    this.pieces.replaceChildren();
    const kingInCheck = state.inCheck ? state.board.findIndex((p) => p === (state.side === 'r' ? 'K' : 'k')) : -1;
    for (let s = 0; s < 90; s++) {
      const p = state.board[s];
      if (!p) continue;
      const side = sideOf(p);
      const g = svg('g', { class: `piece ${side}${s === this.selected ? ' sel' : ''}${s === kingInCheck ? ' check' : ''}`, 'data-sq': s });
      const inner = svg('g', { class: 'body' });
      inner.append(svg('circle', { class: 'disc', r: 25.5, fill: 'url(#disc)' }), svg('circle', { class: 'ring', r: 21 }));
      inner.append(svg('text', { y: 1 }, document.createTextNode(CHARS[p])));
      g.append(inner);
      const tx = this.x(fileOf(s)), ty = this.y(rankOf(s));
      if (animate && last && last.to === s && prev.board?.[last.from] === p) {
        g.style.transition = 'none';
        g.style.transform = `translate(${this.x(fileOf(last.from))}px, ${this.y(rankOf(last.from))}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          g.style.transition = '';
          g.style.transform = `translate(${tx}px, ${ty}px)`;
        }));
      } else {
        g.style.transform = `translate(${tx}px, ${ty}px)`;
      }
      this.pieces.append(g);
    }
    this.#drawTargets();
    this.#drawArrows();
  }

  #drawTargets() {
    this.overlay.replaceChildren();
    if (this.selected === null) return;
    const pos = { board: this.state.board, side: this.state.movable, halfmove: 0, fullmove: 1 };
    for (const t of legalTargets(pos, this.selected)) {
      const cx = this.x(fileOf(t)), cy = this.y(rankOf(t));
      if (this.state.board[t]) this.overlay.append(svg('circle', { class: 'cap', cx, cy, r: 28, 'data-to': t }));
      else this.overlay.append(svg('circle', { class: 'dot', cx, cy, r: 8, 'data-to': t }));
      this.overlay.append(svg('circle', { class: 'hit', cx, cy, r: 28, 'data-to': t }));
    }
  }

  #drawArrows() {
    this.arrows.replaceChildren();
    for (const a of this.state.arrows || []) {
      const m = iccsToMove(a.iccs);
      if (!m) continue;
      const x1 = this.x(fileOf(m.from)), y1 = this.y(rankOf(m.from)), x2 = this.x(fileOf(m.to)), y2 = this.y(rankOf(m.to));
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const k = (len - 20) / len;
      this.arrows.append(svg('line', { class: a.kind === 'best' ? 'best-arrow' : 'hint-arrow', x1, y1, x2: x1 + (x2 - x1) * k, y2: y1 + (y2 - y1) * k }));
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
      return;
    }
    const pc = e.target.closest('.piece');
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
