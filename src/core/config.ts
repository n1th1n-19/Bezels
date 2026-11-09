import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Device } from '../shared/types.js';

export const CONFIG_DIR = process.env.BEZELS_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'bezels');

export interface Config {
  port: number;
  maxMemoryMB: number;
  /** Max devices streaming live at once. */
  maxLive: number;
  /** Close a background page after this long without use. */
  idleCloseMs: number;
  /** Shut an engine down after this long with no contexts. */
  engineIdleMs: number;
  shotsDir: string;
  screencastFps: number;
  /** Optional Telegram *test* bot token used to sign initData. Read from env / .env, never saved. */
  favourites: string[];
  sets: Record<string, string[]>;
}

/** Screenshots go to the user cache, not whatever project the command runs in. */
function defaultShotsDir() {
  const base = process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches') : process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')) : (process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'));
  return join(base, 'bezels', 'shots');
}

const DEFAULTS: Config = {
  port: 4477, maxMemoryMB: 1000, maxLive: 2, idleCloseMs: 5 * 60_000, engineIdleMs: 3 * 60_000,
  shotsDir: defaultShotsDir(), screencastFps: 15, favourites: ['iphone-16-pro', 'pixel-9', 'galaxy-z-fold-6', 'ipad-mini', 'laptop-1366'],
  sets: { mixed: ['iphone-16-pro', 'pixel-9', 'galaxy-z-fold-6', 'ipad-mini', 'laptop-1366'] },
};

function readJson<T>(file: string, fallback: T): T {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback; } catch { return fallback; }
}
function writeJson(file: string, data: unknown) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

export function loadConfig(): Config {
  const c = { ...DEFAULTS, ...readJson<Partial<Config>>(join(CONFIG_DIR, 'config.json'), {}) };
  if (process.env.BEZELS_PORT) c.port = Number(process.env.BEZELS_PORT);
  if (process.env.BEZELS_MAX_MEMORY_MB) c.maxMemoryMB = Number(process.env.BEZELS_MAX_MEMORY_MB);
  c.shotsDir = resolve(process.env.BEZELS_SHOTS_DIR ?? c.shotsDir);
  return c;
}
export function saveConfig(c: Partial<Config>) {
  const cur = readJson<Partial<Config>>(join(CONFIG_DIR, 'config.json'), {});
  writeJson(join(CONFIG_DIR, 'config.json'), { ...cur, ...c });
}

export const loadKeymap = () => readJson<Record<string, string>>(join(CONFIG_DIR, 'keymap.json'), {});
export const saveKeymap = (m: Record<string, string>) => writeJson(join(CONFIG_DIR, 'keymap.json'), m);
export const loadCustomDevices = () => readJson<Device[]>(join(CONFIG_DIR, 'custom-devices.json'), []);
export const saveCustomDevices = (d: Device[]) => writeJson(join(CONFIG_DIR, 'custom-devices.json'), d);

/** Minimal .env reader (cwd), only for BEZELS_TG_BOT_TOKEN. */
export function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(resolve('.env'), 'utf8').split('\n').find((l) => l.startsWith(name + '='));
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
  } catch { return undefined; }
}

/** Audit rules per site origin (e.g. "http://localhost:3000"), set with the audit_rules tool or Settings. */
export const loadAuditRules = () => readJson<Record<string, Record<string, unknown>>>(join(CONFIG_DIR, 'audit-rules.json'), {});
export const saveAuditRules = (r: Record<string, Record<string, unknown>>) => writeJson(join(CONFIG_DIR, 'audit-rules.json'), r);

/** Helper scripts per site origin, injected on every page load (set_helpers). */
export const loadHelpers = () => readJson<Record<string, string>>(join(CONFIG_DIR, 'helpers.json'), {});
export const saveHelpers = (h: Record<string, string>) => writeJson(join(CONFIG_DIR, 'helpers.json'), h);
/** Saved flows by name (save_flow / run_flow). */
export const loadFlows = () => readJson<Record<string, unknown>>(join(CONFIG_DIR, 'flows.json'), {});
export const saveFlows = (f: Record<string, unknown>) => writeJson(join(CONFIG_DIR, 'flows.json'), f);
