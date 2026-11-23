// 同题对比：同一个局面同时发给多个选手，并排比较它们的分析和选择，再用引擎给每个选择打分。

import { getGame } from '../games/index.js';
import { newId, now } from './db.js';
import { callModel } from './providers/index.js';
import { getCharacter } from './characters.js';
import { moveQuality } from './evaluator.js';
import { MAX_RETRIES } from './arena.js';
import { HttpError } from './http.js';

export class Compare {
  constructor(arena) {
    this.arena = arena;
    this.db = arena.db;
  }

  create({ game: gameId = 'xiangqi', fen, title, characterIds }) {
    const game = getGame(gameId);
    // 同题对比要从给定局面开始、两人轮流走：只支持能用 FEN 描述局面、没有隐藏信息的棋类
    if (!game.fen || game.features?.hidden || game.players.min > 2) throw new HttpError(400, `${game.name}还不支持同题对比`);
    let state;
    try {
      state = game.create({ players: 2, setup: { fen } });
    } catch (e) {
      throw new HttpError(400, `局面不合法：${e.message}`);
    }
    if (game.outcome(state).over) throw new HttpError(400, '这个局面已经分出胜负');
    const ids = [...new Set(characterIds || [])].slice(0, 8);
    if (ids.length < 1) throw new HttpError(400, '至少选择一名选手');
    const chars = ids.map((id) => getCharacter(this.db, id));
    if (chars.some((c) => c.kind === 'human')) throw new HttpError(400, '同题对比只能选 AI 选手');
    const id = newId('cmp');
    this.db.insert('compares', { id, game: gameId, title: String(title || '自定义局面').slice(0, 40), fen: game.fen(state), created_at: now() });
    for (const c of chars) this.db.insert('compare_answers', { compare_id: id, character_id: c.id, status: 'waiting' });
    this.#run(id, game, state, chars);
    return id;
  }

  async #run(id, game, state, chars) {
    const ch = `compare:${id}`;
    const seat = game.pending(state)[0];
    const spec = game.evalSpec?.(state);
    const before = spec ? await this.arena.evaluator.evaluate(spec).catch(() => null) : null;
    this.arena.hub.emit(ch, { type: 'eval_before', eval: before });
    this.db.update('compares', { id }, { title: this.db.get('SELECT title FROM compares WHERE id = ?', id).title });
    await Promise.all(chars.map((c) => this.#answer(id, ch, game, state, seat, c, before)));
    this.arena.hub.emit(ch, { type: 'done' });
  }

  async #answer(id, channel, game, state, seat, c, before) {
    const t0 = Date.now();
    const set = (patch) => this.db.update('compare_answers', { compare_id: id, character_id: c.id }, patch);
    set({ status: 'thinking' });
    this.arena.hub.emit(channel, { type: 'start', characterId: c.id });
    try {
      let action = null;
      let text = '';
      let reasoning = '';
      let winrate = null;
      let error = null;
      const usage = { input: 0, output: 0, cached: 0, reasoning: 0 };
      if (c.kind === 'model') {
        const system = game.systemPrompt(seat, { style: c.style, showLegal: !!c.show_legal });
        const messages = [{ role: 'user', content: game.turnPrompt(state, seat, { showLegal: !!c.show_legal }) }];
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const r = await callModel(this.db, c, system, messages, (d) => {
            this.arena.hub.emit(channel, { type: 'delta', characterId: c.id, attempt, kind: d.kind, text: d.text });
          });
          for (const k of Object.keys(usage)) usage[k] += r.usage?.[k] || 0;
          text = r.text;
          reasoning = r.reasoning;
          messages.push(r.message);
          const p = game.parseReply(state, seat, r.text);
          winrate = p.winrate;
          if (p.action) { action = p.action; error = null; break; }
          error = r.text.trim() ? p.error : '只有思考、没有给出回答（可能用完了输出长度上限）';
          this.arena.hub.emit(channel, { type: 'illegal', characterId: c.id, attempt, error });
          messages.push({ role: 'user', content: game.retryPrompt(error, attempt + 1, MAX_RETRIES) });
        }
      } else if (c.kind === 'builtin') {
        action = game.id === 'xiangqi' ? (await this.arena.aiPool.run('move', game.fen(state), c.level || 3)).move : await game.builtinMove(state, seat, { level: c.level || 2, depth: c.level || 2 });
      } else if (c.kind === 'engine') {
        action = await this.arena.evaluator.bestMove(game.evalSpec(state), c.level || 200);
      } else {
        const acts = game.actions(state, seat);
        action = acts[Math.floor(Math.random() * acts.length)].id;
      }
      let ev = null;
      if (action && before) {
        const afterSpec = game.evalSpec?.(game.apply(state, seat, action));
        const after = afterSpec ? await this.arena.evaluator.evaluate(afterSpec).catch(() => null) : null;
        if (after) ev = moveQuality(before, after, action);
      }
      const row = {
        status: action ? 'done' : 'failed', action, label: action ? game.label(state, seat, action) : null,
        analysis: text || null, reasoning: reasoning || null, self_winrate: winrate, eval: ev, usage,
        latency_ms: Date.now() - t0, error,
      };
      set(row);
      this.arena.hub.emit(channel, { type: 'answer', characterId: c.id, ...row });
    } catch (e) {
      set({ status: 'failed', error: e.message, latency_ms: Date.now() - t0 });
      this.arena.hub.emit(channel, { type: 'answer', characterId: c.id, status: 'failed', error: e.message });
    }
  }

  detail(id) {
    const cmp = this.db.get('SELECT * FROM compares WHERE id = ?', id);
    if (!cmp) throw new HttpError(404, '对比不存在');
    const answers = this.db.all(
      `SELECT a.*, c.name, c.avatar, c.kind, c.provider, c.model, c.effort, c.style FROM compare_answers a
       JOIN characters c ON c.id = a.character_id WHERE a.compare_id = ?`, id,
    );
    const game = getGame(cmp.game);
    return { ...cmp, view: game.view(game.create({ players: 2, setup: { fen: cmp.fen } }), null), answers };
  }

  list() {
    return this.db.all('SELECT * FROM compares ORDER BY created_at DESC LIMIT 50');
  }
}
