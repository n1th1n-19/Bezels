import type { Browser, BrowserContext, CDPSession, Page, Request } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ConsoleEntry, Device, DeviceState, Engine, Layout, NetEntry, TgEvent, TgRuntime } from '../shared/types.js';
import { computeLayout, emptyTgRuntime, NETWORK_PRESETS } from '../shared/layout.js';
import { tgTheme } from '../shared/telegram.js';
import { runtimeInit } from './inpage.js';
import { buildInitData, mockConfig, tgMock } from './telegram.js';

/* Ring buffers: never grow without bound. */
export const CONSOLE_CAP = 1000, NET_CAP = 500, BG_CAP = 100, TG_CAP = 500;
const SNAP_DIR = join(tmpdir(), 'bezels-snapshots');
mkdirSync(SNAP_DIR, { recursive: true });

export interface HostEnv {
  browser(engine: Engine): Promise<Browser>;
  retain(engine: Engine): void;
  release(engine: Engine): void;
  emit(event: string, data: unknown): void;
  botToken?: string;
  fps: number;
  onScroll(host: Host, pct: number): void;
  onNavigate(host: Host, url: string): void;
}

export interface FrameSub { maxW: number; maxH: number; send(meta: { w: number; h: number }, jpeg: Buffer): void }

export type Action =
  | { type: 'tap'; x?: number; y?: number; selector?: string }
  | { type: 'longpress'; x?: number; y?: number; selector?: string; ms?: number }
  | { type: 'swipe'; x1: number; y1: number; x2: number; y2: number; durationMs?: number }
  | { type: 'scroll'; dx?: number; dy?: number; to?: 'top' | 'bottom' | number }
  | { type: 'type'; text: string; selector?: string }
  | { type: 'press'; key: string }
  | { type: 'pinch'; x: number; y: number; scale: number }
  | { type: 'hover'; x?: number; y?: number; selector?: string }
  | { type: 'pointer'; phase: 'down' | 'move' | 'up'; x: number; y: number }
  | { type: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { type: 'goto'; url: string }
  | { type: 'back' } | { type: 'forward' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything that forces a new browser context when it changes. */
export function contextKey(d: Device, s: DeviceState, engine: Engine): string {
  const e = s.emulation;
  return JSON.stringify({
    engine, dpr: d.dpr, mobile: d.mobile,
    ua: engine === 'webkit' ? (e.userAgent || d.userAgent[s.browser]) : d.userAgent[s.browser],
    touch: engine === 'webkit' ? (e.touch ?? d.touch) : d.touch,
    tg: s.telegram.enabled ? [s.telegram.platform, s.telegram.version, s.telegram.language, s.telegram.startParam, s.telegram.user?.id] : null,
    battery: e.battery ?? null,
    wk: engine === 'webkit' ? [e.locale, e.timezone] : null,
  });
}

/** One browser context + page. Several sessions (devices) can share it when they would render identically. */
export class Host {
  ctx?: BrowserContext;
  page?: Page;
  cdp?: CDPSession;
  status: 'loading' | 'live' | 'frozen' | 'evicted' = 'loading';
  ctxKey = '';
  url: string;
  title = '';
  scrollY = 0;
  lastUsed = Date.now();
  collecting = false;      // full DevTools data only for the focused device
  preserveLog = false;
  console: ConsoleEntry[] = [];
  net: NetEntry[] = [];
  reqs = new Map<number, Request>();
  errors = { console: 0, network: 0 };
  tgEvents: TgEvent[] = [];
  tg: TgRuntime = emptyTgRuntime();
  tgStores = { CloudStorage: new Map<string, string>(), DeviceStorage: new Map<string, string>(), SecureStorage: new Map<string, string>() };
  tgPopupId?: string;
  snapshot?: string;
  safeAreaNative = true;
  layout!: Layout;
  private subs = new Set<FrameSub>();
  private seq = 0;
  private lastInput = 0;
  private castRunning = false;
  private pollTimer?: NodeJS.Timeout;
  private lastFrame?: Buffer;
  private reqIds = new WeakMap<Request, number>();
  private pointer?: { x: number; y: number; moved: boolean; touch: boolean };
  private navGuard = false;
  private building?: Promise<void>;
  private castHandler?: (f: { data: string; sessionId: number; metadata: { deviceWidth?: number; deviceHeight?: number } }) => Promise<void>;

  constructor(public env: HostEnv, public device: Device, public state: DeviceState, url: string, public engine: Engine) {
    this.url = url;
  }

  get touch() { return this.engine === 'chromium' ? (this.state.emulation.touch ?? this.device.touch) : this.device.touch; }

  /** Build (or rebuild) the browser context. Keeps URL + scroll. */
  async build(): Promise<void> {
    if (this.building) return this.building;
    this.building = this._build().finally(() => { this.building = undefined; });
    return this.building;
  }

  lastError?: string;
  /** Major version of the Chromium actually running, so Chrome UAs never go stale. */
  chromeMajor?: string;

  /** Device UA (or the user's override). Chrome UAs get the running Chromium's major version; Samsung Internet keeps its own. */
  userAgent(): string {
    const s = this.state, d = this.device;
    if (s.emulation.userAgent) return s.emulation.userAgent;
    const ua = d.userAgent[s.browser] || Object.values(d.userAgent)[0]!;
    if (!this.chromeMajor || /SamsungBrowser/.test(ua)) return ua;
    return ua.replace(/Chrome\/\d+\.0\.0\.0/, `Chrome/${this.chromeMajor}.0.0.0`).replace(/Edg\/\d+\.0\.0\.0/, `Edg/${this.chromeMajor}.0.0.0`);
  }

  private async _build() {
    try { await this._buildInner(); this.lastError = undefined; }
    catch (e) { this.status = 'evicted'; this.lastError = (e as Error).message; this.env.emit('host', this); throw e; }
  }

  private async _buildInner() {
    const d = this.device, s = this.state;
    const oldCtx = this.ctx;
    this.ctx = undefined; this.page = undefined; this.cdp = undefined;
    if (oldCtx) { await oldCtx.close().catch(() => {}); this.env.release(this.engine); }
    this.status = 'loading';
    this.layout = computeLayout(d, s, this.tg);
    const L = this.layout;
    const e = s.emulation;
    const browser = await this.env.browser(this.engine);
    this.chromeMajor = this.engine === 'chromium' ? browser.version().split('.')[0]! : undefined;
    const ua = this.userAgent();
    const geo = e.geolocation && e.geolocation !== 'unavailable' ? { latitude: e.geolocation.lat, longitude: e.geolocation.lng, accuracy: e.geolocation.accuracy } : undefined;
    const ctx = await browser.newContext({
      viewport: { width: L.viewport.w, height: L.viewport.h },
      screen: { width: L.screen.w, height: L.screen.h },
      deviceScaleFactor: d.dpr,
      isMobile: d.mobile,
      hasTouch: this.engine === 'webkit' ? (e.touch ?? d.touch) : d.touch,
      userAgent: ua,
      colorScheme: s.colorScheme,
      reducedMotion: s.reducedMotion ? 'reduce' : 'no-preference',
      forcedColors: e.forcedColors ? 'active' : 'none',
      locale: e.locale || (s.telegram.enabled ? s.telegram.language : undefined),
      timezoneId: e.timezone,
      geolocation: geo,
      permissions: geo ? ['geolocation'] : [],
      offline: s.network === 'offline',
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: e.locale ? { 'Accept-Language': `${e.locale},${e.locale.split('-')[0]};q=0.9` } : undefined,
    });
    this.env.retain(this.engine);
    this.ctx = ctx;
    this.ctxKey = contextKey(d, s, this.engine);

    await ctx.exposeBinding('__bezels', (_src, msg) => this.onBinding(msg));
    const page = await ctx.newPage();
    this.page = page;
    if (this.engine === 'chromium') {
      this.cdp = await ctx.newCDPSession(page);
      this.safeAreaNative = await this.cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: this.insetsForCdp() } as never).then(() => true, () => false);
    } else this.safeAreaNative = false;
    await ctx.addInitScript({ content: `(${runtimeInit.toString()})(${JSON.stringify({ safeArea: this.safeAreaNative ? null : L.pageSafeArea, battery: e.battery ?? null })})` });

    if (s.telegram.enabled) {
      const init = buildInitData(s.telegram, this.env.botToken);
      const t = L.tg!;
      const cfg = mockConfig(s.telegram, init, { h: L.viewport.h, expanded: t.isExpanded, fullscreen: t.isFullscreen, safe: { ...t.safeAreaInset }, content: { ...t.contentSafeAreaInset } });
      await ctx.addInitScript({ content: `(${tgMock.toString()})(${JSON.stringify(cfg)})` });
      // The page's own <script src="https://telegram.org/js/telegram-web-app.js"> must not replace the mock.
      await ctx.route(/telegram\.org\/js\/telegram-web-app\.js/, (r) => r.fulfill({ contentType: 'application/javascript', body: '/* bezels: Telegram WebApp is mocked */' }));
    }
    for (const pat of e.blocked ?? []) await ctx.route(pat, (r) => r.abort('blockedbyclient'));

    this.wire(page);
    await this.applyLive(true);
    try {
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (err) {
      this.pushConsole({ level: 'error', text: `Bezels: could not load ${this.url}: ${(err as Error).message.split('\n')[0]}` });
    }
    if (this.scrollY) await page.evaluate((y) => scrollTo(0, y), this.scrollY).catch(() => {});
    this.title = await page.title().catch(() => '');
    this.status = 'live';
    if (this.subs.size) this.startCast();
  }

  private insetsForCdp() {
    const p = this.layout.pageSafeArea;
    return { top: p.top, topMax: p.top, left: p.left, leftMax: p.left, bottom: p.bottom, bottomMax: p.bottom, right: p.right, rightMax: p.right };
  }

  private wire(page: Page) {
    page.on('console', (m) => {
      const level = m.type();
      if (level === 'error') this.errors.console++;
      if (!this.collecting && level !== 'error' && level !== 'warning') return;
      const loc = m.location();
      this.pushConsole({ level, text: m.text().slice(0, 4000), url: loc.url, line: loc.lineNumber + 1, col: loc.columnNumber + 1 });
    });
    page.on('pageerror', (err) => {
      this.errors.console++;
      const top = /\(?(https?:\/\/[^\s)]+):(\d+):(\d+)\)?/.exec(err.stack ?? '');
      this.pushConsole({ level: 'error', text: `${err.name.startsWith('Uncaught') ? err.name : 'Uncaught ' + err.name}: ${err.message}`, stack: err.stack?.slice(0, 4000), url: top?.[1], line: top ? +top[2]! : undefined, col: top ? +top[3]! : undefined });
    });
    page.on('request', (r) => {
      const id = ++this.seq;
      this.reqIds.set(r, id);
      if (!this.collecting) return;
      this.pushNet({ id, time: Date.now(), url: r.url(), method: r.method(), status: 0, type: r.resourceType(), size: 0, duration: 0, start: Date.now(), pending: true }, r);
    });
    page.on('requestfinished', async (r) => {
      const id = this.reqIds.get(r)!;
      const resp = await r.response().catch(() => null);
      const status = resp?.status() ?? 0;
      if (status >= 400) this.errors.network++;
      if (!this.collecting && status < 400) return;
      const t = r.timing();
      const size = this.collecting ? await r.sizes().then((s) => s.responseBodySize + s.responseHeadersSize, () => 0) : 0;
      this.updateNet(id, r, { status, size, duration: Math.max(0, Math.round(t.responseEnd)), pending: false, fromCache: resp ? (resp.fromServiceWorker() || status === 304) : false });
    });
    page.on('requestfailed', (r) => {
      this.errors.network++;
      this.updateNet(this.reqIds.get(r)!, r, { failed: r.failure()?.errorText ?? 'failed', pending: false, duration: Math.round(r.timing().responseEnd > 0 ? r.timing().responseEnd : 0) });
    });
    page.on('websocket', (ws) => {
      if (!this.collecting) return;
      const id = ++this.seq;
      this.pushNet({ id, time: Date.now(), url: ws.url(), method: 'GET', status: 101, type: 'websocket', size: 0, duration: 0, start: Date.now(), pending: true });
    });
    page.on('framenavigated', (f) => {
      if (f !== page.mainFrame()) return;
      const url = f.url();
      if (url === 'about:blank' || url.startsWith('chrome-error:')) return; // keep the URL we meant to load
      const changed = url !== this.url;
      this.url = url;
      if (!this.preserveLog) { this.console = []; this.net = []; this.reqs.clear(); this.errors = { console: 0, network: 0 }; }
      this.tgEvents = this.preserveLog ? this.tgEvents : [];
      page.title().then((t) => { this.title = t; this.env.emit('host', this); }, () => {});
      if (changed && !this.navGuard) this.env.onNavigate(this, url);
      this.env.emit('host', this);
    });
    page.on('close', () => { if (this.page === page) { this.page = undefined; if (this.status !== 'evicted') this.status = 'evicted'; } });
    page.on('dialog', (dl) => { this.pushConsole({ level: 'info', text: `Bezels: auto-dismissed ${dl.type()}("${dl.message().slice(0, 200)}")` }); dl.dismiss().catch(() => {}); });
  }

  private pushConsole(e: Omit<ConsoleEntry, 'id' | 'time'>) {
    const entry = { id: ++this.seq, time: Date.now(), ...e };
    const buf = this.console;
    buf.push(entry);
    const cap = this.collecting ? CONSOLE_CAP : BG_CAP;
    if (buf.length > cap) buf.splice(0, buf.length - cap);
    this.env.emit('console', { host: this, entry });
  }
  private pushNet(e: NetEntry, r?: Request) {
    this.net.push(e);
    if (r) this.reqs.set(e.id, r);
    const cap = this.collecting ? NET_CAP : BG_CAP;
    if (this.net.length > cap) { for (const x of this.net.splice(0, this.net.length - cap)) this.reqs.delete(x.id); }
    this.env.emit('network', { host: this, entry: e });
  }
  private updateNet(id: number, r: Request, patch: Partial<NetEntry>) {
    let e = this.net.find((x) => x.id === id);
    if (!e) {
      if (!patch.failed && (patch.status ?? 0) < 400) return;
      e = { id, time: Date.now(), url: r.url(), method: r.method(), status: 0, type: r.resourceType(), size: 0, duration: 0, start: Date.now() };
      this.pushNet(e, r);
    }
    Object.assign(e, patch);
    this.env.emit('network', { host: this, entry: e });
  }

  /** Messages from in-page scripts (runtime + Telegram mock). */
  private async onBinding(m: any): Promise<unknown> {
    switch (m?.type) {
      case 'scroll': this.scrollY = m.y; this.env.onScroll(this, m.pct); return;
      case 'tg': {
        const ev: TgEvent = { time: Date.now(), method: m.method, args: m.args, unsupported: m.unsupported, minVersion: m.minVersion };
        this.tgEvents.push(ev);
        if (this.tgEvents.length > TG_CAP) this.tgEvents.shift();
        if (m.method === 'close') this.tg.closed = true;
        this.env.emit('tg', { host: this, event: ev });
        if (m.method === 'close') this.env.emit('tgRuntime', this);
        return;
      }
      case 'tgButton': {
        const b = m.which === 'main' ? this.tg.mainButton : this.tg.secondaryButton;
        const wasVisible = this.tg.mainButton.visible || this.tg.secondaryButton.visible;
        Object.assign(b, m.state);
        this.env.emit('tgRuntime', this);
        if (wasVisible !== (this.tg.mainButton.visible || this.tg.secondaryButton.visible)) await this.relayout();
        return;
      }
      case 'tgSimpleButton': if (m.name === 'BackButton') this.tg.backButton = m.visible; else this.tg.settingsButton = m.visible; this.env.emit('tgRuntime', this); return;
      case 'tgColor': (this.tg as any)[m.key] = m.value; this.env.emit('tgRuntime', this); return;
      case 'tgFlag': (this.tg as any)[m.key] = m.value; this.env.emit('tgRuntime', this); return;
      case 'tgMode':
        if (this.state.telegram.mode !== m.mode) { this.state.telegram.mode = m.mode; await this.relayout(); this.tgSend({ type: 'fullscreen', value: m.mode === 'fullscreen' }); this.env.emit('host', this); }
        return;
      case 'tgPopup': this.tg.popup = { kind: m.kind, title: m.params?.title, message: m.params?.message ?? '', buttons: m.params?.buttons ?? [{ id: 'ok', type: 'ok' }] }; this.tgPopupId = m.id; this.env.emit('tgRuntime', this); return;
      case 'tgPopupClose': this.tg.popup = null; this.env.emit('tgRuntime', this); return;
      case 'tgCall': return this.tgCall(m.method, m.args);
    }
  }

  private tgCall(method: string, args: any[]) {
    const [store, op] = method.split('.') as [keyof Host['tgStores'], string];
    if (method === 'readTextFromClipboard') return { result: 'bezels clipboard text' };
    const map = this.tgStores[store];
    if (!map) return { error: 'UNKNOWN_METHOD' };
    switch (op) {
      case 'setItem': map.set(String(args[0]), String(args[1])); return { result: true };
      case 'getItem': return { result: map.get(String(args[0])) ?? (store === 'CloudStorage' ? '' : null) };
      case 'getItems': return { result: Object.fromEntries((args[0] as string[]).map((k) => [k, map.get(k) ?? ''])) };
      case 'removeItem': map.delete(String(args[0])); return { result: true };
      case 'removeItems': (args[0] as string[]).forEach((k) => map.delete(k)); return { result: true };
      case 'getKeys': return { result: [...map.keys()] };
      case 'clear': map.clear(); return { result: true };
    }
    return { error: 'UNKNOWN_METHOD' };
  }

  async tgSend(msg: unknown) {
    await this.page?.evaluate((m) => (window as any).__bezelsTgReceive?.(m), msg).catch(() => {});
  }

  /** Recompute layout after a Telegram UI change and push the new viewport into the page. */
  async relayout(stable = true) {
    const before = this.layout?.viewport;
    this.layout = computeLayout(this.device, this.state, this.tg);
    const L = this.layout;
    if (this.page && (before?.w !== L.viewport.w || before?.h !== L.viewport.h)) await this.page.setViewportSize({ width: L.viewport.w, height: L.viewport.h }).catch(() => {});
    if (L.tg) {
      await this.tgSend({ type: 'safeArea', safe: L.tg.safeAreaInset, content: L.tg.contentSafeAreaInset });
      await this.tgSend({ type: 'viewport', height: L.viewport.h, isStateStable: stable, isExpanded: L.tg.isExpanded });
    }
    this.env.emit('host', this);
  }

  /** Apply everything that can change without a new context. */
  async applyLive(initial = false) {
    const page = this.page, cdp = this.cdp, s = this.state, d = this.device, e = s.emulation;
    if (!page || !this.ctx) return;
    const prev = this.layout;
    this.layout = computeLayout(d, s, this.tg);
    const L = this.layout;
    if (!initial && (prev.viewport.w !== L.viewport.w || prev.viewport.h !== L.viewport.h)) await page.setViewportSize({ width: L.viewport.w, height: L.viewport.h });
    await page.emulateMedia({ colorScheme: s.colorScheme, reducedMotion: s.reducedMotion ? 'reduce' : 'no-preference', forcedColors: e.forcedColors ? 'active' : 'none', media: e.print ? 'print' : 'screen' });
    await this.ctx.setOffline(s.network === 'offline');
    if (cdp) {
      const quiet = (m: string, p?: object) => cdp.send(m as never, p as never).catch(() => undefined);
      const landscape = s.orientation.startsWith('landscape');
      await quiet('Emulation.setDeviceMetricsOverride', {
        width: L.viewport.w, height: L.viewport.h, deviceScaleFactor: d.dpr, mobile: d.mobile, screenWidth: L.screen.w, screenHeight: L.screen.h,
        screenOrientation: { type: s.orientation === 'portrait' ? 'portraitPrimary' : s.orientation === 'portrait-upside-down' ? 'portraitSecondary' : s.orientation === 'landscape-left' ? 'landscapePrimary' : 'landscapeSecondary', angle: L.rotation },
      });
      void landscape;
      if (this.safeAreaNative) await quiet('Emulation.setSafeAreaInsetsOverride', { insets: this.insetsForCdp() });
      if (d.fold) {
        if (s.fold === 'folded') { await quiet('Emulation.clearDevicePostureOverride'); await quiet('Emulation.clearDisplayFeaturesOverride'); }
        else {
          await quiet('Emulation.setDevicePostureOverride', { posture: { type: s.fold === 'unfolded' ? 'continuous' : 'folded' } });
          const h = L.hinge!;
          const vertical = h.h > h.w;
          if (s.fold !== 'unfolded') await quiet('Emulation.setDisplayFeaturesOverride', { features: [{ orientation: vertical ? 'vertical' : 'horizontal', offset: Math.round(vertical ? h.x - L.viewport.x : h.y - L.viewport.y), maskLength: 0 }] });
          else await quiet('Emulation.clearDisplayFeaturesOverride');
        }
      }
      await quiet('Network.enable');
      const preset = s.network === 'custom' ? e.customNetwork : NETWORK_PRESETS[s.network];
      await quiet('Network.emulateNetworkConditions', preset
        ? { offline: false, latency: preset.latencyMs, downloadThroughput: (preset.downloadKbps * 1024) / 8, uploadThroughput: (preset.uploadKbps * 1024) / 8 }
        : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await quiet('Network.setCacheDisabled', { cacheDisabled: !!e.cacheDisabled });
      await quiet('Emulation.setCPUThrottlingRate', { rate: Math.max(1, s.cpu || 1) });
      await quiet('Emulation.setEmulatedVisionDeficiency', { type: e.vision ?? 'none' });
      if (e.idle && e.idle !== 'active') await quiet('Emulation.setIdleOverride', { isUserActive: false, isScreenUnlocked: e.idle !== 'locked' });
      else await quiet('Emulation.clearIdleOverride');
      if (e.sensors) await quiet('DeviceOrientation.setDeviceOrientationOverride', e.sensors);
      else await quiet('DeviceOrientation.clearDeviceOrientationOverride');
      if (e.timezone) await quiet('Emulation.setTimezoneOverride', { timezoneId: e.timezone });
      if (e.locale) await quiet('Emulation.setLocaleOverride', { locale: e.locale });
      await quiet('Emulation.setTouchEmulationEnabled', { enabled: this.touch, maxTouchPoints: this.touch ? 5 : 0 });
      await quiet('Emulation.setUserAgentOverride', { userAgent: this.userAgent(), acceptLanguage: e.locale, userAgentMetadata: e.userAgent ? undefined : clientHints(d, this.chromeMajor) });
      if (e.geolocation === 'unavailable') await quiet('Emulation.setGeolocationOverride', {});
      else if (e.geolocation) await quiet('Emulation.setGeolocationOverride', { latitude: e.geolocation.lat, longitude: e.geolocation.lng, accuracy: e.geolocation.accuracy });
      for (const [name, v] of Object.entries(e.permissions ?? {})) {
        for (const pn of permNames(name)) await quiet('Browser.setPermission', { permission: { name: pn }, setting: v === 'allow' ? 'granted' : v === 'block' ? 'denied' : 'prompt', origin: safeOrigin(this.url) });
      }
    } else {
      // WebKit: no CDP. Use Playwright's cross-engine APIs; the rest is marked "Chromium only" in the UI.
      if (e.geolocation && e.geolocation !== 'unavailable') await this.ctx.setGeolocation({ latitude: e.geolocation.lat, longitude: e.geolocation.lng, accuracy: e.geolocation.accuracy });
      const allow = Object.entries(e.permissions ?? {}).filter(([, v]) => v === 'allow').flatMap(([k]) => permNames(k)).filter((p) => p !== 'clipboard-read' && p !== 'clipboard-write');
      if (e.geolocation && e.geolocation !== 'unavailable') allow.push('geolocation');
      await this.ctx.clearPermissions();
      if (allow.length) await this.ctx.grantPermissions([...new Set(allow)]).catch(() => {});
      if (e.sensors && !initial) await page.evaluate((o) => dispatchEvent(new DeviceOrientationEvent('deviceorientation', { ...o, absolute: false })), e.sensors).catch(() => {});
    }
    if (e.geolocation && e.geolocation !== 'unavailable' && this.engine === 'chromium') await this.ctx.setGeolocation({ latitude: e.geolocation.lat, longitude: e.geolocation.lng, accuracy: e.geolocation.accuracy });
    if (!initial && L.tg) await this.relayout();
    if (!initial) this.env.emit('host', this);
  }

  /** Make sure the page is alive and not frozen. */
  async active(): Promise<Page> {
    this.lastUsed = Date.now();
    if (this.building) await this.building;
    if (!this.page || this.status === 'evicted') await this.build();
    if (this.status === 'frozen') {
      await this.cdp?.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
      this.status = 'live';
    }
    return this.page!;
  }

  async freeze() {
    if (this.status !== 'live' || this.subs.size) return;
    await this.takeSnapshot();
    if (this.cdp) { await this.cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {}); this.status = 'frozen'; }
  }

  async evict() {
    if (this.status === 'evicted') return;
    await this.takeSnapshot();
    this.stopCast();
    const ctx = this.ctx;
    this.ctx = undefined; this.page = undefined; this.cdp = undefined;
    this.status = 'evicted';
    if (ctx) { await ctx.close().catch(() => {}); this.env.release(this.engine); }
  }

  async close() { this.subs.clear(); await this.evict(); }

  async takeSnapshot() {
    if (!this.page || this.status !== 'live') return;
    const file = join(SNAP_DIR, `${process.pid}-${this.device.id}-${Math.abs(hash(this.ctxKey + this.url))}.jpg`);
    const buf = await this.page.screenshot({ type: 'jpeg', quality: 60, scale: 'css', timeout: 5000 }).catch(() => null);
    if (buf) { writeFileSync(file, buf); this.snapshot = file; this.env.emit('host', this); }
  }

  // ---------- Live view ----------
  subscribe(sub: FrameSub) { this.subs.add(sub); this.lastUsed = Date.now(); if (this.status === 'live') this.startCast(); else this.active().then(() => this.startCast(), () => {}); return () => { this.subs.delete(sub); if (!this.subs.size) this.stopCast(); }; }
  hasSubscribers() { return this.subs.size > 0; }

  private maxSize() { let w = 0, h = 0; for (const s of this.subs) { w = Math.max(w, s.maxW); h = Math.max(h, s.maxH); } return { w: Math.round(w), h: Math.round(h) }; }

  startCast() {
    if (this.castRunning || !this.page || !this.subs.size) return;
    this.castRunning = true;
    const minGap = 1000 / this.env.fps;
    if (this.cdp) {
      const cdp = this.cdp;
      let last = 0;
      if (this.castHandler) cdp.off('Page.screencastFrame', this.castHandler);
      this.castHandler = async (f) => {
        const buf = Buffer.from(f.data, 'base64');
        const meta = { w: Math.round(f.metadata.deviceWidth ?? this.layout.viewport.w), h: Math.round(f.metadata.deviceHeight ?? this.layout.viewport.h) };
        for (const s of this.subs) s.send(meta, buf);
        // Ack-based: the next frame is only produced after this ack, so frames never queue. The delay caps fps.
        const wait = Math.max(0, minGap - (Date.now() - last));
        last = Date.now();
        if (wait) await sleep(wait);
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      };
      cdp.on('Page.screencastFrame', this.castHandler);
      const m = this.maxSize();
      cdp.send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: m.w || undefined, maxHeight: m.h || undefined, everyNthFrame: 1 }).catch(() => { this.castRunning = false; });
      // Screencast only emits on change; send one frame now so a fresh subscriber isn't blank.
      this.pushStill();
    } else {
      // WebKit has no screencast: poll JPEG screenshots. Skip-if-busy, faster right after input, slow when idle.
      const loop = async () => {
        if (!this.castRunning) return;
        const t0 = Date.now();
        await this.pushStill(true);
        const recent = Date.now() - this.lastInput < 2500;
        const gap = recent ? Math.max(minGap, 160) : 1000;
        this.pollTimer = setTimeout(loop, Math.max(30, gap - (Date.now() - t0)));
      };
      loop();
    }
  }

  private async pushStill(dedupe = false) {
    if (!this.page || this.status !== 'live') return;
    const buf = await this.page.screenshot({ type: 'jpeg', quality: 62, scale: 'css', timeout: 4000, animations: 'allow', caret: 'initial' }).catch(() => null);
    if (!buf) return;
    if (dedupe && this.lastFrame?.equals(buf)) return;
    this.lastFrame = dedupe ? buf : undefined;
    const meta = { w: this.layout.viewport.w, h: this.layout.viewport.h };
    for (const s of this.subs) s.send(meta, buf);
  }

  stopCast() {
    if (!this.castRunning) return;
    this.castRunning = false;
    clearTimeout(this.pollTimer);
    this.lastFrame = undefined;
    this.cdp?.send('Page.stopScreencast').catch(() => {});
    if (this.castHandler) this.cdp?.off('Page.screencastFrame', this.castHandler);
    this.castHandler = undefined;
  }

  restartCast() { if (this.castRunning) { this.stopCast(); this.startCast(); } }

  // ---------- Input ----------
  async interact(a: Action): Promise<string> {
    const page = await this.active();
    this.lastInput = Date.now();
    const at = async (sel?: string, x?: number, y?: number) => {
      if (sel) {
        const loc = page.locator(sel).first();
        await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
        const b = await loc.boundingBox();
        if (!b) throw new Error(`No visible element for ${sel}`);
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      return { x: x ?? 0, y: y ?? 0 };
    };
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      this.cdp!.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
    const canTouch = this.touch && !!this.cdp;
    switch (a.type) {
      case 'tap': { const p = await at(a.selector, a.x, a.y); if (this.touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); return `tapped ${Math.round(p.x)},${Math.round(p.y)}`; }
      case 'longpress': {
        const p = await at(a.selector, a.x, a.y);
        if (canTouch) { await touch('touchStart', p.x, p.y); await sleep(a.ms ?? 700); await touch('touchEnd', p.x, p.y); }
        else { await page.mouse.move(p.x, p.y); await page.mouse.down(); await sleep(a.ms ?? 700); await page.mouse.up(); }
        return 'long-pressed';
      }
      case 'swipe': {
        const steps = 12, dur = a.durationMs ?? 300;
        if (canTouch) {
          await touch('touchStart', a.x1, a.y1);
          for (let i = 1; i <= steps; i++) { await touch('touchMove', a.x1 + ((a.x2 - a.x1) * i) / steps, a.y1 + ((a.y2 - a.y1) * i) / steps); await sleep(dur / steps); }
          await touch('touchEnd', a.x2, a.y2);
        } else {
          await page.mouse.move(a.x1, a.y1);
          await page.mouse.wheel(a.x1 - a.x2, a.y1 - a.y2); // WebKit: approximated as a scroll
        }
        return 'swiped';
      }
      case 'scroll':
        if (a.to !== undefined) await page.evaluate((to) => { const se = document.scrollingElement!; scrollTo(0, to === 'top' ? 0 : to === 'bottom' ? se.scrollHeight : (se.scrollHeight - innerHeight) * Number(to)); }, a.to);
        else await page.evaluate(([dx, dy]) => scrollBy(dx!, dy!), [a.dx ?? 0, a.dy ?? 0]);
        return 'scrolled';
      case 'type': if (a.selector) await page.locator(a.selector).first().click(); await page.keyboard.type(a.text, { delay: 10 }); return 'typed';
      case 'press': await page.keyboard.press(a.key); return `pressed ${a.key}`;
      case 'pinch':
        if (!this.cdp) throw new Error('Pinch needs Chromium (WebKit has no gesture API).');
        await this.cdp.send('Input.synthesizePinchGesture', { x: a.x, y: a.y, scaleFactor: a.scale, gestureSourceType: 'touch' });
        return 'pinched';
      case 'hover': { const p = await at(a.selector, a.x, a.y); await page.mouse.move(p.x, p.y); return 'hovered'; }
      case 'wheel': await page.mouse.move(a.x, a.y); await page.mouse.wheel(a.dx, a.dy); return 'wheel';
      case 'pointer': {
        if (a.phase === 'down') { this.pointer = { x: a.x, y: a.y, moved: false, touch: this.touch }; if (canTouch) await touch('touchStart', a.x, a.y); else if (!this.touch) { await page.mouse.move(a.x, a.y); await page.mouse.down(); } }
        else if (a.phase === 'move') {
          const p = this.pointer;
          if (!p) { if (!this.touch) await page.mouse.move(a.x, a.y); return 'move'; }
          if (Math.hypot(a.x - p.x, a.y - p.y) > 3) p.moved = true;
          if (canTouch) await touch('touchMove', a.x, a.y);
          else if (!this.touch) await page.mouse.move(a.x, a.y);
          else { await page.mouse.wheel(p.x - a.x, p.y - a.y); p.x = a.x; p.y = a.y; }
        } else {
          const p = this.pointer; this.pointer = undefined;
          if (canTouch) await touch('touchEnd', a.x, a.y);
          else if (!this.touch) await page.mouse.up();
          else if (p && !p.moved) await page.touchscreen.tap(a.x, a.y);
        }
        return a.phase;
      }
      case 'goto': await this.goto(a.url); return `navigated to ${a.url}`;
      case 'back': await page.goBack({ timeout: 15000 }).catch(() => null); return 'back';
      case 'forward': await page.goForward({ timeout: 15000 }).catch(() => null); return 'forward';
    }
  }

  async goto(url: string, fromSync = false) {
    const page = await this.active();
    this.url = url;
    this.navGuard = fromSync;
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
    catch (e) { this.pushConsole({ level: 'error', text: `Bezels: could not load ${url}: ${(e as Error).message.split('\n')[0]}` }); }
    finally { this.navGuard = false; }
  }

  async reload(hard = false) {
    const page = await this.active();
    this.navGuard = true;
    try {
      if (hard && this.cdp) { await this.cdp.send('Network.clearBrowserCache').catch(() => {}); }
      if (hard && !this.cdp) { await page.goto(this.url, { waitUntil: 'domcontentloaded' }).catch(() => {}); return; }
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    } finally { this.navGuard = false; }
  }

  setCollecting(on: boolean) { this.collecting = on; }

  /** Theme of Telegram (for UI + mock) */
  tgThemeParams() { return tgTheme(this.state.telegram); }
}

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function safeOrigin(u: string) { try { return new URL(u).origin; } catch { return undefined; } }
function permNames(k: string): string[] {
  return ({ location: ['geolocation'], camera: ['videoCapture'], microphone: ['audioCapture'], notifications: ['notifications'], clipboard: ['clipboardReadWrite', 'clipboardSanitizedWrite'] } as Record<string, string[]>)[k] ?? [k];
}
/** User-Agent Client Hints that match the device (navigator.userAgentData). */
function clientHints(d: Device, major?: string) {
  const v = major ?? /Chrome\/(\d+)/.exec(Object.values(d.userAgent).join(' '))?.[1] ?? '141';
  const brands = [{ brand: 'Chromium', version: v }, { brand: 'Google Chrome', version: v }, { brand: 'Not?A_Brand', version: '24' }];
  const platform = d.os === 'android' ? 'Android' : d.os === 'windows' ? 'Windows' : d.os === 'macos' ? 'macOS' : 'Linux';
  return { brands, fullVersionList: brands.map((b) => ({ ...b, version: b.version + '.0.0.0' })), platform, platformVersion: d.os === 'android' ? '15.0.0' : d.os === 'windows' ? '19.0.0' : '15.0.0', architecture: d.mobile ? '' : 'x86', model: '', mobile: d.mobile, bitness: d.mobile ? '' : '64', wow64: false };
}
