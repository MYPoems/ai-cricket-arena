// 入口：npm start

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openDb } from './db.js';
import { initSecrets } from './secrets.js';
import { Router, handler, Hub } from './http.js';
import { AiPool } from './ai-worker.js';
import { Evaluator } from './evaluator.js';
import { Arena } from './arena.js';
import { Matchmaker } from './ladder/matchmaker.js';
import { Compare } from './compare.js';
import { ensureSystemCharacters, ensureEngineCharacter } from './characters.js';
import { routes } from './api.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

const DATA = resolve(ROOT, process.env.ARENA_DATA || 'data');
const ENGINES = resolve(ROOT, process.env.ARENA_ENGINES || 'engines');
const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '127.0.0.1';
const OWNER = 'local'; // 上线多用户后改为登录用户

const db = openDb(join(DATA, 'arena.db'));
initSecrets(join(DATA, 'secret.key'));
const hub = new Hub();
const aiPool = new AiPool(2);
const evaluator = new Evaluator({ enginesDir: ENGINES, aiPool, movetime: db.getSetting('evalMovetime', 300) });
const ev = await evaluator.init();
console.log(`局面评估：${ev.source === 'pikafish' ? 'Pikafish' : '内置 AI（engines/ 下没有找到 Pikafish）'}${ev.error ? `，错误：${ev.error}` : ''}`);

ensureSystemCharacters(db, OWNER);
if (ev.source === 'pikafish') ensureEngineCharacter(db, OWNER);

const arena = new Arena({ db, hub, aiPool, evaluator, ownerId: OWNER });
const matchmaker = new Matchmaker(arena);
const compare = new Compare(arena);
arena.onFinish = () => matchmaker.tick().catch(() => {});

const router = new Router();
routes(router, { db, hub, arena, matchmaker, compare, evaluator, ownerId: OWNER });

const server = createServer(handler(router, [['/games/', join(ROOT, 'games')], ['/', join(ROOT, 'web')]]));
server.listen(PORT, HOST, () => {
  console.log(`AI 对弈场已启动：http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  arena.resumeAll();
  matchmaker.start();
});

const shutdown = () => {
  console.log('正在关闭…');
  evaluator.stop();
  aiPool.close();
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
