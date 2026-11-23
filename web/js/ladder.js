// 天梯：角色榜 / 模型榜，自动匹配设置和动态。

import { h, api, post, guard, toast, tierBadge, avatar, listen } from './ui.js';

export async function ladderView(root, { go, meta }) {
  let view = 'characters';
  let game = meta.games[0].id;
  const table = h('div', { class: 'card table-wrap' });
  const side = h('div', { class: 'col' });

  async function drawTable() {
    const rows = await api(`/leaderboard?game=${game}&view=${view}`);
    const gameTabs = h('select', { style: { width: 'auto' }, onchange: (e) => { game = e.target.value; drawTable(); } }, ...meta.games.map((g) => h('option', { value: g.id, selected: g.id === game }, g.name)));
    const tabs = h('div', { class: 'seg' }, ...[['characters', '角色榜'], ['models', '模型榜']].map(([v, l]) => h('button', { class: view === v ? 'on' : '', onclick: () => { view = v; drawTable(); } }, l)));
    const head = h('div', { class: 'pad section-title', style: { margin: 0 } }, h('div', { class: 'row' }, h('h2', {}, '排名'), gameTabs), tabs);
    if (!rows.length) { table.replaceChildren(head, h('div', { class: 'empty' }, '还没有排位对局。开启自动匹配，或手动开一盘排位赛。')); return; }
    let rank = 0;
    table.replaceChildren(head, h('table', { class: 'list' },
      h('tr', {}, h('th', {}, ''), h('th', {}, view === 'models' ? '模型' : '选手'), h('th', {}, '段位'), h('th', { class: 'num' }, '积分'), h('th', { class: 'num' }, '胜'), h('th', { class: 'num' }, '和'), h('th', { class: 'num' }, '负'), h('th', { class: 'num' }, view === 'models' ? '选手数' : '场次')),
      ...rows.map((r) => {
        const n = r.system ? '' : ++rank;
        return h('tr', { class: 'click', onclick: () => go(`#/characters/${r.character_id}`) },
          h('td', {}, h('span', { class: `rank-no${n && n <= 3 ? ` top${n}` : ''}` }, n || '·')),
          h('td', {}, h('span', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, avatar(r, 'sm'),
            h('span', {}, view === 'models' ? `${r.model}` : r.name),
            r.system ? h('span', { class: 'chip' }, '参照') : null,
            view === 'models' ? h('span', { class: 'small muted' }, `最佳：${r.name}`) : null)),
          h('td', {}, tierBadge(r.tierInfo)),
          h('td', { class: 'num' }, h('b', {}, r.points)),
          h('td', { class: 'num' }, r.wins), h('td', { class: 'num' }, r.draws), h('td', { class: 'num' }, r.losses),
          h('td', { class: 'num' }, view === 'models' ? r.characters : r.played));
      })));
  }

  async function drawSide() {
    const l = await api('/ladder');
    const s = l.settings;
    const save = guard(async (patchObj) => {
      await post('/settings', { ladder: { ...s, ...patchObj } });
      toast('已保存');
      drawSide();
    });
    const num = (label, key, min, max, extra = {}) => h('label', { class: 'field' }, h('span', {}, label),
      h('input', { type: 'number', min, max, value: s[key] ?? '', placeholder: extra.placeholder || '', onchange: (e) => save({ [key]: e.target.value === '' ? null : Number(e.target.value) }) }));
    side.replaceChildren(
      h('div', { class: 'card pad col' },
        h('div', { class: 'section-title', style: { margin: 0 } }, h('h3', {}, '自动匹配'),
          h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s.enabled, onchange: (e) => save({ enabled: e.target.checked }) }), s.enabled ? '运行中' : '已关闭')),
        h('div', { class: 'grid2' },
          num('同时进行', 'concurrency', 1, 8),
          num('最大段位差', 'maxTierGap', 1, 7),
          num('同一对手每天', 'samePairPerDay', 1, 10),
          num('匹配间隔（秒）', 'intervalSec', 10, 3600)),
        num('全平台每日 token 上限', 'globalDailyTokens', 10000, null, { placeholder: '不限' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: guard(async () => {
            const r = await post('/ladder/run');
            if (r.matchId) go(`#/match/${r.matchId}`);
            else toast('现在没有可以匹配的选手（检查自动匹配开关、每日上限和段位差）', true);
          }) }, '立即匹配一盘'),
          h('span', { class: 'small muted' }, `进行中 ${l.running} 盘`)),
      ),
      h('div', { class: 'card pad col' }, h('h3', {}, `今天可出战（${l.eligible.length}）`),
        l.eligible.length ? h('div', { class: 'row', style: { gap: '6px' } }, ...l.eligible.map((c) => h('span', { class: 'chip', title: `今日 ${c.today}/${c.limit}` }, c.avatar, ' ', c.name))) : h('div', { class: 'small muted' }, '没有选手开启自动匹配，或今天的额度已用完')),
      h('div', { class: 'card pad col' }, h('h3', {}, '动态'),
        l.log.length ? h('div', { class: 'log' }, ...l.log.map((x) => h('div', {}, x.text))) : h('div', { class: 'small muted' }, '暂无')),
    );
  }

  root.replaceChildren(h('div', { class: 'ladder' }, table, side));
  await Promise.all([drawTable(), drawSide()]);
  return listen(['lobby'], (e) => {
    if (e.type === 'match_finished') drawTable();
    if (e.type === 'ladder_log' || e.type === 'match_finished') drawSide();
  });
}
