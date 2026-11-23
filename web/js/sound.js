// 音效：用 Web Audio 现场合成几种短音（不带音频文件），默认关闭，在对局页转播条上开关，记在本机。
// 另外：轮到真人出手时手机震一下；标签页在后台时标题闪「轮到你」，切回来就停。

const KEY = 'dsqq-sound';
let ctx = null;

export function soundOn() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setSound(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 隐私模式 */ }
  if (on) audio(); // 用户点开关这一下解锁音频
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** 一个音：频率、时长、波形、音量包络；slide 是结束时滑到的频率 */
function tone(a, { f = 440, dur = 0.12, type = 'sine', vol = 0.18, at = 0, slide = null }) {
  const t0 = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
/** 一小段噪声（洗牌、筹码碰撞） */
function noise(a, { dur = 0.06, vol = 0.12, at = 0, hp = 2000 }) {
  const t0 = a.currentTime + at;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

const SOUNDS = {
  move: (a) => { tone(a, { f: 220, dur: 0.07, type: 'triangle', vol: 0.22 }); noise(a, { dur: 0.04, vol: 0.06, hp: 1200 }); },
  capture: (a) => { tone(a, { f: 180, dur: 0.1, type: 'triangle', vol: 0.26 }); noise(a, { dur: 0.08, vol: 0.12, hp: 900 }); },
  check: (a) => { tone(a, { f: 660, dur: 0.12, type: 'square', vol: 0.06 }); tone(a, { f: 880, dur: 0.16, type: 'square', vol: 0.05, at: 0.1 }); },
  card: (a) => noise(a, { dur: 0.07, vol: 0.1, hp: 2500 }),
  chip: (a) => { noise(a, { dur: 0.03, vol: 0.12, hp: 4000 }); noise(a, { dur: 0.03, vol: 0.09, hp: 4500, at: 0.05 }); },
  bomb: (a) => { tone(a, { f: 120, dur: 0.5, type: 'sawtooth', vol: 0.12, slide: 40 }); noise(a, { dur: 0.4, vol: 0.2, hp: 200 }); },
  turn: (a) => { tone(a, { f: 784, dur: 0.14, vol: 0.14 }); tone(a, { f: 1046, dur: 0.22, vol: 0.12, at: 0.12 }); },
  out: (a) => { tone(a, { f: 330, dur: 0.25, type: 'triangle', vol: 0.16, slide: 220 }); },
  win: (a) => { [523, 659, 784, 1046].forEach((f, i) => tone(a, { f, dur: 0.22, vol: 0.12, at: i * 0.11 })); },
};

/** 播一个音效（关着就不响）；回放快于 2 倍时只播重要的 */
export function sfx(name, { fast = false } = {}) {
  if (!soundOn()) return;
  if (fast && !['check', 'bomb', 'win', 'out'].includes(name)) return;
  const a = audio();
  if (!a || !SOUNDS[name]) return;
  try { SOUNDS[name](a); } catch { /* 个别浏览器不支持某些节点 */ }
}

/** 轮到真人：震一下；后台时标题闪烁，切回来就停 */
let flash = null;
export function nudgeTurn() {
  try { navigator.vibrate?.(60); } catch { /* 不支持 */ }
  sfx('turn');
  if (!document.hidden || flash) return;
  const title = document.title;
  let on = false;
  flash = setInterval(() => { on = !on; document.title = on ? '【轮到你】' + title : title; }, 900);
  const stop = () => { if (!document.hidden) { clearInterval(flash); flash = null; document.title = title; document.removeEventListener('visibilitychange', stop); } };
  document.addEventListener('visibilitychange', stop);
}
