import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import type { Locator, Page } from 'playwright';
import type { AuditIssue, Device, DeviceState } from '../shared/types.js';
import { resolveDevices, engineFor } from '../shared/devices.js';
import { defaultState } from '../shared/layout.js';
import { Host, contextKey } from './host.js';
import { framedHtml, sheetHtml } from './capture.js';
import { auditPage, script, type AuditRules } from './inpage.js';
import { type Core, mergeState, normalizeUrl, pngSize } from './core.js';

/**
 * Flows: describe a path through an app once, replay it on every device.
 *
 *   { url: "http://localhost:3000", devices: "phones,folds", steps: [
 *       "tap PLAY DEMO", "wait PLACE BET", "checkpoint bet",
 *       { tap: "PLACE BET" }, { wait: { text: "You won", timeout: 15000 } }, "checkpoint result" ] }
 *
 * Each device runs in a fresh page, one at a time. A checkpoint screenshots the device and runs the
 * layout audit. Output: one framed contact sheet per checkpoint, and report.html (devices × checkpoints).
 */
export type Step = string | Record<string, any>;
export interface Flow {
  name?: string;
  url: string;
  devices?: string | string[];
  steps: Step[];
  /** Device state for every device (orientation, colorScheme, telegram…). */
  state?: Partial<DeviceState> & Record<string, any>;
  rules?: Partial<AuditRules>;
  /** Per-step timeout (default 15 s; dev servers compile slowly). */
  timeoutMs?: number;
}

interface CheckpointResult { name: string; file: string; errors: number; warnings: number; issues: AuditIssue[] }
interface DeviceResult { device: string; name: string; ok: boolean; ms: number; error?: { step: number; text: string; message: string; file?: string }; checkpoints: CheckpointResult[] }

const KINDS = ['goto', 'tap', 'click', 'wait', 'type', 'press', 'scroll', 'eval', 'checkpoint', 'hover', 'state', 'sleep'];

/** "tap PLAY DEMO" → { tap: "PLAY DEMO" }; objects pass through. */
export function parseStep(s: Step): Record<string, any> {
  if (typeof s !== 'string') return s;
  const m = /^\s*(\w+)\s*(.*)$/s.exec(s);
  if (!m || !KINDS.includes(m[1]!.toLowerCase())) throw new Error(`Unknown step "${s}". Use one of: ${KINDS.join(', ')} (e.g. "tap PLAY DEMO", "wait PLACE BET", "checkpoint result").`);
  const kind = m[1]!.toLowerCase(), arg = m[2]!.trim().replace(/^["'](.*)["']$/s, '$1');
  return { [kind]: kind === 'wait' && /^\d+$/.test(arg) ? Number(arg) : arg };
}
export const describeStep = (s: Step) => (typeof s === 'string' ? s : JSON.stringify(s));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Text or selector → a visible element. `{ selector }` forces CSS; plain strings try text first, then CSS. */
function target(page: Page, q: string | { text?: string; selector?: string; exact?: boolean }): Locator {
  if (typeof q !== 'string') {
    if (q.selector) return page.locator(q.selector).locator('visible=true').first();
    q = q.text ?? '';
  }
  const looksCss = /^[#.[]|^[a-z]+[#.[:>]/i.test(q) && !/\s{2,}/.test(q);
  const byText = page.getByText(q, { exact: true }).or(page.getByText(q)).locator('visible=true').first();
  return looksCss ? page.locator(q).locator('visible=true').first().or(byText).first() : byText;
}

async function runStep(core: Core, host: Host, page: Page, raw: Step, timeout: number, checkpoint: (name: string) => Promise<unknown>) {
  const st = parseStep(raw);
  const touch = host.touch;
  if ('goto' in st) { await page.goto(new URL(String(st.goto), host.url).href, { waitUntil: 'domcontentloaded', timeout: Math.max(timeout, 30_000) }); return; }
  if ('tap' in st || 'click' in st) {
    const q = st.tap ?? st.click;
    const t = target(page, q);
    await t.waitFor({ state: 'visible', timeout });
    if (touch) await t.tap({ timeout }); else await t.click({ timeout });
    return;
  }
  if ('hover' in st) { const t = target(page, st.hover); await t.hover({ timeout }); return; }
  if ('wait' in st || 'sleep' in st) {
    const w = st.wait ?? st.sleep;
    if (typeof w === 'number') { await page.waitForTimeout(w); return; }
    if (w && typeof w === 'object' && 'gone' in w) { await target(page, w.gone).waitFor({ state: 'hidden', timeout: w.timeout ?? timeout }); return; }
    await target(page, w).waitFor({ state: 'visible', timeout: (typeof w === 'object' && w.timeout) || timeout });
    return;
  }
  if ('type' in st) {
    if (st.into) { const t = target(page, st.into); await t.click({ timeout }); }
    await page.keyboard.type(String(st.type), { delay: 15 });
    return;
  }
  if ('press' in st) { await page.keyboard.press(String(st.press)); return; }
  if ('scroll' in st) {
    const to = st.scroll;
    if (typeof to === 'string' && to !== 'top' && to !== 'bottom') { await target(page, to).scrollIntoViewIfNeeded({ timeout }); return; }
    await page.evaluate((v) => { const se = document.scrollingElement!; if (v === 'top') scrollTo(0, 0); else if (v === 'bottom') scrollTo(0, se.scrollHeight); else scrollBy(0, Number(v)); }, to);
    return;
  }
  if ('eval' in st) {
    const js = String(st.eval);
    try { await page.evaluate(js); }
    catch (e) { if (!/SyntaxError|Illegal return|await is only valid/.test((e as Error).message)) throw e; await page.evaluate(`(async () => { ${js} })()`); }
    return;
  }
  if ('state' in st) {
    const next = mergeState(host.state, st.state);
    const rebuild = contextKey(host.device, next, host.engine) !== host.ctxKey;
    host.state = next;
    if (rebuild) await host.build(); else await host.applyLive();
    return;
  }
  if ('checkpoint' in st) { await checkpoint(String(st.checkpoint)); return; }
  throw new Error(`Unknown step ${describeStep(raw)}`);
}

export async function runFlow(core: Core, flow: Flow) {
  const url = normalizeUrl(flow.url);
  const devices: Device[] = resolveDevices(flow.devices ?? 'phones', core.allDevices());
  const steps = flow.steps.map((s) => { parseStep(s); return s; }); // validate before launching anything
  const timeout = flow.timeoutMs ?? 15_000;
  const rules = core.rulesFor(url, flow.rules);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = join(core.shots.dir, 'flows', `${stamp}_${slug(flow.name ?? 'flow')}`);
  mkdirSync(dir, { recursive: true });
  const results: DeviceResult[] = [];
  const order: string[] = [];
  const t0 = Date.now();

  for (const d of devices) {
    const started = Date.now();
    const state = mergeState(defaultState(d), (flow.state ?? {}) as any);
    if (!d.browsers.includes(state.browser)) state.browser = d.defaultBrowser;
    const host = new Host(core.env, d, state, url, engineFor(d, state.browser));
    const res: DeviceResult = { device: d.id, name: d.name, ok: true, ms: 0, checkpoints: [] };
    const checkpoint = async (name: string) => {
      const page = host.page!;
      if (!order.includes(name)) order.push(name);
      const file = join(dir, `${slug(d.id)}__${slug(name)}.png`);
      await page.screenshot({ path: file, scale: 'css', timeout: 30_000 });
      const issues = (await page.evaluate(script(auditPage, core.auditOpts(d, host.state, host.layout, host.tg.verticalSwipes, rules)))) as AuditIssue[];
      const cp = { name, file, errors: issues.filter((i) => i.severity === 'error').length, warnings: issues.filter((i) => i.severity === 'warn').length, issues };
      res.checkpoints.push(cp);
      return { name, errors: cp.errors, warnings: cp.warnings };
    };
    host.onCheckpoint = checkpoint; // bezels.checkpoint() inside eval steps
    let i = 0;
    try {
      await host.build();
      if (host.lastError) throw new Error(host.lastError);
      for (; i < steps.length; i++) {
        const page = host.page!;
        try { await runStep(core, host, page, steps[i]!, timeout, checkpoint); }
        catch (e) {
          // Hot reload / redirect mid-step: wait for the page to settle and try the step once more.
          if (!/Execution context was destroyed|navigation|frame was detached|Target page, context or browser has been closed/i.test((e as Error).message)) throw e;
          await host.page!.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
          await runStep(core, host, host.page!, steps[i]!, timeout, checkpoint);
        }
      }
    } catch (e) {
      res.ok = false;
      const file = join(dir, `${slug(d.id)}__failed.png`);
      const shot = await host.page?.screenshot({ path: file, scale: 'css', timeout: 10_000 }).then(() => file, () => undefined);
      res.error = { step: i + 1, text: steps[i] ? describeStep(steps[i]!) : '(start)', message: ((e as Error).message ?? String(e)).split('\n')[0]!.replace(/\s+/g, ' ').slice(0, 300), file: shot };
    } finally {
      await host.close();
    }
    if (res.checkpoints.some((c) => c.errors)) res.ok = false;
    res.ms = Date.now() - started;
    results.push(res);
    core.emit('event', 'toast', { text: `Flow ${flow.name ?? ''}: ${d.name} ${res.ok ? 'passed' : 'failed'} (${results.length}/${devices.length})`, error: !res.ok });
  }

  // One framed contact sheet per checkpoint.
  const sheets: { checkpoint: string; path: string }[] = [];
  for (const name of order) {
    const cells: { file: string; w: number; h: number; label: string; sub: string }[] = [];
    const tmp: string[] = [];
    for (const r of results) {
      const cp = r.checkpoints.find((c) => c.name === name);
      if (!cp) continue;
      const d = devices.find((x) => x.id === r.device)!;
      const state = mergeState(defaultState(d), (flow.state ?? {}) as any);
      if (!d.browsers.includes(state.browser)) state.browser = d.defaultBrowser;
      const L = (await import('../shared/layout.js')).computeLayout(d, state);
      const framed = join(tmpdir(), `bezels-flow-${process.pid}-${slug(d.id)}-${slug(name)}.png`);
      const h = framedHtml({ device: d, state, layout: L, url, title: flow.name ?? 'Flow' }, 'shot.png', null);
      await core.compositor.render({ html: h.html, files: { 'shot.png': cp.file }, width: h.w, height: h.h, scale: 1, transparent: true, out: framed });
      tmp.push(framed);
      cells.push({ file: framed, ...pngSize(framed), label: d.name, sub: cp.errors ? `${cp.errors} error(s)` : cp.warnings ? `${cp.warnings} warning(s)` : 'ok' });
    }
    if (!cells.length) continue;
    const out = join(dir, `sheet__${slug(name)}.png`);
    const sh = sheetHtml(cells, '#0E0F12');
    await core.compositor.render({ html: sh.html, files: sh.files, width: sh.w, height: sh.h, scale: 1, transparent: false, out });
    for (const f of tmp) try { unlinkSync(f); } catch { /* */ }
    sheets.push({ checkpoint: name, path: out });
  }

  const summary = {
    name: flow.name ?? null, url, dir, report: join(dir, 'report.html'), ms: Date.now() - t0,
    passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, checkpoints: order, sheets,
    results: results.map((r) => ({ device: r.device, name: r.name, ok: r.ok, ms: r.ms, error: r.error, checkpoints: r.checkpoints.map((c) => ({ name: c.name, file: c.file, errors: c.errors, warnings: c.warnings, issues: c.issues.filter((i) => i.severity !== 'info').slice(0, 10).map((i) => `${i.severity}: ${i.title}: ${i.message}`) })) })),
  };
  writeFileSync(join(dir, 'report.json'), JSON.stringify(summary, null, 2));
  writeFileSync(summary.report, reportHtml(summary, flow, dir));
  core.emit('event', 'toast', { text: `Flow ${flow.name ?? ''} done: ${summary.passed} passed, ${summary.failed} failed. Report in the screenshots folder.` });
  return summary;
}

function reportHtml(s: any, flow: Flow, dir: string): string {
  const rel = (f?: string) => (f ? esc(relative(dir, f)) : '');
  const head = s.checkpoints.map((c: string) => `<th>${esc(c)}</th>`).join('');
  const rows = s.results.map((r: any) => {
    const cells = s.checkpoints.map((c: string) => {
      const cp = r.checkpoints.find((x: any) => x.name === c);
      if (!cp) return `<td class="miss">${r.error ? 'not reached' : '—'}</td>`;
      const tone = cp.errors ? 'bad' : cp.warnings ? 'warn' : 'good';
      const list = cp.issues.length ? `<details><summary>${cp.errors} error(s), ${cp.warnings} warning(s)</summary><ul>${cp.issues.map((i: string) => `<li>${esc(i)}</li>`).join('')}</ul></details>` : '<div class="ok">no issues</div>';
      return `<td class="${tone}"><a href="${rel(cp.file)}"><img src="${rel(cp.file)}" alt="${esc(r.name)} at ${esc(c)}"></a>${list}</td>`;
    }).join('');
    const status = r.ok ? '<span class="pill good">pass</span>' : `<span class="pill bad">fail</span>${r.error ? `<div class="err">step ${r.error.step}: <code>${esc(r.error.text)}</code><br>${esc(r.error.message)}${r.error.file ? `<br><a href="${rel(r.error.file)}">screenshot at failure</a>` : ''}</div>` : ''}`;
    return `<tr><th class="dev">${esc(r.name)}<div class="ms">${(r.ms / 1000).toFixed(1)} s</div></th><td class="status">${status}</td>${cells}</tr>`;
  }).join('');
  const sheets = s.sheets.map((x: any) => `<li><a href="${rel(x.path)}">${esc(x.checkpoint)}</a></li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(flow.name ?? 'Flow')} · Bezels report</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#14161a;--mute:#5d6470;--line:#d9dde3;--good:#1d7a4c;--goodbg:#e7f6ee;--bad:#b42323;--badbg:#fdecec;--warn:#8a5a00;--warnbg:#fff4df}
@media (prefers-color-scheme:dark){:root{--bg:#0e0f12;--fg:#eceef2;--mute:#a3aab6;--line:#2a2e36;--good:#5bd69a;--goodbg:#17251e;--bad:#ff7a7a;--badbg:#1f1616;--warnbg:#1e1912;--warn:#ffb062}}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.45 Inter,system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}.meta{color:var(--mute);margin-bottom:16px}.wrap{overflow-x:auto}
table{border-collapse:collapse}th,td{border:1px solid var(--line);padding:8px;vertical-align:top;text-align:left}
td img{display:block;max-width:130px;max-height:260px;border-radius:6px;border:1px solid var(--line)}
td.good{background:var(--goodbg)}td.bad{background:var(--badbg)}td.warn{background:var(--warnbg)}td.miss{color:var(--mute)}
.pill{display:inline-block;padding:1px 8px;border-radius:9px;font-weight:600;font-size:12px}.pill.good{background:var(--goodbg);color:var(--good)}.pill.bad{background:var(--badbg);color:var(--bad)}
.err{margin-top:6px;max-width:280px;color:var(--bad);font-size:12px}.ms{color:var(--mute);font-weight:400;font-size:12px}.ok{color:var(--good);font-size:12px;margin-top:4px}
details{margin-top:4px;font-size:12px;max-width:260px}ul{padding-left:16px;margin:4px 0}code{font-size:12px}a{color:inherit}
</style></head><body>
<h1>${esc(flow.name ?? 'Flow')}: ${s.passed} passed, ${s.failed} failed</h1>
<div class="meta">${esc(s.url)} · ${s.results.length} devices · ${(s.ms / 1000).toFixed(0)} s · steps: <code>${esc(flow.steps.map(describeStep).join(' → '))}</code></div>
<div class="wrap"><table><thead><tr><th>Device</th><th>Result</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
${sheets ? `<h2 style="font-size:16px;margin-top:24px">Contact sheets</h2><ul>${sheets}</ul>` : ''}
</body></html>`;
}
