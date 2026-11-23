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
import { ensureSystemCharacters, ensureEngineCharacter, createCharacter } from './characters.js';
import { authRoutes, ensureAdmin, userFromRequest, createSession, ADMIN_ID } from './auth.js';
import { roomRoutes } from './rooms.js';
import { routes } from './api.js';
import { setCliWorkRoot } from './providers/cli.js';
import { lobbyRoutes } from './lobby.js';
import { agentRoutes } from './agent-api.js';
import { Recorder } from './recorder.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
// 开发参数：--dev 启用模拟模型；--data=目录 指定数据目录；--port=端口
for (const a of process.argv.slice(2)) {
  if (a === '--dev') process.env.ARENA_DEV = '1';
  else if (a.startsWith('--data=')) process.env.ARENA_DATA = a.slice(7);
  else if (a.startsWith('--port=')) process.env.PORT = a.slice(7);
}

const DATA = resolve(ROOT, process.env.ARENA_DATA || 'data');
const ENGINES = resolve(ROOT, process.env.ARENA_ENGINES || 'engines');
const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '127.0.0.1';
const OWNER = ADMIN_ID; // 系统选手挂在庄家名下
// 本机订阅通道（Claude Code / Codex 命令行）只在服务只对本机开放时启用
process.env.ARENA_CLI = ['127.0.0.1', 'localhost', '::1'].includes(HOST) && process.env.ARENA_CLI !== '0' ? '1' : '0';

const db = openDb(join(DATA, 'arena.db'));
setCliWorkRoot(join(DATA, 'cli-work'));
initSecrets(join(DATA, 'secret.key'));
const hub = new Hub();
const aiPool = new AiPool(2);
const evaluator = new Evaluator({ enginesDir: ENGINES, aiPool, movetime: db.getSetting('evalMovetime', 300) });
const ev = await evaluator.init();
console.log(`局面评估引擎：象棋 ${ev.engines.pikafish ? 'Pikafish' : '内置 AI'}，五子棋 ${ev.engines.rapfi ? 'Rapfi' : '内置估算'}，国际象棋 ${ev.engines.stockfish ? 'Stockfish' : '内置估算'}${ev.error ? `；错误：${ev.error}` : ''}`);

ensureAdmin(db, DATA);
ensureSystemCharacters(db, OWNER);
if (ev.engines.pikafish) ensureEngineCharacter(db, OWNER, 'pikafish');
if (ev.engines.rapfi) ensureEngineCharacter(db, OWNER, 'rapfi');
if (ev.engines.stockfish) ensureEngineCharacter(db, OWNER, 'stockfish');

const arena = new Arena({ db, hub, aiPool, evaluator });
const matchmaker = new Matchmaker(arena);
const compare = new Compare(arena);
arena.onFinish = (sum) => { matchmaker.onFinished(sum); matchmaker.tick().catch(() => {}); };

const router = new Router();
authRoutes(router, { db, hub, onApproved: (u) => {
  // 审批通过：给新用户建一个「自己」的真人玩家角色
  if (!db.get("SELECT 1 FROM characters WHERE kind = 'human' AND owner_id = ?", u.id)) createCharacter(db, u.id, { kind: 'human', name: u.name || u.username, avatar: '🙂' });
} });
routes(router, { db, hub, arena, matchmaker, compare, evaluator });
roomRoutes(router, { db, hub, arena });
lobbyRoutes(router, { db, arena });
agentRoutes(router, { db, arena });
const recorder = new Recorder({ db, outDir: join(DATA, 'recordings'), baseUrl: `http://127.0.0.1:${PORT}`, sessionToken: () => createSession(db, ADMIN_ID) });
router.post('/api/matches/:id/record', ({ params, body }) => recorder.start(params.id, { speed: body.speed }));
router.get('/api/recordings', () => ({ status: recorder.status(), list: recorder.list() }));
router.get('/api/recordings/:id/file', ({ params, res }) => { recorder.send(params.id, res); });

// 字体与 MYPoetry 作品集相同，自托管（SIL OFL），不依赖外部字体服务
const FONTS = join(ROOT, 'node_modules', '@fontsource-variable');
const server = createServer(handler(router, [['/games/', join(ROOT, 'games')], ['/fonts/', FONTS], ['/', join(ROOT, 'web')]], {
  resolveUser: (req) => userFromRequest(db, req),
  publicView: () => db.getSetting('publicView', true), // 游客能不能观战（庄家在设置里改）
}));
server.listen(PORT, HOST, () => {
  console.log(`电子斗蛐蛐已启动：http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
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
// 兜底：单个请求或对局里的意外错误不能让整个服务退出
process.on('unhandledRejection', (err) => console.error('未处理的异步错误：', err));
process.on('uncaughtException', (err) => console.error('未捕获的错误：', err));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
