// 斗地主画面：横向桌面，当前视角的座位在下，下家在右、上家在左。
// 纸色牌面、墨字，大小王朱红字；其他两家在玩家视角下只显示牌背和张数。
// 玩家本人行动时：点选手牌（选中的牌抬高），按钮「不出」「出牌」；叫分阶段为「不叫」「1 分」「2 分」「3 分」。

const NS = 'http://www.w3.org/2000/svg';
const W = 1600, H = 1000;
const SEATS = ['p1', 'p2', 'p3'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王'];
const rankOf = (n) => RANKS.indexOf(n);
const isJoker = (n) => n === '小王' || n === '大王';
const COLORS = ['var(--red)', 'var(--black-side)', '#3559b5']; // 选手卡上的阵营色（随深浅色主题变）
const TAG_COLORS = ['#c8321b', '#131311', '#3559b5']; // 牌桌是固定的纸色，用固定色

const svg = (tag, attrs = {}, text = null) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  if (text !== null) el.textContent = text;
  return el;
};

const STYLE = `
svg.ddz { font-family: var(--serif); }
svg.ddz .ddz-table { fill: var(--wood-1); stroke: var(--board-line); stroke-width: 1.5; }
svg.ddz .ddz-rule { stroke: var(--board-line); stroke-width: 1; opacity: .18; }
svg.ddz .ddz-card rect.face { fill: #fbf8f0; stroke: #131311; stroke-width: 1.6; }
svg.ddz .ddz-card text { fill: #131311; font-weight: 700; font-family: var(--serif); }
svg.ddz .ddz-card.joker text { fill: #c8321b; font-family: var(--kai); }
svg.ddz .ddz-card.sel rect.face { stroke: #c8321b; stroke-width: 3; fill: #fff6ef; }
svg.ddz .ddz-card.pick { cursor: pointer; }
svg.ddz .ddz-card.pick:hover rect.face { fill: #fffdf8; }
svg.ddz .ddz-back rect.outer { fill: #131311; stroke: #131311; stroke-width: 1.2; }
svg.ddz .ddz-back rect.inner { fill: none; stroke: #f2efe7; stroke-width: 1; opacity: .55; }
svg.ddz .ddz-back path { stroke: #f2efe7; stroke-width: 1; opacity: .25; fill: none; }
svg.ddz .ddz-name { font-size: 26px; font-weight: 700; fill: var(--board-line); }
svg.ddz .ddz-tag { font: 600 17px var(--mono); fill: #f2efe7; }
svg.ddz .ddz-tagbox { stroke: none; }
svg.ddz .ddz-meta { font: 500 18px var(--mono); fill: var(--board-line); opacity: .7; }
svg.ddz .ddz-count { font: 700 40px var(--mono); fill: var(--board-line); }
svg.ddz .ddz-turn { fill: #c8321b; }
svg.ddz .ddz-say { font-size: 30px; font-weight: 700; fill: var(--board-line); opacity: .55; font-family: var(--kai); }
svg.ddz .ddz-say.bid { fill: #c8321b; opacity: .9; }
svg.ddz .ddz-type { font: 500 15px var(--mono); fill: var(--board-line); opacity: .55; }
svg.ddz .ddz-stale { opacity: .45; }
svg.ddz .ddz-label { font: 500 15px var(--mono); fill: var(--board-line); opacity: .6; letter-spacing: 2px; }
svg.ddz .ddz-big { font: 700 30px var(--mono); fill: var(--board-line); }
svg.ddz .ddz-big.red { fill: #c8321b; }
svg.ddz .ddz-result { font-size: 40px; font-weight: 800; fill: #c8321b; font-family: var(--kai); }
svg.ddz .ddz-btn rect { fill: #fbf8f0; stroke: #131311; stroke-width: 2; }
svg.ddz .ddz-btn text { font-size: 26px; font-weight: 700; fill: #131311; pointer-events: none; font-family: var(--serif); }
svg.ddz .ddz-btn.primary rect { fill: #131311; }
svg.ddz .ddz-btn.primary text { fill: #f2efe7; }
svg.ddz .ddz-btn { cursor: pointer; }
svg.ddz .ddz-btn:hover rect { filter: drop-shadow(4px 4px 0 rgb(19 19 17 / .18)); }
svg.ddz .ddz-btn.off { opacity: .3; pointer-events: none; }
`;

let styled = false;
function ensureStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.dataset.game = 'doudizhu';
  st.textContent = STYLE;
  document.head.append(st);
}

/** 一张牌：x, y 为左上角 */
function card(name, x, y, w, h, { sel = false, pick = false } = {}) {
  const joker = isJoker(name);
  const g = svg('g', { class: `ddz-card${joker ? ' joker' : ''}${sel ? ' sel' : ''}${pick ? ' pick' : ''}`, transform: `translate(${x} ${y})` });
  g.append(svg('rect', { class: 'face', x: 0, y: 0, width: w, height: h }));
  if (joker) {
    const fs = w * 0.36;
    g.append(svg('text', { x: w * 0.1, y: h * 0.06 + fs, 'font-size': fs }, name[0]));
    g.append(svg('text', { x: w * 0.1, y: h * 0.06 + fs * 2.05, 'font-size': fs }, name[1]));
  } else {
    const fs = name === '10' ? w * 0.36 : w * 0.42;
    g.append(svg('text', { x: w * 0.08, y: h * 0.06 + fs * 0.95, 'font-size': fs, 'letter-spacing': name === '10' ? -2 : 0 }, name));
  }
  return g;
}

function back(x, y, w, h) {
  const g = svg('g', { class: 'ddz-back', transform: `translate(${x} ${y})` });
  g.append(svg('rect', { class: 'outer', x: 0, y: 0, width: w, height: h }));
  g.append(svg('rect', { class: 'inner', x: 4, y: 4, width: w - 8, height: h - 8 }));
  g.append(svg('path', { d: `M4 4 L${w - 4} ${h - 4} M${w - 4} 4 L4 ${h - 4}` }));
  return g;
}

/** 一排牌：anchor = 'left' | 'right' | 'center'，maxW 限制总宽度 */
function row(names, { x, y, w, h, step, maxW, anchor = 'left', sel = null, pick = false, onPick = null }) {
  const g = svg('g');
  const n = names.length;
  if (!n) return g;
  const st = n > 1 ? Math.min(step, (maxW - w) / (n - 1)) : 0;
  const total = w + st * (n - 1);
  const x0 = anchor === 'right' ? x - total : anchor === 'center' ? x - total / 2 : x;
  names.forEach((nm, i) => {
    const on = sel?.has(i);
    const c = card(nm, x0 + i * st, y - (on ? 26 : 0), w, h, { sel: on, pick });
    if (onPick) c.addEventListener('click', (e) => { e.stopPropagation(); onPick(i); });
    g.append(c);
  });
  return g;
}

/** 牌按大到小显示 */
const desc = (names) => names.slice().sort((a, b) => rankOf(b) - rankOf(a));
const ascId = (names) => names.slice().sort((a, b) => rankOf(a) - rankOf(b)).join(' ');

function button(label, x, y, w, h, { primary = false, off = false, onClick }) {
  const g = svg('g', { class: `ddz-btn${primary ? ' primary' : ''}${off ? ' off' : ''}`, transform: `translate(${x} ${y})`, role: 'button' });
  g.append(svg('rect', { x: 0, y: 0, width: w, height: h }));
  g.append(svg('text', { x: w / 2, y: h / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, label));
  g.addEventListener('click', (e) => { e.stopPropagation(); if (!off) onClick(); });
  return g;
}

export default {
  aspect: [16, 10],
  seatColor: (seat, i) => COLORS[(i ?? SEATS.indexOf(seat)) % COLORS.length],

  createStage({ onAction }) {
    ensureStyle();
    const el = svg('svg', { class: 'board ddz', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '斗地主牌桌' });
    const bg = svg('rect', { class: 'ddz-table', x: 0, y: 0, width: W, height: H });
    const layer = svg('g');
    el.append(bg, layer);

    let sel = new Set();
    let handKey = '';
    let last = null; // { view, opts }

    const redraw = () => last && draw(last.view, last.opts);
    bg.addEventListener('click', () => { if (sel.size) { sel = new Set(); redraw(); } });

    function seatHeader(view, seat, x, y, anchor) {
      const g = svg('g');
      const idx = SEATS.indexOf(seat);
      const name = view.seatNames?.[seat] || seat;
      const role = view.roles?.[seat];
      const turn = view.turn === seat;
      const parts = [];
      // 座位色块 + 座位名
      const tagW = 92;
      const tx = anchor === 'right' ? x - tagW : x;
      parts.push(svg('rect', { class: 'ddz-tagbox', x: tx, y: y - 22, width: tagW, height: 30, fill: TAG_COLORS[idx] }));
      parts.push(svg('text', { class: 'ddz-tag', x: tx + tagW / 2, y: y - 7, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, name));
      const info = [role, `${view.counts[seat]} 张`].filter(Boolean).join(' · ');
      const ix = anchor === 'right' ? tx - 14 : tx + tagW + 14;
      parts.push(svg('text', { class: 'ddz-name', x: ix, y: y, 'text-anchor': anchor === 'right' ? 'end' : 'start' }, info));
      if (turn) {
        const dx = anchor === 'right' ? x + 18 : x - 18;
        parts.push(svg('circle', { class: 'ddz-turn', cx: dx, cy: y - 7, r: 8 }));
      }
      g.append(...parts);
      return g;
    }

    /** 某座位在桌上本轮的出牌（或叫分、不出） */
    function tableItem(view, seat, { x, y, anchor, maxW }) {
      const t = view.table?.[seat];
      const g = svg('g', { class: view.stale ? 'ddz-stale' : '' });
      if (!t) return g;
      const tx = anchor === 'right' ? x : anchor === 'center' ? x : x;
      const ta = anchor === 'right' ? 'end' : anchor === 'center' ? 'middle' : 'start';
      if (t.text) g.append(svg('text', { class: `ddz-say${t.bid ? ' bid' : ''}`, x: tx, y: y + 54, 'text-anchor': ta }, t.text));
      else if (t.pass) g.append(svg('text', { class: 'ddz-say', x: tx, y: y + 54, 'text-anchor': ta }, '不出'));
      else {
        g.append(row(t.cards, { x, y, w: 64, h: 90, step: 34, maxW, anchor }));
        g.append(svg('text', { class: 'ddz-type', x: tx, y: y + 114, 'text-anchor': ta }, t.type || ''));
      }
      return g;
    }

    function sideSeat(view, seat, side) {
      const g = svg('g');
      const left = side === 'left';
      const x = left ? 60 : W - 60;
      const anchor = left ? 'left' : 'right';
      g.append(seatHeader(view, seat, x, 60, anchor));
      const hand = view.hands?.[seat];
      if (hand) {
        const d = desc(hand);
        const rows = [d.slice(0, 10), d.slice(10)];
        rows.forEach((r, i) => g.append(row(r, { x, y: 92 + i * 92, w: 58, h: 82, step: 40, maxW: 430, anchor })));
      } else {
        const n = view.counts[seat];
        const k = Math.min(n, 20);
        const step = 10, w = 62, h = 88;
        const total = w + step * Math.max(0, k - 1);
        const x0 = left ? x : x - total;
        for (let i = 0; i < k; i++) g.append(back(x0 + i * step, 100, w, h));
        g.append(svg('text', { class: 'ddz-count', x: left ? x0 + total + 18 : x0 - 18, y: 158, 'text-anchor': left ? 'start' : 'end' }, String(n)));
      }
      g.append(tableItem(view, seat, { x: left ? 300 : W - 300, y: 330, anchor, maxW: 470 }));
      return g;
    }

    function center(view) {
      const g = svg('g');
      // 底牌
      g.append(svg('text', { class: 'ddz-label', x: W / 2, y: 34, 'text-anchor': 'middle' }, view.deals ? `底牌 · 重发 ${view.deals} 次` : '底牌'));
      const bw = 64, bh = 90, gap = 12;
      const bx = W / 2 - (bw * 3 + gap * 2) / 2;
      for (let i = 0; i < 3; i++) {
        const nm = view.bottom?.[i];
        g.append(nm ? card(nm, bx + i * (bw + gap), 48, bw, bh) : back(bx + i * (bw + gap), 48, bw, bh));
      }
      // 叫分与倍数
      const bidTxt = view.bid ? `${view.bid} 分` : '—';
      g.append(svg('text', { class: 'ddz-label', x: W / 2 - 80, y: 180, 'text-anchor': 'middle' }, '叫分'));
      g.append(svg('text', { class: 'ddz-big', x: W / 2 - 80, y: 216, 'text-anchor': 'middle' }, bidTxt));
      g.append(svg('text', { class: 'ddz-label', x: W / 2 + 80, y: 180, 'text-anchor': 'middle' }, '倍数'));
      g.append(svg('text', { class: `ddz-big${view.multiplier > 1 ? ' red' : ''}`, x: W / 2 + 80, y: 216, 'text-anchor': 'middle' }, `×${view.multiplier || 1}`));
      if (view.result) {
        const r = view.result;
        const txt = `${r.landlordWins ? '地主胜' : '农民胜'}${r.spring ? ' · 春天' : r.anti ? ' · 反春' : ''} · ${r.score} 分`;
        g.append(svg('text', { class: 'ddz-result', x: W / 2, y: 274, 'text-anchor': 'middle' }, txt));
      }
      return g;
    }

    function draw(view, opts) {
      const { movable = null, actions = null } = opts;
      const me = view.viewer && SEATS.includes(view.viewer) ? view.viewer : 'p1';
      const i = SEATS.indexOf(me);
      const right = SEATS[(i + 1) % 3]; // 下家
      const leftS = SEATS[(i + 2) % 3]; // 上家
      const canAct = movable === me && Array.isArray(actions) && actions.length > 0;
      const ids = new Set((actions || []).map((a) => a.id));
      el.classList.toggle('can-move', canAct);

      layer.replaceChildren();
      layer.append(svg('line', { class: 'ddz-rule', x1: 40, y1: 296, x2: W - 40, y2: 296 }));
      layer.append(center(view));
      layer.append(sideSeat(view, leftS, 'left'));
      layer.append(sideSeat(view, right, 'right'));

      // 自己：桌上的牌、按钮、手牌
      layer.append(tableItem(view, me, { x: W / 2, y: 520, anchor: 'center', maxW: 760 }));
      layer.append(seatHeader(view, me, 60, 730, 'left'));
      const hand = view.hands?.[me];
      if (hand) {
        const d = desc(hand);
        const key = `${me}|${d.join(',')}`;
        if (key !== handKey) { sel = new Set(); handKey = key; }
        if (!canAct || view.phase !== 'play') sel = new Set();
        const pick = canAct && view.phase === 'play';
        layer.append(row(d, {
          x: W / 2, y: 790, w: 100, h: 140, step: 62, maxW: 1240, anchor: 'center', sel, pick,
          onPick: pick ? (k) => { if (sel.has(k)) sel.delete(k); else sel.add(k); redraw(); } : null,
        }));
        if (canAct) {
          const by = 668, bh = 56;
          if (view.phase === 'bid') {
            const labels = [['叫0', '不叫'], ['叫1', '1 分'], ['叫2', '2 分'], ['叫3', '3 分']];
            const bw = 130, gap = 24;
            const x0 = W / 2 - (bw * 4 + gap * 3) / 2;
            labels.forEach(([id, lb], k) => layer.append(button(lb, x0 + k * (bw + gap), by, bw, bh, {
              primary: id !== '叫0', off: !ids.has(id), onClick: () => onAction(id),
            })));
          } else {
            const chosen = ascId([...sel].map((k) => d[k]));
            const bw = 150, gap = 30;
            layer.append(button('不出', W / 2 - bw - gap / 2, by, bw, bh, {
              off: !ids.has('不出'), onClick: () => { sel = new Set(); onAction('不出'); },
            }));
            layer.append(button('出牌', W / 2 + gap / 2, by, bw, bh, {
              primary: true, off: !sel.size || !ids.has(chosen), onClick: () => { sel = new Set(); onAction(chosen); },
            }));
          }
        }
      } else {
        // 没有自己的手牌信息（不应出现）：显示牌背
        const n = view.counts?.[me] || 0;
        for (let k = 0; k < Math.min(n, 20); k++) layer.append(back(W / 2 - 300 + k * 30, 790, 100, 140));
      }
    }

    return {
      el,
      render(view, opts = {}) {
        last = { view, opts };
        draw(view, opts);
      },
    };
  },
};
