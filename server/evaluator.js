// 局面评估：优先用 Pikafish（engines/ 目录下），没有时退回内置 AI 的粗略评估。
// 评估结果只给观众看，绝不放进给模型的提示词。
//
// evaluate(fen) → { e: 走棋方的期望得分 0–1, cp, mate, wdl, best, source }

import { spawn } from 'node:child_process';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const logistic = (cp) => 1 / (1 + Math.exp(-cp / 300));

export function findPikafish(dir) {
  if (!existsSync(dir)) return null;
  const want = process.platform === 'win32' ? /pikafish.*\.exe$/i : /^pikafish(?!.*\.(exe|nnue|7z|zip|txt|md)$)/i;
  const files = [];
  const walk = (d, depth) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (depth < 3) walk(p, depth + 1); }
      else if (want.test(f)) files.push(p);
    }
  };
  walk(dir, 0);
  // Pikafish 发布包里有多个 CPU 版本，优先自动识别 CPU 的 universal 版
  const arch = process.platform === 'win32' ? /windows/i : process.platform === 'darwin' ? /mac|apple|darwin/i : /linux/i;
  files.sort((a, b) => score(b) - score(a));
  function score(p) {
    return (arch.test(p) ? 10 : 0) + (/universal/i.test(p) ? 5 : 0) + (/x86-64(?!-)/i.test(p) ? 1 : 0);
  }
  return files[0] || null;
}

class Pikafish {
  constructor(bin) {
    this.bin = bin;
    this.queue = Promise.resolve();
    this.listeners = new Set();
    this.dead = false;
  }

  async start() {
    this.proc = spawn(this.bin, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.proc.on('exit', () => { this.dead = true; });
    this.proc.on('error', () => { this.dead = true; });
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      for (const l of this.listeners) l(line);
    });
    await this.#cmd('uci', (l) => l === 'uciok', 10000);
    this.#send('setoption name UCI_ShowWDL value true');
    this.#send('setoption name Threads value 1');
    this.#send('setoption name Hash value 64');
    await this.#cmd('isready', (l) => l === 'readyok', 30000);
  }

  #send(s) {
    this.proc.stdin.write(`${s}\n`);
  }

  #cmd(cmd, done, timeoutMs, onLine) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(fn); reject(new Error(`Pikafish 响应超时：${cmd}`)); }, timeoutMs);
      const fn = (line) => {
        onLine?.(line);
        if (done(line)) { clearTimeout(timer); this.listeners.delete(fn); resolve(line); }
      };
      this.listeners.add(fn);
      this.#send(cmd);
    });
  }

  evaluate(fen, movetime) {
    const job = async () => {
      if (this.dead) throw new Error('Pikafish 已退出');
      let info = null;
      this.#send(`position fen ${fen}`);
      const best = await this.#cmd(`go movetime ${movetime}`, (l) => l.startsWith('bestmove'), movetime + 15000, (l) => {
        if (l.startsWith('info') && / score /.test(l) && !/ multipv [2-9]/.test(l)) info = l;
      });
      const bm = best.split(/\s+/)[1];
      const out = { best: bm && bm !== '(none)' ? bm : null, source: 'pikafish' };
      if (info) {
        const cp = / score cp (-?\d+)/.exec(info);
        const mate = / score mate (-?\d+)/.exec(info);
        const wdl = / wdl (\d+) (\d+) (\d+)/.exec(info);
        if (cp) out.cp = Number(cp[1]);
        if (mate) out.mate = Number(mate[1]);
        if (wdl) out.wdl = [Number(wdl[1]), Number(wdl[2]), Number(wdl[3])];
      }
      if (out.wdl) out.e = (out.wdl[0] + out.wdl[1] / 2) / 1000;
      else if (out.mate !== undefined) out.e = out.mate > 0 ? 1 : 0;
      else if (out.cp !== undefined) out.e = logistic(out.cp);
      else out.e = 0.5;
      return out;
    };
    const p = this.queue.then(job, job);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() {
    try { this.#send('quit'); } catch { /* 进程已退出 */ }
    setTimeout(() => this.proc?.kill(), 500).unref();
  }
}

export class Evaluator {
  constructor({ enginesDir, aiPool, movetime = 300 }) {
    this.enginesDir = enginesDir;
    this.aiPool = aiPool;
    this.movetime = movetime;
    this.engine = null;
    this.error = null;
  }

  async init() {
    const bin = findPikafish(this.enginesDir);
    if (!bin) { this.engine = null; return this.status(); }
    try {
      const e = new Pikafish(bin);
      await e.start();
      this.engine = e;
      this.error = null;
    } catch (err) {
      this.engine = null;
      this.error = err.message;
    }
    return this.status();
  }

  status() {
    return { source: this.engine && !this.engine.dead ? 'pikafish' : 'builtin', error: this.error, movetime: this.movetime };
  }

  /** 评估局面（走棋方视角） */
  async evaluate(fen) {
    if (this.engine && !this.engine.dead) {
      try {
        return await this.engine.evaluate(fen, this.movetime);
      } catch (err) {
        this.error = err.message;
      }
    }
    const r = await this.aiPool.run('eval', fen, 2);
    const s = Math.max(-5000, Math.min(5000, r.score));
    return { e: r.score <= -90000 ? 0 : r.score >= 90000 ? 1 : logistic(s), cp: s, best: r.move, source: 'builtin' };
  }

  /** 引擎当选手走棋 */
  async bestMove(fen, movetime) {
    if (!this.engine || this.engine.dead) throw new Error('没有可用的 Pikafish');
    const saved = this.movetime;
    const r = await this.engine.evaluate(fen, movetime || saved);
    return r.best;
  }

  stop() {
    this.engine?.stop();
  }
}

/**
 * 着法质量：比较走前和走后的期望得分（走棋方视角）。
 * before: 走前局面评估（走棋方 = 本方），after: 走后局面评估（走棋方 = 对方）
 */
export function moveQuality(before, after, played) {
  const eBefore = before.e;
  const eAfter = 1 - after.e;
  const loss = Math.max(0, eBefore - eAfter);
  let tag;
  if (played && before.best === played) tag = '最佳';
  else if (loss >= 0.2) tag = '大漏着';
  else if (loss >= 0.1) tag = '失误';
  else if (loss >= 0.05) tag = '缓着';
  else tag = '好棋';
  return { before: eBefore, after: eAfter, loss: Math.round(loss * 1000) / 1000, best: before.best, tag };
}
