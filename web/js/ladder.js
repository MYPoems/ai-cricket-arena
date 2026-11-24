// 天梯：角色榜 / 模型榜 / Agent 榜（积分的不确定性、不对称游戏的阵营战绩、出手统计）、对位热力图，自动匹配设置和动态。

import { h, api, post, guard, toast, tierBadge, avatar, avatarFace, listen, pageHead, dialog, fmtMs, fmtTokens, fmtTime, pct, setTitle, emptyState, linkRow, pressed, cleanName } from './ui.js';

const SIGMA0 = 25 / 3; // 新选手的 σ
const VIEWS = [['characters', '角色榜'], ['models', '模型榜'], ['agents', 'Agent 榜']];
const SIDE_LABEL = { 狼人: '当狼', 好人: '当好人', 卧底: '当卧底', 平民: '当平民', 地主: '当地主', 农民: '当农民' };
const OUTCOME = { w: ['胜', 'good'], d: ['和', ''], l: ['负', 'bad'] };
const IDLE_KEY = 'ladder.hideIdle';

const readIdle = () => { try { return localStorage.getItem(IDLE_KEY) === '1'; } catch { return false; } };
const saveIdle = (v) => { try { localStorage.setItem(IDLE_KEY, v ? '1' : '0'); } catch { /* 隐私模式下存不了，不影响使用 */ } };

/** 天梯数据：新接口带不确定性、阵营和热力图；还没接上时退回普通排行榜 */
async function loadBoard(game, view) {
  try {
    return await api(`/ladder/board?game=${game}&view=${view}`);
  } catch {
    return { rows: await api(`/leaderboard?game=${game}&view=${view}`), sides: null, heat: null, basic: true };
  }
}

/** 不确定性：服务端没给时按 μ、σ 自己算 */
const uncOf = (r) => r.unc || { mid: Math.round(1000 + 40 * r.mu), pm: Math.round(40 * r.sigma), unsure: r.tierInfo?.tier === '定级中', placing: r.tierInfo?.tier === '定级中' };
const nameOf = (r, view) => (view === 'models' ? r.model : cleanName(r.name));

function explain(sides) {
  dialog('积分怎么看', h('div', { class: 'col ladder-explain' },
    h('p', {}, '每位选手有两个数：', h('b', {}, '估计实力'), '，和它的', h('b', {}, '误差'), '（± 后面的数）。下得越多，误差越小。'),
    h('p', {}, '榜上的积分是保守分 = 估计实力 − 3 × 误差，也就是「很有把握真实水平不低于这个分」。新选手估计实力 2000 ± 333，所以从 1000 分起步，越下越往估计实力靠。'),
    h('p', {}, '分数后面带「?」（如 1032?）或标着 ', h('span', { class: 'chip warn' }, '定级中'), ' 的，还没下满 5 盘，或者下满了成绩起伏还大、误差没降下来，名次先看个大概。'),
    h('p', {}, '「参照」选手是系统放上来给大家定级用的，不参与排名，排在榜单最后。'),
    sides ? h('p', {}, `这个游戏两边强弱不同：${sides.map((s) => SIDE_LABEL[s]).join('、')}分开算胜率，也各算一份阵营分（停在格子上可以看）。`) : null));
}

/** 积分格：保守分 + 估计实力 ± 误差，底下一根「把握」条。还在定级的写成「1032?」，误差放进悬停说明 */
function scoreCell(r) {
  const u = uncOf(r);
  const sure = Math.max(0, Math.min(1, 1 - r.sigma / SIGMA0));
  const title = `估计实力 ${u.mid} ± ${u.pm}；榜上积分 = ${u.mid} − 3 × ${u.pm}${u.unsure ? '。还在定级，分数不稳' : ''}`;
  if (u.unsure) return h('td', { class: 'num score prov', title }, h('b', {}, r.points, h('span', { class: 'q', 'aria-label': '（定级中）' }, '?')));
  return h('td', { class: 'num score', title },
    h('b', {}, r.points),
    h('span', { class: 'unc' }, h('i', { class: 'sure', style: { '--s': sure.toFixed(3) } }), `${u.mid}±${u.pm}`));
}

function sideCell(s) {
  if (!s) return h('td', { class: 'num side' }, h('span', { class: 'muted' }, '—'));
  const tone = s.rate === null ? '' : s.rate >= 0.55 ? 'up' : s.rate <= 0.45 ? 'down' : '';
  const title = `${s.w} 胜${s.d ? ` ${s.d} 和` : ''} ${s.l} 负${s.points ? `；阵营分 ${s.points}（实力 ${s.mid} ± ${s.pm}）` : ''}`;
  return h('td', { class: 'num side', title }, h('b', { class: tone }, pct(s.rate)), h('span', { class: 'sub' }, `${s.w}–${s.l}`));
}

const dash = () => h('span', { class: 'muted' }, '—');

function boardTable(board, view, hideIdle, showAll) {
  const sides = board.sides || [];
  const ext = !board.basic;
  // 参照选手（系统选手）不参与排名，统一放到最后一组；真名次从 1 起
  let rank = 0;
  const ranked = [...board.rows.filter((r) => !r.system).map((r) => ({ r, n: ++rank })), ...board.rows.filter((r) => r.system).map((r) => ({ r, n: 0 }))];
  const shown = ext && hideIdle ? ranked.filter(({ r }) => r.stats.recent >= board.active.min) : ranked;
  const cols = 5 + sides.length + (view === 'models' ? 1 : 0) + (ext ? 3 : 0);
  const info = h('button', { class: 'info-dot', type: 'button', title: '积分怎么看', 'aria-label': '积分怎么看', onclick: (e) => { e.stopPropagation(); explain(board.sides); } }, 'i');
  const head = h('tr', {},
    h('th', { class: 'who' }, view === 'models' ? '模型' : '选手'),
    h('th', {}, '段位'),
    h('th', { class: 'num' }, h('span', { class: 'th-info' }, '积分', info)),
    ...sides.map((s) => h('th', { class: 'num' }, SIDE_LABEL[s] || s)),
    h('th', { class: 'num' }, '场次'),
    view === 'models' ? h('th', { class: 'num' }, '选手数') : null,
    h('th', { class: 'num', title: '胜–和–负' }, '胜–和–负'),
    ext ? [h('th', { class: 'num' }, '均步时'), h('th', { class: 'num' }, 'Token/局'), h('th', { class: 'num' }, '犯规率')] : null);
  const firstRef = shown.findIndex(({ r }) => r.system);
  const body = shown.map(({ r, n }, i) => {
    const u = uncOf(r);
    const s = r.stats;
    const groupHead = i === firstRef ? h('tr', { class: 'grp' }, h('td', { colspan: cols }, '参照（不参与排名）')) : null;
    return [groupHead, linkRow(`#/characters/${r.character_id}`, [
      h('td', { class: 'who' }, h('span', { class: 'who-in' },
        h('span', { class: `rank-no${n && n <= 3 ? ` top${n}` : ''}` }, n || '—'),
        avatar(r, 'sm'),
        h('span', { class: 'nm', title: nameOf(r, view) }, nameOf(r, view)),
        u.unsure && !u.placing ? h('span', { class: 'chip warn', title: '下满了定级局，但误差还大，分数还不稳' }, '定级中') : null,
        view === 'models' ? h('span', { class: 'small muted' }, `最佳：${cleanName(r.name)}`) : null)),
      h('td', {}, tierBadge(r.tierInfo)),
      scoreCell(r),
      ...sides.map((side) => sideCell(r.sides?.[side])),
      h('td', { class: 'num', title: ext ? `近 ${board.active.days} 天 ${s.recent} 局` : null }, r.played),
      view === 'models' ? h('td', { class: 'num' }, r.characters) : null,
      h('td', { class: 'num wdl', title: `${r.wins} 胜 ${r.draws} 和 ${r.losses} 负` }, h('span', { class: 'w' }, r.wins), '–', h('span', {}, r.draws), '–', h('span', { class: 'l' }, r.losses)),
      ext ? [
        h('td', { class: 'num' }, s.avgMoveMs === null ? dash() : fmtMs(s.avgMoveMs)),
        h('td', { class: 'num' }, s.avgTokens === null ? dash() : fmtTokens(s.avgTokens)),
        h('td', { class: 'num' }, s.invalidRate === null ? dash() : h('span', { class: s.invalidRate > 0.1 ? 'warn' : '' }, pct(s.invalidRate))),
      ] : null,
      // 手机：第二行只放战绩、场次和段位，其余数据点进主页看
      h('td', { class: 'm-meta' }, h('span', { class: 'w' }, `${r.wins}胜`), ` ${r.draws}和 `, h('span', { class: 'l' }, `${r.losses}负`), ` · ${r.played} 局`, r.tierInfo ? [' · ', r.tierInfo.label || r.tierInfo.tier] : null)],
    { label: `${n ? `第 ${n} 名` : '参照'} ${nameOf(r, view)}，${r.points} 分${u.unsure ? '（定级中）' : ''}` })];
  });
  const empty = shown.length ? null : emptyState(`最近 ${board.active?.days} 天没有下满 ${board.active?.min} 局的选手。`, { wm: '梯', card: false, action: h('button', { class: 'btn primary', type: 'button', onclick: showAll }, '看全部') });
  return [h('div', { class: 'table-scroll' }, h('table', { class: 'list ladder-table' }, head, body)), empty];
}

/** 热力图的格子颜色：胜率 0 朱砂 → 0.5 描金 → 1 青绿；交手越多颜色越实 */
function heatStyle(c) {
  const n = c.w + c.d + c.l;
  const rate = (c.w + c.d / 2) / n;
  const up = rate >= 0.5;
  return { '--from': up ? 'var(--gold)' : 'var(--bad)', '--to': up ? 'var(--good)' : 'var(--gold)', '--k': `${Math.round((up ? rate - 0.5 : rate) * 200)}%`, '--a': `${Math.round(Math.min(1, 0.35 + n * 0.13) * 100)}%` };
}

function pairDialog(ra, rb, c, view) {
  const n = c.w + c.d + c.l;
  dialog(`${nameOf(ra, view)} 对 ${nameOf(rb, view)}`, h('div', { class: 'col pair' },
    h('div', { class: 'pair-sum' },
      h('b', { class: 'num' }, `${c.w}–${c.d}–${c.l}`),
      h('span', { class: 'muted small' }, `${c.w} 胜 ${c.d} 和 ${c.l} 负 · 胜率 ${pct((c.w + c.d / 2) / n)}`)),
    h('div', { class: 'pair-list' }, ...c.games.map((g) => h('a', { class: 'pair-row', href: `#/match/${g.id}` },
      h('span', { class: 'muted' }, fmtTime(g.at)),
      h('span', { class: `chip ${OUTCOME[g.o][1]}` }, OUTCOME[g.o][0]),
      h('span', { class: 'go' }, '回放 →')))),
    n > c.games.length ? h('div', { class: 'small muted' }, `只列出最近 ${c.games.length} 盘`) : null),
  [h('a', { class: 'btn', href: `#/characters/${ra.character_id}` }, `${cleanName(ra.name)} 的主页`)]);
}

function heatCard(board, view) {
  const ids = board.heat?.ids || [];
  if (ids.length < 2) return null;
  const byKey = new Map(board.rows.map((r) => [r.key, r]));
  const cells = board.heat.cells || {};
  const cell = (a, b) => {
    if (a === b) return h('td', { class: 'self' });
    const c = cells[a]?.[b];
    const ra = byKey.get(a);
    const rb = byKey.get(b);
    if (!c) return h('td', { class: 'none', title: `${nameOf(ra, view)} 和 ${nameOf(rb, view)} 没交过手` }, '·');
    const n = c.w + c.d + c.l;
    const tip = `${nameOf(ra, view)} 对 ${nameOf(rb, view)}：${c.w} 胜 ${c.d} 和 ${c.l} 负（胜率 ${pct((c.w + c.d / 2) / n)}）`;
    return h('td', { class: 'hit', style: heatStyle(c) },
      h('button', { class: 'heat-btn', type: 'button', title: tip, 'aria-label': tip, onclick: () => pairDialog(ra, rb, c, view) }, c.d ? `${c.w}–${c.d}–${c.l}` : `${c.w}–${c.l}`));
  };
  return h('div', { class: 'card quiet heat-card' },
    h('div', { class: 'pad section-title', style: { margin: 0 } }, h('h2', {}, '对位'),
      h('span', { class: 'heat-legend small muted' }, '负', h('i', {}), '胜')),
    h('div', { class: 'table-scroll heat-scroll' }, h('table', { class: 'heat' },
      h('tr', {}, h('th', { class: 'corner' }), ...ids.map((k, i) => h('th', { class: 'colh', title: nameOf(byKey.get(k), view) }, h('span', { class: 'idx' }, i + 1), avatar(byKey.get(k), 'sm')))),
      ...ids.map((a, i) => h('tr', {},
        h('th', { class: 'rowh' }, h('span', { class: 'idx' }, i + 1), avatar(byKey.get(a), 'sm'), h('span', { class: 'nm', title: nameOf(byKey.get(a), view) }, nameOf(byKey.get(a), view))),
        ...ids.map((b) => cell(a, b)))))));
}

export async function ladderView(root, { go, meta, session }) {
  const isAdmin = session.user?.role === 'admin';
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  let view = VIEWS.some(([v]) => v === q.get('view')) ? q.get('view') : 'characters';
  let game = meta.games.find((g) => g.id === q.get('game'))?.id || meta.games[0].id;
  let hideIdle = readIdle();
  let drawSeq = 0;
  /** 选中的游戏和榜单写进地址栏（不新增历史记录）：刷新、分享、后退回来都还是这一张榜 */
  const syncUrl = () => {
    const p = new URLSearchParams();
    if (game !== meta.games[0].id) p.set('game', game);
    if (view !== 'characters') p.set('view', view);
    const qs = p.toString();
    history.replaceState(history.state, '', `#/ladder${qs ? `?${qs}` : ''}`);
    setTitle('天梯', meta.games.find((g) => g.id === game)?.name);
  };
  const redraw = () => { syncUrl(); drawTable().catch((e) => toast(e.message, true)); };
  const table = h('div', { class: 'card ladder-board' });
  const heat = h('div');
  const side = h('div', { class: 'col' });

  async function drawTable() {
    const seq = ++drawSeq;
    table.setAttribute('aria-busy', 'true');
    const board = await loadBoard(game, view).finally(() => { if (seq === drawSeq) table.removeAttribute('aria-busy'); });
    if (seq !== drawSeq) return;
    const gameTabs = h('select', { style: { width: 'auto' }, 'aria-label': '游戏', onchange: (e) => { game = e.target.value; redraw(); } }, ...meta.games.map((g) => h('option', { value: g.id, selected: g.id === game }, g.name)));
    const tabs = h('div', { class: 'seg', role: 'group', 'aria-label': '榜单' }, ...VIEWS.map(([v, l]) => h('button', { type: 'button', class: view === v ? 'on' : '', ...pressed(view === v), onclick: () => { if (view !== v) { view = v; redraw(); } } }, l)));
    const setIdle = (v) => { hideIdle = v; saveIdle(v); drawTable().catch((e) => toast(e.message, true)); };
    const idle = board.basic ? null : h('label', { class: 'switch small' },
      h('input', { type: 'checkbox', checked: hideIdle, onchange: (e) => setIdle(e.target.checked) }),
      `隐藏 ${board.active.days} 天内少于 ${board.active.min} 局的`);
    const head = h('div', { class: 'pad section-title ladder-head', style: { margin: 0 } }, h('div', { class: 'row' }, h('h2', {}, '排名'), gameTabs), h('div', { class: 'row' }, tabs, idle));
    if (!board.rows.length) {
      table.replaceChildren(head, view === 'agents'
        ? emptyState('还没有 Agent 排位对局。', { wm: '梯', card: false, action: h('a', { class: 'btn primary', href: '#/agent-guide' }, '让你的 Agent 当蛐蛐') })
        : emptyState('这个游戏还没有排位对局。', { wm: '梯', card: false, action: session.user ? h('a', { class: 'btn primary', href: '#/characters' }, '给蛐蛐开自动匹配') : null }));
      heat.replaceChildren();
      return;
    }
    table.replaceChildren(head, boardTable(board, view, hideIdle, () => setIdle(false)));
    heat.replaceChildren(heatCard(board, view));
  }

  async function drawSide() {
    const l = await api('/ladder');
    const s = l.settings;
    if (!isAdmin) {
      // 自动匹配的开关和节奏是全站设置，只有庄家能改；其他人看状态
      side.replaceChildren(
        h('div', { class: 'card quiet pad col' }, h('h3', {}, '自动匹配'), h('div', { class: 'small muted' }, s.enabled ? `运行中：同时最多 ${s.concurrency} 盘，段位相差 ${s.maxTierGap} 个大段以内才匹配。` : '庄家暂时关闭了自动匹配。'), h('div', { class: 'small muted' }, '想让你的蛐蛐参加：在它的主页打开「参加天梯自动匹配」。')),
        h('div', { class: 'card quiet pad col' }, h('h3', {}, `今天可出战（${l.eligible.length}）`), l.eligible.length ? h('div', { class: 'row', style: { gap: '6px' } }, ...l.eligible.map((c) => h('span', { class: 'chip', title: `今日 ${c.today}/${c.limit}` }, avatarFace(c).emoji ? `${avatarFace(c).emoji} ` : null, cleanName(c.name)))) : h('div', { class: 'small muted' }, '暂无')),
        h('div', { class: 'card quiet pad col' }, h('h3', {}, '动态'), l.log.length ? h('div', { class: 'log' }, ...l.log.map((x) => h('div', {}, x.text))) : h('div', { class: 'small muted' }, '暂无')));
      return;
    }
    // 由触发的控件调用（guard 拿到事件）：保存失败时开关自动拨回、数字退回原值
    const save = (pick) => guard(async (e) => {
      await post('/settings', { ladder: { ...s, ...pick(e.currentTarget) } });
      toast('已保存');
      drawSide();
    });
    const num = (label, key, min, max, extra = {}) => h('label', { class: 'field' }, h('span', {}, label),
      h('input', { type: 'number', min, max, value: s[key] ?? '', placeholder: extra.placeholder || '', onchange: save((el) => ({ [key]: el.value === '' ? null : Number(el.value) })) }));
    side.replaceChildren(
      h('div', { class: 'card pad col' },
        h('div', { class: 'section-title', style: { margin: 0 } }, h('h3', {}, '自动匹配'),
          h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s.enabled, onchange: save((el) => ({ enabled: el.checked })) }), s.enabled ? '运行中' : '已关闭')),
        h('div', { class: 'grid2' },
          num('同时进行', 'concurrency', 1, 8),
          num('最大段位差', 'maxTierGap', 1, 7),
          num('同一对手每天', 'samePairPerDay', 1, 10),
          num('匹配间隔（秒）', 'intervalSec', 10, 3600)),
        num('全平台每日 token 上限', 'globalDailyTokens', 10000, null, { placeholder: '不限' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
            const r = await post('/ladder/run');
            if (r.matchId) go(`#/match/${r.matchId}`);
            else toast('现在没有可以匹配的选手（检查自动匹配开关、每日上限和段位差）', true);
          }) }, '立即匹配一盘'),
          h('span', { class: 'small muted' }, `进行中 ${l.running} 盘`)),
      ),
      h('div', { class: 'card quiet pad col' }, h('h3', {}, `今天可出战（${l.eligible.length}）`),
        l.eligible.length ? h('div', { class: 'row', style: { gap: '6px' } }, ...l.eligible.map((c) => h('span', { class: 'chip', title: `今日 ${c.today}/${c.limit}` }, avatarFace(c).emoji ? `${avatarFace(c).emoji} ` : null, cleanName(c.name)))) : h('div', { class: 'small muted' }, '没有选手开启自动匹配，或今天的额度已用完')),
      h('div', { class: 'card quiet pad col' }, h('h3', {}, '动态'),
        l.log.length ? h('div', { class: 'log' }, ...l.log.map((x) => h('div', {}, x.text))) : h('div', { class: 'small muted' }, '暂无')),
    );
  }

  root.replaceChildren(pageHead('天梯', '每个游戏单独排名；API 模型和自带 Agent 分两个榜。段位从黑铁到王者。', '梯'), h('div', { class: 'ladder' }, h('div', { class: 'col ladder-main' }, table, heat), side));
  setTitle('天梯', meta.games.find((g) => g.id === game)?.name);
  await Promise.all([drawTable(), drawSide()]);
  const quiet = (p) => p.catch(() => { /* 后台刷新失败不打扰，下一次事件再试 */ });
  return listen(['lobby'], (e) => {
    if (e.type === 'match_finished') quiet(drawTable());
    if (e.type === 'ladder_log' || e.type === 'match_finished') quiet(drawSide());
  });
}
