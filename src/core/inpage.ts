/* Functions that run inside the emulated page. Each is self-contained (serialised with fn.toString()). */
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Provided by `script()` below. */
declare const __sel: (e: Element) => string;

export interface RuntimeOpts { safeArea: { top: number; bottom: number; left: number; right: number } | null; battery: number | null }

/** Init script for every page: scroll sync, Web Vitals, listener tracking, safe-area polyfill, battery. */
export function runtimeInit(opts: RuntimeOpts) {
  const w = window as any;
  if (w.__bezelsInit) return;
  w.__bezelsInit = true;
  const send = (m: any) => { try { w.__bezels?.(m); } catch { /* binding gone */ } };

  // Count listeners that make vertical swipes conflict with Telegram's sheet gesture.
  const listen = { touchmove: 0, pointermove: 0, wheel: 0 } as Record<string, number>;
  w.__bezelsListeners = listen;
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (this: any, type: string, ...rest: any[]) {
    if (type in listen) listen[type]!++;
    return (orig as any).call(this, type, ...rest);
  } as any;

  // Scroll reporting for synced scroll.
  let t = 0;
  addEventListener('scroll', () => {
    if (t) return;
    t = setTimeout(() => {
      t = 0;
      const se = document.scrollingElement!;
      const max = Math.max(1, se.scrollHeight - innerHeight);
      send({ type: 'scroll', pct: se.scrollTop / max, x: scrollX, y: scrollY });
    }, 80) as any;
  }, { passive: true, capture: true });

  // Web Vitals (simplified implementations of LCP, CLS with session windows, INP, TTFB) + long tasks.
  const v: any = (w.__bezelsVitals = { lcp: null, cls: 0, inp: null, ttfb: null, fcp: null, longTasks: [] as any[], shifts: [] as any[] });
  const po = (type: string, cb: (e: any) => void, opt: any = {}) => { try { new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true, ...opt }); } catch { /* unsupported */ } };
  po('largest-contentful-paint', (e) => { v.lcp = Math.round(e.startTime); });
  po('paint', (e) => { if (e.name === 'first-contentful-paint') v.fcp = Math.round(e.startTime); });
  let sess = 0, sessStart = 0, last = 0;
  po('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    if (e.startTime - last > 1000 || e.startTime - sessStart > 5000) { sess = 0; sessStart = e.startTime; }
    sess += e.value; last = e.startTime; v.cls = Math.max(v.cls, +sess.toFixed(4));
    for (const s of e.sources ?? []) if (s.currentRect && v.shifts.length < 50) v.shifts.push({ x: s.currentRect.x, y: s.currentRect.y + scrollY, w: s.currentRect.width, h: s.currentRect.height, value: e.value });
  });
  const inps: number[] = [];
  po('event', (e) => { if (e.interactionId) { inps.push(e.duration); inps.sort((a, b) => b - a); v.inp = inps[Math.min(inps.length - 1, Math.floor(inps.length / 50))]; } }, { durationThreshold: 16 });
  po('longtask', (e) => { if (v.longTasks.length < 100) v.longTasks.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) }); });
  po('navigation', (e) => { v.ttfb = Math.round(e.responseStart); });

  // Battery level override.
  if (opts.battery != null) {
    const b: any = new EventTarget();
    Object.assign(b, { level: opts.battery, charging: false, chargingTime: Infinity, dischargingTime: 3600 });
    (navigator as any).getBattery = () => Promise.resolve(b);
  }

  // safe-area polyfill: only used when the engine can't override env(safe-area-inset-*) natively.
  if (opts.safeArea) {
    const sa = opts.safeArea;
    const fix = () => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (let i = rules.length - 1; i >= 0; i--) {
          const r = rules[i]!;
          if ((r as any).__bezels || !r.cssText.includes('safe-area-inset')) continue;
          const txt = r.cssText.replace(/env\(\s*safe-area-inset-(top|bottom|left|right)\s*(?:,[^)]*)?\)/g, (_m, k) => `${(sa as any)[k]}px`);
          try { sheet.insertRule(txt, i + 1); (sheet.cssRules[i + 1] as any).__bezels = true; (r as any).__bezels = true; } catch { /* ignore */ }
        }
      }
    };
    addEventListener('DOMContentLoaded', fix);
    addEventListener('load', fix);
    document.documentElement.style.setProperty('--bezels-safe-area-approx', '1');
  }
}

/** Unique-ish CSS selector for an element (shared helper, inlined into each function that needs it). */
const SEL = `function __sel(el){if(!el||el.nodeType!==1)return'';if(el.id)return'#'+CSS.escape(el.id);const parts=[];let e=el;for(let i=0;i<4&&e&&e.nodeType===1&&e!==document.documentElement;i++){let p=e.tagName.toLowerCase();if(e.id){parts.unshift('#'+CSS.escape(e.id));break;}const cls=[...e.classList].filter(c=>!/^(css-|sc-|jsx-|_)|[0-9a-f]{5,}|__/.test(c)).slice(0,2);if(cls.length)p+='.'+cls.map(c=>CSS.escape(c)).join('.');const par=e.parentElement;if(par){const same=[...par.children].filter(c=>c.tagName===e.tagName);if(same.length>1&&!cls.length)p+=':nth-of-type('+(same.indexOf(e)+1)+')';}parts.unshift(p);e=e.parentElement;}return parts.join(' > ');}`;

export interface AuditOpts {
  touch: boolean; mobile: boolean; dpr: number;
  obstructions: { rect: { x: number; y: number; w: number; h: number }; label: string }[];
  largeVh: number; vh: number; barsLabel: string;
  telegram: null | { verticalSwipes: boolean };
}

export function auditPage(o: AuditOpts) {
  const sel = __sel;
  const issues: any[] = [];
  const W = document.documentElement.clientWidth;
  const vis = (el: Element) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05; };
  const R = (el: Element) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const all = Array.from(document.body?.querySelectorAll('*') ?? []).filter((e) => !(e as HTMLElement).closest('#__bezels_overlay'));
  const seen = new Set<Element>();

  // 1. Horizontal overflow: report the outermost offenders.
  const se = document.scrollingElement!;
  if (se.scrollWidth > W + 1) {
    let n = 0;
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || !vis(el)) continue;
      if (getComputedStyle(el).position === 'fixed') continue; // fixed boxes stretch with the widened layout viewport: symptom, not cause
      if (r.right > W + 1 || r.left < -1) {
        const p = el.parentElement?.getBoundingClientRect();
        if (p && p.right > W + 1 && el.parentElement !== document.body) continue;
        seen.add(el);
        issues.push({ severity: 'error', type: 'overflow', title: 'Horizontal overflow', selector: sel(el), rect: R(el), message: `${sel(el)} is ${Math.round(Math.max(r.right - W, -r.left))}px wider than the page (page scrolls sideways ${se.scrollWidth - W}px).` });
        if (++n >= 5) break;
      }
    }
    if (!n) issues.push({ severity: 'error', type: 'overflow', title: 'Horizontal overflow', message: `Page is ${se.scrollWidth - W}px wider than the viewport.` });
  }
  // 2. Elements wider than the viewport (clipped by overflow:hidden but still too wide).
  let wide = 0;
  for (const el of all) {
    if (seen.has(el) || wide >= 5) continue;
    const r = el.getBoundingClientRect();
    if (r.width > W + 1 && vis(el) && !(el.parentElement && el.parentElement.getBoundingClientRect().width > W + 1) && !(se.scrollWidth > W + 1 && getComputedStyle(el).position === 'fixed')) {
      const sx = getComputedStyle(el.parentElement ?? el).overflowX;
      if (sx === 'auto' || sx === 'scroll') continue; // intentional scroller
      wide++;
      issues.push({ severity: 'warn', type: 'too-wide', title: 'Element wider than viewport', selector: sel(el), rect: R(el), message: `${sel(el)} is ${Math.round(r.width)}px wide on a ${W}px page (clipped).` });
    }
  }
  // 3. Tap targets.
  if (o.touch) {
    const q = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=switch],[onclick],label[for]';
    let n = 0;
    for (const el of Array.from(document.querySelectorAll(q))) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || !vis(el)) continue;
      if (r.width >= 44 && r.height >= 44) continue;
      const cs = getComputedStyle(el);
      if (el.tagName === 'A' && cs.display === 'inline' && (el.parentElement?.textContent?.length ?? 0) > (el.textContent?.length ?? 0) + 20) continue; // link in running text
      if ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') { const lab = el.closest('label'); if (lab && lab.getBoundingClientRect().height >= 44) continue; }
      issues.push({ severity: 'warn', type: 'tap-target', title: 'Tap target too small', selector: sel(el), rect: R(el), message: `${sel(el)} is ${Math.round(r.width)}×${Math.round(r.height)} (needs 44×44).` });
      if (++n >= 15) break;
    }
  }
  // 4. Small text.
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const small = new Map<Element, number>();
  for (let t = tw.nextNode(); t && small.size < 10; t = tw.nextNode()) {
    if (!t.textContent?.trim()) continue;
    const el = t.parentElement;
    if (!el || small.has(el) || !vis(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12 && el.getBoundingClientRect().width > 0) small.set(el, fs);
  }
  for (const [el, fs] of small) issues.push({ severity: 'info', type: 'small-text', title: 'Small text', selector: sel(el), rect: R(el), message: `${sel(el)} renders at ${fs}px (min 12px).` });

  // 5. Content under notch / home indicator / Telegram controls.
  const inter = (a: any, b: any) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const fixed = all.filter((el) => { const p = getComputedStyle(el).position; return (p === 'fixed' || p === 'sticky') && vis(el) && el.getBoundingClientRect().width > 0; });
  if (o.obstructions.length) {
    const cands = new Set<Element>([...fixed, ...Array.from(document.querySelectorAll('a,button,input,h1,h2,h3,p,img,[role=button]'))]);
    let n = 0;
    for (const el of cands) {
      if (n >= 10 || !vis(el)) continue;
      const r = R(el);
      if (!r.w || !r.h) continue;
      for (const ob of o.obstructions) {
        if (inter(r, ob.rect) > 16) { issues.push({ severity: 'warn', type: 'obscured', title: `Hidden under ${ob.label}`, selector: sel(el), rect: r, message: `${sel(el)} overlaps the ${ob.label} (${ob.rect.h}px). Use env(safe-area-inset-*)${o.telegram ? ' / --tg-content-safe-area-inset-*' : ''}.` }); n++; break; }
      }
    }
  }
  // 6. Fixed elements overlapping each other.
  let ov = 0;
  for (let i = 0; i < fixed.length && ov < 5; i++) for (let j = i + 1; j < fixed.length && ov < 5; j++) {
    const a = fixed[i]!, b = fixed[j]!;
    if (a.contains(b) || b.contains(a)) continue;
    if (getComputedStyle(a).position !== 'fixed' || getComputedStyle(b).position !== 'fixed') continue;
    const area = inter(R(a), R(b));
    if (area > 100) { ov++; issues.push({ severity: 'warn', type: 'fixed-overlap', title: 'Fixed elements overlap', selector: sel(a), rect: R(a), message: `${sel(a)} overlaps ${sel(b)} (${area}px²).` }); }
  }
  // 7. Images.
  let im = 0;
  for (const img of Array.from(document.images)) {
    if (im >= 8 || !img.complete || !img.naturalWidth || !vis(img)) continue;
    const r = img.getBoundingClientRect();
    if (!r.width) continue;
    if (r.width > W + 1) { im++; issues.push({ severity: 'error', type: 'image-overflow', title: 'Image not scaled', selector: sel(img), rect: R(img), message: `${sel(img)} is ${Math.round(r.width)}px wide on a ${W}px page. Add max-width:100%.` }); continue; }
    const need = r.width * o.dpr;
    if (img.naturalWidth > need * 2.5 && img.naturalWidth > 600) { im++; issues.push({ severity: 'info', type: 'image-oversized', title: 'Oversized image', selector: sel(img), rect: R(img), message: `${sel(img)} downloads ${img.naturalWidth}px for a ${Math.round(need)}px slot. Use srcset/sizes.` }); }
    else if (img.naturalWidth < need * 0.6 && !img.src.endsWith('.svg')) { im++; issues.push({ severity: 'info', type: 'image-blurry', title: 'Blurry image', selector: sel(img), rect: R(img), message: `${sel(img)} is ${img.naturalWidth}px for a ${Math.round(need)}px slot at ${o.dpr}×.` }); }
  }
  // 8. vh units (100vh ≠ visible viewport on mobile; Telegram has its own viewport variables).
  const vhRules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list: CSSRuleList) => {
      for (const r of Array.from(list)) {
        if ((r as CSSGroupingRule).cssRules && !(r instanceof CSSStyleRule)) { walk((r as CSSGroupingRule).cssRules); continue; }
        if (!(r instanceof CSSStyleRule)) continue;
        const st = r.style;
        for (const p of ['height', 'min-height', 'max-height', 'top', 'bottom']) {
          const val = st.getPropertyValue(p);
          if (/\b100(d|s|l)?vh\b/.test(val) || (/vh/.test(val) && /calc/.test(val))) { vhRules.push(`${r.selectorText} { ${p}: ${val} }`); break; }
        }
        if (vhRules.length > 20) return;
      }
    };
    walk(rules);
  }
  if (vhRules.length) {
    if (o.telegram) issues.push({ severity: 'warn', type: 'tg-vh', title: 'Uses vh instead of Telegram viewport', message: `${vhRules.slice(0, 3).join('; ')}${vhRules.length > 3 ? ` (+${vhRules.length - 3})` : ''}. Use var(--tg-viewport-stable-height) / --tg-viewport-height.` });
    else if (o.mobile && o.largeVh > o.vh) {
      const first = vhRules[0]!.split(' {')[0]!;
      let el: Element | null = null; try { el = document.querySelector(first); } catch { /* complex selector */ }
      issues.push({ severity: 'warn', type: 'vh', title: `Hidden under browser bar`, selector: el ? sel(el) : first, rect: el ? R(el) : undefined, message: `${vhRules.slice(0, 2).join('; ')}: on this device 100vh = ${o.largeVh}px but only ${o.vh}px are visible with ${o.barsLabel} expanded, so ${o.largeVh - o.vh}px sit under the browser bar. Use 100dvh/100svh.` });
    }
  }
  // 9. Telegram: vertical swipes left on in an app with its own drag/scroll gestures.
  if (o.telegram?.verticalSwipes) {
    const l = (window as any).__bezelsListeners ?? {};
    const scrollers = all.filter((el) => { const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4; }).length;
    if ((l.touchmove ?? 0) + (l.pointermove ?? 0) > 0 || scrollers > 0)
      issues.push({ severity: 'warn', type: 'tg-swipes', title: 'Vertical swipes still enabled', message: `App has ${scrollers} inner scroller(s) and ${(l.touchmove ?? 0) + (l.pointermove ?? 0)} touch/pointer-move listener(s), but never called Telegram.WebApp.disableVerticalSwipes(): a downward drag can close the sheet.` });
  }
  return issues;
}

export interface InspectArg { selector?: string; x?: number; y?: number }
export function inspectEl(a: InspectArg) {
  const sel = __sel;
  const el = a.selector ? document.querySelector(a.selector) : document.elementFromPoint(a.x ?? 0, a.y ?? 0);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const px = (v: string) => parseFloat(v) || 0;
  const box = {
    margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(px),
    border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px),
    padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
    content: { w: Math.round(r.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth)), h: Math.round(r.height - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth)) },
  };
  const keys = ['display', 'position', 'width', 'height', 'min-width', 'max-width', 'margin', 'padding', 'box-sizing', 'font-size', 'font-family', 'font-weight', 'line-height', 'color', 'background-color', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'overflow-x', 'overflow-y', 'z-index', 'top', 'bottom', 'transform', 'container-type'];
  const computed: Record<string, string> = {};
  for (const k of keys) { const v = cs.getPropertyValue(k); if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px') computed[k] = v; }
  const rules: { selector: string; css: string; media?: string; container?: string; active: boolean }[] = [];
  const media: { query: string; matches: boolean }[] = [];
  const containers: string[] = [];
  const walk = (list: CSSRuleList, cond: { media?: string; container?: string }, active: boolean) => {
    for (const rr of Array.from(list)) {
      if (rr instanceof CSSMediaRule) { const m = matchMedia(rr.conditionText).matches; walk(rr.cssRules, { ...cond, media: rr.conditionText }, active && m); continue; }
      if (typeof CSSContainerRule !== 'undefined' && rr instanceof CSSContainerRule) { walk(rr.cssRules, { ...cond, container: rr.conditionText }, active); continue; }
      if ((rr as CSSGroupingRule).cssRules && !(rr instanceof CSSStyleRule)) { walk((rr as CSSGroupingRule).cssRules, cond, active); continue; }
      if (!(rr instanceof CSSStyleRule)) continue;
      let ok = false; try { ok = el.matches(rr.selectorText); } catch { /* */ }
      if (!ok) continue;
      if (rules.length < 30) rules.push({ selector: rr.selectorText, css: rr.style.cssText, media: cond.media, container: cond.container, active });
      if (cond.media && !media.find((m) => m.query === cond.media)) media.push({ query: cond.media, matches: matchMedia(cond.media).matches });
      if (cond.container && !containers.includes(cond.container)) containers.push(cond.container);
    }
  };
  for (const sh of Array.from(document.styleSheets)) { try { walk(sh.cssRules, {}, true); } catch { /* cross-origin */ } }
  const lb = el.getAttribute('aria-labelledby');
  const name = el.getAttribute('aria-label') || (lb && lb.split(' ').map((id) => document.getElementById(id)?.textContent?.trim()).join(' ')) || (el as HTMLImageElement).alt || el.getAttribute('title') || (el as HTMLInputElement).placeholder || el.textContent?.trim().slice(0, 80) || '';
  return {
    selector: sel(el), tag: el.tagName.toLowerCase(), id: el.id, classes: [...el.classList],
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    box, computed, rules, media, containers,
    a11y: { role: el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: 'textbox', IMG: 'img', NAV: 'navigation', H1: 'heading', H2: 'heading', H3: 'heading', SELECT: 'combobox' } as Record<string, string>)[el.tagName] || 'generic', name },
    html: el.outerHTML.slice(0, 400),
  };
}

export function domTree(a: { selector?: string; depth: number }) {
  const sel = __sel;
  const root = a.selector ? document.querySelector(a.selector) : document.body;
  const node = (el: Element, d: number): any => ({
    tag: el.tagName.toLowerCase(), id: el.id || undefined, cls: el.classList.length ? [...el.classList].slice(0, 4).join(' ') : undefined, sel: sel(el),
    text: el.children.length ? undefined : el.textContent?.trim().slice(0, 60) || undefined,
    count: el.children.length,
    children: d > 0 ? Array.from(el.children).filter((c) => c.id !== '__bezels_overlay' && !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'].includes(c.tagName)).slice(0, 40).map((c) => node(c, d - 1)) : undefined,
  });
  return root ? node(root, a.depth) : null;
}

export interface OverlayItem { selector?: string; rect?: { x: number; y: number; w: number; h: number }; label?: string; color?: string; page?: boolean }
export function overlay(a: { items: OverlayItem[]; ms: number; scroll: boolean; id?: string }) {
  const id = a.id ?? '__bezels_overlay';
  document.getElementById(id)?.remove();
  if (!a.items.length) return 0;
  const box = document.createElement('div');
  box.id = id;
  box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  let first: Element | null = null;
  for (const it of a.items) {
    let r = it.rect;
    if (it.selector) {
      let el: Element | null = null; try { el = document.querySelector(it.selector); } catch { /* */ }
      if (el) { first ??= el; }
    }
    if (first && a.scroll && first === (it.selector ? document.querySelector(it.selector) : null)) first.scrollIntoView({ block: 'center', inline: 'nearest' });
    if (it.selector) { const el = document.querySelector(it.selector); if (el) { const b = el.getBoundingClientRect(); r = { x: b.x, y: b.y, w: b.width, h: b.height }; } }
    if (!r) continue;
    if (it.page) r = { ...r, y: r.y - scrollY };
    const c = it.color ?? '#7AA7FF';
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;outline:2px solid ${c};background:${c}22;border-radius:2px`;
    if (it.label) { const l = document.createElement('span'); l.textContent = it.label; l.style.cssText = `position:absolute;left:0;top:-18px;font:600 11px/16px system-ui;background:${c};color:#0E0F12;padding:0 4px;border-radius:3px;white-space:nowrap`; d.appendChild(l); }
    box.appendChild(d);
  }
  document.documentElement.appendChild(box);
  if (a.ms > 0) setTimeout(() => box.remove(), a.ms);
  return box.childElementCount;
}

export function tabOrder() {
  const els = Array.from(document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=true]'))
    .filter((e) => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden');
  const pos = els.filter((e) => e.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
  const order = [...pos, ...els.filter((e) => e.tabIndex === 0)];
  return order.slice(0, 200).map((e, i) => { const r = e.getBoundingClientRect(); return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, label: String(i + 1), color: '#FFB062' }; });
}

export function breakpoints() {
  const out = new Map<number, string>();
  const em = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const add = (cond: string) => {
    for (const m of cond.matchAll(/(min|max)-width\s*:\s*([\d.]+)(px|em|rem)/g)) { const v = Math.round(parseFloat(m[2]!) * (m[3] === 'px' ? 1 : em)); out.set(m[1] === 'max' ? v + 1 : v, out.get(v) ?? m[0]); }
    for (const m of cond.matchAll(/width\s*(>=|>|<=|<)\s*([\d.]+)(px|em|rem)/g)) { const v = Math.round(parseFloat(m[2]!) * (m[3] === 'px' ? 1 : em)); out.set(m[1]!.startsWith('<') ? v + (m[1] === '<=' ? 1 : 0) : v + (m[1] === '>' ? 1 : 0), m[0]); }
  };
  const walk = (list: CSSRuleList) => { for (const r of Array.from(list)) { if (r instanceof CSSMediaRule) { add(r.conditionText); walk(r.cssRules); } else if ((r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules); } };
  for (const sh of Array.from(document.styleSheets)) { try { walk(sh.cssRules); } catch { /* */ } }
  return [...out.entries()].filter(([v]) => v > 0 && v < 4000).sort((a, b) => a[0] - b[0]).map(([px, q]) => ({ px, query: q }));
}

export async function storageOp(a: { op: string; area?: string; key?: string; value?: string; db?: string }) {
  const area = a.area === 'session' ? sessionStorage : localStorage;
  const dump = (s: Storage) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => { const k = s.key(i)!; return [k, (s.getItem(k) ?? '').slice(0, 2000)]; }));
  if (a.op === 'list') {
    const idb = 'databases' in indexedDB ? await indexedDB.databases() : [];
    const dbs = await Promise.all(idb.map((d) => new Promise<any>((res) => {
      const req = indexedDB.open(d.name!);
      req.onsuccess = () => { const db = req.result; const stores = Array.from(db.objectStoreNames); const tx = stores.length ? db.transaction(stores, 'readonly') : null;
        Promise.all(stores.map((s) => new Promise<any>((r2) => { const c = tx!.objectStore(s).count(); c.onsuccess = () => r2({ name: s, count: c.result }); c.onerror = () => r2({ name: s, count: -1 }); })))
          .then((st) => { db.close(); res({ name: d.name, version: d.version, stores: st }); }); };
      req.onerror = () => res({ name: d.name, error: true });
    })));
    const caches_ = 'caches' in self ? await Promise.all((await caches.keys()).map(async (k) => ({ name: k, entries: (await (await caches.open(k)).keys()).length }))) : [];
    return { local: dump(localStorage), session: dump(sessionStorage), indexedDB: dbs, cacheStorage: caches_ };
  }
  if (a.op === 'set') { area.setItem(a.key!, a.value ?? ''); return true; }
  if (a.op === 'remove') { area.removeItem(a.key!); return true; }
  if (a.op === 'clear') {
    if (a.area === 'local' || a.area === 'session') { area.clear(); return true; }
    if (a.area === 'indexedDB') { for (const d of await indexedDB.databases()) if (!a.db || a.db === d.name) indexedDB.deleteDatabase(d.name!); return true; }
    if (a.area === 'cache') { for (const k of await caches.keys()) await caches.delete(k); return true; }
    localStorage.clear(); sessionStorage.clear();
    try { for (const d of await indexedDB.databases()) indexedDB.deleteDatabase(d.name!); } catch { /* */ }
    try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* */ }
    try { for (const r of (await navigator.serviceWorker?.getRegistrations()) ?? []) await r.unregister(); } catch { /* */ }
    return true;
  }
  return null;
}

/** Build an evaluate() expression: fn(arg) with the selector helper in scope. No eval/new Function, so CSP-strict pages work. */
export function script<A>(fn: (a: A) => unknown, arg: A): string {
  return `((a) => { ${SEL}; return (${fn.toString()})(a); })(${JSON.stringify(arg)})`;
}
