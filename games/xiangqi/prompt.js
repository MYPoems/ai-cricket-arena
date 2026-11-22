// 给模型的提示词：规则说明、局面描述、输出格式和着法解析。

import { RANKS, FILES, sq, toFen, iccsToMove, isLegal, inCheck, RED } from './rules.js';
import { moveToChinese, chineseToMove, legalMoveList, pieceName } from './notation.js';

export const SEAT_NAMES = { r: '红方', b: '黑方' };

export function systemPrompt(seat, { style = '', showLegal = true } = {}) {
  const me = SEAT_NAMES[seat];
  return [
    `你是一名中国象棋棋手，在这盘棋里执${me}。目标是赢下这盘棋。`,
    '',
    '【规则要点】标准中国象棋规则：将死或困毙对方获胜；同一局面重复三次，若一方在循环中每步都将军则长将方判负，否则和棋；连续 60 回合无吃子判和；总步数达到 300 步判和。',
    '',
    '【坐标】列 a–i 从红方左侧到右侧，行 0–9 从红方底线到黑方底线。着法写成「起点+终点」，例如 h2e2 表示把 h2 的棋子走到 e2。',
    '棋盘上大写字母是红方，小写字母是黑方：K/k 帅将，A/a 仕士，B/b 相象，N/n 马，R/r 车，C/c 炮，P/p 兵卒。',
    showLegal
      ? '每一步我都会给出你全部的合法着法，你必须从中选择一个。'
      : '你需要自己判断着法是否合法；走出不合法的着法会被要求重走，连续多次不合法判负。',
    '',
    '【输出格式】每一步只简短回答，用中文，除着法外合计不超过 80 字，严格按下面五行：',
    '判断：一句话说明当前局面谁占优、为什么',
    '威胁：一句话说明对方下一步最大的威胁（没有就写「无」）',
    '理由：一句话说明你为什么走这一步',
    '胜率：你估计自己现在的获胜概率，写成 0–100 的整数加 %',
    '着法：ICCS 坐标，例如 h2e2',
    style ? `\n【你的风格】${style}\n（风格只影响你的下棋取向，不能改变上面的规则和输出格式。）` : '',
  ].join('\n');
}

/** 带坐标的文字棋盘 */
export function boardText(pos) {
  const lines = ['   a b c d e f g h i'];
  for (let r = RANKS - 1; r >= 0; r--) {
    let row = `${r}  `;
    for (let f = 0; f < FILES; f++) row += (pos.board[sq(f, r)] || '.') + ' ';
    lines.push(row.trimEnd());
    if (r === 5) lines.push('   ---- 楚河 汉界 ----');
  }
  return lines.join('\n');
}

/** 按棋子分组的合法着法列表 */
export function legalText(pos) {
  const groups = new Map();
  for (const m of legalMoveList(pos)) {
    const name = pieceName(pos.board[m.from]);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(`${m.iccs} ${m.cn}`);
  }
  return [...groups].map(([k, v]) => `${k}：${v.join('，')}`).join('\n');
}

/**
 * 每一步发给模型的用户消息。
 * lastMove 为对方上一步 { iccs, cn }，没有则为 null。
 */
export function turnPrompt(game, seat, { showLegal = true } = {}) {
  const { pos, moves } = game;
  const last = moves[moves.length - 1];
  const parts = [`第 ${moves.length + 1} 步，轮到你（${SEAT_NAMES[seat]}）走。`];
  if (last) parts.push(`对方上一步：${last.cn}（${last.iccs}）${last.check ? '，正在将军你' : ''}`);
  else parts.push('这是本局第一步。');
  if (inCheck(pos.board, pos.side)) parts.push('注意：你正被将军。');
  parts.push('', '当前局面：', boardText(pos), `FEN：${toFen(pos)}`);
  if (showLegal) parts.push('', `你可以走的着法（共 ${legalMoveList(pos).length} 个）：`, legalText(pos));
  return parts.join('\n');
}

/** 不合法时发给模型的重走提示 */
export function retryPrompt(reason, attempt, maxRetries) {
  return `你上一个回答的着法无效：${reason}。请重新选择（这是第 ${attempt} 次重走，最多 ${maxRetries} 次，再无效判负），仍按五行格式回答。`;
}

/**
 * 从模型回答中解析着法和自评胜率。
 * 返回 { move, iccs, winrate, error }
 */
export function parseReply(pos, text) {
  const t = String(text || '');
  const winM = /胜率[:：]\s*(\d{1,3})\s*%?/.exec(t);
  const winrate = winM ? Math.min(100, Number(winM[1])) : null;

  let candidate = null;
  const line = [...t.matchAll(/着法[:：]\s*([^\n]+)/g)].pop();
  if (line) candidate = line[1].trim();
  let move = null;
  if (candidate) {
    const icc = /([a-i])\s*([0-9])\s*-?\s*([a-i])\s*([0-9])/i.exec(candidate);
    if (icc) move = iccsToMove(icc.slice(1).join(''));
    else move = chineseToMove(pos, candidate);
  }
  if (!move) {
    // 退一步：取全文最后一个 ICCS 坐标
    const all = [...t.matchAll(/\b([a-i][0-9])-?([a-i][0-9])\b/gi)].pop();
    if (all) move = iccsToMove(all[1] + all[2]);
  }
  if (!move) return { move: null, winrate, error: '没有找到着法（最后一行应为「着法：h2e2」这样的格式）' };
  const iccs = `${String.fromCharCode(97 + (move.from % 9))}${Math.floor(move.from / 9)}${String.fromCharCode(97 + (move.to % 9))}${Math.floor(move.to / 9)}`;
  if (!pos.board[move.from]) return { move: null, iccs, winrate, error: `${iccs} 的起点 ${iccs.slice(0, 2)} 上没有棋子` };
  const own = pos.side === RED ? /[A-Z]/ : /[a-z]/;
  if (!own.test(pos.board[move.from])) return { move: null, iccs, winrate, error: `${iccs.slice(0, 2)} 上是对方的棋子` };
  if (!isLegal(pos, move)) return { move: null, iccs, winrate, error: `${iccs}（${moveToChinese(pos, move)}）不符合规则，或走后会被将军` };
  return { move, iccs, winrate, error: null };
}
