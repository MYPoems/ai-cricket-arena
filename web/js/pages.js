// 对局记录（含同题对比、录像）、设置。

import { h, api, post, guard, toast, fmtTime, MODE_NAMES, resultText, pageHead, setTitle, emptyState, linkRow, confirmDialog, icon } from './ui.js';

const REC_STATUS = { queued: '排队中', running: '录制中', done: '已完成', failed: '失败' };
const ORIGIN = { auto: '天梯匹配', room: '组局', manual: '手动开局' };

export async function historyView(root, { session }) {
  const TABS = [['all', '全部对局'], ...(session.user ? [['mine', '我的对局']] : []), ['compare', '同题对比'], ['video', '录像']];
  let tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'all';
  if (!TABS.some(([k]) => k === tab)) tab = 'all';
  const body = h('div', { role: 'tabpanel' });
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '对局记录分类' });
  let drawSeq = 0;

  /** 换分类：写进地址栏（不新增历史记录），刷新、分享链接都还在这一栏 */
  function pick(k) {
    if (k === tab) return;
    tab = k;
    history.replaceState(history.state, '', k === 'all' ? '#/history' : `#/history?tab=${k}`);
    draw().catch((e) => toast(e.message, true));
  }

  async function draw() {
    const seq = ++drawSeq;
    tabs.replaceChildren(...TABS.map(([k, l]) => h('button', { type: 'button', role: 'tab', class: tab === k ? 'on' : '', 'aria-selected': tab === k ? 'true' : 'false', tabindex: tab === k ? '0' : '-1', onclick: () => pick(k) }, l)));
    setTitle('对局记录', tab === 'all' ? '' : TABS.find(([k]) => k === tab)?.[1]);
    body.setAttribute('aria-busy', 'true');
    try {
      if (tab === 'compare') await drawCompare(seq);
      else if (tab === 'video') await drawVideo(seq);
      else await drawMatches(seq);
    } finally { if (seq === drawSeq) body.removeAttribute('aria-busy'); }
  }
  // 方向键在分类之间移动（标签页的键盘习惯）
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex(([k]) => k === tab);
    const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
    pick(n);
    tabs.querySelector('[aria-selected="true"]')?.focus();
  });

  async function drawMatches(seq) {
    const list = await api(`/matches?limit=200${tab === 'mine' ? '&mine=1' : ''}`);
    if (seq !== drawSeq) return;
    body.replaceChildren(list.length ? h('div', { class: 'card table-wrap' },
      h('table', { class: 'list cardify hist-table' },
        h('tr', {}, h('th', {}, '时间'), h('th', {}, '游戏'), h('th', {}, '蛐蛐'), h('th', {}, '来源'), h('th', {}, '模式'), h('th', { class: 'num' }, '步数'), h('th', {}, '结果')),
        ...list.map((m) => {
          const names = Object.values(m.players).map((pl) => pl?.name);
          return linkRow(`#/match/${m.id}`, [
            h('td', { class: 'c-time muted' }, fmtTime(m.created_at)),
            h('td', { class: 'c-game' }, h('span', { class: 'chip' }, m.gameName)),
            h('td', { class: 'c-players' }, names.join(' · ')),
            h('td', { class: 'c-origin muted' }, ORIGIN[m.origin] || '—'),
            h('td', { class: 'c-mode' }, MODE_NAMES[m.mode]),
            h('td', { class: 'c-plies num' }, m.plies),
            h('td', { class: 'c-result' }, m.status === 'running' ? h('span', { class: 'chip good' }, '进行中') : resultText(m))],
          { label: `${fmtTime(m.created_at)} ${m.gameName}：${names.join(names.length === 2 ? ' 对 ' : '、')}，${m.status === 'running' ? '进行中' : resultText(m)}` });
        })))
      : tab === 'mine'
        ? emptyState('你还没有下过对局。', { wm: '局', action: h('a', { class: 'btn primary', href: '#/rooms' }, '去组局') })
        : emptyState('还没有对局。', { wm: '局', action: session.user ? h('a', { class: 'btn primary', href: '#/new' }, '开一局') : null }));
  }

  async function drawCompare(seq) {
    const past = await api('/compares');
    if (seq !== drawSeq) return;
    body.replaceChildren(h('div', { class: 'col' },
      h('div', { class: 'card quiet pad row', style: { justifyContent: 'space-between' } },
        h('div', {}, h('h3', {}, '同题对比'), h('div', { class: 'small muted' }, '同一个象棋局面同时交给几只蛐蛐，并排看各自怎么想、怎么走。')),
        session.user && past.length ? h('a', { class: 'btn primary', href: '#/compare' }, '新建同题对比') : null),
      past.length ? h('div', { class: 'card table-wrap' }, h('table', { class: 'list' },
        h('tr', {}, h('th', {}, '时间'), h('th', {}, '题目')),
        ...past.map((c) => linkRow(`#/compare/${c.id}`, [h('td', { class: 'muted' }, fmtTime(c.created_at)), h('td', {}, c.title)], { label: `${c.title}（${fmtTime(c.created_at)}）` }))))
        : emptyState('还没有同题对比。', { wm: '比', action: session.user ? h('a', { class: 'btn primary', href: '#/compare' }, '新建同题对比') : null })));
  }

  async function drawVideo(seq) {
    const rec = await api('/recordings');
    if (seq !== drawSeq) return;
    body.replaceChildren(rec.list.length ? h('div', { class: 'card table-wrap' }, h('table', { class: 'list' },
      h('tr', {}, h('th', {}, '时间'), h('th', {}, '对局'), h('th', { class: 'num' }, '倍速'), h('th', {}, '状态'), h('th', {}, '')),
      ...rec.list.map((r) => h('tr', {},
        h('td', { class: 'muted' }, fmtTime(r.created_at)),
        h('td', {}, h('a', { href: `#/match/${r.match_id}` }, r.game ? `${r.game} · ${r.match_id}` : r.match_id)),
        h('td', { class: 'num' }, `${r.speed}×`),
        h('td', { title: r.error || '' }, REC_STATUS[r.status] || r.status, r.error ? h('span', { class: 'small muted' }, `：${r.error}`) : null),
        h('td', {}, r.status === 'done' ? h('a', { class: 'btn sm', href: `/api/recordings/${r.id}/file`, download: '' }, icon('download', 16), '下载 MP4') : null)))))
      : emptyState(rec.status.chrome ? '还没有录像。在结束的对局页点「录成视频」。' : '服务器上没有可用的浏览器，无法录制。', { wm: '影', action: rec.status.chrome ? h('button', { class: 'btn primary', type: 'button', onclick: () => pick('all') }, '去挑一盘') : null }));
  }

  root.replaceChildren(pageHead('对局记录', '每一盘都能回放、录成视频；同题对比也在这里。', '局'), tabs, body);
  await draw();
}

export async function settingsView(root, { meta, reloadMeta, session, go }) {
  await reloadMeta();
  const m = meta;
  const isAdmin = session.user?.role === 'admin';
  const keyRows = m.presets.filter((p) => p.needsKey).map((p) => {
    const st = m.keys[p.id];
    const input = h('input', { type: 'password', autocomplete: 'off', 'aria-label': `${p.name} API Key`, placeholder: st === 'db' ? '已保存（输入新值可替换）' : st === 'env' ? '已从环境变量读取' : '粘贴 API Key' });
    return h('tr', {},
      h('td', { class: 'c-name' }, h('b', {}, p.name)),
      h('td', { class: 'c-state' }, st === 'db' ? h('span', { class: 'chip good' }, '已配置') : st === 'env' ? h('span', { class: 'chip good' }, '环境变量') : h('span', { class: 'chip' }, '未配置')),
      h('td', { class: 'c-input', style: { width: '50%' } }, input),
      h('td', { class: 'c-act' }, h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
        h('button', { class: 'btn sm', type: 'button', onclick: guard(async () => {
          if (!input.value.trim()) return;
          await post('/keys', { provider: p.id, key: input.value.trim() });
          toast(`${p.name} 密钥已加密保存`);
          settingsView(root, { meta, reloadMeta, session, go });
        }) }, '保存'),
        st === 'db' ? h('button', { class: 'btn sm ghost', type: 'button', onclick: guard(async () => {
          if (!await confirmDialog({ title: '删除密钥', body: `删除 ${p.name} 的密钥？用这个平台的蛐蛐之后会连不上，直到你重新填一个。`, okText: '删除', danger: true })) return;
          await post('/keys', { provider: p.id, key: '' });
          settingsView(root, { meta, reloadMeta, session, go });
        }) }, '删除') : null)),
    );
  });

  const ev = m.evaluator;
  const engines = ev.engines || {};
  root.replaceChildren(pageHead('设置', isAdmin ? '你的密钥，以及只有庄家能改的全局设置。' : '你的模型平台密钥。蛐蛐对局时用的是它主人的密钥。', '设'),
    h('div', { class: 'col', style: { maxWidth: '960px' } },
      h('div', { class: 'card framed col' },
        h('div', {}, h('h2', {}, '我的 API 密钥'), h('div', { class: 'small muted' }, '密钥加密保存在服务器数据库里，只用于你自己的蛐蛐，不会发到浏览器，也不会给别人用。')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list cardify keys-table' }, ...keyRows))),
      h('div', { class: 'card quiet pad row', style: { justifyContent: 'space-between' } },
        h('div', {}, h('h3', {}, '我的账号'), h('div', { class: 'small muted' }, `${session.user.name}（${session.user.username}）${isAdmin ? ' · 庄家' : ''}`)),
        h('a', { class: 'btn', href: '#/account' }, '修改密码、退出登录')),
      isAdmin ? h('div', { class: 'card framed col' }, h('h2', {}, '庄家设置'),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: m.publicView, onchange: guard(async (e) => { await post('/settings', { publicView: e.target.checked }); toast(e.target.checked ? '游客可以观战了' : '游客需要登录才能观战'); }) }), '开放观战：没登录的游客也能看大厅和对局（只读）'),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: m.allowLocalRanked, onchange: guard(async (e) => { await post('/settings', { allowLocalRanked: e.target.checked }); toast('已保存'); }) }), '允许本地 Ollama 模型参加排位'),
        h('div', { class: 'row' },
          ...[['pikafish', '象棋 Pikafish'], ['rapfi', '五子棋 Rapfi'], ['stockfish', '国际象棋 Stockfish']].map(([k, l]) => h('span', { class: `chip ${engines[k] ? 'good' : 'warn'}` }, `${l}${engines[k] ? ' 已就绪' : ' 未找到'}`)),
          ev.error ? h('span', { class: 'small', style: { color: 'var(--bad)' } }, ev.error) : null),
        h('div', { class: 'grid2' },
          h('label', { class: 'field' }, h('span', {}, '每步评估时间（毫秒）'), h('input', { type: 'number', min: 50, max: 5000, step: 50, value: ev.movetime, onchange: guard(async (e) => { await post('/settings', { evalMovetime: Number(e.target.value) }); toast('已保存'); }) })),
          h('div', { class: 'field' }, h('span', {}, '引擎'), h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
            await post('/settings', { reloadEngine: true });
            toast('已重新检测引擎');
            settingsView(root, { meta, reloadMeta, session, go });
          }) }, '重新检测 engines/ 目录'))),
        h('div', { class: 'small muted' }, '天梯自动匹配的开关和节奏在「天梯」页右侧。注册审批在顶栏「审批」。')) : null,
    ));
}
