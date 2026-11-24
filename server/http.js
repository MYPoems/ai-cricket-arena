// 极简 HTTP 框架：路由（带权限级别）、JSON、静态文件、SSE 推送。

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * opts.auth：谁能调用。
   *   any    任何人（登录、注册、agent 自己的令牌接口）
   *   public 登录用户；开放观战时游客也可以（GET 的默认值）
   *   user   登录用户（写操作的默认值）
   *   admin  庄家
   */
  on(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    this.routes.push({ method, re, keys, handler, auth: opts.auth || (method === 'GET' ? 'public' : 'user') });
  }

  get(p, h, o) { this.on('GET', p, h, o); }
  post(p, h, o) { this.on('POST', p, h, o); }
  patch(p, h, o) { this.on('PATCH', p, h, o); }
  delete(p, h, o) { this.on('DELETE', p, h, o); }

  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      try {
        return { handler: r.handler, auth: r.auth, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      } catch {
        throw new HttpError(400, '请求地址不合法');
      }
    }
    return null;
  }
}

async function readJson(req) {
  // 只接受同源 JSON：跨站的表单提交带不了这个类型，浏览器又会自动带上登录 Cookie
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, '请求必须是 JSON');
  const sameOrigin = !req.headers.origin || (() => { try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; } })();
  if (!sameOrigin) throw new HttpError(403, '不接受跨站请求');
  const chunks = [];
  let size = 0;
  let tooBig = false;
  for await (const c of req) {
    size += c.length;
    if (size > 1e6) { tooBig = true; if (size > 9e6) { req.destroy(); break; } continue; }
    chunks.push(c);
  }
  if (tooBig) throw new HttpError(413, '请求太大');
  if (!chunks.length) return {};
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '请求体必须是 JSON 对象');
  return body;
}

/** 请求来自哪个地址：经 Cloudflare 隧道时用它带来的真实地址，否则用连接的对端地址 */
export const ipOf = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64);

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

/** 静态文件：mounts 为 [[url 前缀, 本地目录]] */
function serveStatic(req, res, path, mounts) {
  for (const [prefix, dir] of mounts) {
    if (!path.startsWith(prefix)) continue;
    let rel = path.slice(prefix.length) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const root = resolve(dir);
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) return false;
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    createReadStream(file).pipe(res);
    return true;
  }
  return false;
}

/**
 * resolveUser(req)：从登录会话找出用户（没登录返回 null）；publicView()：游客能不能观战（只读接口）。
 * 静态页面总是能打开（登录页要能加载），接口按路由的 auth 级别检查。
 */
export function handler(router, mounts, { resolveUser = () => null, publicView = () => true } = {}) {
  return async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('请求地址不合法');
      return;
    }
    try {
      if (url.pathname.startsWith('/api/')) {
        const m = router.match(req.method, url.pathname);
        if (!m) throw new HttpError(404, '接口不存在');
        req.user = resolveUser(req);
        if (m.auth === 'public' && !req.user && !publicView()) throw new HttpError(401, '请先登录');
        if ((m.auth === 'user' || m.auth === 'admin') && !req.user) throw new HttpError(401, '请先登录');
        if (m.auth === 'admin' && req.user.role !== 'admin') throw new HttpError(403, '只有庄家可以这样做');
        const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ? await readJson(req) : {};
        const out = await m.handler({ req, res, params: m.params, query: Object.fromEntries(url.searchParams), body, user: req.user });
        if (out !== undefined && !res.headersSent) sendJson(res, 200, out);
        return;
      }
      if (req.method === 'GET' && serveStatic(req, res, url.pathname, mounts)) return;
      // 前端路由：未知路径都返回首页
      if (req.method === 'GET' && !extname(url.pathname) && serveStatic(req, res, '/', mounts)) return;
      throw new HttpError(404, '页面不存在');
    } catch (err) {
      if (res.headersSent) { res.end(); return; }
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      // 没有标明状态码的意外错误（代码异常、数据库报错）不把内部细节回给浏览器
      sendJson(res, status, { error: (err.status ? err.message : '') || '服务器错误' });
    }
  };
}

/** SSE 推送中心：按频道广播事件 */
/** 事件流连接的上限：总数，和同一个地址的（一个标签页只开一条，够用；防止有人开一堆长连接把服务拖住） */
export const SSE_MAX = 800;
export const SSE_MAX_PER_IP = 40;
const SSE_BACKLOG = 2e6; // 一条连接最多积压这么多字节没发出去

export class Hub {
  constructor() {
    this.channels = new Map();
    this.total = 0;
    this.perIp = new Map();
    setInterval(() => this.#ping(), 25000).unref();
  }

  subscribe(req, res, channels) {
    const ip = ipOf(req);
    if (this.total >= SSE_MAX || (this.perIp.get(ip) || 0) >= SSE_MAX_PER_IP) throw new HttpError(429, '实时连接太多，稍后再试');
    this.total++;
    this.perIp.set(ip, (this.perIp.get(ip) || 0) + 1);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    for (const ch of channels) {
      if (!this.channels.has(ch)) this.channels.set(ch, new Set());
      this.channels.get(ch).add(res);
    }
    let closed = false;
    req.on('close', () => {
      if (closed) return;
      closed = true;
      this.total--;
      const n = (this.perIp.get(ip) || 1) - 1;
      if (n > 0) this.perIp.set(ip, n); else this.perIp.delete(ip);
      for (const ch of channels) {
        const subs = this.channels.get(ch);
        if (!subs) continue;
        subs.delete(res);
        if (!subs.size) this.channels.delete(ch); // 没人听的频道不留着
      }
    });
  }

  emit(channel, event) {
    const subs = this.channels.get(channel);
    if (!subs?.size) return;
    const data = `data: ${JSON.stringify({ ch: channel, ...event })}\n\n`;
    for (const res of subs) this.#send(res, data);
  }

  watchers(channel) {
    return this.channels.get(channel)?.size || 0;
  }

  /** 写给一个连接；对方一直不收、积压超过 SSE_BACKLOG 就断开（它重连后刷新详情即可），免得挂着不读的连接把内存撑大 */
  #send(res, data) {
    if (res.writableLength > SSE_BACKLOG) { res.destroy?.(); return; }
    res.write(data);
  }

  #ping() {
    for (const subs of this.channels.values()) for (const res of subs) this.#send(res, ': ping\n\n');
  }
}
