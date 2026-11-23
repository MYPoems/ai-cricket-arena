// 谁是卧底画面：圆桌，座位围成一圈；每人显示头像位、座位号、出局标记、最近一句发言气泡；
// 投票时显示「→3号」和得票数；上帝视角显示每人的词和身份（卧底朱红），中间显示轮次、阶段和本局词对。
// 玩家本人：描述阶段在桌面中间输入一句话发言；投票阶段点选其他存活玩家的头像投票。

const NS = 'http://www.w3.org/2000/svg';
const W = 1600, H = 1000, CX = 800, CY = 500;
const RX = 640, RY = 372; // 座位所在的椭圆
const AV = 46; // 头像半径
const FS = 22; // 气泡字号
const LINE_UNITS = 13; // 气泡每行最多的字宽（汉字 = 1）
// 座位色：不用朱红，朱红留给卧底和出局标记
const COLORS = ['var(--black-side)', '#3559b5', '#9a5d24', '#2f7a70', '#7d3c98', '#a17a12', '#6b6b6b', '#4f6b2f'];
const PHASE = { speak: '描述', vote: '投票', tiespeak: '平票发言', revote: '平票重投', over: '结束' };

const CSS = `
.uc-stage { position: relative; width: 100%; height: 100%; container-type: size; }
.uc-stage > svg { width: 100%; height: 100%; display: block; user-select: none; }
.uc-table { fill: var(--panel-2); stroke: var(--line); stroke-width: 2.5; }
.uc-table-in { fill: none; stroke: var(--rule); stroke-width: 1.5; }
.uc-phase { font: 600 24px var(--mono); letter-spacing: .12em; fill: var(--muted); text-anchor: middle; }
.uc-words { font: 600 36px var(--serif); fill: var(--text); text-anchor: middle; }
.uc-words .k { font: 500 20px var(--mono); fill: var(--muted); letter-spacing: .08em; }
.uc-words .spy { fill: var(--red); }
.uc-note { font: 400 22px var(--serif); fill: var(--muted); text-anchor: middle; }
.uc-note.win { fill: var(--red); font-weight: 600; }
.uc-seat .av { fill: var(--panel); stroke: var(--line); stroke-width: 2.5; }
.uc-seat .fig { opacity: .85; }
.uc-seat .tag-bg { stroke: none; }
.uc-seat .tag { font: 600 20px var(--mono); letter-spacing: .06em; fill: var(--bg); text-anchor: middle; dominant-baseline: central; }
.uc-seat .id { font: 500 21px var(--serif); fill: var(--muted); text-anchor: middle; }
.uc-seat .id.spy { fill: var(--red); font-weight: 700; }
.uc-seat.spy .av { stroke: var(--red); stroke-width: 4; }
.uc-seat.out .av, .uc-seat.out .fig { opacity: .35; }
.uc-seat .stamp rect { fill: none; stroke: var(--red); stroke-width: 3; }
.uc-seat .stamp text { font: 700 24px var(--serif); fill: var(--red); text-anchor: middle; dominant-baseline: central; letter-spacing: .1em; }
.uc-seat .ring { fill: none; stroke: var(--red); stroke-width: 3; stroke-dasharray: 9 6; animation: uc-spin 6s linear infinite; transform-box: fill-box; transform-origin: center; }
.uc-seat .to { font: 600 22px var(--mono); fill: var(--text); text-anchor: middle; }
.uc-seat .to.wait { fill: var(--muted); font-weight: 400; }
.uc-seat .cnt rect { fill: var(--red); }
.uc-seat .cnt text { font: 700 20px var(--mono); fill: var(--paper); text-anchor: middle; dominant-baseline: central; }
.uc-seat.pick { cursor: pointer; }
.uc-seat.pick .av { stroke-dasharray: 6 5; }
.uc-seat.pick:hover .av { stroke: var(--red); stroke-width: 5; stroke-dasharray: none; }
.uc-seat.me .av { stroke-width: 4.5; }
.uc-bubble .b { fill: var(--panel); stroke: var(--line); stroke-width: 1.6; }
.uc-bubble text { font: 400 ${FS}px var(--serif); fill: var(--text); }
.uc-bubble.old { opacity: .42; }
.uc-bubble.tie .b { stroke: var(--red); }
@keyframes uc-spin { to { transform: rotate(360deg); } }
.uc-form { position: absolute; left: 30%; width: 40%; top: 59%; display: flex; gap: .8cqw; align-items: stretch; font-size: 1.55cqw; }
.uc-form[hidden] { display: none; }
.uc-form input { flex: 1; min-width: 0; font: inherit; font-family: var(--serif); padding: .45em .7em; border: 1.5px solid var(--line); border-radius: 0; background: var(--panel); color: var(--text); outline: none; }
.uc-form input:focus { border-color: var(--red); }
.uc-form .n { align-self: center; font: 500 .8em var(--mono); color: var(--muted); min-width: 3.2em; text-align: right; }
.uc-form .n.bad { color: var(--red); }
.uc-form button { font: 600 1em var(--serif); padding: 0 1.1em; border: 1.5px solid var(--line); border-radius: 0; background: var(--text); color: var(--bg); cursor: pointer; }
.uc-form button:hover:not(:disabled) { background: var(--red); border-color: var(--red); color: var(--paper); }
.uc-form button:disabled { opacity: .4; cursor: not-allowed; }
`;

function injectStyle() {
  if (document.getElementById('uc-style')) return;
  const st = document.createElement('style');
  st.id = 'uc-style';
  st.textContent = CSS;
  document.head.append(st);
}

const svg = (tag, attrs = {}, text = null) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  if (text !== null) el.textContent = text;
  return el;
};
const no = (seat) => Number(String(seat).slice(1));
const unitOf = (ch) => (/[\u0000-ÿ]/.test(ch) ? 0.55 : 1);

/** 按字宽折行，最多 3 行 */
function wrap(text, max = LINE_UNITS) {
  const lines = [];
  let cur = '', u = 0;
  for (const ch of text) {
    const w = unitOf(ch);
    if (u + w > max) { lines.push(cur); cur = ''; u = 0; }
    cur += ch; u += w;
  }
  if (cur) lines.push(cur);
  if (lines.length > 3) { lines.length = 3; lines[2] = `${lines[2].slice(0, -1)}…`; }
  const width = Math.max(...lines.map((l) => [...l].reduce((a, c) => a + unitOf(c), 0)));
  return { lines, width };
}

/** 座位在椭圆上的位置：1 号在正上方，顺时针排列 */
function seatPos(i, n) {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) };
}

// 座位本身占的区域（相对座位中心）：上方投票标签，下方座位号和身份
const SEAT_BOX = { l: -92, r: 92, t: -AV - 48, b: AV + 76 };
const seatBox = (p) => ({ l: p.x + SEAT_BOX.l, r: p.x + SEAT_BOX.r, t: p.y + SEAT_BOX.t, b: p.y + SEAT_BOX.b });
const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

/**
 * 气泡位置：从座位出发，沿朝向桌子中心及左右偏转的几个方向推开，直到不压住座位本身；
 * 在这些候选里选和其他座位、已放好的气泡、中间文字重叠最少、离座位最近的一个。
 */
function bubbleBox(p, w, h, obstacles) {
  const base = Math.atan2(CY - p.y, CX - p.x);
  const own = seatBox(p);
  let best = null;
  for (const off of [0, -0.5, 0.5, -1, 1, -1.4, 1.4, -1.8, 1.8]) {
    const a = base + off;
    for (let t = 40; t < 560; t += 8) {
      const cx = p.x + Math.cos(a) * t, cy = p.y + Math.sin(a) * t;
      const box = { l: cx - w / 2 - 8, r: cx + w / 2 + 8, t: cy - h / 2 - 8, b: cy + h / 2 + 8 };
      if (area(box, own) > 0) continue;
      let cost = t + Math.abs(off) * 60;
      for (const o of obstacles) cost += area(box, o) * 0.5;
      cost += (Math.max(0, -box.l) + Math.max(0, box.r - W) + Math.max(0, -box.t) + Math.max(0, box.b - H)) * 50;
      if (!best || cost < best.cost) best = { cx, cy, cost, box };
      break;
    }
  }
  return best || { cx: CX, cy: CY, box: { l: CX, r: CX, t: CY, b: CY } };
}

export default {
  aspect: [16, 10],
  seatColor: (seat, index) => COLORS[(index ?? no(seat) - 1) % COLORS.length],

  createStage({ onAction }) {
    injectStyle();
    const root = document.createElement('div');
    root.className = 'uc-stage';
    const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '谁是卧底圆桌' });
    const table = svg('g');
    table.append(
      svg('ellipse', { class: 'uc-table', cx: CX, cy: CY, rx: 430, ry: 232 }),
      svg('ellipse', { class: 'uc-table-in', cx: CX, cy: CY, rx: 404, ry: 208 }),
    );
    const center = svg('g');
    const bubbles = svg('g');
    const seatsG = svg('g');
    el.append(table, center, seatsG, bubbles);

    // 发言输入框（玩家本人描述阶段）
    const form = document.createElement('form');
    form.className = 'uc-form';
    form.hidden = true;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 60;
    input.placeholder = '一句话描述你的词';
    input.autocomplete = 'off';
    const count = document.createElement('span');
    count.className = 'n';
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = '发言';
    form.append(input, count, send);
    root.append(el, form);

    let ctx = { maxLen: 30, word: null, key: null };
    const tooMany = (t) => [...t].length > ctx.maxLen;
    const hasWord = (t) => !!ctx.word && [...new Set(ctx.word)].every((c) => t.includes(c));
    const refreshCount = () => {
      const t = input.value.replace(/[\r\n]+/g, '').trim();
      const n = [...t].length;
      count.textContent = `${n}/${ctx.maxLen}`;
      const bad = tooMany(t) || hasWord(t);
      count.classList.toggle('bad', bad);
      count.title = hasWord(t) ? '不能说出自己的词' : '';
      send.disabled = !n || bad;
    };
    input.addEventListener('input', refreshCount);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = input.value.replace(/[\r\n]+/g, '').trim();
      if (!t || tooMany(t) || hasWord(t)) return;
      onAction(t);
    });

    return {
      el: root,
      render(view, { movable = null, actions = null } = {}) {
        if (!view || !view.seats) return;
        const n = view.seats.length;
        const pos = Object.fromEntries(view.seats.map((s, i) => [s, seatPos(i, n)]));
        const alive = new Set(view.alive || []);
        const outInfo = Object.fromEntries((view.outInfo || []).map((o) => [o.seat, o]));
        const pickable = new Set(movable && Array.isArray(actions) ? actions.map((a) => a.id) : []);
        const speaking = movable && (view.phase === 'speak' || view.phase === 'tiespeak') && view.speaker === movable;

        // 本次要显示的投票：投票阶段显示当前票；刚计完票、还没有新发言时显示上一次的结果
        let shown = null;
        const voting = view.phase === 'vote' || view.phase === 'revote';
        const lastLog = (view.voteLog || []).at(-1);
        if (voting && Object.keys(view.votes || {}).length) shown = { votes: view.votes, counts: null };
        else if (!voting && lastLog && (lastLog.after === view.speeches.length || (view.phase === 'tiespeak' && lastLog.round === view.round))) shown = { votes: lastLog.votes, counts: lastLog.counts };
        if (shown && !shown.counts) {
          shown.counts = {};
          for (const t of Object.values(shown.votes)) shown.counts[t] = (shown.counts[t] || 0) + 1;
        }
        const waiting = new Set(voting ? view.pending || [] : []);

        // ---------- 中间：轮次、阶段、词对 ----------
        center.replaceChildren();
        center.append(svg('text', { class: 'uc-phase', x: CX, y: CY - 78 }, `第 ${view.round} 轮 · ${PHASE[view.phase] || ''}`));
        const words = svg('text', { class: 'uc-words', x: CX, y: CY - 14 });
        if (view.pair) {
          words.append(svg('tspan', { class: 'k' }, '平民 '), svg('tspan', {}, view.pair.civ), svg('tspan', { class: 'k', dx: 34 }, '卧底 '), svg('tspan', { class: 'spy' }, view.pair.spy));
        } else if (view.myWord) {
          words.append(svg('tspan', { class: 'k' }, '你的词 '), svg('tspan', {}, view.myWord));
        } else {
          words.append(svg('tspan', { class: 'k' }, '词对未公开'));
        }
        center.append(words);
        let note = '';
        let win = false;
        if (view.result) { note = `${view.result.team}胜`; win = true; }
        else if (view.phase === 'tiespeak' || view.phase === 'revote') note = `平票：${(view.tied || []).map((s) => `${no(s)} 号`).join('、')}`;
        else if (lastLog && lastLog.round === view.round - 1 && view.phase === 'speak') {
          note = lastLog.out ? `上轮 ${no(lastLog.out)} 号出局（${lastLog.role}）` : '上轮无人出局';
        }
        if (note && !speaking) center.append(svg('text', { class: `uc-note${win ? ' win' : ''}`, x: CX, y: CY + 38 }, note));

        // ---------- 座位 ----------
        seatsG.replaceChildren();
        bubbles.replaceChildren();
        const toPlace = [];
        view.seats.forEach((s, i) => {
          const p = pos[s];
          const isOut = !alive.has(s);
          const ident = view.identity?.[s];
          const g = svg('g', { class: 'uc-seat', 'data-seat': s });
          g.classList.toggle('out', isOut);
          g.classList.toggle('spy', ident === '卧底');
          g.classList.toggle('me', s === view.viewer);
          if (pickable.has(s)) {
            g.classList.add('pick');
            g.addEventListener('click', () => onAction(s));
          }
          // 头像位：圆框里一个半身剪影
          g.append(svg('circle', { class: 'av', cx: p.x, cy: p.y, r: AV }));
          const fig = svg('g', { class: 'fig', fill: COLORS[i % COLORS.length] });
          fig.append(
            svg('circle', { cx: p.x, cy: p.y - 11, r: 15 }),
            svg('path', { d: `M ${p.x - 27} ${p.y + 31} Q ${p.x - 27} ${p.y + 8} ${p.x} ${p.y + 8} Q ${p.x + 27} ${p.y + 8} ${p.x + 27} ${p.y + 31} Z` }),
          );
          g.append(fig);
          if (view.speaker === s && view.phase !== 'over') g.append(svg('circle', { class: 'ring', cx: p.x, cy: p.y, r: AV + 9 }));
          // 座位号
          const tagText = `${no(s)} 号${s === view.viewer ? ' · 你' : ''}`;
          const tw = s === view.viewer ? 124 : 64;
          g.append(svg('rect', { class: 'tag-bg', x: p.x - tw / 2, y: p.y + AV + 8, width: tw, height: 28, fill: COLORS[i % COLORS.length] }));
          g.append(svg('text', { class: 'tag', x: p.x, y: p.y + AV + 23 }, tagText));
          // 身份和词
          const role = view.roles?.[s];
          if (role) g.append(svg('text', { class: `id${ident === '卧底' ? ' spy' : ''}`, x: p.x, y: p.y + AV + 62 }, role));
          // 出局印章
          if (isOut) {
            const st = svg('g', { class: 'stamp', transform: `rotate(-14 ${p.x} ${p.y})` });
            st.append(svg('rect', { x: p.x - 42, y: p.y - 18, width: 84, height: 36 }), svg('text', { x: p.x, y: p.y + 1 }, '出局'));
            g.append(st);
            const info = outInfo[s];
            if (info && !role) g.append(svg('text', { class: 'id', x: p.x, y: p.y + AV + 62 }, `第 ${info.round} 轮出局`));
          }
          // 投给谁、得票数
          if (shown?.votes?.[s]) g.append(svg('text', { class: 'to', x: p.x, y: p.y - AV - 14 }, `→${no(shown.votes[s])}号`));
          else if (waiting.has(s)) g.append(svg('text', { class: 'to wait', x: p.x, y: p.y - AV - 14 }, '投票中'));
          const c = shown?.counts?.[s];
          if (c) {
            const cnt = svg('g', { class: 'cnt' });
            cnt.append(svg('rect', { x: p.x + AV * 0.55, y: p.y - AV - 2, width: 58, height: 32 }), svg('text', { x: p.x + AV * 0.55 + 29, y: p.y - AV + 15 }, `${c} 票`));
            g.append(cnt);
          }
          seatsG.append(g);

          // 发言气泡：这一轮说过的话；还没说的显示上一句（淡）
          if (isOut && view.phase !== 'over') return;
          const mine = (view.speeches || []).filter((x) => x.seat === s);
          const last = mine.at(-1);
          if (!last) return;
          const old = last.round !== view.round;
          if (old && isOut) return;
          const { lines, width } = wrap(last.text);
          toPlace.push({ p, lines, old, tie: last.tie, w: width * FS + 28, h: lines.length * (FS + 8) + 18 });
        });

        // 气泡：先放本轮的，再放旧的；避开其他座位、中间文字和输入框
        const obstacles = [{ l: CX - 240, r: CX + 240, t: CY - 112, b: CY + (note && !speaking ? 52 : 4) }];
        if (speaking) obstacles.push({ l: W * 0.3, r: W * 0.7, t: H * 0.59 - 10, b: H * 0.59 + 80 });
        toPlace.sort((a, b) => Number(a.old) - Number(b.old));
        for (const bb of toPlace) {
          const others = Object.values(pos).filter((q) => q !== bb.p).map(seatBox);
          const { cx, cy, box } = bubbleBox(bb.p, bb.w, bb.h, [...obstacles, ...others]);
          obstacles.push(box);
          const { p, w: bw, h: bh } = bb;
          const bg = svg('g', { class: `uc-bubble${bb.old ? ' old' : ''}${bb.tie ? ' tie' : ''}` });
          // 尾巴指向座位
          const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          const edge = Math.min(Math.abs((bw / 2) / (ux || 1e-6)), Math.abs((bh / 2) / (uy || 1e-6)));
          const ex = cx + ux * edge, ey = cy + uy * edge;
          bg.append(svg('path', { class: 'b', d: `M ${ex - uy * 10} ${ey + ux * 10} L ${ex + ux * 22} ${ey + uy * 22} L ${ex + uy * 10} ${ey - ux * 10} Z` }));
          bg.append(svg('rect', { class: 'b', x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh }));
          bb.lines.forEach((l, k) => bg.append(svg('text', { x: cx - bw / 2 + 14, y: cy - bh / 2 + 9 + FS + k * (FS + 8) - 3 }, l)));
          bubbles.append(bg);
        }

        // ---------- 发言输入 ----------
        const key = speaking ? `${view.round}-${view.phase}-${(view.speeches || []).length}` : null;
        if (key !== ctx.key && key) input.value = '';
        ctx = { maxLen: view.maxLen || 30, word: view.myWord, key };
        form.hidden = !speaking;
        if (speaking) {
          refreshCount();
          if (document.activeElement !== input) input.focus({ preventScroll: true });
        }
      },
    };
  },
};
