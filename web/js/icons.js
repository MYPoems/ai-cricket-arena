// 线条图标：24×24 网格、圆头描边、颜色跟随文字（currentColor）。全部手写，不依赖外部图标库。
// 用法：icon('play') → <svg>；icon('play', 16) 指定边长。图标只作装饰（aria-hidden），按钮自己写 aria-label。

const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  play: '<path d="M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5z"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
  prev: '<path d="M18 19.5 8.5 12 18 4.5v15z"/><path d="M5.5 5v14"/>',
  next: '<path d="M6 4.5 15.5 12 6 19.5v-15z"/><path d="M18.5 5v14"/>',
  skip: '<path d="M3 5.5 11 12l-8 6.5v-13z"/><path d="M12 5.5 20 12l-8 6.5v-13z"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
  flip: '<path d="M7 20V4"/><path d="M3 8l4-4 4 4"/><path d="M17 4v16"/><path d="M13 16l4 4 4-4"/>',
  download: '<path d="M12 3.5v12"/><path d="M7 10.5l5 5 5-5"/><path d="M4.5 20.5h15"/>',
  link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6"/>',
  sound: '<path d="M11 5 6.5 9H3v6h3.5L11 19V5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M11 5 6.5 9H3v6h3.5L11 19V5z"/><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5c4-2.4 7 2.4 14 0v9c-7 2.4-10-2.4-14 0"/>',
  record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20.5 13.6A8.5 8.5 0 1 1 10.4 3.5a6.6 6.6 0 0 0 10.1 10.1z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.6v.1"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  expand: '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  'chevron-left': '<path d="M15 5l-7 7 7 7"/>',
  'chevron-right': '<path d="M9 5l7 7-7 7"/>',
  'chevron-down': '<path d="M5 9l7 7 7-7"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.5 14.2a5 5 0 0 1 3 4.6V20"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5v-1a5.5 5.5 0 0 1 5.5-5.5h4a5.5 5.5 0 0 1 5.5 5.5v1"/>',
  trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0V4z"/><path d="M16.5 5.5h3v1.5a3 3 0 0 1-3 3"/><path d="M7.5 5.5h-3v1.5a3 3 0 0 0 3 3"/><path d="M12 13.5V17"/><path d="M8 20.5h8"/><path d="M9.5 20.5c0-2 1-3.5 2.5-3.5s2.5 1.5 2.5 3.5"/>',
  swords: '<path d="M14.5 17.5 3.5 6.5v-3h3l11 11"/><path d="M13 19l6-6"/><path d="M16 16l3.5 3.5"/><path d="M18.5 21l2.5-2.5"/><path d="M14.5 6.5l3-3h3v3l-3 3"/><path d="M5 13l6 6"/><path d="M8 16l-3.5 3.5"/><path d="M3 18.5 5.5 21"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  settings: '<path d="M4 6.5h9"/><path d="M17 6.5h3"/><path d="M4 12h3"/><path d="M11 12h9"/><path d="M4 17.5h11"/><path d="M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11.5h13V9"/><path d="M10 20.5v-5.5h4v5.5"/>',
  cricket: '<ellipse cx="12" cy="14" rx="4" ry="6"/><path d="M12 8V4.5"/><path d="M10 8.6 6.5 3.5"/><path d="M14 8.6l3.5-5.1"/><path d="M8.2 12.5 4 10.5"/><path d="M15.8 12.5l4.2-2"/><path d="M8.6 17 4.5 20"/><path d="M15.4 17l4.1 3"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  shield: '<path d="M12 21s7.5-3.6 7.5-9.5V5.5L12 3 4.5 5.5v6C4.5 17.4 12 21 12 21z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  logout: '<path d="M14.5 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4"/><path d="M10 16.5 5.5 12 10 7.5"/><path d="M5.5 12h10"/>',
  refresh: '<path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M4 20v-4.5h4.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15.8 15.8 0 0 1-2.6 3.3"/><path d="M6.4 6.9A15.6 15.6 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9 9 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};

/** 返回一个内联 SVG 图标元素 */
export function icon(name, size = 18) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `ico ico-${name}`);
  svg.innerHTML = PATHS[name] || PATHS.info;
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS);
