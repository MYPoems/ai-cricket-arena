// 狼人杀画面：沿用谁是卧底的圆桌。中间显示「第 N 天 · 夜晚 / 白天」、阶段和昨夜结果；
// 座位显示头像、座位号、死亡印章、最近一句发言或遗言气泡、投票去向和得票；猎人开枪画一条连线。
// 上帝视角：每人的身份（狼人朱红）、夜间行动小字（狼人提名、预言家查验、女巫用药）。
// 玩家本人：点头像选目标（刀人、查验、投票、开枪、下毒），按钮选空刀 / 弃票 / 不开枪 / 救人 / 不用药，输入框发言和留遗言。

const NS = 'http://www.w3.org/2000/svg';
const W = 1600, H = 1000, CX = 800, CY = 500;
const RX = 640, RY = 372; // 座位所在的椭圆
const AV = 46; // 头像半径
const FS = 22; // 气泡字号
const LINE_UNITS = 13; // 气泡每行最多的字宽（汉字 = 1）
// 座位色：不用朱红，朱红留给狼人和死亡印章
const COLORS = ['var(--black-side)', '#3559b5', '#9a5d24', '#2f7a70', '#7d3c98', '#a17a12', '#6b6b6b', '#4f6b2f', '#8a4f6b'];
const PHASE = {
  wolf: '狼人行动', seer: '预言家查验', witch: '女巫用药', lastword: '遗言', hunter: '猎人开枪',
  speak: '发言', vote: '放逐投票', tiespeak: '平票发言', revote: '平票重投', over: '结束', night: '天黑请闭眼', wait: '结算',
};
const NIGHT_PHASES = new Set(['wolf', 'seer', 'witch', 'night']);
const STAMP = { wolf: '刀杀', poison: '毒杀', vote: '放逐', shot: '枪杀' };
const NONE_LABEL = { wolf: '空刀', vote: '弃票', revote: '弃票', hunter: '不开枪' };

const CSS = `
.ww-stage { position: relative; width: 100%; height: 100%; container-type: size; }
.ww-stage > svg { width: 100%; height: 100%; display: block; user-select: none; }
.ww-table { fill: var(--panel-2); stroke: var(--line); stroke-width: 2.5; transition: fill .6s; }
.ww-stage.night .ww-table { fill: color-mix(in srgb, var(--text) 14%, var(--panel-2)); }
.ww-table-in { fill: none; stroke: var(--rule); stroke-width: 1.5; }
.ww-icon { fill: var(--muted); stroke: var(--muted); }
.ww-phase { font: 600 24px var(--mono); letter-spacing: .12em; fill: var(--muted); text-anchor: middle; }
.ww-main { font: 600 36px var(--serif); fill: var(--text); text-anchor: middle; }
.ww-main .k { font: 500 20px var(--mono); fill: var(--muted); letter-spacing: .08em; }
.ww-main .wolf { fill: var(--red); }
.ww-note { font: 400 22px var(--serif); fill: var(--muted); text-anchor: middle; }
.ww-note.hot { fill: var(--red); font-weight: 600; }
.ww-god { font: 400 19px var(--mono); fill: var(--muted); text-anchor: middle; letter-spacing: .02em; }
.ww-seat .av { fill: var(--panel); stroke: var(--line); stroke-width: 2.5; }
.ww-seat .fig { opacity: .85; }
.ww-seat .tag { font: 600 20px var(--mono); letter-spacing: .06em; fill: var(--bg); text-anchor: middle; dominant-baseline: central; }
.ww-seat .id { font: 500 21px var(--serif); fill: var(--muted); text-anchor: middle; }
.ww-seat .id.wolf { fill: var(--red); font-weight: 700; }
.ww-seat.wolf .av { stroke: var(--red); stroke-width: 4; }
.ww-seat.out .av, .ww-seat.out .fig { opacity: .35; }
.ww-seat .stamp rect { fill: none; stroke: var(--red); stroke-width: 3; }
.ww-seat .stamp text { font: 700 24px var(--serif); fill: var(--red); text-anchor: middle; dominant-baseline: central; letter-spacing: .1em; }
.ww-seat .ring { fill: none; stroke: var(--red); stroke-width: 3; stroke-dasharray: 9 6; animation: ww-spin 6s linear infinite; transform-box: fill-box; transform-origin: center; }
.ww-seat .to { font: 600 22px var(--mono); fill: var(--text); text-anchor: middle; }
.ww-seat .to.wait { fill: var(--muted); font-weight: 400; }
.ww-seat .to.act { fill: var(--muted); font-weight: 500; font-size: 20px; }
.ww-seat .to.act.hot { fill: var(--red); }
.ww-seat .cnt rect { fill: var(--red); }
.ww-seat .cnt text { font: 700 20px var(--mono); fill: var(--paper); text-anchor: middle; dominant-baseline: central; }
.ww-seat.pick { cursor: pointer; }
.ww-seat.pick .av { stroke-dasharray: 6 5; }
.ww-seat.pick:hover .av { stroke: var(--red); stroke-width: 5; stroke-dasharray: none; }
.ww-seat.me .av { stroke-width: 4.5; }
.ww-shot { stroke: var(--red); stroke-width: 3; stroke-dasharray: 12 7; fill: none; }
.ww-shot-head { fill: var(--red); }
.ww-bubble .b { fill: var(--panel); stroke: var(--line); stroke-width: 1.6; }
.ww-bubble text { font: 400 ${FS}px var(--serif); fill: var(--text); }
.ww-bubble.old { opacity: .42; }
.ww-bubble.tie .b { stroke: var(--red); }
.ww-bubble.last .b { stroke-dasharray: 7 5; }
.ww-bubble.last text { font-style: italic; }
@keyframes ww-spin { to { transform: rotate(360deg); } }
.ww-form, .ww-ctrl { position: absolute; left: 30%; width: 40%; top: 59%; display: flex; gap: .8cqw; align-items: stretch; justify-content: center; font-size: 1.55cqw; }
.ww-form[hidden], .ww-ctrl[hidden] { display: none; }
.ww-form input { flex: 1; min-width: 0; font: inherit; font-family: var(--serif); padding: .45em .7em; border: 1.5px solid var(--line); border-radius: 0; background: var(--panel); color: var(--text); outline: none; }
.ww-form input:focus { border-color: var(--red); }
.ww-form .n { align-self: center; font: 500 .8em var(--mono); color: var(--muted); min-width: 3.2em; text-align: right; }
.ww-form .n.bad { color: var(--red); }
.ww-form button, .ww-ctrl button { font: 600 1em var(--serif); padding: .45em 1.1em; border: 1.5px solid var(--line); border-radius: 0; background: var(--text); color: var(--bg); cursor: pointer; }
.ww-ctrl .ww-hint { align-self: center; color: var(--red); font: 600 1em var(--serif); white-space: nowrap; }
.ww-ctrl button.ghost { background: var(--panel); color: var(--text); }
.ww-ctrl button.on { background: var(--red); border-color: var(--red); color: var(--paper); }
.ww-form button:hover:not(:disabled), .ww-ctrl button:hover { background: var(--red); border-color: var(--red); color: var(--paper); }
.ww-form button:disabled { opacity: .4; cursor: not-allowed; }
`;

function injectStyle() {
  if (document.getElementById('ww-style')) return;
  const st = document.createElement('style');
  st.id = 'ww-style';
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
const nums = (seats) => seats.map((s) => `${no(s)} 号`).join('、');
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

// 座位本身占的区域（相对座位中心）：上方投票 / 行动标签，下方座位号和身份
const SEAT_BOX = { l: -96, r: 96, t: -AV - 48, b: AV + 76 };
const seatBox = (p) => ({ l: p.x + SEAT_BOX.l, r: p.x + SEAT_BOX.r, t: p.y + SEAT_BOX.t, b: p.y + SEAT_BOX.b });
const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

/** 气泡位置：沿朝向桌子中心及左右偏转的方向推开，选和其他座位、气泡、中间文字重叠最少且离座位最近的位置 */
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

/** 月亮 / 太阳小图标 */
function icon(night, x, y) {
  const g = svg('g', { class: 'ww-icon' });
  if (night) {
    g.append(svg('path', { d: `M ${x + 5} ${y - 15} A 16 16 0 1 0 ${x + 5} ${y + 15} A 12 12 0 1 1 ${x + 5} ${y - 15} Z`, 'stroke-width': 0 }));
  } else {
    g.append(svg('circle', { cx: x, cy: y, r: 8, 'stroke-width': 0 }));
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      g.append(svg('line', { x1: x + Math.cos(a) * 12, y1: y + Math.sin(a) * 12, x2: x + Math.cos(a) * 17, y2: y + Math.sin(a) * 17, 'stroke-width': 2.5, 'stroke-linecap': 'square' }));
    }
  }
  return g;
}

/** 一夜行动的简述（上帝视角） */
function nightSummary(n, resolved) {
  if (!n) return '';
  const parts = [];
  if (resolved) parts.push(n.kill ? `狼刀 ${no(n.kill)} 号` : '空刀');
  if (n.check) parts.push(`查验 ${no(n.check)} 号${n.checkWolf ? '·狼人' : '·好人'}`);
  if (n.save) parts.push('女巫救人');
  if (n.poison) parts.push(`女巫毒 ${no(n.poison)} 号`);
  return parts.join('　');
}

export default {
  aspect: [16, 10],
  seatColor: (seat, index) => COLORS[(index ?? no(seat) - 1) % COLORS.length],

  createStage({ onAction }) {
    injectStyle();
    const root = document.createElement('div');
    root.className = 'ww-stage';
    const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '狼人杀圆桌' });
    const table = svg('g');
    table.append(
      svg('ellipse', { class: 'ww-table', cx: CX, cy: CY, rx: 430, ry: 232 }),
      svg('ellipse', { class: 'ww-table-in', cx: CX, cy: CY, rx: 404, ry: 208 }),
    );
    const center = svg('g');
    const shotsG = svg('g');
    const bubbles = svg('g');
    const seatsG = svg('g');
    el.append(table, center, shotsG, seatsG, bubbles);

    // 发言 / 遗言输入框
    const form = document.createElement('form');
    form.className = 'ww-form';
    form.hidden = true;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 120;
    input.autocomplete = 'off';
    const count = document.createElement('span');
    count.className = 'n';
    const send = document.createElement('button');
    send.type = 'submit';
    form.append(input, count, send);

    // 按钮区：空刀 / 弃票 / 不开枪 / 救 / 毒 / 不用药
    const ctrl = document.createElement('div');
    ctrl.className = 'ww-ctrl';
    ctrl.hidden = true;
    root.append(el, form, ctrl);

    let ctx = { maxLen: 60, key: null };
    let poisonMode = false;
    let last = null; // 最近一次 render 的参数，切换下毒模式时重画
    const clean = (t) => t.replace(/[\r\n]+/g, '').trim();
    const refreshCount = () => {
      const n = [...clean(input.value)].length;
      count.textContent = `${n}/${ctx.maxLen}`;
      const bad = n > ctx.maxLen;
      count.classList.toggle('bad', bad);
      send.disabled = !n || bad;
    };
    input.addEventListener('input', refreshCount);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = clean(input.value);
      if (!t || [...t].length > ctx.maxLen) return;
      onAction(t);
    });

    const stage = {
      el: root,
      render(view, opts = {}) {
        if (!view || !view.seats) return;
        last = [view, opts];
        const { movable = null, actions = null } = opts;
        const n = view.seats.length;
        const pos = Object.fromEntries(view.seats.map((s, i) => [s, seatPos(i, n)]));
        const alive = new Set(view.alive || []);
        const deathOf = Object.fromEntries((view.deaths || []).map((d) => [d.seat, d]));
        const phase = view.phase;
        const night = NIGHT_PHASES.has(phase);
        root.classList.toggle('night', night);
        const acts = movable && Array.isArray(actions) ? actions : [];
        const ids = new Set(acts.map((a) => a.id));
        const freeText = movable && actions === null && ['speak', 'tiespeak', 'lastword'].includes(phase) && view.speaker === movable;
        const actKey = movable ? `${view.day}-${phase}-${(view.log || []).length}` : null;
        if (actKey !== ctx.key) poisonMode = false;
        const pickable = new Set();
        for (const a of acts) {
          if (/^p\d$/.test(a.id)) pickable.add(a.id);
          else if (poisonMode && a.id.startsWith('poison:')) pickable.add(a.id.slice(7));
        }
        const pickAction = (s) => (phase === 'witch' ? `poison:${s}` : s);

        // 本次要显示的投票：投票阶段显示当前票；刚计完票、还没有新发言时显示上一次结果
        let shown = null;
        const voting = phase === 'vote' || phase === 'revote';
        const lastLog = (view.voteLog || []).at(-1);
        if (voting && Object.keys(view.votes || {}).length) shown = { votes: view.votes, counts: null };
        else if (!voting && lastLog && lastLog.day === view.day && (lastLog.after === view.speeches.length || phase === 'tiespeak' || phase === 'lastword' || phase === 'hunter' || phase === 'wait')) {
          shown = { votes: lastLog.votes, counts: lastLog.counts };
        }
        if (shown && !shown.counts) {
          shown.counts = {};
          for (const t of Object.values(shown.votes)) if (t !== 'none') shown.counts[t] = (shown.counts[t] || 0) + 1;
        }
        const pend = new Set(view.pending || []);

        // ---------- 中间：天数、昼夜、阶段、昨夜结果 ----------
        center.replaceChildren();
        center.append(icon(night, CX, CY - 126));
        center.append(svg('text', { class: 'ww-phase', x: CX, y: CY - 78 }, `第 ${view.day} 天 · ${night ? '夜晚' : '白天'}`));
        const main = svg('text', { class: 'ww-main', x: CX, y: CY - 18 });
        if (view.result) {
          main.append(svg('tspan', { class: view.result.team === '狼人' ? 'wolf' : '' }, `${view.result.team}胜`));
        } else if (view.god || !view.myRole) {
          main.append(svg('tspan', {}, PHASE[phase] || ''));
        } else {
          main.append(svg('tspan', { class: 'k' }, '你是 '), svg('tspan', { class: view.myRole === '狼人' ? 'wolf' : '' }, view.myRole));
          if (view.mates?.length) main.append(svg('tspan', { class: 'k', dx: 22 }, `队友 ${view.mates.map(no).join('、')} 号`));
        }
        center.append(main);
        let note = '';
        let hot = false;
        const dawnToday = view.dawn && view.dawn.day === view.day && !night;
        if (view.result) note = '';
        else if (phase === 'witch' && view.tonight && view.tonight.kill !== undefined && (movable || view.god)) {
          note = view.tonight.kill ? `今晚 ${no(view.tonight.kill)} 号被刀` : '今晚狼人空刀';
          hot = !!view.tonight.kill;
        } else if (!view.god && view.myRole === '预言家' && night && view.tonight?.check) {
          note = `${no(view.tonight.check)} 号是${view.tonight.checkWolf ? '狼人' : '好人'}`;
          hot = view.tonight.checkWolf;
        } else if (phase === 'tiespeak' || phase === 'revote') note = `平票：${nums(view.tied || [])}`;
        else if (lastLog && lastLog.day === view.day && !voting && shown) {
          note = lastLog.out ? `${no(lastLog.out)} 号被放逐` : Object.keys(lastLog.counts).length ? '平票，无人出局' : '全部弃票，无人出局';
        } else if (dawnToday && ['speak', 'lastword', 'hunter', 'wait'].includes(phase)) {
          note = view.dawn.dead.length ? `昨夜 ${nums(view.dawn.dead)}死亡` : '昨夜平安夜';
          hot = view.dawn.dead.length > 0;
        }
        if (view.result) note = view.result.reason.replace(/（狼人：.*）$/, '');
        const busy = freeText || acts.length;
        if (note) center.append(svg('text', { class: `ww-note${hot ? ' hot' : ''}`, x: CX, y: CY + 36 }, note));
        // 上帝视角：今晚 / 昨夜的行动
        if (view.god && !busy) {
          const sum = night ? nightSummary(view.tonight, phase !== 'wolf') : view.lastNight && view.lastNight.day === view.day ? `昨夜　${nightSummary(view.lastNight, true)}` : '';
          if (sum.trim()) center.append(svg('text', { class: 'ww-god', x: CX, y: CY + (note ? 76 : 40) }, sum));
        }

        // ---------- 座位 ----------
        seatsG.replaceChildren();
        bubbles.replaceChildren();
        shotsG.replaceChildren();
        const toPlace = [];
        const tonight = view.tonight || {};
        view.seats.forEach((s, i) => {
          const p = pos[s];
          const isOut = !alive.has(s);
          const ident = view.identity?.[s];
          const g = svg('g', { class: 'ww-seat', 'data-seat': s });
          g.classList.toggle('out', isOut);
          g.classList.toggle('wolf', ident === 'wolf');
          g.classList.toggle('me', s === view.viewer);
          if (pickable.has(s)) {
            g.classList.add('pick');
            g.addEventListener('click', () => onAction(pickAction(s)));
          }
          g.append(svg('circle', { class: 'av', cx: p.x, cy: p.y, r: AV }));
          const fig = svg('g', { class: 'fig', fill: COLORS[i % COLORS.length] });
          fig.append(
            svg('circle', { cx: p.x, cy: p.y - 11, r: 15 }),
            svg('path', { d: `M ${p.x - 27} ${p.y + 31} Q ${p.x - 27} ${p.y + 8} ${p.x} ${p.y + 8} Q ${p.x + 27} ${p.y + 8} ${p.x + 27} ${p.y + 31} Z` }),
          );
          g.append(fig);
          const single = pend.has(s) && !voting && phase !== 'wolf';
          if ((view.speaker === s || single) && phase !== 'over') g.append(svg('circle', { class: 'ring', cx: p.x, cy: p.y, r: AV + 9 }));
          // 座位号
          const tagText = `${no(s)} 号${s === view.viewer ? ' · 你' : ''}`;
          const tw = s === view.viewer ? 124 : 64;
          g.append(svg('rect', { x: p.x - tw / 2, y: p.y + AV + 8, width: tw, height: 28, fill: COLORS[i % COLORS.length] }));
          g.append(svg('text', { class: 'tag', x: p.x, y: p.y + AV + 23 }, tagText));
          // 身份和死亡时间
          // 预言家本人：查验过的人常驻标出结果（白天发言时要用）
          const chk = !view.god && !view.roles?.[s] ? (view.checks || []).findLast((c) => c.target === s) : null;
          const role = view.roles?.[s] || (chk ? (chk.wolf ? '验·狼人' : '验·好人') : null);
          const d = deathOf[s];
          const when = d ? `第 ${d.day} ${d.time === 'night' ? '夜' : '天'}` : '';
          const idText = [role, when].filter(Boolean).join(' · ');
          if (idText) g.append(svg('text', { class: `id${ident === 'wolf' || chk?.wolf ? ' wolf' : ''}`, x: p.x, y: p.y + AV + 62 }, idText));
          // 死亡印章：夜里死亡不公开死因（上帝视角公开）
          if (d) {
            const st = svg('g', { class: 'stamp', transform: `rotate(-14 ${p.x} ${p.y})` });
            st.append(svg('rect', { x: p.x - 42, y: p.y - 18, width: 84, height: 36 }), svg('text', { x: p.x, y: p.y + 1 }, d.cause ? STAMP[d.cause] : '死亡'));
            g.append(st);
          }
          // 头像上方：投票去向 / 夜间行动
          const top = (text, cls = '') => g.append(svg('text', { class: `to ${cls}`, x: p.x, y: p.y - AV - 14 }, text));
          if (shown?.votes?.[s]) top(shown.votes[s] === 'none' ? '弃票' : `→${no(shown.votes[s])}号`, shown.votes[s] === 'none' ? 'wait' : '');
          else if (voting && pend.has(s)) top('投票中', 'wait');
          else if (night && tonight.wolfVotes && s in tonight.wolfVotes) top(tonight.wolfVotes[s] === 'none' ? '空刀' : `刀 ${no(tonight.wolfVotes[s])}号`, 'act hot');
          else if (phase === 'wolf' && pend.has(s)) top('提名中', 'wait');
          else if (view.god && night && ident === 'seer' && tonight.check) top(`查 ${no(tonight.check)}号·${tonight.checkWolf ? '狼' : '好'}`, `act${tonight.checkWolf ? ' hot' : ''}`);
          const c = shown?.counts?.[s];
          if (c) {
            const cnt = svg('g', { class: 'cnt' });
            cnt.append(svg('rect', { x: p.x + AV * 0.55, y: p.y - AV - 2, width: 58, height: 32 }), svg('text', { x: p.x + AV * 0.55 + 29, y: p.y - AV + 15 }, `${c} 票`));
            g.append(cnt);
          }
          seatsG.append(g);

          // 发言气泡：今天说过的话（遗言虚线框）；活着的人还没说时显示上一句（淡）
          const mine = (view.speeches || []).filter((x) => x.seat === s);
          const lastSp = mine.at(-1);
          if (!lastSp) return;
          const old = lastSp.day !== view.day || (night && lastSp.kind !== 'last');
          if (old && isOut && phase !== 'over') return;
          const { lines, width } = wrap(lastSp.text);
          toPlace.push({ p, lines, old, kind: lastSp.kind, w: width * FS + 28, h: lines.length * (FS + 8) + 18 });
        });

        // 猎人开枪：今天的枪画连线
        for (const sh of view.shots || []) {
          if (!sh.target || sh.day !== view.day || night) continue;
          const a = pos[sh.seat], b = pos[sh.target];
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          const x1 = a.x + ux * (AV + 10), y1 = a.y + uy * (AV + 10), x2 = b.x - ux * (AV + 14), y2 = b.y - uy * (AV + 14);
          shotsG.append(svg('line', { class: 'ww-shot', x1, y1, x2, y2 }));
          shotsG.append(svg('path', { class: 'ww-shot-head', d: `M ${x2 + ux * 4} ${y2 + uy * 4} L ${x2 - ux * 20 - uy * 10} ${y2 - uy * 20 + ux * 10} L ${x2 - ux * 20 + uy * 10} ${y2 - uy * 20 - ux * 10} Z` }));
        }

        // 气泡：先放今天的，再放旧的；避开其他座位、中间文字和操作区
        const obstacles = [{ l: CX - 260, r: CX + 260, t: CY - 150, b: CY + 84 }];
        if (freeText || acts.length) obstacles.push({ l: W * 0.3, r: W * 0.7, t: H * 0.59 - 10, b: H * 0.59 + 80 });
        toPlace.sort((a, b) => Number(a.old) - Number(b.old));
        for (const bb of toPlace) {
          const others = Object.values(pos).filter((q) => q !== bb.p).map(seatBox);
          const { cx, cy, box } = bubbleBox(bb.p, bb.w, bb.h, [...obstacles, ...others]);
          obstacles.push(box);
          const { p, w: bw, h: bh } = bb;
          const bg = svg('g', { class: `ww-bubble${bb.old ? ' old' : ''}${bb.kind === 'tie' ? ' tie' : ''}${bb.kind === 'last' ? ' last' : ''}` });
          const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          const edge = Math.min(Math.abs((bw / 2) / (ux || 1e-6)), Math.abs((bh / 2) / (uy || 1e-6)));
          const ex = cx + ux * edge, ey = cy + uy * edge;
          bg.append(svg('path', { class: 'b', d: `M ${ex - uy * 10} ${ey + ux * 10} L ${ex + ux * 22} ${ey + uy * 22} L ${ex + uy * 10} ${ey - ux * 10} Z` }));
          bg.append(svg('rect', { class: 'b', x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh }));
          bb.lines.forEach((l, k) => bg.append(svg('text', { x: cx - bw / 2 + 14, y: cy - bh / 2 + 9 + FS + k * (FS + 8) - 3 }, l)));
          bubbles.append(bg);
        }

        // ---------- 发言 / 遗言输入 ----------
        const key = freeText ? `${view.day}-${phase}-${(view.speeches || []).length}` : null;
        if (key && key !== ctx.textKey) input.value = '';
        ctx = { maxLen: view.maxLen || 60, key: actKey, textKey: key };
        form.hidden = !freeText;
        if (freeText) {
          input.placeholder = phase === 'lastword' ? '留下遗言' : '说一句话';
          send.textContent = phase === 'lastword' ? '遗言' : '发言';
          refreshCount();
          if (document.activeElement !== input) input.focus({ preventScroll: true });
        }

        // ---------- 按钮 ----------
        ctrl.replaceChildren();
        const button = (text, fn, cls = '') => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = text;
          if (cls) b.className = cls;
          b.addEventListener('click', fn);
          ctrl.append(b);
        };
        const HINT = { wolf: '点头像，提名今晚要刀的人', seer: '点头像，查验一人的身份', vote: '点头像投票放逐', revote: '点头像，在平票者中重投', hunter: '点头像开枪带走一人' };
        const hint = pickable.size ? (phase === 'witch' ? '点头像下毒' : HINT[phase]) : null;
        if (hint) { const t = document.createElement('span'); t.className = 'ww-hint'; t.textContent = hint; ctrl.append(t); }
        if (acts.length) {
          if (phase === 'witch') {
            const save = acts.find((a) => a.id === 'save');
            if (save) button(save.label, () => onAction('save'));
            if (acts.some((a) => a.id.startsWith('poison:'))) {
              button('毒', () => { poisonMode = !poisonMode; stage.render(...last); }, poisonMode ? 'on' : 'ghost');
            }
            button('不用药', () => onAction('none'), 'ghost');
          } else if (ids.has('none')) {
            button(NONE_LABEL[phase] || '跳过', () => onAction('none'), 'ghost');
          }
        }
        ctrl.hidden = !ctrl.childElementCount || freeText;
      },
    };
    return stage;
  },

  /** 着法列表：和对局记录一一对应；玩家视角里别人的夜间行动打码 */
  moveList(view) {
    const speech = (t) => ([...t].length > 8 ? `「${[...t].slice(0, 8).join('')}…」` : `「${t}」`);
    return (view?.log || []).map((e) => ({ seat: e.seat, label: ['speak', 'tiespeak', 'lastword'].includes(e.kind) ? speech(e.label) : e.label }));
  },
};
