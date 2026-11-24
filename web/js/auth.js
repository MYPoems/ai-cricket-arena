// 登录、注册（等庄家审批）、我的账号、庄家审批页。

import { h, api, post, guard, toast, fmtTime, pageHead, emptyState, icon, markInvalid } from './ui.js';

/** 手机上不自动聚焦：一进页面就弹键盘，会把表单挤到屏幕外 */
const autoFocus = (el) => { if (matchMedia('(min-width: 761px)').matches) el.focus(); };

/** 密码框 + 显示/隐藏切换 */
function passField(input) {
  const btn = h('button', { class: 'icon-btn pw-eye', type: 'button', 'aria-label': '显示密码', title: '显示密码', 'aria-pressed': 'false' }, icon('eye', 18));
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.replaceChildren(icon(show ? 'eye-off' : 'eye', 18));
    const label = show ? '隐藏密码' : '显示密码';
    btn.setAttribute('aria-label', label); btn.title = label; btn.setAttribute('aria-pressed', String(show));
  });
  return h('span', { class: 'pw-wrap' }, input, btn);
}

const nextOf = () => decodeURIComponent(new URLSearchParams(location.hash.split('?')[1] || '').get('next') || '#/');

export async function loginView(root, { go, reloadSession, reloadMeta, session }) {
  if (session.user) { go('#/'); return; }
  const user = h('input', { type: 'text', id: 'login-user', autocomplete: 'username', required: true });
  const pass = h('input', { type: 'password', id: 'login-pass', autocomplete: 'current-password', required: true });
  const submit = guard(async (e) => {
    e?.preventDefault();
    await post('/auth/login', { username: user.value.trim(), password: pass.value });
    await reloadSession();
    await reloadMeta();
    // 整页重新加载：实时事件订阅要按新的登录状态重新建立
    const next = nextOf();
    location.hash = next.startsWith('#/login') || next.startsWith('#/register') ? '#/' : next;
    location.reload();
  });
  root.replaceChildren(h('div', { class: 'auth' }, h('form', { class: 'card framed auth-card', onsubmit: submit },
    h('span', { class: 'wm', 'aria-hidden': 'true' }, '斗'),
    h('div', { class: 'row', style: { gap: '14px' } }, h('span', { class: 'seal', style: { width: '44px', height: '44px', fontSize: '26px' } }, '斗'), h('h1', {}, '入场')),
    h('div', { class: 'small muted' }, '登录后可以养自己的 AI 蛐蛐、组局、开局。'),
    h('label', { class: 'field' }, h('span', {}, '用户名'), user),
    h('label', { class: 'field' }, h('span', {}, '密码'), passField(pass)),
    h('button', { class: 'btn primary lg', type: 'submit' }, '登录'),
    h('div', { class: 'switcher' }, '还没有账号？', h('a', { href: '#/register' }, '申请注册')),
    session.publicView ? h('div', { class: 'switcher' }, h('a', { href: '#/' }, '先随便看看（游客观战）')) : null)));
  autoFocus(user);
}

export async function registerView(root, { go, session }) {
  if (session.user) { go('#/'); return; }
  const user = h('input', { type: 'text', id: 'reg-user', autocomplete: 'username', placeholder: '2–20 个字：中文、字母、数字、下划线', maxlength: 20 });
  const pass = h('input', { type: 'password', id: 'reg-pass', autocomplete: 'new-password', placeholder: '至少 8 位' });
  const pass2 = h('input', { type: 'password', id: 'reg-pass2', autocomplete: 'new-password' });
  const note = h('textarea', { id: 'reg-note', maxlength: 200, placeholder: '选填：告诉庄家你是谁、想用哪些模型来斗（最多 200 字）' });
  const card = h('form', { class: 'card framed auth-card' });
  card.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    if (pass.value !== pass2.value) { markInvalid(pass2, '两次输入的密码不一样'); return; }
    await post('/auth/register', { username: user.value.trim(), password: pass.value, note: note.value.trim() });
    card.replaceChildren(h('span', { class: 'wm', 'aria-hidden': 'true' }, '候'), h('h1', {}, '已提交'),
      h('div', { class: 'ok' }, `申请已经交给庄家。审批通过后，用「${user.value.trim()}」和刚才的密码登录即可。`),
      h('a', { class: 'btn', href: '#/login' }, '去登录页'));
  }));
  card.append(
    h('span', { class: 'wm', 'aria-hidden': 'true' }, '入'),
    h('h1', {}, '申请入场'),
    h('div', { class: 'small muted' }, '注册需要庄家审批，通过后就能登录。'),
    h('label', { class: 'field' }, h('span', {}, '用户名'), user),
    h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', {}, '密码'), pass), h('label', { class: 'field' }, h('span', {}, '确认密码'), pass2)),
    h('label', { class: 'field' }, h('span', {}, '给庄家的话'), note),
    h('button', { class: 'btn primary lg', type: 'submit' }, '提交申请'),
    h('div', { class: 'switcher' }, '已经有账号？', h('a', { href: '#/login' }, '登录')));
  root.replaceChildren(h('div', { class: 'auth' }, card));
  autoFocus(user);
}

export async function accountView(root, { session }) {
  const u = session.user;
  const old = h('input', { type: 'password', id: 'pw-old', autocomplete: 'current-password', required: true });
  const pw = h('input', { type: 'password', id: 'pw-new', autocomplete: 'new-password', minlength: 8, required: true, placeholder: '至少 8 位' });
  const pw2 = h('input', { type: 'password', id: 'pw-new2', autocomplete: 'new-password', required: true });
  const d = u.created_at ? new Date(u.created_at) : null;
  const since = d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` : '—';
  root.replaceChildren(pageHead('我的账号', `${u.role === 'admin' ? '管理员（庄家）' : '玩家'} · 注册于 ${since}`, '我'),
    h('div', { class: 'account-grid' },
      h('form', { class: 'card framed col', onsubmit: guard(async (e) => {
        e.preventDefault();
        if (pw.value.length < 8) { markInvalid(pw, '新密码至少 8 位'); return; }
        if (pw.value !== pw2.value) { markInvalid(pw2, '两次输入的新密码不一样'); return; }
        await post('/auth/password', { old: old.value, password: pw.value });
        old.value = ''; pw.value = ''; pw2.value = '';
        toast('密码已修改，其他设备上的登录已退出');
      }) },
        h('h2', {}, '修改密码'),
        h('label', { class: 'field' }, h('span', {}, '原密码'), passField(old)),
        h('label', { class: 'field' }, h('span', {}, '新密码'), passField(pw)),
        h('label', { class: 'field' }, h('span', {}, '确认新密码'), passField(pw2)),
        h('div', {}, h('button', { class: 'btn primary', type: 'submit' }, '保存新密码'))),
      h('div', { class: 'card pad row', style: { justifyContent: 'space-between', alignSelf: 'start' } },
        h('div', {}, h('div', { class: 'label' }, '当前登录'), h('b', {}, `${u.name}（${u.username}）`)),
        h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
          await post('/auth/logout'); location.hash = '#/'; location.reload();
        }) }, icon('logout', 16), '退出登录'))));
}

const STATUS = { pending: ['待审批', 'warn'], active: ['已通过', 'good'], rejected: ['已拒绝', ''], disabled: ['已停用', 'bad'] };

export async function adminView(root, { reloadSession }) {
  let status = 'pending';
  const body = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '用户分类' });
  async function draw() {
    const users = await api(`/admin/users${status === 'all' ? '' : `?status=${status}`}`);
    tabs.replaceChildren(...[['pending', '待审批'], ['active', '已通过'], ['all', '全部']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': status === k ? 'true' : 'false', class: status === k ? 'on' : '', onclick: guard(async () => { status = k; await draw(); }) }, l)));
    const act = (u, op, label, cls = 'btn sm') => h('button', { class: cls, type: 'button', onclick: guard(async () => {
      await post(`/admin/users/${u.id}/${op}`);
      toast(`${u.username}：${label}`);
      await reloadSession();
      draw();
    }) }, label);
    body.replaceChildren(users.length ? h('div', { class: 'card table-wrap' }, h('table', { class: 'list' },
      h('tr', {}, h('th', {}, '用户名'), h('th', {}, '申请时间'), h('th', {}, '给庄家的话'), h('th', {}, '状态'), h('th', { class: 'num' }, '蛐蛐'), h('th', {}, '')),
      ...users.map((u) => {
        const [sl, sc] = STATUS[u.status] || [u.status, ''];
        return h('tr', {},
          h('td', {}, h('b', {}, u.username), u.role === 'admin' ? h('span', { class: 'chip gold', style: { marginLeft: '8px' } }, '庄家') : null),
          h('td', { class: 'muted' }, fmtTime(u.created_at)),
          h('td', { style: { whiteSpace: 'normal', maxWidth: '360px' } }, u.note || h('span', { class: 'muted' }, '—')),
          h('td', {}, h('span', { class: `chip ${sc}` }, sl)),
          h('td', { class: 'num' }, u.characters),
          h('td', {}, u.role === 'admin' ? null : h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
            u.status === 'pending' ? [act(u, 'approve', '通过', 'btn sm primary'), act(u, 'reject', '拒绝')] : null,
            u.status === 'active' ? act(u, 'disable', '停用') : null,
            u.status === 'disabled' || u.status === 'rejected' ? act(u, 'enable', '恢复') : null)));
      }))) : status === 'pending'
      ? emptyState('没有待审批的申请。', { wm: '批', action: h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { status = 'all'; await draw(); }) }, '看全部用户') })
      : emptyState('没有用户。', { wm: '批' }));
  }
  root.replaceChildren(pageHead('审批', '新用户注册后在这里等你通过；通过后自动有自己的真人角色。', '批'), tabs, body);
  await draw();
}
