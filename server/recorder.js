// 录制：服务端用无界面浏览器打开对局的录制版式（#/match/<id>?record=1），自动回放并录成 1080p MP4。
// 一次只录一个，任务记在 recordings 表里；文件放在 data/recordings/。

import { existsSync, mkdirSync, statSync, createReadStream, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { newId, now } from './db.js';
import { HttpError } from './http.js';

const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findChrome() {
  if (process.env.ARENA_CHROME && existsSync(process.env.ARENA_CHROME)) return process.env.ARENA_CHROME;
  return CHROME_PATHS.find((p) => existsSync(p)) || null;
}

export class Recorder {
  /** sessionToken()：录制用的临时登录会话（不开放观战时也能打开对局页） */
  constructor({ db, outDir, baseUrl, sessionToken = null }) {
    this.sessionToken = sessionToken;
    this.db = db;
    this.outDir = outDir;
    this.baseUrl = baseUrl;
    this.running = null;
    mkdirSync(outDir, { recursive: true });
    // 服务重启时把没录完的任务标为失败
    db.run("UPDATE recordings SET status = 'failed', error = '服务重启，录制中断' WHERE status IN ('queued', 'running')");
  }

  status() {
    return { chrome: !!findChrome() };
  }

  start(matchId, { speed = 2 } = {}) {
    const m = this.db.get('SELECT id, status, actions FROM matches WHERE id = ?', matchId);
    if (!m) throw new HttpError(404, '对局不存在');
    if (m.status === 'running') throw new HttpError(409, '对局结束后才能录制');
    if (!m.actions.length) throw new HttpError(400, '这盘没有可回放的步骤');
    if (!findChrome()) throw new HttpError(500, '服务器上没有找到 Chrome、Edge 或 Chromium，无法录制');
    const job = { id: newId('rec'), match_id: matchId, speed: Math.max(0.5, Math.min(8, Number(speed) || 2)), status: 'queued', file: null, error: null, created_at: now(), finished_at: null };
    this.db.insert('recordings', job);
    this.#next();
    return job;
  }

  list() {
    return this.db.all('SELECT r.*, m.game FROM recordings r LEFT JOIN matches m ON m.id = r.match_id ORDER BY r.created_at DESC LIMIT 50');
  }

  /** 下载录好的文件 */
  send(id, res) {
    const r = this.db.get('SELECT * FROM recordings WHERE id = ?', id);
    if (!r || r.status !== 'done' || !r.file) throw new HttpError(404, '录制文件不存在');
    const file = join(this.outDir, r.file);
    if (!existsSync(file)) throw new HttpError(404, '录制文件已被删除');
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': statSync(file).size, 'Content-Disposition': `attachment; filename="${r.file}"` });
    createReadStream(file).pipe(res);
  }

  async #next() {
    if (this.running) return;
    const job = this.db.get("SELECT * FROM recordings WHERE status = 'queued' ORDER BY created_at LIMIT 1");
    if (!job) return;
    this.running = job.id;
    this.db.update('recordings', { id: job.id }, { status: 'running' });
    try {
      const file = await this.#record(job);
      this.db.update('recordings', { id: job.id }, { status: 'done', file, finished_at: now() });
    } catch (e) {
      console.error('[录制]', e);
      this.db.update('recordings', { id: job.id }, { status: 'failed', error: String(e.message || e).slice(0, 300), finished_at: now() });
    } finally {
      this.running = null;
      setImmediate(() => this.#next());
    }
  }

  async #record(job) {
    const { default: puppeteer } = await import('puppeteer-core');
    const turns = this.db.all('SELECT latency_ms, analysis FROM turns WHERE match_id = ?', job.match_id);
    // 预计时长：与前端回放的节奏一致（每步 0.9–5 秒，除以倍速），再留余量；最长 40 分钟
    const est = turns.reduce((n, t) => n + Math.min(5000, Math.max(900, (t.latency_ms || 900) * 0.6 + (t.analysis ? 600 : 0))), 0) / job.speed;
    const timeout = Math.min(40 * 60e3, est * 1.5 + 60e3);
    const file = `${job.match_id}-${job.speed}x-${Date.now().toString(36)}.mp4`;
    const browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--window-size=1920,1080', '--force-device-scale-factor=1'],
      defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    });
    try {
      const page = await browser.newPage();
      if (this.sessionToken) await browser.setCookie({ name: 'dsqq_sid', value: this.sessionToken(), domain: new URL(this.baseUrl).hostname, path: '/', httpOnly: true });
      await page.goto(`${this.baseUrl}/#/match/${job.match_id}?record=1&speed=${job.speed}`, { waitUntil: 'domcontentloaded', timeout: 60e3 });
      await page.waitForSelector('.arena', { timeout: 30e3 });
      await page.evaluate(() => document.fonts.ready);
      const raw = join(this.outDir, `${file}.raw.mp4`);
      const rec = await page.screencast({ path: raw, format: 'mp4', fps: 30, ffmpegPath: process.env.ARENA_FFMPEG || 'ffmpeg' });
      await page.waitForFunction(() => window.__replayDone === true, { timeout, polling: 500 });
      await new Promise((r) => setTimeout(r, 2500)); // 停在终局画面
      await rec.stop();
      await browser.close().catch(() => {});
      // 浏览器录出的是 VP9，转成通用的 H.264（B 站和各种播放器都能直接用）
      await transcode(raw, join(this.outDir, file));
      try { unlinkSync(raw); } catch { /* 忽略 */ }
    } finally {
      await browser.close().catch(() => {});
    }
    return file;
  }
}

function transcode(input, output) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.ARENA_FFMPEG || 'ffmpeg', ['-y', '-v', 'error', '-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`转码失败：${err.slice(-300)}`))));
  });
}
