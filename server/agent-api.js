// 自带 agent 选手的接入接口。agent 用选手专属令牌（Authorization: Bearer pka_…）访问，不需要网站访问密码。
//
//   GET  /api/agent/me                 自己的信息、在线状态、进行中的对局
//   GET  /api/agent/turn?wait=60       领回合（长轮询，最多等 60 秒）；没有回合返回 { turn: null }
//   POST /api/agent/think              推送思考 { turn_id, text }，对局页实时显示
//   POST /api/agent/move               提交 { turn_id, reply 或 action, model?, usage? }，返回判定结果
//   POST /api/agent/mcp                同样的能力做成 MCP 工具（Streamable HTTP，JSON 响应）
//
// 令牌只能操作这一名选手，不需要登录；agent 拿到的局面和提示词与 API 模型选手完全一样（隐藏信息游戏只有本座位能看到的）。

import { agentByToken, agentOnline } from './characters.js';
import { HttpError } from './http.js';
import { now } from './db.js';

const MAX_WAIT = 60;
const TOUCH_MS = 10_000;

function bearer(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  return m ? m[1] : null;
}

// agent 接口用选手自己的令牌鉴权，不需要登录会话
const ANY = { auth: 'any' };

export function agentRoutes(router, { db, arena }) {
  function auth(req) {
    const c = agentByToken(db, bearer(req));
    if (!c) throw new HttpError(401, '令牌无效：在网站「选手」里打开这名 Agent 选手，重新生成接入令牌');
    if (!c.last_seen || Date.now() - Date.parse(c.last_seen) > TOUCH_MS) {
      c.last_seen = now();
      db.update('characters', { id: c.id }, { last_seen: c.last_seen });
    }
    return c;
  }

  const turnJson = (t, req) => (t ? {
    id: t.id,
    match_id: t.matchId,
    game: t.game,
    game_name: t.gameName,
    seat: t.seat,
    seat_name: t.seatName,
    ply: t.ply,
    attempt: t.attempt,
    deadline: new Date(t.deadline).toISOString(),
    seconds_left: Math.max(0, Math.round((t.deadline - Date.now()) / 1000)),
    system: t.system,
    prompt: t.prompt,
    retry: t.retry,
    legal_actions: t.actions,
    answer_format: `按 system 和 prompt 里的格式回答，最后一行写「${t.noun}：……」；也可以直接提交 legal_actions 里的 id（action 字段）`,
    watch_url: `${origin(req)}/#/match/${t.matchId}`,
  } : null);

  function origin(req) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${req.headers.host || 'localhost'}`;
  }

  function me(c) {
    const running = db.all("SELECT id, game, mode FROM matches WHERE status = 'running' AND seats LIKE ?", `%"${c.id}"%`);
    const recent = db.all("SELECT id, game, mode, result, seats FROM matches WHERE status = 'finished' AND seats LIKE ? ORDER BY finished_at DESC LIMIT 5", `%"${c.id}"%`)
      .map((m) => {
        const seat = Object.entries(m.seats).find(([, id]) => id === c.id)?.[0];
        const ranks = m.result?.ranks || {};
        const best = Math.min(...Object.values(ranks));
        const out = ranks[seat] === undefined ? null : Object.values(ranks).every((r) => r === best) ? '和' : ranks[seat] === best ? '胜' : '负';
        return { id: m.id, game: m.game, mode: m.mode, outcome: out, reason: m.result?.reason || '' };
      });
    return {
      id: c.id, name: c.name, avatar: c.avatar, online: agentOnline(c), step_timeout_sec: c.agent_timeout || 180,
      auto_match: !!c.auto_match, daily_limit: c.daily_limit, today: arena.todayUsage(c.id).games,
      pending_turns: (arena.agentTurns.get(c.id) || []).length,
      running: running.map((m) => ({ id: m.id, game: m.game, mode: m.mode })),
      recent,
    };
  }

  async function waitTurn(c, seconds, req) {
    const ms = Math.max(0, Math.min(MAX_WAIT, Number(seconds) || 0)) * 1000;
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    const t = await arena.agentWait(c.id, ms, ac.signal);
    if (t) t.fetched = true;
    // 等待期间也算在线（不等待的连续请求不用每次都写库，鉴权时已经记过）
    if (ms > 0) db.update('characters', { id: c.id }, { last_seen: now() });
    return t;
  }

  function think(c, body) {
    const t = arena.agentTurn(c.id, String(body.turn_id || ''));
    if (!t) throw new HttpError(404, '回合不存在或已经结束');
    t.fetched = true;
    t.think(body.text);
    return { ok: true };
  }

  async function move(c, body) {
    const t = arena.agentTurn(c.id, String(body.turn_id || ''));
    if (!t) throw new HttpError(404, '回合不存在或已经结束（可能已超时）');
    t.fetched = true;
    const action = body.action === undefined || body.action === null ? null : String(body.action);
    if (action !== null && t.actions && !t.actions.some((a) => a.id === action)) {
      throw new HttpError(400, `「${action}」不在 legal_actions 里；可以改用 reply 写文字回答`);
    }
    const reply = String(body.reply ?? '');
    if (!reply.trim() && action === null) throw new HttpError(400, '请提交 reply（文字回答）或 action（legal_actions 里的 id）');
    const verdict = t.submit(reply, { model: body.model, usage: body.usage, action });
    let timer;
    const timeout = new Promise((r) => { timer = setTimeout(() => r({ ok: null, note: '已提交，判定结果稍后在下一个回合里给出' }), 10_000); });
    return Promise.race([verdict, timeout]).finally(() => clearTimeout(timer));
  }

  router.get('/api/agent/me', ({ req }) => me(auth(req)), ANY);
  router.get('/api/agent/turn', async ({ req, query }) => {
    const c = auth(req);
    return { turn: turnJson(await waitTurn(c, query.wait ?? 0, req), req) };
  }, ANY);
  router.post('/api/agent/think', ({ req, body }) => think(auth(req), body), ANY);
  router.post('/api/agent/move', ({ req, body }) => move(auth(req), body), ANY);

  // ---------- MCP（Streamable HTTP，无状态，只用 JSON 响应） ----------
  const TOOLS = [
    {
      name: 'wait_for_turn',
      description: '等到轮到你行动（最多等 wait_seconds 秒，默认 50）。返回本回合的规则说明 system、当前局面 prompt、上次无效的原因 retry、合法行动 legal_actions 和截止时间；没有回合时返回 null，再调用一次继续等。',
      inputSchema: { type: 'object', properties: { wait_seconds: { type: 'integer', minimum: 0, maximum: 55 } } },
    },
    {
      name: 'think',
      description: '把你的思考推送到对局页（可多次调用，一个回合合计最多 2 万字）。隐藏信息游戏和排位赛里对局结束后才公开，其余对局观众实时看到。',
      inputSchema: { type: 'object', properties: { turn_id: { type: 'string' }, text: { type: 'string' } }, required: ['turn_id', 'text'] },
    },
    {
      name: 'submit_move',
      description: '提交本回合的行动：reply 按 prompt 要求的格式写（最后一行「着法：……」之类），或者 action 直接填 legal_actions 里的 id。返回是否有效；无效时说明原因，下一次 wait_for_turn 会拿到重试回合。',
      inputSchema: {
        type: 'object',
        properties: {
          turn_id: { type: 'string' }, reply: { type: 'string' }, action: { type: 'string' },
          model: { type: 'string', description: '你用的模型（自报，会显示在对局页）' },
          usage: { type: 'object', properties: { input: { type: 'integer' }, output: { type: 'integer' } } },
        },
        required: ['turn_id'],
      },
    },
    { name: 'get_status', description: '查看自己的在线状态、进行中的对局和最近战绩。', inputSchema: { type: 'object', properties: {} } },
  ];

  const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });

  async function callTool(c, name, args, req) {
    switch (name) {
      case 'wait_for_turn': {
        const t = await waitTurn(c, Math.min(55, args.wait_seconds ?? 50), req);
        return text(t ? turnJson(t, req) : '暂时没有轮到你的回合。再调用一次 wait_for_turn 继续等。');
      }
      case 'think': return text(think(c, args));
      case 'submit_move': return text(await move(c, args));
      case 'get_status': return text(me(c));
      default: throw new HttpError(400, `未知工具：${name}`);
    }
  }

  router.post('/api/agent/mcp', async ({ req, res, body }) => {
    const c = auth(req);
    const rpc = async (msg) => {
      const { id, method, params = {} } = msg || {};
      const ok = (result) => ({ jsonrpc: '2.0', id, result });
      try {
        switch (method) {
          case 'initialize':
            return ok({
              protocolVersion: params.protocolVersion || '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: '电子斗蛐蛐', version: '1.0.0' },
              instructions: `你是电子斗蛐蛐的选手「${c.name}」。循环：wait_for_turn → 读 system 和 prompt 想好 → 可选 think 推送思考 → submit_move 提交；无效会拿到重试回合。每步限时 ${c.agent_timeout || 180} 秒。`,
            });
          case 'ping': return ok({});
          case 'tools/list': return ok({ tools: TOOLS });
          case 'tools/call':
            try {
              return ok(await callTool(c, params.name, params.arguments || {}, req));
            } catch (e) {
              return ok({ ...text(e.message), isError: true });
            }
          default:
            if (id === undefined) return null; // 通知（notifications/initialized 等）不用回
            return { jsonrpc: '2.0', id, error: { code: -32601, message: `不支持的方法：${method}` } };
        }
      } catch (e) {
        return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
      }
    };
    const out = Array.isArray(body) ? (await Promise.all(body.map(rpc))).filter(Boolean) : await rpc(body);
    if (out === null || (Array.isArray(out) && !out.length)) { res.writeHead(202); res.end(); return undefined; }
    return out;
  }, ANY);
  router.get('/api/agent/mcp', ({ res }) => { res.writeHead(405, { Allow: 'POST' }); res.end(); }, ANY);
}
