// 选手：列表、新建、主页。

import { h, api, post, patch, guard, toast, tierBadge, avatar, modelLine, fmtTime, fmtMs, fmtTokens, MODE_NAMES, resultText, dialog, seatOutcome } from './ui.js';

const EMOJIS = ['🦊', '🐯', '🐼', '🦁', '🐉', '🦅', '🐺', '🦉', '🐬', '🦄', '🐢', '🐲', '🦈', '🐙', '🦚', '🐝', '🐧', '🦝', '🐸', '🦋', '🐳', '🦜', '🐻', '🐨'];
const STYLE_EXAMPLES = ['喜欢弃子抢攻，宁可冒险也不求和。', '稳健防守，先保证不丢子，再寻找对方破绽。', '偏爱炮的进攻，开局常走中炮。'];

export async function charactersView(root, { meta, go, reloadMeta }) {
  const list = await api('/characters');
  const mine = list.filter((c) => !c.system && c.kind !== 'human');
  const sys = list.filter((c) => c.system || c.kind === 'human');

  const card = (c) => h('div', { class: 'card char', onclick: () => go(`#/characters/${c.id}`) },
    h('div', { class: 'top-row' }, avatar(c), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'nm' }, c.name), h('div', { class: 'md' }, modelLine(c)))),
    c.kind === 'model' ? h('div', { class: 'style' }, c.style || h('span', { class: 'muted' }, '无风格设定')) : null,
    h('div', { class: 'foot' },
      h('div', { class: 'row', style: { gap: '6px' } }, tierBadge(c.tier), h('span', { class: 'small muted' }, `${c.tier.points} 分`)),
      h('div', { class: 'row', style: { gap: '6px' } },
        !c.ranked ? h('span', { class: 'chip' }, '仅娱乐赛') : null,
        c.auto_match ? h('span', { class: 'chip good', title: '自动匹配已开启' }, `今日 ${c.today.games}/${c.daily_limit}`) : null)),
  );

  root.replaceChildren(
    h('div', { class: 'section-title' }, h('h2', {}, '我的 AI 选手')),
    h('div', { class: 'cards' }, ...mine.map(card), h('div', { class: 'card char new', onclick: () => createDialog({ meta, reloadMeta, onDone: (c) => go(`#/characters/${c.id}`) }) }, '＋ 新建选手')),
    h('div', { class: 'section-title', style: { marginTop: '28px' } }, h('h2', {}, '参照选手')),
    h('div', { class: 'cards' }, ...sys.map(card)),
  );
}

/** 新建（或派生）选手 */
export function createDialog({ meta, reloadMeta, base = null, onDone }) {
  const f = base
    ? { ...base, name: `${base.name}·新`, kind: base.kind }
    : { kind: 'model', name: '', avatar: EMOJIS[Math.floor(Math.random() * EMOJIS.length)], provider: 'deepseek', model: meta.presets[0].models[0] || '', base_url: '', effort: 'low', style: '', memory: false, show_legal: true, auto_match: true, daily_limit: 10, daily_tokens: '', level: 3 };
  f.memory = !!f.memory; f.show_legal = f.show_legal !== 0 && f.show_legal !== false; f.auto_match = !!f.auto_match;
  if (meta.dev) meta.presets = meta.presets.some((p) => p.id === 'mock') ? meta.presets : [...meta.presets, { id: 'mock', name: '模拟模型（开发用）', models: ['mock'], baseURL: null, needsKey: false, ranked: true, showsReasoning: true, canDisableThinking: true }];

  const body = h('div', { class: 'col', style: { gap: '14px' } });
  const testOut = h('div', { class: 'small' });
  let keys = { ...meta.keys };

  function preset() { return meta.presets.find((p) => p.id === f.provider); }

  function draw() {
    const p = preset();
    const keyState = keys[f.provider];
    const datalist = h('datalist', { id: 'model-options' }, ...(p?.models || []).map((m) => h('option', { value: m })));
    const keyInput = h('input', { type: 'password', placeholder: `${p?.name || ''} API Key`, autocomplete: 'off' });
    const kindSeg = h('div', { class: 'seg' }, ...[['model', 'AI 模型'], ['builtin', '内置 AI']].map(([v, l]) => h('button', { class: f.kind === v ? 'on' : '', onclick: () => { f.kind = v; draw(); } }, l)));
    body.replaceChildren(
      base ? h('div', { class: 'small muted' }, `从「${base.name}」派生：可以修改配置，积分从头算。`) : kindSeg,
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, '名字'), h('input', { type: 'text', value: f.name, maxlength: 24, placeholder: '例如：深思小鹿', oninput: (e) => { f.name = e.target.value; } })),
        h('div', { class: 'field' }, h('span', {}, '头像'), h('div', { class: 'emoji-pick' }, ...EMOJIS.slice(0, 16).map((e) => h('button', { class: f.avatar === e ? 'on' : '', onclick: () => { f.avatar = e; draw(); } }, e)))),
      ),
      f.kind === 'model' ? [
        h('div', { class: 'grid2' },
          h('label', { class: 'field' }, h('span', {}, '平台'),
            h('select', { onchange: (e) => { f.provider = e.target.value; f.model = preset()?.models[0] || ''; f.base_url = ''; if (f.effort === 'off' && !preset()?.canDisableThinking) f.effort = 'low'; if (f.provider === 'ollama') f.effort = 'off'; draw(); } },
              ...meta.presets.map((x) => h('option', { value: x.id, selected: x.id === f.provider }, `${x.name}${keys[x.id] === 'none' ? '（未配置密钥）' : ''}`)))),
          h('label', { class: 'field' }, h('span', {}, '模型 ID'),
            h('div', { class: 'keyline' },
              h('input', { type: 'text', value: f.model, list: 'model-options', oninput: (e) => { f.model = e.target.value; } }), datalist,
              h('button', { class: 'btn sm', title: '从接口获取可用模型', onclick: guard(async () => {
                const r = await api(`/provider-models?provider=${f.provider}&baseURL=${encodeURIComponent(f.base_url || '')}`);
                datalist.replaceChildren(...r.models.map((m) => h('option', { value: m })));
                toast(`获取到 ${r.models.length} 个模型`);
              }) }, '列表'))),
        ),
        keyState === 'none' ? h('div', { class: 'field' }, h('span', {}, `${p.name} API Key`),
          h('div', { class: 'keyline' }, keyInput, h('button', { class: 'btn sm', onclick: guard(async () => {
            if (!keyInput.value.trim()) return;
            const r = await post('/keys', { provider: f.provider, key: keyInput.value.trim() });
            keys = r.keys; meta.keys = r.keys; reloadMeta?.(); toast('密钥已加密保存'); draw();
          }) }, '保存'))) : null,
        ['custom', 'ollama', 'qwen'].includes(f.provider) ? h('label', { class: 'field' }, h('span', {}, '接口地址'),
          h('input', { type: 'text', value: f.base_url || '', placeholder: p.baseURL || 'https://…/v1', oninput: (e) => { f.base_url = e.target.value; } }),
          p.note ? h('span', {}, p.note) : null) : null,
        !p.ranked ? h('div', { class: 'small muted' }, '这个平台的选手只能下娱乐赛，不参加排位。') : null,
        h('div', { class: 'field' }, h('span', {}, '推理强度'),
          h('div', { class: 'seg' }, ...Object.entries(meta.efforts).filter(([v]) => v !== 'off' || p.canDisableThinking).map(([v, l]) => h('button', { class: f.effort === v ? 'on' : '', onclick: () => { f.effort = v; draw(); } }, l)))),
        h('label', { class: 'field' }, h('span', {}, '风格'),
          h('textarea', { maxlength: 300, placeholder: STYLE_EXAMPLES[Math.floor(Math.random() * STYLE_EXAMPLES.length)], oninput: (e) => { f.style = e.target.value; } }, f.style || '')),
        h('div', { class: 'row', style: { gap: '20px' } },
          h('label', { class: 'switch', title: '每盘结束后写一句复盘笔记，下一盘带上最近 5 条' }, h('input', { type: 'checkbox', checked: f.memory, onchange: (e) => { f.memory = e.target.checked; } }), '跨局记忆'),
          h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: f.show_legal, onchange: (e) => { f.show_legal = e.target.checked; } }), '提供合法着法列表')),
      ] : h('label', { class: 'field' }, h('span', {}, '搜索深度'),
        h('div', { class: 'seg' }, ...[[1, '1 层'], [2, '2 层'], [3, '3 层'], [4, '4 层']].map(([v, l]) => h('button', { class: f.level === v ? 'on' : '', onclick: () => { f.level = v; draw(); } }, l)))),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, '每日对局上限'), h('input', { type: 'number', min: 1, max: meta.maxDailyLimit, value: f.daily_limit, oninput: (e) => { f.daily_limit = Number(e.target.value); } })),
        h('label', { class: 'field' }, h('span', {}, '每日 token 上限'), h('input', { type: 'number', min: 1000, step: 10000, value: f.daily_tokens || '', placeholder: '不限', oninput: (e) => { f.daily_tokens = e.target.value ? Number(e.target.value) : null; } })),
      ),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: f.auto_match, onchange: (e) => { f.auto_match = e.target.checked; } }), '参加天梯自动匹配'),
      f.kind === 'model' ? h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: guard(async () => {
        testOut.replaceChildren(h('span', { class: 'muted' }, '测试中…'));
        const r = await post('/test-config', { provider: f.provider, model: f.model, base_url: f.base_url, effort: f.effort });
        testOut.replaceChildren(r.ok
          ? h('span', {}, h('span', { class: 'chip good' }, `连接成功 · ${fmtMs(r.latencyMs)}`), ' ', r.text)
          : h('span', { class: 'chip bad' }, r.error));
      }) }, '测试连接'), testOut) : null,
    );
  }
  draw();

  const dlg = dialog(base ? '派生选手' : '新建 AI 选手', body, [
    h('button', { class: 'btn', onclick: () => dlg.close() }, '取消'),
    h('button', { class: 'btn primary', onclick: guard(async () => {
      const payload = { ...f };
      const c = base ? await post(`/characters/${base.id}/derive`, payload) : await post('/characters', payload);
      dlg.close();
      toast(`已创建「${c.name}」`);
      onDone?.(c);
    }) }, '创建'),
  ]);
}

// ---------- 选手主页 ----------

function lineChart(points) {
  const W = 520, H = 140, P = 28;
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('class', 'chart');
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.style.width = '100%';
  if (points.length < 2) {
    svgEl.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">下满两盘排位赛后显示积分曲线</text>`;
    return svgEl;
  }
  const vals = points.map((p) => p.score);
  const lo = Math.min(...vals) - 20, hi = Math.max(...vals) + 20;
  const X = (i) => P + (i / (points.length - 1)) * (W - P - 8);
  const Y = (v) => H - 18 - ((v - lo) / (hi - lo)) * (H - 30);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.score).toFixed(1)}`).join(' ');
  svgEl.innerHTML = `
    <line class="grid" x1="${P}" y1="${Y(hi - 20)}" x2="${W}" y2="${Y(hi - 20)}"/><text x="2" y="${Y(hi - 20) + 3}">${Math.round(hi - 20)}</text>
    <line class="grid" x1="${P}" y1="${Y(lo + 20)}" x2="${W}" y2="${Y(lo + 20)}"/><text x="2" y="${Y(lo + 20) + 3}">${Math.round(lo + 20)}</text>
    <path class="line" d="${d}"/>`;
  return svgEl;
}

function radar(metrics) {
  const axes = [
    ['棋力准确率', metrics.accuracy],
    ['判断准确度', metrics.calibration],
    ['一次走对率', metrics.legalRate],
    ['速度', metrics.avgLatencyMs === null ? null : Math.round(100 * Math.max(0, 1 - metrics.avgLatencyMs / 60000))],
    ['省 token', metrics.avgTokens === null ? null : Math.round(100 * Math.max(0, 1 - metrics.avgTokens / 20000))],
  ];
  const R = 80, C = 110;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
    return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v];
  };
  const webs = [0.25, 0.5, 0.75, 1].map((k) => `<polygon class="web" points="${axes.map((_, i) => pt(i, k).join(',')).join(' ')}"/>`).join('');
  const shape = axes.every(([, v]) => v === null) ? '' : `<polygon class="shape" points="${axes.map(([, v], i) => pt(i, (v ?? 0) / 100).join(',')).join(' ')}"/>`;
  const labels = axes.map(([n, v], i) => {
    const [x, y] = pt(i, 1.22);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${n} ${v ?? '—'}</text>`;
  }).join('');
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('class', 'radar');
  el.setAttribute('viewBox', '-45 -8 310 236');
  el.style.width = '100%';
  el.style.maxWidth = '340px';
  el.innerHTML = webs + shape + labels;
  return el;
}

export async function profileView(root, id, { meta, go, reloadMeta }) {
  const p = await api(`/characters/${id}`);
  const c = p.character;
  const g = p.games.slice().sort((a, b) => b.rating.played - a.rating.played)[0]; // 主页显示下得最多的游戏
  const r = g.rating;
  const mySeat = (m) => Object.entries(m.seats).find(([, x]) => x === c.id)?.[0];

  const settings = h('div', { class: 'col', style: { gap: '10px' } });
  const drawSettings = () => {
    if (c.system) { settings.replaceChildren(h('div', { class: 'small muted' }, '系统参照选手，用来给新选手定级，让积分有固定参照。')); return; }
    if (c.kind === 'human') { settings.replaceChildren(h('div', { class: 'small muted' }, '你自己。和 AI 下排位赛时也会计分。')); return; }
    settings.replaceChildren(
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!c.auto_match, onchange: guard(async (e) => { Object.assign(c, await patch(`/characters/${c.id}`, { auto_match: e.target.checked })); toast(e.target.checked ? '已加入自动匹配' : '已退出自动匹配'); }) }), '参加天梯自动匹配'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, '每日对局上限'), h('input', { type: 'number', min: 1, max: meta.maxDailyLimit, value: c.daily_limit, onchange: guard(async (e) => { Object.assign(c, await patch(`/characters/${c.id}`, { daily_limit: Number(e.target.value) })); toast('已保存'); }) })),
        h('label', { class: 'field' }, h('span', {}, '每日 token 上限'), h('input', { type: 'number', min: 1000, step: 10000, value: c.daily_tokens || '', placeholder: '不限', onchange: guard(async (e) => { Object.assign(c, await patch(`/characters/${c.id}`, { daily_tokens: e.target.value ? Number(e.target.value) : null })); toast('已保存'); }) }))),
      h('div', { class: 'row' },
        c.kind === 'model' ? h('button', { class: 'btn sm', onclick: guard(async (e) => {
          e.target.disabled = true;
          const t = await post(`/characters/${c.id}/test`);
          e.target.disabled = false;
          toast(t.ok ? `连接成功：${t.text}` : t.error, !t.ok);
        }) }, '测试连接') : null,
        h('button', { class: 'btn sm', onclick: () => createDialog({ meta, reloadMeta, base: c, onDone: (n) => go(`#/characters/${n.id}`) }) }, '派生新选手'),
        h('button', { class: 'btn sm', onclick: guard(async () => {
          const name = prompt('新名字', c.name);
          if (!name) return;
          Object.assign(c, await patch(`/characters/${c.id}`, { name }));
          profileView(root, id, { meta, go, reloadMeta });
        }) }, '改名'),
        h('button', { class: 'btn sm', onclick: guard(async () => {
          if (!confirm(c.archived ? '恢复这名选手？' : '归档后不再出现在列表和排行榜里，历史对局保留。确定归档？')) return;
          await patch(`/characters/${c.id}`, { archived: !c.archived });
          go('#/characters');
        }) }, c.archived ? '恢复' : '归档')),
    );
  };
  drawSettings();

  const m = p.metrics;
  const tags = Object.entries(m.tags || {});
  root.replaceChildren(h('div', { class: 'profile' },
    h('div', { class: 'col' },
      h('div', { class: 'card pad col' },
        h('div', { class: 'row' }, avatar(c, 'lg'), h('div', { class: 'grow' }, h('h2', {}, c.name), h('div', { class: 'small muted' }, modelLine(c)), c.effortName && c.kind === 'model' ? h('div', { class: 'small muted' }, `推理强度：${c.effortName}${c.memory ? ' · 跨局记忆' : ''}${c.show_legal ? '' : ' · 不提供合法着法'}`) : null)),
        c.style ? h('div', { class: 'note' }, c.style) : null,
        h('div', { class: 'row' }, tierBadge(r.tier), h('b', { style: { fontSize: '20px' } }, `${r.points}`), h('span', { class: 'small muted' }, `最高 ${Math.round(r.peak)}`)),
        h('div', { class: 'stat-grid' },
          h('div', { class: 'stat' }, h('b', {}, r.wins), h('small', {}, '胜')),
          h('div', { class: 'stat' }, h('b', {}, r.draws), h('small', {}, '和')),
          h('div', { class: 'stat' }, h('b', {}, r.losses), h('small', {}, '负'))),
        h('div', { class: 'small muted' }, `今日已下 ${p.today.games}/${c.daily_limit} 盘 · ${fmtTokens(p.today.tokens)} tokens · 创建于 ${fmtTime(c.created_at)}`),
        c.parent_id ? h('a', { class: 'small', href: `#/characters/${c.parent_id}` }, '查看派生来源') : null,
      ),
      h('div', { class: 'card pad col' }, h('h3', {}, '设置'), settings),
      p.notes.length ? h('div', { class: 'card pad col' }, h('h3', {}, '复盘笔记'), ...p.notes.map((n) => h('div', { class: 'note' }, n.text, h('div', { class: 'small muted' }, fmtTime(n.created_at))))) : null,
    ),
    h('div', { class: 'col' },
      h('div', { class: 'grid2' },
        h('div', { class: 'card pad col' }, h('h3', {}, '能力'), h('div', { style: { display: 'grid', placeItems: 'center' } }, radar(m)),
          h('div', { class: 'small muted' }, `共 ${m.moves} 步 · 平均每步 ${fmtMs(m.avgLatencyMs) || '—'} · ${fmtTokens(m.avgTokens)} tokens`),
          tags.length ? h('div', { class: 'row', style: { gap: '6px' } }, ...tags.map(([t, n]) => h('span', { class: 'chip' }, `${t} ${n}`))) : null),
        h('div', { class: 'card pad col' }, h('h3', {}, `积分曲线 · ${g.name}`), lineChart(g.history),
          p.masterpiece ? h('div', { class: 'small' }, '代表作：', h('a', { href: `#/match/${p.masterpiece.id}` }, `对 ${Object.values(p.masterpiece.players).find((x) => x.id !== c.id)?.name}（平均损失 ${Math.round(p.masterpiece.avgLoss * 100)}%）`)) : null),
      ),
      h('div', { class: 'card' }, h('div', { class: 'pad', style: { paddingBottom: 0 } }, h('h3', {}, '交手记录')),
        p.h2h.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('tr', {}, h('th', {}, '对手'), h('th', { class: 'num' }, '胜'), h('th', { class: 'num' }, '和'), h('th', { class: 'num' }, '负')),
          ...p.h2h.map((x) => h('tr', { class: 'click', onclick: () => go(`#/characters/${x.opponent.id}`) }, h('td', {}, h('span', { class: 'row', style: { gap: '6px' } }, avatar(x.opponent, 'sm'), x.opponent.name)), h('td', { class: 'num' }, x.w), h('td', { class: 'num' }, x.d), h('td', { class: 'num' }, x.l))))) : h('div', { class: 'empty' }, '还没有对局')),
      h('div', { class: 'card' }, h('div', { class: 'pad', style: { paddingBottom: 0 } }, h('h3', {}, '最近对局')),
        p.matches.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('tr', {}, h('th', {}, '时间'), h('th', {}, '对手'), h('th', {}, '执'), h('th', {}, '模式'), h('th', {}, '结果'), h('th', { class: 'num' }, '积分')),
          ...p.matches.map((x) => {
            const s = mySeat(x);
            const opp = { name: Object.entries(x.players).filter(([seat]) => seat !== s).map(([, pl]) => pl?.name).join('、') };
            const res = x.status === 'running' ? '进行中' : x.result?.aborted ? '中止' : ({ w: '胜', d: '和', l: '负' })[seatOutcome(x.result, s)];
            const delta = x.rating_changes?.[c.id]?.delta;
            return h('tr', { class: 'click', onclick: () => go(`#/match/${x.id}`) },
              h('td', { class: 'muted' }, fmtTime(x.created_at)), h('td', {}, opp?.name || ''), h('td', {}, x.seatNames?.[s] || s),
              h('td', {}, MODE_NAMES[x.mode]), h('td', { title: resultText(x) }, res),
              h('td', { class: 'num' }, delta === undefined ? '' : h('span', { style: { color: delta >= 0 ? 'var(--good)' : 'var(--bad)' } }, delta >= 0 ? `+${delta}` : delta)));
          }))) : h('div', { class: 'empty' }, '还没有对局')),
    ),
  ));
}
