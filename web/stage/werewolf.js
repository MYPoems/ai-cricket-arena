// 狼人杀画面（左右对称座位版式）。座位卡由对局页按 duoView 画在左右两列，这里只画中间舞台：
// 白天：公告（昨夜结果、猎人开枪）、本轮发言顺序、投票票型（小铜钱是投票人）；
// 夜里：今夜行动（上帝视角看全部；玩家只看自己知道的：狼人看狼队提名，预言家看查验，女巫看刀口和药）；
// 底部是出局记录；玩家本人行动时最上面是操作区：发言 / 遗言输入框，空刀 / 弃票 / 不开枪 / 救人 / 不用药按钮。
// 选目标（刀人、查验、投票、开枪、下毒）一律点左右的座位卡，由 duoView 给座位的 pick。
// 隐藏信息：只用 view 里有的东西（view 已按视角裁剪过），玩家视角不会出现别人的身份和夜间行动。

// 座位色：不用朱红，朱红留给狼人和死亡
const COLORS = ['var(--black-side)', '#3559b5', '#9a5d24', '#2f7a70', '#7d3c98', '#a17a12', '#6b6b6b', '#4f6b2f', '#8a4f6b'];
const ROLE_COLOR = { 狼人: '#b4241a', 预言家: '#2e4f86', 女巫: '#763c86', 猎人: '#a2632a', 村民: '#5d6b4e' };
const PHASE = {
  wolf: '狼人行动', seer: '预言家查验', witch: '女巫用药', lastword: '遗言', hunter: '猎人开枪',
  speak: '发言', vote: '放逐投票', tiespeak: '平票发言', revote: '平票重投', over: '结束', night: '天黑请闭眼', wait: '结算中',
};
const NIGHT_PHASES = new Set(['wolf', 'seer', 'witch', 'night']);
const CAUSE = { wolf: '狼刀', poison: '毒杀', vote: '放逐', shot: '枪杀' };
const NONE_LABEL = { wolf: '空刀', vote: '弃票', revote: '弃票', hunter: '不开枪' };
const PICK_VERB = { wolf: '提名刀', seer: '查验', vote: '投票放逐', revote: '重投放逐', hunter: '开枪带走' };
const HINT = { wolf: '点座位卡，提名今晚要刀的人', seer: '点座位卡，查验一人', vote: '点座位卡，投票放逐', revote: '点座位卡，在平票者中重投', hunter: '点座位卡开枪' };

// 布局用的少量样式；面板、凹槽、票型行（.vrow .vb .voters）、行动行（.act）、两栏（.panels）都用设计系统的类
const CSS = `
.ww-stage { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.ww-body { display: flex; flex-direction: column; gap: 10px; min-height: 0; transition: filter .6s; }
.ww-stage.night .ww-body { filter: brightness(.8) saturate(.8); }
.ww-stage .panels { padding-bottom: 0; }
.ww-stage .panel > .label { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.ww-stage .act > span { min-width: 0; }
.ww-stage .act > span.line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ww-stage .act.todo > b, .ww-stage .act.todo > span { color: var(--faint); }
.ww-stage .act.now > span { color: var(--gold-2); }
.ww-stage .act .sub { display: block; margin-top: 3px; font-size: 12px; color: var(--muted); }
.ww-stage .vrow > span:first-child { white-space: nowrap; }
.ww-stage .vrow.out > span:first-child { color: var(--zhu-2); font-weight: 700; }
.ww-stage .voters { flex-wrap: wrap; }
.ww-list { max-height: 176px; overflow-y: auto; scrollbar-width: thin; }
.ww-res { margin-top: 8px; font-weight: 700; color: var(--gold-2); font-size: 13.5px; }
.ww-res.hot { color: var(--zhu-2); }
.ww-sub { margin-top: 10px; font-size: 12px; color: var(--muted); }
.ww-news { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; padding: 8px 14px; font-size: 13.5px; }
.ww-news > span { display: inline-flex; align-items: center; gap: 6px; }
.ww-news .hot { color: var(--zhu-2); font-weight: 700; }
.ww-ctrl { display: flex; flex-direction: column; gap: 8px; padding: 10px 14px 12px; }
.ww-ctrl[hidden], .ww-form[hidden] { display: none; }
.ww-ctrl .head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ww-ctrl .hint { color: var(--gold-2); font-weight: 600; }
.ww-ctrl .btns { display: flex; flex-wrap: wrap; gap: 8px; }
.ww-ctrl .btns:empty { display: none; }
.ww-form { display: flex; gap: 8px; align-items: center; }
.ww-form input { flex: 1; min-width: 0; }
.ww-form .n { font: 500 12px/1 var(--num); color: var(--muted); min-width: 3.4em; text-align: right; }
.ww-form .n.bad { color: var(--zhu-2); }
.ww-empty { color: var(--faint); font-size: var(--fs-sm); padding: 8px 0 2px; }
.ww-role { color: color-mix(in srgb, var(--rc) 55%, var(--text)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rc) 75%, transparent); }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('ww-style')) return;
  const st = document.createElement('style');
  st.id = 'ww-style';
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
const roleChip = (name) => el('span', { class: 'chip ww-role', style: `--rc:${ROLE_COLOR[name] || 'var(--gold)'}` }, name);
/** 行动行：b 标题 + 内容 + 右侧状态 chip */
const act = (head, body, tag = null, cls = '') => el('div', { class: `act${cls ? ` ${cls}` : ''}` }, el('b', {}, head), body, tag);
const panel = (title, ...kids) => el('div', { class: 'panel' }, el('div', { class: 'label' }, title), ...kids);
/** 面板摘要：屏幕放不下时，对局页把面板折成胶囊按钮，按钮上显示这句（只用面板里本来就有的信息） */
const withSum = (p, sum) => { if (sum) p.dataset.sum = sum; return p; };
const isNight = (view) => view.phase !== 'over' && (!!view.night || NIGHT_PHASES.has(view.phase));
const isVoting = (view) => view.phase === 'vote' || view.phase === 'revote';
const todayVotes = (view) => (view.voteLog || []).filter((v) => v.day === view.day);

function countVotes(votes) {
  const c = {};
  for (const t of Object.values(votes || {})) if (t !== 'none') c[t] = (c[t] || 0) + 1;
  return c;
}

/** 座位卡上的得票：投票中（上帝视角）显示当前票；白天投完后显示今天最后一次计票；玩家视角投票中别人的票没公开，不显示 */
function seatCounts(view) {
  if (isVoting(view)) return view.god ? countVotes(view.votes) : {};
  if (isNight(view)) return {};
  const last = (view.voteLog || []).at(-1);
  return last && last.day === view.day ? last.counts || {} : {};
}

/** 一次计票的结果文字 */
function voteOutcome(v) {
  if (v.out) return `${no(v.out)} 号被放逐`;
  if (v.next === 'tie') return `${nums(v.tied || [])}平票，平票者再各说一句`;
  if (!Object.keys(v.counts || {}).length) return '全部弃票，无人出局';
  return '再次平票，无人出局';
}

/** 一夜行动的简述（只含 view 里给了的字段） */
function nightParts(n) {
  if (!n) return [];
  const parts = [];
  if ('kill' in n) parts.push(n.kill ? `狼刀 ${no(n.kill)} 号` : '空刀');
  if (n.check) parts.push(`查验 ${no(n.check)} 号 · ${n.checkWolf ? '狼人' : '好人'}`);
  if (n.save) parts.push('女巫救人');
  if (n.poison) parts.push(`女巫毒 ${no(n.poison)} 号`);
  return parts;
}

/** 场景条副标题 */
function sceneSub(view) {
  if (view.phase === 'over') return view.result?.reason || '';
  const parts = [];
  const night = isNight(view);
  const lastVote = todayVotes(view).at(-1);
  if (!night && !isVoting(view) && lastVote) { if (view.phase !== 'tiespeak') parts.push(voteOutcome(lastVote)); }
  else if (!night && view.dawn?.day === view.day) parts.push(view.dawn.dead.length ? `昨夜 ${nums(view.dawn.dead)}死亡` : '昨夜平安夜');
  const p = view.phase;
  if (p === 'speak') {
    const done = (view.speeches || []).filter((x) => x.day === view.day && x.kind === 'speak').length;
    parts.push(`发言 ${Math.min(done + 1, view.alive.length)}/${view.alive.length}`);
  } else if (p === 'vote' || p === 'revote') {
    const total = (view.voters || []).length;
    parts.push(`${PHASE[p]} · 已投 ${total - (view.pending || []).length}/${total}`);
  } else if (p === 'tiespeak') parts.push(`${nums(view.tied || [])}平票 · 再各说一句`);
  else if (p === 'lastword') parts.push(view.speaker ? `${no(view.speaker)} 号留遗言` : '遗言');
  else if (p === 'hunter') parts.push((view.pending || [])[0] ? `猎人 ${no(view.pending[0])} 号决定是否开枪` : '猎人开枪');
  else parts.push(PHASE[p] || '');
  return parts.filter(Boolean).join(' · ');
}

// ---------- 中间舞台的各块 ----------

/** 白天公告条：昨夜结果（以及本视角能看到的昨夜行动）、今天的猎人开枪、出局名单 */
function newsBlock(view) {
  const items = [];
  if (view.dawn?.day === view.day) {
    items.push(el('span', {}, el('span', { class: 'label' }, '昨夜'),
      view.dawn.dead.length ? el('span', { class: 'hot' }, `${nums(view.dawn.dead)}死亡`) : el('span', {}, '平安夜')));
    const ln = view.lastNight && view.lastNight.day === view.day ? nightParts(view.lastNight) : [];
    if (ln.length) items.push(el('span', { class: 'muted' }, ln.join('　')));
  }
  for (const sh of view.shots || []) {
    if (sh.day !== view.day) continue;
    items.push(el('span', {}, el('span', { class: 'label' }, '猎人'), coin(sh.seat),
      sh.target ? el('span', { class: 'hot' }, `开枪带走 ${no(sh.target)} 号`) : el('span', {}, '没有开枪')));
  }
  const ds = view.deaths || [];
  if (ds.length) {
    items.push(el('span', {}, el('span', { class: 'label' }, '出局'),
      ds.map((d) => coin(d.seat, `第 ${d.day} ${d.time === 'night' ? '夜' : '天'}${d.cause ? ` · ${CAUSE[d.cause]}` : ''}`))));
  }
  return items.length ? el('div', { class: 'well ww-news' }, items) : null;
}

/** 本轮发言：今天说过的话按顺序列出（单行，全文在提示里），后面是还没轮到的人 */
function speechPanel(view) {
  const today = (view.speeches || []).filter((x) => x.day === view.day);
  const rows = today.map((sp) => act(`${no(sp.seat)} 号`, el('span', { class: 'line', title: sp.text }, sp.text),
    sp.kind === 'last' ? chip('遗言') : sp.kind === 'tie' ? chip('平票', 'warn') : null));
  const alive = new Set(view.alive || []);
  let todo = [];
  if (view.phase === 'speak') {
    const spoke = new Set(today.filter((x) => x.kind === 'speak').map((x) => x.seat));
    todo = view.seats.filter((s) => alive.has(s) && !spoke.has(s));
  } else if (view.phase === 'tiespeak') {
    const after = todayVotes(view).at(-1)?.after ?? 0;
    const spoke = new Set((view.speeches || []).slice(after).filter((x) => x.kind === 'tie').map((x) => x.seat));
    todo = (view.tied || []).filter((s) => !spoke.has(s));
  } else if (view.phase === 'lastword' && view.speaker) todo = [view.speaker];
  const kind = view.phase === 'lastword' ? '遗言' : view.phase === 'tiespeak' ? '平票' : '发言';
  const now = todo.includes(view.speaker) ? act(`${no(view.speaker)} 号`, el('span', { class: 'line' }, '发言中…'), chip(kind, 'gold'), 'now') : null;
  const rest = todo.filter((s) => s !== view.speaker);
  const wait = rest.length ? el('div', { class: 'act todo' }, el('b', {}, '待发言'), el('div', { class: 'voters' }, rest.map((s) => el('span', {}, String(no(s)))))) : null;
  return panel('本轮发言', rows.length ? el('div', { class: 'ww-list' }, rows) : now || wait ? null : el('div', { class: 'ww-empty' }, '还没有人发言'), now, wait);
}

/** 票型：每个被投的人一行（得票条 + 投票人的小铜钱），弃票单列一行 */
function tally(votes, { out = null, total = 0 } = {}) {
  const by = {};
  for (const [voter, t] of Object.entries(votes || {})) (by[t] ||= []).push(voter);
  const n = total || Object.keys(votes || {}).length || 1;
  const order = Object.keys(by).filter((t) => t !== 'none').sort((a, b) => by[b].length - by[a].length || no(a) - no(b));
  const top = order.length ? by[order[0]].length : 0;
  const row = (label, voters, cls, gold, target) => el('div', { class: `vrow${cls ? ` ${cls}` : ''}`, title: `${label} ${voters.length} 票` },
    el('span', {}, label),
    el('div', { class: 'vb' }, el('i', { class: gold ? 'g' : null, style: `width:${Math.round((voters.length / n) * 100)}%` })),
    el('div', { class: 'voters' }, voters.sort((a, b) => no(a) - no(b)).map((v) => el('span', { title: target ? `${no(v)} 号投 ${no(target)} 号` : `${no(v)} 号弃票` }, String(no(v))))));
  const rows = order.map((t) => row(`${no(t)} 号 · ${by[t].length}`, by[t], t === out ? 'out' : '', !(t === out || (!out && by[t].length === top)), t));
  if (by.none) rows.push(row(`弃票 · ${by.none.length}`, by.none, '', true, null));
  return rows;
}

/** 投票：今天每一次计票的票型和结果；投票进行中时上帝视角看实时票型，玩家只看到自己的票 */
function votePanel(view) {
  const kids = [];
  const entries = todayVotes(view);
  for (const v of entries) {
    if (entries.length > 1 || v.stage === 'revote') kids.push(el('div', { class: 'ww-sub' }, v.stage === 'revote' ? '平票重投' : '放逐投票'));
    kids.push(...tally(v.votes, { out: v.out }));
    kids.push(el('div', { class: `ww-res${v.out ? ' hot' : ''}` }, voteOutcome(v)));
  }
  if (isVoting(view)) {
    if (entries.length) kids.push(el('div', { class: 'ww-sub' }, PHASE[view.phase]));
    const votes = view.votes || {};
    const total = (view.voters || []).length;
    if (view.god) kids.push(...tally(votes, { total }));
    else if (view.viewer && votes[view.viewer]) {
      const t = votes[view.viewer];
      kids.push(act('你', el('span', {}, t === 'none' ? '弃票' : `投 ${no(t)} 号`)));
    }
    const pend = view.pending || [];
    if (pend.length) {
      kids.push(el('div', { class: 'vrow' }, el('span', { class: 'muted' }, `未投 · ${pend.length}`), el('div', { class: 'vb' }),
        el('div', { class: 'voters' }, pend.map((s) => el('span', {}, String(no(s)))))));
    }
    if (!view.god) kids.push(el('div', { class: 'ww-empty' }, '计票后公开票型'));
  }
  if (!kids.length) kids.push(el('div', { class: 'ww-empty' }, '发言结束后投票'));
  const sum = isVoting(view) ? `已投 ${(view.voters || []).length - (view.pending || []).length}/${(view.voters || []).length}` : entries.length ? voteOutcome(entries.at(-1)) : '';
  return withSum(panel('投票', el('div', { class: 'ww-list' }, kids)), sum);
}

/** 今夜行动：每个本视角能看到的角色一行（上帝视角全部；玩家只有自己的角色和狼队） */
function nightPanel(view) {
  const n = view.tonight || {};
  const alive = new Set(view.alive || []);
  const ident = view.identity || {};
  const seatsOf = (role) => view.seats.filter((s) => ident[s] === role);
  const pend = new Set(view.pending || []);
  const p = view.phase;
  const rows = [];
  const row = (role, body, tag) => rows.push(el('div', { class: 'act' }, roleChip(role), el('span', {}, ...[body].flat()), tag));

  // 狼人：狼队各自的提名和最终刀口（上帝视角、狼人本人）
  if (n.wolfVotes) {
    const wolves = seatsOf('wolf').filter((s) => alive.has(s));
    const noms = wolves.map((w) => {
      const t = n.wolfVotes[w];
      return `${no(w)} 号${t === undefined ? (pend.has(w) ? ' 提名中…' : ' 等待') : t === 'none' ? ' 空刀' : `→${no(t)} 号`}`;
    }).join('　');
    const resolved = p !== 'wolf' && 'kill' in n;
    row('狼人', noms, resolved ? chip(n.kill ? `刀 ${no(n.kill)} 号` : '空刀', n.kill ? 'red' : '') : chip(p === 'wolf' ? '行动中' : '等待', p === 'wolf' ? 'gold' : ''));
  }
  // 预言家
  const seer = seatsOf('seer')[0];
  if (seer && (view.god || seer === view.viewer)) {
    const dead = !alive.has(seer);
    const hist = (view.checks || []).filter((c) => !(c.day === view.day && n.check)).map((c) => `${c.day} 夜 ${no(c.target)} 号${c.wolf ? '狼' : '好'}`);
    const body = [`${no(seer)} 号${n.check ? ` · 查验 ${no(n.check)} 号` : ''}`, hist.length ? el('span', { class: 'sub' }, `此前：${hist.join('　')}`) : null];
    const tag = dead ? chip('已出局') : n.check ? chip(n.checkWolf ? '狼人' : '好人', n.checkWolf ? 'red' : 'good') : p === 'seer' ? chip('查验中', 'gold') : chip('等待');
    row('预言家', body, tag);
  }
  // 女巫：当晚刀口（轮到女巫时才知道）、药
  const witch = seatsOf('witch')[0];
  if (witch && (view.god || witch === view.viewer)) {
    const dead = !alive.has(witch);
    const kill = p !== 'wolf' && 'kill' in n && (view.god || n.witchSaw || p === 'witch') ? (n.kill ? ` · 今晚 ${no(n.kill)} 号被刀` : ' · 今晚空刀') : '';
    const pot = view.potions ? el('span', { class: 'sub' }, `解药${view.potions.save ? '在' : '已用'}　毒药${view.potions.poison ? '在' : '已用'}`) : null;
    row('女巫', [`${no(witch)} 号${kill}`, pot], dead ? chip('已出局') : p === 'witch' ? chip('用药中', 'gold') : chip('等待'));
  }
  // 猎人：存活与否、能不能开枪
  const hunter = seatsOf('hunter')[0];
  if (hunter && (view.god || hunter === view.viewer)) {
    const d = (view.deaths || []).find((x) => x.seat === hunter);
    const sh = (view.shots || []).find((x) => x.seat === hunter);
    const txt = !d ? '被刀或被放逐时可开枪' : sh ? (sh.target ? `开枪带走了 ${no(sh.target)} 号` : '没有开枪') : d.cause === 'poison' ? '被毒，不能开枪' : '';
    row('猎人', `${no(hunter)} 号${txt ? ` · ${txt}` : ''}`, chip(d ? '已出局' : '存活', d ? '' : 'good'));
  }
  const title = el('span', {}, '今夜行动');
  return panel(title, rows.length ? rows : el('div', { class: 'ww-empty' }, '天黑请闭眼'));
}

/** 出局记录：夜里死亡的死因玩家视角不公开（view 里 cause 为 null） */
function deathsPanel(view) {
  const ds = view.deaths || [];
  const rows = ds.map((d) => act(`第 ${d.day} ${d.time === 'night' ? '夜' : '天'}`, el('span', {}, `${no(d.seat)} 号${view.roles?.[d.seat] ? ` · ${view.roles[d.seat]}` : ''}`),
    chip(d.cause ? CAUSE[d.cause] : '死亡', d.cause === 'vote' || !d.cause ? '' : 'red')));
  return withSum(panel('出局', rows.length ? rows : el('div', { class: 'ww-empty' }, '还没有人出局')), ds.length ? `${ds.length} 人` : '无');
}

/** 终局：全部身份（终局时 view 是上帝视角） */
function rolesPanel(view) {
  const alive = new Set(view.alive || []);
  const by = {};
  for (const s of view.seats) { const r = view.roles?.[s]; if (r) (by[r] ||= []).push(s); }
  const rows = ['狼人', '预言家', '女巫', '猎人', '村民'].filter((r) => by[r]).map((r) => el('div', { class: 'act' }, roleChip(r),
    el('span', {}, by[r].map((s) => `${no(s)} 号${alive.has(s) ? '' : '（出局）'}`).join('、'))));
  return withSum(panel('身份', rows), by['狼人'] ? `狼人 ${by['狼人'].map(no).join('、')} 号` : '');
}

export default {
  /**
   * 场上公告（对局页在画面中央弹一张卡，停 2.6 秒）：天亮公布昨夜死讯 / 平安夜；白天有人被放逐、被猎人带走。
   * prev 是上一个画面，返回 null 表示这一步没有要公告的。
   */
  /** 回放时公告卡也要演完：多停 2.6 秒 */
  pauseAfter(prev, view) { return this.announce(prev, view) ? 2600 : 0; },

  announce(prev, view) {
    if (!prev || !view) return null;
    const no = (s) => `${String(s).replace(/^\D+/, '')} 号`;
    if (view.dawn && view.dawn.day !== prev.dawn?.day) {
      const dead = view.dawn.dead || [];
      return { kind: 'dawn', title: `第 ${view.dawn.day} 天 · 天亮了`, sub: dead.length ? `昨夜 ${dead.map(no).join('、')} 出局` : '昨夜平安夜，没有人出局' };
    }
    const before = new Set((prev.deaths || []).map((d) => d.seat));
    const fresh = (view.deaths || []).filter((d) => !before.has(d.seat) && d.time === 'day');
    if (fresh.length) {
      const why = { vote: '被投票放逐', shot: '被猎人带走' };
      return { kind: 'out', title: fresh.map((d) => no(d.seat)).join('、') + ' 出局', sub: fresh.map((d) => why[d.cause] || '出局').join('；') };
    }
    return null;
  },
  aspect: [16, 10],
  seatColor: (seat, index) => COLORS[(index ?? no(seat) - 1) % COLORS.length],

  /** 对称座位版式：场景条和每个座位卡的内容 */
  duoView(view, { movable = null, actions = null } = {}) {
    if (!view || !view.seats) return { scene: null, seats: {} };
    const night = isNight(view);
    const over = view.phase === 'over';
    const alive = new Set(view.alive || []);
    const pend = new Set(view.pending || []);
    const counts = seatCounts(view);
    // 玩家本人可选的目标：点座位卡就提交
    const picks = {};
    for (const a of movable && Array.isArray(actions) ? actions : []) {
      if (/^p\d$/.test(a.id)) picks[a.id] = { pick: a.id, pickTitle: `${PICK_VERB[view.phase] || '选'} ${no(a.id)} 号` };
      else if (/^poison:p\d$/.test(a.id)) { const t = a.id.slice(7); picks[t] = { pick: a.id, pickTitle: `用毒药毒 ${no(t)} 号` }; }
    }
    // 夜里正在行动的阵营亮着，其余闭眼
    const lit = new Set();
    if (night && !over) {
      for (const s of pend) lit.add(s);
      if (view.phase === 'wolf') for (const s of view.seats) if (view.identity?.[s] === 'wolf' && alive.has(s)) lit.add(s);
    }
    // 每个人的全部公开发言：对局页点座位后在焦点区按轮次列出
    const saidBy = {};
    for (const sp of view.speeches || []) (saidBy[sp.seat] ||= []).push({ tag: `第 ${sp.day} 天${sp.kind === 'last' ? ' · 遗言' : sp.kind === 'tie' ? ' · 平票' : ''}`, text: sp.text });
    const deathOf = Object.fromEntries((view.deaths || []).map((d) => [d.seat, d]));
    const seats = {};
    for (const s of view.seats) {
      const st = [];
      if (!over && (view.speaker === s || (pend.has(s) && !isVoting(view)))) st.push('speaking');
      if (!alive.has(s)) st.push('dead');
      if (night && !over) st.push(lit.has(s) ? 'lit' : 'dim');
      // 身份：view.roles 只含本视角能知道的（上帝视角全部；玩家自己和狼队友）；预言家本人另外标出查验结果
      let role = null;
      const r = view.roles?.[s];
      if (r) role = { text: r, color: ROLE_COLOR[r] || null };
      else if (!view.god) {
        const chk = (view.checks || []).findLast((c) => c.target === s);
        if (chk) role = chk.wolf ? { text: '查杀', color: ROLE_COLOR.狼人 } : { text: '金水', color: ROLE_COLOR.预言家 };
      }
      const d = deathOf[s];
      seats[s] = {
        note: d ? `第 ${d.day} ${d.time === 'night' ? '夜' : '天'}出局` : '',
        said: saidBy[s] || [],
        state: st.join(' '),
        role,
        word: null,
        votes: counts[s] || 0,
        pick: picks[s]?.pick || null,
        pickTitle: picks[s]?.pickTitle,
      };
    }
    const title = over ? `对局结束 · ${view.result?.team || ''}胜` : `第 ${view.day} 天 · ${night ? '夜晚' : '白天'}`;
    return { scene: { kind: night ? 'night' : 'day', title, sub: sceneSub(view) }, seats };
  },

  createStage({ onAction }) {
    injectStyle();
    const root = el('div', { class: 'ww-stage' });

    // 操作区：常驻节点，输入框不随每次重画丢失内容和焦点
    const ctrlHead = el('div', { class: 'head' });
    const input = el('input', { type: 'text', maxlength: 120, autocomplete: 'off' });
    const count = el('span', { class: 'n' });
    const send = el('button', { type: 'submit', class: 'btn primary sm' });
    const form = el('form', { class: 'ww-form' }, input, count, send);
    const btns = el('div', { class: 'btns' });
    const ctrl = el('div', { class: 'panel ww-ctrl' }, ctrlHead, form, btns);
    ctrl.hidden = true;
    const body = el('div', { class: 'ww-body' });
    root.append(ctrl, body);

    let ctx = { maxLen: 60, textKey: null };
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

    return {
      el: root,
      render(view, { movable = null, actions = null } = {}) {
        if (!view || !view.seats) return;
        const night = isNight(view);
        root.classList.toggle('night', night);
        const phase = view.phase;
        const acts = movable && Array.isArray(actions) ? actions : [];
        const freeText = !!movable && actions === null && ['speak', 'tiespeak', 'lastword'].includes(phase) && view.speaker === movable;

        // ---------- 操作区 ----------
        ctrlHead.replaceChildren();
        btns.replaceChildren();
        if (movable && (freeText || acts.length)) {
          ctrlHead.append(el('span', { class: 'label' }, '你的行动'), el('b', {}, PHASE[phase] || ''));
          if (view.myRole) ctrlHead.append(el('span', { class: 'muted' }, '你是'), roleChip(view.myRole));
          if (view.mates?.length) ctrlHead.append(el('span', { class: 'muted' }, `队友 ${nums(view.mates)}`));
          if (phase === 'witch') {
            const k = view.tonight?.kill;
            if (view.tonight && 'kill' in view.tonight) ctrlHead.append(el('span', { class: 'hint' }, k ? `今晚 ${no(k)} 号被刀` : '今晚狼人空刀'));
            const save = acts.find((a) => a.id === 'save');
            if (save) btns.append(el('button', { type: 'button', class: 'btn primary sm', onclick: () => onAction('save') }, save.label));
            if (acts.some((a) => a.id.startsWith('poison:'))) ctrlHead.append(el('span', { class: 'hint' }, '点座位卡下毒'));
            btns.append(el('button', { type: 'button', class: 'btn sm', onclick: () => onAction('none') }, '不用药'));
          } else if (acts.length) {
            if (acts.some((a) => /^p\d$/.test(a.id)) && HINT[phase]) ctrlHead.append(el('span', { class: 'hint' }, HINT[phase]));
            if (acts.some((a) => a.id === 'none')) btns.append(el('button', { type: 'button', class: 'btn sm', onclick: () => onAction('none') }, NONE_LABEL[phase] || '跳过'));
          }
        }
        const key = freeText ? `${view.day}-${phase}-${(view.speeches || []).length}` : null;
        if (key && key !== ctx.textKey) input.value = '';
        ctx = { maxLen: view.maxLen || 60, textKey: key };
        form.hidden = !freeText;
        if (freeText) {
          input.placeholder = phase === 'lastword' ? '留下遗言' : '说一句话';
          send.textContent = phase === 'lastword' ? '留遗言' : '发言';
          refreshCount();
        }
        ctrl.hidden = !ctrlHead.childElementCount && !freeText;
        if (freeText && document.activeElement !== input) input.focus({ preventScroll: true });

        // ---------- 舞台 ----------
        const parts = [];
        if (view.phase === 'over') parts.push(newsBlock(view), el('div', { class: 'panels' }, rolesPanel(view), todayVotes(view).length ? votePanel(view) : deathsPanel(view)));
        else if (night) parts.push(el('div', { class: 'panels' }, nightPanel(view), deathsPanel(view)));
        // 白天：发言改到对局页焦点区按人看，这里只留公告和票型
        else parts.push(newsBlock(view), todayVotes(view).length || isVoting(view) ? votePanel(view) : null);
        body.replaceChildren(...parts.filter(Boolean));
        for (const l of body.querySelectorAll('.ww-list')) l.scrollTop = l.scrollHeight; // 最新的在下面
      },
    };
  },

  /** 着法列表：和对局记录一一对应；玩家视角里别人的夜间行动打码 */
  moveList(view) {
    const speech = (t) => ([...t].length > 8 ? `「${[...t].slice(0, 8).join('')}…」` : `「${t}」`);
    const out = [];
    for (const e of view?.log || []) {
      // 玩家视角：连续的「夜间行动」合并成一条，否则条数会暴露预言家、女巫是否还活着
      if (e.kind === 'hidden' && out.at(-1)?.hidden) continue;
      out.push({ seat: e.seat, label: ['speak', 'tiespeak', 'lastword'].includes(e.kind) ? speech(e.label) : e.label, hidden: e.kind === 'hidden' });
    }
    return out;
  },
};
