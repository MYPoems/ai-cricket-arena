// 对局记录（含同题对比、录像）、设置。

import { h, api, post, guard, toast, fmtTime, MODE_NAMES, resultText, pageHead } from './ui.js';

const REC_STATUS = { queued: '排队中', running: '录制中', done: '已完成', failed: '失败' };
const ORIGIN = { auto: '天梯匹配', room: '组局', manual: '手动开局' };

export async function historyView(root, { go, session }) {
  let tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'all';
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  const TABS = [['all', '全部对局'], ...(session.user ? [['mine', '我的对局']] : []), ['compare', '同题对比'], ['video', '录像']];

  async function draw() {
    tabs.replaceChildren(...TABS.map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; draw(); } }, l)));
    if (tab === 'compare') return drawCompare();
    if (tab === 'video') return drawVideo();
    const list = await api(`/matches?limit=200${tab === 'mine' ? '&mine=1' : ''}`);
    body.replaceChildren(h('div', { class: 'card table-wrap' },
      list.length ? h('table', { class: 'list' },
        h('tr', {}, h('th', {}, '时间'), h('th', {}, '游戏'), h('th', {}, '蛐蛐'), h('th', {}, '来源'), h('th', {}, '模式'), h('th', { class: 'num' }, '步数'), h('th', {}, '结果')),
        ...list.map((m) => h('tr', { class: 'click', onclick: () => go(`#/match/${m.id}`) },
          h('td', { class: 'muted' }, fmtTime(m.created_at)),
          h('td', {}, h('span', { class: 'chip' }, m.gameName)),
          h('td', {}, Object.values(m.players).map((pl) => pl?.name).join(' · ')),
          h('td', { class: 'muted' }, ORIGIN[m.origin] || '—'),
          h('td', {}, MODE_NAMES[m.mode]),
          h('td', { class: 'num' }, m.plies),
          h('td', {}, m.status === 'running' ? h('span', { class: 'chip good' }, '进行中') : resultText(m))))) : h('div', { class: 'empty' }, tab === 'mine' ? '你还没有对局。去组局或开局吧。' : '还没有对局')));
  }

  async function drawCompare() {
    const past = await api('/compares');
    body.replaceChildren(h('div', { class: 'col' },
      h('div', { class: 'card pad row', style: { justifyContent: 'space-between' } },
        h('div', {}, h('h3', {}, '同题对比'), h('div', { class: 'small muted' }, '同一个象棋局面同时交给几只蛐蛐，并排看各自怎么想、怎么走。')),
        session.user ? h('a', { class: 'btn primary', href: '#/compare' }, '新建同题对比') : null),
      past.length ? h('div', { class: 'card table-wrap' }, h('table', { class: 'list' },
        h('tr', {}, h('th', {}, '时间'), h('th', {}, '题目')),
        ...past.map((c) => h('tr', { class: 'click', onclick: () => go(`#/compare/${c.id}`) }, h('td', { class: 'muted' }, fmtTime(c.created_at)), h('td', {}, c.title))))) : h('div', { class: 'empty card' }, '还没有同题对比')));
  }

  async function drawVideo() {
    const rec = await api('/recordings');
    body.replaceChildren(rec.list.length ? h('div', { class: 'card table-wrap' }, h('table', { class: 'list' },
      h('tr', {}, h('th', {}, '时间'), h('th', {}, '对局'), h('th', { class: 'num' }, '倍速'), h('th', {}, '状态'), h('th', {}, '')),
      ...rec.list.map((r) => h('tr', {},
        h('td', { class: 'muted' }, fmtTime(r.created_at)),
        h('td', {}, h('a', { href: `#/match/${r.match_id}` }, r.game ? `${r.game} · ${r.match_id}` : r.match_id)),
        h('td', { class: 'num' }, `${r.speed}×`),
        h('td', { title: r.error || '' }, REC_STATUS[r.status] || r.status, r.error ? h('span', { class: 'small muted' }, `：${r.error}`) : null),
        h('td', {}, r.status === 'done' ? h('a', { class: 'btn sm', href: `/api/recordings/${r.id}/file` }, '下载 MP4') : null)))))
      : h('div', { class: 'empty card' }, rec.status.chrome ? '还没有录像。在结束的对局页点「录成视频」。' : '服务器上没有可用的浏览器，无法录制'));
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
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: st === 'db' ? '已保存（输入新值可替换）' : st === 'env' ? '已从环境变量读取' : '粘贴 API Key' });
    return h('tr', {},
      h('td', {}, h('b', {}, p.name)),
      h('td', {}, st === 'db' ? h('span', { class: 'chip good' }, '已配置') : st === 'env' ? h('span', { class: 'chip good' }, '环境变量') : h('span', { class: 'chip' }, '未配置')),
      h('td', { style: { width: '50%' } }, input),
      h('td', {}, h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
        h('button', { class: 'btn sm', onclick: guard(async () => {
          if (!input.value.trim()) return;
          await post('/keys', { provider: p.id, key: input.value.trim() });
          toast(`${p.name} 密钥已加密保存`);
          settingsView(root, { meta, reloadMeta, session, go });
        }) }, '保存'),
        st === 'db' ? h('button', { class: 'btn sm ghost', onclick: guard(async () => {
          if (!confirm(`删除 ${p.name} 的密钥？`)) return;
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
        h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, ...keyRows))),
      h('div', { class: 'card pad row', style: { justifyContent: 'space-between' } },
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
          h('div', { class: 'field' }, h('span', {}, '引擎'), h('button', { class: 'btn', onclick: guard(async () => {
            await post('/settings', { reloadEngine: true });
            toast('已重新检测引擎');
            settingsView(root, { meta, reloadMeta, session, go });
          }) }, '重新检测 engines/ 目录'))),
        h('div', { class: 'small muted' }, '天梯自动匹配的开关和节奏在「天梯」页右侧。注册审批在顶栏「审批」。')) : null,
    ));
}
