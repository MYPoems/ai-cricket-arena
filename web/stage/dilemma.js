// 囚徒困境画面：顶部双方总分和统计，中间是时间轴（每一轮一列：甲、乙的选择和本轮得分），
// 下方是最近几轮的喊话。合作为纸色方块墨字「合」，背叛为朱红方块纸色字「背」；进行中的一轮显示「?」，
// 上帝视角下已提交的内容淡色显示。玩家本人行动时底部出现输入框或「合作」「背叛」按钮。

const W = 1600;
const H = 1000;
const ROUNDS = 25; // 时间轴最多 25 列
const X0 = 150, X1 = 1560;
const COL = (X1 - X0) / ROUNDS;
const CELL = 46;
const INK = '#131311', INK2 = '#5c594f', RED = '#c8321b';
const SEAT_FILL = { a: INK, b: '#3559b5' };
const NAMES = { a: '甲', b: '乙' };
const FEED_TOP = 432, FEED_ROW = 66, CTL_TOP = 862;

const STYLE = `
.dlm { position: relative; width: 100%; height: 100%; container-type: size; user-select: none; }
.dlm > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.dlm svg text { font-family: var(--serif); fill: ${INK}; }
.dlm svg .mono { font-family: var(--mono); }
.dlm svg .muted { fill: ${INK2}; }
.dlm svg .bg { fill: var(--wood-1); stroke: var(--board-line); stroke-width: 1; }
.dlm svg .rule { stroke: rgb(19 19 17 / 0.18); stroke-width: 1.2; }
.dlm svg .tag text { fill: #f2efe7; font-weight: 600; }
.dlm svg .cell-c rect { fill: #f2efe7; stroke: ${INK}; stroke-width: 1.6; }
.dlm svg .cell-c text { fill: ${INK}; font-weight: 600; }
.dlm svg .cell-d rect { fill: ${RED}; stroke: ${RED}; stroke-width: 1.6; }
.dlm svg .cell-d text { fill: #f2efe7; font-weight: 600; }
.dlm svg .cell-u rect { fill: none; stroke: ${INK2}; stroke-width: 1.4; stroke-dasharray: 5 4; }
.dlm svg .cell-u text { fill: ${INK2}; font-family: var(--mono); }
.dlm svg .faint { opacity: 0.38; }
.dlm svg .col .hl { fill: transparent; }
.dlm svg .col:hover .hl { fill: rgb(19 19 17 / 0.06); }
.dlm svg .col.now .hl { fill: rgb(200 50 27 / 0.06); }
.dlm svg .now-mark { fill: ${RED}; }
.dlm svg .win { fill: ${RED}; }
.dlm-ctl { position: absolute; left: 3%; right: 3%; bottom: 2.6%; height: 11%; display: none; gap: 1.5cqw; }
.dlm-ctl.on { display: flex; }
.dlm-ctl input { flex: 1; min-width: 0; height: 100%; margin: 0; padding: 0 2cqw; font: 3.4cqh/1 var(--serif); color: ${INK}; background: #f7f5ef; border: 2px solid ${INK}; border-radius: 0; box-sizing: border-box; user-select: text; }
.dlm-ctl input:focus { outline: none; border-color: ${RED}; }
.dlm-ctl button { height: 100%; margin: 0; font: 600 3.9cqh/1 var(--serif); letter-spacing: 0.3em; border: 2px solid ${INK}; border-radius: 0; cursor: pointer; box-sizing: border-box; transition: transform .08s, box-shadow .08s; }
.dlm-ctl button:hover:not(:disabled) { transform: translate(-2px, -2px); box-shadow: 4px 4px 0 rgb(19 19 17 / 0.2); }
.dlm-ctl button:disabled { opacity: .45; cursor: default; }
.dlm-say { width: 16%; background: ${INK}; color: #f2efe7; }
.dlm-c { flex: 1; background: #f2efe7; color: ${INK}; }
.dlm-d { flex: 1; background: ${RED}; color: #f2efe7; border-color: ${RED} !important; }
`;

let styled = false;
function ensureStyle() {
  if (styled || typeof document === 'undefined') return;
  const s = document.createElement('style');
  s.dataset.stage = 'dilemma';
  s.textContent = STYLE;
  document.head.append(s);
  styled = true;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
const chars = (s) => [...String(s || '')].length;

/** 选择方块：c 为 'C' / 'D' / null（未知）；faint 淡色（上帝视角下进行中的一轮） */
function cell(x, y, size, c, faint = false) {
  const cls = c === 'C' ? 'cell-c' : c === 'D' ? 'cell-d' : 'cell-u';
  const t = c === 'C' ? '合' : c === 'D' ? '背' : '?';
  return `<g class="${cls}${faint ? ' faint' : ''}"><rect x="${x}" y="${y}" width="${size}" height="${size}"/>`
    + `<text x="${x + size / 2}" y="${y + size / 2 + 1}" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(size * 0.52)}">${t}</text></g>`;
}

function tag(x, y, size, seat) {
  return `<g class="tag"><rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${SEAT_FILL[seat]}"/>`
    + `<text x="${x + size / 2}" y="${y + size / 2 + 1}" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(size * 0.58)}">${NAMES[seat]}</text></g>`;
}

const talkTitle = (t) => (t === null || t === undefined ? '?' : t ? `「${t}」` : '（不说）');
const choiceName = (c) => (c === 'C' ? '合作' : c === 'D' ? '背叛' : '?');

function header(view) {
  const st = view.stats || {};
  const sc = view.score || { a: 0, b: 0 };
  const statLine = (s) => (s && s.played ? `合作 ${pct(s.coopRate)} · 报复 ${pct(s.retaliation)} · 主动背叛 ${s.unprovoked}` : '合作 — · 报复 — · 主动背叛 0');
  const winA = view.over && view.winner === 'a', winB = view.over && view.winner === 'b';
  let center, sub;
  if (view.over) {
    center = `共 ${view.round} 轮`;
    sub = view.winner ? `${NAMES[view.winner]}胜` : '平局';
  } else {
    center = `第 ${view.round} 轮`;
    sub = view.phase === 'talk' ? '喊话' : '选择';
  }
  return `
    ${tag(48, 44, 46, 'a')}
    <text x="110" y="92"><tspan font-size="68" font-weight="700" class="${winA ? 'win' : ''}">${sc.a}</tspan><tspan dx="8" font-size="22" class="muted">分</tspan></text>
    <text x="48" y="140" class="mono muted" font-size="19">${esc(statLine(st.a))}</text>
    ${tag(W - 48 - 46, 44, 46, 'b')}
    <text x="${W - 110}" y="92" text-anchor="end"><tspan font-size="68" font-weight="700" class="${winB ? 'win' : ''}">${sc.b}</tspan><tspan dx="8" font-size="22" class="muted">分</tspan></text>
    <text x="${W - 48}" y="140" text-anchor="end" class="mono muted" font-size="19">${esc(statLine(st.b))}</text>
    <text x="${W / 2}" y="86" text-anchor="middle" font-size="40" font-weight="600">${center}</text>
    <text x="${W / 2}" y="128" text-anchor="middle" class="mono ${view.over && view.winner ? 'win' : 'muted'}" font-size="20" letter-spacing="4">${sub}</text>
    <line class="rule" x1="40" y1="170" x2="${W - 40}" y2="170"/>`;
}

/** 视角下进行中这一轮的某座位内容：{ value, faint, known } */
function curEntry(view, kind, seat) {
  const box = view.current?.[kind];
  const v = box ? box[seat] : null;
  if (v === null || v === undefined) return { value: null, known: false, faint: false };
  // 喊话阶段的喊话、选择阶段的选择还没公开：淡色
  const open = kind === 'talk' ? view.phase === 'choose' : false;
  return { value: v, known: true, faint: !open };
}

function timeline(view) {
  const hist = view.history || [];
  const out = [];
  const rowA = 228, rowB = 284, scoreY = 358, dotY = 386;
  out.push(`<text x="88" y="${rowA + CELL / 2 + 1}" text-anchor="middle" dominant-baseline="central" font-size="26" font-weight="600">甲</text>`);
  out.push(`<text x="88" y="${rowB + CELL / 2 + 1}" text-anchor="middle" dominant-baseline="central" font-size="26" font-weight="600">乙</text>`);
  out.push(`<text x="88" y="${scoreY}" text-anchor="middle" class="muted" font-size="17">得分</text>`);
  const cols = hist.map((r) => ({ talk: r.talk, choice: r.choice, pts: r.pts, done: true }));
  if (!view.over && view.current) cols.push({ current: true });
  cols.slice(0, ROUNDS).forEach((c, i) => {
    const cx = X0 + i * COL + COL / 2;
    const x = cx - CELL / 2;
    const parts = [`<rect class="hl" x="${X0 + i * COL + 1}" y="190" width="${COL - 2}" height="214"/>`];
    parts.push(`<text x="${cx}" y="212" text-anchor="middle" class="mono muted" font-size="15">${i + 1}</text>`);
    let title;
    if (c.done) {
      parts.push(cell(x, rowA, CELL, c.choice.a), cell(x, rowB, CELL, c.choice.b));
      parts.push(`<text x="${cx}" y="${scoreY}" text-anchor="middle" class="mono" font-size="17">${c.pts.a}:${c.pts.b}</text>`);
      if (c.talk.a) parts.push(`<circle cx="${cx - 7}" cy="${dotY}" r="3.6" fill="${SEAT_FILL.a}"/>`);
      if (c.talk.b) parts.push(`<circle cx="${cx + 7}" cy="${dotY}" r="3.6" fill="${SEAT_FILL.b}"/>`);
      title = `第 ${i + 1} 轮\n甲：${talkTitle(c.talk.a)} ${choiceName(c.choice.a)} +${c.pts.a}\n乙：${talkTitle(c.talk.b)} ${choiceName(c.choice.b)} +${c.pts.b}`;
    } else {
      const ea = curEntry(view, 'choice', 'a'), eb = curEntry(view, 'choice', 'b');
      parts.push(cell(x, rowA, CELL, ea.value, ea.known), cell(x, rowB, CELL, eb.value, eb.known));
      parts.push(`<text x="${cx}" y="${scoreY}" text-anchor="middle" class="mono muted" font-size="17">—</text>`);
      parts.push(`<rect class="now-mark" x="${cx - 14}" y="${dotY - 2}" width="28" height="4"/>`);
      const ta = curEntry(view, 'talk', 'a'), tb = curEntry(view, 'talk', 'b');
      title = `第 ${i + 1} 轮（进行中）\n甲：${talkTitle(ta.value)}\n乙：${talkTitle(tb.value)}`;
    }
    out.push(`<g class="col${c.current ? ' now' : ''}"><title>${esc(title)}</title>${parts.join('')}</g>`);
  });
  out.push(`<line class="rule" x1="40" y1="${FEED_TOP - 22}" x2="${W - 40}" y2="${FEED_TOP - 22}"/>`);
  return out.join('');
}

/** 最近几轮的喊话（最新的在最下面） */
function feed(view, maxRows) {
  const hist = view.history || [];
  const rows = hist.map((r, i) => ({ n: i + 1, talk: r.talk, choice: r.choice, done: true }));
  if (!view.over && view.current) rows.push({ n: hist.length + 1, current: true });
  const shown = rows.slice(-maxRows);
  const out = [];
  shown.forEach((r, k) => {
    const y = FEED_TOP + k * FEED_ROW;
    const mid = y + FEED_ROW / 2;
    out.push(`<text x="56" y="${mid + 1}" text-anchor="middle" dominant-baseline="central" class="mono muted" font-size="${r.current ? 16 : 18}">${r.current ? '本轮' : r.n}</text>`);
    for (const seat of ['a', 'b']) {
      const bx = seat === 'a' ? 100 : 850;
      let talk, faintTalk = false, choice = null, faintChoice = false;
      if (r.done) { talk = r.talk[seat]; choice = r.choice[seat]; } else {
        const t = curEntry(view, 'talk', seat), c = curEntry(view, 'choice', seat);
        talk = t.known ? t.value : null; faintTalk = t.faint;
        choice = c.known ? c.value : null; faintChoice = c.known;
      }
      out.push(tag(bx, mid - 14, 28, seat));
      out.push(cell(bx + 34, mid - 14, 28, choice, faintChoice));
      const tx = bx + 74;
      if (talk === null || talk === undefined) out.push(`<text x="${tx}" y="${mid + 1}" dominant-baseline="central" class="mono muted" font-size="20">?</text>`);
      else if (!talk) out.push(`<text x="${tx}" y="${mid + 1}" dominant-baseline="central" class="muted${faintTalk ? ' faint' : ''}" font-size="19">（不说）</text>`);
      else {
        const size = chars(talk) > 28 ? 20 : 21;
        out.push(`<text x="${tx}" y="${mid + 1}" dominant-baseline="central" font-size="${size}" class="${faintTalk ? 'faint' : ''}"><title>${esc(talk)}</title>${esc(talk)}</text>`);
      }
    }
  });
  return out.join('');
}

export default {
  aspect: [16, 10],
  seatColor: (seat) => (seat === 'a' ? 'var(--black-side)' : SEAT_FILL.b),

  createStage({ onAction }) {
    ensureStyle();
    const el = document.createElement('div');
    el.className = 'dlm';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '囚徒困境时间轴');

    // 喊话：输入框 + 「说」
    const talkBox = document.createElement('div');
    talkBox.className = 'dlm-ctl';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 30;
    input.autocomplete = 'off';
    const say = document.createElement('button');
    say.className = 'dlm-say';
    say.type = 'button';
    say.textContent = '说';
    talkBox.append(input, say);

    // 选择：合作 / 背叛
    const chooseBox = document.createElement('div');
    chooseBox.className = 'dlm-ctl';
    const btnC = document.createElement('button');
    btnC.className = 'dlm-c';
    btnC.type = 'button';
    btnC.textContent = '合作';
    const btnD = document.createElement('button');
    btnD.className = 'dlm-d';
    btnD.type = 'button';
    btnD.textContent = '背叛';
    chooseBox.append(btnC, btnD);
    el.append(svg, talkBox, chooseBox);

    const buttons = [say, btnC, btnD];
    const submit = (action, after) => {
      if (buttons.some((b) => b.disabled)) return;
      buttons.forEach((b) => { b.disabled = true; });
      Promise.resolve(onAction(action)).catch(() => {}).finally(() => {
        buttons.forEach((b) => { b.disabled = false; });
        after?.();
      });
    };
    const sayNow = () => {
      const text = input.value.replace(/[\r\n]+/g, ' ').trim();
      submit(text, () => { input.value = ''; });
    };
    say.addEventListener('click', sayNow);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sayNow(); } });
    btnC.addEventListener('click', () => submit('C'));
    btnD.addEventListener('click', () => submit('D'));

    return {
      el,
      render(view, { movable = null } = {}) {
        if (!view) return;
        const canTalk = !!movable && !view.over && view.phase === 'talk';
        const canChoose = !!movable && !view.over && view.phase === 'choose';
        const ctl = canTalk || canChoose;
        const rows = ctl ? Math.floor((CTL_TOP - 12 - FEED_TOP) / FEED_ROW) : Math.floor((H - 16 - FEED_TOP) / FEED_ROW);
        input.placeholder = movable ? `对${NAMES[movable === 'a' ? 'b' : 'a']}说…` : '';
        svg.innerHTML = `<rect class="bg" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}"/>${header(view)}${timeline(view)}${feed(view, rows)}`;
        const wasTalk = talkBox.classList.contains('on');
        talkBox.classList.toggle('on', canTalk);
        chooseBox.classList.toggle('on', canChoose);
        if (canTalk && !wasTalk) setTimeout(() => input.focus({ preventScroll: true }), 0);
      },
    };
  },

  /** 着法列表：和对局记录一一对应（每轮依次为甲喊、乙喊、甲选、乙选） */
  moveList(view) {
    const out = [];
    const short = (t) => (t ? (chars(t) > 6 ? `「${[...t].slice(0, 6).join('')}…」` : `「${t}」`) : '（不说）');
    const push = (seat, kind, v) => out.push({ seat, label: kind === 'talk' ? short(v) : choiceName(v) });
    for (const r of view?.history || []) {
      for (const s of ['a', 'b']) push(s, 'talk', r.talk[s]);
      for (const s of ['a', 'b']) push(s, 'choice', r.choice[s]);
    }
    const cur = view?.current;
    if (cur) {
      for (const s of ['a', 'b']) if (cur.talk[s] !== null && cur.talk[s] !== undefined) push(s, 'talk', cur.talk[s]);
      for (const s of ['a', 'b']) if (cur.choice[s] !== null && cur.choice[s] !== undefined) push(s, 'choice', cur.choice[s]);
    }
    return out;
  },
};
