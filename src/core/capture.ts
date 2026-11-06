import type { Browser, BrowserContext, Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Device, DeviceState, Layout, ShotMeta, TgRuntime } from '../shared/types.js';
import { renderFrame } from '../shared/frame.js';

/**
 * Screenshot compositing without image libraries: a tiny HTML page in the already-running Chromium
 * lays out frame SVG + page PNG, then screenshots itself. Images are served from disk via route.fulfill({path})
 * so full-size PNGs never sit in Node memory longer than Playwright's own capture.
 */
export class Compositor {
  private ctxs = new Map<number, Promise<BrowserContext>>();
  private timer?: NodeJS.Timeout;
  constructor(private browser: () => Promise<Browser>, private onIdle: (active: boolean) => void) {}

  private async page(scale: number): Promise<Page> {
    clearTimeout(this.timer);
    let c = this.ctxs.get(scale);
    if (!c) {
      this.onIdle(true);
      c = this.browser().then((b) => b.newContext({ deviceScaleFactor: scale, viewport: { width: 800, height: 600 } }));
      this.ctxs.set(scale, c);
    }
    const ctx = await c;
    return ctx.pages()[0] ?? ctx.newPage();
  }

  /** Render html (with files served at http://bezels.local/<name>) to an image file. */
  async render(o: { html: string; files: Record<string, string>; width: number; height: number; scale: number; transparent: boolean; out: string; type?: 'png' | 'jpeg'; quality?: number }): Promise<string> {
    const page = await this.page(o.scale);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('http://bezels.local/**', (r) => {
      const name = decodeURIComponent(new URL(r.request().url()).pathname.slice(1));
      if (name === 'index.html') return r.fulfill({ contentType: 'text/html', body: o.html });
      const f = o.files[name];
      return f ? r.fulfill({ path: f }) : r.fulfill({ status: 404 });
    });
    await page.setViewportSize({ width: Math.max(1, Math.ceil(o.width)), height: Math.max(1, Math.ceil(o.height)) });
    await page.goto('http://bezels.local/index.html', { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {}))));
    await page.screenshot({ path: o.out, type: o.type ?? 'png', quality: o.type === 'jpeg' ? o.quality ?? 72 : undefined, omitBackground: o.transparent, clip: { x: 0, y: 0, width: Math.ceil(o.width), height: Math.ceil(o.height) } });
    this.scheduleClose();
    return o.out;
  }

  private scheduleClose() {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      const all = [...this.ctxs.values()];
      this.ctxs.clear();
      for (const c of all) { await c.then((x) => x.close()).catch(() => {}); this.onIdle(false); }
    }, 30_000).unref();
  }

  async close() { clearTimeout(this.timer); for (const c of this.ctxs.values()) { await c.then((x) => x.close()).catch(() => {}); this.onIdle(false); } this.ctxs.clear(); }
}

const BG = '#0E0F12';
const page = (body: string, bg: string | null) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${bg ?? 'transparent'};font-family:Inter,system-ui,sans-serif}</style></head><body>${body}</body></html>`;

/** Stretch the layout's screen to the full page height for framed full-page shots. */
export function extendLayout(L: Layout, pageH: number): Layout {
  const extra = Math.max(0, Math.round(pageH - L.viewport.h));
  if (!extra) return L;
  const mv = <T extends { y: number } | null>(r: T, after: number): T => (r && r.y >= after ? { ...r, y: r.y + extra } : r);
  const vpBottom = L.viewport.y + L.viewport.h;
  return {
    ...L,
    screen: { w: L.screen.w, h: L.screen.h + extra },
    viewport: { ...L.viewport, h: L.viewport.h + extra },
    chromeBottom: mv(L.chromeBottom, vpBottom - 1), navBar: mv(L.navBar, vpBottom - 1),
    hinge: L.hinge && L.hinge.h > L.hinge.w ? { ...L.hinge, h: L.hinge.h + extra } : L.hinge,
    tg: L.tg ? { ...L.tg, bottomBar: mv(L.tg.bottomBar, vpBottom - 1) } : null,
    frame: { ...L.frame, h: L.frame.h + extra },
  };
}

export interface FrameInput { device: Device; state: DeviceState; layout: Layout; url: string; tg?: TgRuntime; title?: string }

export function framedHtml(f: FrameInput, imgName: string, bg: string | null) {
  const fr = renderFrame(f.device, f.state, f.layout, f.url, f.tg, f.title);
  const L = f.layout;
  const x = L.frame.offsetX + L.viewport.x, y = L.frame.offsetY + L.viewport.y;
  const body = `<div style="position:relative;width:${fr.w}px;height:${fr.h}px">
    <div style="position:absolute;inset:0">${fr.under}</div>
    <img src="http://bezels.local/${encodeURIComponent(imgName)}" style="position:absolute;left:${x}px;top:${y}px;width:${L.viewport.w}px;height:${L.viewport.h}px">
    <div style="position:absolute;inset:0">${fr.over}</div></div>`;
  return { html: page(body, bg), w: fr.w, h: fr.h };
}

export function sheetHtml(cells: { file: string; w: number; h: number; label: string; sub: string }[], bg: string | null, cellH = 720) {
  const pad = 48, gap = 40, labelH = 52, maxRow = Math.max(1800, Math.min(5200, cells.reduce((a, c) => a + (c.w * cellH) / c.h + gap, 0) / Math.ceil(cells.length / 5)));
  let x = pad, y = pad, rowH = 0, maxW = 0;
  const parts: string[] = [];
  const files: Record<string, string> = {};
  cells.forEach((c, i) => {
    const w = (c.w * cellH) / c.h;
    if (x + w > maxRow + pad && x > pad) { x = pad; y += rowH + gap; rowH = 0; }
    const name = `cell${i}.png`;
    files[name] = c.file;
    const fg = bg ? '#ECEEF2' : '#111318', mute = bg ? '#A3AAB6' : '#5A606B';
    parts.push(`<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;text-align:center"><img src="http://bezels.local/${name}" style="width:${w}px;height:${cellH}px;display:block"><div style="margin-top:12px;font-size:20px;font-weight:600;color:${fg}">${esc(c.label)}</div><div style="font-size:15px;color:${mute};font-family:'JetBrains Mono',monospace">${esc(c.sub)}</div></div>`);
    x += w + gap; rowH = Math.max(rowH, cellH + labelH); maxW = Math.max(maxW, x - gap + pad);
  });
  const H = y + rowH + pad;
  return { html: page(`<div style="position:relative;width:${maxW}px;height:${H}px">${parts.join('')}</div>`, bg), files, w: maxW, h: H };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Shots on disk + a small JSON index. The UI only ever loads thumbnails until you copy/save. */
export class ShotStore {
  private index: ShotMeta[] = [];
  private file: string;
  constructor(public dir: string) {
    mkdirSync(join(dir, '.thumbs'), { recursive: true });
    this.file = join(dir, '.thumbs', 'index.json');
    try { this.index = JSON.parse(readFileSync(this.file, 'utf8')); } catch { this.index = []; }
    this.index = this.index.filter((s) => existsSync(join(dir, s.file)));
  }
  /** 2026-11-06_iphone-16-pro_portrait.png, adding the time if the name is taken. */
  name(parts: string[]): string {
    const now = new Date();
    const d = now.toISOString().slice(0, 10);
    const base = [d, ...parts].join('_').replace(/[^\w.-]+/g, '-');
    if (!existsSync(join(this.dir, base + '.png'))) return base + '.png';
    const t = now.toTimeString().slice(0, 8).replace(/:/g, '');
    let n = base + '_' + t + '.png', i = 2;
    while (existsSync(join(this.dir, n))) n = `${base}_${t}-${i++}.png`;
    return n;
  }
  path(file: string) { return join(this.dir, basename(file)); }
  thumbPath(file: string) { return join(this.dir, '.thumbs', basename(file).replace(/\.png$/, '.jpg')); }
  add(m: ShotMeta) { this.index.unshift(m); this.index = this.index.slice(0, 300); this.save(); return m; }
  list(limit = 60) { return this.index.slice(0, limit); }
  get(id: string) { return this.index.find((s) => s.id === id); }
  remove(id: string) { this.index = this.index.filter((s) => s.id !== id); this.save(); }
  size(file: string) { try { return statSync(this.path(file)).size; } catch { return 0; } }
  private save() { writeFileSync(this.file, JSON.stringify(this.index)); }
}
