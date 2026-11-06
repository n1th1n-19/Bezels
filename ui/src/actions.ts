import type { BrowserId, DeviceState, SessionInfo, ShotMeta } from '../../src/shared/types';
import { rotate } from '../../src/shared/layout';
import { COMMANDS, eventToKey } from '../../src/shared/keymap';
import { act, focusedSession, get, set, toast, deviceOf, type Panel } from './store';
import { call } from './rpc';

const mac = /Mac/.test(navigator.platform);
const cur = () => focusedSession(get());

type Patch = Partial<Omit<DeviceState, 'telegram' | 'emulation'>> & { telegram?: Partial<DeviceState['telegram']>; emulation?: Partial<DeviceState['emulation']> };
export const setState = (patch: Patch, session = cur()?.id) => session && act('set_state', { session, state: patch });
export const setEmulation = (e: Record<string, unknown>, session = cur()?.id) => session && act('set_emulation', { session, emulation: e });

// ---------- sets & devices ----------
export function setIds(name: string): string[] {
  const s = get();
  return s.catalog?.sets[name]?.ids ?? s.catalog?.customSets[name] ?? [];
}

/** Set changes run one at a time and diff against the server's session list (never the possibly-stale local copy). */
let setQueue: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>) => (setQueue = setQueue.then(fn, fn)) as Promise<T>;

/** Replace the UI's device set. Sessions opened by Claude Code stay. */
export function openSet(name: string) {
  set({ setName: name, picker: null });
  return serial(async () => {
    const ids = setIds(name);
    const live = (await call<SessionInfo[]>('list_sessions').catch(() => [])) ?? [];
    for (const x of live) if (x.source === 'ui' && !ids.includes(x.deviceId)) await act('close', { session: x.id });
    const have = new Set(live.filter((x) => ids.includes(x.deviceId) || x.source !== 'ui').map((x) => x.deviceId));
    const missing = ids.filter((d) => !have.has(d));
    if (missing.length) await act('open', { url: get().url, devices: missing }, `Opening ${missing.length} device(s)…`);
    const first = (await call<SessionInfo[]>('list_sessions').catch(() => [])).find((x) => x.deviceId === ids[0]);
    if (first) await act('focus', { session: first.id, compare: null });
  });
}

/** URL bar: navigate what's open, or open the current set if nothing is. */
export function goUrl(url: string) {
  set({ url });
  return serial(async () => {
    const live = (await call<SessionInfo[]>('list_sessions').catch(() => [])) ?? [];
    if (live.length) await act('navigate', { session: 'all', url });
  }).then(() => { if (!get().sessions.length) openSet(get().setName === 'custom' ? 'mixed' : get().setName); });
}

export function toggleDevice(id: string) {
  set({ setName: 'custom' });
  return serial(async () => {
    const live = (await call<SessionInfo[]>('list_sessions').catch(() => [])) ?? [];
    const ex = live.find((x) => x.deviceId === id);
    if (ex) await act('close', { session: ex.id });
    else { const r = await act<any[]>('open', { url: get().url, devices: [id] }); if (r?.[0]) await act('focus', { session: r[0].id }); }
  });
}

export const focusSession = (id: string) => { set({ focused: id }); return act('focus', { session: id, compare: get().view === 'compare' ? get().compare ?? null : null }); };

function step(dir: 1 | -1) {
  const s = get();
  if (!s.sessions.length) return;
  const i = Math.max(0, s.sessions.findIndex((x) => x.id === s.focused));
  focusSession(s.sessions[(i + dir + s.sessions.length) % s.sessions.length]!.id);
}
function stepCompare(dir: 1 | -1) {
  const s = get();
  const others = s.sessions.filter((x) => x.id !== s.focused);
  if (!others.length) return;
  const i = others.findIndex((x) => x.id === s.compare);
  const next = others[(i + dir + others.length) % others.length]!;
  set({ view: 'compare' });
  act('focus', { session: s.focused, compare: next.id });
}
export function toggleCompare() {
  const s = get();
  if (s.view === 'compare') { set({ view: 'single' }); act('focus', { session: s.focused, compare: null }); return; }
  const other = s.sessions.find((x) => x.id !== s.focused);
  if (!other) { toast('Add a second device to compare'); return; }
  set({ view: 'compare' });
  act('focus', { session: s.focused, compare: s.compare && s.compare !== s.focused ? s.compare : other.id });
}

// ---------- screenshots ----------
async function capture(fullPage?: boolean): Promise<ShotMeta | undefined> {
  const s = get(), f = cur();
  if (!f) return;
  const o = s.shotOpts;
  return act<ShotMeta>('screenshot', { session: f.id, framed: s.framed, fullPage: fullPage ?? o.fullPage, background: o.background, scale: o.scale }, 'Capturing…');
}

/** Copy a PNG: ClipboardItem with a promise keeps the user gesture alive while the capture runs. Falls back to download. */
export async function copyImage(produce: () => Promise<ShotMeta | undefined>, label?: string) {
  let meta: ShotMeta | undefined;
  const blob = produce().then(async (m) => { meta = m; if (!m) throw new Error('capture failed'); return (await fetch(`/shots/${encodeURIComponent(m.file)}`)).blob(); });
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast(`${label ?? meta?.label ?? 'Screenshot'} copied to clipboard`);
  } catch (e) {
    const m = meta ?? (await blob.then(() => meta, () => undefined));
    if (!m) { if ((e as Error).message !== 'capture failed') toast((e as Error).message, true); return; }
    download(m);
    toast('Clipboard refused, saved PNG instead');
  }
}
export function download(m: ShotMeta) {
  const a = document.createElement('a');
  a.href = `/shots/${encodeURIComponent(m.file)}?download`;
  a.download = m.file;
  a.click();
}
export const copyShotMeta = (m: ShotMeta) => copyImage(async () => m, m.label);

// ---------- commands ----------
const cycle = <T,>(list: T[], v: T) => list[(list.indexOf(v) + 1) % list.length]!;
const openPanel = (panel: Panel) => set({ devtools: true, panel });

export const RUN: Record<string, () => unknown> = {
  palette: () => set((s) => ({ palette: !s.palette })),
  cheatsheet: () => set((s) => ({ cheatsheet: !s.cheatsheet })),
  focusUrl: () => set((s) => ({ urlFocus: s.urlFocus + 1 })),
  reload: () => cur() && act('reload', { session: cur()!.id }),
  hardReloadAll: () => act('reload', { session: 'all', hard: true }).then(() => toast('Hard-reloaded all devices')),
  keysToDevice: () => cur() && set({ keysToDevice: true }),
  settings: () => set({ settings: true }),
  memory: () => set((s) => ({ memory: !s.memory })),
  limits: () => set((s) => ({ limits: !s.limits })),
  prevDevice: () => step(-1),
  nextDevice: () => step(1),
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`device${i + 1}`, () => { const x = get().sessions[i]; if (x) focusSession(x.id); }])),
  searchDevices: () => set((s) => ({ searchFocus: s.searchFocus + 1 })),
  switchSet: () => set({ picker: 'set' }),
  toggleCompare,
  comparePrev: () => stepCompare(-1),
  compareNext: () => stepCompare(1),
  toggleSync: () => act('sync', { on: !get().sync }).then(() => toast(get().sync ? 'Sync scroll & navigation on' : 'Sync off')),
  zoomIn: () => set((s) => ({ zoom: Math.min(2, +((s.zoom === 'fit' ? s.fitZoom : s.zoom) + 0.1).toFixed(2)) })),
  zoomOut: () => set((s) => ({ zoom: Math.max(0.15, +((s.zoom === 'fit' ? s.fitZoom : s.zoom) - 0.1).toFixed(2)) })),
  zoomFit: () => set({ zoom: 'fit', pan: { x: 0, y: 0 } }),
  customDevice: () => set({ customDialog: true }),
  rotateCw: () => { const f = cur(); if (f) setState({ orientation: rotate(f.state.orientation, 1) }); },
  rotateCcw: () => { const f = cur(); if (f) setState({ orientation: rotate(f.state.orientation, -1) }); },
  fold: () => { const f = cur(); const d = deviceOf(get(), f?.deviceId); if (!d?.fold) return toast(`${d?.name ?? 'Device'} doesn't fold`); setState({ fold: f!.state.fold === 'folded' ? 'unfolded' : 'folded' }); },
  halfOpen: () => { const f = cur(); const d = deviceOf(get(), f?.deviceId); if (!d?.fold) return toast(`${d?.name ?? 'Device'} doesn't fold`); setState({ fold: f!.state.fold === 'tabletop' ? 'book' : f!.state.fold === 'book' ? 'unfolded' : d.fold.hinge.orientation === 'horizontal' ? 'tabletop' : 'book' }); },
  bars: () => { const f = cur(); if (f) setState({ bars: cycle(['expanded', 'collapsed', 'pwa'] as const, f.state.bars) }); },
  switchBrowser: () => { const f = cur(); const d = deviceOf(get(), f?.deviceId); if (!f || !d) return; if (d.browsers.length < 2) return toast(`${d.name} only has ${d.browsers[0]}`); setState({ browser: cycle(d.browsers, f.state.browser) as BrowserId }); },
  theme: () => { const f = cur(); if (f) setState({ colorScheme: f.state.colorScheme === 'dark' ? 'light' : 'dark', ...(f.state.telegram.enabled ? { telegram: { theme: f.state.colorScheme === 'dark' ? 'light' : 'dark' } } : {}) }); },
  telegram: () => { const f = cur(); if (f) setState({ telegram: { enabled: !f.state.telegram.enabled } }); },
  tgCompact: () => setState({ telegram: { enabled: true, mode: 'compact' } }),
  tgExpanded: () => setState({ telegram: { enabled: true, mode: 'expanded' } }),
  tgFullscreen: () => setState({ telegram: { enabled: true, mode: 'fullscreen' } }),
  tgBack: () => cur() && act('telegram_trigger', { session: cur()!.id, what: 'backButton' }),
  copyShot: () => copyImage(() => capture()),
  copyFullShot: () => copyImage(() => capture(true)),
  toggleFramed: () => { set((s) => ({ framed: !s.framed })); toast(get().framed ? 'Next capture: framed' : 'Next capture: plain'); },
  saveShot: async () => { const m = await capture(); if (m) { download(m); toast(`Saved ${m.file}`); } },
  captureAll: () => copyImage(() => act<ShotMeta>('capture_all', { background: get().shotOpts.background }, 'Capturing all devices…'), 'Contact sheet'),
  tray: () => set((s) => ({ tray: !s.tray })),
  shotOptions: () => set((s) => ({ shotPopover: !s.shotPopover })),
  devtools: () => set((s) => ({ devtools: !s.devtools })),
  inspect: () => { set((s) => ({ inspecting: !s.inspecting, devtools: true, panel: 'elements' })); },
  panelElements: () => openPanel('elements'),
  panelConsole: () => openPanel('console'),
  panelNetwork: () => openPanel('network'),
  panelPerformance: () => openPanel('performance'),
  panelStorage: () => openPanel('storage'),
  panelA11y: () => openPanel('a11y'),
  panelAudit: () => openPanel('audit'),
  panelTelegram: () => openPanel('telegram'),
  clearPanel: () => {
    const f = cur(); if (!f) return;
    const panel = get().devtools ? get().panel : get().sideTab;
    const which = panel === 'network' ? 'network' : 'console';
    act('console_clear', { session: f.id, panel: which });
    set((s) => (which === 'network' ? { network: { ...s.network, [f.id]: [] } } : { console: { ...s.console, [f.id]: [] } }));
  },
  cycleNetwork: () => { const f = cur(); if (!f) return; const n = cycle(['none', 'fast4g', 'slow4g', '3g'] as const, f.state.network === 'offline' || f.state.network === 'custom' ? 'none' : f.state.network); setState({ network: n }); toast(`Network: ${({ none: 'no throttling', fast4g: 'Fast 4G', slow4g: 'Slow 4G', '3g': '3G' })[n]}`); },
  offline: () => { const f = cur(); if (f) setState({ network: f.state.network === 'offline' ? 'none' : 'offline' }); },
  cycleCpu: () => { const f = cur(); if (!f) return; const c = cycle([1, 4, 6], f.state.cpu); setState({ cpu: c }); toast(c === 1 ? 'CPU: no throttling' : `CPU: ${c}× slowdown`); },
  audit: async () => { const f = cur(); if (!f) return; set({ sideTab: 'audit' }); await act('audit_layout', { session: f.id }, 'Auditing…'); },
  auditAll: async () => { set({ sideTab: 'audit' }); const r = await act<any[]>('audit_all', {}, 'Auditing the whole set (one at a time)…'); if (r) toast(`Audited ${r.length} devices`); },
  freshVisit: () => cur() && act('storage', { session: cur()!.id, op: 'fresh' }).then(() => toast('Fresh visit: storage cleared, reloaded')),
  sensors: () => set((s) => ({ sensors: !s.sensors })),
  locationPicker: () => set({ picker: 'location', sensors: true }),
  tzPicker: () => set({ picker: 'timezone', sensors: true }),
  shake: () => cur() && act('shake', { session: cur()!.id }).then(() => toast('Shake sent')),
  emulationMenu: () => set({ picker: 'emulation', sensors: true }),
  activity: () => set((s) => ({ activityOpen: !s.activityOpen })),
  pauseAgent: () => act('pause_agent', { on: !get().agentPaused }).then(() => toast(get().agentPaused ? 'Claude Code control paused' : 'Claude Code control resumed')),
};

export const commandList = () => COMMANDS.map((c) => ({ ...c, key: get().keymap?.map[c.id] ?? c.key }));

// ---------- keyboard ----------
let chordTimer: number | undefined;
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function onKeyDown(e: KeyboardEvent) {
  const s = get();
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  const key = eventToKey(e, mac);
  const map = s.keymap?.map ?? {};
  const byKey = (k: string) => Object.keys(map).find((id) => map[id] === k);

  // Keys → device: everything goes to the page except Esc.
  if (s.keysToDevice) {
    e.preventDefault();
    if (e.key === 'Escape') { set({ keysToDevice: false }); return; }
    const f = cur(); if (!f) return;
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.metaKey && 'Meta', e.shiftKey && !printable && 'Shift'].filter(Boolean).join('+');
    call('interact', { session: f.id, action: printable ? { type: 'type', text: e.key } : { type: 'press', key: mods ? `${mods}+${e.key}` : e.key } }).catch(() => {});
    return;
  }
  if (e.key === 'Escape') {
    if (s.palette || s.cheatsheet || s.settings || s.memory || s.limits || s.customDialog || s.picker || s.shotPopover || s.activityOpen || s.inspecting) {
      set({ palette: false, cheatsheet: false, settings: false, memory: false, limits: false, customDialog: false, picker: null, shotPopover: false, activityOpen: false, inspecting: false });
      e.preventDefault();
    } else if (typing(e.target)) (e.target as HTMLElement).blur();
    return;
  }
  if (key === map.palette) { e.preventDefault(); RUN.palette!(); return; }
  if (key === map.settings) { e.preventDefault(); RUN.settings!(); return; }
  if (typing(e.target) || s.palette || s.settings || s.customDialog) return;

  if (s.chord) {
    clearTimeout(chordTimer);
    const id = byKey(`${s.chord} ${e.key.toLowerCase()}`);
    set({ chord: null });
    if (id) { e.preventDefault(); RUN[id]?.(); }
    return;
  }
  const isChordStart = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && Object.values(map).some((k) => k.startsWith(e.key.toLowerCase() + ' '));
  if (isChordStart && !byKey(key)) {
    e.preventDefault();
    set({ chord: e.key.toLowerCase() });
    chordTimer = window.setTimeout(() => set({ chord: null }), 1000);
    return;
  }
  const id = byKey(key);
  if (id && RUN[id]) { e.preventDefault(); RUN[id]!(); }
}
