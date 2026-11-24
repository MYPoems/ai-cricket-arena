// 选手（AI 角色）管理。配置创建后锁定，想改模型或参数就「派生」新选手。

import { createHash, randomBytes } from 'node:crypto';
import { newId, now } from './db.js';
import { presetOf, canSetBaseURL, rankedAllowed, EFFORTS } from './providers/presets.js';
import { HttpError } from './http.js';

const AVATARS = ['🦊', '🐯', '🐼', '🦁', '🐉', '🦅', '🐺', '🦉', '🐬', '🦄', '🐢', '🐲', '🦈', '🐙', '🦚', '🐝'];

export const LOCKED = ['kind', 'provider', 'base_url', 'model', 'effort', 'style', 'memory', 'show_legal', 'level'];
export const EDITABLE = ['name', 'avatar', 'auto_match', 'daily_limit', 'daily_tokens', 'archived', 'agent_timeout'];

/** 自带 agent 选手：多久内来领过回合算在线（长轮询最长 60 秒） */
export const AGENT_ONLINE_MS = 90_000;
export const AGENT_TIMEOUT = { min: 30, max: 900, default: 180 }; // 每步限时（秒）
const clampTimeout = (v) => Math.max(AGENT_TIMEOUT.min, Math.min(AGENT_TIMEOUT.max, Number(v) || AGENT_TIMEOUT.default));

export const agentOnline = (c) => c?.kind === 'agent' && !!c.last_seen && Date.now() - Date.parse(c.last_seen) < AGENT_ONLINE_MS;
const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

/** 生成新的接入令牌（旧令牌立即失效）；返回明文，只显示这一次 */
export function issueAgentToken(db, id) {
  const c = getCharacter(db, id);
  if (c.kind !== 'agent') throw new HttpError(400, '只有 Agent 选手有接入令牌');
  const token = `pka_${randomBytes(24).toString('base64url')}`;
  db.update('characters', { id }, { agent_token: hashToken(token) });
  return token;
}

/** 按令牌找 Agent 选手；找不到返回 null */
export function agentByToken(db, token) {
  if (!token || !/^pka_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const c = db.get("SELECT * FROM characters WHERE agent_token = ? AND kind = 'agent' AND archived = 0", hashToken(token)) || null;
  // 主人的账号被停用（或还没通过审批）时，他的 agent 令牌也不能用
  if (c && ['disabled', 'rejected', 'pending'].includes(db.get('SELECT status FROM users WHERE id = ?', c.owner_id)?.status)) return null;
  return c;
}

export const MAX_DAILY_LIMIT = 50; // 平台允许的每日对局上限

export function getCharacter(db, id) {
  const c = db.get('SELECT * FROM characters WHERE id = ?', id);
  if (!c) throw new HttpError(404, '选手不存在');
  return c;
}

/** 是否能参加排位赛 */
export function canRank(db, c) {
  if (c.kind !== 'model') return true; // 系统参照选手、玩家本人、自带 agent（agent 在单独的天梯）
  if (c.provider === 'mock') return true;
  return rankedAllowed(c.provider) || (db.getSetting('allowLocalRanked', false) && c.provider === 'ollama');
}

export function publicCharacter(db, c) {
  const { agent_token: token, ...rest } = c;
  return {
    ...rest,
    ...(c.kind === 'agent' ? { hasToken: !!token, online: agentOnline(c) } : {}),
    providerName: c.provider ? presetOf(c.provider)?.name || (c.provider === 'mock' ? '模拟模型' : c.provider) : null,
    effortName: c.effort ? EFFORTS[c.effort] : null,
    ranked: canRank(db, c),
  };
}

function clean(s, max) {
  return String(s ?? '').trim().slice(0, max);
}

/** 名字里不能有乱码替换符（U+FFFD，多半是编码错了）和控制字符 */
const BAD_NAME = /[\uFFFD\u0000-\u001F\u007F-\u009F]/;
function checkName(name) {
  if (BAD_NAME.test(name)) throw new HttpError(400, '名字含无法识别的字符');
  return name;
}

export function createCharacter(db, ownerId, input, { system = false } = {}) {
  const kind = input.kind || 'model';
  if (!['model', 'agent', 'builtin', 'random', 'engine', 'human'].includes(kind)) throw new HttpError(400, '未知选手类型');
  const name = clean(input.name, 24);
  if (!name) throw new HttpError(400, '请填写选手名字');
  checkName(name);
  const c = {
    id: newId('ch'),
    owner_id: ownerId,
    name,
    avatar: clean(input.avatar, 8) || AVATARS[Math.floor(Math.random() * AVATARS.length)],
    kind,
    provider: null, base_url: null, model: null, effort: null,
    style: clean(input.style, 300),
    memory: input.memory ? 1 : 0,
    show_legal: input.show_legal === false || input.show_legal === 0 ? 0 : 1,
    level: null,
    parent_id: input.parent_id || null,
    system: system ? 1 : 0,
    auto_match: input.auto_match ? 1 : 0,
    daily_limit: Math.max(1, Math.min(MAX_DAILY_LIMIT, Number(input.daily_limit) || 10)),
    daily_tokens: input.daily_tokens ? Math.max(1000, Number(input.daily_tokens)) : null,
    archived: 0,
    created_at: now(),
  };
  if (kind === 'model') {
    const allowMock = process.env.ARENA_DEV === '1';
    if (!presetOf(input.provider) && !(allowMock && input.provider === 'mock')) throw new HttpError(400, '请选择模型平台');
    c.provider = input.provider;
    c.model = clean(input.model, 120);
    if (!c.model) throw new HttpError(400, '请填写模型 ID');
    const base = clean(input.base_url, 300);
    if (input.provider === 'custom' && !base) throw new HttpError(400, '自定义接口需要填写地址');
    const official = presetOf(input.provider)?.baseURL;
    if (base && base !== official && !canSetBaseURL(input.provider, base)) throw new HttpError(400, `${presetOf(input.provider).name}只能用官方地址；要走代理或中转请选「自定义 OpenAI 兼容接口」`);
    c.base_url = base && base !== official ? base : null;
    c.effort = EFFORTS[input.effort] ? input.effort : 'low';
    if (c.effort === 'off' && !presetOf(c.provider)?.thinkingParams?.canOff && c.provider !== 'mock') {
      throw new HttpError(400, `${presetOf(c.provider)?.name || c.provider} 不能关闭思考`);
    }
  } else if (kind === 'agent') {
    // 自带 agent：思考和记忆由 agent 自己负责；风格、跨局笔记都不用
    c.style = '';
    c.memory = 0;
    c.agent_timeout = clampTimeout(input.agent_timeout);
  } else {
    c.style = '';
    c.memory = 0;
    if (kind === 'builtin') c.level = Math.max(1, Math.min(4, Number(input.level) || 3));
    if (kind === 'engine') c.level = Math.max(50, Math.min(5000, Number(input.level) || 200)); // 每步思考毫秒数
  }
  db.insert('characters', c);
  return c;
}

export function updateCharacter(db, id, input) {
  const c = getCharacter(db, id);
  const patch = {};
  for (const k of EDITABLE) {
    if (!(k in input)) continue;
    if (k === 'name') patch.name = checkName(clean(input.name, 24)) || c.name;
    else if (k === 'avatar') patch.avatar = clean(input.avatar, 8) || c.avatar;
    else if (k === 'daily_limit') patch.daily_limit = Math.max(1, Math.min(MAX_DAILY_LIMIT, Number(input.daily_limit) || c.daily_limit));
    else if (k === 'daily_tokens') patch.daily_tokens = input.daily_tokens ? Math.max(1000, Number(input.daily_tokens)) : null;
    else if (k === 'agent_timeout') { if (c.kind === 'agent') patch.agent_timeout = clampTimeout(input.agent_timeout); }
    else patch[k] = input[k] ? 1 : 0;
  }
  const locked = LOCKED.filter((k) => k in input && input[k] !== c[k]);
  if (locked.length) throw new HttpError(400, '选手的模型配置创建后不能修改，请用「派生」创建新选手');
  if (Object.keys(patch).length) db.update('characters', { id }, patch);
  return getCharacter(db, id);
}

/** 系统参照选手和「我」：首次启动时创建 */
export function ensureSystemCharacters(db, ownerId) {
  const have = new Set(db.all('SELECT name FROM characters WHERE system = 1').map((r) => r.name));
  const defs = [
    { kind: 'random', name: '随机走子', avatar: '🎲' },
    { kind: 'builtin', name: '内置 AI · 初级', avatar: '🤖', level: 2 },
    { kind: 'builtin', name: '内置 AI · 中级', avatar: '🦾', level: 3 },
  ];
  for (const d of defs) {
    if (!have.has(d.name)) createCharacter(db, ownerId, { ...d, auto_match: 1, daily_limit: MAX_DAILY_LIMIT }, { system: true });
  }
  if (!db.get("SELECT 1 FROM characters WHERE kind = 'human' AND owner_id = ?", ownerId)) {
    createCharacter(db, ownerId, { kind: 'human', name: '我', avatar: '🙂' });
  }
}

/** 有 Pikafish 时创建「守关」选手 */
const ENGINE_CHARS = {
  pikafish: { name: 'Pikafish 守关', avatar: '🐟', game: '中国象棋' },
  rapfi: { name: 'Rapfi 守关', avatar: '⚫', game: '五子棋' },
  stockfish: { name: 'Stockfish 守关', avatar: '♞', game: '国际象棋' },
};

/** 引擎守关选手：每个可用的引擎一名，provider 字段记引擎名 */
export function ensureEngineCharacter(db, ownerId, engine = 'pikafish') {
  const def = ENGINE_CHARS[engine];
  if (!def) return;
  // 早期创建的 Pikafish 守关没有记引擎名，补上
  db.run("UPDATE characters SET provider = 'pikafish' WHERE kind = 'engine' AND system = 1 AND provider IS NULL AND name = 'Pikafish 守关'");
  if (!db.get("SELECT 1 FROM characters WHERE kind = 'engine' AND system = 1 AND provider = ?", engine)) {
    const c = createCharacter(db, ownerId, { kind: 'engine', name: def.name, avatar: def.avatar, level: 200 }, { system: true });
    db.update('characters', { id: c.id }, { provider: engine });
  }
}

/** 引擎选手只会下自己引擎对应的游戏 */
export const engineGameName = (engine) => ENGINE_CHARS[engine || 'pikafish']?.game;

export function humanCharacter(db, ownerId) {
  return db.get("SELECT * FROM characters WHERE kind = 'human' AND owner_id = ?", ownerId);
}
