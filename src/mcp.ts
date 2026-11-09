import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Core } from './core/core.js';
import { dispatch } from './core/rpc.js';
import { ping, remote, startServer } from './server.js';
import { loadConfig } from './core/config.js';

/**
 * MCP server ("agent browser" for Claude Code).
 * If a Bezels daemon/UI is already running, proxy to it so Claude and the user share sessions.
 * Otherwise run the engine in-process and serve the UI ourselves on the same port.
 */
export async function runMcp() {
  const port = loadConfig().port;
  let call: (m: string, p?: unknown) => Promise<any>;
  let core: Core | undefined;
  if (await ping(port)) {
    call = remote(port, 'mcp');
    setInterval(() => call('mcp_hello').catch(() => {}), 15_000).unref();
    call('mcp_hello').catch(() => {});
  } else {
    core = new Core();
    try { await startServer(core, port); console.error(`bezels: UI at http://localhost:${port}`); } catch (e) { console.error(`bezels: UI not started (${(e as Error).message})`); }
    call = (m, p) => dispatch(core!, m, p, 'mcp');
    call('mcp_hello').catch(() => {});
  }

  const server = new McpServer({ name: 'bezels', version: '0.1.0' }, {
    instructions: 'Bezels shows pages on emulated real devices (Chromium for Android/desktop, WebKit for iPhone/iPad) with browser bars, notches, safe areas and folds. Typical loop: open(url, ["phones","folds"]) → audit_all → fix CSS → audit_layout again → screenshot_matrix to confirm. Device sets: phones, iphones, android, folds, tablets, laptops, desktop, breakpoints, telegram, all. Sessions also appear in the user\'s Bezels UI.',
  });

  const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
  const safe = (fn: (a: any) => Promise<any>) => async (a: any) => {
    try { return await fn(a); } catch (e) { return { ...text(`Error: ${(e as Error).message}`), isError: true }; }
  };
  const tool = (name: string, description: string, schema: z.ZodRawShape, fn?: (a: any) => Promise<any>) =>
    server.registerTool(name, { description, inputSchema: schema }, safe(fn ?? (async (a) => text(await call(name, a)))) as any);

  const session = z.string().describe('Session id from open() (or a device id if only one session uses it)');
  const devices = z.union([z.array(z.string()), z.string()]).describe('Device ids and/or sets: phones, iphones, android, folds, tablets, laptops, desktop, breakpoints, telegram, all');
  const imgReply = (r: any) => ({
    content: [
      ...(r.preview ? [{ type: 'image' as const, data: r.preview, mimeType: 'image/png' }] : []),
      { type: 'text' as const, text: JSON.stringify({ ...r, preview: undefined, note: 'Image above is a downscaled preview; full resolution at path.' }) },
    ],
  });

  tool('list_devices', 'List device ids with screen size (CSS px), DPR and browsers.', { category: z.enum(['phone', 'foldable', 'tablet', 'laptop', 'desktop', 'custom']).optional() });
  tool('list_sessions', 'Open sessions (yours and the user\'s) with url, state, viewport and issue counts.', {});
  tool('open', 'Open a URL (http://localhost:* works) on one or many devices. Returns session ids. Devices beyond the live limit start as lazy background pages.', {
    url: z.string(), devices,
    state: z.object({ orientation: z.enum(['portrait', 'landscape-left', 'landscape-right', 'portrait-upside-down']).optional(), bars: z.enum(['expanded', 'collapsed', 'pwa']).optional(), colorScheme: z.enum(['light', 'dark']).optional() }).partial().optional(),
  }, async (a) => { const r = await call('open', a); return text(r.map((s: any) => ({ session: s.id, device: s.deviceName, engine: s.engine, viewport: `${s.layout.viewport.w}×${s.layout.viewport.h}`, sharedWith: s.sharedWith }))); });
  tool('navigate', 'Navigate one session (or "all") to a URL.', { session: z.string().default('all'), url: z.string() });
  tool('reload', 'Reload a session or "all" (hard = clear cache).', { session: z.string().default('all'), hard: z.boolean().optional() });
  tool('set_state', 'Change device state: orientation, fold (folded|unfolded|tabletop|book), browserBars → bars (expanded|collapsed|pwa), browser, colorScheme, network (none|fast4g|slow4g|3g|offline), cpu (1|4|6), width (custom viewport width), telegram {enabled, mode: compact|expanded|fullscreen, platform, theme, version}.', {
    session,
    state: z.object({
      orientation: z.enum(['portrait', 'landscape-left', 'landscape-right', 'portrait-upside-down']), fold: z.enum(['folded', 'unfolded', 'tabletop', 'book']),
      bars: z.enum(['expanded', 'collapsed', 'pwa']), browser: z.enum(['safari', 'chrome', 'samsung', 'edge']), colorScheme: z.enum(['light', 'dark']), reducedMotion: z.boolean(),
      network: z.enum(['none', 'fast4g', 'slow4g', '3g', 'offline']), cpu: z.number(), width: z.number().nullable(),
      telegram: z.object({ enabled: z.boolean(), mode: z.enum(['compact', 'expanded', 'fullscreen']), platform: z.enum(['ios', 'android', 'tdesktop', 'macos', 'weba', 'webk']), theme: z.enum(['light', 'dark', 'custom']), version: z.string(), startParam: z.string(), language: z.string() }).partial(),
    }).partial(),
  });
  tool('screenshot', 'Screenshot one device. Returns a downscaled preview image and the full-res PNG path (also shown in the user\'s screenshot tray).', {
    session, fullPage: z.boolean().optional(), framed: z.boolean().optional().describe('Composite the device mockup around it'), background: z.enum(['transparent', 'solid']).optional(), scale: z.enum(['css', 'device']).optional(),
    fast: z.boolean().optional().describe('Bulk mode: plain, CSS scale, no thumbnail. Use for many captures; framed device-scale shots for review.'),
  }, async (a) => imgReply(await call('screenshot', { ...a, preview: true })));
  tool('screenshot_matrix', 'Contact sheet of many devices (framed). Runs sequentially in the background without opening sessions.', {
    url: z.string(), devices: devices.optional(), category: z.string().optional(), fullPage: z.boolean().optional(), framed: z.boolean().optional(),
  }, async (a) => imgReply(await call('screenshot_matrix', { ...a, preview: true })));
  tool('interact', 'tap | longpress | swipe | scroll | type | press | pinch | hover | back | forward | goto, at a CSS selector or x,y (viewport CSS px). Touch devices get real touch events.', {
    session,
    action: z.object({
      type: z.enum(['tap', 'longpress', 'swipe', 'scroll', 'type', 'press', 'pinch', 'hover', 'back', 'forward', 'goto']),
      selector: z.string().optional(), x: z.number().optional(), y: z.number().optional(), x1: z.number().optional(), y1: z.number().optional(), x2: z.number().optional(), y2: z.number().optional(),
      dx: z.number().optional(), dy: z.number().optional(), to: z.union([z.enum(['top', 'bottom']), z.number()]).optional(), text: z.string().optional(), key: z.string().optional(), scale: z.number().optional(), url: z.string().optional(), ms: z.number().optional(),
    }),
  });
  const rules = z.object({
    minTextPx: z.number().describe('Smallest acceptable font size (default 12)'),
    minTapPx: z.number().describe('Smallest acceptable tap area, measured by what a tap actually hits (default 44)'),
    ignore: z.array(z.string()).describe('Selectors to skip, e.g. site shell or decoration: ["header.site-nav", ".bg-art"]'),
    clippedIsIntended: z.boolean().describe('Content cropped by an overflow:hidden container is intended (default true)'),
    disable: z.array(z.string()).describe('Check types to turn off, e.g. ["small-text","image-oversized"]'),
  }).partial();
  tool('audit_layout', 'Layout issues on one device as JSON. Checks: text overlapping text, text cut off with "…", controls/headings partly cut off by an overflow:hidden ancestor, collapsed containers, horizontal overflow, tap targets smaller than minTapPx (by real hit area), text below minTextPx, content under notch / browser bars / home indicator / Telegram UI, overlapping fixed elements, unscaled images, plain 100vh on mobile, Telegram API/version problems. Uses the saved audit_rules for the site; `rules` overrides them for this call.', { session, rules: rules.optional() });
  tool('audit_all', 'Run the layout audit across many devices (sequential, background). Returns issues per device. `rules` as in audit_layout.', { url: z.string(), devices: devices.optional(), rules: rules.optional() });
  tool('audit_rules', 'Get or save audit rules for a site (stored per origin, used by every audit of that site). Pass `rules` to save (merged into existing), `rules: null` to reset to defaults, omit to read.', { target: z.string().describe('A session id or a URL of the site'), rules: rules.nullable().optional() });
  tool('console_logs', 'Console messages (focused device: all levels; others: errors/warnings).', { session, level: z.enum(['log', 'info', 'warning', 'warn', 'error', 'debug']).optional(), text: z.string().optional(), limit: z.number().optional() });
  tool('network_errors', 'Failed requests and HTTP ≥ 400.', { session });
  tool('network_log', 'Request table. filter.type: fetch|xhr|js|css|img|font|doc|ws.', { session, type: z.string().optional(), text: z.string().optional(), limit: z.number().optional() });
  tool('request_detail', 'Headers, payload, response body (fetched on demand) and timing for one request id from network_log.', { session, id: z.number() });
  tool('eval', 'Run JavaScript in the page and return the JSON result. Statements with return/await are wrapped in an async function. Built-in helpers on window.bezels: tap(textOrSelector), waitFor(textOrSelector, ms), find, text, visible, inView, rect, overlap(a, b), sleep(ms), and checkpoint(name) which screenshots + audits the device mid-script (results come back with the eval result). Saved set_helpers code is also available on every page.', { session, js: z.string() });
  const step = z.union([z.string(), z.record(z.string(), z.any())]);
  const steps = z.array(step).describe('Steps, as strings or objects: "tap PLAY DEMO" | "wait PLACE BET" | "wait 500" | "checkpoint result" | "type hello" | "press Enter" | "scroll bottom" | "goto /history" | "hover Menu" | "eval <js>" | {tap:{selector:".start"}} | {wait:{text:"You won",timeout:20000}} | {wait:{gone:"Loading"}} | {type:"42",into:"#bet"} | {state:{orientation:"landscape-left"}}. Text matches visible text (exact first); {selector} forces CSS.');
  tool('run_flow', 'Replay a flow on many devices, one at a time, each in a fresh page: run the steps, and at every checkpoint take a screenshot and run the layout audit. Hot reloads mid-step are retried once. Returns per-device pass/fail, the failing step, issues per checkpoint, one framed contact sheet per checkpoint, and report.html (devices x checkpoints grid, links to images). Pass url+steps, or the name of a saved flow (url/devices/steps override it).', {
    name: z.string().optional(), url: z.string().optional(), devices: devices.optional(), steps: steps.optional(),
    state: z.record(z.string(), z.any()).optional().describe('Device state for every device, e.g. {orientation:"landscape-left"} or {telegram:{enabled:true}}'),
    rules: rules.optional(), timeoutMs: z.number().optional().describe('Per-step timeout, default 15000'),
  }, async (a) => {
    const r: any = await call('run_flow', a);
    const content: any[] = [{ type: 'text', text: JSON.stringify(r, null, 1) }];
    for (const s of (r.sheets ?? []).slice(0, 2)) {
      try { const p = await call('preview', { path: s.path, max: 1400 }); content.push({ type: 'image', data: p.base64, mimeType: 'image/png' }); } catch { /* preview optional */ }
    }
    return { content };
  });
  tool('save_flow', 'Save a flow by name so it can be re-run with run_flow({name}) after every change.', { name: z.string(), url: z.string(), steps, devices: devices.optional(), state: z.record(z.string(), z.any()).optional(), rules: rules.optional(), timeoutMs: z.number().optional() });
  tool('list_flows', 'Saved flows.', {});
  tool('set_helpers', 'Save a helper script for a site (by session id or URL). It runs on every page load of that origin, in every session and flow, so shared functions don\'t have to be pasted into each eval. Pass js: null to remove.', { target: z.string(), js: z.string().nullable() });
  tool('inspect', 'Element at selector (or x,y): box model, computed styles, matching CSS rules with the media/container queries that apply, accessible name. Highlights it on the device.', { session, selector: z.string().optional(), x: z.number().optional(), y: z.number().optional() });
  tool('set_location', 'Emulate geolocation: {lat,lng,accuracy}, a city (Bengaluru, Mumbai, Delhi, London, New York, Tokyo, Sydney…), or unavailable:true. autoTimezone sets timezone+locale from the city.', { session, lat: z.number().optional(), lng: z.number().optional(), accuracy: z.number().optional(), city: z.string().optional(), unavailable: z.boolean().optional(), autoTimezone: z.boolean().optional() });
  tool('set_emulation', 'timezone (IANA), locale (en-IN, hi-IN…), orientation, sensors {alpha,beta,gamma}, permissions {location|camera|microphone|notifications|clipboard: allow|ask|block}, vision (protanopia|deuteranopia|tritanopia|achromatopsia|blurredVision|none), cpu, network, forcedColors, print, touch, idle (active|idle|locked), battery (0–1), userAgent, cacheDisabled, blocked (URL globs).', {
    session, emulation: z.record(z.string(), z.any()),
  });
  tool('network_block', 'Block requests matching URL globs (e.g. "**/*.woff2"). Empty list to clear.', { session, patterns: z.array(z.string()) }, async (a) => text(await call('block_urls', a)));
  tool('perf_metrics', 'Web Vitals (LCP, CLS, INP, TTFB, FCP), long tasks and Chromium metrics (JS heap, nodes, layouts).', { session });
  tool('storage', 'localStorage / sessionStorage / cookies / IndexedDB / Cache Storage. op: list | set | remove | clear | fresh (clear everything + reload).', { session, op: z.enum(['list', 'set', 'remove', 'clear', 'fresh']), area: z.enum(['local', 'session', 'cookies', 'indexedDB', 'cache', 'all']).optional(), key: z.string().optional(), value: z.string().optional() });
  tool('a11y_audit', 'axe-core accessibility audit (incl. colour contrast).', { session });
  tool('telegram_events', 'Every Telegram.WebApp method the Mini App called (with args, unsupported flags) plus current Telegram UI state.', { session });
  tool('telegram_trigger', 'Simulate Telegram: mainButton | secondaryButton | backButton | settingsButton | themeChanged | dragSheet | popup (arg = button id) | qr (arg = text) | activate | deactivate | close | reopen.', { session, what: z.string(), arg: z.string().optional() });
  tool('stats', 'Memory: PSS per engine, Node, total vs budget; live/frozen sessions.', {});
  tool('close', 'Close a session (or "all").', { session: z.string() });

  await server.connect(new StdioServerTransport());
  const bye = async () => { await core?.shutdown(); process.exit(0); };
  process.stdin.on('close', bye);
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

// `node dist/mcp.js` (what `claude mcp add bezels -- node ./dist/mcp.js` runs)
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runMcp().catch((e) => { console.error(e); process.exit(1); });
