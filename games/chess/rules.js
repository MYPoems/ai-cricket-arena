// 国际象棋规则引擎：浏览器和服务端共用，不依赖任何 Node 模块。
//
// 坐标：列 a–h（白方左到右）对应 file 0–7，行 1–8（白方底线为 1）对应 rank 0–7。
// 格子编号 sq = rank * 8 + file（a1 = 0，h8 = 63）。
// 棋子用 FEN 字母：大写为白方，小写为黑方。K 王 Q 后 R 车 B 象 N 马 P 兵。
//
// 局面 pos = { board: [64], side: 'w'|'b', castling: 位掩码（1=K 2=Q 4=k 8=q）, ep: 过路兵格或 -1, halfmove, fullmove }
// 着法 m = { from, to, piece, captured, promo, flag }，flag：'n' 普通 'd' 兵走两格 'e' 吃过路兵 'k' 短易位 'q' 长易位

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const WHITE = 'w';
export const BLACK = 'b';
export const FILE_CHARS = 'abcdefgh';

export const sq = (file, rank) => rank * 8 + file;
export const fileOf = (s) => s & 7;
export const rankOf = (s) => s >> 3;
export const sqName = (s) => FILE_CHARS[s & 7] + ((s >> 3) + 1);
export function parseSq(t) {
  const m = /^([a-h])([1-8])$/.exec(String(t));
  return m ? sq(FILE_CHARS.indexOf(m[1]), Number(m[2]) - 1) : -1;
}

export const sideOf = (p) => (p ? (p < 'a' ? WHITE : BLACK) : null);
export const opponent = (side) => (side === WHITE ? BLACK : WHITE);
const isWhite = (p) => p < 'a';

// ---------- 预计算的走子表 ----------

const KNIGHT_T = [];
const KING_T = [];
const RAYS = []; // RAYS[s][d]：0–3 直线，4–7 斜线
const PAWN_FROM_W = []; // 能攻击 s 的白兵所在格
const PAWN_FROM_B = [];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const inside = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
for (let s = 0; s < 64; s++) {
  const f = s & 7, r = s >> 3;
  KNIGHT_T[s] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
    .filter(([df, dr]) => inside(f + df, r + dr)).map(([df, dr]) => sq(f + df, r + dr));
  KING_T[s] = DIRS.filter(([df, dr]) => inside(f + df, r + dr)).map(([df, dr]) => sq(f + df, r + dr));
  RAYS[s] = DIRS.map(([df, dr]) => {
    const out = [];
    for (let k = 1; inside(f + k * df, r + k * dr); k++) out.push(sq(f + k * df, r + k * dr));
    return out;
  });
  PAWN_FROM_W[s] = [[-1, -1], [1, -1]].filter(([df, dr]) => inside(f + df, r + dr)).map(([df, dr]) => sq(f + df, r + dr));
  PAWN_FROM_B[s] = [[-1, 1], [1, 1]].filter(([df, dr]) => inside(f + df, r + dr)).map(([df, dr]) => sq(f + df, r + dr));
}

// 走动或被吃后要清掉的易位权
const CASTLE_MASK = new Array(64).fill(15);
CASTLE_MASK[0] = 15 & ~2; CASTLE_MASK[7] = 15 & ~1; CASTLE_MASK[4] = 15 & ~3;
CASTLE_MASK[56] = 15 & ~8; CASTLE_MASK[63] = 15 & ~4; CASTLE_MASK[60] = 15 & ~12;

// ---------- FEN ----------

/** 解析 FEN，返回局面（可变对象）。不合法时抛出中文错误 */
export function parseFen(fen) {
  const parts = String(fen || '').trim().split(/\s+/);
  const [placement, sideChar = 'w', castleStr = '-', epStr = '-', halfmove = '0', fullmove = '1'] = parts;
  const rows = (placement || '').split('/');
  if (rows.length !== 8) throw new Error(`FEN 应有 8 行：${fen}`);
  const board = new Array(64).fill(null);
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) file += Number(ch);
      else {
        if (!/[kqrbnp]/i.test(ch)) throw new Error(`FEN 含未知棋子「${ch}」`);
        if (file >= 8) throw new Error(`FEN 第 ${i + 1} 行超过 8 列`);
        board[sq(file, rank)] = ch;
        file++;
      }
    }
    if (file !== 8) throw new Error(`FEN 第 ${i + 1} 行不是 8 列`);
  });
  if (board.filter((p) => p === 'K').length !== 1 || board.filter((p) => p === 'k').length !== 1) throw new Error('FEN 中双方必须各有一个王');
  for (let f = 0; f < 8; f++) if (/[Pp]/.test(board[f] || '') || /[Pp]/.test(board[56 + f] || '')) throw new Error('FEN 中兵不能在第 1 行或第 8 行');
  if (!/^[wb]$/.test(sideChar)) throw new Error(`FEN 走棋方应为 w 或 b：${sideChar}`);
  const side = sideChar;
  // 易位权：只保留王和车都在原位的
  let castling = 0;
  if (castleStr.includes('K') && board[4] === 'K' && board[7] === 'R') castling |= 1;
  if (castleStr.includes('Q') && board[4] === 'K' && board[0] === 'R') castling |= 2;
  if (castleStr.includes('k') && board[60] === 'k' && board[63] === 'r') castling |= 4;
  if (castleStr.includes('q') && board[60] === 'k' && board[56] === 'r') castling |= 8;
  const pos = { board, side, castling, ep: -1, halfmove: Math.max(0, Number(halfmove) || 0), fullmove: Math.max(1, Number(fullmove) || 1) };
  // 过路兵格：必须在正确的行、后面有刚走两格的兵，且旁边有能吃它的兵
  const ep = parseSq(epStr);
  if (ep >= 0) {
    const okRank = side === WHITE ? rankOf(ep) === 5 : rankOf(ep) === 2;
    const pawnSq = side === WHITE ? ep - 8 : ep + 8;
    if (okRank && !board[ep] && board[pawnSq] === (side === WHITE ? 'p' : 'P') && epCapturable(board, pawnSq, side)) pos.ep = ep;
  }
  if (inCheck(pos, opponent(side))) throw new Error('FEN 不合法：不该走棋的一方正被将军');
  return pos;
}

/** 刚走两格到 pawnSq 的兵，旁边是否有 side 方的兵可以吃过路兵 */
function epCapturable(board, pawnSq, side) {
  const mine = side === WHITE ? 'P' : 'p';
  const f = fileOf(pawnSq);
  return (f > 0 && board[pawnSq - 1] === mine) || (f < 7 && board[pawnSq + 1] === mine);
}

function placementOf(board) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[sq(f, r)];
      if (!p) empty++;
      else { if (empty) row += empty; empty = 0; row += p; }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

function castleText(c) {
  const t = (c & 1 ? 'K' : '') + (c & 2 ? 'Q' : '') + (c & 4 ? 'k' : '') + (c & 8 ? 'q' : '');
  return t || '-';
}

export function toFen(pos) {
  return `${placementOf(pos.board)} ${pos.side} ${castleText(pos.castling)} ${pos.ep >= 0 ? sqName(pos.ep) : '-'} ${pos.halfmove} ${pos.fullmove}`;
}

/** 判断重复局面用的键：棋子位置、走棋方、易位权、过路兵 */
export function posKey(pos) {
  return `${placementOf(pos.board)} ${pos.side} ${castleText(pos.castling)} ${pos.ep >= 0 ? sqName(pos.ep) : '-'}`;
}

export const clonePos = (pos) => ({ ...pos, board: pos.board.slice() });

// ---------- 攻击与将军 ----------

/** 格子 s 是否被 by 方攻击 */
export function isAttacked(board, s, by) {
  const w = by === WHITE;
  const N = w ? 'N' : 'n', K = w ? 'K' : 'k', P = w ? 'P' : 'p', R = w ? 'R' : 'r', B = w ? 'B' : 'b', Q = w ? 'Q' : 'q';
  for (const t of KNIGHT_T[s]) if (board[t] === N) return true;
  for (const t of (w ? PAWN_FROM_W[s] : PAWN_FROM_B[s])) if (board[t] === P) return true;
  for (const t of KING_T[s]) if (board[t] === K) return true;
  const rays = RAYS[s];
  for (let d = 0; d < 8; d++) {
    const ray = rays[d];
    const S = d < 4 ? R : B;
    for (let i = 0; i < ray.length; i++) {
      const p = board[ray[i]];
      if (p) { if (p === S || p === Q) return true; break; }
    }
  }
  return false;
}

export function kingSquare(board, side) {
  const K = side === WHITE ? 'K' : 'k';
  for (let s = 0; s < 64; s++) if (board[s] === K) return s;
  return -1;
}

/** side 方的王是否正被将军 */
export function inCheck(pos, side = pos.side) {
  const k = kingSquare(pos.board, side);
  return k >= 0 && isAttacked(pos.board, k, opponent(side));
}

// ---------- 着法生成 ----------

const PROMOS = ['q', 'r', 'b', 'n'];

function pushPawn(out, from, to, piece, captured, promoRank, flag) {
  if (rankOf(to) === promoRank) for (const pr of PROMOS) out.push({ from, to, piece, captured, promo: pr, flag });
  else out.push({ from, to, piece, captured, promo: null, flag });
}

/** 伪合法着法（不检查走后是否被将军）。capturesOnly 时只生成吃子和升变 */
export function pseudoMoves(pos, capturesOnly = false) {
  const { board, side } = pos;
  const w = side === WHITE;
  const out = [];
  const enemy = (p) => p && isWhite(p) !== w;
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (!p || isWhite(p) !== w) continue;
    const t = p.toUpperCase();
    if (t === 'P') {
      const dir = w ? 8 : -8;
      const promoRank = w ? 7 : 0;
      const f = s & 7;
      const one = s + dir;
      if (!board[one]) {
        if (rankOf(one) === promoRank) pushPawn(out, s, one, p, null, promoRank, 'n');
        else if (!capturesOnly) {
          out.push({ from: s, to: one, piece: p, captured: null, promo: null, flag: 'n' });
          const two = one + dir;
          if (rankOf(s) === (w ? 1 : 6) && !board[two]) out.push({ from: s, to: two, piece: p, captured: null, promo: null, flag: 'd' });
        }
      }
      for (const df of [-1, 1]) {
        if (f + df < 0 || f + df > 7) continue;
        const to = one + df;
        if (enemy(board[to])) pushPawn(out, s, to, p, board[to], promoRank, 'n');
        else if (to === pos.ep) out.push({ from: s, to, piece: p, captured: w ? 'p' : 'P', promo: null, flag: 'e' });
      }
    } else if (t === 'N' || t === 'K') {
      for (const to of (t === 'N' ? KNIGHT_T[s] : KING_T[s])) {
        const q = board[to];
        if (!q) { if (!capturesOnly) out.push({ from: s, to, piece: p, captured: null, promo: null, flag: 'n' }); }
        else if (enemy(q)) out.push({ from: s, to, piece: p, captured: q, promo: null, flag: 'n' });
      }
    } else {
      const d0 = t === 'B' ? 4 : 0, d1 = t === 'R' ? 4 : 8;
      for (let d = d0; d < d1; d++) {
        for (const to of RAYS[s][d]) {
          const q = board[to];
          if (!q) { if (!capturesOnly) out.push({ from: s, to, piece: p, captured: null, promo: null, flag: 'n' }); continue; }
          if (enemy(q)) out.push({ from: s, to, piece: p, captured: q, promo: null, flag: 'n' });
          break;
        }
      }
    }
  }
  if (!capturesOnly) addCastles(pos, out);
  return out;
}

function addCastles(pos, out) {
  const { board, side, castling } = pos;
  const w = side === WHITE;
  const base = w ? 0 : 56;
  const K = w ? 'K' : 'k', R = w ? 'R' : 'r';
  const opp = opponent(side);
  const e = base + 4;
  if (board[e] !== K) return;
  const kBit = w ? 1 : 4, qBit = w ? 2 : 8;
  if (!(castling & (kBit | qBit))) return;
  if (isAttacked(board, e, opp)) return; // 被将军时不能易位
  if ((castling & kBit) && board[base + 7] === R && !board[base + 5] && !board[base + 6]
    && !isAttacked(board, base + 5, opp) && !isAttacked(board, base + 6, opp)) {
    out.push({ from: e, to: base + 6, piece: K, captured: null, promo: null, flag: 'k' });
  }
  if ((castling & qBit) && board[base] === R && !board[base + 1] && !board[base + 2] && !board[base + 3]
    && !isAttacked(board, base + 3, opp) && !isAttacked(board, base + 2, opp)) {
    out.push({ from: e, to: base + 2, piece: K, captured: null, promo: null, flag: 'q' });
  }
}

/** 在局面上走一步（就地修改），返回撤销信息 */
export function makeMove(pos, m) {
  const b = pos.board;
  const undo = { castling: pos.castling, ep: pos.ep, halfmove: pos.halfmove, fullmove: pos.fullmove };
  const w = pos.side === WHITE;
  b[m.from] = null;
  b[m.to] = m.promo ? (w ? m.promo.toUpperCase() : m.promo) : m.piece;
  if (m.flag === 'e') b[w ? m.to - 8 : m.to + 8] = null;
  else if (m.flag === 'k') { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = null; }
  else if (m.flag === 'q') { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = null; }
  pos.castling &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];
  pos.ep = m.flag === 'd' && epCapturable(b, m.to, opponent(pos.side)) ? (m.from + m.to) >> 1 : -1;
  pos.halfmove = m.captured || m.piece === 'P' || m.piece === 'p' ? 0 : pos.halfmove + 1;
  if (!w) pos.fullmove++;
  pos.side = w ? BLACK : WHITE;
  return undo;
}

export function unmakeMove(pos, m, undo) {
  const b = pos.board;
  pos.side = pos.side === WHITE ? BLACK : WHITE;
  const w = pos.side === WHITE;
  b[m.from] = m.piece;
  if (m.flag === 'e') { b[m.to] = null; b[w ? m.to - 8 : m.to + 8] = m.captured; }
  else b[m.to] = m.captured;
  if (m.flag === 'k') { b[m.from + 3] = b[m.from + 1]; b[m.from + 1] = null; }
  else if (m.flag === 'q') { b[m.from - 4] = b[m.from - 1]; b[m.from - 1] = null; }
  pos.castling = undo.castling; pos.ep = undo.ep; pos.halfmove = undo.halfmove; pos.fullmove = undo.fullmove;
}

/** 全部合法着法 */
export function legalMoves(pos) {
  const side = pos.side, opp = opponent(side);
  const king = kingSquare(pos.board, side);
  const out = [];
  for (const m of pseudoMoves(pos)) {
    const u = makeMove(pos, m);
    const k = m.piece === 'K' || m.piece === 'k' ? m.to : king;
    if (!isAttacked(pos.board, k, opp)) out.push(m);
    unmakeMove(pos, m, u);
  }
  return out;
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const u = makeMove(pos, m);
    n += perft(pos, depth - 1);
    unmakeMove(pos, m, u);
  }
  return n;
}

// ---------- 记谱 ----------

export const moveToUci = (m) => sqName(m.from) + sqName(m.to) + (m.promo || '');

/** 从 UCI 找到合法着法；升变没写棋子时 defaultPromo 为 null 则不匹配 */
export function uciToMove(pos, uci, { defaultPromo = null, legal = null } = {}) {
  const mm = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(String(uci || '').trim().toLowerCase());
  if (!mm) return null;
  const from = parseSq(mm[1]), to = parseSq(mm[2]);
  const promo = mm[3] || null;
  const list = legal || legalMoves(pos);
  const cands = list.filter((m) => m.from === from && m.to === to);
  if (!cands.length) return null;
  if (cands[0].promo) return cands.find((m) => m.promo === (promo || defaultPromo)) || null;
  return promo ? null : cands[0];
}

/** 标准代数记谱（SAN），含 + 和 # */
export function toSan(pos, m, legal = null) {
  let san;
  if (m.flag === 'k') san = 'O-O';
  else if (m.flag === 'q') san = 'O-O-O';
  else {
    const t = m.piece.toUpperCase();
    if (t === 'P') {
      san = (m.captured ? `${FILE_CHARS[fileOf(m.from)]}x` : '') + sqName(m.to) + (m.promo ? `=${m.promo.toUpperCase()}` : '');
    } else {
      const others = (legal || legalMoves(pos)).filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
      let dis = '';
      if (others.length) {
        if (!others.some((o) => fileOf(o.from) === fileOf(m.from))) dis = FILE_CHARS[fileOf(m.from)];
        else if (!others.some((o) => rankOf(o.from) === rankOf(m.from))) dis = String(rankOf(m.from) + 1);
        else dis = sqName(m.from);
      }
      san = t + dis + (m.captured ? 'x' : '') + sqName(m.to);
    }
  }
  const u = makeMove(pos, m);
  if (inCheck(pos)) san += legalMoves(pos).length ? '+' : '#';
  unmakeMove(pos, m, u);
  return san;
}

const stripSan = (s) => s.replace(/[+#!?]/g, '').replace(/0/g, 'O').replace(/=/g, '');

/** 解析 SAN（宽松：可省略 + # =、x，0-0 当作 O-O，e8Q / e8=Q 都可以） */
export function sanToMove(pos, text, legal = null) {
  let t = String(text || '').trim().replace(/[()（）]/g, '');
  if (!t) return null;
  t = stripSan(t).replace(/^O-?O-?O$/i, 'O-O-O').replace(/^O-?O$/i, 'O-O').replace(/([1-8])([qrbn])$/, (_, a, b) => a + b.toUpperCase());
  const list = legal || legalMoves(pos);
  const sans = list.map((m) => ({ m, s: stripSan(toSan(pos, m, list)) }));
  const exact = sans.filter((x) => x.s === t);
  if (exact.length === 1) return exact[0].m;
  // 去掉吃子符号再比；兵升变没写棋子时默认升后
  const noX = (s) => s.replace(/x/g, '');
  let c = sans.filter((x) => noX(x.s) === noX(t));
  if (c.length === 1) return c[0].m;
  if (/^[a-h]x?[a-h]?[18]$/.test(noX(t)) || /^[a-h][18]$/.test(t)) {
    c = sans.filter((x) => noX(x.s) === `${noX(t)}Q`);
    if (c.length === 1) return c[0].m;
  }
  // 棋子字母小写（象 b 与 b 列兵有歧义，不处理）
  if (/^[nrqk]/.test(t)) return sanToMove(pos, t[0].toUpperCase() + t.slice(1), list);
  return null;
}

// ---------- 和棋判定 ----------

/** 双方都没有足够子力将死对方（王对王、王单象/单马对王、只剩同色格象） */
export function insufficientMaterial(board) {
  const minors = [];
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (!p || p === 'K' || p === 'k') continue;
    if (/[PpRrQq]/.test(p)) return false;
    minors.push({ p, s });
  }
  if (minors.length <= 1) return true;
  if (minors.every((x) => x.p === 'B' || x.p === 'b')) {
    const color = (s) => (fileOf(s) + rankOf(s)) & 1;
    return minors.every((x) => color(x.s) === color(minors[0].s));
  }
  return false;
}

// ---------- 对局状态 ----------

export const SEAT_NAMES = { w: '白方', b: '黑方' };

/** 当前局面的结果：null 表示未结束 */
function judge(pos, keys) {
  const legal = legalMoves(pos);
  if (!legal.length) {
    if (inCheck(pos)) {
      const winner = opponent(pos.side);
      return { over: true, winner, reason: `${SEAT_NAMES[winner]}将死${SEAT_NAMES[pos.side]}` };
    }
    return { over: true, winner: null, reason: `逼和：${SEAT_NAMES[pos.side]}无子可动但没有被将军，和棋` };
  }
  if (insufficientMaterial(pos.board)) return { over: true, winner: null, reason: '双方子力都不足以将死对方，和棋' };
  const key = keys[keys.length - 1];
  if (keys.filter((k) => k === key).length >= 3) return { over: true, winner: null, reason: '同一局面出现三次，和棋' };
  if (pos.halfmove >= 100) return { over: true, winner: null, reason: '连续 50 回合双方都没有吃子或走兵，和棋' };
  return null;
}

/** 新对局：{ startFen, pos, moves, keys, result } */
export function newGame(fen = START_FEN) {
  const pos = parseFen(fen);
  const keys = [posKey(pos)];
  return { startFen: toFen(pos), pos, moves: [], keys, result: judge(pos, keys) };
}

/** 走一步，返回新的对局状态（不修改原状态） */
export function play(game, m, san = null) {
  const pos = clonePos(game.pos);
  const legal = legalMoves(pos);
  const sanText = san || toSan(pos, m, legal);
  makeMove(pos, m);
  const key = posKey(pos);
  // 吃子、走兵、易位权变化后不可能重复，之前的键可以丢掉以控制状态大小
  const keys = pos.halfmove === 0 || pos.castling !== game.pos.castling ? [key] : [...game.keys, key];
  const rec = { uci: moveToUci(m), san: sanText, side: game.pos.side, check: inCheck(pos), captured: m.captured || null };
  return { startFen: game.startFen, pos, moves: [...game.moves, rec], keys, result: judge(pos, keys) };
}
