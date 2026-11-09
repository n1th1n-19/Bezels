import { EventEmitter } from 'node:events';
import { readFileSync, renameSync, copyFileSync, unlinkSync, writeFileSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import type { Page } from 'playwright';
import type { AuditIssue, Device, DeviceState, Layout, SessionInfo, ShotMeta, Stats, ScreenshotOptions, TgEvent } from '../shared/types.js';
import { DEVICES, DEVICE_MAP, TEST_SETS, customDevice, engineFor, resolveDevices } from '../shared/devices.js';
import { computeLayout, defaultState, emptyTgRuntime } from '../shared/layout.js';
import { tgTheme, versionAtLeast } from '../shared/telegram.js';
import { DEFAULT_KEYMAP, keymapConflicts } from '../shared/keymap.js';
import { EnginePool } from './engine.js';
import { Host, contextKey, type Action, type FrameSub } from './host.js';
import { Compositor, ShotStore, extendLayout, framedHtml, sheetHtml } from './capture.js';
import { DEFAULT_RULES, auditPage, breakpoints, domTree, inspectEl, overlay, script, storageOp, tabOrder, type AuditOpts, type AuditRules, type OverlayItem } from './inpage.js';
import { sampleMemory } from './memory.js';
import { type Config, envValue, loadAuditRules, loadConfig, loadCustomDevices, loadKeymap, saveAuditRules, saveConfig, saveCustomDevices, saveKeymap } from './config.js';
import { copyImageToClipboard } from './clipboard.js';
import { SourceMapConsumer } from 'source-map-js';

const require = createRequire(import.meta.url);
const TMP = join(tmpdir(), 'bezels-tmp');

export interface Session { id: string; device: Device; host: Host; source: 'ui' | 'mcp' | 'cli'; issues: AuditIssue[] | null; created: number }
export type Source = 'ui' | 'mcp' | 'cli';
export interface Activity { time: number; method: string; summary: string; session?: string }

type Patch = Partial<Omit<DeviceState, 'telegram' | 'emulation'>> & { telegram?: Partial<DeviceState['telegram']>; emulation?: Partial<DeviceState['emulation']> };

/** Read PNG width/height from the IHDR chunk. */
export function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file).subarray(0, 24);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

let sid = 0;

export class Core extends EventEmitter {
  cfg: Config = loadConfig();
  pool = new EnginePool(this.cfg.engineIdleMs);
  sessions = new Map<string, Session>();
  hosts = new Set<Host>();
  focused?: string;
  compare?: string;
  sync = false;
  agentPaused = false;
  lastMcp = 0;
  activity: Activity[] = [];
  custom: Device[] = loadCustomDevices();
  shots = new ShotStore(this.cfg.shotsDir);
  compositor = new Compositor(() => this.pool.get('chromium'), (on) => (on ? this.pool.retain('chromium') : this.pool.release('chromium')));
  private watcher?: FSWatcher;
  private budgetTimer: NodeJS.Timeout;
  private botToken = envValue('BEZELS_TG_BOT_TOKEN');
  private axeSource?: string;
  private syncing = false;
  private lastStats?: Stats;

  constructor() {
    super();
    this.setMaxListeners(50);
    this.budgetTimer = setInterval(() => this.enforceBudget().catch(() => {}), 4000).unref();
  }

  // ---------------- device catalog ----------------
  allDevices(): Device[] { return [...DEVICES, ...this.custom]; }
  device(id: string): Device {
    const d = DEVICE_MAP.get(id) ?? this.custom.find((c) => c.id === id);
    if (d) return d;
    const m = /^custom-(\d+)x(\d+)(?:@([\d.]+))?$/.exec(id);
    if (m) return customDevice({ w: +m[1]!, h: +m[2]!, dpr: m[3] ? +m[3] : undefined });
    throw new Error(`Unknown device "${id}". Use list_devices.`);
  }

  // ---------------- hosts / sessions ----------------
  private env = {
    browser: (e: 'chromium' | 'webkit') => this.pool.get(e),
    retain: (e: 'chromium' | 'webkit') => this.pool.retain(e),
    release: (e: 'chromium' | 'webkit') => this.pool.release(e),
    emit: (ev: string, data: any) => this.onHostEvent(ev, data),
    botToken: this.botToken,
    fps: this.cfg.screencastFps,
    onScroll: (h: Host, pct: number) => this.onScroll(h, pct),
    onNavigate: (h: Host, url: string) => this.onNavigate(h, url),
  };

  private dedupeKey(d: Device, s: DeviceState, url: string): string {
    if (s.telegram.enabled) return `tg:${++sid}`; // Telegram runtime is per page; never share
    const L = computeLayout(d, s);
    return JSON.stringify({ c: contextKey(d, s, L.engine), v: [L.viewport.w, L.viewport.h, L.screen.w, L.screen.h], s: { ...s }, url });
  }
  private hostKeys = new WeakMap<Host, string>();

  private findHost(key: string) { for (const h of this.hosts) if (this.hostKeys.get(h) === key) return h; }

  private newHost(d: Device, s: DeviceState, url: string): Host {
    const L = computeLayout(d, s);
    const h = new Host(this.env, d, s, url, L.engine);
    h.layout = L;
    h.status = 'evicted'; // lazy: built on first use
    this.hosts.add(h);
    this.hostKeys.set(h, this.dedupeKey(d, s, url));
    return h;
  }

  private sessionsOf(h: Host) { return [...this.sessions.values()].filter((s) => s.host === h); }

  get(id: string): Session {
    const s = this.sessions.get(id) ?? [...this.sessions.values()].find((x) => x.device.id === id);
    if (!s) throw new Error(`No session "${id}". Use open() or list_sessions().`);
    return s;
  }

  info(s: Session): SessionInfo {
    const h = s.host;
    return {
      id: s.id, deviceId: s.device.id, deviceName: s.device.name, url: h.url, title: h.title, state: h.state, layout: h.layout ?? computeLayout(s.device, h.state, h.tg),
      status: h.status, engine: h.engine, sharedWith: this.sessionsOf(h).filter((x) => x !== s).map((x) => x.id),
      errors: { ...h.errors }, issues: s.issues ? s.issues.length : null, source: s.source, focused: this.focused === s.id,
      snapshot: h.snapshot ? `/snap/${s.id}.jpg?t=${h.lastUsed}` : undefined,
      error: h.lastError,
    };
  }

  list(): SessionInfo[] { return [...this.sessions.values()].map((s) => this.info(s)); }

  async open(url: string, devices: string | string[], source: Source, statePatch?: Patch): Promise<SessionInfo[]> {
    url = normalizeUrl(url);
    const devs = resolveDevices(devices, this.allDevices());
    if (!devs.length) throw new Error('No devices matched.');
    const out: Session[] = [];
    for (const d of devs) {
      const state = mergeState(defaultState(d), statePatch ?? {});
      if (!d.browsers.includes(state.browser)) state.browser = d.defaultBrowser;
      const key = this.dedupeKey(d, state, url);
      const host = this.findHost(key) ?? this.newHost(d, state, url);
      const s: Session = { id: `s${++sid}-${d.id}`, device: d, host, source, issues: null, created: Date.now() };
      this.sessions.set(s.id, s);
      out.push(s);
    }
    if (!this.focused || !this.sessions.has(this.focused)) await this.focus(out[0]!.id);
    else await out[0]!.host.active();
    this.broadcastSessions();
    return out.map((s) => this.info(s));
  }

  async close(id: string) {
    const s = this.get(id);
    this.sessions.delete(s.id);
    if (!this.sessionsOf(s.host).length) { await s.host.close(); this.hosts.delete(s.host); }
    if (this.focused === s.id) this.focused = [...this.sessions.keys()][0];
    if (this.compare === s.id) this.compare = undefined;
    this.broadcastSessions();
    return { closed: s.id };
  }

  async closeAll() { for (const id of [...this.sessions.keys()]) await this.close(id); return { closed: true }; }

  /** Focused (and compare) device is live and collects full DevTools data; the rest is frozen/snapshot. */
  async focus(id: string, compare?: string | null) {
    const s = this.get(id);
    this.focused = s.id;
    if (compare !== undefined) this.compare = compare ? this.get(compare).id : undefined;
    for (const h of this.hosts) h.setCollecting(h === s.host);
    await s.host.active();
    await this.enforceLiveLimit();
    this.broadcastSessions();
    return this.info(s);
  }

  private liveHosts(): Set<Host> {
    const keep = new Set<Host>();
    if (this.focused && this.sessions.has(this.focused)) keep.add(this.sessions.get(this.focused)!.host);
    if (this.compare && this.sessions.has(this.compare)) keep.add(this.sessions.get(this.compare)!.host);
    return keep;
  }

  private async enforceLiveLimit() {
    const keep = this.liveHosts();
    const live = [...this.hosts].filter((h) => h.status === 'live' || h.status === 'frozen').sort((a, b) => b.lastUsed - a.lastUsed);
    let liveCount = 0;
    for (const h of live) {
      if (keep.has(h) || h.hasSubscribers()) { liveCount++; continue; }
      if (liveCount < this.cfg.maxLive && h.status === 'live' && Date.now() - h.lastUsed < 15_000) { liveCount++; continue; }
      await h.freeze();
    }
  }

  /** Memory budget: evict least-recently-used background pages until under maxMemoryMB. Idle pages close after idleCloseMs. */
  async enforceBudget() {
    const keep = this.liveHosts();
    const now = Date.now();
    for (const h of this.hosts) if (!keep.has(h) && !h.hasSubscribers() && h.status !== 'evicted' && now - h.lastUsed > this.cfg.idleCloseMs) await h.evict();
    let st = this.stats();
    const victims = [...this.hosts].filter((h) => !keep.has(h) && !h.hasSubscribers() && !h.busy && h.status !== 'evicted').sort((a, b) => a.lastUsed - b.lastUsed);
    while (st.totalMB > this.cfg.maxMemoryMB && victims.length) { await victims.shift()!.evict(); st = this.stats(); }
    this.emit('event', 'stats', st);
  }

  stats(): Stats {
    const m = sampleMemory();
    const st: Stats = {
      totalMB: Math.round(m.totalMB), budgetMB: this.cfg.maxMemoryMB, nodeMB: Math.round(m.nodeMB),
      engines: (['chromium', 'webkit'] as const).map((e) => ({ engine: e, running: this.pool.running(e), mb: Math.round(e === 'chromium' ? m.chromiumMB : m.webkitMB), contexts: this.pool.count(e) })),
      sessions: [...this.sessions.values()].map((s) => ({ id: s.id, deviceName: s.device.name, status: s.host.status })),
      hosts: this.hosts.size, live: [...this.hosts].filter((h) => h.status === 'live').length,
    };
    this.lastStats = st;
    return st;
  }

  async setState(id: string, patch: Patch): Promise<SessionInfo> {
    const s = this.get(id);
    const old = s.host;
    const next = mergeState(old.state, patch);
    if (next.browser && !s.device.browsers.includes(next.browser)) throw new Error(`${s.device.name} has no ${next.browser}. Options: ${s.device.browsers.join(', ')}`);
    if (patch.fold && !s.device.fold && patch.fold !== 'unfolded') throw new Error(`${s.device.name} is not a foldable.`);
    const engine = engineFor(s.device, next.browser);
    const shared = this.sessionsOf(old).length > 1;
    if (shared || engine !== old.engine) {
      // Detach into its own page.
      const h = this.newHost(s.device, next, old.url);
      h.scrollY = old.scrollY;
      s.host = h;
      h.setCollecting(this.focused === s.id);
      if (!this.sessionsOf(old).length) { await old.close(); this.hosts.delete(old); }
      await h.active();
    } else {
      const tgWas = old.state.telegram;
      const prevKey = old.ctxKey;
      old.state = next;
      this.hostKeys.set(old, this.dedupeKey(s.device, next, old.url));
      if (next.telegram.enabled && !tgWas.enabled) old.tg = emptyTgRuntime();
      if (old.status === 'evicted') old.layout = computeLayout(s.device, next, old.tg);
      else if (contextKey(s.device, next, engine) !== prevKey) await old.build();
      else {
        await old.applyLive();
        if (next.telegram.enabled && (tgWas.theme !== next.telegram.theme || JSON.stringify(tgWas.themeParams) !== JSON.stringify(next.telegram.themeParams)))
          await old.tgSend({ type: 'theme', colorScheme: next.telegram.theme === 'dark' ? 'dark' : 'light', themeParams: tgTheme(next.telegram) });
        if (next.telegram.enabled && tgWas.mode !== next.telegram.mode) await old.tgSend({ type: 'fullscreen', value: next.telegram.mode === 'fullscreen' });
      }
      old.restartCast();
    }
    s.issues = null;
    this.broadcastSessions();
    return this.info(s);
  }

  /** Hosts a call will touch, so they can be marked busy for its duration. */
  hostsFor(p: any): Host[] {
    if (!p) return [];
    if (p.session === 'all') return [...this.hosts];
    const ids: string[] = [...(typeof p.session === 'string' ? [p.session] : []), ...(Array.isArray(p.sessions) ? p.sessions : [])];
    const out: Host[] = [];
    for (const id of ids) { try { out.push(this.get(id).host); } catch { /* unknown id: the call reports it */ } }
    return out;
  }

  /** Turn Playwright's low-level errors into ones that say what happened and what to do. */
  explain(e: unknown, method: string, session?: string): Error {
    const msg = (e as Error)?.message ?? String(e);
    const who = session && this.sessions.has(session) ? `${this.get(session).device.name} (${session})` : session ?? 'this session';
    if (/Execution context was destroyed|navigation|frame was detached/i.test(msg))
      return new Error(`${method} on ${who}: the page navigated or reloaded while it ran (a hot reload, a redirect, or a click that changed page). The session is still open; run it again, or wait for the page to settle first.\n(${msg.split('\n')[0]})`);
    if (/has been closed|Target closed|reading 'evaluate'|Browser has been closed|could not be reopened/i.test(msg))
      return new Error(`${method} on ${who}: the page was closed while it ran. It reopens automatically at its last URL on the next call; run it again. If this keeps happening, raise maxMemoryMB in Settings or open fewer devices at once.\n(${msg.split('\n')[0]})`);
    return e instanceof Error ? e : new Error(msg);
  }

  async navigate(target: string, url: string) {
    url = normalizeUrl(url);
    const hosts = target === 'all' ? [...this.hosts] : [this.get(target).host];
    for (const h of hosts) {
      if (h.status === 'evicted' && !this.liveHosts().has(h)) { h.url = url; h.snapshot = undefined; continue; }
      await h.goto(url);
    }
    for (const s of this.sessions.values()) if (hosts.includes(s.host)) s.issues = null;
    this.broadcastSessions();
    return { url, devices: hosts.length };
  }

  async reload(target: string, hard = false) {
    const hosts = target === 'all' ? [...this.hosts] : [this.get(target).host];
    for (const h of hosts) if (h.status !== 'evicted' || this.liveHosts().has(h)) await h.reload(hard);
    return { reloaded: hosts.length };
  }

  // ---------------- events from hosts ----------------
  private onHostEvent(ev: string, data: any) {
    const host: Host = data instanceof Host ? data : data.host;
    const ids = this.sessionsOf(host).map((s) => s.id);
    if (ev === 'host') { this.broadcastSessions(); return; }
    if (ev === 'tgRuntime') { for (const id of ids) this.emit('event', 'tgRuntime', { session: id, runtime: host.tg }); return; }
    const payload = { ...data, host: undefined };
    for (const id of ids) this.emit('event', ev, { session: id, ...payload });
  }

  private sessTimer?: NodeJS.Timeout;
  broadcastSessions() {
    clearTimeout(this.sessTimer);
    this.sessTimer = setTimeout(() => this.emit('event', 'sessions', { sessions: this.list(), focused: this.focused, compare: this.compare, sync: this.sync, agentPaused: this.agentPaused }), 30);
  }

  private onScroll(h: Host, pct: number) {
    if (!this.sync || this.syncing || !this.focused || !this.compare) return;
    const a = this.sessions.get(this.focused)?.host, b = this.sessions.get(this.compare)?.host;
    const other = h === a ? b : h === b ? a : undefined;
    if (!other?.page || other === h) return;
    this.syncing = true;
    other.page.evaluate((p) => { const se = document.scrollingElement!; scrollTo(0, (se.scrollHeight - innerHeight) * p); }, pct).catch(() => {}).finally(() => setTimeout(() => { this.syncing = false; }, 120));
  }

  private onNavigate(h: Host, url: string) {
    for (const s of this.sessions.values()) if (s.host === h) s.issues = null;
    if (!this.sync || !this.focused || !this.compare) return;
    const a = this.sessions.get(this.focused)?.host, b = this.sessions.get(this.compare)?.host;
    const other = h === a ? b : h === b ? a : undefined;
    if (other && other !== h && other.url !== url) other.goto(url, true).catch(() => {});
  }

  // ---------------- screenshots ----------------
  private frameInput(s: Session) { return { device: s.device, state: s.host.state, layout: s.host.layout, url: s.host.url, tg: s.host.tg, title: s.host.title || 'Mini App' }; }

  async screenshot(id: string, o: ScreenshotOptions & { source?: Source; label?: string } = {}): Promise<ShotMeta & { path: string; ms: number }> {
    const t0 = Date.now();
    const s = this.get(id);
    const page = await s.host.active();
    const o2 = o.fast ? { ...o, framed: false, scale: 'css' as const } : o;
    return { ...(await this.capturePage(page, this.frameInput(s), o2)), ms: Date.now() - t0 };
  }

  private async capturePage(page: Page, f: ReturnType<Core['frameInput']>, o: ScreenshotOptions & { source?: Source; label?: string }): Promise<ShotMeta & { path: string }> {
    const scale = o.scale === 'css' ? 1 : f.device.dpr;
    const transparent = o.background !== 'solid';
    const name = this.shots.name([f.device.id, f.state.orientation, ...(f.state.telegram.enabled ? ['telegram'] : []), ...(o.fullPage ? ['full'] : []), ...(o.framed ? [] : ['plain'])]);
    const out = this.shots.path(name);
    const raw = o.framed ? join(TMP, `raw-${process.pid}-${Date.now()}.png`) : out;
    await page.screenshot({ path: raw, fullPage: !!o.fullPage, scale: o.scale === 'css' ? 'css' : 'device', omitBackground: !o.framed && transparent, timeout: 30_000 });
    if (o.framed) {
      let L = f.layout;
      if (o.fullPage) { const sz = pngSize(raw); L = extendLayout(L, (sz.h / sz.w) * L.viewport.w); }
      const h = framedHtml({ ...f, layout: L }, 'shot.png', transparent ? null : '#0E0F12');
      await this.compositor.render({ html: h.html, files: { 'shot.png': raw }, width: h.w, height: h.h, scale, transparent, out });
      unlinkSync(raw);
    }
    return this.registerShot(out, { label: o.label ?? f.device.name, deviceId: f.device.id, framed: !!o.framed, fullPage: !!o.fullPage, kind: 'device', source: o.source ?? 'ui' }, !o.fast);
  }

  private async registerShot(file: string, m: Omit<ShotMeta, 'id' | 'file' | 'thumb' | 'time' | 'w' | 'h'>, withThumb = true): Promise<ShotMeta & { path: string }> {
    const sz = pngSize(file);
    const base = file.split('/').pop()!;
    const thumb = this.shots.thumbPath(base);
    if (withThumb) {
      const th = 120, tw = Math.max(20, Math.round((sz.w / sz.h) * th));
      await this.compositor.render({ html: `<!doctype html><body style="margin:0"><img src="http://bezels.local/i.png" style="width:${tw}px;height:${th}px;display:block">`, files: { 'i.png': file }, width: tw, height: th, scale: 1, transparent: false, out: thumb, type: 'jpeg', quality: 70 });
    }
    const meta: ShotMeta = { id: base.replace(/\.png$/, ''), file: base, thumb: withThumb ? thumb.split('/').pop()! : '', time: Date.now(), w: sz.w, h: sz.h, ...m };
    this.shots.add(meta);
    this.emit('event', 'shot', meta);
    return { ...meta, path: file };
  }

  /** Small preview for MCP replies: keeps Claude's context light. Full-res path is returned alongside. */
  async preview(file: string, maxDim = 768): Promise<Buffer> {
    const sz = pngSize(file);
    const k = Math.min(1, maxDim / Math.max(sz.w, sz.h));
    const w = Math.max(1, Math.round(sz.w * k)), h = Math.max(1, Math.round(sz.h * k));
    const out = join(TMP, `prev-${process.pid}-${Date.now()}.png`);
    await this.compositor.render({ html: `<!doctype html><body style="margin:0;background:transparent"><img src="http://bezels.local/i.png" style="width:${w}px;height:${h}px;display:block">`, files: { 'i.png': file }, width: w, height: h, scale: 1, transparent: true, out });
    const buf = readFileSync(out);
    unlinkSync(out);
    return buf;
  }

  /**
   * Run fn on many devices sequentially, reusing one context per config group (same engine/DPR/UA/touch)
   * and resizing between devices, instead of opening everything at once.
   */
  async batch<T>(url: string, devices: Device[], statePatch: Patch | undefined, fn: (page: Page, d: Device, s: DeviceState, L: Layout) => Promise<T>): Promise<{ device: Device; result?: T; error?: string }[]> {
    url = normalizeUrl(url);
    const groups = new Map<string, { d: Device; s: DeviceState }[]>();
    for (const d of devices) {
      const s = mergeState(defaultState(d), statePatch ?? {});
      if (!d.browsers.includes(s.browser)) s.browser = d.defaultBrowser;
      const k = contextKey(d, s, engineFor(d, s.browser));
      (groups.get(k) ?? groups.set(k, []).get(k)!).push({ d, s });
    }
    const results: { device: Device; result?: T; error?: string }[] = [];
    for (const items of groups.values()) {
      const first = items[0]!;
      const host = new Host(this.env, first.d, first.s, url, engineFor(first.d, first.s.browser));
      try {
        await host.build();
        let loaded = true;
        for (const [i, { d, s }] of items.entries()) {
          try {
            if (i > 0) { host.device = d; host.state = s; await host.applyLive(); if (loaded) await settle(host.page!); }
            results.push({ device: d, result: await fn(host.page!, d, s, host.layout) });
          } catch (e) { results.push({ device: d, error: (e as Error).message }); loaded = false; await host.goto(url).then(() => { loaded = true; }); }
        }
      } catch (e) {
        for (const { d } of items) results.push({ device: d, error: (e as Error).message });
      } finally { await host.close(); }
    }
    return devices.map((d) => results.find((r) => r.device === d)!);
  }

  async screenshotMatrix(url: string, devices: string | string[], o: ScreenshotOptions & { source?: Source } = {}) {
    const devs = resolveDevices(devices, this.allDevices());
    const framed = o.framed ?? true;
    const cells: { file: string; w: number; h: number; label: string; sub: string }[] = [];
    const res = await this.batch(url, devs, undefined, async (page, d, s, L) => {
      const raw = join(TMP, `m-${process.pid}-${d.id}-${Date.now()}.png`);
      await page.screenshot({ path: raw, fullPage: !!o.fullPage, scale: 'css', timeout: 30_000 });
      let file = raw;
      if (framed) {
        const out = join(TMP, `mf-${process.pid}-${d.id}-${Date.now()}.png`);
        let LL = L; if (o.fullPage) { const sz = pngSize(raw); LL = extendLayout(L, (sz.h / sz.w) * L.viewport.w); }
        const h = framedHtml({ device: d, state: s, layout: LL, url, title: (await page.title().catch(() => '')) || 'Mini App' }, 'shot.png', null);
        await this.compositor.render({ html: h.html, files: { 'shot.png': raw }, width: h.w, height: h.h, scale: 1, transparent: true, out });
        unlinkSync(raw); file = out;
      }
      const sz = pngSize(file);
      cells.push({ file, ...sz, label: d.name, sub: `${L.viewport.w}×${L.viewport.h} @${d.dpr}x` });
      return file;
    });
    const sheetName = this.shots.name(['contact-sheet', `${devs.length}-devices`]);
    const out = this.shots.path(sheetName);
    const sh = sheetHtml(cells, o.background === 'transparent' ? null : '#0E0F12');
    await this.compositor.render({ html: sh.html, files: sh.files, width: sh.w, height: sh.h, scale: 1, transparent: o.background === 'transparent', out });
    for (const c of cells) try { unlinkSync(c.file); } catch { /* */ }
    const meta = await this.registerShot(out, { label: `${devs.length} devices`, framed, fullPage: !!o.fullPage, kind: 'sheet', source: o.source ?? 'ui' });
    return { ...meta, devices: res.map((r) => ({ device: r.device.id, error: r.error })) };
  }

  /** Contact sheet of the current sessions with their current state (Shift+S). Sequential. */
  async captureAll(ids: string[] | undefined, o: ScreenshotOptions & { source?: Source } = {}) {
    const list = (ids?.length ? ids.map((i) => this.get(i)) : [...this.sessions.values()]);
    const cells: { file: string; w: number; h: number; label: string; sub: string }[] = [];
    const seen = new Set<Host>();
    for (const s of list) {
      if (seen.has(s.host) && !o.framed) continue;
      seen.add(s.host);
      const page = await s.host.active();
      const raw = join(TMP, `c-${process.pid}-${s.id}.png`);
      await page.screenshot({ path: raw, scale: 'css', timeout: 30_000 });
      const out = join(TMP, `cf-${process.pid}-${s.id}.png`);
      const h = framedHtml(this.frameInput(s), 'shot.png', null);
      await this.compositor.render({ html: h.html, files: { 'shot.png': raw }, width: h.w, height: h.h, scale: 1, transparent: true, out });
      unlinkSync(raw);
      cells.push({ file: out, ...pngSize(out), label: s.device.name, sub: `${s.host.layout.viewport.w}×${s.host.layout.viewport.h}` });
      if (!this.liveHosts().has(s.host)) await s.host.freeze();
    }
    const out = this.shots.path(this.shots.name(['contact-sheet', `${cells.length}-devices`]));
    const sh = sheetHtml(cells, o.background === 'transparent' ? null : '#0E0F12');
    await this.compositor.render({ html: sh.html, files: sh.files, width: sh.w, height: sh.h, scale: 1, transparent: o.background === 'transparent', out });
    for (const c of cells) try { unlinkSync(c.file); } catch { /* */ }
    return this.registerShot(out, { label: `All ${cells.length} devices`, framed: true, fullPage: false, kind: 'sheet', source: o.source ?? 'ui' });
  }

  // ---------------- audits ----------------
  /** Effective audit rules for a URL: defaults ← saved rules for its origin ← per-call override. */
  rulesFor(url: string, override?: Partial<AuditRules>): AuditRules {
    const saved = loadAuditRules()[originOf(url)] ?? {};
    return { ...DEFAULT_RULES, ...saved, ...(override ?? {}) } as AuditRules;
  }
  auditRules(target: string) {
    const origin = this.sessions.has(target) ? originOf(this.get(target).host.url) : originOf(normalizeUrl(target));
    return { origin, rules: this.rulesFor(origin), defaults: DEFAULT_RULES, saved: loadAuditRules()[origin] ?? null };
  }
  setAuditRules(target: string, rules: Partial<AuditRules> | null) {
    const origin = this.sessions.has(target) ? originOf(this.get(target).host.url) : originOf(normalizeUrl(target));
    const all = loadAuditRules();
    if (rules === null) delete all[origin];
    else {
      const clean: Record<string, unknown> = {};
      for (const k of Object.keys(DEFAULT_RULES) as (keyof AuditRules)[]) if (k in rules) clean[k] = rules[k];
      all[origin] = { ...(all[origin] ?? {}), ...clean };
    }
    saveAuditRules(all);
    for (const s of this.sessions.values()) if (originOf(s.host.url) === origin) s.issues = null;
    return this.auditRules(origin);
  }

  private auditOpts(d: Device, s: DeviceState, L: Layout, tgSwipes: boolean, rules: AuditRules): AuditOpts {
    return {
      rules,
      touch: s.emulation.touch ?? d.touch, mobile: d.mobile, dpr: d.dpr, obstructions: obstructions(d, s, L),
      largeVh: L.largeViewportH, vh: L.viewport.h, barsLabel: s.browser === 'safari' ? 'Safari’s bars' : `${s.browser === 'samsung' ? 'Samsung Internet' : 'Chrome'}’s bars`,
      telegram: s.telegram.enabled ? { verticalSwipes: tgSwipes } : null,
    };
  }

  async audit(id: string, override?: Partial<AuditRules>): Promise<AuditIssue[]> {
    const s = this.get(id);
    const page = await s.host.active();
    const h = s.host;
    const issues = (await page.evaluate(script(auditPage, this.auditOpts(s.device, h.state, h.layout, h.tg.verticalSwipes, this.rulesFor(h.url, override))))) as AuditIssue[];
    if (h.state.telegram.enabled) issues.push(...tgIssues(h.tgEvents, h.state.telegram.version));
    if (h.errors.console) issues.push({ severity: 'info', type: 'console', title: 'Console errors', message: `${h.errors.console} console error(s) on this device. See console_logs.` });
    if (h.errors.network) issues.push({ severity: 'info', type: 'network', title: 'Failed requests', message: `${h.errors.network} failed request(s). See network_errors.` });
    for (const x of this.sessionsOf(h)) x.issues = issues;
    this.emit('event', 'audit', { session: s.id, issues });
    this.broadcastSessions();
    return issues;
  }

  async auditAll(url: string | undefined, devices: string | string[] | undefined, ids?: string[], override?: Partial<AuditRules>) {
    if (!url) {
      // Background audit of the open set (UI chips): sequential, using each session's real state.
      const list = ids?.length ? ids.map((i) => this.get(i)) : [...this.sessions.values()];
      const out: { session: string; device: string; issues: AuditIssue[]; error?: string }[] = [];
      for (const s of list) {
        try { s.host.busy++; out.push({ session: s.id, device: s.device.name, issues: await this.audit(s.id, override) }); }
        catch (e) { out.push({ session: s.id, device: s.device.name, issues: [], error: this.explain(e, 'audit_all', s.id).message }); }
        finally { s.host.busy--; }
        if (!this.liveHosts().has(s.host)) await s.host.freeze();
      }
      return out;
    }
    const devs = resolveDevices(devices ?? 'phones', this.allDevices());
    const rules = this.rulesFor(normalizeUrl(url), override);
    const res = await this.batch(url, devs, undefined, async (page, d, s, L) => (await page.evaluate(script(auditPage, this.auditOpts(d, s, L, true, rules)))) as AuditIssue[]);
    return res.map((r) => ({ device: r.device.id, name: r.device.name, issues: r.result ?? [], error: r.error }));
  }

  // ---------------- DevTools ----------------
  consoleLogs(id: string, o: { level?: string; limit?: number; text?: string } = {}) {
    const h = this.get(id).host;
    let l = h.console;
    if (o.level) l = l.filter((e) => e.level === o.level || (o.level === 'warn' && e.level === 'warning'));
    if (o.text) l = l.filter((e) => e.text.toLowerCase().includes(o.text!.toLowerCase()));
    return { collecting: h.collecting ? 'all' : 'errors+warnings only (not focused)', errors: h.errors.console, entries: l.slice(-(o.limit ?? 200)) };
  }

  networkLog(id: string, f: { type?: string; text?: string; failedOnly?: boolean; limit?: number } = {}) {
    const h = this.get(id).host;
    let l = h.net;
    if (f.failedOnly) l = l.filter((e) => e.failed || e.status >= 400);
    if (f.type) { const t = f.type.toLowerCase(); l = l.filter((e) => (t === 'fetch' || t === 'xhr' ? ['fetch', 'xhr'].includes(e.type) : t === 'js' ? e.type === 'script' : t === 'css' ? e.type === 'stylesheet' : t === 'img' ? e.type === 'image' : t === 'doc' ? e.type === 'document' : t === 'ws' ? e.type === 'websocket' : e.type === t)); }
    if (f.text) l = l.filter((e) => e.url.includes(f.text!));
    return { collecting: h.collecting ? 'all' : 'failures only (not focused)', entries: l.slice(-(f.limit ?? 500)) };
  }

  /** Headers/payload/response/timing — fetched on demand, bodies are never kept. */
  async requestDetail(id: string, reqId: number) {
    const h = this.get(id).host;
    const r = h.reqs.get(reqId);
    const e = h.net.find((x) => x.id === reqId);
    if (!r || !e) throw new Error('Request no longer in buffer.');
    const resp = await r.response().catch(() => null);
    let body: string | undefined;
    if (resp) {
      const ct = (await resp.allHeaders().catch(() => ({} as Record<string, string>)))['content-type'] ?? '';
      const buf = await resp.body().catch(() => null);
      if (buf) body = /json|text|javascript|xml|html|css|svg/.test(ct) ? buf.toString('utf8').slice(0, 100_000) : `[${ct || 'binary'} · ${buf.length} bytes]`;
    }
    return { ...e, requestHeaders: await r.allHeaders().catch(() => ({})), payload: r.postData()?.slice(0, 50_000), responseHeaders: resp ? await resp.allHeaders().catch(() => ({})) : null, response: body, timing: r.timing() };
  }

  async har(id: string) {
    const h = this.get(id).host;
    const entries = await Promise.all(h.net.map(async (e) => {
      const r = h.reqs.get(e.id);
      const rq = r ? await r.allHeaders().catch(() => ({})) : {};
      const rs = r ? await r.response().then((x) => x?.allHeaders() ?? {}, () => ({})) : {};
      const hdr = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }));
      return { startedDateTime: new Date(e.start).toISOString(), time: e.duration, request: { method: e.method, url: e.url, httpVersion: 'HTTP/1.1', headers: hdr(rq), queryString: [], cookies: [], headersSize: -1, bodySize: -1 }, response: { status: e.status, statusText: e.failed ?? '', httpVersion: 'HTTP/1.1', headers: hdr(rs), cookies: [], content: { size: e.size, mimeType: (rs as Record<string, string>)['content-type'] ?? '' }, redirectURL: '', headersSize: -1, bodySize: e.size }, cache: {}, timings: { send: 0, wait: e.duration, receive: 0 } };
    }));
    const file = this.shots.path(this.shots.name([this.get(id).device.id, 'network']).replace(/\.png$/, '.har'));
    writeFileSync(file, JSON.stringify({ log: { version: '1.2', creator: { name: 'bezels', version: '0.1.0' }, pages: [], entries } }, null, 1));
    return { path: file, file: file.split('/').pop(), entries: entries.length };
  }

  /** Map a console entry's file:line through the script's source map. */
  async resolveSource(id: string, entryId: number) {
    const h = this.get(id).host;
    const e = h.console.find((x) => x.id === entryId);
    if (!e?.url || !e.line) return null;
    const page = await h.active();
    const src = await page.request.get(e.url).then((r) => r.text(), () => '');
    const m = /\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/m.exec(src);
    if (!m) return null;
    const mapUrl = m[1]!.startsWith('data:') ? m[1]! : new URL(m[1]!, e.url).href;
    const json = mapUrl.startsWith('data:') ? Buffer.from(mapUrl.split(',')[1]!, 'base64').toString('utf8') : await page.request.get(mapUrl).then((r) => r.text(), () => '');
    if (!json) return null;
    const c = new SourceMapConsumer(JSON.parse(json));
    const p = c.originalPositionFor({ line: e.line, column: Math.max(0, (e.col ?? 1) - 1) });
    if (!p.source) return null;
    e.mapped = `${p.source.replace(/^webpack:\/\/[^/]*\//, '').replace(/^\.\//, '')}:${p.line}:${(p.column ?? 0) + 1}`;
    return { mapped: e.mapped };
  }

  async evaluate(id: string, js: string) {
    const page = await this.get(id).host.active();
    let v: unknown;
    try { v = await page.evaluate(js); }
    catch (e) {
      if (!/SyntaxError|Illegal return|await is only valid/.test((e as Error).message)) throw e;
      v = await page.evaluate(`(async () => { ${js} })()`);
    }
    const s = JSON.stringify(v, null, 1) ?? String(v);
    return s.length > 20_000 ? s.slice(0, 20_000) + '…(truncated)' : s;
  }

  async perf(id: string) {
    const h = this.get(id).host;
    const page = await h.active();
    const vitals = await page.evaluate(() => (window as any).__bezelsVitals ?? null);
    let metrics: Record<string, number> | undefined;
    if (h.cdp) {
      await h.cdp.send('Performance.enable').catch(() => {});
      const r = await h.cdp.send('Performance.getMetrics').catch(() => null);
      if (r) metrics = Object.fromEntries(r.metrics.filter((m) => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'LayoutCount', 'RecalcStyleCount', 'ScriptDuration', 'TaskDuration', 'Documents', 'JSEventListeners'].includes(m.name)).map((m) => [m.name, m.name.startsWith('JSHeap') ? Math.round(m.value / 1048576 * 10) / 10 : Math.round(m.value * 1000) / 1000]));
    }
    return { vitals, metrics, cpu: h.state.cpu, network: h.state.network, engine: h.engine, note: h.engine === 'webkit' ? 'WebKit: INP/long tasks may be unavailable; CPU throttle is Chromium-only.' : undefined };
  }

  async showShifts(id: string) {
    const page = await this.get(id).host.active();
    const shifts = await page.evaluate(() => (window as any).__bezelsVitals?.shifts ?? []);
    await page.evaluate(script(overlay, { items: shifts.map((r: any) => ({ rect: r, label: `CLS ${r.value.toFixed(3)}`, color: '#FF7A7A', page: true })), ms: 6000, scroll: false }));
    return { shifts: shifts.length };
  }

  async storage(id: string, a: { op: 'list' | 'set' | 'remove' | 'clear' | 'fresh'; area?: string; key?: string; value?: string; db?: string }) {
    const h = this.get(id).host;
    const page = await h.active();
    if (a.area === 'cookies') {
      if (a.op === 'list') return { cookies: await h.ctx!.cookies() };
      if (a.op === 'clear') { await h.ctx!.clearCookies(); return true; }
      if (a.op === 'remove') { await h.ctx!.clearCookies({ name: a.key }); return true; }
      if (a.op === 'set') { await h.ctx!.addCookies([{ name: a.key!, value: a.value ?? '', url: h.url }]); return true; }
    }
    if (a.op === 'fresh') {
      await page.evaluate(script(storageOp, { op: 'clear' }));
      await h.ctx!.clearCookies();
      if (h.cdp) await h.cdp.send('Storage.clearDataForOrigin', { origin: new URL(h.url).origin, storageTypes: 'all' }).catch(() => {});
      h.tgStores.CloudStorage.clear(); h.tgStores.DeviceStorage.clear(); h.tgStores.SecureStorage.clear();
      await h.reload(true);
      return { fresh: true };
    }
    const r = await page.evaluate(script(storageOp, a));
    if (a.op === 'list') return { ...(r as object), cookies: await h.ctx!.cookies(), telegram: h.state.telegram.enabled ? Object.fromEntries(Object.entries(h.tgStores).map(([k, m]) => [k, Object.fromEntries(m)])) : undefined };
    return r;
  }

  async a11y(id: string) {
    const page = await this.get(id).host.active();
    this.axeSource ??= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    const has = await page.evaluate(() => !!(window as any).axe);
    if (!has) await page.evaluate(this.axeSource);
    const res: any = await page.evaluate(() => (window as any).axe.run(document, { resultTypes: ['violations'] }));
    return {
      violations: res.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.slice(0, 8).map((n: any) => ({ target: n.target.join(' '), html: n.html.slice(0, 200), summary: n.failureSummary?.slice(0, 300) })), count: v.nodes.length })),
      passes: res.passes?.length, incomplete: res.incomplete?.length,
    };
  }

  async tabOrder(id: string, show: boolean) {
    const page = await this.get(id).host.active();
    if (!show) { await page.evaluate(script(overlay, { items: [], ms: 0, scroll: false, id: '__bezels_taborder' })); return { shown: 0 }; }
    const items = (await page.evaluate(script(tabOrder, null))) as OverlayItem[];
    await page.evaluate(script(overlay, { items, ms: 0, scroll: false, id: '__bezels_taborder' }));
    return { shown: items.length };
  }

  async inspect(id: string, a: { selector?: string; x?: number; y?: number; highlight?: boolean }) {
    const h = this.get(id).host;
    const page = await h.active();
    const info: any = await page.evaluate(script(inspectEl, { selector: a.selector, x: a.x, y: a.y }));
    if (!info) throw new Error(a.selector ? `No element matches ${a.selector}` : 'No element there.');
    if (h.cdp && a.highlight !== false) {
      // Real accessible name from Chromium's accessibility tree.
      try {
        const doc = await h.cdp.send('DOM.getDocument', { depth: 0 });
        const q = await h.cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: info.selector });
        if (q.nodeId) {
          const ax = await h.cdp.send('Accessibility.getPartialAXTree', { nodeId: q.nodeId, fetchRelatives: false });
          const n = ax.nodes[0];
          if (n) info.a11y = { role: n.role?.value ?? info.a11y.role, name: n.name?.value ?? info.a11y.name, source: 'chromium-ax' };
        }
      } catch { /* keep heuristic name */ }
    }
    if (a.highlight !== false) await page.evaluate(script(overlay, { items: [{ selector: info.selector, label: `${info.tag} ${info.rect.w}×${info.rect.h}` }], ms: 5000, scroll: !!a.selector }));
    return info;
  }

  async domTree(id: string, a: { selector?: string; depth?: number }) {
    const page = await this.get(id).host.active();
    return page.evaluate(script(domTree, { selector: a.selector, depth: Math.min(8, a.depth ?? 3) }));
  }

  async highlight(id: string, items: OverlayItem[], ms = 4000) {
    const page = await this.get(id).host.active();
    return { shown: await page.evaluate(script(overlay, { items, ms, scroll: true })) };
  }

  async breakpoints(id: string) {
    const page = await this.get(id).host.active();
    return page.evaluate(script(breakpoints, null));
  }

  // ---------------- sensors / emulation ----------------
  async setLocation(id: string, loc: { lat: number; lng: number; accuracy?: number } | { city: string } | 'unavailable', auto = false) {
    let patch: Patch['emulation'];
    if (loc === 'unavailable') patch = { geolocation: 'unavailable' };
    else if ('city' in loc) {
      const c = CITIES.find((x) => x.name.toLowerCase().startsWith(loc.city.toLowerCase()));
      if (!c) throw new Error(`Unknown city. Options: ${CITIES.map((x) => x.name).join(', ')}`);
      patch = { geolocation: { lat: c.lat, lng: c.lng, accuracy: 20 }, ...(auto ? { timezone: c.tz, locale: c.locale } : {}) };
    } else patch = { geolocation: { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy ?? 20 } };
    return this.setState(id, { emulation: patch });
  }

  async setEmulation(id: string, o: Record<string, any>) {
    const p: Patch = { emulation: {} };
    const e = p.emulation!;
    for (const k of ['timezone', 'locale', 'permissions', 'vision', 'forcedColors', 'print', 'touch', 'idle', 'battery', 'sensors', 'userAgent', 'cacheDisabled', 'blocked', 'customNetwork'] as const) if (k in o) (e as any)[k] = o[k];
    for (const k of ['orientation', 'cpu', 'network', 'colorScheme', 'reducedMotion', 'bars', 'fold', 'browser'] as const) if (k in o) (p as any)[k] = o[k];
    return this.setState(id, p);
  }

  async shake(id: string) {
    const page = await this.get(id).host.active();
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) {
        const x = i % 2 ? 18 : -18;
        dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x, y: 2, z: 0 }, accelerationIncludingGravity: { x, y: 2, z: 9.8 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16 }));
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    return { shaken: true };
  }

  // ---------------- Telegram ----------------
  tgEvents(id: string) { const h = this.get(id).host; return { enabled: h.state.telegram.enabled, version: h.state.telegram.version, events: h.tgEvents, runtime: h.tg, initDataSigned: !!this.botToken }; }

  async tgTrigger(id: string, what: string, arg?: string) {
    const s = this.get(id);
    const h = s.host;
    if (!h.state.telegram.enabled) throw new Error('Telegram mode is off for this device. set_state({telegram:{enabled:true}}) first.');
    await h.active();
    switch (what) {
      case 'mainButton': if (!h.tg.mainButton.visible) throw new Error('MainButton is hidden.'); await h.tgSend({ type: 'event', name: 'mainButtonClicked' }); break;
      case 'secondaryButton': await h.tgSend({ type: 'event', name: 'secondaryButtonClicked' }); break;
      case 'backButton': await h.tgSend({ type: 'event', name: 'backButtonClicked' }); break;
      case 'settingsButton': await h.tgSend({ type: 'event', name: 'settingsButtonClicked' }); break;
      case 'themeChanged': { const t = h.state.telegram.theme === 'dark' ? 'light' : 'dark'; await this.setState(s.id, { telegram: { theme: t }, colorScheme: t }); break; }
      case 'dragSheet': {
        // Height changes while dragging (isStateStable=false), then settles (true).
        for (const off of [24, 60, 110, 60, 20, 0]) { h.tg.dragOffset = off; await h.relayout(off === 0); this.emit('event', 'tgRuntime', { session: s.id, runtime: h.tg }); await new Promise((r) => setTimeout(r, 70)); }
        break;
      }
      case 'popup': {
        const id_ = h.tgPopupId; const btn = arg ?? h.tg.popup?.buttons[0]?.id ?? 'ok';
        if (!h.tg.popup) throw new Error('No popup open.');
        if (h.tg.popup.kind === 'qr') await h.tgSend({ type: 'qrText', id: id_, text: btn });
        h.tg.popup = null; await h.tgSend({ type: 'popupClosed', id: id_, buttonId: btn });
        break;
      }
      case 'qr': await h.tgSend({ type: 'qrText', id: h.tgPopupId, text: arg ?? 'https://t.me/bezels' }); h.tg.popup = null; break;
      case 'activate': case 'deactivate': await h.tgSend({ type: 'active', value: what === 'activate' }); break;
      case 'close': if (h.tg.closingConfirmation && arg !== 'force') { h.tg.popup = { kind: 'confirm', message: 'Changes that you made may not be saved.', title: 'Close Mini App?', buttons: [{ id: 'close', type: 'destructive', text: 'Close anyway' }, { id: 'cancel', type: 'cancel' }] }; } else h.tg.closed = true; break;
      case 'reopen': h.tg.closed = false; await h.reload(); break;
      default: throw new Error('Unknown trigger. Use mainButton | secondaryButton | backButton | settingsButton | themeChanged | dragSheet | popup | qr | activate | deactivate | close | reopen');
    }
    this.emit('event', 'tgRuntime', { session: s.id, runtime: h.tg });
    return { triggered: what };
  }

  // ---------------- live view ----------------
  subscribe(id: string, sub: FrameSub) { const s = this.get(id); return s.host.subscribe(sub); }
  async input(id: string, a: Action) { return this.get(id).host.interact(a); }

  // ---------------- misc ----------------
  setSync(on: boolean) { this.sync = on; this.broadcastSessions(); return { sync: on }; }
  pause(on: boolean) { this.agentPaused = on; this.broadcastSessions(); return { paused: on }; }
  logActivity(method: string, params: any) {
    this.lastMcp = Date.now();
    const summary = summarize(method, params);
    const a = { time: Date.now(), method, summary, session: params?.session };
    this.activity.push(a);
    if (this.activity.length > 200) this.activity.shift();
    this.emit('event', 'activity', a);
  }

  watch(dir: string | null) {
    this.watcher?.close();
    this.watcher = undefined;
    if (!dir) return { watching: null };
    let t: NodeJS.Timeout | undefined;
    this.watcher = watch(dir, { recursive: true }, (_e, f) => {
      if (f && /(^|\/)(node_modules|\.git|\.next|dist)\//.test(String(f))) return;
      clearTimeout(t);
      t = setTimeout(() => { this.reload('all').catch(() => {}); this.emit('event', 'toast', { text: `Reloaded: ${f} changed` }); }, 300);
    });
    return { watching: dir };
  }

  catalog() {
    return { devices: this.allDevices(), sets: Object.fromEntries(Object.entries(TEST_SETS).map(([k, v]) => [k, { label: v.label, ids: this.allDevices().filter(v.match).map((d) => d.id) }])), customSets: this.cfg.sets, favourites: this.cfg.favourites, cities: CITIES, botToken: !!this.botToken };
  }
  saveCustom(d: { id?: string; name?: string; w: number; h: number; dpr?: number; ua?: string; mobile?: boolean; touch?: boolean }) {
    const dev = customDevice({ ...d, id: d.id ?? `custom-${d.w}x${d.h}${d.dpr ? '@' + d.dpr : ''}` });
    this.custom = [...this.custom.filter((c) => c.id !== dev.id), dev];
    saveCustomDevices(this.custom);
    this.emit('event', 'catalog', this.catalog());
    return dev;
  }
  deleteCustom(id: string) { this.custom = this.custom.filter((c) => c.id !== id); saveCustomDevices(this.custom); this.emit('event', 'catalog', this.catalog()); return { deleted: id }; }
  setConfig(c: Partial<Config>) { Object.assign(this.cfg, c); saveConfig(c); this.emit('event', 'catalog', this.catalog()); return this.cfg; }
  keymap() { const user = loadKeymap(); const map = { ...DEFAULT_KEYMAP, ...user }; return { map, defaults: DEFAULT_KEYMAP, conflicts: keymapConflicts(map) }; }
  setKeymap(m: Record<string, string>) { const diff = Object.fromEntries(Object.entries(m).filter(([k, v]) => DEFAULT_KEYMAP[k] !== v)); saveKeymap(diff); return this.keymap(); }

  async copyShot(id: string) { const s = this.shots.get(id); if (!s) throw new Error('No such screenshot'); await copyImageToClipboard(this.shots.path(s.file)); return { copied: s.file }; }
  deleteShot(id: string) {
    const s = this.shots.get(id);
    if (s) { for (const f of [this.shots.path(s.file), this.shots.thumbPath(s.file)]) try { unlinkSync(f); } catch { /* */ } this.shots.remove(id); }
    this.emit('event', 'shots', this.shots.list());
    return { deleted: id };
  }
  /** Move a capture out of the shots dir into a chosen file (CLI --out). */
  exportShot(path: string, to: string) { try { renameSync(path, to); } catch { copyFileSync(path, to); } return to; }

  async shutdown() {
    clearInterval(this.budgetTimer);
    this.watcher?.close();
    for (const h of this.hosts) await h.close().catch(() => {});
    await this.compositor.close();
    await this.pool.closeAll();
  }
}

// ---------------- helpers ----------------

export function mergeState(s: DeviceState, p: Patch): DeviceState {
  return { ...s, ...p, telegram: { ...s.telegram, ...(p.telegram ?? {}) }, emulation: { ...s.emulation, ...(p.emulation ?? {}) } } as DeviceState;
}

export function originOf(u: string) { try { return new URL(u).origin; } catch { return u; } }

export function normalizeUrl(u: string) {
  u = u.trim();
  if (/^\d+$/.test(u)) return `http://localhost:${u}/`;
  if (/^localhost(:\d+)?/.test(u) || /^127\./.test(u)) return 'http://' + u;
  if (!/^[a-z]+:/i.test(u)) return 'https://' + u;
  return u;
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250))))).catch(() => {});
}

/** Areas of the page covered by hardware or Telegram UI, in viewport coordinates. */
export function obstructions(d: Device, s: DeviceState, L: Layout) {
  const vp = L.viewport;
  const out: { rect: { x: number; y: number; w: number; h: number }; label: string }[] = [];
  const clip = (r: { x: number; y: number; w: number; h: number }, label: string) => {
    const x1 = Math.max(r.x, vp.x), y1 = Math.max(r.y, vp.y), x2 = Math.min(r.x + r.w, vp.x + vp.w), y2 = Math.min(r.y + r.h, vp.y + vp.h);
    if (x2 - x1 > 1 && y2 - y1 > 1) out.push({ rect: { x: Math.round(x1 - vp.x), y: Math.round(y1 - vp.y), w: Math.round(x2 - x1), h: Math.round(y2 - y1) }, label });
  };
  if (L.cutoutRect) clip(L.cutoutRect, d.cutout === 'island' ? 'Dynamic Island' : d.cutout === 'notch' ? 'notch' : 'camera cutout');
  if (L.statusBar) clip(L.statusBar, 'status bar');
  const sa = L.deviceSafeArea;
  if (sa.bottom && d.os === 'ios') clip({ x: 0, y: L.screen.h - sa.bottom, w: L.screen.w, h: sa.bottom }, 'home indicator');
  if (sa.left) clip({ x: 0, y: 0, w: sa.left, h: L.screen.h }, 'left safe area');
  if (sa.right) clip({ x: L.screen.w - sa.right, y: 0, w: sa.right, h: L.screen.h }, 'right safe area');
  if (L.tg?.isFullscreen) clip({ x: 0, y: sa.top, w: L.screen.w, h: L.tg.contentSafeAreaInset.top }, 'Telegram header controls');
  void s;
  return out;
}

function tgIssues(events: TgEvent[], version: string): AuditIssue[] {
  const bad = new Map<string, string>();
  for (const e of events) if (e.unsupported && e.minVersion && !versionAtLeast(version, e.minVersion)) bad.set(e.method, e.minVersion);
  const out: AuditIssue[] = [...bad].map(([m, v]) => ({ severity: 'error' as const, type: 'tg-version', title: 'Method not supported by this Mini Apps version', message: `${m} needs Bot API ${v}+, selected version is ${version}. Guard with Telegram.WebApp.isVersionAtLeast('${v}').` }));
  if (!events.some((e) => e.method === 'ready')) out.push({ severity: 'warn', type: 'tg-ready', title: 'ready() never called', message: 'Telegram shows a loading placeholder until the app calls Telegram.WebApp.ready().' });
  return out;
}

function summarize(method: string, p: any): string {
  if (!p) return method;
  const s = p.session ? ` ${String(p.session).replace(/^s\d+-/, '')}` : '';
  if (method === 'open') return `open ${p.url} on ${Array.isArray(p.devices) ? p.devices.join(', ') : p.devices}`;
  if (method === 'interact') return `interact${s}: ${p.action?.type} ${p.action?.selector ?? ''}`;
  if (method === 'set_state') return `set_state${s} ${JSON.stringify(p.state ?? p).slice(0, 80)}`;
  if (method === 'screenshot_matrix' || method === 'audit_all') return `${method} ${p.url ?? ''} ${p.devices ?? ''}`;
  return `${method}${s}`;
}

export const CITIES = [
  { name: 'Bengaluru, India', lat: 12.9716, lng: 77.5946, tz: 'Asia/Kolkata', locale: 'en-IN' },
  { name: 'Mumbai, India', lat: 19.076, lng: 72.8777, tz: 'Asia/Kolkata', locale: 'hi-IN' },
  { name: 'Delhi, India', lat: 28.6139, lng: 77.209, tz: 'Asia/Kolkata', locale: 'hi-IN' },
  { name: 'Chennai, India', lat: 13.0827, lng: 80.2707, tz: 'Asia/Kolkata', locale: 'ta-IN' },
  { name: 'London, UK', lat: 51.5072, lng: -0.1276, tz: 'Europe/London', locale: 'en-GB' },
  { name: 'Berlin, Germany', lat: 52.52, lng: 13.405, tz: 'Europe/Berlin', locale: 'de-DE' },
  { name: 'New York, US', lat: 40.7128, lng: -74.006, tz: 'America/New_York', locale: 'en-US' },
  { name: 'San Francisco, US', lat: 37.7749, lng: -122.4194, tz: 'America/Los_Angeles', locale: 'en-US' },
  { name: 'São Paulo, Brazil', lat: -23.5505, lng: -46.6333, tz: 'America/Sao_Paulo', locale: 'pt-BR' },
  { name: 'Dubai, UAE', lat: 25.2048, lng: 55.2708, tz: 'Asia/Dubai', locale: 'ar-AE' },
  { name: 'Singapore', lat: 1.3521, lng: 103.8198, tz: 'Asia/Singapore', locale: 'en-SG' },
  { name: 'Tokyo, Japan', lat: 35.6762, lng: 139.6503, tz: 'Asia/Tokyo', locale: 'ja-JP' },
  { name: 'Sydney, Australia', lat: -33.8688, lng: 151.2093, tz: 'Australia/Sydney', locale: 'en-AU' },
];

export const LOCALES = ['en-IN', 'hi-IN', 'kn-IN', 'ta-IN', 'te-IN', 'bn-IN', 'mr-IN', 'en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ja-JP', 'zh-CN', 'ar-AE', 'ru-RU'];
