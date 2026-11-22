// HTTP 接口。

import { gameList, getGame } from '../games/index.js';
import { PUZZLES } from '../games/xiangqi/puzzles.js';
import { presetList, EFFORTS } from './providers/presets.js';
import { listModels, callModel } from './providers/index.js';
import { keyStatus, setKey } from './secrets.js';
import { createCharacter, updateCharacter, getCharacter, publicCharacter, LOCKED, MAX_DAILY_LIMIT } from './characters.js';
import { leaderboard, tierFor } from './ladder/rating.js';
import { characterProfile, modelBoard } from './stats.js';
import { HttpError } from './http.js';

export function routes(router, { db, hub, arena, matchmaker, compare, evaluator, ownerId }) {
  // ---------- 基本信息 ----------
  router.get('/api/meta', () => ({
    games: gameList(),
    presets: presetList(),
    efforts: EFFORTS,
    keys: keyStatus(db, ownerId),
    evaluator: evaluator.status(),
    ladder: matchmaker.settings(),
    allowLocalRanked: db.getSetting('allowLocalRanked', false),
    maxDailyLimit: MAX_DAILY_LIMIT,
    dev: process.env.ARENA_DEV === '1',
  }));

  router.get('/api/events', ({ req, res, query }) => {
    const chans = String(query.ch || 'lobby').split(',').filter(Boolean).slice(0, 10);
    hub.subscribe(req, res, chans);
  });

  // ---------- 密钥与设置 ----------
  router.post('/api/keys', ({ body }) => {
    if (!body.provider) throw new HttpError(400, '缺少平台');
    setKey(db, ownerId, body.provider, body.key || '');
    return { keys: keyStatus(db, ownerId) };
  });

  router.get('/api/provider-models', async ({ query }) => {
    try {
      return { models: await listModels(db, ownerId, query.provider, query.baseURL) };
    } catch (e) {
      throw new HttpError(400, `获取模型列表失败：${e.message}`);
    }
  });

  router.post('/api/settings', async ({ body }) => {
    if (body.ladder) {
      const cur = matchmaker.settings();
      const l = body.ladder;
      db.setSetting('ladder', {
        enabled: l.enabled ?? cur.enabled,
        concurrency: clamp(l.concurrency ?? cur.concurrency, 1, 8),
        maxTierGap: clamp(l.maxTierGap ?? cur.maxTierGap, 1, 7),
        samePairPerDay: clamp(l.samePairPerDay ?? cur.samePairPerDay, 1, 10),
        intervalSec: clamp(l.intervalSec ?? cur.intervalSec, 10, 3600),
        globalDailyTokens: l.globalDailyTokens ? Math.max(10000, Number(l.globalDailyTokens)) : null,
      });
    }
    if ('allowLocalRanked' in body) db.setSetting('allowLocalRanked', !!body.allowLocalRanked);
    if (body.evalMovetime) {
      evaluator.movetime = clamp(body.evalMovetime, 50, 5000);
      db.setSetting('evalMovetime', evaluator.movetime);
    }
    if (body.reloadEngine) await evaluator.init();
    return { ladder: matchmaker.settings(), allowLocalRanked: db.getSetting('allowLocalRanked', false), evaluator: evaluator.status() };
  });

  // ---------- 选手 ----------
  router.get('/api/characters', ({ query }) => {
    const rows = db.all('SELECT * FROM characters WHERE archived = ? ORDER BY system, created_at', query.archived === '1' ? 1 : 0);
    const game = query.game || 'xiangqi';
    return rows.map((c) => ({ ...publicCharacter(db, c), tier: tierFor(db, c.id, game), today: arena.todayUsage(c.id) }));
  });

  router.post('/api/characters', ({ body }) => publicCharacter(db, createCharacter(db, ownerId, body)));

  router.get('/api/characters/:id', ({ params }) => {
    const c = getCharacter(db, params.id);
    return { character: publicCharacter(db, c), ...characterProfile(db, arena, c) };
  });

  router.patch('/api/characters/:id', ({ params, body }) => publicCharacter(db, updateCharacter(db, params.id, body)));

  /** 派生：复制配置，可修改锁定字段，积分从头算 */
  router.post('/api/characters/:id/derive', ({ params, body }) => {
    const c = getCharacter(db, params.id);
    const base = Object.fromEntries(LOCKED.map((k) => [k, c[k]]));
    const n = createCharacter(db, ownerId, { ...base, daily_limit: c.daily_limit, ...body, parent_id: c.id, name: body.name || `${c.name}·新` });
    return publicCharacter(db, n);
  });

  /** 测试连接：发一句简短的话 */
  router.post('/api/characters/:id/test', async ({ params }) => {
    const c = getCharacter(db, params.id);
    if (c.kind !== 'model') return { ok: true, text: '无需测试' };
    const t0 = Date.now();
    try {
      const r = await callModel(db, c, '你是一名中国象棋棋手。', [{ role: 'user', content: '用一句话（不超过 20 字）介绍你自己的棋风。' }]);
      return { ok: true, text: r.text.trim().slice(0, 200), reasoning: r.reasoning?.slice(0, 300) || '', model: r.model, latencyMs: Date.now() - t0, usage: r.usage };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /** 测试尚未创建的配置 */
  router.post('/api/test-config', async ({ body }) => {
    const c = { ...body, owner_id: ownerId, kind: 'model' };
    const t0 = Date.now();
    try {
      const r = await callModel(db, c, '你是一名中国象棋棋手。', [{ role: 'user', content: '用一句话（不超过 20 字）介绍你自己的棋风。' }]);
      return { ok: true, text: r.text.trim().slice(0, 200), reasoning: r.reasoning?.slice(0, 300) || '', model: r.model, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---------- 排行榜 ----------
  router.get('/api/leaderboard', ({ query }) => {
    const game = query.game || 'xiangqi';
    getGame(game);
    if (query.view === 'models') return modelBoard(db, game);
    return leaderboard(db, game);
  });

  router.get('/api/ladder', () => ({
    settings: matchmaker.settings(),
    log: matchmaker.lastLog,
    eligible: matchmaker.eligible().map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, today: c.usage.games, limit: c.daily_limit, system: c.system })),
    running: matchmaker.runningRanked(),
  }));

  router.post('/api/ladder/run', async () => ({ matchId: await matchmaker.tick({ force: true }) }));

  // ---------- 对局 ----------
  router.get('/api/matches', ({ query }) => {
    const limit = Math.min(200, Number(query.limit) || 50);
    let rows = db.all('SELECT id FROM matches ORDER BY created_at DESC LIMIT ?', limit * 3);
    if (query.status) rows = rows.filter((r) => db.get('SELECT status FROM matches WHERE id = ?', r.id).status === query.status);
    return rows.slice(0, limit).map((r) => arena.summary(r.id));
  });

  router.post('/api/matches', ({ body }) => ({ id: arena.createMatch(body) }));

  router.get('/api/matches/:id', ({ params }) => arena.detail(params.id));

  router.post('/api/matches/:id/move', ({ params, body }) => {
    arena.humanMove(params.id, String(body.action || ''));
    return { ok: true };
  });

  router.post('/api/matches/:id/control', ({ params, body }) => arena.control(params.id, body.op));

  router.get('/api/matches/:id/export', ({ params, res }) => {
    const d = arena.detail(params.id);
    const lines = [
      `【对局】${d.id}`,
      `【红方】${d.players.r?.name}  【黑方】${d.players.b?.name}`,
      `【模式】${{ casual: '娱乐赛', ranked: '排位赛', placement: '定级赛' }[d.mode]}  【时间】${d.created_at}`,
      `【起始局面】${d.startFen}`,
      '',
    ];
    const mv = d.view.moves;
    for (let i = 0; i < mv.length; i += 2) {
      lines.push(`${String(i / 2 + 1).padStart(3)}. ${mv[i].cn.padEnd(6, '　')}${mv[i + 1] ? mv[i + 1].cn : ''}`);
    }
    lines.push('', `【结果】${d.result ? (d.result.winner ? `${d.seatNames[d.result.winner]}胜` : d.result.aborted ? '中止' : '和棋') + `（${d.result.reason}）` : '进行中'}`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${d.id}.txt"` });
    res.end(lines.join('\n'));
  });

  // ---------- 同题对比 ----------
  router.get('/api/puzzles', () => PUZZLES.map((p) => {
    const g = getGame('xiangqi');
    const s = p.fen ? g.create({ fen: p.fen }) : g.replay(undefined, p.moves);
    return { ...p, fen: g.fen(s) };
  }));
  router.get('/api/compares', () => compare.list());
  router.post('/api/compares', ({ body }) => ({ id: compare.create(body) }));
  router.get('/api/compares/:id', ({ params }) => compare.detail(params.id));

  void hub;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v) || lo));
}
