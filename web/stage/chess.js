// 国际象棋画面：印刷棋谱风格的 8×8 棋盘，圆形棋子上写中文（王 后 车 象 马 兵）。
// 白方纸色圆底墨字，黑方墨色圆底纸色字。上一步起点小圆点、终点四角括弧；被将军的王描红；最佳着法朱红虚线。

import { parseFen, legalMoves, moveToUci } from '/games/chess/rules.js';

const NS = 'http://www.w3.org/2000/svg';
const S = 64; // 格宽
const M = 30; // 边距（放坐标）
const W = M * 2 + S * 8;
const FILES = 'abcdefgh';
const CHARS = { K: '王', Q: '后', R: '车', B: '象', N: '马', P: '兵' };
const PROMOS = ['q', 'r', 'b', 'n'];

const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
};
const sideOf = (p) => (p ? (p < 'a' ? 'w' : 'b') : null);
const sqName = (s) => FILES[s & 7] + ((s >> 3) + 1);
const parseSq = (t) => FILES.indexOf(t[0]) + (Number(t[1]) - 1) * 8;

const STYLE = `
svg.board.chess .sq-l { fill: var(--wood-1); }
svg.board.chess .sq-d { fill: var(--tint); }
svg.board.chess .frame { fill: none; stroke: var(--board-line); stroke-width: 2.2; }
svg.board.chess .piece circle.disc { stroke-width: 1.6; }
svg.board.chess .piece.w circle.disc { fill: #fbf8f1; stroke: #131311; }
svg.board.chess .piece.w circle.ring { stroke: #131311; opacity: .55; }
svg.board.chess .piece.w text { fill: #131311; }
svg.board.chess .piece.b circle.disc { fill: #131311; stroke: #131311; }
svg.board.chess .piece.b circle.ring { stroke: #f2efe7; opacity: .5; }
svg.board.chess .piece.b text { fill: #f2efe7; }
svg.board.chess .piece text { font-size: 28px; }
svg.board.chess .piece.sel circle.disc { stroke: #c8321b; stroke-width: 2.6; }
svg.board.chess .piece .chk-ring { fill: none; stroke: #c8321b; stroke-width: 2.6; }
svg.board.chess .piece.chk circle.disc { stroke: #c8321b; stroke-width: 3; }
svg.board.chess .chess-promo-bg { fill: #f2efe7; opacity: .72; cursor: pointer; }
svg.board.chess .chess-promo-opt { cursor: pointer; }
svg.board.chess .chess-promo-opt rect { fill: #fbf8f1; stroke: #131311; stroke-width: 1.4; }
svg.board.chess .chess-promo-opt:hover rect { stroke: #c8321b; stroke-width: 2.4; }
svg.board.chess .chess-hint { stroke: #131311; stroke-width: 5; opacity: .55; stroke-linecap: square; }
`;
let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
}

/** 合法着法：优先用服务端给的 actions，没有时用规则代码从 FEN 算 */
function legalIds(view, actions) {
  if (Array.isArray(actions)) return actions.map((a) => a.id);
  try { return legalMoves(parseFen(view.fen)).map(moveToUci); } catch { return []; }
}

function createStage({ onAction }) {
  injectStyle();
  let flipped = false;
  let view = { board: new Array(64).fill(null), side: 'w', moves: [] };
  let opts = { movable: null, arrows: [] };
  let selected = null;
  let promo = null; // { from, to }
  let prevBoard = null;

  const X = (s) => M + (flipped ? 7 - (s & 7) : s & 7) * S + S / 2;
  const Y = (s) => M + (flipped ? s >> 3 : 7 - (s >> 3)) * S + S / 2;

  const el = svg('svg', { class: 'board chess', viewBox: `0 0 ${W} ${W}`, role: 'img', 'aria-label': '国际象棋棋盘' });
  el.append(svg('defs', {},
    svg('marker', { id: 'chess-arrowhead', viewBox: '0 0 10 10', refX: '5', refY: '5', markerWidth: '3.2', markerHeight: '3.2', orient: 'auto-start-reverse' },
      svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', style: 'fill: #131311' }))));
  el.append(svg('rect', { x: 0, y: 0, width: W, height: W, fill: 'var(--wood-1)' }));
  const squares = svg('g');
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    // 屏幕上的格子颜色与翻转无关（a1 为深格）
    squares.append(svg('rect', { class: (f + r) % 2 === 0 ? 'sq-l' : 'sq-d', x: M + f * S, y: M + r * S, width: S, height: S }));
  }
  el.append(squares, svg('rect', { class: 'frame', x: M, y: M, width: S * 8, height: S * 8 }));
  const coords = svg('g');
  const marks = svg('g');
  const pieces = svg('g');
  const overlay = svg('g');
  const arrows = svg('g', { 'pointer-events': 'none' });
  const promoLayer = svg('g');
  el.append(coords, marks, pieces, overlay, arrows, promoLayer);

  function drawCoords() {
    coords.replaceChildren();
    for (let i = 0; i < 8; i++) {
      coords.append(svg('text', { class: 'coord', x: X(i), y: M + 8 * S + 19, 'text-anchor': 'middle' }, FILES[i]));
      coords.append(svg('text', { class: 'coord', x: M / 2, y: Y(i * 8), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, String(i + 1)));
    }
  }

  function targets() {
    if (selected === null || !opts.movable) return [];
    const from = sqName(selected);
    const out = new Map();
    for (const id of legalIds(view, opts.actions)) {
      if (!id.startsWith(from)) continue;
      const to = parseSq(id.slice(2, 4));
      if (!out.has(to)) out.set(to, []);
      out.get(to).push(id);
    }
    return [...out].map(([to, ids]) => ({ to, ids }));
  }

  function draw(animate) {
    const b = view.board;
    const lastId = view.lastMove || view.moves?.[view.moves.length - 1]?.uci || null;
    const last = lastId ? { from: parseSq(lastId.slice(0, 2)), to: parseSq(lastId.slice(2, 4)) } : null;

    marks.replaceChildren();
    if (last) {
      marks.append(svg('circle', { class: 'last-from', cx: X(last.from), cy: Y(last.from), r: 7 }));
      const cx = X(last.to), cy = Y(last.to), e = 29, l = 9;
      const d = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) =>
        `M ${cx + sx * e} ${cy + sy * (e - l)} V ${cy + sy * e} H ${cx + sx * (e - l)}`).join(' ');
      marks.append(svg('path', { class: 'last-to', d }));
    }

    pieces.replaceChildren();
    const checkedKing = view.inCheck ? b.indexOf(view.side === 'w' ? 'K' : 'k') : -1;
    for (let s = 0; s < 64; s++) {
      const p = b[s];
      if (!p) continue;
      const side = sideOf(p);
      const g = svg('g', { class: `piece ${side}${s === selected ? ' sel' : ''}${s === checkedKing ? ' chk' : ''}`, 'data-sq': s });
      const body = svg('g', { class: 'body' },
        s === checkedKing ? svg('circle', { class: 'chk-ring', r: 29.5 }) : null,
        svg('circle', { class: 'disc', r: 25 }),
        svg('circle', { class: 'ring', r: 21 }),
        svg('text', { y: 1 }, CHARS[p.toUpperCase()]));
      g.append(body);
      const tx = X(s), ty = Y(s);
      if (animate && last && last.to === s && prevBoard?.[last.from] === p) {
        g.style.transition = 'none';
        g.style.transform = `translate(${X(last.from)}px, ${Y(last.from)}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          g.style.transition = '';
          g.style.transform = `translate(${tx}px, ${ty}px)`;
        }));
      } else {
        g.style.transform = `translate(${tx}px, ${ty}px)`;
      }
      pieces.append(g);
    }

    overlay.replaceChildren();
    for (const t of targets()) {
      const cx = X(t.to), cy = Y(t.to);
      const cap = b[t.to] || t.ids.some((id) => id.slice(2, 4) === view.ep);
      overlay.append(cap ? svg('circle', { class: 'cap', cx, cy, r: 28 }) : svg('circle', { class: 'dot', cx, cy, r: 8 }));
      overlay.append(svg('circle', { class: 'hit', cx, cy, r: 30, 'data-to': t.to }));
    }

    arrows.replaceChildren();
    for (const a of opts.arrows || []) {
      const id = a.iccs || a.uci;
      if (!/^[a-h][1-8][a-h][1-8]/.test(id || '')) continue;
      const f = parseSq(id.slice(0, 2)), t = parseSq(id.slice(2, 4));
      const x1 = X(f), y1 = Y(f), x2 = X(t), y2 = Y(t);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const k = (len - 20) / len;
      const best = a.kind === 'best';
      arrows.append(svg('line', {
        class: best ? 'best-arrow' : 'chess-hint', x1, y1, x2: x1 + (x2 - x1) * k, y2: y1 + (y2 - y1) * k,
        style: best ? null : 'marker-end: url(#chess-arrowhead)',
      }));
    }

    drawPromo();
  }

  /** 升变选择：在目标格所在列朝棋盘中间排开后、车、象、马 */
  function drawPromo() {
    promoLayer.replaceChildren();
    if (!promo || !opts.movable) return;
    promoLayer.append(svg('rect', { class: 'chess-promo-bg', 'data-promo-cancel': 1, x: 0, y: 0, width: W, height: W }));
    const side = opts.movable;
    const down = Y(promo.to) < W / 2; // 目标格在屏幕上半部分，选项往下排
    PROMOS.forEach((p, i) => {
      const cx = X(promo.to), cy = Y(promo.to) + (down ? i : -i) * S;
      const letter = side === 'w' ? p.toUpperCase() : p;
      promoLayer.append(svg('g', { class: 'chess-promo-opt', 'data-promo': p },
        svg('rect', { x: cx - S / 2, y: cy - S / 2, width: S, height: S }),
        svg('g', { class: `piece ${side}`, style: `transform: translate(${cx}px, ${cy}px)` },
          svg('circle', { class: 'disc', r: 25 }), svg('circle', { class: 'ring', r: 21 }), svg('text', { y: 1 }, CHARS[letter.toUpperCase()]))));
    });
  }

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
    const pc = e.target.closest('.piece[data-sq]');
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
  aspect: [W, W],
  seatColor: (seat) => (seat === 'w' ? '#8a857a' : 'var(--black-side)'),
  /** 玩家执黑时棋盘翻转，让自己在下方 */
  flipFor: (seat) => seat === 'b',
  createStage,
  moveList: (view) => (view.moves || []).map((m) => ({ seat: m.side, label: m.san })),
};
