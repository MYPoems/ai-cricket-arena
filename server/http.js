// 极简 HTTP 框架：路由、JSON、静态文件、SSE 推送。

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

  on(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    this.routes.push({ method, re, keys, handler });
  }

  get(p, h) { this.on('GET', p, h); }
  post(p, h) { this.on('POST', p, h); }
  patch(p, h) { this.on('PATCH', p, h); }
  delete(p, h) { this.on('DELETE', p, h); }

  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1e6) throw new HttpError(413, '请求太大');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON');
  }
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
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
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
    return true;
  }
  return false;
}

export function handler(router, mounts) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const m = router.match(req.method, url.pathname);
        if (!m) throw new HttpError(404, '接口不存在');
        const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJson(req) : {};
        const out = await m.handler({ req, res, params: m.params, query: Object.fromEntries(url.searchParams), body });
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
      sendJson(res, status, { error: err.message || '服务器错误' });
    }
  };
}

/** SSE 推送中心：按频道广播事件 */
export class Hub {
  constructor() {
    this.channels = new Map();
    setInterval(() => this.#ping(), 25000).unref();
  }

  subscribe(req, res, channels) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    for (const ch of channels) {
      if (!this.channels.has(ch)) this.channels.set(ch, new Set());
      this.channels.get(ch).add(res);
    }
    req.on('close', () => {
      for (const ch of channels) this.channels.get(ch)?.delete(res);
    });
  }

  emit(channel, event) {
    const subs = this.channels.get(channel);
    if (!subs?.size) return;
    const data = `data: ${JSON.stringify({ ch: channel, ...event })}\n\n`;
    for (const res of subs) res.write(data);
  }

  watchers(channel) {
    return this.channels.get(channel)?.size || 0;
  }

  #ping() {
    for (const subs of this.channels.values()) for (const res of subs) res.write(': ping\n\n');
  }
}
