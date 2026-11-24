// 选手：列表、新建、主页。

import { h, api, post, patch, guard, toast, tierBadge, avatar, modelLine, fmtTime, fmtMs, fmtTokens, MODE_NAMES, resultText, dialog, seatOutcome, pageHead, confirmDialog, promptDialog, setTitle, emptyState, linkRow, pressed, icon, guardConfirm, cleanName, summarizeSeats, markInvalid } from './ui.js';

// 头像格只摆前 16 个；新建时随机给的头像也从这 16 个里挑，打开弹窗就能看到选中的那一个
const PICKABLE_EMOJIS = 16;
const EMOJIS = ['🦊', '🐯', '🐼', '🦁', '🐉', '🦅', '🐺', '🦉', '🐬', '🦄', '🐢', '🐲', '🦈', '🐙', '🦚', '🐝', '🐧', '🦝', '🐸', '🦋', '🐳', '🦜', '🐻', '🐨'];
/** Agent 接入令牌：只在生成时显示一次 */
export function tokenDialog(name, token) {
  const box = h('input', { type: 'text', value: token, readonly: true, onclick: (e) => e.target.select(), style: { fontFamily: 'var(--mono)' } });
  const dlg = dialog(`「${cleanName(name)}」的接入令牌`, h('div', { class: 'col', style: { gap: '12px' } },
    h('div', { class: 'small' }, '把这个令牌交给你的 Agent。令牌只显示这一次，网站只保存它的哈希；丢了就在它的主页重新生成（旧令牌立即失效）。'),
    h('div', { class: 'keyline' }, box, h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(token); toast('已复制'); } catch { box.select(); } } }, '复制')),
    h('div', { class: 'small' }, '接入方法见 ', h('a', { href: '#/agent-guide' }, '「Agent 接入」'), '：HTTP 接口或 MCP 都可以，Agent 在线时才会被自动匹配。'),
  ), [h('button', { class: 'btn primary', type: 'button', onclick: () => dlg.close() }, icon('check', 16), '我已保存')]);
  dlg.dataset.keep = '1';
  return dlg;
}

const STYLE_EXAMPLES = ['喜欢弃子抢攻，宁可冒险也不求和。', '稳健防守，先保证不丢子，再寻找对方破绽。', '偏爱炮的进攻，开局常走中炮。'];

export async function charactersView(root, { meta, go, reloadMeta, session }) {
  const list = await api('/characters');
  const mine = list.filter((c) => c.mine && !c.system && c.kind !== 'human');
  const sys = list.filter((c) => c.system || (c.mine && c.kind === 'human'));

  const card = (c) => h('a', { class: 'card char', href: `#/characters/${c.id}` },
    h('div', { class: 'top-row' }, avatar(c), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'nm' }, cleanName(c.name)), h('div', { class: 'md' }, modelLine(c)))),
    c.kind === 'model' && c.style ? h('div', { class: 'style' }, c.style) : null,
    h('div', { class: 'foot' },
      h('div', { class: 'foot-score' }, tierBadge(c.tier), h('span', { class: 'small muted num' }, `${c.tier.points} 分`)),
      h('div', { class: 'foot-tags' },
        !c.ranked ? h('span', { class: 'chip' }, '仅娱乐赛') : null,
        c.kind === 'agent' ? h('span', { class: `chip ${c.online ? 'good' : ''}` }, c.online ? 'Agent 在线' : 'Agent 离线') : null,
        c.auto_match && c.mine ? h('span', { class: 'chip', title: '今天主动参加的对局 / 每日上限（组局不计）' }, `今日 ${c.today.games}/${c.daily_limit}`) : null)),
  );

  root.replaceChildren(
    pageHead('蛐蛐', '养自己的 AI 蛐蛐：接一个模型，或者让你的 Agent 亲自上场。配置创建后锁定，想换就派生一只新的。', '养'),
    session.user ? h('div', { class: 'section-title' }, h('h2', {}, '我的蛐蛐')) : null,
    session.user ? h('div', { class: 'cards' }, ...mine.map(card), h('button', { class: 'card char new', type: 'button', onclick: () => createDialog({ meta, reloadMeta, onDone: (c) => go(`#/characters/${c.id}`) }) }, icon('plus', 22), '养一只新蛐蛐'))
      : emptyState('登录后可以养自己的蛐蛐。', { wm: null, action: h('a', { class: 'btn primary', href: '#/login?next=%23%2Fcharacters' }, '登录') }),
    h('div', { class: 'section-title section-gap' }, h('h2', {}, sys.some((c) => c.kind === 'human') ? '系统选手与我' : '系统选手')),
    h('div', { class: 'cards' }, ...sys.map(card)),
  );
}

/** 新建（或派生）选手 */
export function createDialog({ meta, reloadMeta, base = null, onDone }) {
  const f = base
    ? { ...base, name: `${base.name}·新`, kind: base.kind }
    : { kind: 'model', name: '', avatar: EMOJIS[Math.floor(Math.random() * PICKABLE_EMOJIS)], provider: 'deepseek', model: meta.presets[0].models[0] || '', base_url: '', effort: 'low', style: '', memory: false, show_legal: true, auto_match: true, daily_limit: 10, daily_tokens: '', level: 3 };
  f.memory = !!f.memory; f.show_legal = f.show_legal !== 0 && f.show_legal !== false; f.auto_match = !!f.auto_match;
  if (meta.dev) meta.presets = meta.presets.some((p) => p.id === 'mock') ? meta.presets : [...meta.presets, { id: 'mock', name: '模拟模型（开发用）', models: ['mock'], baseURL: null, needsKey: false, ranked: true, showsReasoning: true, canDisableThinking: true }];

  const body = h('div', { class: 'col', style: { gap: '14px' } });
  const refs = {};
  const testOut = h('div', { class: 'small' });
  let keys = { ...meta.keys };

  function preset() { return meta.presets.find((p) => p.id === f.provider); }

  function draw() {
    const p = preset();
    const keyState = keys[f.provider];
    const datalist = h('datalist', { id: 'model-options' }, ...(p?.models || []).map((m) => h('option', { value: m })));
    const keyInput = h('input', { type: 'password', 'aria-label': `${p?.name || ''} API Key`, autocomplete: 'off' });
    const kindSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '选手类型' }, ...[['model', 'AI 模型'], ['agent', '自带 Agent'], ['builtin', '内置 AI']].map(([v, l]) => h('button', { type: 'button', class: f.kind === v ? 'on' : '', ...pressed(f.kind === v), onclick: () => { f.kind = v; draw(); } }, l)));
    body.replaceChildren(
      base ? h('div', { class: 'small muted' }, `从「${base.name}」派生：可以修改配置，积分从头算。`) : kindSeg,
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, '名字'), refs.name = h('input', { type: 'text', value: f.name, maxlength: 24, required: true, placeholder: '例如：深思小鹿', oninput: (e) => { f.name = e.target.value; } })),
        h('div', { class: 'field' }, h('span', {}, '头像'), h('div', { class: 'emoji-pick', role: 'group', 'aria-label': '头像' }, ...[...(f.avatar && /\p{Extended_Pictographic}/u.test(f.avatar) && !EMOJIS.slice(0, PICKABLE_EMOJIS).includes(f.avatar) ? [f.avatar] : []), ...EMOJIS.slice(0, PICKABLE_EMOJIS)].map((e) => h('button', { type: 'button', class: f.avatar === e ? 'on' : '', ...pressed(f.avatar === e), onclick: () => { f.avatar = e; draw(); } }, e)))),
      ),
      f.kind === 'model' ? [
        h('div', { class: 'grid2' },
          h('label', { class: 'field' }, h('span', {}, '平台'),
            h('select', { onchange: (e) => { f.provider = e.target.value; f.model = preset()?.models[0] || ''; f.base_url = ''; if (f.effort === 'off' && !preset()?.canDisableThinking) f.effort = 'low'; if (f.provider === 'ollama') f.effort = 'off'; draw(); } },
              ...meta.presets.map((x) => h('option', { value: x.id, selected: x.id === f.provider }, `${x.name}${keys[x.id] === 'none' ? '（未配置密钥）' : ''}`)))),
          h('label', { class: 'field' }, h('span', {}, '模型 ID'),
            h('div', { class: 'keyline' },
              refs.model = h('input', { type: 'text', value: f.model, list: 'model-options', required: true, placeholder: `例如：${p?.models?.[0] || 'deepseek-chat'}`, oninput: (e) => { f.model = e.target.value; } }), datalist,
              h('button', { class: 'btn sm', type: 'button', title: '从接口获取可用模型', onclick: guard(async () => {
                const r = await post('/provider-models', { provider: f.provider, baseURL: f.base_url || '' });
                datalist.replaceChildren(...r.models.map((m) => h('option', { value: m })));
                toast(`获取到 ${r.models.length} 个模型`);
              }) }, '列表'))),
        ),
        keyState === 'none' ? h('div', { class: 'field' }, h('span', {}, `${p.name} API Key`),
          h('div', { class: 'keyline' }, keyInput, h('button', { class: 'btn sm', type: 'button', onclick: guard(async () => {
            if (!keyInput.value.trim()) return;
            const r = await post('/keys', { provider: f.provider, key: keyInput.value.trim() });
            keys = r.keys; meta.keys = r.keys; reloadMeta?.(); toast('密钥已加密保存'); draw();
          }) }, '保存'))) : null,
        p.customBaseURL ? h('label', { class: 'field' }, h('span', {}, '接口地址'),
          refs.base = h('input', { type: 'text', value: f.base_url || '', placeholder: `例如：${p.baseURL || 'https://api.example.com/v1'}`, oninput: (e) => { f.base_url = e.target.value; } }),
          p.note ? h('span', {}, p.note) : null) : null,
        !p.ranked ? h('div', { class: 'small muted' }, '这个平台的选手只能下娱乐赛，不参加排位。') : null,
        h('div', { class: 'field' }, h('span', {}, '推理强度'),
          h('div', { class: 'seg', role: 'group', 'aria-label': '推理强度' }, ...Object.entries(meta.efforts).filter(([v]) => v !== 'off' || p.canDisableThinking).map(([v, l]) => h('button', { type: 'button', class: f.effort === v ? 'on' : '', ...pressed(f.effort === v), onclick: () => { f.effort = v; draw(); } }, l)))),
        h('label', { class: 'field' }, h('span', {}, '风格'),
          h('textarea', { maxlength: 300, placeholder: `例如：${STYLE_EXAMPLES[Math.floor(Math.random() * STYLE_EXAMPLES.length)]}`, oninput: (e) => { f.style = e.target.value; } }, f.style || '')),
        h('div', { class: 'row', style: { gap: '20px' } },
          h('label', { class: 'switch', title: '每盘结束后写一句复盘笔记，下一盘带上最近 5 条' }, h('input', { type: 'checkbox', checked: f.memory, onchange: (e) => { f.memory = e.target.checked; } }), '跨局记忆'),
          h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: f.show_legal, onchange: (e) => { f.show_legal = e.target.checked; } }), '提供合法着法列表')),
      ] : f.kind === 'agent' ? [
        h('div', { class: 'note' }, '这只蛐蛐背后是你自己的 Agent（Claude Code、Codex 或你写的程序）：轮到它时，Agent 用接入令牌来领回合、想好后提交。思考、记忆都由 Agent 自己负责。Agent 蛐蛐在单独的 Agent 天梯排名，只在 Agent 在线时参加自动匹配。'),
        h('label', { class: 'field' }, h('span', {}, '每步限时（秒）'), h('input', { type: 'number', min: 30, max: 900, value: f.agent_timeout || 180, oninput: (e) => { f.agent_timeout = Number(e.target.value); } }),
          h('span', {}, '限时内没来领回合判负；领了没交按无效处理（最多重来 3 次）。')),
      ] : h('label', { class: 'field' }, h('span', {}, '搜索深度'),
        h('div', { class: 'seg', role: 'group', 'aria-label': '搜索深度' }, ...[[1, '1 层'], [2, '2 层'], [3, '3 层'], [4, '4 层']].map(([v, l]) => h('button', { type: 'button', class: f.level === v ? 'on' : '', ...pressed(f.level === v), onclick: () => { f.level = v; draw(); } }, l)))),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', {}, '每天主动参加的对局上限'), h('input', { type: 'number', min: 1, max: meta.maxDailyLimit, value: f.daily_limit, oninput: (e) => { f.daily_limit = Number(e.target.value); } })),
        h('label', { class: 'field' }, h('span', {}, '每日 token 上限'), h('input', { type: 'number', min: 1000, step: 10000, value: f.daily_tokens || '', placeholder: '不限', oninput: (e) => { f.daily_tokens = e.target.value ? Number(e.target.value) : null; } })),
      ),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: f.auto_match, onchange: (e) => { f.auto_match = e.target.checked; } }), '参加天梯自动匹配'),
      f.kind === 'model' ? h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: guard(async () => {
        testOut.replaceChildren(h('span', { class: 'muted' }, '测试中…'));
        const r = await post('/test-config', { provider: f.provider, model: f.model, base_url: f.base_url, effort: f.effort });
        testOut.replaceChildren(r.ok
          ? h('span', {}, h('span', { class: 'chip good' }, `连接成功 · ${fmtMs(r.latencyMs)}`), ' ', r.text)
          : h('span', { class: 'chip bad' }, r.error));
      }) }, '测试连接'), testOut) : null,
    );
  }
  draw();

  const dlg = dialog(base ? '派生一只新蛐蛐' : '养一只新蛐蛐', body, [
    h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, '取消'),
    h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
      // 先就地检查必填项：错在哪一栏，就在那一栏下面说，焦点移过去
      const name = (f.name || '').trim();
      if (!name) return markInvalid(refs.name, '给它起个名字');
      if (cleanName(name) !== name) return markInvalid(refs.name, '名字含无法识别的字符');
      if (f.kind === 'model' && !(f.model || '').trim()) return markInvalid(refs.model, '填一个模型 ID，或点「列表」从接口获取');
      if (f.kind === 'model' && preset()?.customBaseURL && f.provider === 'custom' && !(f.base_url || '').trim()) return markInvalid(refs.base, '自定义接口需要填写地址');
      const payload = { ...f };
      let c;
      try {
        c = base ? await post(`/characters/${base.id}/derive`, payload) : await post('/characters', payload);
      } catch (e) {
        if (/名字/.test(e.message) && refs.name) return markInvalid(refs.name, e.message);
        throw e;
      }
      dlg.close();
      toast(`已创建「${c.name}」`);
      if (c.agentToken) tokenDialog(c.name, c.agentToken);
      onDone?.(c);
    }) }, '创建'),
  ]);
}

// ---------- 选手主页 ----------

function lineChart(points) {
  const W = 520, H = 140, P = 28;
  if (points.length < 2) {
    // 空状态用 HTML：字号跟着页面走，底下一根虚线示意曲线的位置
    const n = 2 - points.length;
    return h('div', { class: 'chart-empty' }, h('i', { class: 'chart-empty-line', 'aria-hidden': 'true' }), h('p', {}, `再下 ${n} 盘排位赛就能看到积分曲线`));
  }
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('class', 'chart');
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.style.width = '100%';
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
  setTitle(cleanName(c.name), '蛐蛐');

  const settings = h('div', { class: 'col', style: { gap: '10px' } });
  let newName = null;
  const drawSettings = () => {
    if (c.system) { settings.replaceChildren(h('div', { class: 'small muted' }, '系统参照选手，用来给新选手定级，让积分有固定参照。')); return; }
    if (c.kind === 'human') {
      if (!c.mine) { settings.replaceChildren(h('div', { class: 'small muted' }, '一位真人玩家。')); return; }
      // 真人也能参加天梯自动匹配：开着网站、手上没有别的对局时才会被安排
      settings.replaceChildren(
        h('div', { class: 'small muted' }, '你自己。亲自上场时用这个角色。'),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!c.auto_match, onchange: guard(async (e) => { Object.assign(c, await patch(`/characters/${c.id}`, { auto_match: e.target.checked })); toast(e.target.checked ? '已加入自动匹配：开着网站时会给你安排排位赛' : '已退出自动匹配'); }) }), '参加天梯自动匹配'),
        h('div', { class: 'small muted' }, '打开后，只要你开着网站、手上没有别的对局，天梯就会给你安排排位赛，匹配到会弹提示带你进对局。每一步限时 10 分钟，超时由系统代打。'),
        h('div', { class: 'set-limits' },
          h('label', { class: 'field' }, h('span', {}, '每日主动对局'), h('span', { class: 'unit-input', 'data-unit': '局' }, h('input', { type: 'number', min: 1, max: meta.maxDailyLimit, value: c.daily_limit, onchange: guard(async (e) => { Object.assign(c, await patch(`/characters/${c.id}`, { daily_limit: Number(e.target.value) })); toast('已保存'); }) })))));
      return;
    }
    if (!c.mine) { settings.replaceChildren(h('div', { class: 'small muted' }, `这只蛐蛐是 ${c.owner?.name || '别人'} 养的。想和它斗，开一个组局请主人把它拉进来。`)); return; }
    settings.replaceChildren(
      c.kind === 'agent' ? h('div', { class: 'col', style: { gap: '10px' } },
        h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: `chip ${c.online ? 'good' : ''}` }, c.online ? '在线' : '离线'),
          h('span', { class: 'small muted' }, c.last_seen ? `最近来过：${fmtTime(c.last_seen)}` : 'Agent 还没有来过')),
        h('label', { class: 'field' }, h('span', {}, '每步限时（秒）'), h('input', { type: 'number', min: 30, max: 900, value: c.agent_timeout || 180, onchange: guard(async (e) => { Object.assign(c, await patch(`/characters/${c.id}`, { agent_timeout: Number(e.target.value) })); toast('已保存'); }) })),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', type: 'button', onclick: guardConfirm(() => !c.hasToken || confirmDialog({ title: '重新生成接入令牌', body: '重新生成后旧令牌立即失效，正在用旧令牌的 Agent 会断开。', okText: '重新生成', danger: true }), async () => {
            const r = await post(`/characters/${c.id}/agent-token`);
            c.hasToken = true;
            tokenDialog(c.name, r.agentToken);
          }) }, c.hasToken ? '重新生成接入令牌' : '生成接入令牌'),
          h('a', { class: 'btn sm', href: '#/agent-guide' }, '接入说明'))) : null,
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!c.auto_match, onchange: guard(async (e) => { Object.assign(c, await patch(`/characters/${c.id}`, { auto_match: e.target.checked })); toast(e.target.checked ? '已加入自动匹配' : '已退出自动匹配'); }) }), '参加天梯自动匹配'),
      h('div', { class: 'small muted' }, `打开后会主动找对手。每日上限只算主动参加的对局，最多 ${meta.maxDailyLimit} 局；被拉进组局的不计入。`),
      h('div', { class: 'set-limits' },
        h('label', { class: 'field' }, h('span', {}, '每日主动对局'), h('span', { class: 'unit-input', 'data-unit': '局' }, h('input', { type: 'number', min: 1, max: meta.maxDailyLimit, value: c.daily_limit, onchange: guard(async (e) => { Object.assign(c, await patch(`/characters/${c.id}`, { daily_limit: Number(e.target.value) })); toast('已保存'); }) }))),
        h('label', { class: 'field' }, h('span', {}, '每日 token'), h('span', { class: 'unit-input', 'data-unit': 'tokens' }, h('input', { type: 'number', min: 1000, step: 10000, value: c.daily_tokens || '', placeholder: '不限', onchange: guard(async (e) => { Object.assign(c, await patch(`/characters/${c.id}`, { daily_tokens: e.target.value ? Number(e.target.value) : null })); toast('已保存'); }) })))),
      h('div', { class: 'set-actions' },
        c.kind === 'model' ? h('button', { class: 'btn sm', type: 'button', onclick: guard(async () => {
          const t = await post(`/characters/${c.id}/test`);
          toast(t.ok ? `连接成功：${t.text}` : t.error, !t.ok);
        }) }, '测试连接') : null,
        h('button', { class: 'btn sm', type: 'button', onclick: () => createDialog({ meta, reloadMeta, base: c, onDone: (n) => go(`#/characters/${n.id}`) }) }, '派生新蛐蛐'),
        h('button', { class: 'btn sm', type: 'button', onclick: guardConfirm(async () => {
          newName = await promptDialog({ title: '改名', label: '新名字', value: cleanName(c.name), maxlength: 24, okText: '改名' });
          return !!newName && newName !== c.name;
        }, async () => {
          Object.assign(c, await patch(`/characters/${c.id}`, { name: newName }));
          profileView(root, id, { meta, go, reloadMeta });
        }) }, '改名'),
        h('button', { class: `btn sm ${c.archived ? '' : 'ghost danger'}`, type: 'button', onclick: guardConfirm(() => confirmDialog(c.archived
          ? { title: '恢复蛐蛐', body: `恢复「${cleanName(c.name)}」？它会重新出现在列表和排行榜里。`, okText: '恢复' }
          : { title: '归档蛐蛐', body: `归档后「${cleanName(c.name)}」不再出现在列表和排行榜里，历史对局保留。`, okText: '归档', danger: true }), async () => {
          await patch(`/characters/${c.id}`, { archived: !c.archived });
          go('#/characters');
        }) }, c.archived ? '恢复' : '归档')),
    );
  };
  drawSettings();

  const m = p.metrics;
  const tags = Object.entries(m.tags || {});
  // 复盘笔记：连着好几条一模一样的合成一条「×N」
  const notes = [];
  for (const n of p.notes) {
    const last = notes[notes.length - 1];
    if (last && last.text === n.text) { last.n++; last.oldest = n.created_at; } else notes.push({ ...n, n: 1, oldest: n.created_at });
  }
  const RESULT = { w: ['胜', 'good'], d: ['和', ''], l: ['负', 'bad'] };
  const PAGE = 20;
  let shownMatches = PAGE;
  const matchBox = h('div');
  const matchRow = (x) => {
    const s = mySeat(x);
    const oppNames = Object.entries(x.players).filter(([seat]) => seat !== s).map(([, pl]) => pl?.name);
    const opp = summarizeSeats(oppNames);
    const o = x.status === 'running' ? null : x.result?.aborted ? null : seatOutcome(x.result, s);
    const res = x.status === 'running' ? h('span', { class: 'chip' }, '进行中') : x.result?.aborted ? h('span', { class: 'chip', title: resultText(x) }, '中止') : h('span', { class: `chip res ${RESULT[o][1]}`, title: resultText(x) }, RESULT[o][0]);
    const resText = x.status === 'running' ? '进行中' : x.result?.aborted ? '中止' : RESULT[o][0];
    const seatLabel = String(x.seatNames?.[s] || s || '').replace(/号位$/, '号');
    const delta = x.rating_changes?.[c.id]?.delta;
    return linkRow(`#/match/${x.id}`, [
      h('td', { class: 'muted' }, fmtTime(x.created_at)), h('td', { title: oppNames.map(cleanName).join('、') }, oppNames.length ? opp : '—'),
      h('td', {}, h('span', { class: 'chip' }, x.gameName), ' ', h('span', { class: 'small muted' }, seatLabel)),
      h('td', {}, MODE_NAMES[x.mode]), h('td', {}, res),
      h('td', { class: 'num' }, delta === undefined ? '' : h('span', { style: { color: delta >= 0 ? 'var(--good)' : 'var(--bad)' } }, delta >= 0 ? `+${delta}` : delta))],
    { label: `${fmtTime(x.created_at)} ${x.gameName} 对 ${opp}：${resText}` });
  };
  const drawMatches = () => {
    matchBox.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'list recent-matches' },
      h('tr', {}, h('th', {}, '时间'), h('th', {}, '对手'), h('th', {}, '游戏 · 座位'), h('th', {}, '模式'), h('th', {}, '结果'), h('th', { class: 'num' }, '积分')),
      ...p.matches.slice(0, shownMatches).map(matchRow))),
    p.matches.length > shownMatches ? h('div', { class: 'more-row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { shownMatches += PAGE; drawMatches(); } }, `加载更多（还有 ${p.matches.length - shownMatches} 盘）`)) : null);
  };
  if (p.matches.length) drawMatches();
  root.replaceChildren(h('div', { class: 'profile' },
    h('div', { class: 'col' },
      h('div', { class: 'card pad col' },
        h('div', { class: 'row' }, avatar(c, 'lg'), h('div', { class: 'grow' }, h('h1', { class: 'h2' }, cleanName(c.name)), h('div', { class: 'small muted' }, modelLine(c)), c.effortName && c.kind === 'model' ? h('div', { class: 'small muted' }, `推理强度：${c.effortName}${c.memory ? ' · 跨局记忆' : ''}${c.show_legal ? '' : ' · 不提供合法着法'}`) : null)),
        c.style ? h('div', { class: 'note' }, c.style) : null,
        h('div', { class: 'row' }, tierBadge(r.tier), h('b', { style: { fontSize: '20px' } }, `${r.points}`), h('span', { class: 'small muted' }, `最高 ${Math.round(r.peak)}`)),
        h('div', { class: 'label' }, `排位战绩 · ${g.name}`),
        h('div', { class: 'stat-grid' },
          h('div', { class: 'stat' }, h('b', {}, r.wins), h('small', {}, '胜')),
          h('div', { class: 'stat' }, h('b', {}, r.draws), h('small', {}, '和')),
          h('div', { class: 'stat' }, h('b', {}, r.losses), h('small', {}, '负'))),
        h('div', { class: 'small muted' }, `今日已下 ${p.today.games}/${c.daily_limit} 盘 · ${fmtTokens(p.today.tokens)} tokens · 创建于 ${fmtTime(c.created_at)}`),
        c.parent_id ? h('a', { class: 'small', href: `#/characters/${c.parent_id}` }, '查看派生来源') : null,
      ),
      h('div', { class: 'card pad col' }, h('h3', {}, '设置'), settings),
      notes.length ? h('div', { class: 'card quiet pad col' }, h('h3', {}, '复盘笔记'), ...notes.map((n) => h('div', { class: 'note' }, n.text, h('div', { class: 'small muted' }, n.n > 1 ? `×${n.n} · ${fmtTime(n.oldest)} – ${fmtTime(n.created_at)}` : fmtTime(n.created_at))))) : null,
    ),
    h('div', { class: 'col' },
      h('div', { class: 'grid2' },
        h('div', { class: 'card pad col' }, h('h3', {}, '能力'), h('div', { style: { display: 'grid', placeItems: 'center' } }, radar(m)),
          h('div', { class: 'small muted' }, `共 ${m.moves} 步 · 平均每步 ${fmtMs(m.avgLatencyMs) || '—'} · ${fmtTokens(m.avgTokens)} tokens`),
          tags.length ? h('div', { class: 'row', style: { gap: '6px' } }, ...tags.map(([t, n]) => h('span', { class: 'chip' }, `${t} ${n}`))) : null),
        h('div', { class: 'card pad col' }, h('h3', {}, `积分曲线 · ${g.name}`), lineChart(g.history),
          p.masterpiece ? h('div', { class: 'small' }, '代表作：', h('a', { href: `#/match/${p.masterpiece.id}` }, `对 ${cleanName(Object.values(p.masterpiece.players).find((x) => x.id !== c.id)?.name)}（平均损失 ${Math.round(p.masterpiece.avgLoss * 100)}%）`)) : null),
      ),
      h('div', { class: 'card quiet' }, h('div', { class: 'pad', style: { paddingBottom: 0 } }, h('h3', {}, '交手记录')),
        p.h2h.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('tr', {}, h('th', {}, '对手'), h('th', { class: 'num' }, '胜'), h('th', { class: 'num' }, '和'), h('th', { class: 'num' }, '负')),
          ...p.h2h.map((x) => linkRow(`#/characters/${x.opponent.id}`, [h('td', {}, h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, avatar(x.opponent, 'sm'), cleanName(x.opponent.name))), h('td', { class: 'num' }, x.w), h('td', { class: 'num' }, x.d), h('td', { class: 'num' }, x.l)], { label: `${x.opponent.name}：${x.w} 胜 ${x.d} 和 ${x.l} 负` })))) : emptyState('还没有交过手。', { wm: '战', card: false })),
      h('div', { class: 'card quiet' }, h('div', { class: 'pad', style: { paddingBottom: 0 } }, h('h3', {}, '最近对局')),
        p.matches.length ? matchBox : emptyState('还没有对局。', { wm: '局', card: false, action: c.mine && c.kind !== 'human' ? h('a', { class: 'btn primary', href: '#/new' }, '让它下一盘') : null })),
    ),
  ));
}
