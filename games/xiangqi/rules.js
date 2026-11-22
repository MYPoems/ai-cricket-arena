// 中国象棋规则引擎：浏览器和服务端共用，不依赖任何 Node 模块。
//
// 坐标：ICCS 格式，列 a–i（红方左到右）对应 file 0–8，行 0–9（红方底线为 0）。
// 格子编号 sq = rank * 9 + file。
// 棋子用 FEN 字母：大写为红方，小写为黑方。
//   K 帅/将  A 仕/士  B 相/象  N 马  R 车  C 炮  P 兵/卒

export const FILES = 9;
export const RANKS = 10;
export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

// 和棋与禁着的限值
export const NO_CAPTURE_LIMIT = 120; // 连续 60 回合（120 步）无吃子判和
export const MAX_PLIES = 300; // 总步数上限

export const RED = 'r';
export const BLACK = 'b';

export const sq = (file, rank) => rank * FILES + file;
export const fileOf = (s) => s % FILES;
export const rankOf = (s) => Math.floor(s / FILES);
const onBoard = (f, r) => f >= 0 && f < FILES && r >= 0 && r < RANKS;

export const sideOf = (p) => (p ? (p === p.toUpperCase() ? RED : BLACK) : null);
export const opponent = (side) => (side === RED ? BLACK : RED);
const typeOf = (p) => p.toUpperCase();

const inPalace = (f, r, side) =>
  f >= 3 && f <= 5 && (side === RED ? r >= 0 && r <= 2 : r >= 7 && r <= 9);
const ownHalf = (r, side) => (side === RED ? r <= 4 : r >= 5);

// ---------- FEN ----------

/** 解析 FEN，返回内部局面（可变对象，供引擎内部使用） */
export function parseFen(fen) {
  const [placement, sideChar = 'w', , , halfmove = '0', fullmove = '1'] = fen.trim().split(/\s+/);
  const rows = placement.split('/');
  if (rows.length !== RANKS) throw new Error(`FEN 行数应为 10：${fen}`);
  const board = new Array(FILES * RANKS).fill(null);
  rows.forEach((row, i) => {
    const rank = RANKS - 1 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else {
        if (!/[kabnrcp]/i.test(ch)) throw new Error(`FEN 含未知棋子「${ch}」`);
        if (file >= FILES) throw new Error(`FEN 第 ${i + 1} 行超过 9 列`);
        board[sq(file, rank)] = ch;
        file++;
      }
    }
    if (file !== FILES) throw new Error(`FEN 第 ${i + 1} 行不是 9 列`);
  });
  return {
    board,
    side: sideChar === 'b' ? BLACK : RED,
    halfmove: Number(halfmove) || 0,
    fullmove: Number(fullmove) || 1,
  };
}

/** 只含棋子布局和走棋方的 FEN 片段，用作重复局面的键 */
export function positionKey(pos) {
  const rows = [];
  for (let rank = RANKS - 1; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < FILES; file++) {
      const p = pos.board[sq(file, rank)];
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${pos.side === RED ? 'w' : 'b'}`;
}

export function toFen(pos) {
  return `${positionKey(pos)} - - ${pos.halfmove} ${pos.fullmove}`;
}

// ---------- 着法表示 ----------

/** 着法字符串（ICCS，如 h2e2）↔ { from, to } */
export function moveToIccs(m) {
  const f = (s) => String.fromCharCode(97 + fileOf(s)) + rankOf(s);
  return f(m.from) + f(m.to);
}

export function iccsToMove(text) {
  const m = /^([a-i])([0-9])-?([a-i])([0-9])$/i.exec(String(text).trim());
  if (!m) return null;
  const s = (c, d) => sq(c.toLowerCase().charCodeAt(0) - 97, Number(d));
  return { from: s(m[1], m[2]), to: s(m[3], m[4]) };
}

// ---------- 伪合法着法生成 ----------

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
// 马：[目标偏移 df, dr, 马腿偏移 lf, lr]
const KNIGHT = [
  [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
  [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
];

/** 生成某格棋子的伪合法着法（不检查走后是否被将军） */
function pieceMoves(board, from, out) {
  const p = board[from];
  const side = sideOf(p);
  const f0 = fileOf(from);
  const r0 = rankOf(from);
  const add = (f, r) => {
    const t = sq(f, r);
    const q = board[t];
    if (!q || sideOf(q) !== side) out.push({ from, to: t });
  };
  switch (typeOf(p)) {
    case 'K':
      for (const [df, dr] of ORTHO) {
        const f = f0 + df, r = r0 + dr;
        if (inPalace(f, r, side)) add(f, r);
      }
      break;
    case 'A':
      for (const [df, dr] of DIAG) {
        const f = f0 + df, r = r0 + dr;
        if (inPalace(f, r, side)) add(f, r);
      }
      break;
    case 'B':
      for (const [df, dr] of DIAG) {
        const f = f0 + 2 * df, r = r0 + 2 * dr;
        if (!onBoard(f, r) || !ownHalf(r, side)) continue;
        if (board[sq(f0 + df, r0 + dr)]) continue; // 塞象眼
        add(f, r);
      }
      break;
    case 'N':
      for (const [df, dr, lf, lr] of KNIGHT) {
        const f = f0 + df, r = r0 + dr;
        if (!onBoard(f, r)) continue;
        if (board[sq(f0 + lf, r0 + lr)]) continue; // 蹩马腿
        add(f, r);
      }
      break;
    case 'R':
      for (const [df, dr] of ORTHO) {
        let f = f0 + df, r = r0 + dr;
        while (onBoard(f, r)) {
          const q = board[sq(f, r)];
          if (!q) out.push({ from, to: sq(f, r) });
          else {
            if (sideOf(q) !== side) out.push({ from, to: sq(f, r) });
            break;
          }
          f += df; r += dr;
        }
      }
      break;
    case 'C':
      for (const [df, dr] of ORTHO) {
        let f = f0 + df, r = r0 + dr;
        let screened = false;
        while (onBoard(f, r)) {
          const q = board[sq(f, r)];
          if (!screened) {
            if (!q) out.push({ from, to: sq(f, r) });
            else screened = true; // 找到炮架
          } else if (q) {
            if (sideOf(q) !== side) out.push({ from, to: sq(f, r) }); // 隔一子吃子
            break;
          }
          f += df; r += dr;
        }
      }
      break;
    case 'P': {
      const fwd = side === RED ? 1 : -1;
      if (onBoard(f0, r0 + fwd)) add(f0, r0 + fwd);
      if (!ownHalf(r0, side)) {
        // 过河后可以横走
        if (onBoard(f0 - 1, r0)) add(f0 - 1, r0);
        if (onBoard(f0 + 1, r0)) add(f0 + 1, r0);
      }
      break;
    }
  }
}

export function findKing(board, side) {
  const k = side === RED ? 'K' : 'k';
  for (let s = 3; s < board.length; s++) {
    if (board[s] === k) return s;
  }
  return -1;
}

/** side 方的将帅是否正被攻击（含将帅照面） */
export function inCheck(board, side) {
  const ks = findKing(board, side);
  if (ks < 0) return true;
  const kf = fileOf(ks), kr = rankOf(ks);
  const enemy = opponent(side);
  const isEnemy = (p, t) => p && sideOf(p) === enemy && typeOf(p) === t;

  // 直线：车、将帅照面（竖直方向）、炮（隔一子）
  for (const [df, dr] of ORTHO) {
    let f = kf + df, r = kr + dr;
    let seen = 0;
    while (onBoard(f, r)) {
      const q = board[sq(f, r)];
      if (q) {
        if (seen === 0) {
          if (isEnemy(q, 'R')) return true;
          if (df === 0 && isEnemy(q, 'K')) return true;
          seen = 1;
        } else {
          if (isEnemy(q, 'C')) return true;
          break;
        }
      }
      f += df; r += dr;
    }
  }
  // 马：马在 N，马腿在马的一侧（靠近将帅的方向）
  for (const [df, dr, lf, lr] of KNIGHT) {
    // 马从 (kf - df, kr - dr) 跳到将帅位置，马腿在马的位置加 (lf, lr)
    const nf = kf - df, nr = kr - dr;
    if (!onBoard(nf, nr)) continue;
    if (!isEnemy(board[sq(nf, nr)], 'N')) continue;
    if (!board[sq(nf + lf, nr + lr)]) return true;
  }
  // 兵卒：敌兵在前方一格，或在左右一格（过河兵）
  const enemyFwd = enemy === RED ? 1 : -1;
  const pr = kr - enemyFwd;
  if (onBoard(kf, pr) && isEnemy(board[sq(kf, pr)], 'P')) return true;
  for (const df of [-1, 1]) {
    const f = kf + df;
    if (onBoard(f, kr) && isEnemy(board[sq(f, kr)], 'P') && !ownHalf(kr, enemy)) return true;
  }
  return false;
}

/** 当前走棋方的全部合法着法 */
export function legalMoves(pos) {
  const pseudo = [];
  const { board, side } = pos;
  for (let s = 0; s < board.length; s++) {
    if (board[s] && sideOf(board[s]) === side) pieceMoves(board, s, pseudo);
  }
  const legal = [];
  for (const m of pseudo) {
    const captured = board[m.to];
    board[m.to] = board[m.from];
    board[m.from] = null;
    if (!inCheck(board, side)) legal.push(m);
    board[m.from] = board[m.to];
    board[m.to] = captured;
  }
  return legal;
}

/** 某个棋子的合法落点（界面高亮用） */
export function legalTargets(pos, from) {
  return legalMoves(pos).filter((m) => m.from === from).map((m) => m.to);
}

export function isLegal(pos, move) {
  return legalMoves(pos).some((m) => m.from === move.from && m.to === move.to);
}

// ---------- 走子（就地修改，返回撤销信息） ----------

export function makeMove(pos, m) {
  const captured = pos.board[m.to];
  const undo = { from: m.from, to: m.to, captured, halfmove: pos.halfmove, fullmove: pos.fullmove };
  pos.board[m.to] = pos.board[m.from];
  pos.board[m.from] = null;
  pos.halfmove = captured ? 0 : pos.halfmove + 1;
  if (pos.side === BLACK) pos.fullmove++;
  pos.side = opponent(pos.side);
  return undo;
}

export function unmakeMove(pos, u) {
  pos.side = opponent(pos.side);
  pos.board[u.from] = pos.board[u.to];
  pos.board[u.to] = u.captured;
  pos.halfmove = u.halfmove;
  pos.fullmove = u.fullmove;
}

export function clonePos(pos) {
  return { ...pos, board: pos.board.slice() };
}

/** 走法计数（校验规则正确性） */
export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const u = makeMove(pos, m);
    n += perft(pos, depth - 1);
    unmakeMove(pos, u);
  }
  return n;
}

// ---------- 对局状态与胜负 ----------
//
// 对局状态（不可变，供框架使用）：
// { fen: 起始 FEN, pos: 当前局面, moves: [{ iccs, captured, check, key }], keys: [每个局面的键] }

export function newGame(fen = START_FEN) {
  const pos = parseFen(fen);
  return { startFen: toFen(pos), pos, moves: [], keys: [positionKey(pos)] };
}

/** 走一步，返回新的对局状态；不合法时抛错 */
export function play(game, move) {
  const m = typeof move === 'string' ? iccsToMove(move) : move;
  if (!m || !isLegal(game.pos, m)) {
    throw new Error(`不合法的着法：${typeof move === 'string' ? move : moveToIccs(move)}`);
  }
  const pos = clonePos(game.pos);
  const mover = pos.side;
  const piece = pos.board[m.from];
  const u = makeMove(pos, m);
  const check = inCheck(pos.board, pos.side);
  const key = positionKey(pos);
  return {
    startFen: game.startFen,
    pos,
    moves: [...game.moves, { iccs: moveToIccs(m), piece, captured: u.captured, check, side: mover }],
    keys: [...game.keys, key],
  };
}

/**
 * 判断对局是否结束。
 * 返回 { over, winner: 'r' | 'b' | null, reason }
 */
export function result(game) {
  const { pos, moves, keys } = game;
  const side = pos.side;
  if (legalMoves(pos).length === 0) {
    const checked = inCheck(pos.board, side);
    return { over: true, winner: opponent(side), reason: checked ? '将死' : '困毙' };
  }
  // 重复局面：当前局面出现第三次
  const cur = keys[keys.length - 1];
  const idx = [];
  keys.forEach((k, i) => { if (k === cur) idx.push(i); });
  if (idx.length >= 3) {
    // 检查最近两次重复之间的循环里，是否有一方每步都在将军
    const start = idx[idx.length - 3];
    const span = moves.slice(start); // keys[i] 是第 i 步之后的局面，moves[i] 是第 i+1 步
    const perSide = { r: [], b: [] };
    for (const mv of span) perSide[mv.side].push(mv.check);
    const allCheck = (arr) => arr.length > 0 && arr.every(Boolean);
    const rLong = allCheck(perSide.r);
    const bLong = allCheck(perSide.b);
    if (rLong && !bLong) return { over: true, winner: BLACK, reason: '红方长将判负' };
    if (bLong && !rLong) return { over: true, winner: RED, reason: '黑方长将判负' };
    return { over: true, winner: null, reason: '重复局面判和' };
  }
  if (pos.halfmove >= NO_CAPTURE_LIMIT) return { over: true, winner: null, reason: '60 回合无吃子判和' };
  if (moves.length >= MAX_PLIES) return { over: true, winner: null, reason: `达到 ${MAX_PLIES} 步上限判和` };
  return { over: false, winner: null, reason: '' };
}
