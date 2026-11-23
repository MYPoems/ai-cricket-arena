// 账号系统：注册（庄家审批后生效）、登录会话、权限。
//
// - 庄家（管理员）是原来的本机用户 local，登录名默认 admin（ARENA_ADMIN_USER 可改）。
//   第一次启动时如果还没有密码：用 ARENA_ADMIN_PASSWORD，其次沿用旧的网站访问密码 ARENA_PASSWORD，
//   都没有就随机生成，写进数据目录的 admin-initial-password.txt（只在本机）。
// - 新用户注册后状态是 pending，庄家在「管理」页通过后才能登录。
// - 密码用 scrypt 加盐哈希；会话令牌只存 SHA-256，Cookie 为 HttpOnly + SameSite=Lax（https 时加 Secure）。

import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, now } from './db.js';
import { HttpError } from './http.js';

export const ADMIN_ID = 'local';
const COOKIE = 'dsqq_sid';
const SESSION_DAYS = 30;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return got.length === want.length && timingSafeEqual(got, want);
}

const USERNAME_RE = /^[A-Za-z0-9_一-龥]{2,20}$/;
function checkCredentials(username, password) {
  if (!USERNAME_RE.test(String(username || ''))) throw new HttpError(400, '用户名 2–20 个字，只能用中文、字母、数字和下划线');
  if (String(password || '').length < 8) throw new HttpError(400, '密码至少 8 位');
  if (String(password).length > 200) throw new HttpError(400, '密码太长');
}

/** 第一次启动：把本机用户 local 设成庄家，并给它一个登录密码 */
export function ensureAdmin(db, dataDir) {
  const u = db.get('SELECT * FROM users WHERE id = ?', ADMIN_ID);
  const patch = {};
  if (u.role !== 'admin') patch.role = 'admin';
  if (u.status !== 'active') patch.status = 'active';
  if (!u.username) patch.username = process.env.ARENA_ADMIN_USER || 'admin';
  if (!u.name || u.name === '我') patch.name = '庄家';
  let generated = null;
  if (!u.pass_hash) {
    const pw = process.env.ARENA_ADMIN_PASSWORD || process.env.ARENA_PASSWORD || (generated = randomBytes(12).toString('base64url'));
    patch.pass_hash = hashPassword(pw);
  }
  if (Object.keys(patch).length) db.update('users', { id: ADMIN_ID }, patch);
  if (generated) {
    const file = join(dataDir, 'admin-initial-password.txt');
    writeFileSync(file, `庄家账号：${patch.username || u.username}\n初始密码：${generated}\n登录后请在「我的账号」里修改密码，然后删除这个文件。\n`, { mode: 0o600 });
    console.log(`已生成庄家账号的初始密码，见 ${file}`);
  }
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, name: u.name, role: u.role, status: u.status, created_at: u.created_at };
}

// ---------- 会话 ----------

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || !!req.socket?.encrypted;

function setCookie(req, res, value, maxAgeSec) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.insert('sessions', { id: sha(token), user_id: userId, created_at: now(), expires_at: expires });
  return token;
}

/** 从 Cookie 找出登录用户（必须是已通过的账号）；找不到返回 null */
export function userFromRequest(db, req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const s = db.get('SELECT * FROM sessions WHERE id = ?', sha(token));
  if (!s) return null;
  if (Date.parse(s.expires_at) < Date.now()) { db.run('DELETE FROM sessions WHERE id = ?', s.id); return null; }
  const u = db.get('SELECT * FROM users WHERE id = ?', s.user_id);
  return u && u.status === 'active' ? u : null;
}

// ---------- 限速（登录、注册） ----------

const hits = new Map();
function limit(key, max, windowMs) {
  if (process.env.ARENA_DEV === '1' && !process.env.ARENA_TEST_LIMIT) return; // 本机开发模式不限流
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) throw new HttpError(429, '操作太频繁，请稍后再试');
  arr.push(t);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
}
const ipOf = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

// ---------- 路由 ----------

export function authRoutes(router, { db, hub, onApproved }) {
  router.get('/api/auth/me', ({ req }) => {
    const u = req.user;
    return {
      user: publicUser(u),
      pending: u?.role === 'admin' ? db.get("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").n : 0,
      publicView: db.getSetting('publicView', true),
    };
  }, { auth: 'any' });

  router.post('/api/auth/register', ({ req, body }) => {
    limit(`reg:${ipOf(req)}`, 5, 3600e3);
    const username = String(body.username || '').trim();
    checkCredentials(username, body.password);
    if (db.get('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, '这个用户名已经被用了');
    const note = String(body.note || '').trim().slice(0, 200);
    const id = newId('u');
    db.insert('users', { id, name: username, username, pass_hash: hashPassword(body.password), role: 'user', status: 'pending', note, created_at: now() });
    hub.emit('admin', { type: 'registration', user: { id, username, note } });
    return { ok: true, status: 'pending' };
  }, { auth: 'any' });

  router.post('/api/auth/login', ({ req, res, body }) => {
    const username = String(body.username || '').trim();
    limit(`login:${ipOf(req)}`, 10, 600e3);
    limit(`login-u:${username}`, 10, 600e3);
    const u = db.get('SELECT * FROM users WHERE username = ?', username);
    if (!u || !verifyPassword(body.password, u.pass_hash)) throw new HttpError(401, '用户名或密码不对');
    if (u.status === 'pending') throw new HttpError(403, '注册申请还在等庄家审批');
    if (u.status === 'rejected') throw new HttpError(403, '注册申请没有通过');
    if (u.status !== 'active') throw new HttpError(403, '账号已停用');
    setCookie(req, res, createSession(db, u.id), SESSION_DAYS * 86400);
    return { user: publicUser(u) };
  }, { auth: 'any' });

  router.post('/api/auth/logout', ({ req, res }) => {
    const token = parseCookies(req)[COOKIE];
    if (token) db.run('DELETE FROM sessions WHERE id = ?', sha(token));
    setCookie(req, res, '', 0);
    return { ok: true };
  }, { auth: 'any' });

  router.post('/api/auth/password', ({ req, body }) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(body.old, u.pass_hash)) throw new HttpError(400, '原密码不对');
    checkCredentials(u.username, body.password);
    db.update('users', { id: u.id }, { pass_hash: hashPassword(body.password) });
    // 其他设备上的登录全部失效，只留当前这个
    const token = parseCookies(req)[COOKIE];
    db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', u.id, sha(token || ''));
    return { ok: true };
  });

  // ---------- 庄家：审批与账号管理 ----------
  router.get('/api/admin/users', ({ query }) => {
    const status = ['pending', 'active', 'rejected', 'disabled'].includes(query.status) ? query.status : null;
    const rows = status ? db.all('SELECT * FROM users WHERE status = ? ORDER BY created_at DESC', status) : db.all('SELECT * FROM users ORDER BY created_at DESC');
    return rows.map((u) => ({ ...publicUser(u), note: u.note || '', reviewed_at: u.reviewed_at,
      characters: db.get('SELECT COUNT(*) AS n FROM characters WHERE owner_id = ? AND archived = 0 AND kind != ?', u.id, 'human').n }));
  }, { auth: 'admin' });

  router.post('/api/admin/users/:id/:op', ({ req, params }) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', params.id);
    if (!u) throw new HttpError(404, '用户不存在');
    if (u.id === ADMIN_ID) throw new HttpError(400, '不能修改庄家账号');
    const next = { approve: 'active', reject: 'rejected', disable: 'disabled', enable: 'active' }[params.op];
    if (!next) throw new HttpError(400, '未知操作');
    db.update('users', { id: u.id }, { status: next, reviewed_at: now(), reviewed_by: req.user.id });
    if (next !== 'active') db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    if (next === 'active') onApproved?.(u);
    hub.emit('admin', { type: 'user_updated', id: u.id, status: next });
    return { ok: true, status: next };
  }, { auth: 'admin' });
}

/** 用户能不能管理这名选手（自己的，或者庄家） */
export const canManage = (user, c) => !!user && (user.role === 'admin' || c.owner_id === user.id);
