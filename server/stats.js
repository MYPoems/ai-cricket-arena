// 选手主页的统计：段位、积分曲线、战绩、交手记录、能力指标、代表作。

import { gameList } from '../games/index.js';
import { leaderboard, tierOf } from './ladder/rating.js';

/** 按名次判定某座位的结果：'w' 胜 / 'd' 和 / 'l' 负（支持团队和多人） */
export function seatOutcome(result, seat) {
  const ranks = result?.ranks;
  if (!ranks || ranks[seat] === undefined) return result?.winner ? (result.winner === seat ? 'w' : 'l') : 'd';
  const vals = Object.values(ranks);
  const best = Math.min(...vals);
  if (vals.every((r) => r === best)) return 'd';
  return ranks[seat] === best ? 'w' : 'l';
}


export function characterProfile(db, arena, c) {
  const games = gameList().map((g) => {
    const row = leaderboard(db, g.id).find((r) => r.character_id === c.id);
    const history = db.all('SELECT score, at, match_id FROM rating_history WHERE character_id = ? AND game = ? ORDER BY at', c.id, g.id);
    return {
      game: g.id, name: g.name,
      rating: row ? { points: row.points, tier: row.tierInfo, played: row.played, wins: row.wins, draws: row.draws, losses: row.losses, peak: row.peak } : { points: 1000, tier: tierOf(1000, 0), played: 0, wins: 0, draws: 0, losses: 0, peak: 1000 },
      history,
    };
  });

  const matches = db.all("SELECT id FROM matches WHERE seats LIKE ? ORDER BY created_at DESC LIMIT 200", `%"${c.id}"%`)
    .map((r) => arena.summary(r.id)).filter(Boolean);

  // 交手记录
  const h2h = new Map();
  for (const m of matches) {
    if (m.status !== 'finished') continue;
    const mySeat = Object.entries(m.seats).find(([, id]) => id === c.id)?.[0];
    for (const [seat, id] of Object.entries(m.seats)) {
      if (seat === mySeat || id === c.id) continue;
      const rec = h2h.get(id) || { opponent: m.players[seat], w: 0, d: 0, l: 0 };
      const o = seatOutcome(m.result, mySeat);
      if (o === 'd') rec.d++;
      else if (o === 'w') rec.w++;
      else rec.l++;
      h2h.set(id, rec);
    }
  }

  // 能力指标（只统计这名选手走的步）
  const turns = db.all('SELECT match_id, eval, attempts, usage, latency_ms, self_winrate FROM turns WHERE character_id = ?', c.id);
  let lossSum = 0, lossN = 0, calSum = 0, calN = 0, illegal = 0, latSum = 0, tokSum = 0;
  const tags = {};
  const perMatch = new Map();
  for (const t of turns) {
    const q = t.eval?.quality;
    if (q) {
      lossSum += q.loss; lossN++;
      tags[q.tag] = (tags[q.tag] || 0) + 1;
      const pm = perMatch.get(t.match_id) || { sum: 0, n: 0 };
      pm.sum += q.loss; pm.n++;
      perMatch.set(t.match_id, pm);
      if (t.self_winrate !== null && t.self_winrate !== undefined) { calSum += Math.abs(t.self_winrate / 100 - q.before); calN++; }
    }
    if (t.attempts?.length) illegal++;
    latSum += t.latency_ms || 0;
    tokSum += (t.usage?.input || 0) + (t.usage?.output || 0);
  }
  const n = turns.length || 1;
  const metrics = {
    moves: turns.length,
    accuracy: lossN ? Math.round(100 * (1 - lossSum / lossN)) : null, // 棋力准确率
    calibration: calN ? Math.round(100 * (1 - calSum / calN)) : null, // 判断准确度（自评胜率与引擎胜率的接近程度）
    legalRate: turns.length ? Math.round(100 * (1 - illegal / n)) : null, // 一次走对率
    avgLatencyMs: turns.length ? Math.round(latSum / n) : null,
    avgTokens: turns.length ? Math.round(tokSum / n) : null,
    totalTokens: tokSum,
    tags,
  };

  // 代表作：赢下的对局里，平均损失最小的一盘（至少 10 步）
  let best = null;
  for (const m of matches) {
    const mySeat = Object.entries(m.seats).find(([, id]) => id === c.id)?.[0];
    if (m.status !== 'finished' || seatOutcome(m.result, mySeat) !== 'w') continue;
    const pm = perMatch.get(m.id);
    if (!pm || pm.n < 10) continue;
    const avg = pm.sum / pm.n;
    if (!best || avg < best.avg) best = { match: m, avg };
  }

  const notes = db.all('SELECT text, created_at, match_id FROM notes WHERE character_id = ? ORDER BY created_at DESC LIMIT 20', c.id);
  return {
    games, matches: matches.slice(0, 50), h2h: [...h2h.values()].sort((a, b) => b.w + b.d + b.l - (a.w + a.d + a.l)),
    metrics, masterpiece: best ? { ...best.match, avgLoss: Math.round(best.avg * 1000) / 1000 } : null, notes,
    today: arena.todayUsage(c.id),
  };
}

/** 模型榜：按模型汇总「无风格提示词」的选手，取最高分 */
export function modelBoard(db, game) {
  const rows = leaderboard(db, game).filter((r) => r.kind === 'model' && !r.style);
  const by = new Map();
  for (const r of rows) {
    const key = `${r.provider}/${r.model}`;
    const cur = by.get(key);
    const played = (cur?.played || 0) + r.played;
    if (!cur || r.points > cur.points) by.set(key, { ...r, characters: (cur?.characters || 0) + 1, played });
    else { cur.characters++; cur.played = played; }
  }
  return [...by.values()].sort((a, b) => b.points - a.points);
}
