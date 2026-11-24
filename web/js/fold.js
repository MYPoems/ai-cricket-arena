// 多人局中间舞台的「折叠」：屏幕放不下时，票型、身份、出局、全部记录这些面板收成一排胶囊按钮，
// 点开后从按钮处长成一张卡片（桌面贴着中间一列的底部，手机是底部弹层），收起时缩回按钮。
//
// 判断放不放得下（只在版式签名变了时量，见 update；平时重画不读布局）：先按全部展开的样子量——整列溢出、焦点区被挤到 110 以下、或者焦点区里的
// 内容放不下且矮于 FOLD_AT，就算放不下。放不下时逐步收：先把「全部记录」收成按钮，还不够就从最高的面板起
// 一块一块收，放得下就停，没收的面板照常显示。手机宽度（≤640）全部收起；641–1100 页面本身能滚动，不收。
//
// 动效参照 iOS 的弹层：曲线 cubic-bezier(.32,.72,0,1)，卡片用 clip-path 从胶囊的大小和位置长到整张，
// 字不跟着拉伸，内容稍后淡入；背后压暗并轻微模糊；手机上可以按住顶部往下拖着关。尊重 reduced-motion。

import { h } from './ui.js';

const FOLD_AT = 170;
const EASE_OPEN = 'cubic-bezier(.32,.72,0,1)';
const EASE_CLOSE = 'cubic-bezier(.32,.72,0,1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = () => matchMedia('(max-width: 640px)').matches;
const medium = () => matchMedia('(max-width: 1100px)').matches;

/**
 * arena：.arena.duo；stageCol：中间那一列 section.stage；focusEl：焦点区；
 * panelRoot：画面模块的根节点（面板在里面）；logBox：「全部记录」details；moves：着法列表节点。
 */
export function createFold({ arena, stageCol, focusEl, panelRoot, logBox, moves, logLabel }) {
  const dock = h('div', { class: 'fold-dock', role: 'toolbar', 'aria-label': '更多信息' });
  let folded = false;
  let open = null; // { key, back, card, body, home }
  let lastSig = '';

  const panels = () => [...panelRoot.querySelectorAll('.panel')].filter((p) => !p.matches('.ww-ctrl, .uc-ctrl'));
  const keyOf = (p) => (p.querySelector('.label')?.textContent || '信息').trim().split(/\s*·\s*|\s+/)[0];
  const findPanel = (key) => panels().find((p) => keyOf(p) === key);
  const pillOf = (key) => dock.querySelector(`.fold-pill[data-key="${CSS.escape(key)}"]`);

  // ---------- 量一量放不放得下 ----------
  function fits() {
    const inner = [...focusEl.querySelectorAll('.said-list, .tt')];
    const squeezed = inner.some((x) => x.scrollHeight > x.clientHeight + 2);
    const fh = focusEl.clientHeight;
    const overflow = stageCol.scrollHeight > stageCol.clientHeight + 2;
    return !(overflow || fh < 110 || (squeezed && fh < FOLD_AT));
  }
  /** 决定收哪些：返回收起的面板（arena 上的 folded 表示「全部记录」也收成了按钮） */
  function decide() {
    const ps = panels();
    ps.forEach((p) => p.classList.remove('fold-hide'));
    arena.classList.remove('folded');
    if (phone()) { arena.classList.add('folded'); ps.forEach((p) => p.classList.add('fold-hide')); return ps; }
    if (medium() || fits()) return [];
    arena.classList.add('folded');
    const hidden = [];
    for (const p of [...ps].sort((a, b) => b.offsetHeight - a.offsetHeight)) {
      if (fits()) break;
      p.classList.add('fold-hide');
      hidden.push(p);
    }
    return hidden;
  }

  function pill(key, sum, onclick) {
    const b = h('button', { type: 'button', class: 'fold-pill', 'data-key': key, 'aria-haspopup': 'dialog', 'aria-expanded': open?.key === key ? 'true' : 'false', onclick },
      h('b', {}, key), sum ? h('span', { class: 'sum' }, sum) : null, h('i', { class: 'chev', 'aria-hidden': 'true' }));
    return b;
  }

  // ---------- 大屏铺满：按内容实际高度算放大倍数 --k ----------
  // 按基准尺寸（--k = 1）一次量完中间一列和两侧座位的内容高度、座位卡里名字的宽度，直接算出放大倍数
  // （最多 1.8 倍）；放大后再核对一次，估得不准才回缩（最多再量 2 次）。
  // 量布局很贵（改 --k 会让整页的字重新排版），所以只在版式签名变了（窗口大小、座位数、面板组成、折叠状态）
  // 或面板内容把中间一列撑出界时才重量；平时重画只按记下的结果把面板收起来，不读布局。
  const span = (box) => {
    const kids = [...box.children].filter((c) => c.offsetParent !== null);
    return kids.length ? kids.at(-1).getBoundingClientRect().bottom - kids[0].getBoundingClientRect().top : 0;
  };
  const NM_MIN = 84;
  const seatsOf = (cols) => cols.flatMap((c) => [...c.querySelectorAll('.seat:not(.seat-ghost)')]);
  // 横向也要放得下：座位卡里的名字不能被头像、身份牌挤成一条竖缝（8、9 人局的座位栏不随放大变宽）
  const squeezed = (cols) => seatsOf(cols).some((s) => s.scrollWidth > s.clientWidth + 1 || (s.querySelector('.nm')?.clientWidth ?? 99) < NM_MIN);
  function fit() {
    const cols = [...arena.querySelectorAll(':scope > .seats')];
    const ratios = [span(stageCol) / stageCol.clientHeight, ...cols.map((c) => span(c) / c.clientHeight)].filter((x) => x > 0 && Number.isFinite(x));
    if (!ratios.length) return;
    const focus1 = focusEl.clientHeight;
    // 名字能放大到几倍：座位卡宽度不变，号码牌、头像、身份牌和内边距按 k 放大，名字宽度 ≈ w − (w − 名字宽) × k
    let kW = 1.8;
    for (const s of seatsOf(cols)) {
      const nm = s.querySelector('.nm');
      if (!nm) continue;
      const w = s.clientWidth, n = nm.clientWidth;
      if (s.scrollWidth > w + 1 || n < NM_MIN) { kW = 1; break; }
      if (w - n > 0) kW = Math.min(kW, (w - NM_MIN) / (w - n));
    }
    let k = Math.max(1, Math.floor(Math.min(1.8, kW, 0.97 / Math.max(...ratios)) * 50) / 50);
    for (let i = 0; i < 3 && k > 1; i++) {
      arena.style.setProperty('--k', String(k));
      const over = stageCol.scrollHeight > stageCol.clientHeight + 1 || focusEl.clientHeight < focus1 - 2 || cols.some((c) => span(c) > c.clientHeight + 1) || squeezed(cols);
      if (!over) return;
      k = Math.max(1, Math.round((k - (i ? 0.12 : 0.06)) * 100) / 100);
    }
    arena.style.setProperty('--k', String(k));
  }

  // 版式签名：只用不读布局就拿得到的东西（窗口大小、断点、座位数、面板组成、座位卡右侧最多挂几枚身份牌/票数——
  // 挂得最多的那张卡最挤；投票时每多一票只是又一张卡挂上票数，不必重量）
  let layoutKey = null;
  let hiddenKeys = new Set();
  const layoutSig = () => [innerWidth, innerHeight, phone(), medium(),
    arena.querySelectorAll(':scope > .seats > .seat').length,
    panels().map(keyOf).join(','),
    Math.max(0, ...[...arena.querySelectorAll(':scope > .seats > .seat .side')].map((s) => s.querySelectorAll(':scope > :not(.wave)').length))].join('|');

  // 量过的签名记下结果（放大倍数、收起哪些面板）：投票开始又结束、夜里白天来回切，签名回到见过的样子时直接套用，不再量
  const memo = new Map();
  function measure(desktop) {
    if (desktop) arena.style.setProperty('--k', '1'); else arena.style.removeProperty('--k');
    // 量的时候焦点区不撑开（fit-measure），量完再让它把剩下的高度占满，屏幕上不留整块空白
    arena.classList.add('fit-measure');
    const hidden = decide();
    hiddenKeys = new Set(hidden.map(keyOf));
    folded = arena.classList.contains('folded');
    if (desktop && !folded) fit();
    arena.classList.remove('fit-measure');
    return { k: arena.style.getPropertyValue('--k'), folded, hidden: hiddenKeys };
  }
  function reuse(r) {
    if (r.k) arena.style.setProperty('--k', r.k); else arena.style.removeProperty('--k');
    arena.classList.toggle('folded', r.folded);
    folded = r.folded;
    hiddenKeys = r.hidden;
  }

  function update(force = false) {
    const s = layoutSig();
    if (force || s !== layoutKey) {
      layoutKey = s;
      if (!force && memo.has(s)) reuse(memo.get(s));
      else memo.set(s, measure(!medium()));
    }
    // 画面重画后面板是新节点：按记下的结果收起（不量）
    for (const p of panels()) p.classList.toggle('fold-hide', hiddenKeys.has(keyOf(p)));
    const hidden = panels().filter((p) => hiddenKeys.has(keyOf(p)));
    // 按钮内容没变就不重建（量的时候会频繁调用，重建会丢掉键盘焦点）
    const items = folded ? [...hidden.map((p) => [keyOf(p), p.dataset.sum || '']), ['记录', logLabel()]] : [];
    const sig = JSON.stringify(items);
    if (sig !== lastSig) {
      lastSig = sig;
      const had = document.activeElement?.closest?.('.fold-pill')?.dataset.key;
      dock.replaceChildren(...items.map(([k, sum]) => pill(k, sum, (e) => openSheet(k, e.currentTarget))));
      if (had) pillOf(had)?.focus({ preventScroll: true });
    }
    if (open) {
      if (!items.some(([k]) => k === open.key)) closeSheet(true);
      else fill();
    }
  }

  // ---------- 卡片 ----------
  function fill() {
    if (!open || open.key === '记录') return;
    const p = findPanel(open.key);
    if (!p) { closeSheet(); return; }
    const sum = p.dataset.sum;
    open.sub.textContent = sum || '';
    // 复制面板内容（面板里没有按钮），套一层画面模块的根类名，模块自己的样式照样生效
    open.body.replaceChildren(h('div', { class: `${panelRoot.className} fold-inner` }, ...[...p.children].slice(1).map((n) => n.cloneNode(true))));
  }

  function place(card) {
    if (phone()) { card.style.cssText = ''; card.classList.add('sheet-phone'); return; }
    card.classList.remove('sheet-phone');
    const r = stageCol.getBoundingClientRect();
    const bottom = Math.max(12, innerHeight - r.bottom);
    card.style.left = `${r.left}px`;
    card.style.width = `${r.width}px`;
    card.style.bottom = `${bottom}px`;
    card.style.maxHeight = `${Math.min(innerHeight * 0.72, r.height - 70)}px`;
  }

  function morph(card, from, opening) {
    const to = card.getBoundingClientRect();
    const fr = from?.isConnected ? from.getBoundingClientRect() : null;
    if (reduced() || !fr || !to.width) {
      return card.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], { duration: 180, easing: 'ease', fill: 'both' });
    }
    // 卡片停在终点，用裁切框画出胶囊的大小，再整体挪到胶囊的位置；动画里两者一起回到整张
    const pr = fr.height / 2;
    const clipFrom = `inset(0px ${to.width - fr.width}px ${to.height - fr.height}px 0px round ${pr}px)`;
    const clipTo = `inset(0px 0px 0px 0px round ${phone() ? '20px 20px 0 0' : '18px'})`;
    const moveFrom = `translate(${fr.left - to.left}px, ${fr.top - to.top}px)`;
    const frames = [
      { clipPath: clipFrom, transform: moveFrom, opacity: 0.9 },
      { clipPath: clipTo, transform: 'translate(0, 0)', opacity: 1 },
    ];
    return card.animate(opening ? frames : frames.reverse(), { duration: opening ? 560 : 420, easing: opening ? EASE_OPEN : EASE_CLOSE, fill: 'both' });
  }

  function openSheet(key, from) {
    if (open) { if (open.key === key) closeSheet(); return; }
    const back = h('div', { class: 'fold-back', 'aria-hidden': 'true', onclick: () => closeSheet() });
    const sub = h('span', { class: 'sub' });
    const close = h('button', { type: 'button', class: 'btn sm ghost fold-x', onclick: () => closeSheet() }, '收起');
    const head = h('div', { class: 'fold-head' }, h('div', { class: 'grab', 'aria-hidden': 'true' }), h('b', {}, key), sub, close);
    const body = h('div', { class: 'fold-body' });
    const card = h('div', { class: 'fold-sheet panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': key, tabindex: -1 }, head, body);
    open = { key, back, card, body, sub, from, home: null };
    if (key === '记录') {
      // 着法列表整个搬进卡片（保留点击跳转），收起时搬回去
      open.home = moves.parentNode;
      sub.textContent = logLabel();
      body.append(h('div', { class: 'fold-inner' }, moves));
    } else fill();
    document.body.append(back, card);
    document.documentElement.classList.add('fold-lock'); // 卡片开着时背后的页面不跟着滚
    place(card);
    from?.setAttribute('aria-expanded', 'true');
    from?.classList.add('lit');
    back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced() ? 150 : 360, easing: 'ease-out', fill: 'both' });
    morph(card, from, true);
    if (!reduced()) {
      for (const [el, delay] of [[head, 90], [body, 150]]) el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    }
    if (key === '记录') moves.querySelector('.mv.on')?.scrollIntoView({ block: 'center' });
    close.focus({ preventScroll: true });
    drag(head, card);
  }

  function closeSheet(instant = false) {
    if (!open) return;
    const o = open;
    open = null;
    const from = pillOf(o.key) || o.from;
    from?.setAttribute('aria-expanded', 'false');
    from?.classList.remove('lit');
    const done = () => {
      if (o.key === '记录' && o.home) o.home.append(moves);
      o.back.remove(); o.card.remove();
      document.documentElement.classList.remove('fold-lock');
      if (from?.isConnected && !instant) from.focus({ preventScroll: true });
    };
    if (instant) { done(); return; }
    o.back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 150 : 320, easing: 'ease-in', fill: 'both' });
    for (const el of o.card.children) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'both' });
    const a = o.card.dataset.dragged ? o.card.animate([{ transform: o.card.style.transform || 'none' }, { transform: 'translateY(105%)' }], { duration: 300, easing: 'cubic-bezier(.4,0,1,1)', fill: 'both' }) : morph(o.card, from, false);
    a.finished.then(done, done);
  }

  // 手机：按住卡片顶部往下拖，过 90px 或甩得够快就关上，否则弹回
  function drag(handle, card) {
    let y0 = null, t0 = 0, dy = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (!phone() || e.target.closest('button')) return;
      y0 = e.clientY; t0 = performance.now(); dy = 0;
      handle.setPointerCapture(e.pointerId);
      card.style.transition = 'none';
    });
    handle.addEventListener('pointermove', (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.clientY - y0);
      card.getAnimations().forEach((a) => a.cancel());
      card.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (y0 === null) return;
      const v = dy / Math.max(1, performance.now() - t0);
      y0 = null;
      if (dy > 90 || v > 0.6) { card.dataset.dragged = '1'; closeSheet(); return; }
      card.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 380, easing: EASE_OPEN });
      card.style.transform = '';
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  const onKey = (e) => { if (e.key === 'Escape' && open) { e.preventDefault(); closeSheet(); } };
  let raf = 0;
  const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { update(); if (open) place(open.card); }); };
  addEventListener('keydown', onKey);
  addEventListener('resize', onResize);

  // 焦点区内容变了（换人看、思考流式输出）时合并到下一帧过一遍签名（签名没变就不量）
  let pend = 0;
  // 最多每 400ms 一次（流式输出时焦点区每帧都在变）
  let lastRun = 0;
  const schedule = () => {
    if (pend) return;
    const wait = Math.max(0, 400 - (performance.now() - lastRun));
    pend = setTimeout(() => requestAnimationFrame(() => { pend = 0; lastRun = performance.now(); update(); }), wait);
  };
  // 面板内容变多、把中间一列撑出界时才重量。ResizeObserver 在浏览器排完版之后回调，这里读布局不会多排一次
  let overAt = -1;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!arena.isConnected || medium()) return;
    // 面板已经全收起来了：再量也收不出地方
    if (folded && panels().every((p) => hiddenKeys.has(keyOf(p)))) return;
    const sh = stageCol.scrollHeight;
    if (sh > stageCol.clientHeight + 1 && sh !== overAt) { overAt = sh; memo.delete(layoutKey); layoutKey = null; schedule(); }
  }) : null;
  ro?.observe(panelRoot);
  return {
    el: dock,
    update,
    schedule,
    destroy() { removeEventListener('keydown', onKey); removeEventListener('resize', onResize); ro?.disconnect(); clearTimeout(pend); closeSheet(true); },
  };
}
