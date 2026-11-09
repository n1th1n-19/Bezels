import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { DEVICE_MAP, DEVICES, resolveDevices } from '../shared/devices.js';
import { computeLayout, defaultState, emptyTgRuntime } from '../shared/layout.js';
import { renderFrame } from '../shared/frame.js';
import { DEFAULT_KEYMAP, keymapConflicts } from '../shared/keymap.js';
import { versionAtLeast } from '../shared/telegram.js';
import { buildInitData, validateInitData } from '../core/telegram.js';
import { mergeState, normalizeUrl } from '../core/core.js';

const dev = (id: string) => DEVICE_MAP.get(id)!;
const vp = (id: string, patch = {}) => computeLayout(dev(id), mergeState(defaultState(dev(id)), patch)).viewport;

test('viewport = screen − status bar − browser bars (matches Playwright measurements)', () => {
  // Playwright deviceDescriptors measured on hardware: iPhone 15 Pro 393×659, landscape 734×343; iPhone 14 390×664; iPhone SE 3 375×548.
  // Measurements vary ±1px between models, so allow 1px.
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} vs ${b}`);
  near(vp('iphone-15').h, 659, 'iPhone 15 portrait');
  near(vp('iphone-15', { orientation: 'landscape-left' }).w, 734, 'iPhone 15 landscape w');
  near(vp('iphone-15', { orientation: 'landscape-left' }).h, 343, 'iPhone 15 landscape h');
  near(vp('iphone-14').h, 664, 'iPhone 14');
  near(vp('iphone-se').h, 548, 'iPhone SE');
  // Bars collapsed and PWA give more room, never less.
  assert.ok(vp('iphone-16-pro', { bars: 'collapsed' }).h > vp('iphone-16-pro').h);
  assert.ok(vp('iphone-16-pro', { bars: 'pwa' }).h > vp('iphone-16-pro', { bars: 'collapsed' }).h);
  // Android Chrome: status 24 + address bar 56.
  assert.equal(vp('pixel-9').h, 923 - 24 - 56);
});

test('foldables switch screens and draw a hinge', () => {
  const d = dev('galaxy-z-fold-6');
  const folded = computeLayout(d, mergeState(defaultState(d), { fold: 'folded' }));
  const open = computeLayout(d, mergeState(defaultState(d), { fold: 'book' }));
  assert.equal(folded.screen.w, d.fold!.foldedScreen.w);
  assert.equal(open.screen.w, d.fold!.unfoldedScreen.w);
  assert.equal(folded.hinge, null);
  assert.ok(open.hinge && open.hinge.h > open.hinge.w, 'book posture → vertical hinge');
});

test('Telegram layout: header + MainButton shrink the viewport; fullscreen sets content safe area', () => {
  const d = dev('iphone-16-pro');
  const s = mergeState(defaultState(d), { telegram: { enabled: true, mode: 'expanded' } });
  const rt = emptyTgRuntime();
  const a = computeLayout(d, s, rt);
  rt.mainButton.visible = true;
  const b = computeLayout(d, s, rt);
  assert.ok(b.viewport.h < a.viewport.h);
  const f = computeLayout(d, mergeState(s, { telegram: { mode: 'fullscreen' } }), rt);
  assert.equal(f.viewport.y, 0);
  assert.ok(f.tg!.contentSafeAreaInset.top > 0 && f.tg!.safeAreaInset.top === d.safeArea.top);
});

test('initData: unsigned by default, signed with a test bot token exactly like Telegram', () => {
  const s = defaultState(dev('pixel-9')).telegram;
  const token = '123456:TEST-token';
  assert.equal(validateInitData(buildInitData(s).initData, token), false);
  assert.equal(validateInitData(buildInitData(s, token).initData, token), true);
  assert.equal(validateInitData(buildInitData(s, token).initData, '999:other'), false);
  assert.ok(versionAtLeast('10.1', '7.10') && versionAtLeast('7.10', '7.2') && !versionAtLeast('6.9', '7.0'));
});

test('frame SVG never lets page-controlled colours inject markup', () => {
  const d = dev('pixel-9');
  const s = mergeState(defaultState(d), { telegram: { enabled: true } });
  const rt = emptyTgRuntime();
  rt.headerColor = '"/><script>alert(1)</script>';
  rt.mainButton = { ...rt.mainButton, visible: true, color: 'red" onload="x', text: '<img src=x onerror=1>' };
  const f = renderFrame(d, s, computeLayout(d, s, rt), 'http://x/"><b>', rt, '<i>t</i>');
  assert.ok(!/<script|onload=|<img|<b>|<i>/.test(f.under + f.over));
});

test('default keymap has no duplicate or browser-reserved keys; every device resolves', () => {
  const c = keymapConflicts(DEFAULT_KEYMAP);
  assert.deepEqual(c.duplicates, {});
  assert.deepEqual(c.reserved, []);
  assert.equal(new Set(DEVICES.map((d) => d.id)).size, DEVICES.length);
  assert.ok(resolveDevices('phones,folds').length > 30);
  assert.equal(normalizeUrl('3000'), 'http://localhost:3000/');
  assert.equal(normalizeUrl('localhost:5173/x'), 'http://localhost:5173/x');
});

test('end-to-end: audit finds the planted bugs in the fixture (Chromium)', { timeout: 90_000 }, async () => {
  const { Core } = await import('../core/core.js');
  const core = new Core();
  try {
    const fixture = 'file://' + resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixture/index.html');
    const [s] = await core.open(fixture, 'pixel-9', 'cli');
    const types = new Set((await core.audit(s!.id)).map((i) => i.type));
    for (const t of ['overflow', 'tap-target', 'small-text', 'fixed-overlap', 'vh']) assert.ok(types.has(t), `missing ${t}`);
    const ua = JSON.parse(await core.evaluate(s!.id, 'navigator.userAgent')) as string;
    const major = core.get(s!.id).host.chromeMajor;
    assert.ok(major && ua.includes(`Chrome/${major}.0.0.0`) && ua.includes('Android 10; K'), `UA follows running Chromium: ${ua}`);
    const issues = await core.audit(s!.id);
    assert.ok(!issues.some((i) => i.type === 'overflow' && /div\.(buy|chat)/.test(i.message)), 'fixed elements must not be blamed for overflow');
  } finally { await core.shutdown(); }
});

test('end-to-end: iPhone on WebKit (required in CI; skipped locally if WebKit system libs are missing)', { timeout: 120_000 }, async (t) => {
  const { webkit } = await import('playwright');
  try { await (await webkit.launch()).close(); }
  catch (e) {
    if (process.env.CI) throw e;
    t.skip(`WebKit can't launch here: ${(e as Error).message.split('\n')[0]}`);
    return;
  }
  const { Core } = await import('../core/core.js');
  const core = new Core();
  try {
    const fixture = 'file://' + resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixture/index.html');
    const [s] = await core.open(fixture, 'iphone-16-pro', 'cli');
    assert.equal(s!.engine, 'webkit');
    const ua = JSON.parse(await core.evaluate(s!.id, 'navigator.userAgent')) as string;
    assert.match(ua, /iPhone/);
    const inner = JSON.parse(await core.evaluate(s!.id, '[innerWidth, innerHeight]')) as number[];
    assert.deepEqual(inner, [s!.layout.viewport.w, s!.layout.viewport.h]);
    const types = new Set((await core.audit(s!.id)).map((i) => i.type));
    assert.ok(types.has('overflow') && types.has('tap-target'), [...types].join());
    const shot = await core.screenshot(s!.id, { framed: true });
    assert.ok(shot.w > 0 && shot.h > 0);
  } finally { await core.shutdown(); }
});

test('audit: overlap, ellipsis, cut-off control, collapsed box found; dvh, cropped decoration, enlarged hit area not flagged; rules apply', { timeout: 90_000 }, async () => {
  const { Core } = await import('../core/core.js');
  const core = new Core();
  try {
    const fixture = 'file://' + resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixture/audit.html');
    const [s] = await core.open(fixture, 'pixel-9', 'cli');
    const issues = await core.audit(s!.id, { ignore: [], minTextPx: 12 });
    const of = (t: string) => issues.filter((i) => i.type === t);
    for (const t of ['text-overlap', 'truncated', 'clipped', 'collapsed']) assert.ok(of(t).length, `missing ${t}: ${issues.map((i) => i.type).join()}`);
    assert.ok(of('clipped').some((i) => /START/.test(i.message)), 'START button reported as cut off');
    assert.ok(!issues.some((i) => i.type === 'vh'), 'min-height:100dvh must not be flagged');
    assert.ok(!issues.some((i) => (i.type === 'too-wide' || i.type === 'image-overflow') && /deco|img/.test(i.selector ?? '')), 'cropped decoration must not be flagged');
    const taps = of('tap-target').map((i) => i.selector ?? '');
    assert.ok(taps.some((x) => x.includes('small')), 'genuinely small button flagged');
    assert.ok(!taps.some((x) => x.includes('hit')), 'button with a 46px hit area must not be flagged');
    assert.ok(of('small-text').some((i) => /eleven|shell|nav/.test(i.selector ?? '')));
    // Project rules: 11px is fine here, and the site shell is ignored.
    const ruled = await core.audit(s!.id, { minTextPx: 11, ignore: ['.shell'] });
    assert.ok(!ruled.some((i) => i.type === 'small-text'), ruled.filter((i) => i.type === 'small-text').map((i) => i.message).join());
  } finally { await core.shutdown(); }
});

test('busy pages are never closed by the memory budget mid-call', { timeout: 120_000 }, async () => {
  const { Core } = await import('../core/core.js');
  const { dispatch } = await import('../core/rpc.js');
  const core = new Core();
  core.cfg.maxMemoryMB = 1; // force the budget job to want to close everything
  try {
    const fixture = 'file://' + resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixture/index.html');
    const opened = (await dispatch(core, 'open', { url: fixture, devices: ['pixel-9', 'galaxy-s25', 'android-360'] }, 'mcp')) as { id: string }[];
    const slow = 'await new Promise((r) => setTimeout(r, 2500)); return document.title';
    const runs = opened.map((s) => dispatch(core, 'eval', { session: s.id, js: slow }, 'mcp'));
    await new Promise((r) => setTimeout(r, 400));
    await core.enforceBudget(); // would previously close the non-focused pages under the running evals
    const results = await Promise.all(runs);
    for (const r of results) assert.match(String(r), /fixture/i);
  } finally { await core.shutdown(); }
});
