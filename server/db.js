// 数据层：Node 内置 SQLite。表结构从一开始就按多用户设计（选手属于某个用户）。
// 上线换 PostgreSQL 时只需替换本文件里的实现。

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  cipher TEXT NOT NULL,          -- AES-256-GCM 加密后的密钥（base64：iv.tag.data）
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, provider)
);

-- 选手（AI 角色）：配置创建后锁定，只能改名字、头像和运行设置
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,
  kind TEXT NOT NULL,             -- model / builtin / random / engine / human
  provider TEXT,                  -- 预置平台 id
  base_url TEXT,
  model TEXT,
  effort TEXT,
  style TEXT NOT NULL DEFAULT '',
  memory INTEGER NOT NULL DEFAULT 0,   -- 1 = 跨局记忆（赛后复盘笔记）
  show_legal INTEGER NOT NULL DEFAULT 1,
  level INTEGER,                  -- 内置 AI 搜索深度 / 引擎限时
  parent_id TEXT,                 -- 派生自哪个选手
  system INTEGER NOT NULL DEFAULT 0,   -- 1 = 系统参照选手（随机、内置 AI、Pikafish）
  -- 运行设置（随时可改）
  auto_match INTEGER NOT NULL DEFAULT 0,
  daily_limit INTEGER NOT NULL DEFAULT 10,
  daily_tokens INTEGER,           -- 每日 token 上限，空为不限
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 每个选手在每个游戏里的积分（OpenSkill）
CREATE TABLE IF NOT EXISTS ratings (
  character_id TEXT NOT NULL,
  game TEXT NOT NULL,
  mu REAL NOT NULL,
  sigma REAL NOT NULL,
  played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  peak REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (character_id, game)
);

CREATE TABLE IF NOT EXISTS rating_history (
  character_id TEXT NOT NULL,
  game TEXT NOT NULL,
  match_id TEXT NOT NULL,
  score REAL NOT NULL,
  at TEXT NOT NULL
);

-- 对局
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  mode TEXT NOT NULL,             -- ranked / casual / placement
  status TEXT NOT NULL,           -- waiting / running / finished / aborted
  start_fen TEXT,
  setup TEXT,                     -- JSON { setup, seed, players }：重建对局用
  options TEXT NOT NULL,          -- JSON
  seats TEXT NOT NULL,            -- JSON { seat: characterId | null（玩家本人） }
  actions TEXT NOT NULL DEFAULT '[]',
  result TEXT,                    -- JSON outcome
  rating_changes TEXT,            -- JSON
  challenge TEXT,                 -- JSON { by, text }：挑战宣言
  conversations TEXT NOT NULL DEFAULT '{}', -- JSON { seat: [messages] }，用于断点续下
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

-- 每一步
CREATE TABLE IF NOT EXISTS turns (
  match_id TEXT NOT NULL,
  ply INTEGER NOT NULL,
  seat TEXT NOT NULL,
  character_id TEXT,
  action TEXT,
  label TEXT,
  analysis TEXT,
  reasoning TEXT,
  self_winrate REAL,
  eval TEXT,                      -- JSON 引擎评估：走前/走后胜率、最佳着法、损失
  attempts TEXT,                  -- JSON 不合法尝试
  usage TEXT,                     -- JSON token 用量
  latency_ms INTEGER,
  model_served TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (match_id, ply)
);

-- 跨局记忆：赛后复盘笔记
CREATE TABLE IF NOT EXISTS notes (
  character_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 同题对比
CREATE TABLE IF NOT EXISTS compares (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  title TEXT NOT NULL,
  fen TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS compare_answers (
  compare_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  status TEXT NOT NULL,
  action TEXT,
  label TEXT,
  analysis TEXT,
  reasoning TEXT,
  self_winrate REAL,
  eval TEXT,
  usage TEXT,
  latency_ms INTEGER,
  error TEXT,
  PRIMARY KEY (compare_id, character_id)
);

-- 录制任务
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  speed REAL NOT NULL,
  status TEXT NOT NULL,           -- queued / running / done / failed
  file TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_created ON matches(created_at);
CREATE INDEX IF NOT EXISTS idx_hist ON rating_history(character_id, game);
`;

export const now = () => new Date().toISOString();
export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // 旧库升级：补上后来新增的列
  const cols = new Set(db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name));
  if (!cols.has('setup')) db.exec('ALTER TABLE matches ADD COLUMN setup TEXT');
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get('local')) {
    db.prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)').run('local', '我', now());
  }
  return wrap(db);
}

const JSON_COLS = new Set(['setup', 'options', 'seats', 'actions', 'result', 'rating_changes', 'challenge', 'conversations', 'eval', 'attempts', 'usage']);

function decode(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = JSON_COLS.has(k) && typeof v === 'string' ? JSON.parse(v) : v;
  return out;
}

const encode = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

function wrap(db) {
  const cache = new Map();
  const stmt = (sql) => {
    if (!cache.has(sql)) cache.set(sql, db.prepare(sql));
    return cache.get(sql);
  };
  return {
    raw: db,
    get: (sql, ...args) => decode(stmt(sql).get(...args.map(encode))),
    all: (sql, ...args) => stmt(sql).all(...args.map(encode)).map(decode),
    run: (sql, ...args) => stmt(sql).run(...args.map(encode)),
    insert(table, obj) {
      const keys = Object.keys(obj);
      const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
      return stmt(sql).run(...keys.map((k) => encode(obj[k])));
    },
    update(table, where, obj) {
      const keys = Object.keys(obj);
      const wk = Object.keys(where);
      const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE ${wk.map((k) => `${k} = ?`).join(' AND ')}`;
      return stmt(sql).run(...keys.map((k) => encode(obj[k])), ...wk.map((k) => encode(where[k])));
    },
    tx(fn) {
      db.exec('BEGIN');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    getSetting(key, fallback) {
      const r = stmt('SELECT value FROM settings WHERE key = ?').get(key);
      return r ? JSON.parse(r.value) : fallback;
    },
    setSetting(key, value) {
      stmt('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
    },
    close: () => db.close(),
  };
}
