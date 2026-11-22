// 后台线程：内置 AI 的搜索比较耗 CPU，放在 worker 里，避免卡住网页服务和实时推送。

import { parentPort, Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

if (parentPort) {
  const { parseFen, moveToIccs } = await import('../games/xiangqi/rules.js');
  const { chooseMove } = await import('../games/xiangqi/ai.js');
  parentPort.on('message', ({ id, op, fen, depth }) => {
    try {
      const pos = parseFen(fen);
      const c = chooseMove(pos, { depth, random: op === 'move' ? 0.15 : 0 });
      parentPort.postMessage({ id, ok: true, move: c ? moveToIccs(c.move) : null, score: c ? c.score : -100000 });
    } catch (e) {
      parentPort.postMessage({ id, ok: false, error: e.message });
    }
  });
}

/** 主线程使用的小线程池 */
export class AiPool {
  constructor(size = 2) {
    this.workers = [];
    this.queue = [];
    this.pending = new Map();
    this.seq = 0;
    const file = fileURLToPath(import.meta.url);
    for (let i = 0; i < size; i++) {
      const w = new Worker(file);
      w.busy = false;
      w.on('message', (msg) => {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        w.busy = false;
        if (p) (msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error)));
        this.#next();
      });
      w.unref();
      this.workers.push(w);
    }
  }

  run(op, fen, depth) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.queue.push({ id, op, fen, depth });
      this.pending.set(id, { resolve, reject });
      this.#next();
    });
  }

  #next() {
    const w = this.workers.find((x) => !x.busy);
    if (!w || !this.queue.length) return;
    w.busy = true;
    w.postMessage(this.queue.shift());
  }

  close() {
    for (const w of this.workers) w.terminate();
  }
}
