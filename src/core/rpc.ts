import type { Core, Source } from './core.js';
import { CITIES, LOCALES } from './core.js';
import type { Action } from './host.js';

/**
 * One method table for every front door (UI over WebSocket, MCP, CLI, HTTP).
 * "Everything the MCP tools can do must also be doable from the UI" falls out of this for free.
 */
type Handler = (core: Core, p: any, source: Source) => Promise<unknown> | unknown;

const READ_ONLY = new Set(['list_devices', 'list_sessions', 'catalog', 'console_logs', 'network_errors', 'network_log', 'request_detail', 'stats', 'telegram_events', 'activity', 'shots', 'keymap_get', 'config_get', 'mcp_hello', 'perf_metrics', 'breakpoints', 'dom_tree']);

export const METHODS: Record<string, Handler> = {
  // catalog & sessions
  list_devices: (c, p) => c.allDevices().filter((d) => !p?.category || d.category === p.category).map((d) => ({ id: d.id, name: d.name, category: d.category, os: d.os, screen: `${d.screen.w}×${d.screen.h}`, dpr: d.dpr, browsers: d.browsers, fold: d.fold ? `${d.fold.foldedScreen.w}×${d.fold.foldedScreen.h} / ${d.fold.unfoldedScreen.w}×${d.fold.unfoldedScreen.h}` : undefined })),
  catalog: (c) => c.catalog(),
  list_sessions: (c) => c.list(),
  open: (c, p, src) => c.open(p.url, p.devices, src, p.state),
  close: (c, p) => (p.session === 'all' ? c.closeAll() : c.close(p.session)),
  focus: (c, p) => c.focus(p.session, p.compare),
  navigate: (c, p) => c.navigate(p.session ?? 'all', p.url),
  reload: (c, p) => c.reload(p.session ?? 'all', !!p.hard),
  set_state: (c, p) => c.setState(p.session, p.state ?? {}),

  // capture
  screenshot: async (c, p, src) => {
    const m = await c.screenshot(p.session, { fullPage: p.fullPage, framed: p.framed, background: p.background, scale: p.scale, source: src });
    return p.preview ? { ...m, preview: (await c.preview(m.path, p.previewMax ?? 768)).toString('base64') } : m;
  },
  screenshot_matrix: async (c, p, src) => {
    const m = await c.screenshotMatrix(p.url, p.devices ?? p.category ?? 'phones', { fullPage: p.fullPage, framed: p.framed, background: p.background, source: src });
    return p.preview ? { ...m, preview: (await c.preview(m.path, p.previewMax ?? 1200)).toString('base64') } : m;
  },
  capture_all: (c, p, src) => c.captureAll(p.sessions, { background: p.background, source: src }),
  shots: (c, p) => c.shots.list(p?.limit ?? 60),
  shot_delete: (c, p) => c.deleteShot(p.id),
  shot_copy: (c, p) => c.copyShot(p.id),
  /** Global shortcut (Tauri Ctrl+Alt+C): screenshot the focused device straight to the OS clipboard. */
  copy_focused: async (c, p, src) => { if (!c.focused) throw new Error('No device focused'); const m = await c.screenshot(c.focused, { framed: p.framed ?? true, source: src }); return c.copyShot(m.id); },

  // input
  interact: (c, p) => c.input(p.session, p.action as Action),

  // audits
  audit_layout: (c, p) => c.audit(p.session),
  audit_all: (c, p) => c.auditAll(p.url, p.devices, p.sessions),

  // devtools
  console_logs: (c, p) => c.consoleLogs(p.session, p),
  network_errors: (c, p) => c.networkLog(p.session, { failedOnly: true }),
  network_log: (c, p) => c.networkLog(p.session, p.filter ?? p),
  request_detail: (c, p) => c.requestDetail(p.session, Number(p.id)),
  har: (c, p) => c.har(p.session),
  resolve_source: (c, p) => c.resolveSource(p.session, Number(p.id)),
  console_preserve: (c, p) => { c.get(p.session).host.preserveLog = !!p.on; return { preserve: !!p.on }; },
  console_clear: (c, p) => { const h = c.get(p.session).host; if (p.panel === 'network') { h.net = []; h.reqs.clear(); } else h.console = []; return { cleared: true }; },
  eval: (c, p) => c.evaluate(p.session, p.js),
  perf_metrics: (c, p) => c.perf(p.session),
  show_layout_shifts: (c, p) => c.showShifts(p.session),
  storage: (c, p) => c.storage(p.session, p),
  a11y_audit: (c, p) => c.a11y(p.session),
  tab_order: (c, p) => c.tabOrder(p.session, p.show !== false),
  inspect: (c, p) => c.inspect(p.session, p),
  dom_tree: (c, p) => c.domTree(p.session, p),
  highlight: (c, p) => c.highlight(p.session, p.items ?? [{ selector: p.selector, rect: p.rect, label: p.label }], p.ms),
  breakpoints: (c, p) => c.breakpoints(p.session),
  block_urls: (c, p) => c.setState(p.session, { emulation: { blocked: p.patterns ?? [] } }),

  // sensors
  set_location: (c, p) => c.setLocation(p.session, p.location ?? (p.city ? { city: p.city } : p.unavailable ? 'unavailable' : { lat: p.lat, lng: p.lng, accuracy: p.accuracy }), !!p.autoTimezone),
  set_emulation: (c, p) => c.setEmulation(p.session, p.emulation ?? p),
  shake: (c, p) => c.shake(p.session),
  cities: () => ({ cities: CITIES, locales: LOCALES }),

  // telegram
  telegram_events: (c, p) => c.tgEvents(p.session),
  telegram_trigger: (c, p) => c.tgTrigger(p.session, p.what, p.arg),

  // app
  stats: (c) => c.stats(),
  sync: (c, p) => c.setSync(!!p.on),
  pause_agent: (c, p) => c.pause(!!p.on),
  activity: (c) => c.activity.slice(-100),
  watch: (c, p) => c.watch(p.dir ?? null),
  save_custom_device: (c, p) => c.saveCustom(p),
  delete_custom_device: (c, p) => c.deleteCustom(p.id),
  config_get: (c) => c.cfg,
  config_set: (c, p) => c.setConfig(p),
  keymap_get: (c) => c.keymap(),
  keymap_set: (c, p) => c.setKeymap(p.map),
  mcp_hello: (c) => { c.lastMcp = Date.now(); c.broadcastSessions(); return { ok: true }; },
};

export async function dispatch(core: Core, method: string, params: any, source: Source): Promise<unknown> {
  const fn = METHODS[method];
  if (!fn) throw new Error(`Unknown method ${method}`);
  if (source === 'mcp') {
    if (core.agentPaused && !READ_ONLY.has(method)) throw new Error('Claude Code control is paused by the user in Bezels (Shift+K to resume). Read-only tools still work.');
    if (method !== 'mcp_hello') core.logActivity(method, params);
  }
  return fn(core, params ?? {}, source);
}
