// 德州扑克画面：纸面椭圆牌桌，座位围一圈；中间是公共牌、底池和边池。
// 牌面是纸色小卡片，♥♦ 朱红、♠♣ 墨色；上帝视角显示所有底牌和实时胜率。
// 玩家本人行动时底部出现操作条：弃牌、过牌/跟注、加注（滑块 + 输入框）、全下。

import { PALETTE } from './index.js';

const NS = 'http://www.w3.org/2000/svg';
const XH = 'http://www.w3.org/1999/xhtml';
const W = 1600, H = 1000;
const CX = 800, CY = 440; // 牌桌中心
const RING = { rx: 650, ry: 355 }; // 座位所在的椭圆
const INK = '#2a2620', PAPER = '#fbf8f1', RED = '#c8321b';
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK = { T: '10' };

const svg = (tag, attrs = {}, text = null) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  if (text !== null) el.textContent = text;
  return el;
};
const html = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(XH, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) el.append(c);
  return el;
};
const isRed = (code) => code[1] === 'h' || code[1] === 'd';
const cardLabel = (code) => `${RANK[code[0]] || code[0]}${SUIT[code[1]]}`;
// 阵营色沿用 PALETTE；牌桌在两种主题下都是纸色，墨色阵营固定用深墨
const seatColor = (j) => (j === 1 ? INK : PALETTE[j % PALETTE.length]);

const STYLE = `
svg.board.poker text { font-family: var(--serif); fill: ${INK}; }
svg.board.poker .pk-mono { font-family: var(--mono); }
svg.board.poker .pk-muted { fill: #5c594f; }
svg.board.poker .pk-red { fill: ${RED}; }
svg.board.poker .pk-seat.folded { opacity: .4; }
svg.board.poker .pk-seat.out { opacity: .5; }
svg.board.poker .pk-seat .pk-box { fill: ${PAPER}; stroke: ${INK}; stroke-width: 1.6; }
svg.board.poker .pk-seat.acting .pk-box { stroke: ${RED}; stroke-width: 4; }
svg.board.poker .pk-seat.win .pk-box { stroke: ${RED}; stroke-width: 4; fill: #f7e6df; }
svg.board.poker .pk-seat.out .pk-box { stroke-dasharray: 6 5; }
svg.board.poker .pk-card .face { fill: ${PAPER}; stroke: ${INK}; stroke-width: 1.4; }
svg.board.poker .pk-card.hl .face { stroke: ${RED}; stroke-width: 3.4; }
svg.board.poker .pk-card.dim .face { fill: #e3ded2; }
svg.board.poker .pk-card .back { fill: ${INK}; }
svg.board.poker .pk-card .slot { fill: none; stroke: ${INK}; stroke-width: 1.2; stroke-dasharray: 5 5; opacity: .35; }
svg.board.poker .pk-acting-dot { fill: ${RED}; }
.pk-ctl { box-sizing: border-box; width: 100%; height: 100%; display: flex; align-items: flex-end; gap: 14px; font: 500 22px/1.2 var(--serif); color: ${INK}; }
.pk-ctl .btn { font-size: 24px; padding: 12px 22px; border-color: ${INK}; color: ${INK}; background: ${PAPER}; }
.pk-ctl .btn:hover:not(:disabled) { background: ${INK}; color: ${PAPER}; }
.pk-ctl .btn.primary { background: ${INK}; color: ${PAPER}; }
.pk-ctl .btn.primary:hover:not(:disabled) { background: ${RED}; border-color: ${RED}; }
.pk-ctl .btn.danger:hover:not(:disabled) { background: ${RED}; border-color: ${RED}; color: ${PAPER}; }
.pk-ctl .pk-raise { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pk-ctl .pk-presets { display: flex; gap: 6px; flex-wrap: nowrap; overflow: hidden; }
.pk-ctl .pk-presets button { font: 500 17px/1.6 var(--mono); padding: 0 10px; border: 1px solid rgb(19 19 17 / .25); background: transparent; color: #5c594f; cursor: pointer; white-space: nowrap; }
.pk-ctl .pk-presets button:hover { border-color: ${RED}; color: ${RED}; }
.pk-ctl .pk-row { display: flex; gap: 10px; align-items: center; }
.pk-ctl input[type=range] { flex: 1; min-width: 0; accent-color: ${RED}; height: 30px; margin: 0; }
.pk-ctl input[type=number] { width: 110px; font: 600 24px/1 var(--mono); padding: 9px 8px; border: 1px solid ${INK}; background: ${PAPER}; color: ${INK}; }
.pk-ctl .pk-raise.off { opacity: .4; pointer-events: none; }
`;

function injectStyle() {
  if (document.getElementById('pk-stage-style')) return;
  const st = document.createElement('style');
  st.id = 'pk-stage-style';
  st.textContent = STYLE;
  document.head.append(st);
}

/** 一张牌：code 为 null 时画牌背；slot 为 true 时画空位 */
function card(x, y, w, h, code, { slot = false, hl = false, dim = false } = {}) {
  const g = svg('g', { class: `pk-card${hl ? ' hl' : ''}${dim ? ' dim' : ''}`, transform: `translate(${x} ${y})` });
  if (slot) { g.append(svg('rect', { class: 'slot', width: w, height: h })); return g; }
  if (!code) {
    g.append(svg('rect', { class: 'back', width: w, height: h }));
    g.append(svg('rect', { x: 5, y: 5, width: w - 10, height: h - 10, fill: 'none', stroke: '#f4efe3', 'stroke-width': 1, opacity: 0.55 }));
    g.append(svg('path', { d: `M ${w / 2} ${h * 0.3} L ${w * 0.7} ${h / 2} L ${w / 2} ${h * 0.7} L ${w * 0.3} ${h / 2} Z`, fill: RED, opacity: 0.85 }));
    return g;
  }
  const color = dim ? '#8a857a' : isRed(code) ? RED : INK;
  g.append(svg('rect', { class: 'face', width: w, height: h }));
  const rank = RANK[code[0]] || code[0];
  g.append(svg('text', { x: w * 0.1, y: h * 0.32, 'font-size': h * 0.3, 'font-weight': 700, style: `fill:${color}`, 'letter-spacing': rank.length > 1 ? -2 : 0 }, rank));
  g.append(svg('text', { x: w * 0.58, y: h * 0.86, 'font-size': h * 0.46, 'text-anchor': 'middle', style: `fill:${color}` }, SUIT[code[1]]));
  return g;
}

/** 文字里的牌（A♠ 这样的写法）按花色上色 */
function richText(el, text) {
  const re = /(10|[2-9AKQJ])([♠♥♦♣])/g;
  let i = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > i) el.append(svg('tspan', {}, text.slice(i, m.index)));
    el.append(svg('tspan', { style: `fill:${m[2] === '♥' || m[2] === '♦' ? RED : INK}`, 'font-weight': 700 }, m[0]));
    i = m.index + m[0].length;
  }
  if (i < text.length) el.append(svg('tspan', {}, text.slice(i)));
  return el;
}

/** 按字数粗略折行 */
function wrap(text, max) {
  const out = [];
  let rest = text;
  while (rest.length > max && out.length < 2) {
    let cut = rest.lastIndexOf('；', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('，', max);
    if (cut < max * 0.5) cut = max - 1;
    out.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  out.push(rest.length > max ? `${rest.slice(0, max - 1)}…` : rest);
  return out;
}

const signed = (v) => (v > 0 ? `+${v}` : `${v}`);

export default {
  aspect: [16, 10],

  createStage({ onAction }) {
    injectStyle();
    const el = svg('svg', { class: 'board poker', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '德州扑克牌桌' });
    el.append(svg('rect', { class: 'bg', x: 0, y: 0, width: W, height: H, fill: 'var(--wood-1)' }));
    el.append(svg('ellipse', { cx: CX, cy: CY, rx: 575, ry: 280, fill: '#ebe4d3', stroke: INK, 'stroke-width': 3 }));
    el.append(svg('ellipse', { cx: CX, cy: CY, rx: 553, ry: 258, fill: 'none', stroke: INK, 'stroke-width': 1, opacity: 0.45 }));
    const layer = svg('g');
    const ctlBox = svg('foreignObject', { x: 170, y: 878, width: 1260, height: 112 });
    el.append(layer, ctlBox);

    // ---------- 操作条 ----------
    const foldBtn = html('button', { class: 'btn danger', type: 'button' }, '弃牌');
    const callBtn = html('button', { class: 'btn', type: 'button' }, '跟注');
    const allinBtn = html('button', { class: 'btn', type: 'button' }, '全下');
    const range = html('input', { type: 'range', step: 1 });
    const num = html('input', { type: 'number', step: 1 });
    const raiseBtn = html('button', { class: 'btn primary', type: 'button' }, '加注');
    const presets = html('div', { class: 'pk-presets' });
    const raiseBox = html('div', { class: 'pk-raise' }, presets, html('div', { class: 'pk-row' }, range, num, raiseBtn));
    const ctl = html('div', { class: 'pk-ctl' }, foldBtn, callBtn, raiseBox, allinBtn);
    ctlBox.append(ctl);
    let cur = { ids: new Set(), legal: null, callId: null, verb: '加注到' };

    const amount = () => {
      const L = cur.legal;
      if (!L) return 0;
      const v = Math.round(Number(num.value));
      return Number.isFinite(v) ? Math.max(L.minTo, Math.min(L.maxTo, v)) : L.minTo;
    };
    const setAmount = (v, from) => {
      const L = cur.legal;
      if (!L) return;
      v = Math.max(L.minTo, Math.min(L.maxTo, Math.round(v)));
      if (from !== range) range.value = v;
      if (from !== num) num.value = v;
      raiseBtn.textContent = v >= L.maxTo ? `全下 ${v}` : `${cur.verb} ${v}`;
    };
    range.addEventListener('input', () => setAmount(Number(range.value), range));
    num.addEventListener('input', () => { if (num.value !== '') setAmount(Number(num.value), num); });
    num.addEventListener('change', () => setAmount(amount()));
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') raiseBtn.click(); });
    foldBtn.addEventListener('click', () => cur.ids.has('fold') && onAction('fold'));
    callBtn.addEventListener('click', () => cur.callId && onAction(cur.callId));
    allinBtn.addEventListener('click', () => cur.ids.has('allin') && onAction('allin'));
    raiseBtn.addEventListener('click', () => {
      const L = cur.legal;
      if (!L || !L.canRaise) return;
      const v = amount();
      onAction(v >= L.maxTo ? 'allin' : `raise:${v}`);
    });

    function renderControls(view, movable, actions) {
      const show = !!movable && view.toAct === movable && Array.isArray(actions) && actions.length > 0;
      ctlBox.style.display = show ? '' : 'none';
      if (!show) return;
      const ids = new Set(actions.map((a) => a.id));
      const L = view.legal;
      const byId = Object.fromEntries(actions.map((a) => [a.id, a]));
      cur = { ids, legal: L, callId: ids.has('check') ? 'check' : ids.has('call') ? 'call' : null, verb: view.currentBet ? '加注到' : '下注' };
      foldBtn.disabled = !ids.has('fold');
      callBtn.disabled = !cur.callId;
      callBtn.textContent = ids.has('check') ? '过牌' : byId.call ? byId.call.label : '跟注';
      allinBtn.disabled = !ids.has('allin');
      allinBtn.textContent = byId.allin ? byId.allin.label : '全下';
      const raises = actions.filter((a) => a.id.startsWith('raise:'));
      const canRaise = !!(L && L.canRaise && L.minTo < L.maxTo);
      raiseBox.classList.toggle('off', !canRaise);
      presets.replaceChildren(...raises.map((a) => html('button', { type: 'button', onclick: () => setAmount(Number(a.id.slice(6))) }, `${a.hint || ''} ${a.id.slice(6)}`.trim())));
      if (L) {
        range.min = num.min = L.minTo;
        range.max = num.max = L.maxTo;
        setAmount(L.minTo);
      }
      raiseBtn.disabled = !canRaise;
    }

    // ---------- 牌桌 ----------
    return {
      el,
      render(view, { movable = null, actions = null, viewer = null } = {}) {
        layer.replaceChildren();
        const n = view.players.length;
        const rot = viewer ? Math.max(0, view.players.findIndex((p) => p.seat === viewer)) : 0;
        const winners = new Set(view.result?.winners || []);
        const best = new Set();
        if (view.result?.showdown) for (const p of view.players) if (winners.has(p.seat) && p.best) p.best.forEach((c) => best.add(c));

        // 中间：手数、公共牌、底池
        layer.append(svg('text', { x: CX, y: 262, 'text-anchor': 'middle', 'font-size': 22, class: 'pk-mono pk-muted', 'letter-spacing': 2 },
          `第 ${view.handNo} / ${view.hands} 手 · ${view.streetName} · 盲注 ${view.blinds.sb}/${view.blinds.bb}`));
        const cw = 88, ch = 124, gap = 14, bx = CX - (5 * cw + 4 * gap) / 2;
        for (let k = 0; k < 5; k++) {
          const c = view.board[k];
          layer.append(card(bx + k * (cw + gap), 290, cw, ch, c || null, { slot: !c, hl: !!c && best.has(c), dim: !!c && best.size > 0 && !best.has(c) }));
        }
        layer.append(svg('text', { x: CX, y: 468, 'text-anchor': 'middle', 'font-size': 36, 'font-weight': 700 }, `底池 ${view.pot}`));
        if (view.pots.length > 1) {
          layer.append(svg('text', { x: CX, y: 503, 'text-anchor': 'middle', 'font-size': 21, class: 'pk-mono pk-muted' },
            view.pots.map((p, k) => `${k ? `边池 ${k}` : '主池'} ${p.amount}`).join(' · ')));
        }
        const note = view.result ? view.result.text : view.last ? `上一手：${view.last.text}` : '';
        if (note) {
          wrap(note, 34).forEach((line, k) => {
            layer.append(svg('text', { x: CX, y: 545 + k * 28, 'text-anchor': 'middle', 'font-size': 21, class: view.result ? 'pk-red' : 'pk-muted' }, line));
          });
        }
        if (!view.result && view.last && Object.keys(view.last.shown).length) {
          const shown = Object.entries(view.last.shown).map(([seat, cs]) => `${seat.slice(1)} 号位 ${cs.map(cardLabel).join(' ')}`).join('   ');
          const y = 545 + wrap(note, 34).length * 28;
          if (y < 620) layer.append(richText(svg('text', { x: CX, y, 'text-anchor': 'middle', 'font-size': 20, class: 'pk-mono pk-muted' }), shown));
        }

        // 座位
        view.players.forEach((p, j) => {
          const k = (j - rot + n) % n;
          const th = ((90 + (k * 360) / n) * Math.PI) / 180;
          const x = CX + RING.rx * Math.cos(th), y = CY + RING.ry * Math.sin(th);
          // 从座位中心朝牌桌中心的方向；exit 为离开座位框的距离
          const len = Math.hypot(CX - x, CY - y) || 1;
          const ux = (CX - x) / len, uy = (CY - y) / len;
          const exit = Math.min(ux ? 135 / Math.abs(ux) : Infinity, uy ? 70 / Math.abs(uy) : Infinity);
          const at = (d, side = 0) => [x + ux * d - uy * side, y + uy * d + ux * side];
          // 下注筹码
          if (p.bet > 0) {
            const [bx2, by2] = at(exit + 46);
            layer.append(svg('circle', { cx: bx2 - 22, cy: by2, r: 13, fill: seatColor(j), stroke: INK, 'stroke-width': 1.4 }));
            layer.append(svg('circle', { cx: bx2 - 22, cy: by2, r: 7, fill: 'none', stroke: PAPER, 'stroke-width': 1.4, 'stroke-dasharray': '3 3' }));
            layer.append(svg('text', { x: bx2 - 2, y: by2 + 8, 'font-size': 24, 'font-weight': 700, class: 'pk-mono' }, p.bet));
          }
          // 庄位标记：框外侧、偏开下注筹码
          if (view.button === p.seat && !p.out) {
            const [dx, dy] = at(exit + 30, 110);
            layer.append(svg('circle', { cx: dx, cy: dy, r: 19, fill: PAPER, stroke: INK, 'stroke-width': 2 }));
            layer.append(svg('text', { x: dx, y: dy + 7, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 800 }, 'D'));
          }
          layer.append(seatBox(view, p, j, x, y, winners, best));
        });

        // 底部：玩家行动时是操作条，否则是本手最近的行动
        renderControls(view, movable, actions);
        if (ctlBox.style.display === 'none' && view.log.length) {
          const recent = view.log.slice(-6).map((e) => `${e.seat.slice(1)} 号位 ${e.text}`).join(' · ');
          layer.append(svg('text', { x: CX, y: 950, 'text-anchor': 'middle', 'font-size': 21, class: 'pk-mono pk-muted' }, recent));
        }
      },
    };
  },
};

/** 一个座位：名字位、筹码、底牌、状态、胜率 */
function seatBox(view, p, j, x, y, winners, best) {
  const w = 270, h = 140;
  const acting = view.toAct === p.seat;
  const win = winners.has(p.seat);
  const g = svg('g', { class: `pk-seat${p.folded && p.inHand && !p.out ? ' folded' : ''}${p.out ? ' out' : ''}${acting ? ' acting' : ''}${win ? ' win' : ''}`, transform: `translate(${x - w / 2} ${y - h / 2})` });
  g.append(svg('rect', { class: 'pk-box', width: w, height: h }));
  g.append(svg('rect', { width: w, height: 32, fill: p.out ? '#8a857a' : seatColor(j) }));
  const head = `${p.name}${p.position ? ` · ${p.position}` : ''}`;
  g.append(svg('text', { x: 10, y: 23, 'font-size': 18, 'font-weight': 700, style: `fill:${PAPER}` }, head));
  if (p.played && (view.handNo > 1 || view.over)) {
    const bb = Math.abs(p.bb100) >= 100 ? Math.round(p.bb100) : p.bb100;
    g.append(svg('text', { x: w - 8, y: 22, 'text-anchor': 'end', 'font-size': 13, class: 'pk-mono', style: `fill:${PAPER};opacity:.9` }, `${signed(bb)} bb/100`));
  }
  if (acting) g.append(svg('rect', { class: 'pk-acting-dot', x: -9, y: h / 2 - 9, width: 18, height: 18 }));

  if (p.out && !p.inHand) {
    g.append(svg('text', { x: w / 2, y: 98, 'text-anchor': 'middle', 'font-size': 34, 'font-weight': 800, 'letter-spacing': 8, class: 'pk-muted' }, '出局'));
    return g;
  }
  // 底牌
  if (p.inHand) {
    const cw = 58, chh = 82;
    for (let k = 0; k < 2; k++) {
      const c = p.cards ? p.cards[k] : null;
      g.append(card(10 + k * (cw + 6), 44, cw, chh, c, { hl: !!c && best.has(c) && win, dim: p.folded }));
    }
  }
  // 右侧：筹码、动作、胜率
  const rx = 144;
  g.append(svg('text', { x: rx, y: 76, 'font-size': 32, 'font-weight': 700, class: 'pk-mono' }, p.stack));
  let status = p.last || '';
  let cls = 'pk-muted';
  if (view.result && win) { status = `赢下 ${p.won}`; cls = 'pk-red'; }
  else if (p.out) status = '出局';
  else if (p.folded) status = '弃牌';
  else if (p.allin && !view.result) { status = '全下'; cls = 'pk-red'; }
  if (status) g.append(svg('text', { x: rx, y: 104, 'font-size': 19, class: cls }, status.length > 9 ? `${status.slice(0, 8)}…` : status));
  if (p.handName) g.append(svg('text', { x: rx, y: 129, 'font-size': 17, class: win ? 'pk-red' : 'pk-muted' }, p.handName.length > 9 ? `${p.handName.slice(0, 8)}…` : p.handName));
  else if (p.equity !== null && p.equity !== undefined) {
    g.append(svg('text', { x: rx, y: 131, 'font-size': 22, 'font-weight': 700, class: 'pk-red pk-mono' }, `胜率 ${Math.round(p.equity * 100)}%`));
  }
  return g;
}
