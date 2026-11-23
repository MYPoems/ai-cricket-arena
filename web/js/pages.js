// 对局记录、设置。

import { h, api, post, guard, toast, avatar, fmtTime, MODE_NAMES, resultText } from './ui.js';

const REC_STATUS = { queued: '排队中', running: '录制中', done: '已完成', failed: '失败' };

export async function historyView(root, { go }) {
  const [list, rec] = await Promise.all([api('/matches?limit=200'), api('/recordings')]);
  const recBlock = rec.list.length ? h('section', { style: { marginBottom: '40px' } },
    h('div', { class: 'section-title' }, h('h2', {}, '录制的视频'), h('span', { class: 'label' }, rec.status.chrome ? '1920×1080 · MP4' : '服务器上没有可用的浏览器，无法录制')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('tr', {}, h('th', {}, '时间'), h('th', {}, '对局'), h('th', { class: 'num' }, '倍速'), h('th', {}, '状态'), h('th', {}, '')),
      ...rec.list.map((r) => h('tr', {},
        h('td', { class: 'muted' }, fmtTime(r.created_at)),
        h('td', {}, h('a', { href: `#/match/${r.match_id}` }, r.match_id)),
        h('td', { class: 'num' }, `${r.speed}×`),
        h('td', { title: r.error || '' }, REC_STATUS[r.status] || r.status, r.error ? h('span', { class: 'small muted' }, `：${r.error}`) : null),
        h('td', {}, r.status === 'done' ? h('a', { class: 'btn sm', href: `/api/recordings/${r.id}/file` }, '下载 MP4') : null)))))) : null;
  root.replaceChildren(recBlock, h('div', { class: 'card table-wrap' },
    h('div', { class: 'pad' }, h('h2', {}, '对局记录')),
    list.length ? h('table', { class: 'list' },
      h('tr', {}, h('th', {}, '时间'), h('th', {}, '游戏'), h('th', {}, '选手'), h('th', {}, '模式'), h('th', { class: 'num' }, '步数'), h('th', {}, '结果')),
      ...list.map((m) => h('tr', { class: 'click', onclick: () => go(`#/match/${m.id}`) },
        h('td', { class: 'muted' }, fmtTime(m.created_at)),
        h('td', {}, h('span', { class: 'chip' }, m.gameName)),
        h('td', {}, Object.values(m.players).map((pl) => pl?.name).join(' · ')),
        h('td', {}, MODE_NAMES[m.mode]),
        h('td', { class: 'num' }, m.plies),
        h('td', {}, m.status === 'running' ? h('span', { class: 'chip good' }, '进行中') : resultText(m))))) : h('div', { class: 'empty' }, '还没有对局'),
  ));
}

export async function settingsView(root, { meta, reloadMeta }) {
  await reloadMeta();
  const m = meta;
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
          settingsView(root, { meta, reloadMeta });
        }) }, '保存'),
        st === 'db' ? h('button', { class: 'btn sm ghost', onclick: guard(async () => {
          if (!confirm(`删除 ${p.name} 的密钥？`)) return;
          await post('/keys', { provider: p.id, key: '' });
          settingsView(root, { meta, reloadMeta });
        }) }, '删除') : null)),
    );
  });

  const ev = m.evaluator;
  root.replaceChildren(h('div', { class: 'col', style: { maxWidth: '920px' } },
    h('div', { class: 'card' }, h('div', { class: 'pad' }, h('h2', {}, 'API 密钥'), h('div', { class: 'small muted' }, '密钥加密保存在本机数据库里，不会发送到浏览器。')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, ...keyRows))),
    h('div', { class: 'card pad col' }, h('h2', {}, '胜率评估'),
      h('div', { class: 'row' }, ev.source === 'pikafish' ? h('span', { class: 'chip good' }, 'Pikafish 已就绪') : h('span', { class: 'chip warn' }, '未找到 Pikafish，使用内置 AI 粗略评估'),
        ev.error ? h('span', { class: 'small', style: { color: 'var(--bad)' } }, ev.error) : null),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, '每步评估时间（毫秒）'), h('input', { type: 'number', min: 50, max: 5000, step: 50, value: ev.movetime, onchange: guard(async (e) => { await post('/settings', { evalMovetime: Number(e.target.value) }); toast('已保存'); }) })),
        h('div', { class: 'field' }, h('span', {}, '引擎'), h('button', { class: 'btn', onclick: guard(async () => {
          const r = await post('/settings', { reloadEngine: true });
          toast(r.evaluator.source === 'pikafish' ? 'Pikafish 已加载' : '仍未找到 Pikafish', r.evaluator.source !== 'pikafish');
          settingsView(root, { meta, reloadMeta });
        }) }, '重新检测 engines/ 目录'))),
    ),
    h('div', { class: 'card pad col' }, h('h2', {}, '排位规则'),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: m.allowLocalRanked, onchange: guard(async (e) => { await post('/settings', { allowLocalRanked: e.target.checked }); toast('已保存'); }) }), '允许本地 Ollama 模型参加排位（仅限自己使用时）'),
    ),
  ));
}
