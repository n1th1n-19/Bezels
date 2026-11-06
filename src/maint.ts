/**
 * bezels update | uninstall | cleanup | stop
 * Each command shows exactly what it will touch (with sizes) before doing anything.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, readdirSync, rmSync, statSync, lstatSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { CONFIG_DIR, loadConfig } from './core/config.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED = resolve(process.env.BEZELS_DIR ?? join(homedir(), '.bezels'));
const LAUNCHER = join(homedir(), '.local', 'bin', 'bezels');
const PW_CACHE = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.platform === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright') : process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright') : join(homedir(), '.cache/ms-playwright'));
const TEMP_DIRS = [join(tmpdir(), 'bezels-snapshots'), join(tmpdir(), 'bezels-tmp'), join(tmpdir(), 'bezels-bench-shots')];
const PW_CLI = join(ROOT, 'node_modules', 'playwright', 'cli.js');

// ---------- terminal helpers ----------
const tty = process.stdout.isTTY;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const b = c('1'), d = c('2'), g = c('32'), y = c('33'), r = c('31'), cy = c('36');
const ok = (s: string) => console.log(`  ${g('✓')} ${s}`);
const warn = (s: string) => console.log(`  ${y('!')} ${s}`);

export interface Opts { yes: boolean; dryRun: boolean; all: boolean; keepConfig: boolean; olderThan: number; force: boolean; check: boolean }

/** Per-item question. --yes accepts the default; items that default to "no" (user data) need --all. */
async function ask(o: Opts, q: string, def: boolean): Promise<boolean> {
  if (o.yes) return def || o.all;
  if (o.dryRun) return def;
  if (!process.stdin.isTTY) return false; // non-interactive without --yes: change nothing
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${q} ${d(def ? '[Y/n]' : '[y/N]')} `)).trim();
  rl.close();
  return a ? /^y/i.test(a) : def;
}

/** Top-level "go ahead?": --yes means yes. */
async function confirm(o: Opts, q: string, def: boolean): Promise<boolean> {
  if (o.yes) return true;
  if (!process.stdin.isTTY) { console.log(d('Not a terminal: pass --yes to proceed.')); return false; }
  return ask({ ...o, yes: false }, q, def);
}

function size(p: string): number {
  try {
    const st = lstatSync(p);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const e of readdirSync(p)) n += size(join(p, e));
    return n;
  } catch { return 0; }
}
const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} kB` : `${n} B`);

let step = 0, total = 0;
const log = (() => { const f = join(mkdtempSync(join(tmpdir(), 'bezels-maint-')), 'log.txt'); return { file: f, stream: createWriteStream(f) }; })();

/** Run a command with a spinner and its last output line (download %, etc.). */
function run(label: string, cmd: string, args: string[], cwd = ROOT): Promise<void> {
  step++;
  const t0 = Date.now();
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let last = '';
    const onData = (buf: Buffer) => { log.stream.write(buf); const l = buf.toString().split(/[\r\n]/).map((s) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()).filter(Boolean).pop(); if (l) last = l.slice(0, 60); };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'; let i = 0;
    const tick = tty ? setInterval(() => process.stdout.write(`\r\x1b[K  ${cy(frames[i++ % 10]!)} ${b(`[${step}/${total}]`)} ${label} ${d(`${Math.round((Date.now() - t0) / 1000)}s  ${last}`)}`), 120) : undefined;
    p.on('error', (e) => { clearInterval(tick); rej(e); });
    p.on('close', (code) => {
      clearInterval(tick);
      if (tty) process.stdout.write('\r\x1b[K');
      const secs = Math.round((Date.now() - t0) / 1000);
      if (code === 0) { console.log(`  ${g('✓')} ${b(`[${step}/${total}]`)} ${label} ${d(`(${secs}s)`)}`); res(); }
      else { console.log(`  ${r('✗')} ${b(`[${step}/${total}]`)} ${label}\n${d(`--- last lines of ${log.file} ---`)}`); try { console.log(readFileSync(log.file, 'utf8').split('\n').slice(-20).join('\n')); } catch { /* */ } rej(new Error(`${label} failed`)); }
    });
  });
}
function doStep(label: string, fn: () => void) { step++; fn(); ok(`${b(`[${step}/${total}]`)} ${label}`); }

const git = (...a: string[]) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' });
const plan = (rows: [string, string, string?][]) => { for (const [what, where, note] of rows) console.log(`  • ${what.padEnd(26)} ${where}${note ? ' ' + d(note) : ''}`); };

// ---------- running daemon ----------
async function daemon(): Promise<{ pid: number; port: number } | null> {
  const port = loadConfig().port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
    const j = await r.json();
    return j?.name === 'bezels' ? { pid: j.pid, port } : null;
  } catch { return null; }
}

export async function stop(quiet = false): Promise<boolean> {
  const dm = await daemon();
  if (!dm) { if (!quiet) console.log('Bezels is not running.'); return false; }
  try { process.kill(dm.pid, 'SIGTERM'); } catch (e) { throw new Error(`Couldn't stop pid ${dm.pid}: ${(e as Error).message}`); }
  for (let i = 0; i < 50 && (await daemon()); i++) await new Promise((r) => setTimeout(r, 100));
  if (!quiet) ok(`Stopped Bezels (pid ${dm.pid}, port ${dm.port})`);
  return true;
}

// ---------- update ----------
export async function update(o: Opts) {
  console.log(`\n${b('bezels update')} ${d(ROOT)}\n`);
  if (!existsSync(join(ROOT, '.git'))) {
    console.log(`Not a git install. If you installed from npm: ${cy('npm i -g bezels@latest')}`);
    return;
  }
  const dirty = git('status', '--porcelain', '--untracked-files=no').stdout.trim();
  if (dirty && !o.force && !o.check) throw new Error(`Local changes in ${ROOT}:\n${dirty}\nCommit/stash them, or run with --force to update anyway (git pull will refuse conflicts).`);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  if (tty) process.stdout.write(`  ${d('checking for updates…')}`);
  const f = git('fetch', '--quiet');
  if (tty) process.stdout.write('\r\x1b[K');
  if (f.status !== 0) throw new Error(`git fetch failed: ${f.stderr.trim()}`);
  const behind = Number(git('rev-list', '--count', 'HEAD..@{u}').stdout.trim() || 0);
  const current = git('log', '-1', '--format=%h %s').stdout.trim();
  console.log(`  current   ${current}  ${d(`(${branch})`)}`);
  if (!behind) { ok('Already up to date.'); return; }
  const changes = git('log', '--format=%h %s', 'HEAD..@{u}').stdout.trim().split('\n');
  console.log(`  ${y(`${behind} new commit${behind === 1 ? '' : 's'}:`)}`);
  for (const l of changes.slice(0, 15)) console.log(`    ${l}`);
  if (changes.length > 15) console.log(d(`    … +${changes.length - 15} more`));
  if (o.check) return;

  const lockHash = () => { try { return createHash('sha1').update(readFileSync(join(ROOT, 'package-lock.json'))).digest('hex'); } catch { return ''; } };
  const before = lockHash();
  const dm = await daemon();
  console.log(`\n${b('This will')}`);
  plan([
    ...(dm ? [['Stop the running Bezels', `pid ${dm.pid}`, 'npm packages are replaced while it runs'] as [string, string, string]] : []),
    ['git pull --ff-only', branch],
    ['npm ci', 'if package-lock.json changed'],
    ['Playwright browsers', 'install new revisions, remove unused old ones'],
    ['Build', 'dist/ + ui/dist'],
  ]);
  console.log('');
  if (o.dryRun) { console.log(d('(dry run: nothing changed)')); return; }
  if (!(await confirm(o, 'Update now?', true))) { console.log('Cancelled.'); return; }

  const webkit = existsSync(PW_CACHE) && readdirSync(PW_CACHE).some((n) => n.startsWith('webkit-'));
  total = 4 + (dm ? 1 : 0);
  if (dm) { await stop(true); doStep('Stopped running Bezels', () => {}); }
  await run('Pulling changes', 'git', ['pull', '--ff-only']);
  if (lockHash() !== before) await run('Installing npm packages', 'npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error']);
  else doStep('npm packages unchanged', () => {});
  // `playwright install` also garbage-collects browser revisions no installation uses any more.
  await run('Updating browsers', process.execPath, [PW_CLI, 'install', 'chromium', ...(webkit ? ['webkit'] : [])]);
  await run('Building', 'npm', ['run', 'build']);
  console.log(`\n${g(b('Updated'))} to ${git('log', '-1', '--format=%h %s').stdout.trim()}`);
  if (dm) console.log(`  Start it again: ${cy('bezels serve')}  ${d('(Claude Code restarts the MCP server on its own)')}`);
  console.log('');
}

// ---------- uninstall ----------
function mcpRegistered(): boolean {
  const r = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8', timeout: 20_000 });
  return r.status === 0 && /^bezels\b/m.test(r.stdout);
}
function launcherIsOurs(): boolean {
  try { return readFileSync(LAUNCHER, 'utf8').includes(ROOT); } catch { return false; }
}

export async function uninstall(o: Opts) {
  console.log(`\n${b('bezels uninstall')}\n`);
  const managed = ROOT === MANAGED;
  const cfg = loadConfig();
  const shots = existsSync(cfg.shotsDir) ? cfg.shotsDir : null;
  const hasClaude = spawnSync('claude', ['--version'], { timeout: 10_000 }).status === 0;
  const mcp = hasClaude && mcpRegistered();
  const temps = TEMP_DIRS.filter(existsSync);
  const dm = await daemon();

  type Item = { what: string; where: string; bytes?: number; note?: string; ask?: string; def: boolean; act: () => Promise<void> | void };
  const items: Item[] = [];
  if (dm) items.push({ what: 'Running Bezels', where: `pid ${dm.pid}`, def: true, act: async () => { await stop(true); } });
  if (mcp) items.push({ what: 'Claude Code MCP server', where: 'bezels', def: true, act: () => { for (const s of ['user', 'local', 'project']) spawnSync('claude', ['mcp', 'remove', 'bezels', '-s', s], { stdio: 'ignore' }); } });
  if (launcherIsOurs()) items.push({ what: 'Command', where: LAUNCHER, bytes: size(LAUNCHER), def: true, act: () => rmSync(LAUNCHER, { force: true }) });
  if (temps.length) items.push({ what: 'Temp files', where: temps.join(', '), bytes: temps.reduce((a, t) => a + size(t), 0), def: true, act: () => temps.forEach((t) => rmSync(t, { recursive: true, force: true })) });
  if (existsSync(PW_CLI)) items.push({ what: 'Playwright browsers', where: PW_CACHE, note: 'only revisions no other project uses', ask: 'Remove browsers that only Bezels uses?', def: true, act: () => { spawnSync(process.execPath, [PW_CLI, 'uninstall'], { stdio: 'ignore' }); } });
  if (existsSync(CONFIG_DIR) && !o.keepConfig) items.push({ what: 'Settings & keymap', where: CONFIG_DIR, bytes: size(CONFIG_DIR), note: 'keymap, custom devices', ask: 'Delete your settings, keymap and custom devices?', def: true, act: () => rmSync(CONFIG_DIR, { recursive: true, force: true }) });
  if (shots) items.push({ what: 'Screenshots', where: shots, bytes: size(shots), note: 'your captures', ask: `Delete screenshots in ${shots}?`, def: o.all, act: () => rmSync(shots, { recursive: true, force: true }) });
  if (managed) items.push({ what: 'Bezels itself', where: ROOT, bytes: size(ROOT), def: true, act: () => rmSync(ROOT, { recursive: true, force: true }) });
  else items.push({ what: 'Build output + packages', where: `${ROOT}/{node_modules,dist,ui/dist}`, bytes: size(join(ROOT, 'node_modules')) + size(join(ROOT, 'dist')), note: 'source checkout itself is kept', ask: 'Remove node_modules and build output from this checkout?', def: false, act: () => ['node_modules', 'dist', 'ui/dist'].forEach((p) => rmSync(join(ROOT, p), { recursive: true, force: true })) });

  console.log(b('This will remove'));
  plan(items.map((i) => [i.what, i.where, [i.bytes ? mb(i.bytes) : '', i.note ?? '', !i.def ? (o.all ? 'included (--all)' : '(asks, default no; --yes keeps it, --all removes it)') : ''].filter(Boolean).join(' · ')]));
  console.log(`\n  ${d('Kept: WebKit system libraries (apt, shared with the OS) and Node.js.')}${!managed ? d(`\n  Kept: the source checkout at ${ROOT}.`) : ''}\n`);
  if (o.dryRun) { console.log(d('(dry run: nothing changed)')); return; }
  if (!(await confirm(o, 'Uninstall Bezels?', false))) { console.log('Cancelled.'); return; }

  const chosen: Item[] = [];
  for (const i of items) if (!i.ask || (await ask(o, `  ${i.ask}`, i.def))) chosen.push(i);
  // Bezels' own directory goes last: the browser cleanup above uses its Playwright.
  total = chosen.length;
  let freed = 0;
  for (const i of chosen) {
    const before = i.what === 'Playwright browsers' ? size(PW_CACHE) : 0;
    await i.act();
    freed += i.what === 'Playwright browsers' ? before - size(PW_CACHE) : i.bytes ?? 0;
    doStep(`${i.what}`, () => {});
  }
  console.log(`\n${g(b('Bezels is uninstalled.'))} ${d(`Freed ${mb(freed)}.`)}`);
  if (!managed) console.log(d(`  Source checkout kept at ${ROOT}. Delete it yourself if you don't need it.`));
  console.log(d('  WebKit system libraries stay installed. On Linux: sudo apt-get remove libevent-2.1-7t64 libavif16 (only if nothing else needs them).\n'));
}

// ---------- cleanup ----------
export async function cleanup(o: Opts) {
  console.log(`\n${b('bezels cleanup')} ${d('(frees space, keeps Bezels installed)')}\n`);
  const cfg = loadConfig();
  const cutoff = Date.now() - o.olderThan * 86_400_000;
  const temps = TEMP_DIRS.filter(existsSync);
  const tempBytes = temps.reduce((a, t) => a + size(t), 0);

  // Screenshots older than N days (PNG + their thumbnails + HAR files).
  const oldShots: string[] = [];
  let shotBytes = 0;
  if (existsSync(cfg.shotsDir)) for (const f of readdirSync(cfg.shotsDir)) {
    const p = join(cfg.shotsDir, f);
    if (!/\.(png|har)$/.test(f)) continue;
    const st = statSync(p);
    if (st.mtimeMs < cutoff) { oldShots.push(p); shotBytes += st.size; }
  }
  // Orphaned thumbnails (their PNG is gone).
  const thumbDir = join(cfg.shotsDir, '.thumbs');
  const orphans = existsSync(thumbDir) ? readdirSync(thumbDir).filter((t) => t.endsWith('.jpg') && !existsSync(join(cfg.shotsDir, t.replace(/\.jpg$/, '.png')))).map((t) => join(thumbDir, t)) : [];
  const orphanBytes = orphans.reduce((a, p) => a + size(p), 0);

  // Browser revisions in the shared cache that this Playwright doesn't use (old versions, other projects).
  let current: string[] = [];
  try { current = JSON.parse(readFileSync(join(ROOT, 'node_modules/playwright-core/browsers.json'), 'utf8')).browsers.map((x: { name: string; revision: string }) => `${x.name.replace(/-/g, '_')}-${x.revision}`); } catch { /* */ }
  const others = existsSync(PW_CACHE) ? readdirSync(PW_CACHE).filter((n) => !n.startsWith('.') && /-\d+$/.test(n) && !current.includes(n)) : [];
  const otherBytes = others.reduce((a, n) => a + size(join(PW_CACHE, n)), 0);

  console.log(b('Found'));
  plan([
    ['Temp files', temps.length ? temps.join(', ') : 'none', tempBytes ? mb(tempBytes) : ''],
    [`Screenshots > ${o.olderThan} days`, oldShots.length ? `${oldShots.length} in ${cfg.shotsDir}` : 'none', shotBytes ? `${mb(shotBytes)} · asks, default no` : ''],
    ['Orphaned thumbnails', orphans.length ? String(orphans.length) : 'none', orphanBytes ? mb(orphanBytes) : ''],
    ['Other browser revisions', others.length ? others.join(', ') : 'none', otherBytes ? `${mb(otherBytes)} · removed only if no project uses them` : ''],
  ]);
  console.log('');
  if (!tempBytes && !oldShots.length && !orphans.length && !others.length) { ok('Nothing to clean.'); return; }
  if (o.dryRun) { console.log(d('(dry run: nothing changed)')); return; }

  let freed = 0;
  const jobs: [string, () => Promise<void> | void][] = [];
  if (temps.length && (await ask(o, 'Remove temp files?', true))) jobs.push(['Temp files removed', () => { temps.forEach((t) => rmSync(t, { recursive: true, force: true })); freed += tempBytes; }]);
  if (oldShots.length && (await ask(o, `Delete ${oldShots.length} screenshot(s) older than ${o.olderThan} days?`, false))) jobs.push([`${oldShots.length} old screenshots deleted`, () => {
    for (const p of oldShots) { rmSync(p, { force: true }); rmSync(join(thumbDir, p.split('/').pop()!.replace(/\.png$/, '.jpg')), { force: true }); }
    freed += shotBytes;
  }]);
  if (orphans.length) jobs.push([`${orphans.length} orphaned thumbnails removed`, () => { orphans.forEach((p) => rmSync(p, { force: true })); freed += orphanBytes; }]);
  if (others.length && existsSync(PW_CLI) && (await ask(o, 'Remove browser revisions that no Playwright project uses any more?', true))) jobs.push(['Unused browser revisions removed', async () => {
    const before = size(PW_CACHE);
    // `playwright install` garbage-collects revisions no live installation links to; it keeps ours (and reinstalls nothing that's present).
    const webkit = existsSync(PW_CACHE) && readdirSync(PW_CACHE).some((n) => n.startsWith('webkit-'));
    await new Promise<void>((res) => spawn(process.execPath, [PW_CLI, 'install', 'chromium', ...(webkit ? ['webkit'] : [])], { stdio: 'ignore', cwd: ROOT }).on('close', () => res()));
    freed += Math.max(0, before - size(PW_CACHE));
  }]);
  total = jobs.length;
  for (const [label, fn] of jobs) { step++; await fn(); ok(`${b(`[${step}/${total}]`)} ${label}`); }
  console.log(`\n${g(b('Done.'))} ${d(`Freed ${mb(freed)}.`)}\n`);
}
