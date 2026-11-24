// 对战大厅：正在进行的对局（带缩略棋盘、胜率、谁在思考）和最近结束的对局。

import { getGame, replay, gameList } from '../games/index.js';
import { leaderboard } from './ladder/rating.js';
import { recordOf, PUBLIC_VIEWER } from './arena.js';

export function lobbyRoutes(router, { db, arena, matchmaker }) {
  router.get('/api/lobby', () => {
    const live = db.all("SELECT id FROM matches WHERE status = 'running' ORDER BY created_at DESC").map((r) => liveCard(db, arena, r.id)).filter(Boolean);
    const recent = db.all("SELECT id FROM matches WHERE status != 'running' ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 12")
      .map((r) => arena.summary(r.id)).filter(Boolean);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = db.get('SELECT COUNT(*) AS n FROM matches WHERE created_at >= ?', start.toISOString()).n;
    const total = db.get("SELECT COUNT(*) AS n FROM matches WHERE status = 'finished'").n;
    // 各游戏天梯榜首（不含系统参照选手）、天梯动态
    const tops = gameList().map((g) => {
      const r = leaderboard(db, g.id).find((x) => !x.system);
      return r ? { game: g.id, gameName: g.name, id: r.character_id, name: r.name, avatar: r.avatar, points: r.points, tier: r.tierInfo } : null;
    }).filter(Boolean);
    const rooms = db.get("SELECT COUNT(*) AS n FROM rooms WHERE status = 'open'").n;
    return { live, recent, today, total, tops, rooms, log: (matchmaker?.lastLog || []).slice(0, 12) };
  });
}

function liveCard(db, arena, id) {
  const m = db.get('SELECT * FROM matches WHERE id = ?', id);
  if (!m) return null;
  const game = getGame(m.game);
  const hiddenLive = !!game.features?.hidden && arena.humanSeats(m).length > 0;
  // 有真人的隐藏信息对局：大厅缩略图只给公共视角（谁的牌都看不到）
  const view = game.view(replay(game, recordOf(m)), game.features?.hidden ? PUBLIC_VIEWER : null);
  const last = db.get('SELECT eval FROM turns WHERE match_id = ? AND eval IS NOT NULL ORDER BY ply DESC LIMIT 1', id);
  const rt = arena.live.get(id);
  const lastMove = (view.moves || [])[(view.moves || []).length - 1];
  return {
    ...arena.summary(id),
    view,
    features: game.features || {},
    board: view.board,
    side: view.side,
    inCheck: view.inCheck,
    lastMove: lastMove?.iccs || null,
    lastLabel: lastMove?.cn || lastMove?.label || null,
    redE: last?.eval?.e0 ?? last?.eval?.redE ?? m.options?.startEval?.e0 ?? m.options?.startEval?.redE ?? null,
    thinking: Object.values(rt?.partials || {}).find((p) => !(hiddenLive && p.secret))?.seat || Object.keys(rt?.humans || {}).find((s) => !rt.partials[s]?.secret) || null,
    paused: !!rt?.paused,
    // 在等真人出手（大厅擂台不推荐这种局）；最近一步的时间（挂着没人动的局沉下去）
    humanWaiting: Object.keys(rt?.humans || {}).length > 0,
    lastAt: db.get('SELECT created_at FROM turns WHERE match_id = ? ORDER BY ply DESC LIMIT 1', id)?.created_at || m.created_at,
    started_at: m.started_at,
  };
}
