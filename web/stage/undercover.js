// 谁是卧底画面（左右对称座位版式）。座位卡由对局页按 duoView 画在左右两列，这里只画中间舞台：
// 上帝视角顶部是两个词（玩家视角只有自己的词）；本轮发言顺序、投票票型（小铜钱是投票人）、历史（每轮谁出局、身份）。
// 玩家本人：描述阶段在舞台上方输入一句话；投票阶段点左右的座位卡投票（duoView 给座位的 pick）。
// 隐藏信息：只用 view 里有的东西（view 已按视角裁剪过），玩家视角不会出现别人的词和身份（出局者身份公开）。

// 座位色：不用朱红，朱红留给卧底和出局
const COLORS = ['var(--black-side)', '#3559b5', '#9a5d24', '#2f7a70', '#7d3c98', '#a17a12', '#6b6b6b', '#4f6b2f'];
const ROLE_COLOR = { 卧底: '#b4241a', 平民: '#5d6b4e' };
const PHASE = { speak: '描述', vote: '投票', tiespeak: '平票发言', revote: '平票重投', over: '结束' };

// 布局用的少量样式；面板、凹槽、票型行（.vrow .vb .voters）、行动行（.act）、两栏（.panels）、词卡（.wordcard）都用设计系统的类
const CSS = `
.uc-stage { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.uc-body { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.uc-stage .panels { padding-bottom: 0; }
.uc-stage .panel > .label { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.uc-stage .act > span { min-width: 0; }
.uc-stage .act > span.line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uc-stage .act.todo > b, .uc-stage .act.todo > span { color: var(--faint); }
.uc-stage .act.now > span { color: var(--gold-2); }
.uc-stage .vrow > span:first-child { white-space: nowrap; }
.uc-stage .vrow.out > span:first-child { color: var(--zhu-2); font-weight: 700; }
.uc-stage .voters { flex-wrap: wrap; }
.uc-list { max-height: 176px; overflow-y: auto; scrollbar-width: thin; }
.uc-strip { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 18px; padding: 9px 14px; font-size: 13.5px; }
.uc-strip > span { display: inline-flex; align-items: center; gap: 8px; }
.uc-strip.hist { justify-content: flex-start; gap: 6px 16px; }
.uc-res { margin-top: 8px; font-weight: 700; color: var(--gold-2); font-size: 13.5px; }
.uc-res.hot { color: var(--zhu-2); }
.uc-sub { margin-top: 10px; font-size: 12px; color: var(--muted); }
.uc-empty { color: var(--faint); font-size: var(--fs-sm); padding: 8px 0 2px; }
.uc-role { color: color-mix(in srgb, var(--rc) 55%, var(--text)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rc) 75%, transparent); }
.uc-ctrl { display: flex; flex-direction: column; gap: 8px; padding: 10px 14px 12px; }
.uc-ctrl[hidden], .uc-form[hidden] { display: none; }
.uc-ctrl .head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.uc-ctrl .hint { color: var(--gold-2); font-weight: 600; }
.uc-form { display: flex; gap: 8px; align-items: center; }
.uc-form input { flex: 1; min-width: 0; }
.uc-form .n { font: 500 12px/1 var(--num); color: var(--muted); min-width: 3.4em; text-align: right; }
.uc-form .n.bad { color: var(--zhu-2); }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('uc-style')) return;
  const st = document.createElement('style');
  st.id = 'uc-style';
  st.textContent = CSS;
  document.head.append(st);
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
const nums = (seats) => seats.map((s) => `${no(s)} 号`).join('、');
const clip = (t, n = 36) => { const a = [...String(t || '')]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join(''); };
const coin = (seat, title = null) => el('span', { class: 'coin sm', title: title || `${no(seat)} 号` }, String(no(seat)));
const chip = (text, cls = '') => el('span', { class: `chip${cls ? ` ${cls}` : ''}` }, text);
const roleChip = (name) => el('span', { class: 'chip uc-role', style: `--rc:${ROLE_COLOR[name] || 'var(--gold)'}` }, name);
const act = (head, body, tag = null, cls = '') => el('div', { class: `act${cls ? ` ${cls}` : ''}` }, el('b', {}, head), body, tag);
const panel = (title, ...kids) => el('div', { class: 'panel' }, el('div', { class: 'label' }, title), ...kids);
/** 面板摘要：屏幕放不下时，对局页把面板折成胶囊按钮，按钮上显示这句 */
const withSum = (p, sum) => { if (sum) p.dataset.sum = sum; return p; };
const isVoting = (view) => view.phase === 'vote' || view.phase === 'revote';

function countVotes(votes) {
  const c = {};
  for (const t of Object.values(votes || {})) c[t] = (c[t] || 0) + 1;
  return c;
}

/** 座位卡上的得票：投票中（上帝视角）显示当前票；刚计完票、还没有新发言时显示上一次计票；玩家视角投票中别人的票没公开 */
function seatCounts(view) {
  if (isVoting(view)) return view.god ? countVotes(view.votes) : {};
  const last = (view.voteLog || []).at(-1);
  if (!last) return {};
  if (last.after === (view.speeches || []).length || (view.phase === 'tiespeak' && last.round === view.round)) return last.counts || {};
  return {};
}

function voteOutcome(v) {
  if (v.out) return `${no(v.out)} 号出局（${v.role || '？'}）`;
  if (v.next === 'tie') return `${nums(v.tied || [])}平票，平票者加赛`;
  return v.stage === 'revote' ? '再次平票，本轮无人出局' : '所有人平票，本轮无人出局';
}

/** 本轮发言顺序：从本轮先发言的人起按座位轮转的存活者 */
function speakOrder(view) {
  const i = Math.max(0, view.seats.indexOf(view.starter));
  const alive = new Set(view.alive || []);
  return [...view.seats.slice(i), ...view.seats.slice(0, i)].filter((s) => alive.has(s));
}

function sceneSub(view) {
  if (view.phase === 'over') return view.result?.reason || '';
  const parts = [];
  const last = (view.voteLog || []).at(-1);
  if (view.phase === 'speak' && last && last.round === view.round - 1) parts.push(`上轮${last.out ? ` ${no(last.out)} 号出局（${last.role}）` : '无人出局'}`);
  if (view.phase === 'speak') {
    const done = (view.speeches || []).filter((x) => x.round === view.round && !x.tie).length;
    parts.push(`描述 ${Math.min(done + 1, view.alive.length)}/${view.alive.length}`);
  } else if (isVoting(view)) {
    const total = (view.voters || []).length;
    parts.push(`已投 ${total - (view.pending || []).length}/${total}`);
  } else if (view.phase === 'tiespeak') parts.push(`${nums(view.tied || [])}平票 · 加赛发言`);
  return parts.join(' · ');
}

// ---------- 中间舞台的各块 ----------

/** 词：上帝视角两个词都有；玩家视角只有自己的词 */
function wordsBlock(view) {
  if (view.pair) {
    return el('div', { class: 'well uc-strip' },
      el('span', {}, el('span', { class: 'label' }, '平民词'), el('span', { class: 'wordcard' }, view.pair.civ)),
      el('span', {}, el('span', { class: 'label' }, '卧底词'), el('span', { class: 'wordcard spy' }, view.pair.spy)));
  }
  if (view.myWord) return el('div', { class: 'well uc-strip' }, el('span', {}, el('span', { class: 'label' }, '你的词'), el('span', { class: 'wordcard' }, view.myWord)));
  return null;
}

/** 本轮发言：说过的话按顺序列出（单行，全文在提示里），后面是还没轮到的人 */
function speechPanel(view) {
  const mine = (view.speeches || []).filter((x) => x.round === view.round);
  const rows = mine.map((sp) => act(`${no(sp.seat)} 号`, el('span', { class: 'line', title: sp.text }, sp.text), sp.tie ? chip('加赛', 'warn') : null));
  let todo = [];
  if (view.phase === 'speak') {
    const spoke = new Set(mine.filter((x) => !x.tie).map((x) => x.seat));
    todo = speakOrder(view).filter((s) => !spoke.has(s));
  } else if (view.phase === 'tiespeak') {
    const spoke = new Set(mine.filter((x) => x.tie).map((x) => x.seat));
    todo = speakOrder(view).filter((s) => (view.tied || []).includes(s) && !spoke.has(s));
  }
  const now = todo.includes(view.speaker) ? act(`${no(view.speaker)} 号`, el('span', { class: 'line' }, '描述中…'), chip(view.phase === 'tiespeak' ? '加赛' : '描述', 'gold'), 'now') : null;
  const rest = todo.filter((s) => s !== view.speaker);
  const wait = rest.length ? el('div', { class: 'act todo' }, el('b', {}, '待发言'), el('div', { class: 'voters' }, rest.map((s) => el('span', {}, String(no(s)))))) : null;
  return panel(`第 ${view.round} 轮发言`, rows.length ? el('div', { class: 'uc-list' }, rows) : now || wait ? null : el('div', { class: 'uc-empty' }, '还没有人发言'), now, wait);
}

/** 票型：每个被投的人一行（得票条 + 投票人的小铜钱） */
function tally(votes, { out = null, total = 0 } = {}) {
  const by = {};
  for (const [voter, t] of Object.entries(votes || {})) (by[t] ||= []).push(voter);
  const n = total || Object.keys(votes || {}).length || 1;
  const order = Object.keys(by).sort((a, b) => by[b].length - by[a].length || no(a) - no(b));
  const top = order.length ? by[order[0]].length : 0;
  return order.map((t) => el('div', { class: `vrow${t === out ? ' out' : ''}`, title: `${no(t)} 号 ${by[t].length} 票` },
    el('span', {}, `${no(t)} 号 · ${by[t].length}`),
    el('div', { class: 'vb' }, el('i', { class: t === out || (!out && by[t].length === top) ? null : 'g', style: `width:${Math.round((by[t].length / n) * 100)}%` })),
    el('div', { class: 'voters' }, by[t].sort((a, b) => no(a) - no(b)).map((v) => el('span', { title: `${no(v)} 号投 ${no(t)} 号` }, String(no(v)))))));
}

function votePanel(view) {
  const kids = [];
  let entries = (view.voteLog || []).filter((v) => v.round === view.round);
  let label = '投票';
  // 新一轮还没投票时，显示上一轮的票型
  if (!entries.length && !isVoting(view)) {
    entries = (view.voteLog || []).filter((v) => v.round === view.round - 1);
    if (entries.length) label = `投票 · 第 ${view.round - 1} 轮`;
  }
  for (const v of entries) {
    if (entries.length > 1 || v.stage === 'revote') kids.push(el('div', { class: 'uc-sub' }, v.stage === 'revote' ? '平票重投' : '投票'));
    kids.push(...tally(v.votes, { out: v.out }), el('div', { class: `uc-res${v.out ? ' hot' : ''}` }, voteOutcome(v)));
  }
  if (isVoting(view)) {
    if (entries.length) kids.push(el('div', { class: 'uc-sub' }, PHASE[view.phase]));
    const votes = view.votes || {};
    if (view.god) kids.push(...tally(votes, { total: (view.voters || []).length }));
    else if (view.viewer && votes[view.viewer]) kids.push(act('你', el('span', {}, `投 ${no(votes[view.viewer])} 号`)));
    const pend = view.pending || [];
    if (pend.length) {
      kids.push(el('div', { class: 'vrow' }, el('span', { class: 'muted' }, `未投 · ${pend.length}`), el('div', { class: 'vb' }),
        el('div', { class: 'voters' }, pend.map((s) => el('span', {}, String(no(s)))))));
    }
    if (!view.god) kids.push(el('div', { class: 'uc-empty' }, '计票后公开票型'));
  }
  if (!kids.length) kids.push(el('div', { class: 'uc-empty' }, '描述结束后投票'));
  const sum = isVoting(view) ? `已投 ${(view.voters || []).length - (view.pending || []).length}/${(view.voters || []).length}` : entries.length ? voteOutcome(entries.at(-1)) : '';
  return withSum(panel(label, el('div', { class: 'uc-list' }, kids)), sum);
}

/** 历史：每轮的结果（出局者和身份，或无人出局） */
function historyBlock(view) {
  const ends = (view.voteLog || []).filter((v) => v.next !== 'tie');
  if (!ends.length) return null;
  return el('div', { class: 'well uc-strip hist' }, el('span', { class: 'label' }, '历史'),
    ends.map((v) => el('span', {}, el('span', { class: 'muted' }, `第 ${v.round} 轮`),
      v.out ? [coin(v.out), roleChip(v.role)] : el('span', {}, '无人出局'))));
}

export default {
  /** 场上公告：有人被投出时，中央弹一张卡（出局时公开身份） */
  /** 回放时公告卡也要演完：多停 2.6 秒 */
  pauseAfter(prev, view) { return this.announce(prev, view) ? 2600 : 0; },

  announce(prev, view) {
    if (!prev || !view?.outInfo) return null;
    const before = new Set((prev.outInfo || []).map((o) => o.seat));
    const fresh = view.outInfo.filter((o) => !before.has(o.seat));
    if (!fresh.length) return null;
    const no = (s) => `${String(s).replace(/^\D+/, '')} 号`;
    return { kind: 'out', title: `${fresh.map((o) => no(o.seat)).join('、')} 被投出`, sub: fresh.map((o) => (o.role ? `身份是${o.role}` : '')).filter(Boolean).join('；') || `第 ${view.round} 轮` };
  },
  aspect: [16, 10],
  seatColor: (seat, index) => COLORS[(index ?? no(seat) - 1) % COLORS.length],

  /** 对称座位版式：场景条和每个座位卡的内容 */
  duoView(view, { movable = null, actions = null } = {}) {
    if (!view || !view.seats) return { scene: null, seats: {} };
    const over = view.phase === 'over';
    const alive = new Set(view.alive || []);
    const counts = seatCounts(view);
    const picks = {};
    for (const a of movable && Array.isArray(actions) ? actions : []) {
      if (/^p\d$/.test(a.id)) picks[a.id] = `${view.phase === 'revote' ? '重投' : '投票'}放逐 ${no(a.id)} 号`;
    }
    // 每个人的全部描述：对局页点座位后在焦点区按轮次列出
    const saidBy = {};
    for (const sp of view.speeches || []) (saidBy[sp.seat] ||= []).push({ tag: `第 ${sp.round} 轮${sp.tie ? ' · 加赛' : ''}`, text: sp.text });
    const outRound = Object.fromEntries((view.outInfo || []).map((o) => [o.seat, o.round]));
    const seats = {};
    for (const s of view.seats) {
      const st = [];
      if (!over && view.speaker === s) st.push('speaking');
      if (!alive.has(s)) st.push('dead');
      // 身份：view.identity 只含本视角能知道的（上帝视角全部；玩家视角是出局者，自己出局后也有）
      const r = view.identity?.[s];
      // 词：上帝视角全部；玩家视角只有自己的，别人的扣着
      const w = view.words?.[s];
      seats[s] = {
        note: s in outRound ? `第 ${outRound[s]} 轮出局` : '',
        said: saidBy[s] || [],
        state: st.join(' '),
        role: r ? { text: r, color: ROLE_COLOR[r] || null } : null,
        word: w ? { text: w, back: false, spy: r === '卧底' } : { back: true }, // spy：已知是卧底的词（对局页可用 .word.spy 标红）
        votes: counts[s] || 0,
        pick: picks[s] ? s : null,
        pickTitle: picks[s],
      };
    }
    const title = over ? `对局结束 · ${view.result?.team || ''}胜` : `第 ${view.round} 轮 · ${PHASE[view.phase] || ''}`;
    return { scene: { kind: 'day', title, sub: sceneSub(view) }, seats };
  },

  createStage({ onAction }) {
    injectStyle();
    const root = el('div', { class: 'uc-stage' });

    // 操作区：常驻节点，输入框不随每次重画丢失内容和焦点
    const ctrlHead = el('div', { class: 'head' });
    const input = el('input', { type: 'text', maxlength: 60, autocomplete: 'off', placeholder: '一句话描述你的词' });
    const count = el('span', { class: 'n' });
    const send = el('button', { type: 'submit', class: 'btn primary sm' }, '发言');
    const form = el('form', { class: 'uc-form' }, input, count, send);
    const ctrl = el('div', { class: 'panel uc-ctrl' }, ctrlHead, form);
    ctrl.hidden = true;
    const body = el('div', { class: 'uc-body' });
    root.append(ctrl, body);

    let ctx = { maxLen: 30, word: null, key: null };
    const clean = (t) => t.replace(/[\r\n]+/g, '').trim();
    const tooMany = (t) => [...t].length > ctx.maxLen;
    const hasWord = (t) => !!ctx.word && [...new Set(ctx.word)].every((c) => t.includes(c));
    const refreshCount = () => {
      const t = clean(input.value);
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
      const t = clean(input.value);
      if (!t || tooMany(t) || hasWord(t)) return;
      onAction(t);
    });

    return {
      el: root,
      render(view, { movable = null, actions = null } = {}) {
        if (!view || !view.seats) return;
        const speaking = !!movable && (view.phase === 'speak' || view.phase === 'tiespeak') && view.speaker === movable;
        const voting = !!movable && Array.isArray(actions) && actions.length > 0;

        // ---------- 操作区 ----------
        ctrlHead.replaceChildren();
        if (speaking || voting) {
          ctrlHead.append(el('span', { class: 'label' }, '你的行动'), el('b', {}, PHASE[view.phase] || ''));
          if (voting) ctrlHead.append(el('span', { class: 'hint' }, view.phase === 'revote' ? '点座位卡，在平票者中重投' : '点座位卡投票'));
        }
        const key = speaking ? `${view.round}-${view.phase}-${(view.speeches || []).length}` : null;
        if (key && key !== ctx.key) input.value = '';
        ctx = { maxLen: view.maxLen || 30, word: view.myWord, key };
        form.hidden = !speaking;
        if (speaking) refreshCount();
        ctrl.hidden = !speaking && !voting;
        if (speaking && document.activeElement !== input) input.focus({ preventScroll: true });

        // ---------- 舞台 ----------
        body.replaceChildren(...[
          wordsBlock(view),
          // 描述改到对局页焦点区按人看，这里只留票型；描述阶段还没有票就不占地方
          (view.phase === 'speak' || view.phase === 'tiespeak') && !(view.voteLog || []).some((v) => v.round >= view.round - 1) ? null : votePanel(view),
          historyBlock(view),
        ].filter(Boolean));
        for (const l of body.querySelectorAll('.uc-list')) l.scrollTop = l.scrollHeight; // 最新的在下面
      },
    };
  },
};
