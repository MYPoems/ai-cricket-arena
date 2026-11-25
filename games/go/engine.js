// 围棋快速棋盘、随机对局（playout）与蒙特卡洛树搜索（MCTS / RAVE）。内置 AI、局面评估、终局死子判定共用。
// 只用整数运算和自带的种子随机数，浏览器和 Node 跑出完全相同的结果（终局死子判定要在两边一致）。
//
// 棋盘：外加一圈边界的一维数组，宽 W = size + 2；点 p = (y + 1) * W + (x + 1)，y 从下往上。
// 颜色：0 空、1 黑、2 白、3 边界。棋串用循环链表（next）+ 串头（head）+ 伪气数（plib，同一个空点被同一串的几颗子
// 挨着就算几次；伪气为 0 当且仅当真气为 0）。真气数按需沿链表数（libs）。

/** 小而快的种子随机数（mulberry32），返回 [0, 1) */
export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字符串 → 32 位种子（FNV-1a） */
export function seedOf(text) {
  let h = 0x811C9DC5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export class FastBoard {
  constructor(size) {
    const W = size + 2, N = W * W;
    this.size = size; this.W = W; this.N = N;
    this.col = new Int8Array(N).fill(3);
    this.head = new Int16Array(N);
    this.next = new Int16Array(N);
    this.csize = new Int16Array(N);
    this.plib = new Int16Array(N);
    this.empty = new Int16Array(size * size); // 空点列表（随机选点用）
    this.eidx = new Int16Array(N);
    this.ne = 0;
    this.mark = new Int32Array(N);
    this.stamp = 0;
    this.ko = 0; // 简单劫：下一手不能下的点
    this.toMove = 1;
    this.last = 0; // 上一手的点（0 = 虚手或开局）
    this.passes = 0;
    this.lastLib = 0;
    this.saSize = 0; // selfAtari 最近一次算出的「落子后这串有几颗子」
    this.hot = []; // 随机对局里要盯着的串（根局面上被打吃的串，各取一颗子）
    this.dirs = [1, -1, W, -W];
    this.diag = [W + 1, W - 1, 1 - W, -1 - W];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const p = (y + 1) * W + x + 1;
      this.col[p] = 0;
      this.eidx[p] = this.ne;
      this.empty[this.ne++] = p;
    }
  }

  pt(x, y) { return (y + 1) * this.W + x + 1; }
  xy(p) { return [(p % this.W) - 1, Math.floor(p / this.W) - 1]; }

  /** 从 rules 的棋盘数组（'b' / 'w' / null，下标 y * size + x）建立；不做提子，按原样摆 */
  static from(board, size, toMove = 1) {
    const fb = new FastBoard(size);
    for (let i = 0; i < size * size; i++) {
      const c = board[i] === 'b' ? 1 : board[i] === 'w' ? 2 : 0;
      if (!c) continue;
      const p = fb.pt(i % size, Math.floor(i / size));
      fb.col[p] = c;
      fb.#removeEmpty(p);
    }
    // 建串：同色相连的子并到一起
    const seen = new Uint8Array(fb.N);
    for (let p = 0; p < fb.N; p++) {
      const c = fb.col[p];
      if ((c !== 1 && c !== 2) || seen[p]) continue;
      const stack = [p];
      seen[p] = 1;
      let prev = p, n = 0, pl = 0;
      while (stack.length) {
        const s = stack.pop();
        fb.head[s] = p;
        if (s !== p) { fb.next[prev] = s; prev = s; }
        n++;
        for (const d of fb.dirs) {
          const q = s + d;
          if (fb.col[q] === 0) pl++;
          else if (fb.col[q] === c && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      fb.next[prev] = p;
      fb.csize[p] = n;
      fb.plib[p] = pl;
    }
    fb.toMove = toMove;
    return fb;
  }

  copyFrom(o) {
    this.col.set(o.col); this.head.set(o.head); this.next.set(o.next);
    this.csize.set(o.csize); this.plib.set(o.plib);
    this.empty.set(o.empty); this.eidx.set(o.eidx); this.ne = o.ne;
    this.ko = o.ko; this.toMove = o.toMove; this.last = o.last; this.passes = o.passes;
  }

  #removeEmpty(p) {
    const k = this.eidx[p], lastP = this.empty[--this.ne];
    this.empty[k] = lastP;
    this.eidx[lastP] = k;
  }

  #addEmpty(p) {
    this.eidx[p] = this.ne;
    this.empty[this.ne++] = p;
  }

  #tick() {
    if (++this.stamp > 1e9) { this.mark.fill(0); this.stamp = 1; }
    return this.stamp;
  }

  /** 串 h 的真气数，数到 max 为止；最后数到的一口气记在 lastLib */
  libs(h, max = 999) {
    const st = this.#tick();
    const { col, mark, next } = this;
    let n = 0, s = h;
    do {
      for (let k = 0; k < 4; k++) {
        const q = s + this.dirs[k];
        if (col[q] === 0 && mark[q] !== st) {
          mark[q] = st; n++; this.lastLib = q;
          if (n >= max) return n;
        }
      }
      s = next[s];
    } while (s !== h);
    return n;
  }

  /** p 是 c 方的「像眼」的点：四邻都是自己或边界，斜角里对方子不超过 1 个（在边上不能有） */
  eyeish(p, c) {
    const col = this.col;
    for (let k = 0; k < 4; k++) { const v = col[p + this.dirs[k]]; if (v !== c && v !== 3) return false; }
    let bad = 0, edge = 0;
    for (let k = 0; k < 4; k++) { const v = col[p + this.diag[k]]; if (v === 3) edge = 1; else if (v === 3 - c) bad++; }
    return edge ? bad === 0 : bad <= 1;
  }

  /** c 方在 p 落子是否合法（只查简单劫，不查全局同形） */
  legal(p, c) {
    const col = this.col;
    if (col[p] !== 0 || p === this.ko) return false;
    for (let k = 0; k < 4; k++) if (col[p + this.dirs[k]] === 0) return true;
    for (let k = 0; k < 4; k++) {
      const q = p + this.dirs[k], v = col[q];
      if (v === c) { if (this.libs(this.head[q], 2) >= 2) return true; } else if (v === 3 - c) { if (this.libs(this.head[q], 2) === 1) return true; }
    }
    return false;
  }

  /** 落子后自己这串只剩一口气（且提不到子）：自填一气，送吃 */
  selfAtari(p, c) {
    const col = this.col, opp = 3 - c;
    // 能提子就不算
    for (let k = 0; k < 4; k++) {
      const q = p + this.dirs[k];
      if (col[q] === opp && this.libs(this.head[q], 2) === 1) return false;
    }
    const st = this.#tick();
    const mark = this.mark;
    mark[p] = st;
    let n = 0, stones = 1;
    for (let k = 0; k < 4; k++) {
      const q = p + this.dirs[k];
      if (col[q] === 0 && mark[q] !== st) { mark[q] = st; if (++n >= 2) return false; }
    }
    for (let k = 0; k < 4; k++) {
      const q = p + this.dirs[k];
      if (col[q] !== c) continue;
      const h = this.head[q];
      let s = h;
      do {
        if (mark[s] !== st) { mark[s] = st; stones++; }
        for (let j = 0; j < 4; j++) {
          const r = s + this.dirs[j];
          if (col[r] === 0 && mark[r] !== st) { mark[r] = st; if (++n >= 2) return false; }
        }
        s = this.next[s];
      } while (s !== h);
    }
    // 单子扑入（打劫、倒扑）不算送吃，交给 MCTS 判断
    this.saSize = stones;
    return stones > 1 || n === 0;
  }

  #merge(a, b) {
    if (this.csize[a] < this.csize[b]) { const t = a; a = b; b = t; }
    const { head, next } = this;
    let s = b;
    do { head[s] = a; s = next[s]; } while (s !== b);
    const t = next[a]; next[a] = next[b]; next[b] = t;
    this.csize[a] += this.csize[b];
    this.plib[a] += this.plib[b];
    return a;
  }

  #remove(h) {
    const { col, next, head, plib } = this;
    let s = h;
    do { col[s] = 0; this.#addEmpty(s); s = next[s]; } while (s !== h);
    s = h;
    do {
      for (let k = 0; k < 4; k++) {
        const q = s + this.dirs[k], v = col[q];
        if (v === 1 || v === 2) plib[head[q]]++;
      }
      s = next[s];
    } while (s !== h);
  }

  /** 落子（调用前要确认合法）。返回提子数 */
  play(p, c) {
    const { col, head, plib, dirs } = this;
    const opp = 3 - c;
    this.ko = 0;
    col[p] = c; head[p] = p; this.next[p] = p; this.csize[p] = 1;
    this.#removeEmpty(p);
    let pl = 0;
    for (let k = 0; k < 4; k++) {
      const v = col[p + dirs[k]];
      if (v === 0) pl++;
      else if (v === 1 || v === 2) plib[head[p + dirs[k]]]--;
    }
    plib[p] = pl;
    let h = p;
    for (let k = 0; k < 4; k++) {
      const q = p + dirs[k];
      if (col[q] === c && head[q] !== h) h = this.#merge(h, head[q]);
    }
    let captured = 0, capPt = 0;
    for (let k = 0; k < 4; k++) {
      const q = p + dirs[k];
      if (col[q] === opp && plib[head[q]] === 0) { captured += this.csize[head[q]]; capPt = q; this.#remove(head[q]); }
    }
    h = head[p];
    if (captured === 1 && this.csize[h] === 1 && this.libs(h, 2) === 1) this.ko = capPt;
    this.last = p;
    this.passes = 0;
    this.toMove = opp;
    return captured;
  }

  pass() {
    this.ko = 0;
    this.last = 0;
    this.passes++;
    this.toMove = 3 - this.toMove;
  }

  /** 随机对局的一步：先看上一手附近有没有能提的子、要逃的子，再在空点里随机挑（不填自己的眼、尽量不送吃） */
  policyMove(c, rand, heavy) {
    const L = this.last;
    if (L && heavy) {
      const opp = 3 - c;
      const col = this.col;
      // 1. 上一手那串（以及它旁边对方的串）被打吃：提掉
      if (col[L] === opp && this.libs(this.head[L], 2) === 1) {
        const lib = this.lastLib;
        if (this.legal(lib, c)) return lib;
      }
      // 2. 上一手打吃了自己的串：长出去（长完至少两口气），或者提掉打吃它的子
      for (let k = 0; k < 4; k++) {
        const q = L + this.dirs[k];
        if (col[q] !== c || this.libs(this.head[q], 2) !== 1) continue;
        const lib = this.lastLib;
        if (this.legal(lib, c) && !this.selfAtari(lib, c)) return lib;
      }
      // 3. 根局面上就被打吃的串（hot）：还被打吃着的话，自己的逃、对方的提
      for (let k = 0; k < this.hot.length; k++) {
        const q = this.hot[k], v = col[q];
        if ((v !== 1 && v !== 2) || this.libs(this.head[q], 2) !== 1) continue;
        const lib = this.lastLib;
        if (!this.legal(lib, c)) continue;
        if (v === opp || !this.selfAtari(lib, c)) return lib;
      }
      // 4. 上一手周围 8 个点里随机挑一个不送吃的（局部应对）
      if (heavy > 1 && rand() < 0.5) {
        const W = this.W;
        const around = [L + 1, L - 1, L + W, L - W, L + W + 1, L + W - 1, L - W + 1, L - W - 1];
        const start = (rand() * 8) | 0;
        for (let k = 0; k < 8; k++) {
          const q = around[(start + k) & 7];
          if (col[q] === 0 && this.legal(q, c) && !this.eyeish(q, c) && !this.selfAtari(q, c)) return q;
        }
      }
    }
    const n = this.ne;
    if (!n) return 0;
    const start = (rand() * n) | 0;
    let fallback = 0;
    for (let k = 0; k < n; k++) {
      const p = this.empty[(start + k) % n];
      if (!this.legal(p, c) || this.eyeish(p, c)) continue;
      // 送吃的点先跳过；实在没有别的点时，只肯送三颗以内（点眼、聚杀用得着），更大的一串宁可虚手——
      // 否则双活的棋会因为「没别处可下」自己填掉公气被提，终局判死活、搜索都会把双活看成死棋
      if (heavy && this.selfAtari(p, c)) { if (!fallback && this.saSize <= 3) fallback = p; continue; }
      return p;
    }
    return fallback;
  }

  /** 从当前局面随机下到双方连续虚手（或步数上限）。amaf：记下每个点第一次由哪方落子（可为 null） */
  playout(rand, heavy, amaf) {
    const limit = this.size * this.size * 3;
    for (let k = 0; k < limit && this.passes < 2; k++) {
      const c = this.toMove;
      const p = this.policyMove(c, rand, heavy);
      if (!p) { this.pass(); continue; }
      if (amaf && !amaf[p]) amaf[p] = c;
      this.play(p, c);
    }
  }

  /** 粗略数子（随机对局下完时用）：子 + 只挨着一方的空点。owner 填 1 / 2 / 0。返回黑减白 */
  areaDiff(owner) {
    const { col, size, W } = this;
    let d = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const p = (y + 1) * W + x + 1;
      let o = col[p];
      if (o === 0) {
        let b = 0, w = 0;
        for (let k = 0; k < 4; k++) { const v = col[p + this.dirs[k]]; if (v === 1) b = 1; else if (v === 2) w = 1; }
        o = b && !w ? 1 : w && !b ? 2 : 0;
      }
      if (owner) owner[p] = o;
      if (o === 1) d++; else if (o === 2) d--;
    }
    return d;
  }
}

/**
 * 归属估计：从 fb 出发跑 n 局随机对局（黑先、白先各一半），返回每个点 [-1, 1] 的平均归属（正 = 黑），按 rules 下标排。
 * 带种子，结果完全确定。
 */
export function ownership(fb, n, seed) {
  const rand = rng32(seed);
  const sum = new Int32Array(fb.N);
  const owner = new Int8Array(fb.N);
  const b = new FastBoard(fb.size);
  for (let k = 0; k < n; k++) {
    b.copyFrom(fb);
    b.toMove = k & 1 ? 2 : 1;
    b.ko = 0; b.last = 0; b.passes = 0;
    b.playout(rand, 1, null);
    b.areaDiff(owner);
    for (let p = 0; p < fb.N; p++) { const o = owner[p]; if (o === 1) sum[p]++; else if (o === 2) sum[p]--; }
  }
  const out = new Array(fb.size * fb.size);
  for (let y = 0; y < fb.size; y++) for (let x = 0; x < fb.size; x++) out[y * fb.size + x] = sum[fb.pt(x, y)] / n;
  return out;
}

// ---------- 蒙特卡洛树搜索 ----------

class Node {
  constructor(mv, color) {
    this.mv = mv; this.color = color; // 走到这个节点的那一手、走这手的一方
    this.n = 0; this.w = 0; // 访问数、胜局数（对 color 方），含先验的虚拟局数
    this.v = 0; // 真实访问数
    this.rn = 0; this.rw = 0; // AMAF（RAVE）统计
    this.kids = null;
    this.urgent = false; // 提子或逃子
  }
}

/** 先验：把常识折算成几局虚拟胜负（提子、逃子加分，送吃、开局下一线减分，挨着上一手稍加） */
function addPriors(fb, node, c, cfg) {
  const kids = [];
  const opp = 3 - c;
  const L = fb.last;
  const stones = fb.size * fb.size - fb.ne;
  for (let k = 0; k < fb.ne; k++) {
    const p = fb.empty[k];
    if (!fb.legal(p, c) || fb.eyeish(p, c)) continue;
    const kid = new Node(p, c);
    let n = cfg.prior, w = cfg.prior / 2;
    const selfAtari = fb.selfAtari(p, c);
    for (let j = 0; j < 4; j++) {
      const q = p + fb.dirs[j], v = fb.col[q];
      // 提子：随机对局里对方很少想到逃，提子的价值看不出来，先验给得重一些（按提子数加）
      if (v === opp && fb.libs(fb.head[q], 2) === 1) { const b = 12 + 6 * Math.min(4, fb.csize[fb.head[q]]); n += b; w += b; kid.urgent = true; }
      // 逃子：被打吃的串长出去（长完不是又被打吃）
      else if (v === c && !selfAtari && fb.libs(fb.head[q], 2) === 1) { const b = 10 + 5 * Math.min(4, fb.csize[fb.head[q]]); n += b; w += b; kid.urgent = true; }
    }
    if (selfAtari) n += 12;
    const [x, y] = fb.xy(p);
    const edge = Math.min(x, y, fb.size - 1 - x, fb.size - 1 - y);
    if (edge === 0 && stones < fb.size * fb.size / 3) n += 6;
    if (L) {
      const dx = Math.abs(x - fb.xy(L)[0]), dy = Math.abs(y - fb.xy(L)[1]);
      if (dx <= 1 && dy <= 1) { n += 3; w += 3; }
    }
    kid.n = n; kid.w = w;
    kid.rn = n; kid.rw = w; // 先验同时记进 AMAF（同 Michi），免得 RAVE 一上来就盖过先验
    kids.push(kid);
  }
  node.kids = kids;
}

function selectChild(node, cfg) {
  let best = null, bestV = -1;
  const logN = Math.log(node.n + 1);
  for (const k of node.kids) {
    const q = k.w / k.n;
    let v = q;
    if (cfg.rave && k.rn) {
      const beta = k.rn / (k.rn + k.n + k.rn * k.n / cfg.raveEquiv);
      v = (1 - beta) * q + beta * (k.rw / k.rn);
    }
    v += cfg.c * Math.sqrt(logN / k.n);
    if (v > bestV) { bestV = v; best = k; }
  }
  return best;
}

/**
 * 搜索：fb 为根局面（fb.toMove 走棋），rootMoves 为根上允许的点（已排除全局同形禁着）。
 * cfg：{ timeMs, maxPlayouts, rave, prior, c, heavy, expandAt, komi, seed }
 * 返回 { best（点或 0 = 没有可下的）, winrate（根走棋方）, playouts, own（每个 FastBoard 点的平均归属，正 = 黑）, kids }
 */
export function search(fb, rootMoves, cfg) {
  const rand = rng32(cfg.seed ?? (Math.random() * 2 ** 32));
  const me = fb.toMove;
  const root = new Node(0, 3 - me);
  addPriors(fb, root, me, cfg);
  const allowed = new Set(rootMoves);
  root.kids = root.kids.filter((k) => allowed.has(k.mv));
  // 根上的提子、逃子再加一大笔先验：随机对局分辨不出一两颗子的得失，不加的话常常放着能提的子不提
  if (cfg.urgent) for (const k of root.kids) if (k.urgent) { k.n += cfg.urgent; k.w += cfg.urgent; k.rn += cfg.urgent; k.rw += cfg.urgent; }
  // 根上被 eyeish 过滤掉但合法的点也不考虑（填自己的眼没有意义）
  const own = new Float64Array(fb.N);
  if (!root.kids.length) return { best: 0, winrate: null, playouts: 0, own, kids: [] };
  const b = new FastBoard(fb.size);
  for (let k = 0; k < fb.N; k++) {
    const v = fb.col[k];
    if ((v === 1 || v === 2) && fb.head[k] === k && fb.libs(k, 2) === 1) b.hot.push(k);
  }
  const amaf = new Int8Array(fb.N);
  const owner = new Int8Array(fb.N);
  const t0 = now();
  const deadline = t0 + (cfg.timeMs ?? 500);
  const maxP = cfg.maxPlayouts ?? Infinity;
  const komi = cfg.komi ?? 7.5;
  let playouts = 0, rootWins = 0, sumDiff = 0;
  const path = [];
  while (playouts < maxP) {
    if ((playouts & 15) === 0 && playouts >= (cfg.minPlayouts ?? 0) && now() > deadline) break;
    b.copyFrom(fb);
    amaf.fill(0);
    path.length = 0;
    path.push(root);
    let node = root;
    while (node.kids && node.kids.length) {
      const k = selectChild(node, cfg);
      if (!b.legal(k.mv, k.color)) break; // 树里遇到简单劫的禁着：从这里开始随机下
      if (!amaf[k.mv]) amaf[k.mv] = k.color;
      b.play(k.mv, k.color);
      node = k;
      path.push(node);
      if (!node.kids && node.v >= cfg.expandAt) addPriors(b, node, b.toMove, cfg);
    }
    b.playout(rand, cfg.heavy, amaf);
    const diff = b.areaDiff(owner) - komi;
    const winner = diff > 0 ? 1 : 2;
    playouts++;
    if (winner === me) rootWins++;
    sumDiff += diff;
    for (let p = 0; p < fb.N; p++) { const o = owner[p]; if (o === 1) own[p]++; else if (o === 2) own[p]--; }
    for (const nd of path) {
      nd.n++; nd.v++;
      if (nd.color === winner) nd.w++;
      if (cfg.rave && nd.kids) {
        for (const k of nd.kids) {
          if (amaf[k.mv] === k.color) { k.rn++; if (k.color === winner) k.rw++; }
        }
      }
    }
  }
  for (let p = 0; p < fb.N; p++) own[p] /= Math.max(1, playouts);
  let best = root.kids[0];
  for (const k of root.kids) if (k.n > best.n) best = k;
  const meanDiff = playouts ? (me === 1 ? 1 : -1) * sumDiff / playouts : 0;
  return { best: best.mv, winrate: best.w / best.n, rootWin: playouts ? rootWins / playouts : 0.5, meanDiff, playouts, own, kids: root.kids, ms: now() - t0 };
}
