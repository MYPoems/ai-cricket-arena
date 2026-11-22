// API Key 加密存储：用户在界面上填写的密钥用 AES-256-GCM 加密后存进数据库。
// 主密钥来自环境变量 ARENA_SECRET；没有设置时自动生成并保存在 data/secret.key。
// 密钥永远不回传给浏览器，界面上只显示「已配置 / 未配置」。

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { now } from './db.js';
import { PRESETS } from './providers/presets.js';

let master = null;

export function initSecrets(keyFile) {
  if (process.env.ARENA_SECRET) {
    master = createHash('sha256').update(process.env.ARENA_SECRET).digest();
    return;
  }
  if (!existsSync(keyFile)) {
    mkdirSync(dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  master = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
}

function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', master, iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(blob) {
  const [iv, tag, data] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', master, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

export function setKey(db, ownerId, provider, key) {
  if (!key) {
    db.run('DELETE FROM api_keys WHERE owner_id = ? AND provider = ?', ownerId, provider);
    return;
  }
  db.run(
    'INSERT INTO api_keys (owner_id, provider, cipher, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, provider) DO UPDATE SET cipher = excluded.cipher, updated_at = excluded.updated_at',
    ownerId, provider, encrypt(key.trim()), now(),
  );
}

/** 先查用户保存的密钥，再查环境变量 */
export function getKey(db, ownerId, provider) {
  const row = db.get('SELECT cipher FROM api_keys WHERE owner_id = ? AND provider = ?', ownerId, provider);
  if (row) {
    try {
      return decrypt(row.cipher);
    } catch {
      return null; // 主密钥变了，旧密钥无法解开
    }
  }
  const env = PRESETS[provider]?.keyEnv;
  return env ? process.env[env] || null : null;
}

/** 每个平台的密钥状态：db（界面填写）/ env（环境变量）/ none */
export function keyStatus(db, ownerId) {
  const saved = new Set(db.all('SELECT provider FROM api_keys WHERE owner_id = ?', ownerId).map((r) => r.provider));
  const out = {};
  for (const [id, p] of Object.entries(PRESETS)) {
    out[id] = saved.has(id) ? 'db' : p.keyEnv && process.env[p.keyEnv] ? 'env' : p.keyEnv || p.custom ? 'none' : 'notNeeded';
  }
  return out;
}
