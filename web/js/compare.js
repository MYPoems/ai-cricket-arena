// 同题对比：同一个局面交给多个选手，并排比较分析和选择。

import { h, api, post, guard, avatar, modelLine, fmtMs, fmtTokens, pct, fmtTime, listen, pressed, setTitle, cleanName, icon } from './ui.js';
import { Board } from './board.js';
import { parseFen, inCheck } from '/games/xiangqi/rules.js';

/** 面包屑：对局记录 / 同题对比 / 当前这一页 */
const crumbs = (here) => h('nav', { class: 'crumbs', 'aria-label': '位置' },
  h('a', { href: '#/history' }, '对局记录'), h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'),
  h('a', { href: '#/history?tab=compare' }, '同题对比'), h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'),
  h('span', { 'aria-current': 'page' }, here));

function viewFromFen(fen) {
  const pos = parseFen(fen);
  return { board: pos.board, side: pos.side, inCheck: inCheck(pos.board, pos.side) };
}

export async function compareNewView(root, { characters, go }) {
  const [puzzles, past] = await Promise.all([api('/puzzles'), api('/compares')]);
  const ai = characters.filter((c) => c.kind !== 'human' && !c.archived);
  const sel = { puzzle: puzzles[1] || puzzles[0], fen: '', ids: new Set(ai.filter((c) => c.kind === 'model').slice(0, 4).map((c) => c.id)) };
  const board = new Board();
  const pz = h('div', { class: 'puzzles', role: 'group', 'aria-label': '题目' });
  const picks = h('div', { class: 'seat-pick', role: 'group', 'aria-label': '参加对比的选手' });
  const fenInput = h('input', { type: 'text', placeholder: '或粘贴 FEN', 'aria-label': '自定义局面 FEN', oninput: (e) => { sel.fen = e.target.value.trim(); drawBoard(); } });

  function drawBoard() {
    const fen = sel.fen || sel.puzzle?.fen;
    try {
      board.render({ ...viewFromFen(fen), movable: null });
    } catch { /* FEN 还没输完 */ }
  }
  function draw() {
    pz.replaceChildren(...puzzles.map((p) => h('button', { type: 'button', class: `puzzle${sel.puzzle === p && !sel.fen ? ' on' : ''}`, ...pressed(sel.puzzle === p && !sel.fen), onclick: () => { sel.puzzle = p; sel.fen = ''; fenInput.value = ''; draw(); } }, h('b', {}, p.title), h('small', {}, p.desc))));
    picks.replaceChildren(...ai.map((c) => h('button', { type: 'button', class: `pick${sel.ids.has(c.id) ? ' on' : ''}`, ...pressed(sel.ids.has(c.id)), onclick: () => { sel.ids.has(c.id) ? sel.ids.delete(c.id) : sel.ids.add(c.id); draw(); } },
      sel.ids.has(c.id) ? h('span', { class: 'pick-check' }, icon('check', 16)) : avatar(c, 'sm'), h('span', { class: 't' }, h('span', {}, cleanName(c.name)), h('small', {}, c.kind === 'model' ? c.model : modelLine(c))))));
    drawBoard();
  }

  root.replaceChildren(crumbs('新建'), h('div', { class: 'cmp' },
    h('div', { class: 'col' }, h('div', { class: 'card pad' }, board.el)),
    h('div', { class: 'col' },
      h('div', { class: 'card pad col' }, h('h2', {}, '同题对比'), pz, fenInput),
      h('div', { class: 'card pad col' }, h('h3', {}, '参加对比的选手'), picks,
        h('div', {}, h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
          const fen = sel.fen || sel.puzzle.fen;
          const r = await post('/compares', { fen, title: sel.fen ? '自定义局面' : sel.puzzle.title, characterIds: [...sel.ids] });
          go(`#/compare/${r.id}`);
        }) }, '开始对比'))),
      past.length ? h('div', { class: 'card quiet pad col' }, h('h3', {}, '以往的对比'),
        h('div', { class: 'side-list' }, ...past.slice(0, 12).map((c) => h('a', { href: `#/compare/${c.id}`, class: 'it two' }, h('span', {}, c.title), h('span', { class: 'small muted' }, fmtTime(c.created_at)))))) : null,
    ),
  ));
  draw();
}

export async function compareView(root, id, { characters }) {
  let d = await api(`/compares/${id}`);
  setTitle(d.title, '同题对比');
  const chars = new Map(characters.map((c) => [c.id, c]));
  const answers = new Map(d.answers.map((a) => [a.character_id, { ...a, text: a.analysis || '', reasoning: a.reasoning || '' }]));
  let evalBefore = null;
  let hl = null;
  const board = new Board();
  const grid = h('div', { class: 'answers' });
  const summary = h('div', { class: 'small muted' });
  // 图例：颜色和棋盘上的箭头一致（引擎推荐是青绿实箭头，各蛐蛐的选择是半透明褐色箭头）
  const legend = h('div', { class: 'cmp-legend small muted' },
    h('span', {}, h('i', { class: 'lg-best', 'aria-hidden': 'true' }), '引擎推荐'),
    h('span', {}, h('i', { class: 'lg-hint', 'aria-hidden': 'true' }), '蛐蛐的选择（移到卡片上只看这一只）'));

  function drawBoard() {
    const arrows = [];
    for (const a of answers.values()) {
      if (a.action && (!hl || hl === a.character_id)) arrows.push({ iccs: a.action, kind: 'hint' });
    }
    const best = [...answers.values()].find((a) => a.eval?.best)?.eval?.best || evalBefore?.best;
    if (best) arrows.push({ iccs: best, kind: 'best' });
    board.render({ ...viewFromFen(d.fen), movable: null, arrows }, { animate: false });
  }

  function card(a) {
    const c = chars.get(a.character_id) || a;
    const q = a.eval;
    const cls = q ? { 最佳: 'good', 好棋: 'good', 缓着: 'warn', 失误: 'warn', 大漏着: 'bad' }[q.tag] : '';
    const lines = {};
    for (const k of ['判断', '威胁', '理由']) {
      const m = new RegExp(`${k}[:：]\\s*(.+)`).exec(a.text || '');
      if (m) lines[k] = m[1];
    }
    const done = a.status === 'done' || a.status === 'failed';
    return h('div', { class: `card answer${hl === a.character_id ? ' hl' : ''}`, onmouseenter: () => { hl = a.character_id; drawBoard(); }, onmouseleave: () => { hl = null; drawBoard(); } },
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, avatar(c, 'sm'), h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', {}, cleanName(c.name)), h('div', { class: 'small muted', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, modelLine(c)))),
      h('div', { class: 'row', style: { gap: '6px' } },
        a.label ? h('b', { style: { fontSize: '16px' } }, a.label) : h('span', { class: 'muted' }, a.status === 'failed' ? '未给出有效着法' : '思考中…'),
        q ? h('span', { class: `chip ${cls}` }, q.tag, q.loss >= 0.05 ? ` −${Math.round(q.loss * 100)}%` : '') : null,
        a.self_winrate !== null && a.self_winrate !== undefined ? h('span', { class: 'chip', title: '自评胜率 / 引擎评估' }, `自评 ${a.self_winrate}%${q ? ` · 引擎 ${pct(q.before)}` : ''}`) : null),
      Object.keys(lines).length && done
        ? h('div', { class: 'col', style: { gap: '2px', fontSize: '13px' } }, ...Object.entries(lines).map(([k, v]) => h('div', {}, h('b', { class: 'muted' }, `${k} `), v)))
        : a.text ? h('div', { class: `small${done ? '' : ' typing'}`, style: { whiteSpace: 'pre-wrap' } }, a.text) : null,
      a.reasoning ? h('details', {}, h('summary', { class: 'small muted' }, `原生推理（${a.reasoning.length} 字）`), h('div', { class: 'small muted', style: { whiteSpace: 'pre-wrap', maxHeight: '220px', overflowY: 'auto', background: 'var(--panel-2)', padding: '8px', borderRadius: '8px' } }, a.reasoning)) : null,
      a.error ? h('div', { class: 'small', style: { color: 'var(--bad)' } }, a.error) : null,
      done ? h('div', { class: 'small muted' }, [a.latency_ms ? fmtMs(a.latency_ms) : null, a.usage && (a.usage.input || a.usage.output) ? `${fmtTokens(a.usage.input + a.usage.output)} tokens` : null].filter(Boolean).join(' · ')) : null,
    );
  }

  function draw() {
    const list = [...answers.values()].sort((x, y) => (x.eval?.loss ?? 9) - (y.eval?.loss ?? 9));
    grid.replaceChildren(...list.map(card));
    const best = list.find((a) => a.eval?.best)?.eval?.best;
    summary.textContent = best ? `局面评估：走棋方胜率 ${pct(list.find((a) => a.eval)?.eval.before)}` : '';
    drawBoard();
  }

  root.replaceChildren(crumbs(d.title), h('div', { class: 'cmp' },
    h('div', { class: 'col' }, h('div', { class: 'card pad col' }, h('h2', {}, d.title), board.el, legend, summary)),
    grid,
  ));
  draw();

  let raf = null;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = null; draw(); }); };
  return listen([`compare:${id}`], (e) => {
    const a = e.characterId ? answers.get(e.characterId) : null;
    if (e.type === 'eval_before') { evalBefore = e.eval; redraw(); }
    if (!a) return;
    if (e.type === 'start') a.status = 'thinking';
    if (e.type === 'delta') {
      if (e.attempt !== a.attempt) { a.attempt = e.attempt; a.text = ''; a.reasoning = ''; }
      if (e.kind === 'text') a.text += e.text; else a.reasoning += e.text;
    }
    if (e.type === 'answer') Object.assign(a, { ...e, text: e.analysis || a.text, reasoning: e.reasoning || a.reasoning });
    redraw();
    void d;
  });
}
