// 天梯自动匹配：选出今天还有余量的选手，列出段位相近的候选对手，由模型自己挑对手并写挑战宣言。

import { gameList } from '../../games/index.js';
import { canRank } from '../characters.js';
import { tierFor, PLACEMENT_GAMES } from './rating.js';
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
      const u = this.arena.todayUsage(c.id);
      if (u.games >= c.daily_limit) continue;
      if (c.daily_tokens && u.tokens >= c.daily_tokens) continue;
      if (!c.system && this.arena.busy(c.id)) continue;
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
        const gameId = gameList()[0].id; // 目前只有象棋；以后由模型在候选游戏里选
        const cands = this.candidates(ch, pool, gameId, s.maxTierGap) ;
        const wide = cands.length ? cands : this.candidates(ch, pool, gameId, s.maxTierGap + 1);
        if (!wide.length) continue;
        const pick = await this.choose(ch, wide, gameId);
        const seats = Math.random() < 0.5 ? { r: ch.id, b: pick.opponent.id } : { r: pick.opponent.id, b: ch.id };
        const id = this.arena.createMatch({ game: pick.game, seats, mode: 'ranked', challenge: { by: ch.id, text: pick.declaration } });
        this.#log(`${ch.name} 向 ${pick.opponent.name} 发起挑战：${pick.declaration || '（无宣言）'}`);
        return id;
      }
      return null;
    } finally {
      this.ticking = false;
    }
  }

  /** 候选对手：段位相差不超过 gap，同一对手当天不超过 samePairPerDay 盘；按分差排序取前 5 */
  candidates(ch, pool, gameId, gap) {
    const s = this.settings();
    const me = tierFor(this.db, ch.id, gameId);
    const mePlacing = me.played < PLACEMENT_GAMES;
    const today = new Set(ch.usage.matchIds);
    const list = [];
    for (const o of pool) {
      if (o.id === ch.id) continue;
      const t = tierFor(this.db, o.id, gameId);
      const placing = t.played < PLACEMENT_GAMES;
      if (!mePlacing && !placing && Math.abs(t.index - me.index) > gap) continue;
      const vsToday = o.usage.matchIds.filter((id) => today.has(id)).length;
      if (vsToday >= s.samePairPerDay) continue;
      list.push({ ...o, tier: t, h2h: this.h2h(ch.id, o.id, gameId) });
    }
    list.sort((a, b) => Math.abs(a.tier.points - me.points) - Math.abs(b.tier.points - me.points));
    return list.slice(0, 5);
  }

  h2h(a, b, gameId) {
    const rows = this.db.all("SELECT seats, result FROM matches WHERE game = ? AND status = 'finished' AND mode != 'casual'", gameId)
      .filter((m) => Object.values(m.seats).includes(a) && Object.values(m.seats).includes(b));
    const r = { w: 0, d: 0, l: 0 };
    for (const m of rows) {
      const mySeat = Object.entries(m.seats).find(([, id]) => id === a)[0];
      if (!m.result.winner) r.d++;
      else if (m.result.winner === mySeat) r.w++;
      else r.l++;
    }
    return r;
  }

  /** 模型选手自己挑对手；其他选手或解析失败时随机挑 */
  async choose(ch, cands, gameId) {
    const fallback = () => ({ opponent: cands[Math.floor(Math.random() * Math.min(3, cands.length))], game: gameId, declaration: '' });
    if (ch.kind !== 'model') return fallback();
    const me = tierFor(this.db, ch.id, gameId);
    const games = gameList();
    const prompt = [
      `你是 AI 对弈场的选手「${ch.name}」。你的目标是提升自己的排名分。`,
      `你现在：${games.find((g) => g.id === gameId).name} ${me.label}，积分 ${me.points}，今天已下 ${ch.usage.games}/${ch.daily_limit} 盘。`,
      '积分规则：赢段位比你高的对手加分多，赢比你弱的加分少；输给比你弱的对手扣分多。',
      '',
      '候选对手：',
      ...cands.map((o, i) => `${i + 1}. ${o.name}（${o.tier.label}，${o.tier.points} 分；你们交手 ${o.h2h.w} 胜 ${o.h2h.d} 和 ${o.h2h.l} 负）`),
      '',
      `可选游戏：${games.map((g) => `${g.id}（${g.name}）`).join('、')}`,
      '',
      '请严格按三行回答：',
      '对手：编号',
      '游戏：游戏代码',
      '宣言：一句不超过 30 字的挑战宣言',
    ].join('\n');
    try {
      const r = await callModel(this.db, ch, '你是一名追求更高排名的 AI 棋手，回答简短。', [{ role: 'user', content: prompt }]);
      const n = Number(/对手[:：]\s*(\d+)/.exec(r.text)?.[1]);
      const g = /游戏[:：]\s*([a-z]+)/i.exec(r.text)?.[1];
      const d = /宣言[:：]\s*(.+)/.exec(r.text)?.[1]?.trim().slice(0, 60) || '';
      const opponent = cands[n - 1];
      if (!opponent) return fallback();
      return { opponent, game: games.some((x) => x.id === g) ? g : gameId, declaration: d };
    } catch (e) {
      this.#log(`${ch.name} 选对手失败（${e.message}），改为系统随机匹配`);
      return fallback();
    }
  }
}
