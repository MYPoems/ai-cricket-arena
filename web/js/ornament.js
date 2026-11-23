// 纹样：祥云、回纹。全部用几何规则生成，保证曲线平滑、线宽一致。
//
// 祥云（如意云）的画法：
//   - 云头是一圈连续的外轮廓：左副瓣、主瓣、右副瓣三段圆弧，在相交处形成凹口，底边微微起伏；
//   - 每个云瓣里有一个涡卷，从轮廓的凹口处相切引出，向内卷 1.1–1.4 圈（对数螺线，越卷越小）；
//   - 「双线勾边」：每条线都画成两道等宽的细金线夹一道底色（先描粗金线，再在上面描细底色线）；
//   - 云尾接在一侧云瓣的底部，由粗到细，略带 S 形，同样是双线勾边；
//   - 只作点缀：放在边缘、标题背后、留白处，不铺满整页，不压在文字上。
// 回纹：画在整数网格上，线宽等于间隔（正负形等宽），方折；连续带饰用一条底线串起各个单元，转角用「回」字方块收口。

const f = (n) => Math.round(n * 100) / 100;

/** 点列 → 平滑路径（Catmull-Rom 转三次贝塞尔） */
function smooth(pts, move = true) {
  let d = move ? `M${f(pts[0][0])} ${f(pts[0][1])}` : '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** 两圆的交点里偏上的那个（屏幕坐标 y 向下） */
function upperIntersection([x1, y1], r1, [x2, y2], r2) {
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = x1 + (a * dx) / d, my = y1 + (a * dy) / d;
  const p = [mx + (h * dy) / d, my - (h * dx) / d], q = [mx - (h * dy) / d, my + (h * dx) / d];
  return p[1] < q[1] ? p : q;
}

/** 涡卷：从圆 (c, r) 上角度 a0 处出发，沿 dir 方向往里卷 turns 圈 */
function curl([cx, cy], r, a0, dir, turns, shrink = 0.38) {
  const k = Math.log(shrink) / (2 * Math.PI);
  const n = Math.round(48 * turns);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * turns * 2 * Math.PI;
    const rr = r * Math.exp(k * t);
    // 卷心略向圆心下方偏，让涡卷看起来「坐」在云瓣里
    const ox = 0, oy = (1 - Math.exp(k * t)) * r * 0.12;
    pts.push([cx + ox + rr * Math.cos(a0 + dir * t), cy + oy + rr * Math.sin(a0 + dir * t)]);
  }
  return smooth(pts);
}

const angle = ([cx, cy], [x, y]) => Math.atan2(y - cy, x - cx);

/**
 * 如意云的中心线（单位坐标：宽约 120，高 70）。返回 { lines: [d...], tail: [点...] | null, box }
 */
function cloudLines({ tail = 'right' } = {}) {
  const L = [31, 43], rL = 13, M = [60, 32], rM = 21.5, R = [89, 43], rR = 13;
  const base = 56;
  const pLM = upperIntersection(L, rL, M, rM);
  const pMR = upperIntersection(M, rM, R, rR);
  // 外轮廓：左瓣底部 → 顺时针绕左瓣 → 凹口 → 绕主瓣 → 凹口 → 绕右瓣 → 右瓣底部；底边带一点起伏回到起点
  const outline = `M${L[0]} ${base}A${rL} ${rL} 0 1 1 ${f(pLM[0])} ${f(pLM[1])}A${rM} ${rM} 0 1 1 ${f(pMR[0])} ${f(pMR[1])}A${rR} ${rR} 0 1 1 ${R[0]} ${base}`
    + `C${R[0] - 9} ${base + 2.2} ${M[0] + 10} ${base - 2.4} ${M[0]} ${base - 1}C${M[0] - 10} ${base + 0.4} ${L[0] + 9} ${base + 2.2} ${L[0]} ${base}Z`;
  // 涡卷：主瓣从左凹口顺时针往里卷；左瓣从左凹口逆时针；右瓣从右凹口顺时针
  const inset = 3.4; // 涡卷第一圈离外轮廓的距离（等于一条双线的宽度，保证不粘连）
  const curls = [
    curl(M, rM - inset, angle(M, pLM) + 0.25, 1, 1.5, 0.46),
    curl(L, rL - inset, angle(L, pLM) - 0.35, -1, 1.15),
    curl(R, rR - inset, angle(R, pMR) + 0.35, 1, 1.15),
  ];
  let tailPts = null;
  if (tail !== 'none') {
    const s = tail === 'right' ? 1 : -1;
    // 云尾从云头底部内侧长出来（起点被云头的底色盖住），先贴着底边往外，再扬起、收尖
    const x0 = tail === 'right' ? R[0] - 12 : L[0] + 12;
    tailPts = Array.from({ length: 49 }, (_, i) => {
      const t = i / 48;
      return [x0 + s * t * 78, base - 3 + Math.sin(t * Math.PI) * 5.5 - Math.pow(t, 2.2) * 14];
    });
  }
  return { outline, curls, tailPts };
}

/** 云尾的实心形状：沿中心线由宽到窄 */
function ribbon(points, w0, w1) {
  const n = points.length;
  const a = [], b = [];
  for (let i = 0; i < n; i++) {
    const p = points[i], q = points[Math.min(n - 1, i + 1)], o = points[Math.max(0, i - 1)];
    const dx = q[0] - o[0], dy = q[1] - o[1], len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, w = (w0 + (w1 - w0) * Math.pow(i / (n - 1), 0.85)) / 2;
    a.push([p[0] + nx * w, p[1] + ny * w]);
    b.push([p[0] - nx * w, p[1] - ny * w]);
  }
  return `${smooth(a)}L${f(b[n - 1][0])} ${f(b[n - 1][1])}${smooth(b.reverse(), false)}Z`;
}

/**
 * 一朵祥云（SVG 字符串）。
 * opts: width 像素宽；color 线色；ground 底色（双线中间「挖空」的颜色，要和放置处的底色一致）；
 *       weight 单道金线的粗细（单位坐标）；gap 两道金线之间的距离；tail 'left' | 'right' | 'none'；fill 云头内部填色（可选）
 */
export function cloud({ width = 120, color = '#d9b25a', ground = '#2a0b08', weight = 0.9, gap = 1.5, tail = 'right', opacity = 1, fill = null } = {}) {
  const { outline, curls, tailPts } = cloudLines({ tail });
  const vbX = tail === 'left' ? -64 : 8, vbW = tail === 'none' ? 112 : 178, vbY = 4, h = 60;
  const W = gap + weight * 2;
  const dbl = (d, closed = false) => `<path d="${d}" fill="${closed && fill ? fill : 'none'}" stroke="${color}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${closed && fill ? fill : ground}" stroke-width="${gap}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const tailSvg = tailPts ? `<path d="${ribbon(tailPts, W * 2.4, 0.3)}" fill="${ground}" stroke="${color}" stroke-width="${weight}" stroke-linejoin="round"/>` : '';
  // 先画云尾（压在云头下面），再画外轮廓（带底色填充，盖住云尾的起点），最后画涡卷
  const head = `<path d="${outline}" fill="${fill || ground}"/>${dbl(outline, true)}${curls.map((d) => dbl(d)).join('')}`;
  return `<svg viewBox="${vbX} ${vbY} ${vbW} ${h}" width="${width}" height="${f((width * h) / vbW)}" style="opacity:${opacity};display:block" aria-hidden="true">${tailSvg}${head}</svg>`;
}

/**
 * 回纹带（SVG 字符串）：横向连续，单元宽 8 格，底线串联。unit：一格多少像素；length：大约总长（像素）
 * 单元在 8×8 网格上：从底线竖起 → 方折向内卷两圈；线宽 = 间隔 = 1 格。
 */
export function fretBand({ length = 400, unit = 1.5, color = '#d9b25a', opacity = 1 } = {}) {
  const U = 8;
  const n = Math.max(1, Math.floor(length / (unit * U)));
  const cell = (x) => `M${x + 0.5} 7.5V0.5H${x + 6.5}V5.5H${x + 2.5}V2.5H${x + 4.5}V3.5`;
  const d = Array.from({ length: n }, (_, i) => cell(i * U)).join('') + `M0 7.5H${n * U}`;
  return `<svg viewBox="0 0 ${n * U} 8" width="${n * U * unit}" height="${8 * unit}" style="opacity:${opacity};display:block" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1" stroke-linecap="square"/></svg>`;
}

/** 「回」字角块：两圈方框加中心点，给回纹带在转角处收口 */
export function fretCorner({ size = 14, color = '#d9b25a', opacity = 1 } = {}) {
  return `<svg viewBox="0 0 9 9" width="${size}" height="${size}" style="opacity:${opacity};display:block" aria-hidden="true"><path d="M0.5 0.5H8.5V8.5H0.5ZM2.5 2.5H6.5V6.5H2.5Z" fill="none" stroke="${color}" stroke-width="1"/><rect x="4" y="4" width="1" height="1" fill="${color}"/></svg>`;
}

/** 回纹带做成 CSS 背景图（横向平铺用） */
export function fretBandCss(color = '#d9b25a', unit = 1.5) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8' width='${8 * unit}' height='${8 * unit}'><path d='M0.5 7.5V0.5H6.5V5.5H2.5V2.5H4.5V3.5M0 7.5H8' fill='none' stroke='${color}' stroke-width='1' stroke-linecap='square'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
