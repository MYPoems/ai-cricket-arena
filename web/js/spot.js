// 聚光框：固定在一处，只显示「现在轮到谁」——他的思考和出手。换人时像左轮手枪转弹巢：
// 头上一圈弹巢（每个座位一格）棘轮式转到下一格，正文像滚筒一样翻过去（旧的一面向上翻走，新的一面从下面翻上来）。
//
// show({ key, index, chambers, head, body })：key 变了才演换人动画；同一个 key 只换正文（流式思考逐字更新）。

import { h } from './ui.js';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createSpot() {
  const cyl = h('div', { class: 'cyl' });
  const hammer = h('i', { class: 'cyl-hammer' });
  const id = h('div', { class: 'spot-id' });
  const tools = h('div', { class: 'spot-tools' });
  const drum = h('div', { class: 'spot-drum' });
  const el = h('section', { class: 'spot', 'aria-live': 'polite' },
    h('div', { class: 'spot-top' }, h('div', { class: 'cyl-wrap', 'aria-hidden': 'true' }, cyl, hammer), id, tools),
    drum);
  let n = 0;
  let sig = '';
  let angle = 0;
  let index = -1;
  let key = null;
  let face = null;

  function setChambers(list) {
    const s = list.map((c) => `${c.label}|${c.color}|${c.out ? 1 : 0}`).join(',');
    if (s === sig) return;
    sig = s;
    n = list.length;
    cyl.replaceChildren(...list.map((c, i) => h('span', { class: `ch${c.out ? ' out' : ''}`, style: { '--a': `${(i * 360) / n}deg`, '--c': c.color } }, h('b', {}, c.label))));
  }

  /** 弹巢顺时针转到第 i 格（只往前转，不倒转；同一格不转）。
   *  不用「改 transition → 读 offsetWidth → 改回来」那套（每次逼浏览器同步排版，4 倍降速下要 1 秒）：
   *  第一次定位时弹巢还没有 .ready（CSS 里没有过渡），隔两帧再加上；锤子的一下用 Web Animations 播 */
  function turnTo(i) {
    if (i < 0 || !n) return;
    const step = 360 / n;
    if (index < 0) {
      angle = -i * step;
      cyl.style.setProperty('--rot', `${angle}deg`);
      requestAnimationFrame(() => requestAnimationFrame(() => cyl.classList.add('ready')));
    } else if (i !== index) {
      const k = (i - index + n) % n;
      angle -= k * step;
      cyl.style.setProperty('--rot', `${angle}deg`);
      if (!reduced() && hammer.animate) {
        hammer.animate([
          { transform: 'translateY(0)' },
          { transform: 'translateY(-3px) scaleY(.8)', offset: 0.18 },
          { transform: 'translateY(1px)', offset: 0.55 },
          { transform: 'none' },
        ], { duration: 680, easing: 'cubic-bezier(.3, 1.45, .5, 1)' });
      }
    }
    index = i;
    [...cyl.children].forEach((c, j) => c.classList.toggle('on', j === i));
  }

  function show({ key: k, index: i, chambers, head, body, tools: tl = [] }) {
    setChambers(chambers);
    id.replaceChildren(...[].concat(head));
    tools.replaceChildren(...[].concat(tl).filter(Boolean));
    const same = k === key && face;
    if (same) {
      // 同一个人同一步：只换正文，保持滚动在底部（流式思考）
      const sc = face.querySelector('.spot-scroll');
      const atBottom = sc ? sc.scrollHeight - sc.scrollTop - sc.clientHeight < 40 : true;
      const prevTop = sc ? sc.scrollTop : 0;
      face.replaceChildren(...[].concat(body));
      const nsc = face.querySelector('.spot-scroll');
      if (nsc) nsc.scrollTop = atBottom ? nsc.scrollHeight : prevTop;
      return;
    }
    key = k;
    turnTo(i);
    const next = h('div', { class: 'spot-face' }, ...[].concat(body));
    const old = face;
    face = next;
    drum.append(next);
    const sc = next.querySelector('.spot-scroll');
    if (sc && sc.dataset.stick === 'bottom') sc.scrollTop = sc.scrollHeight;
    if (!old) return;
    if (reduced()) { old.remove(); return; }
    old.classList.add('out');
    next.classList.add('in');
    const done = () => old.remove();
    old.addEventListener('animationend', done, { once: true });
    setTimeout(done, 900);
    next.addEventListener('animationend', () => next.classList.remove('in'), { once: true });
  }

  return { el, show };
}
