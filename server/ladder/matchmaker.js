// 天梯自动匹配：选出今天还有余量的选手，列出段位相近的候选对手，由模型自己挑对手并写挑战宣言。

import { gameList, getGame } from '../../games/index.js';
import { seatOutcome } from '../stats.js';

const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
import { canRank, agentOnline } from '../characters.js';
import { tierFor, PLACEMENT_GAMES, poolKey } from './rating.js';
import { callModel } from '../providers/index.js';

export const LADDER_DEFAULTS = {
  enabled: false, // 默认关闭，避免没留意时花钱
  concurrency: 2, // 同时进行的排位赛盘数
  maxTierGap: 2, // 段位相差超过 2 个大段不能匹配
  samePairPerDay: 2, // 同一对手每天最多 2 盘
  intervalSec: 30,
  globalDailyTokens: null, // 全平台每天 token 上限
};

export class Matchmaker {
  constructor(arena) {
    this.arena = arena;
    this.db = arena.db;
    this.ticking = false;
    this.lastLog = [];
  }

  settings() {
    return { ...LADDER_DEFAULTS, ...this.db.getSetting('ladder', {}) };
  }

  start() {
    const loop = async () => {
      await this.tick().catch((e) => this.#log(`匹配出错：${e.message}`));
      this.timer = setTimeout(loop, this.settings().intervalSec * 1000);
      this.timer.unref?.();
    };
    this.timer = setTimeout(loop, 3000);
    this.timer.unref?.();
  }

  #log(text) {
    this.lastLog.unshift({ at: new Date().toISOString(), text });
    this.lastLog = this.lastLog.slice(0, 30);
    this.arena.hub.emit('lobby', { type: 'ladder_log', text });
  }

  runningRanked() {
    return this.db.all("SELECT id FROM matches WHERE status = 'running' AND mode != 'casual'").length;
  }

  /** 今天还能出战的选手 */
  eligible() {
    const s = this.settings();
    const out = [];
    for (const c of this.db.all("SELECT * FROM characters WHERE auto_match = 1 AND archived = 0 AND kind != 'human'")) {
      if (!canRank(this.db, c)) continue;
      // 主人的账号被停用后，他的蛐蛐不再自己约战（约战会花他存着的密钥）
      if (!c.system && ['disabled', 'rejected', 'pending'].includes(this.db.get('SELECT status FROM users WHERE id = ?', c.owner_id)?.status)) continue;
      if (c.kind === 'agent' && !agentOnline(c)) continue; // 自带 agent 只在在线（最近来领过回合）时匹配
      const u = this.arena.todayUsage(c.id);
      if (u.games >= c.daily_limit) continue;
      if (c.daily_tokens && u.tokens >= c.daily_tokens) continue;
      // AI 蛐蛐可以同时参加多盘对局，不再因为正在下别的对局而跳过
      out.push({ ...c, usage: u });
    }
    if (s.globalDailyTokens) {
      const total = out.filter((c) => !c.system).reduce((n, c) => n + c.usage.tokens, 0);
      if (total >= s.globalDailyTokens) return [];
    }
    return out;
  }

  /** 执行一次匹配；返回新对局 id 或 null */
  async tick({ force = false } = {}) {
    const s = this.settings();
    if ((!s.enabled && !force) || this.ticking) return null;
    if (this.runningRanked() >= s.concurrency) return null;
    this.ticking = true;
    try {
      const pool = this.eligible();
      const challengers = pool.filter((c) => !c.system).sort((a, b) => a.usage.games - b.usage.games || Math.random() - 0.5);
      for (const ch of challengers) {
        // 选游戏：挑战者在哪个游戏里下得最少就先下哪个，保证各游戏都有积分
        const games = gameList().map((g) => ({ g, played: this.arena.played(ch.id, g.id) })).sort((a, b) => a.played - b.played || Math.random() - 0.5);
        for (const { g } of games) {
          const game = getGame(g.id);
          const n = game.players.default;
          // 自带 agent 和 API 模型分在两个天梯：agent 只和 agent、系统选手匹配；模型不和 agent 匹配
          const usable = pool.filter((o) => (o.kind !== 'engine' || (o.provider || 'pikafish') === game.features?.evalEngine)
            && (ch.kind === 'agent' ? o.kind === 'agent' || o.system : o.kind !== 'agent'));
          const limit = Math.max(5, n - 1);
          const cands = this.candidates(ch, usable, g.id, s.maxTierGap, limit);
          const wide = cands.length >= n - 1 ? cands : this.candidates(ch, usable, g.id, s.maxTierGap + 1, limit);
          // 人多的游戏（狼人杀 8 人）选手不够时，用内置 AI 补座位（系统选手可以占多个座位）
          const filler = usable.filter((o) => o.system && o.kind === 'builtin');
          if (!wide.length || (wide.length < n - 1 && !filler.length)) continue;
          // 真实选手（含挑战者）至少过半才开，否则积分意义不大
          const real = 1 + wide.slice(0, n - 1).filter((o) => !o.system).length;
          if (real * 2 < n) continue;
          const pick = await this.choose(ch, wide.slice(0, 5), g.id);
          // 多人游戏：主对手由模型挑，其余座位按分差就近补齐
          const others = [pick.opponent, ...wide.filter((o) => o.id !== pick.opponent.id)].slice(0, n - 1);
          for (let i = 0; others.length < n - 1; i++) others.push(filler[i % filler.length]);
          const players = shuffle([ch, ...others]);
          const seatIds = game.seats(n);
          const seats = Object.fromEntries(seatIds.map((sid, i) => [sid, players[i].id]));
          const series = game.rankedSeries ? { id: `s_${Date.now().toString(36)}`, leg: 1, of: game.rankedSeries.legs, seed: Math.floor(Math.random() * 2 ** 31) } : null;
          const id = this.arena.createMatch({ game: g.id, seats, mode: 'ranked', origin: 'auto', challenge: { by: ch.id, text: pick.declaration }, options: series ? { series, seed: series.seed } : {} });
          this.#log(`${ch.name} 向 ${pick.opponent.name} 发起${game.name}挑战：${pick.declaration || '（无宣言）'}`);
          return id;
        }
      }
      return null;
    } finally {
      this.ticking = false;
    }
  }

  /**
   * 系列赛：五子棋排位赛交换先后手再下一盘；斗地主、德州用同一副牌轮换座位（复式）。
   * 上一盘结束后接着开下一盘，座位整体轮转一位。
   */
  onFinished(sum) {
    if (!sum?.series || sum.status !== 'finished') return null;
    const row = this.db.get('SELECT options, setup FROM matches WHERE id = ?', sum.id);
    const ser = row?.options?.series;
    if (!ser || ser.leg >= ser.of) return null;
    const game = getGame(sum.game);
    const seatIds = Object.keys(sum.seats);
    const ids = seatIds.map((sid) => sum.seats[sid]);
    const rotated = [ids[ids.length - 1], ...ids.slice(0, -1)];
    const seats = Object.fromEntries(seatIds.map((sid, i) => [sid, rotated[i]]));
    const next = { ...ser, leg: ser.leg + 1 };
    // 有玩家本人或自带 agent 时每盘换一副牌：上一盘结束后是上帝视角（agent 自己也记得上一盘摊开的牌），同一副牌等于知道了所有人的牌
    const human = Object.values(sum.players || {}).some((p) => p?.kind === 'human' || p?.kind === 'agent');
    const sameDeck = game.rankedSeries?.sameSeed && !human;
    const options = {
      series: next,
      ...(sameDeck ? { seed: ser.seed } : {}),
      ...(row.setup?.setup && Object.keys(row.setup.setup).length ? { setup: row.setup.setup } : {}),
      ...(row.options.showLegal === false ? { showLegal: false } : {}),
      ...(row.options.delayMs ? { delayMs: row.options.delayMs } : {}),
      ...(row.options.hideThoughts !== undefined ? { hideThoughts: row.options.hideThoughts } : {}),
    };
    try {
      const id = this.arena.createMatch({ game: sum.game, seats, mode: 'ranked', origin: 'auto', options });
      this.#log(`${game.name}系列赛第 ${next.leg}/${next.of} 盘开始`);
      return id;
    } catch (e) {
      this.#log(`系列赛下一盘没能开始：${e.message}`);
      return null;
    }
  }

  /** 候选对手：段位相差不超过 gap，同一对手当天不超过 samePairPerDay 盘；按分差排序取前 5 */
  candidates(ch, pool, gameId, gap, limit = 5) {
    const s = this.settings();
    const key = poolKey(gameId, ch.kind);
    const me = tierFor(this.db, ch.id, key);
    const mePlacing = me.played < PLACEMENT_GAMES;
    const today = new Set(ch.usage.matchIds);
    const list = [];
    for (const o of pool) {
      if (o.id === ch.id) continue;
      const t = tierFor(this.db, o.id, key);
      const placing = t.played < PLACEMENT_GAMES;
      if (!mePlacing && !placing && Math.abs(t.index - me.index) > gap) continue;
      const vsToday = o.usage.matchIds.filter((id) => today.has(id)).length;
      if (vsToday >= s.samePairPerDay) continue;
      list.push({ ...o, tier: t, h2h: this.h2h(ch.id, o.id, gameId) });
    }
    list.sort((a, b) => Math.abs(a.tier.points - me.points) - Math.abs(b.tier.points - me.points));
    return list.slice(0, limit);
  }

  h2h(a, b, gameId) {
    const rows = this.db.all("SELECT seats, result FROM matches WHERE game = ? AND status = 'finished' AND mode != 'casual'", gameId)
      .filter((m) => Object.values(m.seats).includes(a) && Object.values(m.seats).includes(b));
    const r = { w: 0, d: 0, l: 0 };
    for (const m of rows) {
      const mySeat = Object.entries(m.seats).find(([, id]) => id === a)[0];
      const o = seatOutcome(m.result, mySeat);
      if (o === 'd') r.d++;
      else if (o === 'w') r.w++;
      else r.l++;
    }
    return r;
  }

  /** 模型选手自己挑对手；其他选手或解析失败时随机挑 */
  async choose(ch, cands, gameId) {
    const fallback = () => ({ opponent: cands[Math.floor(Math.random() * Math.min(3, cands.length))], declaration: '' });
    if (ch.kind !== 'model') return fallback();
    const me = tierFor(this.db, ch.id, gameId);
    const games = gameList();
    const prompt = [
      `你是 电子斗蛐蛐的选手「${ch.name}」。你的目标是提升自己的排名分。`,
      `你现在：${games.find((g) => g.id === gameId).name} ${me.label}，积分 ${me.points}，今天已下 ${ch.usage.games}/${ch.daily_limit} 盘。`,
      '积分规则：赢段位比你高的对手加分多，赢比你弱的加分少；输给比你弱的对手扣分多。',
      '',
      '候选对手：',
      ...cands.map((o, i) => `${i + 1}. ${o.name}（${o.tier.label}，${o.tier.points} 分；你们交手 ${o.h2h.w} 胜 ${o.h2h.d} 和 ${o.h2h.l} 负）`),
      '',
      '请严格按两行回答：',
      '对手：编号',
      '宣言：一句不超过 30 字的挑战宣言',
    ].join('\n');
    try {
      const r = await callModel(this.db, ch, '你是一名追求更高排名的 AI 棋手，回答简短。', [{ role: 'user', content: prompt }]);
      const n = Number(/对手[:：]\s*(\d+)/.exec(r.text)?.[1]);
      const d = /宣言[:：]\s*(.+)/.exec(r.text)?.[1]?.trim().slice(0, 60) || '';
      const opponent = cands[n - 1];
      if (!opponent) return fallback();
      return { opponent, declaration: d };
    } catch (e) {
      this.#log(`${ch.name} 选对手失败（${e.message}），改为系统随机匹配`);
      return fallback();
    }
  }
}
