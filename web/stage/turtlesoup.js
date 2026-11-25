// 海龟汤画面（左右对称座位版式）。座位卡由对局页按 duoView 画在左右两列，这里只画中间舞台：
// 汤面卡（标题、难度和类型、汤面；常驻，不会被对局页收成按钮），汤底（汤主和终局时常驻；上帝视角的观众是可收起的面板），
// 问答流（谁问了什么、汤主盖的「是 / 不是 / 无关 / 是也不是」印章；还原命中了几个要点；标题行带每人的还原次数和最好成绩）。
// 真人：猜题者在操作区写一句，点「提问」或「还原」；汤主点四枚印章之一回答（可加一句补充），判定还原时勾选命中的要点。
// 隐藏信息：只用 view 里有的东西（view 已按视角裁剪过）。这个模块不引用规则模块和谜题库。
//
// 和对局页折叠（web/js/fold.js）的配合：
// - fold.js 只收 .panel（操作区 .uc-ctrl 除外），所以汤面卡、汤主的汤底用 .paper / .well，不用 .panel，永远不被收起。
// - fold.js 只在「版式签名」变了时重新量放不放得下，签名里有各面板标题的第一个词，但没有操作区。
//   操作区出现、换成另一种（提问 / 作答 / 判定）时高度差很多，所以问答面板的标题词后面带上看不见的零宽字符
//   （每种操作区不同；观众点开汤底时也不同），让签名跟着变、重新量一次；看起来和读屏都还是「问答」。

import { CARD_MS } from '../../games/speech.js'; // 相对路径：浏览器里是 /games/speech.js，测试里 Node 也能加载

/** 开局读汤面的停顿（和 games/turtlesoup/index.js 的 INTRO_MS 一致） */
const INTRO_MS = 6000;
const COLORS = ['#a17a12', 'var(--black-side)', '#3559b5', '#9a5d24', '#2f7a70', '#7d3c98'];
const ANS = { yes: '是', no: '不是', irrelevant: '无关', both: '是也不是' };
/** 问答面板标题词后面的零宽标记：没有操作区 / 提问 / 作答 / 判定 各不相同（见文件头） */
const MODE_MARK = { none: '', guess: '​', answer: '​​', judge: '​​​' };
/** 上帝视角的观众点开了汤底：再加一个不同的零宽字符 */
const PEEK_MARK = '‌';

const CSS = `
.ts-stage { --ts-yes: #6cc38f; --ts-no: #ec6a52; --ts-irr: #b4a68f; --ts-both: #e6bb58; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
:root[data-theme="light"] .ts-stage { --ts-yes: #2f6b4a; --ts-no: #b4241a; --ts-irr: #7a6a55; --ts-both: #946510; }
.ts-stage .panel > .label { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-bottom: 6px; }
/* 汤面：常驻的纸面卡（不是 .panel，对局页的折叠不会把它收成按钮） */
.ts-soup { flex: none; padding: 10px 16px 11px; }
.ts-soup .hd { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; margin-bottom: 3px; }
.ts-soup h4 { margin: 0; font: 400 22px/1.2 var(--brush); color: #8e1b12; letter-spacing: .04em; }
.ts-soup .tg { font: 600 12px/1.5 var(--sans); letter-spacing: .06em; color: #7a5a2a; }
.ts-soup .tg b { color: #a3291a; font-weight: 700; }
.ts-soup p { margin: 0; font: 500 15px/1.7 var(--serif); color: #2a1209; }
/* 汤底：汤主（进行中）和终局时常驻在汤面下面；上帝视角的观众是可以收起的面板 */
.ts-truth { flex: none; padding: 9px 14px 10px; }
.ts-truth > .head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-bottom: 4px; }
.ts-soup .peek { margin-left: auto; align-self: center; font: 600 12px/1 var(--sans); letter-spacing: .04em; color: #8e1b12; background: rgb(142 27 18 / .06); border: 1px solid rgb(142 27 18 / .4); border-radius: 999px; padding: 5px 11px; cursor: pointer; }
.ts-soup .peek:hover { background: rgb(142 27 18 / .12); }
.ts-soup .peek:focus-visible { outline: 2px solid #8e1b12; outline-offset: 2px; }
.ts-truth .tb { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; max-height: clamp(96px, calc(100vh - 640px), 360px); }
.ts-truth p { margin: 0 0 6px; font: 500 14px/1.65 var(--serif); color: var(--text); }
.ts-points { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; }
.ts-points li { display: grid; grid-template-columns: 1.5em minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 13.5px; line-height: 1.45; }
.ts-points li > b { font: 600 13px/1 var(--num); color: var(--gold-2); text-align: center; }
.ts-points li.hit > span { color: var(--text); }
.ts-points li.miss > span { color: var(--muted); }
.ts-points .who { display: inline-flex; gap: 3px; }
.ts-stage.judging .ts-truth .ts-points { display: none; }
.ts-truth.peek .tb { max-height: clamp(96px, calc(100vh - 700px), 300px); }
/* 问答流：标题行右边是每人的还原次数和最好命中 */
.ts-qa > .label .ts-std { margin-left: auto; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; letter-spacing: 0; }
.ts-qa > .label .ts-std > span { display: inline-flex; align-items: center; gap: 5px; }
.ts-qa > .label .ts-std .done { opacity: .5; }
.ts-qa > .label .ts-std .coin.sm { width: 18px; height: 18px; font-size: 11px; }
.ts-qa > .label .ts-std .muted { font: 600 11.5px/1 var(--num); color: var(--muted); }
.ts-qa-list { max-height: clamp(96px, calc(100vh - 730px), 520px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; display: grid; align-content: start; }
.ts-stage.acting .ts-qa-list { max-height: clamp(90px, calc(100vh - 850px), 440px); }
.ts-stage.acting .ts-truth .tb { max-height: clamp(72px, calc(100vh - 810px), 220px); }
.ts-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 5px 2px; border-top: 1px solid var(--rule); font-size: 14px; line-height: 1.5; }
.ts-row:first-child { border-top: 0; }
.ts-row .tx { min-width: 0; overflow-wrap: anywhere; }
.ts-row .tx small { display: block; font-size: 12px; color: var(--muted); }
.ts-row .tx .note { color: var(--gold-2); }
.ts-row.r .tx { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.ts-row.pass .tx, .ts-row.wait .tx { color: var(--faint); }
.ts-row .qn { font: 600 11px/1 var(--num); color: var(--muted); margin-right: 6px; }
.ts-row .end { display: inline-flex; align-items: center; gap: 6px; justify-self: end; }
/* 收成按钮后在弹出的卡片里：不限高，最新的一条在最上面 */
.fold-inner .ts-qa-list { max-height: none; overflow: visible; display: flex; flex-direction: column-reverse; }
.fold-inner .ts-row { border-top: 0; border-bottom: 1px solid var(--rule); }
.fold-inner .ts-row.r .tx { display: block; }
.ts-stamp { --sc: var(--ts-irr); display: inline-grid; place-items: center; min-width: 2.4em; padding: 2px 8px 1px; color: var(--sc); font: 400 17px/1.15 var(--brush); letter-spacing: .04em; white-space: nowrap;
  border: 2px solid currentColor; border-radius: 7px 5px 8px 4px; transform: rotate(-5deg); background: color-mix(in srgb, var(--sc) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc) 30%, transparent); }
.ts-stamp.yes { --sc: var(--ts-yes); } .ts-stamp.no { --sc: var(--ts-no); } .ts-stamp.irrelevant { --sc: var(--ts-irr); } .ts-stamp.both { --sc: var(--ts-both); }
.ts-stamp.fresh { animation: ts-stamp .46s cubic-bezier(.2, 1.5, .45, 1) both; }
@keyframes ts-stamp { from { opacity: 0; transform: rotate(-14deg) scale(1.9); } 60% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ts-stamp.fresh { animation: none; } }
.ts-pips { display: inline-flex; gap: 3px; align-items: center; }
.ts-pips i { width: 8px; height: 8px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--rule); }
.ts-pips i.on { background: var(--gold-2); box-shadow: 0 0 0 1px color-mix(in srgb, var(--gold-2) 50%, transparent); }
.ts-pips.win i.on { background: var(--ts-yes); }
.ts-pips b { margin-left: 4px; font: 600 12px/1 var(--num); color: var(--muted); }
/* 操作区（真人） */
.ts-ctrl { display: flex; flex-direction: column; gap: 8px; padding: 10px 14px 12px; }
.ts-ctrl[hidden], .ts-ctrl [hidden] { display: none !important; }
.ts-ctrl .head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.ts-ctrl .head .hint { color: var(--gold-2); font-weight: 600; }
.ts-ctrl .head .sub { color: var(--muted); font-size: 13px; }
.ts-ctrl .quote .who { margin-right: 10px; font: 700 12px/1 var(--sans); letter-spacing: .06em; color: var(--gold-2); white-space: nowrap; }
.ts-ctrl .quote { font: 500 15px/1.6 var(--serif); color: var(--text); padding: 6px 10px; border-radius: var(--r); background: var(--well-bg); box-shadow: var(--well-sh); overflow-wrap: anywhere; max-height: 7.4em; overflow-y: auto; }
.ts-stage .ts-form { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
.ts-form textarea { flex: 1 1 260px; min-width: 0; resize: none; min-height: 0; max-height: 8em; overflow-y: auto; font: inherit; line-height: 1.5; }
.ts-form .side { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.ts-form .n { font: 500 12px/1 var(--num); color: var(--muted); min-width: 3.4em; text-align: right; }
.ts-form .n.bad { color: var(--zhu-2); }
.ts-answer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.ts-answer .btn { padding: 4px 12px; }
.ts-answer .btn .ts-stamp { font-size: 19px; transform: rotate(-4deg); }
.ts-answer input { flex: 1 1 160px; min-width: 0; }
.ts-judge { display: grid; gap: 5px; }
.ts-judge label { display: grid; grid-template-columns: auto 1.4em minmax(0, 1fr); gap: 8px; align-items: center; font-size: 13.5px; line-height: 1.45; cursor: pointer; }
.ts-judge label b { font: 600 13px/1 var(--num); color: var(--gold-2); text-align: center; }
.ts-judge .go { display: flex; align-items: center; gap: 10px; }
.ts-judge .go .hint { color: var(--gold-2); font-weight: 600; }
.ts-judge .go .sub { margin-left: auto; color: var(--muted); font-size: 12.5px; }
.ts-empty { color: var(--faint); font-size: var(--fs-sm); padding: 4px 0 2px; }
/* 矮屏：汤面卡压紧；判定时汤底让位给操作区里的要点清单 */
@media (min-width: 1101px) and (max-height: 820px) {
  .ts-soup { padding: 7px 14px 8px; }
  .ts-soup h4 { font-size: 19px; }
  .ts-soup p { font-size: 14px; line-height: 1.6; }
  .ts-stage.judging .ts-truth { display: none; }
  .ts-ctrl { padding: 8px 12px 10px; gap: 6px; }
}
/* 大屏放大（对局页按 --k 放大文字） */
@media (min-width: 1101px) {
  .arena.duo .ts-soup h4 { font-size: calc(22px * var(--k, 1)); }
  .arena.duo .ts-soup p { font-size: calc(15px * var(--k, 1)); }
  .arena.duo .ts-soup .tg { font-size: calc(12px * var(--k, 1)); }
  .arena.duo .ts-row { font-size: calc(14px * var(--k, 1)); }
  .arena.duo .ts-truth p { font-size: calc(14px * var(--k, 1)); }
  .arena.duo .ts-points li { font-size: calc(13.5px * var(--k, 1)); }
}
/* 窄屏：页面本身滚动，各块按内容排 */
@media (max-width: 1100px) {
  .ts-qa-list, .ts-stage.acting .ts-qa-list { max-height: 50vh; }
  .ts-truth .tb, .ts-stage.acting .ts-truth .tb { max-height: none; }
}
@media (max-width: 640px) {
  .ts-soup { padding: 9px 12px 10px; }
  .ts-soup h4 { font-size: 20px; }
  .ts-soup p { font-size: 14.5px; }
  .ts-answer { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .ts-answer .btn { padding: 4px 2px; min-width: 0; }
  .ts-answer .btn .ts-stamp { font-size: 16px; padding: 2px 4px 1px; min-width: 0; }
  .ts-answer input { grid-column: 1 / -1; }
  .ts-ctrl .quote { max-height: 4.9em; }
}
`;

function injectStyle() {
  if (typeof document === 'undefined') return;
  let st = document.getElementById('ts-style');
  if (!st) {
    st = document.createElement('style');
    st.id = 'ts-style';
    document.head.append(st);
  }
  if (st.textContent !== CSS) st.textContent = CSS;
}

/** 建 DOM：el('div', { class, title, onclick }, ...子节点 / 文字) */
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

const no = (seat) => Number(String(seat).slice(1));
const len = (t) => [...String(t || '')].length;
const coin = (seat, title = null) => el('span', { class: 'coin sm', title: title || `${no(seat)} 号` }, String(no(seat)));
const chip = (text, cls = '') => el('span', { class: `chip${cls ? ` ${cls}` : ''}` }, text);
const stamp = (id, fresh = false) => el('span', { class: `ts-stamp ${id}${fresh ? ' fresh' : ''}` }, ANS[id] || id);
const withSum = (p, sum) => { if (sum) p.dataset.sum = sum; return p; };
const cut = (t, n) => (len(t) > n ? `${[...t].slice(0, n - 1).join('')}…` : t);
function pips(hits, k, win = false, count = true) {
  const set = new Set(hits || []);
  return el('span', { class: `ts-pips${win ? ' win' : ''}`, title: hits?.length ? `命中要点 ${hits.join('、')}` : '一个要点都没命中' },
    Array.from({ length: k }, (_, i) => el('i', { class: set.has(i + 1) ? 'on' : null })), count ? el('b', {}, `${(hits || []).length}/${k}`) : null);
}

/**
 * 问答记录和公开发言一一对上：每条记录先是猜题者的话，再是汤主的回应（回答或判定）。
 * 文字直接取 view.speeches（和服务端停顿、对局页逐字打字用的是同一份）。
 * 返回 [{ e, i, say, reply }]
 */
function pairs(view) {
  const sp = view.speeches || [];
  const out = [];
  let j = 0;
  (view.qa || []).forEach((e, i) => {
    const say = sp[j++]?.text ?? e.text;
    const reply = e.answer || e.hits ? sp[j++]?.text ?? '' : null;
    out.push({ e, i, say, reply });
  });
  return out;
}

/** 刚判定完的那条还原（这一步才有判定结果）；没有返回 null */
function judgedNow(prev, view) {
  const e = (view.qa || []).at(-1);
  if (!e || !e.hits) return null;
  const before = (prev.qa || [])[view.qa.length - 1];
  return before && before.hits ? null : e;
}

function sceneOf(view) {
  const p = view.puzzle || {};
  const sub = [`《${p.title || ''}》`, view.final ? '提问已用完' : `剩余提问 ${view.left}/${view.maxQ}`].join(' · ');
  if (view.phase === 'over') {
    const winner = view.solved || null;
    // 没人还原成功：最好命中最多的那一位胜；并列就是平局（和 outcome 的 winner 一致）
    const gs = view.guessers || [];
    const max = Math.max(0, ...gs.map((g) => view.best?.[g] || 0));
    const firsts = gs.filter((g) => (view.best?.[g] || 0) === max);
    const top = winner || (firsts.length === 1 ? firsts[0] : null);
    const title = top ? `对局结束 · ${no(top)} 号胜` : '对局结束 · 平局';
    return { kind: 'over', title, sub: view.result?.reason || sub };
  }
  const t = view.turn;
  // 标题要在手机宽度的场景条里放得下（约 11 个字）
  const title = view.phase === 'answer' ? `第 ${view.asked} 问 · 汤主作答`
    : view.phase === 'judge' ? `${no(t)} 号还原 · 汤主判定`
      : view.phase === 'final' ? `最后还原 · ${no(t)} 号` : `第 ${view.asked + 1} 问 · 轮到 ${no(t)} 号`;
  return { kind: 'day', title, sub };
}

// ---------- 中间舞台的各块 ----------

/** 上帝视角的观众（进行中）：汤底默认收着，汤面卡右上角一个按钮点开 */
const peeking = (view) => !!view.truth && view.phase !== 'over' && view.viewer !== view.host;

/** 汤面卡：标题、难度和类型、汤面。常驻（不是 .panel） */
function soupCard(view, peek, onPeek) {
  const p = view.puzzle || {};
  const k = view.pointCount || 0;
  const btn = peeking(view) ? el('button', { type: 'button', class: 'peek', 'aria-expanded': String(peek.open), onclick: onPeek }, peek.open ? '收起汤底' : '看汤底') : null;
  return el('div', { class: 'paper ts-soup', role: 'region', 'aria-label': '汤面' },
    el('div', { class: 'hd' }, el('h4', {}, p.title || ''),
      el('span', { class: 'tg' }, [p.tierName, p.soup === '红汤' ? el('b', {}, '红汤') : p.soup, p.style, `${k} 个要点`].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))), btn),
    el('p', {}, p.surface || ''));
}

/** 汤底和要点（标出每条要点被谁命中过：还原判定是公开的） */
function truthBody(view, { scroll = false } = {}) {
  const k = view.pointCount || 0;
  const hitBy = Array.from({ length: k }, () => new Set());
  for (const e of view.qa || []) for (const h of e.hits || []) hitBy[h - 1]?.add(e.seat);
  const kids = [el('p', {}, view.truth),
    el('ol', { class: 'ts-points' }, (view.points || []).map((t, i) => el('li', { class: hitBy[i]?.size ? 'hit' : 'miss' },
      el('b', {}, String(i + 1)), el('span', {}, t),
      el('span', { class: 'who' }, [...(hitBy[i] || [])].sort((a, b) => no(a) - no(b)).map((s) => coin(s, `${no(s)} 号命中过`))))))];
  return scroll ? [el('div', { class: 'tb' }, kids)] : kids;
}

/**
 * 汤底：汤主（进行中）和终局常驻展开；上帝视角的观众（进行中）默认收着，点汤面卡上的「看汤底」展开。
 * 不用 .panel：折叠按「最高的面板先收」，汤底要是面板，会先把更要紧的问答收掉。
 */
function truthBlock(view, peek) {
  if (!view.truth) return null;
  const over = view.phase === 'over';
  const host = view.viewer === view.host;
  if (peeking(view) && !peek.open) return null;
  return el('div', { class: `well ts-truth${peeking(view) ? ' peek' : ''}`, role: 'region', 'aria-label': '汤底' },
    el('div', { class: 'head' }, el('span', { class: 'label' }, over ? '汤底揭晓' : '汤底'), over ? null : chip(host ? '只有你能看到' : '上帝视角', 'warn')),
    ...truthBody(view, { scroll: true }));
}

/** 问答流：每条一行；提问后面是汤主的印章，还原后面是命中的要点 */
function qaPanel(view, freshIdx, mark) {
  const k = view.pointCount || 0;
  const rows = pairs(view).map(({ e, i }) => {
    if (e.kind === 'pass') return el('div', { class: 'ts-row pass' }, coin(e.seat), el('span', { class: 'tx' }, '跳过本回合'), el('span'));
    if (e.kind === 'q') {
      return el('div', { class: 'ts-row q' }, coin(e.seat),
        el('span', { class: 'tx' }, el('span', { class: 'qn' }, `#${e.qn}`), e.text, e.note ? el('small', { class: 'note' }, `汤主补充：${e.note}`) : null),
        el('span', { class: 'end' }, e.answer ? stamp(e.answer, i === freshIdx) : chip('作答中', 'gold')));
    }
    const win = !!e.hits && e.hits.length === k;
    return el('div', { class: 'ts-row r' }, coin(e.seat),
      el('span', { class: 'tx', title: e.text }, chip(`还原 ${e.try}`, win ? 'good' : ''), ' ', e.text),
      el('span', { class: 'end' }, e.hits ? pips(e.hits, k, win) : chip('判定中', 'gold')));
  });
  if (view.phase === 'ask' || view.phase === 'final') {
    rows.push(el('div', { class: 'ts-row wait' }, coin(view.turn), el('span', { class: 'tx' }, view.phase === 'final' ? '最后一次还原…' : '思考中…'), el('span')));
  }
  // 标题行：问答 · 剩余提问；右边每人的还原次数和最好命中
  const std = el('span', { class: 'ts-std' }, (view.guessers || []).map((g) => {
    const used = view.tries?.[g] || 0;
    const best = view.best?.[g] || 0;
    const out = used >= view.maxTries && view.solved !== g;
    return el('span', { class: out ? 'done' : null, title: `${no(g)} 号已还原 ${used}/${view.maxTries} 次，最好命中 ${best}/${k}` },
      coin(g), el('span', { class: 'muted' }, `${used}/${view.maxTries}`), pips(Array.from({ length: best }, (_, i) => i + 1), k, view.solved === g, false));
  }));
  std.prepend(el('span', { class: 'muted' }, '还原 · 最好命中'));
  const label = el('div', { class: 'label' }, `问答${mark} · ${view.final ? '提问已用完' : `剩余提问 ${view.left}/${view.maxQ}`}`, std);
  const last = (view.qa || []).at(-1);
  const sum = !last ? '' : last.kind === 'q' ? `${no(last.seat)} 号：${last.text}${last.answer ? ` → ${ANS[last.answer]}` : ''}`
    : last.kind === 'r' ? `${no(last.seat)} 号还原${last.hits ? ` · ${last.hits.length}/${k}` : ''}` : '';
  return withSum(el('div', { class: 'panel ts-qa' }, label,
    rows.length ? el('div', { class: 'ts-qa-list', tabindex: 0, 'aria-label': '问答记录' }, rows) : el('div', { class: 'ts-empty' }, '还没有人提问')), cut(sum, 30));
}

export default {
  aspect: [16, 10],
  seatColor: (seat, index) => COLORS[(index ?? no(seat) - 1) % COLORS.length],

  /** 回放时公告卡也要演完；开局先停一会儿读汤面 */
  pauseAfter(prev, view) {
    if (!prev) return view ? INTRO_MS : 0;
    return this.announce(prev, view)?.ms || 0;
  },

  /** 场上公告卡：还原判定（命中几个、是否成功）、提问用完进入最后还原、终局揭晓 */
  announce(prev, view) {
    if (!prev || !view || !view.qa) return null;
    const k = view.pointCount || 0;
    const e = judgedNow(prev, view);
    const enteredFinal = view.final && !prev.final;
    const ended = view.phase === 'over' && prev.phase !== 'over';
    const lastCall = () => `${(view.guessers || []).filter((g) => (view.tries?.[g] || 0) < view.maxTries).map(no).join('、')} 号各还原最后一次`;
    if (e) {
      const ok = e.hits.length === k;
      const lines = [e.hits.length ? `命中要点：${e.hits.join('、')}` : '一个要点都没命中'];
      if (ended && !ok) lines.push('没有人完全还原 · 汤底揭晓');
      else if (enteredFinal) lines.push(`提问次数用完 · ${lastCall()}`);
      const left = view.maxTries - (view.tries?.[e.seat] || 0);
      return {
        kind: ok ? 'out' : 'vote',
        title: ok ? `${no(e.seat)} 号还原成功` : `${no(e.seat)} 号还原 · 命中 ${e.hits.length}/${k}`,
        sub: ok ? `第 ${e.try} 次还原命中全部 ${k} 个要点` : `第 ${e.try} 次还原${left > 0 && !view.final ? ` · 还剩 ${left} 次机会` : ''}`,
        lines, ms: CARD_MS,
      };
    }
    if (enteredFinal) return { kind: 'vote', title: '提问次数用完', sub: lastCall(), ms: CARD_MS };
    if (ended) return { kind: 'vote', title: '汤底揭晓', sub: view.result?.reason || '', ms: CARD_MS };
    return null;
  },

  /** 对称座位版式：场景条和每个座位卡的内容 */
  duoView(view) {
    if (!view || !view.seats) return { scene: null, seats: {} };
    const over = view.phase === 'over';
    const k = view.pointCount || 0;
    // 每个人说过的话：对局页点座位后在焦点区按顺序列出（文字和 view.speeches 一致，逐字打字靠它对上）
    const said = {};
    for (const { e, say, reply } of pairs(view)) {
      const tag = e.kind === 'q' ? `第 ${e.qn} 问` : e.kind === 'r' ? `还原 ${e.try}` : '跳过';
      (said[e.seat] ||= []).push({ tag, text: say });
      if (reply !== null) (said[view.host] ||= []).push({ tag: `${e.hits ? '判' : '答'} ${no(e.seat)} 号`, text: reply });
    }
    const seats = {};
    for (const s of view.seats) {
      const isHost = s === view.host;
      const used = view.tries?.[s] || 0;
      const best = view.best?.[s] || 0;
      let role = null;
      if (isHost) role = { text: '汤主', color: '#a17a12' };
      else if (view.solved === s) role = { text: '还原成功', color: '#2f7a70' };
      // 判定过的还原才有命中数（还在等汤主判定的那一次不算）
      else if ((view.qa || []).some((e) => e.seat === s && e.hits)) role = { text: `命中 ${best}/${k}`, color: used >= view.maxTries ? '#6b6b6b' : '#3559b5' };
      seats[s] = {
        note: isHost ? '' : `还原 ${used}/${view.maxTries}`,
        said: said[s] || [],
        state: !over && (view.pending || []).includes(s) ? 'speaking' : '',
        role,
        votes: 0,
        pick: null,
      };
    }
    return { scene: sceneOf(view), seats };
  },

  createStage({ onAction }) {
    injectStyle();
    const root = el('div', { class: 'ts-stage' });

    // ---------- 操作区：常驻节点，输入框不随每次重画丢失内容和焦点 ----------
    // 类名带上 uc-ctrl / uc-form：对局页按这两个类把操作区钉在手机屏幕底部、不折叠、在输入框上面放最近几句（见 web/js/match.js、fold.js）。
    // 谁是卧底自己的 .uc-ctrl / .uc-form 样式和这里的 .ts-ctrl / .ts-form 写法一致，同一页先后加载两个游戏也不会互相改样子。
    const head = el('div', { class: 'head' });
    const quote = el('div', { class: 'quote' });
    // 猜题者：一个输入框，两个按钮
    const text = el('textarea', { rows: 1, maxlength: 400, autocomplete: 'off', 'aria-label': '提问或还原', placeholder: '问一个是非题，或写下你还原的汤底' });
    const count = el('span', { class: 'n', 'aria-live': 'polite' });
    const askBtn = el('button', { type: 'button', class: 'btn primary sm' }, '提问');
    const solveBtn = el('button', { type: 'button', class: 'btn sm' }, '还原');
    const guessForm = el('form', { class: 'ts-form uc-form' }, text, el('div', { class: 'side' }, count, askBtn, solveBtn));
    // 汤主回答：四枚印章 + 一句补充
    const note = el('input', { type: 'text', maxlength: 20, autocomplete: 'off', 'aria-label': '补充一句', placeholder: '补充一句（可不填）' });
    const ansBox = el('div', { class: 'ts-answer' },
      Object.keys(ANS).map((id) => el('button', { type: 'button', class: 'btn', 'data-id': id, 'aria-label': `回答「${ANS[id]}」`, onclick: () => {
        const n = note.value.replace(/[\r\n|]+/g, ' ').trim();
        onAction(n ? `${id}|${n}` : id);
      } }, stamp(id))), note);
    // 汤主判定：勾选命中的要点
    const judgeList = el('div', { class: 'ts-judge' });
    const ctrl = el('div', { class: 'panel ts-ctrl uc-ctrl' }, head, quote, guessForm, ansBox, judgeList);
    ctrl.hidden = true;
    const body = el('div', { class: 'ts-body', style: 'display:contents' });
    root.append(body, ctrl);

    let ctx = { key: null, final: false, canSolve: true, lim: { qMax: 60, rMax: 220 } };
    let judgeKey = null;
    let seenQa = null; // 上次画过的问答条数：新落下的那枚印章盖下来一次
    const peek = { open: false }; // 上帝视角的观众点开了汤底没有
    let lastDraw = null; // 最近一次画的 view 和参数：点「看汤底」时原样重画
    const onPeek = () => {
      peek.open = !peek.open;
      if (lastDraw) api.render(lastDraw.view, lastDraw.opts);
      // 汤底展开 / 收起后版式签名变了（问答面板标题的零宽标记），让对局页的折叠马上重新量一次（它在 resize 时检查签名）
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
    };
    const clean = (t) => t.replace(/[\r\n]+/g, ' ').trim();
    const refresh = () => {
      const n = len(clean(text.value));
      const qOk = n > 0 && n <= ctx.lim.qMax && !ctx.final;
      const rOk = n > 0 && n <= ctx.lim.rMax && ctx.canSolve;
      const max = ctx.final || (ctx.canSolve && n > ctx.lim.qMax) ? ctx.lim.rMax : ctx.lim.qMax;
      count.textContent = n ? `${n}/${max}` : '';
      count.classList.toggle('bad', n > (ctx.canSolve ? ctx.lim.rMax : ctx.lim.qMax));
      askBtn.disabled = !qOk;
      askBtn.hidden = ctx.final;
      solveBtn.disabled = !rOk;
      solveBtn.hidden = !ctx.canSolve;
      solveBtn.className = `btn sm${ctx.final ? ' primary' : ''}`;
    };
    // 输入框随内容长高（一行起，最多 8 行左右）
    const grow = () => { text.style.height = 'auto'; if (text.value) text.style.height = `${text.scrollHeight + 2}px`; };
    text.addEventListener('input', () => { grow(); refresh(); });
    const submit = (kind) => {
      const t = clean(text.value);
      if (!t) return;
      if (kind === 'q' && (ctx.final || len(t) > ctx.lim.qMax)) return;
      if (kind === 'r' && (!ctx.canSolve || len(t) > ctx.lim.rMax)) return;
      onAction(`${kind === 'q' ? '提问' : '还原'}：${t}`);
    };
    askBtn.addEventListener('click', () => submit('q'));
    solveBtn.addEventListener('click', () => submit('r'));
    guessForm.addEventListener('submit', (e) => { e.preventDefault(); submit(ctx.final ? 'r' : 'q'); });
    // 回车：平时当提问提交，最后还原阶段当还原提交（还原会用掉一次机会，平时只能点按钮）；Shift+回车换行
    text.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      submit(ctx.final ? 'r' : 'q');
    });

    function renderJudge(view) {
      const e = view.qa.at(-1);
      const key = `${view.qa.length}`;
      if (key === judgeKey) return;
      judgeKey = key;
      const k = view.pointCount || 0;
      const boxes = [];
      const verdict = el('span', { class: 'hint' });
      const tip = el('span', { class: 'sub' }, '勾选还原里说中的要点');
      const sync = () => {
        const hits = boxes.map((b, i) => (b.checked ? i + 1 : 0)).filter(Boolean);
        verdict.textContent = hits.length === k ? `全部命中：${e ? `${no(e.seat)} 号还原成功` : ''}` : `命中 ${hits.length}/${k}`;
      };
      const rows = (view.points || Array.from({ length: k }, (_, i) => `要点 ${i + 1}`)).map((t, i) => {
        const b = el('input', { type: 'checkbox', onchange: sync });
        boxes.push(b);
        return el('label', {}, b, el('b', {}, String(i + 1)), el('span', {}, t));
      });
      const go = el('button', { type: 'button', class: 'btn primary sm', onclick: () => {
        const hits = boxes.map((b, i) => (b.checked ? i + 1 : 0)).filter(Boolean);
        onAction(`hit:${hits.length ? hits.join(',') : 'none'}`);
      } }, '判定');
      judgeList.replaceChildren(...rows, el('div', { class: 'go' }, go, verdict, tip));
      sync();
    }

    const api = {
      el: root,
      render(view, opts = {}) {
        if (!view || !view.seats) return;
        lastDraw = { view, opts };
        const movable = opts.movable ?? null;
        const mine = !!movable && (view.pending || []).includes(movable) && view.phase !== 'over';
        const guessing = mine && movable !== view.host && (view.phase === 'ask' || view.phase === 'final');
        const answering = mine && movable === view.host && view.phase === 'answer';
        const judging = mine && movable === view.host && view.phase === 'judge';
        const cur = (view.qa || []).at(-1);
        const mode = guessing ? 'guess' : answering ? 'answer' : judging ? 'judge' : 'none';
        root.className = `ts-stage${mode !== 'none' ? ` acting ${mode === 'judge' ? 'judging' : ''}` : ''}`.trim();

        // ---------- 操作区 ----------
        head.replaceChildren();
        if (guessing) {
          const left = view.maxTries - (view.tries?.[movable] || 0);
          head.append(el('span', { class: 'label' }, '你的行动'), el('b', {}, view.phase === 'final' ? '最后一次机会 · 只能还原' : `第 ${view.asked + 1} 问`),
            view.phase === 'final' ? null : el('span', { class: 'sub' }, `全场还剩 ${view.left}/${view.maxQ} 问`),
            el('span', { class: 'hint' }, left > 0 ? `还能还原 ${left} 次` : '还原机会已用完'));
        }
        // 汤主：要回应的那句话放在最上面（谁、第几问 / 第几次还原 + 原话），省掉单独的标题行
        head.hidden = !guessing;
        quote.hidden = !(answering || judging);
        if (answering) quote.replaceChildren(el('span', { class: 'who' }, `${no(cur.seat)} 号 · 第 ${cur.qn} 问`), cur.text);
        if (judging) quote.replaceChildren(el('span', { class: 'who' }, `${no(cur.seat)} 号 · 第 ${cur.try} 次还原`), cur.text);
        guessForm.hidden = !guessing;
        ansBox.hidden = !answering;
        judgeList.hidden = !judging;
        if (guessing) {
          const key = `${view.qa.length}`;
          if (key !== ctx.key) { text.value = ''; grow(); }
          ctx = { ...ctx, key, final: view.phase === 'final', canSolve: (view.tries?.[movable] || 0) < view.maxTries, lim: { qMax: view.limits?.qMax || 60, rMax: view.limits?.rMax || 220 } };
          refresh();
          // 手机上不抢焦点（会弹出键盘挡住画面）
          const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
          if (!coarse && typeof document !== 'undefined' && document.activeElement !== text && !document.activeElement?.closest?.('input, textarea, select')) text.focus({ preventScroll: true });
        } else ctx.key = null;
        if (answering && ctx.ansKey !== view.qa.length) { note.value = ''; ctx.ansKey = view.qa.length; }
        if (judging) renderJudge(view); else judgeKey = null;
        ctrl.hidden = !(guessing || answering || judging);

        // ---------- 舞台 ----------
        // 新落下的回答盖一次章（第一次打开、回放往回翻都不盖）
        const n = (view.qa || []).length;
        const last = view.qa?.at(-1);
        const fresh = seenQa !== null && last?.answer && (n > seenQa.n || (n === seenQa.n && !seenQa.answered)) ? n - 1 : -1;
        seenQa = { n, answered: !!last?.answer };
        // 问答列表：看的人往上翻过就保持位置，否则跟到最新一条
        const old = body.querySelector('.ts-qa-list');
        const keep = old && old.scrollHeight - old.scrollTop - old.clientHeight > 8 ? old.scrollTop : null;
        const oldTb = body.querySelector('.ts-truth .tb');
        const tbTop = oldTb ? oldTb.scrollTop : 0;
        body.replaceChildren(soupCard(view, peek, onPeek), truthBlock(view, peek) || '', qaPanel(view, fresh, MODE_MARK[mode] + (peeking(view) && peek.open ? PEEK_MARK : '')));
        const list = body.querySelector('.ts-qa-list');
        if (list) list.scrollTop = keep ?? list.scrollHeight;
        const tb = body.querySelector('.ts-truth .tb');
        if (tb) tb.scrollTop = tbTop;
        // 第一次画时还没排版（scrollHeight 为 0）：下一帧再跟到最新一条
        if (list && keep === null && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { if (list.isConnected) list.scrollTop = list.scrollHeight; });
      },
    };
    return api;
  },
};
