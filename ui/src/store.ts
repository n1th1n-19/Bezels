import { useRef, useSyncExternalStore } from 'react';
import type { AuditIssue, ConsoleEntry, Device, NetEntry, SessionInfo, ShotMeta, Stats, TgEvent, TgRuntime } from '../../src/shared/types';
import { call, onEvent } from './rpc';

export interface Catalog { devices: Device[]; sets: Record<string, { label: string; ids: string[] }>; customSets: Record<string, string[]>; favourites: string[]; cities: { name: string; lat: number; lng: number; tz: string; locale: string }[]; botToken: boolean }
export interface Activity { time: number; method: string; summary: string; session?: string }
export type Panel = 'elements' | 'console' | 'network' | 'performance' | 'storage' | 'a11y' | 'audit' | 'telegram';
export type SideTab = 'audit' | 'console' | 'network' | 'telegram';

export interface State {
  ready: boolean;
  catalog: Catalog | null;
  sessions: SessionInfo[];
  focused?: string;
  compare?: string;
  sync: boolean;
  agentPaused: boolean;
  mcpActive: boolean;
  stats: Stats | null;
  keymap: { map: Record<string, string>; defaults: Record<string, string>; conflicts: { duplicates: Record<string, string[]>; reserved: string[] } } | null;
  shots: ShotMeta[];
  activity: Activity[];
  console: Record<string, ConsoleEntry[]>;
  network: Record<string, NetEntry[]>;
  tgEvents: Record<string, TgEvent[]>;
  tgRuntime: Record<string, TgRuntime>;
  audits: Record<string, AuditIssue[]>;
  toast: { text: string; error?: boolean; id: number } | null;
  // UI
  url: string;
  setName: string;
  view: 'single' | 'compare';
  zoom: 'fit' | number;
  fitZoom: number;
  pan: { x: number; y: number };
  devtools: boolean;
  panel: Panel;
  sideTab: SideTab;
  sensors: boolean;
  tray: boolean;
  palette: boolean;
  cheatsheet: boolean;
  settings: boolean;
  memory: boolean;
  limits: boolean;
  activityOpen: boolean;
  customDialog: boolean;
  shotPopover: boolean;
  picker: null | 'location' | 'timezone' | 'emulation' | 'set';
  inspecting: boolean;
  keysToDevice: boolean;
  chord: string | null;
  framed: boolean;
  shotOpts: { fullPage: boolean; background: 'transparent' | 'solid'; scale: 'css' | 'device' };
  inspected: any | null;
  searchFocus: number;
  urlFocus: number;
  busy: string | null;
  /** Full-screen mode: every panel hidden, device fills the window. */
  zen: boolean;
}

const saved = (() => { try { return JSON.parse(localStorage.getItem('bezels.ui') ?? '{}'); } catch { return {}; } })();

let state: State = {
  ready: false, catalog: null, sessions: [], sync: false, agentPaused: false, mcpActive: false, stats: null, keymap: null, shots: [], activity: [],
  console: {}, network: {}, tgEvents: {}, tgRuntime: {}, audits: {}, toast: null,
  url: saved.url ?? 'http://localhost:3000/', setName: saved.setName ?? 'mixed', view: 'single', zoom: 'fit', fitZoom: 0.7, pan: { x: 0, y: 0 },
  devtools: false, panel: 'console', sideTab: 'audit', sensors: false, tray: true, palette: false, cheatsheet: false, settings: false, memory: false, limits: false,
  activityOpen: false, customDialog: false, shotPopover: false, picker: null, inspecting: false, keysToDevice: false, chord: null, framed: saved.framed ?? true,
  shotOpts: saved.shotOpts ?? { fullPage: false, background: 'transparent', scale: 'device' }, inspected: null, searchFocus: 0, urlFocus: 0, busy: null, zen: saved.zen ?? false,
};
const listeners = new Set<() => void>();

export function get() { return state; }
export function set(p: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof p === 'function' ? p(state) : p) };
  listeners.forEach((l) => l());
  try { localStorage.setItem('bezels.ui', JSON.stringify({ url: state.url, setName: state.setName, framed: state.framed, shotOpts: state.shotOpts, zen: state.zen })); } catch { /* storage off */ }
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const shallowEq = (a: unknown, b: unknown) => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  return false;
};
/** Selector hook. Caches per state version so selectors may build new arrays (`?? []`, filter) without render loops. */
export function useStore<T>(sel: (s: State) => T): T {
  const ref = useRef<{ s: State | null; v: T }>({ s: null, v: undefined as T });
  return useSyncExternalStore(subscribe, () => {
    if (ref.current.s !== state) { const v = sel(state); ref.current = { s: state, v: shallowEq(v, ref.current.v) ? ref.current.v : v }; }
    return ref.current.v;
  });
}

let toastId = 0;
export function toast(text: string, error = false) {
  const id = ++toastId;
  set({ toast: { text, error, id } });
  setTimeout(() => { if (get().toast?.id === id) set({ toast: null }); }, error ? 5000 : 2200);
}

/** Run an RPC and surface errors as a toast. */
export async function act<T = any>(method: string, params?: object, busy?: string): Promise<T | undefined> {
  if (busy) set({ busy });
  try { return await call<T>(method, params); }
  catch (e) { toast((e as Error).message, true); return undefined; }
  finally { if (busy) set({ busy: null }); }
}

export const focusedSession = (s: State) => s.sessions.find((x) => x.id === s.focused) ?? s.sessions[0];
export const deviceOf = (s: State, id?: string) => s.catalog?.devices.find((d) => d.id === id);

const capPush = <T,>(arr: T[] | undefined, v: T, cap: number) => { const a = [...(arr ?? []), v]; return a.length > cap ? a.slice(a.length - cap) : a; };

onEvent((event, data) => {
  switch (event) {
    case 'hello':
      { const f = data.sessions.find((x: any) => x.id === data.focused) ?? data.sessions[0]; if (f && !saved.url) state = { ...state, url: f.url }; if (data.sessions.length && !saved.setName) state = { ...state, setName: 'custom' }; }
      set({ ready: true, catalog: data.catalog, sessions: data.sessions, focused: data.focused, compare: data.compare, sync: data.sync, agentPaused: data.agentPaused, stats: data.stats, keymap: data.keymap, shots: data.shots, activity: data.activity, mcpActive: data.mcpActive, audits: data.audits ?? {} });
      break;
    case 'sessions':
      set({ sessions: data.sessions, focused: data.focused, compare: data.compare, sync: data.sync, agentPaused: data.agentPaused });
      break;
    case 'stats': set({ stats: data }); break;
    case 'catalog': set({ catalog: data }); break;
    case 'console': set((s) => ({ console: { ...s.console, [data.session]: capPush(s.console[data.session], data.entry, 1000) } })); break;
    case 'network': set((s) => {
      const list = s.network[data.session] ?? [];
      const i = list.findIndex((e) => e.id === data.entry.id);
      const next = i >= 0 ? list.map((e, j) => (j === i ? data.entry : e)) : capPush(list, data.entry, 500);
      return { network: { ...s.network, [data.session]: next } };
    }); break;
    case 'tg': set((s) => ({ tgEvents: { ...s.tgEvents, [data.session]: capPush(s.tgEvents[data.session], data.event, 500) } })); break;
    case 'tgRuntime': set((s) => ({ tgRuntime: { ...s.tgRuntime, [data.session]: { ...data.runtime } } })); break;
    case 'audit': set((s) => ({ audits: { ...s.audits, [data.session]: data.issues } })); break;
    case 'shot': set((s) => ({ shots: [data, ...s.shots.filter((x) => x.id !== data.id)].slice(0, 60) })); break;
    case 'shots': set({ shots: data }); break;
    case 'activity': set((s) => ({ activity: capPush(s.activity, data, 100), mcpActive: true })); break;
    case 'toast': toast(data.text, data.error); break;
  }
});

/** When the focused session changes, load its DevTools buffers once (afterwards events stream in). */
export async function loadBuffers(session: string) {
  const [c, n, t] = await Promise.all([
    call('console_logs', { session, limit: 1000 }).catch(() => null),
    call('network_log', { session, limit: 500 }).catch(() => null),
    call('telegram_events', { session }).catch(() => null),
  ]);
  set((s) => ({
    console: { ...s.console, [session]: c?.entries ?? [] },
    network: { ...s.network, [session]: n?.entries ?? [] },
    tgEvents: { ...s.tgEvents, [session]: t?.events ?? [] },
    tgRuntime: t?.runtime ? { ...s.tgRuntime, [session]: t.runtime } : s.tgRuntime,
  }));
}
