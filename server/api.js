// HTTP 接口。每个请求按登录用户处理：自己的蛐蛐、自己的密钥；庄家管全局设置。

import { gameList, getGame, replay } from '../games/index.js';
import { PUZZLES } from '../games/xiangqi/puzzles.js';
import { presetList, presetOf, EFFORTS } from './providers/presets.js';
import { listModels, callModel } from './providers/index.js';
import { keyStatus, setKey } from './secrets.js';
import { createCharacter, updateCharacter, getCharacter, publicCharacter, issueAgentToken, LOCKED, MAX_DAILY_LIMIT } from './characters.js';
import { leaderboard, tierFor, poolKey } from './ladder/rating.js';
import { characterProfile, modelBoard } from './stats.js';
import { HttpError } from './http.js';
import { canManage } from './auth.js';

const ADMIN = { auth: 'admin' };

export function routes(router, { db, hub, arena, matchmaker, compare, evaluator }) {
  const isAdmin = (u) => u?.role === 'admin';
  /** 这只蛐蛐能不能由这个用户放进对局：自己的，或者系统选手 */
  const usable = (user, c) => !!c && !c.archived && (c.system || canManage(user, c));
  const mustManage = (user, c) => { if (!canManage(user, c)) throw new HttpError(403, '这不是你的蛐蛐'); return c; };

  // ---------- 基本信息 ----------
  router.get('/api/meta', ({ user }) => ({
    games: gameList(),
    // 本机订阅通道（Claude Code / Codex）只给庄家用
    presets: presetList().filter((p) => !['claude-cli', 'codex-cli'].includes(p.id) || isAdmin(user)),
    efforts: EFFORTS,
    keys: user ? keyStatus(db, user.id) : {},
    evaluator: evaluator.status(),
    ladder: matchmaker.settings(),
    allowLocalRanked: db.getSetting('allowLocalRanked', false),
    publicView: db.getSetting('publicView', true),
    maxDailyLimit: MAX_DAILY_LIMIT,
    dev: process.env.ARENA_DEV === '1',
  }), { auth: 'any' });

  router.get('/api/events', ({ req, res, query, user }) => {
    // admin 频道（注册申请）只给庄家
    const chans = String(query.ch || 'lobby').split(',').filter(Boolean).filter((c) => c !== 'admin' || isAdmin(user)).slice(0, 10);
    hub.subscribe(req, res, chans);
  });

  // ---------- 密钥与设置 ----------
  router.post('/api/keys', ({ body, user }) => {
    if (!presetOf(body.provider)) throw new HttpError(400, '未知平台');
    setKey(db, user.id, body.provider, body.key || '');
    return { keys: keyStatus(db, user.id) };
  });

  // POST：会带着已保存的密钥去请求接口地址，必须经过同源检查（GET 链接可以被别的网站诱导点开）
  router.post('/api/provider-models', async ({ body, user }) => {
    try {
      return { models: await listModels(db, user.id, body.provider, body.baseURL) };
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
    if ('publicView' in body) db.setSetting('publicView', !!body.publicView);
    if (body.evalMovetime) {
      evaluator.movetime = clamp(body.evalMovetime, 50, 5000);
      db.setSetting('evalMovetime', evaluator.movetime);
    }
    if (body.reloadEngine) await evaluator.init();
    return { ladder: matchmaker.settings(), allowLocalRanked: db.getSetting('allowLocalRanked', false), publicView: db.getSetting('publicView', true), evaluator: evaluator.status() };
  }, ADMIN);

  // ---------- 蛐蛐（选手） ----------
  /**
   * scope=mine（默认）：自己的蛐蛐 + 自己本人 + 系统选手；scope=all：所有人的蛐蛐（浏览用）。游客只看到系统选手。
   */
  router.get('/api/characters', ({ query, user }) => {
    const archived = query.archived === '1' ? 1 : 0;
    let rows = db.all('SELECT * FROM characters WHERE archived = ? ORDER BY system, created_at', archived);
    if (query.scope !== 'all') rows = rows.filter((c) => c.system || (user && c.owner_id === user.id));
    else rows = rows.filter((c) => c.kind !== 'human' || (user && c.owner_id === user.id));
    const game = query.game || 'xiangqi';
    return rows.map((c) => ({ ...publicCharacter(db, c), mine: !!user && c.owner_id === user.id, tier: tierFor(db, c.id, poolKey(game, c.kind)), today: arena.todayUsage(c.id) }));
  });

  router.post('/api/characters', ({ body, user }) => {
    if (body.kind === 'human') throw new HttpError(400, '真人玩家角色由系统为每个账号自动创建');
    if (['claude-cli', 'codex-cli'].includes(body.provider) && !isAdmin(user)) throw new HttpError(403, '本机订阅通道只有庄家可以用');
    const c = createCharacter(db, user.id, body);
    // 自带 agent：创建时生成接入令牌，明文只在这次响应里出现
    const token = c.kind === 'agent' ? issueAgentToken(db, c.id) : undefined;
    return { ...publicCharacter(db, getCharacter(db, c.id)), mine: true, ...(token ? { agentToken: token } : {}) };
  });
  // 重新生成接入令牌（旧令牌立即失效）
  router.post('/api/characters/:id/agent-token', ({ params, user }) => {
    mustManage(user, getCharacter(db, params.id));
    return { agentToken: issueAgentToken(db, params.id) };
  });

  router.get('/api/characters/:id', ({ params, user }) => {
    const c = getCharacter(db, params.id);
    const owner = db.get('SELECT id, name FROM users WHERE id = ?', c.owner_id);
    return { character: { ...publicCharacter(db, c), mine: !!user && c.owner_id === user.id, owner: c.system ? null : owner }, ...characterProfile(db, arena, c) };
  });

  router.patch('/api/characters/:id', ({ params, body, user }) => {
    mustManage(user, getCharacter(db, params.id));
    if (body.daily_limit !== undefined && Number(body.daily_limit) > MAX_DAILY_LIMIT) throw new HttpError(400, `每天主动参加的对局最多 ${MAX_DAILY_LIMIT} 局`);
    return publicCharacter(db, updateCharacter(db, params.id, body));
  });

  /** 派生：复制配置，可修改锁定字段，积分从头算（只能派生自己的蛐蛐） */
  router.post('/api/characters/:id/derive', ({ params, body, user }) => {
    const c = mustManage(user, getCharacter(db, params.id));
    const base = Object.fromEntries(LOCKED.map((k) => [k, c[k]]));
    const n = createCharacter(db, user.id, { ...base, daily_limit: c.daily_limit, ...body, parent_id: c.id, name: body.name || `${c.name}·新` });
    return publicCharacter(db, n);
  });

  /** 测试连接：发一句简短的话 */
  router.post('/api/characters/:id/test', async ({ params, user }) => {
    const c = mustManage(user, getCharacter(db, params.id));
    if (c.kind !== 'model') return { ok: true, text: '无需测试' };
    const t0 = Date.now();
    try {
      const r = await callModel(db, c, '你是一名中国象棋棋手。', [{ role: 'user', content: '用一句话（不超过 20 字）介绍你自己的棋风。' }]);
      return { ok: true, text: r.text.trim().slice(0, 200), reasoning: r.reasoning?.slice(0, 300) || '', model: r.model, latencyMs: Date.now() - t0, usage: r.usage };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /** 测试尚未创建的配置（用自己的密钥） */
  router.post('/api/test-config', async ({ body, user }) => {
    if (['claude-cli', 'codex-cli'].includes(body.provider) && !isAdmin(user)) throw new HttpError(403, '本机订阅通道只有庄家可以用');
    const c = { provider: body.provider, model: body.model, base_url: body.base_url, effort: body.effort, owner_id: user.id, kind: 'model' };
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
    if (query.view === 'agents') return leaderboard(db, poolKey(game, 'agent')); // 单独的 Agent 天梯
    return leaderboard(db, game);
  });

  router.get('/api/ladder', () => ({
    settings: matchmaker.settings(),
    log: matchmaker.lastLog,
    eligible: matchmaker.eligible().map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, today: c.usage.games, limit: c.daily_limit, system: c.system })),
    running: matchmaker.runningRanked(),
  }));

  router.post('/api/ladder/run', async () => ({ matchId: await matchmaker.tick({ force: true }) }), ADMIN);

  // ---------- 对局 ----------
  router.get('/api/matches', ({ query, user }) => {
    const limit = Math.min(200, Number(query.limit) || 50);
    const where = [];
    const args = [];
    if (query.status) { where.push('status = ?'); args.push(query.status); }
    let rows = db.all(`SELECT id, seats, created_by FROM matches ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`, ...args, query.mine === '1' ? limit * 5 : limit);
    if (query.mine === '1' && user) {
      // 我的对局：我开的，或者座位上有我的蛐蛐
      const mineIds = new Set(db.all('SELECT id FROM characters WHERE owner_id = ?', user.id).map((r) => r.id));
      rows = rows.filter((r) => r.created_by === user.id || Object.values(r.seats).some((id) => mineIds.has(id))).slice(0, limit);
    }
    return rows.map((r) => arena.summary(r.id));
  });

  /** 手动开局：座位上只能放自己的蛐蛐、自己本人和系统选手（别人的蛐蛐用的是别人的密钥，要通过组局请对方拉进来） */
  router.post('/api/matches', ({ body, user }) => {
    for (const id of Object.values(body.seats || {})) {
      const c = db.get('SELECT * FROM characters WHERE id = ?', id);
      if (!usable(user, c)) throw new HttpError(403, `${c?.name || id} 不是你的蛐蛐；想和别人的蛐蛐对局，请开一个组局邀请对方`);
    }
    if (body.mode === 'ranked' && !isAdmin(user)) {
      // 排位赛由自动匹配产生；庄家可以手动开（测试用）
      throw new HttpError(403, '排位赛由天梯自动匹配产生，手动开局只能下娱乐赛');
    }
    return { id: arena.createMatch({ ...body, origin: 'manual', createdBy: user.id }) };
  });

  router.get('/api/matches/:id', ({ params, query }) => arena.detail(params.id, query.viewer || null));

  /** 真人落子：只有座位上那位真人的账号可以走 */
  const humanOwner = (matchId) => {
    const m = db.get('SELECT seats FROM matches WHERE id = ?', matchId);
    if (!m) throw new HttpError(404, '对局不存在');
    for (const cid of Object.values(m.seats)) {
      const c = db.get('SELECT kind, owner_id FROM characters WHERE id = ?', cid);
      if (c?.kind === 'human') return c.owner_id;
    }
    return null;
  };

  router.post('/api/matches/:id/move', ({ params, body, user }) => {
    if (humanOwner(params.id) !== user.id) throw new HttpError(403, '这盘棋不是你在下');
    arena.humanMove(params.id, String(body.action || ''), !!body.offerDraw);
    return { ok: true };
  });

  /** 暂停、中止等：开局的人、庄家；认输、接受和棋：座位上的真人 */
  router.post('/api/matches/:id/control', ({ params, body, user }) => {
    const m = db.get('SELECT created_by FROM matches WHERE id = ?', params.id);
    if (!m) throw new HttpError(404, '对局不存在');
    const player = humanOwner(params.id) === user.id;
    const owner = isAdmin(user) || m.created_by === user.id;
    if (['resign', 'accept_draw'].includes(body.op) ? !player : !(owner || player)) throw new HttpError(403, '你不能控制这盘对局');
    return arena.control(params.id, body.op);
  });

  router.get('/api/matches/:id/export', ({ params, res }) => {
    const d = arena.detail(params.id);
    const full = arena.detail(params.id, null);
    if (full.game !== 'xiangqi') {
      const out = [`【对局】${full.id}（${full.gameName}）`, ...full.seatOrder.map((s) => `【${full.seatNames[s]}】${full.players[s]?.name}`), `【时间】${full.created_at}`, '',
        ...full.turns.filter((t) => t.label).map((t) => `${String(t.ply).padStart(4)}. ${full.seatNames[t.seat]}：${t.label}`),
        '', `【结果】${full.result ? full.result.reason : '进行中'}`];
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${full.id}.txt"` });
      res.end(out.join('\n'));
      return;
    }
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

  // ---------- 同题对比（放在对局记录里） ----------
  router.get('/api/puzzles', () => PUZZLES.map((p) => {
    const g = getGame('xiangqi');
    const s = p.fen ? g.create({ players: 2, setup: { fen: p.fen } }) : replay(g, { players: 2, actions: p.moves });
    return { ...p, fen: g.fen(s) };
  }));
  router.get('/api/compares', () => compare.list());
  router.post('/api/compares', ({ body, user }) => {
    for (const id of body.characterIds || []) {
      if (!usable(user, db.get('SELECT * FROM characters WHERE id = ?', id))) throw new HttpError(403, '同题对比只能用自己的蛐蛐和系统选手');
    }
    return { id: compare.create(body) };
  });
  router.get('/api/compares/:id', ({ params }) => compare.detail(params.id));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v) || lo));
}
