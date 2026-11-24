// 发言的节奏（狼人杀、谁是卧底共用；服务端和浏览器读同一份）：
// 一段发言落地后，对局页把它逐字打出来，打完再停一会儿；服务端按同样的时长停顿，再问下一位。
// 观众来得及看完，在局的真人也来得及想。

export const SPEECH = {
  charMs: 170, // 每个字 170 毫秒（约每秒 6 个字，比默读慢，边打边看得过来）
  minType: 1200, // 一两个字的短句也至少打 1.2 秒
  maxType: 30000, // 很长的发言打字加速，最多 30 秒
  linger: 3500, // 打完之后再停 3.5 秒，想一想再到下一位
};

/** 场上公告卡（天亮死讯、投票结果、有人出局）停多久：对局页卡片演这么久，服务端也停这么久 */
export const CARD_MS = 5500;

/** 发言超出上限时的收尾：尽量在上限以内最后一个句号、问号处断开，断不开再截断加省略号（不在半句话中间硬切） */
export function fitSpeech(text, max) {
  const a = [...String(text || '')];
  if (a.length <= max) return a.join('');
  const cut = a.slice(0, max);
  for (let i = cut.length - 1; i >= Math.floor(max * 0.5); i--) if ('。！？!?；;…'.includes(cut[i])) return cut.slice(0, i + 1).join('');
  return `${cut.slice(0, max - 1).join('')}…`;
}

const len = (text) => [...String(text || '')].length;

/** 逐字打完这段话要多久（毫秒） */
export function typeMs(text) {
  const n = len(text);
  if (!n) return 0;
  return Math.min(SPEECH.maxType, Math.max(SPEECH.minType, n * SPEECH.charMs));
}

/** 这段话落地后整体停多久：打字 + 打完后的停留 */
export function speechPause(text) {
  return len(text) ? typeMs(text) + SPEECH.linger : 0;
}

/** 两个状态之间新增的一句发言（speeches 数组变长了）：{ seat, text } 或 null */
export function newSpeech(prev, next) {
  const a = prev?.speeches || [];
  const b = next?.speeches || [];
  if (b.length <= a.length) return null;
  const sp = b.at(-1);
  return sp && sp.text ? { seat: sp.seat, text: sp.text } : null;
}
