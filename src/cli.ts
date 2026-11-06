#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { mkdirSync, copyFileSync } from 'node:fs';
import { Core, type Source } from './core/core.js';
import { dispatch } from './core/rpc.js';
import { ping, remote, startServer } from './server.js';
import { loadConfig } from './core/config.js';
import { copyImageToClipboard } from './core/clipboard.js';

const HELP = `bezels — real-device responsive tester

  bezels serve [--port 4477] [--watch ./src] [--open http://localhost:3000 --devices phones]
                                   start the engine + UI (http://localhost:4477)
  bezels mcp                       MCP server for Claude Code (stdio)
                                   claude mcp add bezels -- node ${resolve(process.argv[1] ?? 'dist/cli.js')} mcp
  bezels shot <url> --devices phones,folds [--framed] [--full] [--out ./shots]
  bezels shot <url> --device iphone-16-pro --framed --copy
  bezels audit <url> --devices all [--json]
  bezels devices [--json]          list device ids
  bezels stats                     memory of a running daemon
  bezels stop                      stop a running daemon
  bezels update [--check]          pull the latest version, reinstall what changed, rebuild
  bezels cleanup [--older-than 30] free space: temp files, old screenshots, unused browser revisions
  bezels uninstall [--keep-config] remove Bezels, its command, MCP entry, settings (asks per item)
                                   --yes: accept defaults (keeps screenshots) · --all: also delete them · --dry-run: show the plan only

Uses a running daemon if one is up (sessions show in its UI), otherwise runs in-process.`;

async function client(source: Source): Promise<{ call: (m: string, p?: unknown) => Promise<any>; core?: Core }> {
  const port = loadConfig().port;
  if (await ping(port)) return { call: remote(port, source) };
  const core = new Core();
  return { call: (m, p) => dispatch(core, m, p, source), core };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values: o, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: {
      devices: { type: 'string' }, device: { type: 'string' }, framed: { type: 'boolean' }, plain: { type: 'boolean' }, full: { type: 'boolean' },
      out: { type: 'string' }, copy: { type: 'boolean' }, json: { type: 'boolean' }, port: { type: 'string' }, watch: { type: 'string' }, open: { type: 'string' },
      transparent: { type: 'boolean' }, dark: { type: 'boolean' }, landscape: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' }, 'dry-run': { type: 'boolean' }, all: { type: 'boolean' }, 'keep-config': { type: 'boolean' }, 'older-than': { type: 'string' }, force: { type: 'boolean' }, check: { type: 'boolean' },
    },
  });
  if (o.port) process.env.BEZELS_PORT = o.port;

  switch (cmd) {
    case 'serve': case 'ui': {
      const core = new Core();
      const srv = await startServer(core);
      console.log(`bezels: http://localhost:${srv.port}  (Ctrl+C to stop)`);
      if (o.watch) console.log(`bezels: watching ${core.watch(resolve(o.watch)).watching} — reloads all devices on change`);
      if (o.open) await core.open(o.open, o.devices ?? 'iphone-16-pro', 'ui');
      const bye = async () => { await srv.close(); await core.shutdown(); process.exit(0); };
      process.on('SIGINT', bye); process.on('SIGTERM', bye);
      return;
    }
    case 'stop': case 'update': case 'uninstall': case 'cleanup': {
      const m = await import('./maint.js');
      const mo = { yes: !!o.yes, dryRun: !!o['dry-run'], all: !!o.all, keepConfig: !!o['keep-config'], olderThan: Number(o['older-than'] ?? 30), force: !!o.force, check: !!o.check };
      if (cmd === 'stop') await m.stop(); else await m[cmd](mo);
      return;
    }
    case 'mcp': { const { runMcp } = await import('./mcp.js'); return runMcp(); }
    case 'devices': {
      const { call, core } = await client('cli');
      const list = await call('list_devices');
      if (o.json) console.log(JSON.stringify(await call('catalog').then((c: any) => c.devices), null, 2));
      else for (const d of list) console.log(`${d.id.padEnd(22)} ${d.name.padEnd(24)} ${d.category.padEnd(9)} ${d.screen.padEnd(10)} @${d.dpr}  ${d.browsers.join('/')}`);
      await core?.shutdown();
      return;
    }
    case 'stats': { const { call, core } = await client('cli'); console.log(JSON.stringify(await call('stats'), null, 2)); await core?.shutdown(); return; }
    case 'shot': {
      const url = positionals[0];
      if (!url) throw new Error('usage: bezels shot <url> --devices phones [--framed]');
      const { call, core } = await client('cli');
      const devs = o.device ?? o.devices ?? 'iphone-16-pro';
      const framed = o.plain ? false : !!o.framed;
      const bg = o.transparent ? 'transparent' : 'solid';
      const outDir = o.out ? resolve(o.out) : undefined;
      if (outDir) mkdirSync(outDir, { recursive: true });
      const state = { ...(o.dark ? { colorScheme: 'dark' } : {}), ...(o.landscape ? { orientation: 'landscape-left' } : {}) };
      const isSingle = !!o.device || (!devs.includes(',') && !['phones', 'iphones', 'android', 'folds', 'tablets', 'laptops', 'desktop', 'breakpoints', 'telegram', 'all'].includes(devs));
      let paths: string[] = [];
      try {
        if (isSingle) {
          const [s] = await call('open', { url, devices: devs, state });
          const m = await call('screenshot', { session: s.id, framed, fullPage: !!o.full, background: bg });
          paths.push(m.path);
          await call('close', { session: s.id });
        } else {
          const m = await call('screenshot_matrix', { url, devices: devs, framed: o.framed ?? true, fullPage: !!o.full, background: bg });
          paths.push(m.path);
          for (const d of m.devices) if (d.error) console.error(`  ${d.device}: ${d.error}`);
        }
        if (outDir) paths = paths.map((p) => { const t = join(outDir, p.split('/').pop()!); if (t !== p) copyFileSync(p, t); return t; });
        for (const p of paths) console.log(p);
        if (o.copy) { await copyImageToClipboard(paths[0]!); console.error('copied to clipboard'); }
      } finally { await core?.shutdown(); }
      return;
    }
    case 'audit': {
      const url = positionals[0];
      if (!url) throw new Error('usage: bezels audit <url> --devices all [--json]');
      const { call, core } = await client('cli');
      try {
        const res = await call('audit_all', { url, devices: o.devices ?? o.device ?? 'phones' });
        if (o.json) { console.log(JSON.stringify(res, null, 2)); }
        else {
          for (const r of res) {
            console.log(`\n${r.name}${r.error ? `  ERROR ${r.error}` : ''}  (${r.issues.length} issues)`);
            for (const i of r.issues) console.log(`  ${i.severity.toUpperCase().padEnd(5)} ${i.title}: ${i.message}`);
          }
        }
        process.exitCode = res.some((r: any) => r.issues.some((i: any) => i.severity === 'error')) ? 1 : 0;
      } finally { await core?.shutdown(); }
      return;
    }
    default: console.log(HELP);
  }
}

main().catch((e) => { console.error(`bezels: ${(e as Error).message}`); process.exit(1); });
