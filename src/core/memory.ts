import { readdirSync, readFileSync } from 'node:fs';

/**
 * Memory of Bezels' own process tree, grouped by engine.
 * Linux: sums PSS from /proc/<pid>/smaps_rollup (shared pages split fairly, so Chromium's
 * many processes are not double-counted like RSS would). Elsewhere: Node RSS only.
 */
export interface MemSample { nodeMB: number; chromiumMB: number; webkitMB: number; totalMB: number }

const read = (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

function pssKB(pid: number): number {
  const s = read(`/proc/${pid}/smaps_rollup`);
  const m = /^Pss:\s+(\d+)/m.exec(s);
  if (m) return Number(m[1]);
  const st = /^VmRSS:\s+(\d+)/m.exec(read(`/proc/${pid}/status`));
  return st ? Number(st[1]) : 0;
}

export function sampleMemory(): MemSample {
  const nodeMB = process.memoryUsage().rss / 1048576;
  if (process.platform !== 'linux') return { nodeMB, chromiumMB: 0, webkitMB: 0, totalMB: nodeMB };
  const parent = new Map<number, number>();
  const cmd = new Map<number, string>();
  for (const d of readdirSync('/proc')) {
    const pid = Number(d);
    if (!pid) continue;
    const stat = read(`/proc/${pid}/stat`);
    const close = stat.lastIndexOf(')');
    if (close < 0) continue;
    parent.set(pid, Number(stat.slice(close + 2).split(' ')[1]));
    cmd.set(pid, stat.slice(stat.indexOf('(') + 1, close));
  }
  const root = process.pid;
  const isDescendant = (pid: number) => { for (let p = parent.get(pid), n = 0; p && n < 50; p = parent.get(p), n++) if (p === root) return true; return false; };
  let chromium = 0, webkit = 0;
  for (const pid of parent.keys()) {
    if (!isDescendant(pid)) continue;
    const name = (cmd.get(pid) ?? '').toLowerCase();
    const kb = pssKB(pid);
    if (/webkit|minibrowser|pw_run|wpe/.test(name)) webkit += kb;
    else if (/chrom|headless/.test(name)) chromium += kb;
  }
  const nodePss = pssKB(root) / 1024 || nodeMB;
  const c = chromium / 1024, w = webkit / 1024;
  return { nodeMB: nodePss, chromiumMB: c, webkitMB: w, totalMB: nodePss + c + w };
}
