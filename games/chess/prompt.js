// 给模型的提示词：规则说明、局面描述、输出格式和着法解析。

import { sq, toFen, legalMoves, toSan, moveToUci, uciToMove, sanToMove, inCheck, sideOf, parseSq, SEAT_NAMES, START_FEN } from './rules.js';

export const PIECE_NAMES = { K: '王', Q: '后', R: '车', B: '象', N: '马', P: '兵' };
const PIECE_ORDER = 'KQRBNP';

export function systemPrompt(seat, { style = '', showLegal = true } = {}) {
  const me = SEAT_NAMES[seat];
  return [
    `你是一名国际象棋棋手，在这盘棋里执${me}（${seat === 'w' ? '先手' : '后手'}）。目标是赢下这盘棋。`,
    '',
    '【规则要点】标准国际象棋规则：将死对方获胜；轮到走棋的一方无子可动又没有被将军是逼和（和棋）；连续 50 回合双方都没有吃子或走兵判和；同一局面出现三次判和；双方子力都不足以将死对方时判和。包括王车易位、吃过路兵，兵走到底线必须升变为后、车、象或马。',
    '',
    '【坐标】列 a–h 从白方左侧到右侧，行 1–8 从白方底线到黑方底线。棋盘上大写字母是白方，小写字母是黑方：K/k 王，Q/q 后，R/r 车，B/b 象，N/n 马，P/p 兵，「.」是空格。',
    '着法用 UCI 坐标写成「起点+终点」，例如 e2e4 表示把 e2 的棋子走到 e4；王车易位写王的走法（白方短易位 e1g1，长易位 e1c1）；升变在末尾加棋子字母，例如 e7e8q。也接受标准代数记谱（例如 Nf3、O-O、exd5、e8=Q）。',
    showLegal
      ? '每一步我都会给出你全部的合法着法（代数记谱和 UCI 对照），你必须从中选择一个。'
      : '你需要自己判断着法是否合法；走出不合法的着法会被要求重走，连续多次不合法判负。',
    '',
    '【输出格式】每一步只简短回答，用中文，除着法外合计不超过 80 字，严格按下面五行：',
    '判断：一句话说明当前局面谁占优、为什么',
    '威胁：一句话说明对方下一步最大的威胁（没有就写「无」）',
    '理由：一句话说明你为什么走这一步',
    '胜率：你估计自己现在的获胜概率，写成 0–100 的整数加 %',
    '着法：UCI 坐标，例如 e2e4',
    style ? `\n【你的风格】${style}\n（风格只影响你的下棋取向，不能改变上面的规则和输出格式。）` : '',
  ].join('\n');
}

/** 带坐标的文字棋盘（白方在下） */
export function boardText(pos) {
  const lines = ['   a b c d e f g h'];
  for (let r = 7; r >= 0; r--) {
    let row = `${r + 1}  `;
    for (let f = 0; f < 8; f++) row += (pos.board[sq(f, r)] || '.') + ' ';
    lines.push(`${row}${r + 1}`);
  }
  lines.push('   a b c d e f g h');
  return lines.join('\n');
}

/** 按棋子分组的合法着法列表 */
export function legalText(pos) {
  const legal = legalMoves(pos);
  const groups = new Map();
  for (const t of PIECE_ORDER) groups.set(t, []);
  for (const m of legal) groups.get(m.piece.toUpperCase()).push(`${toSan(pos, m, legal)} ${moveToUci(m)}`);
  return [...groups].filter(([, v]) => v.length).map(([k, v]) => `${PIECE_NAMES[k]}：${v.join('，')}`).join('\n');
}

/** 带回合数的着法记录，例如「12. Nf3 Nc6 13. Bb5」 */
export function movesText(game, from = 0) {
  const parts = (game.startFen || START_FEN).split(/\s+/);
  const startSide = parts[1] || 'w';
  const startNo = Number(parts[5]) || 1;
  const out = [];
  for (let i = from; i < game.moves.length; i++) {
    const k = startSide === 'w' ? i : i + 1; // 从白方算起的半回合序号
    const no = startNo + Math.floor(k / 2);
    if (k % 2 === 0) out.push(`${no}. ${game.moves[i].san}`);
    else out.push(i === from ? `${no}... ${game.moves[i].san}` : game.moves[i].san);
  }
  return out.join(' ');
}

/** 每一步发给模型的用户消息 */
export function turnPrompt(game, seat, { showLegal = true } = {}) {
  const { pos, moves } = game;
  const last = moves[moves.length - 1];
  const parts = [`第 ${pos.fullmove} 回合，轮到你（${SEAT_NAMES[seat]}）走。`];
  if (last) parts.push(`对方上一步：${last.san}（${last.uci}）${last.check ? '，正在将军你' : ''}`);
  else parts.push('这是本局第一步。');
  if (inCheck(pos)) parts.push('注意：你正被将军，必须应将。');
  if (moves.length) parts.push(`最近的着法：${movesText(game, Math.max(0, moves.length - 16))}`);
  if (pos.halfmove >= 60) parts.push(`已经连续 ${Math.floor(pos.halfmove / 2)} 回合没有吃子或走兵（到 50 回合判和）。`);
  parts.push('', '当前局面：', boardText(pos), `FEN：${toFen(pos)}`);
  if (showLegal) parts.push('', `你可以走的着法（共 ${legalMoves(pos).length} 个，代数记谱 UCI）：`, legalText(pos));
  return parts.join('\n');
}

export function retryPrompt(reason, attempt, maxRetries) {
  return `你上一个回答的着法无效：${reason}。请重新选择（这是第 ${attempt} 次重走，最多 ${maxRetries} 次，再无效判负），仍按五行格式回答。`;
}

const UCI_RE = /(?<![a-zA-Z])([a-h])\s*([1-8])\s*[-–—x]?\s*([a-h])\s*([1-8])(?:\s*[=(]?\s*([qrbnQRBN]))?/;
const SAN_RE = /(O-O-O|O-O|0-0-0|0-0|[KQRBNkqrn][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=?[QRBNqrbn])?|[a-h][1-8](?:=?[QRBNqrbn])?)[+#]?/;

/**
 * 从模型回答中解析着法和自评胜率。返回 { move, uci, winrate, error }
 * 着法行可以写 UCI（e2e4、e7e8q）或 SAN（Nf3、O-O、e8=Q），也认「短易位」「长易位」。
 */
export function parseReply(pos, text) {
  const t = String(text || '').normalize('NFKC');
  const winM = /胜率\s*[:：]\s*(\d{1,3})/.exec(t);
  const winrate = winM ? Math.min(100, Number(winM[1])) : null;
  const legal = legalMoves(pos);

  const line = [...t.matchAll(/着法\s*[:：]\s*([^\n]*)/g)].pop();
  let cand = line ? line[1].trim() : t.trim().split('\n').filter((l) => l.trim()).pop()?.trim() || '';
  cand = cand.replace(/[*`「」『』“”"]/g, '');
  if (!line && !cand) return { move: null, uci: null, winrate, error: '没有找到着法（最后一行应为「着法：e2e4」这样的格式）' };

  // 中文写法的易位
  if (/长易位/.test(cand)) cand = 'O-O-O';
  else if (/短易位|王车易位/.test(cand)) cand = 'O-O';

  const u = UCI_RE.exec(cand) || (!line ? [...t.matchAll(new RegExp(UCI_RE.source, 'g'))].pop() : null);
  if (u) {
    const from = `${u[1]}${u[2]}`, to = `${u[3]}${u[4]}`;
    const uci = `${from}${to}${u[5] ? u[5].toLowerCase() : ''}`;
    const fromSq = parseSq(from);
    const p = pos.board[fromSq];
    if (!p) return { move: null, uci, winrate, error: `${uci} 的起点 ${from} 上没有棋子` };
    if (sideOf(p) !== pos.side) return { move: null, uci, winrate, error: `${from} 上是对方的棋子` };
    const m = uciToMove(pos, uci, { defaultPromo: 'q', legal });
    if (!m) {
      const why = inCheck(pos) ? '（你正被将军，必须应将）' : '';
      return { move: null, uci, winrate, error: `${uci} 不符合规则，或走后自己的王会被将军${why}` };
    }
    return { move: m, uci: moveToUci(m), winrate, error: null };
  }
  const s = SAN_RE.exec(cand);
  if (s) {
    const m = sanToMove(pos, s[0], legal);
    if (m) return { move: m, uci: moveToUci(m), winrate, error: null };
    return { move: null, uci: s[0], winrate, error: `「${s[0]}」不是当前局面的合法着法${inCheck(pos) ? '（你正被将军，必须应将）' : ''}` };
  }
  return { move: null, uci: null, winrate, error: '没有找到着法（最后一行应为「着法：e2e4」这样的格式）' };
}

export { SEAT_NAMES };
