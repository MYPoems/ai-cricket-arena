// 发言的节奏（狼人杀、谁是卧底共用；服务端和浏览器读同一份）：
// 一段发言落地后，对局页把它逐字打出来，打完再停一会儿；服务端按同样的时长停顿，再问下一位。
// 观众来得及看完，在局的真人也来得及想。

export const SPEECH = {
  charMs: 130, // 每个字 130 毫秒（约每秒 7–8 个字，比正常默读稍慢）
  minType: 900, // 一两个字的短句也至少打 0.9 秒
  maxType: 16000, // 很长的发言打字加速，最多 16 秒
  linger: 2200, // 打完之后再停 2.2 秒
};

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
