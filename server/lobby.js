// 对战大厅：正在进行的对局（带缩略棋盘、胜率、谁在思考）和最近结束的对局。

import { getGame, replay } from '../games/index.js';
import { recordOf } from './arena.js';

export function lobbyRoutes(router, { db, arena }) {
  router.get('/api/lobby', () => {
    const live = db.all("SELECT id FROM matches WHERE status = 'running' ORDER BY created_at DESC").map((r) => liveCard(db, arena, r.id)).filter(Boolean);
    const recent = db.all("SELECT id FROM matches WHERE status != 'running' ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 12")
      .map((r) => arena.summary(r.id)).filter(Boolean);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = db.get('SELECT COUNT(*) AS n FROM matches WHERE created_at >= ?', start.toISOString()).n;
    const total = db.get("SELECT COUNT(*) AS n FROM matches WHERE status = 'finished'").n;
    return { live, recent, today, total };
  });
}

function liveCard(db, arena, id) {
  const m = db.get('SELECT * FROM matches WHERE id = ?', id);
  if (!m) return null;
  const game = getGame(m.game);
  const human = arena.humanSeat(m);
  const view = game.view(replay(game, recordOf(m)), game.features?.hidden && human ? human : null);
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
    thinking: Object.keys(rt?.partials || {})[0] || Object.keys(rt?.humans || {})[0] || null,
    paused: !!rt?.paused,
    started_at: m.started_at,
  };
}
