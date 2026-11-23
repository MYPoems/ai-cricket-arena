// 积分与段位。底层用 OpenSkill（支持一对一、多人和分队），显示分 = 1000 + 40 ×（μ − 3σ）。
// 新选手 μ=25、σ≈8.33，显示分从 1000 起，下得越多 σ 越小、分数越接近真实水平。

import { rating, rate, ordinal } from 'openskill';
import { now } from '../db.js';

export const PLACEMENT_GAMES = 5;
export const KING_SLOTS = 10; // 王者名额：大师里排名前 10

/** 积分池：有自带 agent 的排位记在单独的 Agent 天梯（键为 agent:游戏），不和 API 模型选手混排 */
export const ratingKey = (game, kinds = []) => (kinds.includes('agent') ? `agent:${game}` : game);
export const poolKey = (game, kind) => (kind === 'agent' ? `agent:${game}` : game);

export const score = (r) => Math.round(1000 + 40 * ordinal(r));

/**
 * 「定级中」的 σ 线：n 人局里一名新选手和水平相当的对手下满 PLACEMENT_GAMES 盘（输赢各半）后大约的 σ。
 * 人多的游戏每盘带来的信息少，σ 降得慢，所以每种人数各算一条线。
 */
const sigmaLines = new Map();
export function sigmaLine(n = 2) {
  if (sigmaLines.has(n)) return sigmaLines.get(n);
  let seats = Array.from({ length: n }, () => rating());
  const half = Math.max(1, Math.floor(n / 2));
  for (let i = 0; i < PLACEMENT_GAMES; i++) {
    // 第 0 座轮流赢、输，其余座位凑成一半赢一半输
    const ranks = seats.map((_, k) => ((k < half) === (i % 2 === 0) ? 1 : 2));
    seats = rate(seats.map((s) => [s]), { rank: ranks }).map((t) => t[0]);
  }
  sigmaLines.set(n, seats[0].sigma);
  return seats[0].sigma;
}

/**
 * 分数的不确定性（换算到积分的刻度）：
 * mid = 估计实力 1000 + 40μ，pm = 不确定度 ±40σ，榜上的积分 = mid − 3 × pm。
 * unsure：还没下满定级局，或下满了 σ 仍高于这类游戏的定级线（成绩起伏大，分数还不稳）。
 */
export function uncertainty(r, players = 2) {
  const placing = r.played < PLACEMENT_GAMES;
  return { mid: Math.round(1000 + 40 * r.mu), pm: Math.round(40 * r.sigma), unsure: placing || r.sigma > sigmaLine(players) + 0.05, placing };
}

// 大段：[名称, 起始分]；大师以上不分小段，王者由排名决定
export const TIERS = [
  ['黑铁', -Infinity],
  ['黄铜', 1200],
  ['白银', 1400],
  ['黄金', 1600],
  ['铂金', 1800],
  ['钻石', 2000],
  ['大师', 2200],
];
const SUB = ['III', 'II', 'I'];

/** 由分数、场次和排名得到段位 { tier, index, sub, label } */
export function tierOf(points, played, rankInMasters = null) {
  if (played < PLACEMENT_GAMES) return { tier: '定级中', index: -1, sub: '', label: `定级中 ${played}/${PLACEMENT_GAMES}` };
  let i = 0;
  while (i + 1 < TIERS.length && points >= TIERS[i + 1][1]) i++;
  const [name, start] = TIERS[i];
  if (name === '大师') {
    if (rankInMasters !== null && rankInMasters < KING_SLOTS) return { tier: '王者', index: 7, sub: '', label: '王者' };
    return { tier: '大师', index: 6, sub: '', label: '大师' };
  }
  const base = i === 0 ? 1000 : start;
  const step = 200 / 3;
  const s = Math.max(0, Math.min(2, Math.floor((points - base) / step)));
  return { tier: name, index: i, sub: SUB[s], label: `${name} ${SUB[s]}` };
}

export function getRating(db, characterId, game) {
  const row = db.get('SELECT * FROM ratings WHERE character_id = ? AND game = ?', characterId, game);
  if (row) return row;
  const r = rating();
  return { character_id: characterId, game, mu: r.mu, sigma: r.sigma, played: 0, wins: 0, draws: 0, losses: 0, peak: score(r), updated_at: now() };
}

/**
 * 对局结束后更新积分。
 * seats: { seat: characterId }，ranks: { seat: 名次 }（名次相同表示平局）
 * 返回 { characterId: { before, after, delta } }
 */
export function applyResult(db, game, matchId, seats, ranks) {
  const entries = Object.entries(seats).filter(([, cid]) => cid);
  const olds = entries.map(([, cid]) => getRating(db, cid, game));
  const teams = olds.map((o) => [rating({ mu: o.mu, sigma: o.sigma })]);
  const rankArr = entries.map(([seat]) => ranks[seat]);
  const updated = rate(teams, { rank: rankArr });
  const best = Math.min(...rankArr);
  const allSame = rankArr.every((r) => r === best);
  const changes = {};
  const seen = new Set();
  db.tx(() => {
    entries.forEach(([seat, cid], i) => {
      // 同一名选手（补位的内置 AI）占了多个座位：只按第一个座位结算一次
      if (seen.has(cid)) return;
      seen.add(cid);
      const o = olds[i];
      const n = updated[i][0];
      const before = score(o);
      const after = score(n);
      const win = !allSame && ranks[seat] === best;
      const draw = allSame;
      const row = {
        character_id: cid, game, mu: n.mu, sigma: n.sigma,
        played: o.played + 1, wins: o.wins + (win ? 1 : 0), draws: o.draws + (draw ? 1 : 0), losses: o.losses + (!win && !draw ? 1 : 0),
        peak: Math.max(o.peak || 0, after), updated_at: now(),
      };
      db.run(
        `INSERT INTO ratings (character_id, game, mu, sigma, played, wins, draws, losses, peak, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(character_id, game) DO UPDATE SET mu = excluded.mu, sigma = excluded.sigma, played = excluded.played,
           wins = excluded.wins, draws = excluded.draws, losses = excluded.losses, peak = excluded.peak, updated_at = excluded.updated_at`,
        row.character_id, row.game, row.mu, row.sigma, row.played, row.wins, row.draws, row.losses, row.peak, row.updated_at,
      );
      db.insert('rating_history', { character_id: cid, game, match_id: matchId, score: after, at: now() });
      changes[cid] = { before, after, delta: after - before };
    });
  });
  return changes;
}

/** 某游戏的排行榜（含段位）；王者按大师里的名次判定 */
export function leaderboard(db, game, { includeSystem = true } = {}) {
  const rows = db.all(
    `SELECT r.*, c.name, c.avatar, c.kind, c.provider, c.model, c.style, c.system, c.owner_id, c.effort
     FROM ratings r JOIN characters c ON c.id = r.character_id
     WHERE r.game = ? AND c.archived = 0`,
    game,
  ).filter((r) => includeSystem || !r.system);
  for (const r of rows) r.points = score(r);
  rows.sort((a, b) => b.points - a.points);
  let masters = 0;
  for (const r of rows) {
    const t0 = tierOf(r.points, r.played);
    const rank = t0.tier === '大师' && !r.system ? masters++ : null;
    r.tierInfo = r.system ? { ...t0, label: t0.label } : tierOf(r.points, r.played, rank);
  }
  return rows;
}

/** 选手在某游戏的当前段位 */
export function tierFor(db, characterId, game) {
  const board = leaderboard(db, game);
  const row = board.find((r) => r.character_id === characterId);
  if (!row) return { ...tierOf(1000, 0), points: 1000, played: 0 };
  return { ...row.tierInfo, points: row.points, played: row.played };
}
