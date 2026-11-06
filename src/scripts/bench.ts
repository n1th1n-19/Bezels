/**
 * Memory benchmark: idle, 1 live device, 10-device matrix. Records peak PSS of Bezels' whole process tree.
 * Fails (exit 1) if a scenario exceeds the spec's target or regresses >15% against bench/baseline.json.
 *   npm run bench            compare
 *   npm run bench -- --update  write a new baseline
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Core } from '../core/core.js';
import { sampleMemory } from '../core/memory.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// CI hardware differs from a laptop: CI compares against its own baseline (BENCH_BASELINE=bench/baseline.ci.json).
const BASELINE = resolve(root, process.env.BENCH_BASELINE ?? 'bench/baseline.json');
const URL_ = process.env.BENCH_URL ?? 'file://' + resolve(root, 'test/fixture/index.html');
const TARGET = { idle: 150, live1: 500, matrix10: 1000 }; // spec section 2b (MB)
process.env.BEZELS_SHOTS_DIR ??= resolve(tmpdir(), 'bezels-bench-shots');

async function peak(fn: () => Promise<unknown>): Promise<number> {
  let max = sampleMemory().totalMB;
  const t = setInterval(() => { max = Math.max(max, sampleMemory().totalMB); }, 150);
  try { await fn(); } finally { clearInterval(t); }
  return Math.round(Math.max(max, sampleMemory().totalMB));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const core = new Core();
const res: Record<string, number> = {};
try {
  res.idle = await peak(() => sleep(1500));
  res.live1 = await peak(async () => {
    const [s] = await core.open(URL_, 'pixel-9', 'cli');
    let frames = 0;
    const un = core.subscribe(s!.id, { maxW: 400, maxH: 900, send: () => { frames++; } });
    for (let i = 0; i < 10; i++) { await core.input(s!.id, { type: 'scroll', dy: 200 }); await sleep(200); }
    un();
    if (!frames) throw new Error('no screencast frames');
    await core.closeAll();
  });
  res.matrix10 = await peak(async () => {
    await core.screenshotMatrix(URL_, ['pixel-7', 'pixel-8-pro', 'pixel-9', 'galaxy-s25', 'galaxy-s25-ultra', 'galaxy-a05', 'android-412', 'galaxy-z-fold-6', 'galaxy-tab-s9', 'laptop-1366'], { framed: true });
  });
} finally { await core.shutdown(); }

console.table(Object.entries(res).map(([k, v]) => ({ scenario: k, peakMB: v, targetMB: TARGET[k as keyof typeof TARGET] })));
const fails: string[] = [];
for (const [k, v] of Object.entries(res)) if (v > TARGET[k as keyof typeof TARGET]) fails.push(`${k}: ${v} MB > target ${TARGET[k as keyof typeof TARGET]} MB`);
if (process.argv.includes('--update')) {
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify({ date: new Date().toISOString(), ...res }, null, 2) + '\n');
  console.log(`baseline written to ${BASELINE}`);
} else if (existsSync(BASELINE)) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  for (const [k, v] of Object.entries(res)) if (base[k] && v > base[k] * 1.15) fails.push(`${k}: ${v} MB regressed >15% vs baseline ${base[k]} MB`);
}
if (fails.length) { console.error('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('OK');
