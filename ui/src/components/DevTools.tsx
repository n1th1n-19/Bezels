import { useEffect, useMemo, useState } from 'react';
import type { NetEntry, SessionInfo } from '../../../src/shared/types';
import { act, set, toast, useStore, type Panel } from '../store';
import { call } from '../rpc';
import { RUN, setEmulation, setState } from '../actions';
import { Btn, ChromiumOnly, I, Seg, cx, inputCls } from '../ui';
import { AuditList, TgEvents } from './SidePanel';

const PANELS: { v: Panel; l: string }[] = [
  { v: 'elements', l: 'Elements' }, { v: 'console', l: 'Console' }, { v: 'network', l: 'Network' }, { v: 'performance', l: 'Performance' },
  { v: 'storage', l: 'Storage' }, { v: 'a11y', l: 'Accessibility' }, { v: 'audit', l: 'Audit' }, { v: 'telegram', l: 'Telegram' },
];

export function DevTools() {
  const open = useStore((s) => s.devtools);
  const panel = useStore((s) => s.panel);
  const f = useStore((s) => s.sessions.find((x) => x.id === s.focused) ?? s.sessions[0]);
  const errs = useStore((s) => (f ? (s.console[f.id] ?? []).filter((e) => e.level === 'error').length : 0));
  const [h, setH] = useState(320);
  if (!open || !f) return null;
  return (
    <section aria-label="DevTools" className="shrink-0 border-t border-line bg-panel flex flex-col min-h-0" style={{ height: h }}>
      <div className="h-1 cursor-row-resize hover:bg-accent/40 shrink-0" onPointerDown={(e) => {
        const y0 = e.clientY, h0 = h; const mv = (ev: PointerEvent) => setH(Math.max(160, Math.min(innerHeight - 200, h0 - (ev.clientY - y0)))); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
        addEventListener('pointermove', mv); addEventListener('pointerup', up);
      }} />
      <div role="tablist" className="flex items-center border-b border-line px-2 shrink-0 overflow-x-auto">
        {PANELS.map((p) => (
          <button key={p.v} role="tab" type="button" aria-selected={panel === p.v} onClick={() => set({ panel: p.v })}
            className={cx('h-9 px-2.5 text-xs cursor-pointer border-b-2 shrink-0', panel === p.v ? 'border-accent text-text font-semibold' : 'border-transparent text-muted hover:text-text')}>
            {p.l}{p.v === 'console' && errs ? <span className="ml-1 text-[10px] px-1.5 rounded-lg bg-errsolid text-white">{errs}</span> : null}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-xs text-muted px-2 shrink-0">Device: {f.deviceName}{f.engine === 'webkit' ? ' (WebKit)' : ''}</span>
        <Btn variant="ghost" size="sm" label="Close DevTools" cmd="devtools" onClick={() => set({ devtools: false })}>{I.x}</Btn>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {panel === 'elements' && <Elements s={f} />}
        {panel === 'console' && <Console s={f} />}
        {panel === 'network' && <Network s={f} />}
        {panel === 'performance' && <Performance s={f} />}
        {panel === 'storage' && <Storage s={f} />}
        {panel === 'a11y' && <A11y s={f} />}
        {panel === 'audit' && <div className="p-3 overflow-auto h-full flex flex-col gap-2 max-w-[900px]"><AuditList /></div>}
        {panel === 'telegram' && <div className="p-3 overflow-auto h-full"><TgEvents s={f} />{!f.state.telegram.enabled && <span className="text-muted">Telegram mode is off for this device (Shift+T).</span>}</div>}
      </div>
    </section>
  );
}

// ---------------- Elements ----------------
function Elements({ s }: { s: SessionInfo }) {
  const inspected = useStore((st) => st.inspected);
  const inspecting = useStore((st) => st.inspecting);
  const [tree, setTree] = useState<any>(null);
  useEffect(() => { call('dom_tree', { session: s.id, depth: 3 }).then(setTree, () => setTree(null)); }, [s.id, s.url]);
  const pick = (selector: string) => act('inspect', { session: s.id, selector }).then((r) => r && set({ inspected: r }));
  return (
    <div className="flex h-full min-h-0">
      <div className="w-[45%] min-w-0 border-r border-line overflow-auto p-2 font-mono text-[11px]">
        <div className="flex gap-1.5 mb-2 font-sans">
          <Btn size="sm" variant="raised" active={inspecting} cmd="inspect" label="Pick an element on the device" onClick={() => RUN.inspect!()}>{I.inspect} {inspecting ? 'Tap the device…' : 'Inspect'}</Btn>
          <Btn size="sm" variant="ghost" onClick={() => call('dom_tree', { session: s.id, depth: 3 }).then(setTree)}>Refresh</Btn>
        </div>
        {tree ? <Node n={tree} session={s.id} onPick={pick} selected={inspected?.selector} /> : <span className="text-muted">…</span>}
      </div>
      <div className="flex-1 min-w-0 overflow-auto p-3">{inspected ? <Inspected i={inspected} /> : <span className="text-muted">Pick an element (I, then tap the device) or click a node.</span>}</div>
    </div>
  );
}

function Node({ n, session, onPick, selected, depth = 0 }: { n: any; session: string; onPick: (sel: string) => void; selected?: string; depth?: number }) {
  const [kids, setKids] = useState<any[] | undefined>(n.children);
  const [open, setOpen] = useState(depth < 2);
  const expandable = n.count > 0;
  const toggle = async () => {
    if (!open && !kids) { const t: any = await call('dom_tree', { session, selector: n.sel, depth: 1 }).catch(() => null); setKids(t?.children ?? []); }
    setOpen(!open);
  };
  return (
    <div style={{ paddingLeft: depth ? 12 : 0 }}>
      <div className={cx('flex items-center gap-1 rounded px-1 cursor-pointer hover:bg-raised', selected === n.sel && 'bg-accentbg')}
        onMouseEnter={() => call('highlight', { session, items: [{ selector: n.sel }], ms: 1200 }).catch(() => {})}
        onClick={() => onPick(n.sel)}>
        <span className="w-3 text-muted" onClick={(e) => { e.stopPropagation(); if (expandable) toggle(); }}>{expandable ? <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }}><path d="M2 1l4 3-4 3z" fill="currentColor" /></svg> : ''}</span>
        <span className="text-[#E8A0F0]">&lt;{n.tag}</span>{n.id && <span className="text-[#FFB062]"> #{n.id}</span>}{n.cls && <span className="text-accent"> .{n.cls.split(' ').join('.')}</span>}<span className="text-[#E8A0F0]">&gt;</span>
        {n.text && <span className="text-soft truncate"> {n.text}</span>}
      </div>
      {open && kids?.map((c: any, i: number) => <Node key={i} n={c} session={session} onPick={onPick} selected={selected} depth={depth + 1} />)}
    </div>
  );
}

function Inspected({ i }: { i: any }) {
  const b = i.box;
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="font-mono"><span className="text-[#E8A0F0]">{i.tag}</span><span className="text-accent">{i.id ? `#${i.id}` : ''}{i.classes.length ? '.' + i.classes.join('.') : ''}</span> <span className="text-muted">{i.rect.w}×{i.rect.h} at {i.rect.x},{i.rect.y}</span></div>
      <div className="flex gap-4 flex-wrap">
        <div className="font-mono text-[10px] text-center">
          <div className="border border-dashed border-warn/70 bg-warn/10 p-1.5">margin {b.margin[0]}
            <div className="flex items-center gap-1"><span>{b.margin[3]}</span>
              <div className="border border-[#ffd27f] bg-[#ffd27f22] p-1.5 flex-1">border {b.border[0]}
                <div className="border border-ok/70 bg-ok/10 p-1.5">padding {b.padding[0]}
                  <div className="flex items-center gap-1"><span>{b.padding[3]}</span><div className="bg-accent/25 border border-accent px-2 py-1.5 flex-1">{b.content.w}×{b.content.h}</div><span>{b.padding[1]}</span></div>{b.padding[2]}
                </div>{b.border[2]}
              </div><span>{b.margin[1]}</span></div>{b.margin[2]}
          </div>
        </div>
        <div className="flex flex-col gap-1 min-w-[200px]">
          <div className="text-muted uppercase tracking-wider text-[10px]">Accessibility</div>
          <div>role <b>{i.a11y.role}</b></div><div>name “{i.a11y.name || '—'}” {i.a11y.source === 'chromium-ax' ? <span className="text-muted">(Chromium AX tree)</span> : <span className="text-muted">(heuristic)</span>}</div>
          {i.media.length > 0 && <><div className="text-muted uppercase tracking-wider text-[10px] mt-2">Media queries affecting it</div>{i.media.map((m: any) => <div key={m.query} className="font-mono"><span className={m.matches ? 'text-ok' : 'text-muted line-through'}>@media {m.query}</span></div>)}</>}
          {i.containers.length > 0 && <><div className="text-muted uppercase tracking-wider text-[10px] mt-2">Container queries</div>{i.containers.map((c: string) => <div key={c} className="font-mono">@container {c}</div>)}</>}
        </div>
      </div>
      <div className="text-muted uppercase tracking-wider text-[10px]">Styles (matching rules)</div>
      <div className="flex flex-col gap-1.5 font-mono text-[11px]">
        {i.rules.map((r: any, k: number) => (
          <div key={k} className={cx('border border-line rounded p-1.5', !r.active && 'opacity-50')}>
            {(r.media || r.container) && <div className="text-muted">{r.media ? `@media ${r.media}` : ''} {r.container ? `@container ${r.container}` : ''}</div>}
            <span className="text-accent">{r.selector}</span> {'{'} <span className="text-soft">{r.css}</span> {'}'}
          </div>
        ))}
        {!i.rules.length && <span className="text-muted">No same-origin rules (cross-origin stylesheets can't be read).</span>}
      </div>
      <div className="text-muted uppercase tracking-wider text-[10px]">Computed</div>
      <div className="grid gap-x-4 font-mono text-[11px]" style={{ gridTemplateColumns: 'max-content 1fr' }}>
        {Object.entries(i.computed).flatMap(([k, v]) => [<span key={k} className="text-[#9CDCFE]">{k}</span>, <span key={k + 'v'} className="text-soft break-all">{String(v)}</span>])}
      </div>
    </div>
  );
}

// ---------------- Console ----------------
function Console({ s }: { s: SessionInfo }) {
  const entries = useStore((st) => st.console[s.id] ?? []);
  const [level, setLevel] = useState('all');
  const [q, setQ] = useState('');
  const [preserve, setPreserve] = useState(false);
  const [js, setJs] = useState('');
  const [out, setOut] = useState<{ in: string; out: string; err?: boolean }[]>([]);
  const list = entries.filter((e) => (level === 'all' || e.level === level || (level === 'warning' && e.level === 'warn')) && (!q || e.text.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-2 h-9 border-b border-line shrink-0">
        <input aria-label="Filter console" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} className={cx(inputCls, 'h-7 w-48')} />
        <Seg small value={level} onChange={setLevel} options={[{ v: 'all', l: 'All' }, { v: 'error', l: 'Errors' }, { v: 'warning', l: 'Warnings' }, { v: 'log', l: 'Logs' }, { v: 'info', l: 'Info' }]} />
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={preserve} onChange={(e) => { setPreserve(e.target.checked); act('console_preserve', { session: s.id, on: e.target.checked }); }} />Preserve log</label>
        <div className="flex-1" />
        <Btn size="sm" variant="ghost" cmd="clearPanel" label="Clear console" onClick={() => RUN.clearPanel!()}>Clear</Btn>
      </div>
      <div className="flex-1 min-h-0 overflow-auto font-mono text-[11px]">
        {list.map((e) => (
          <div key={e.id} className={cx('px-3 py-1 border-b border-line/40 flex gap-3', e.level === 'error' ? 'bg-errbg text-err' : e.level === 'warning' ? 'bg-warnbg text-warn' : 'text-soft')}>
            <div className="flex-1 min-w-0 whitespace-pre-wrap break-words">{e.text}{e.stack && <details><summary className="cursor-pointer text-muted">stack</summary><pre className="m-0 text-muted whitespace-pre-wrap">{e.stack}</pre></details>}</div>
            {e.url && (
              <button type="button" className="text-muted shrink-0 underline decoration-dotted cursor-pointer hover:text-text text-right" title="Resolve through the source map"
                onClick={async () => { const r: any = await act('resolve_source', { session: s.id, id: e.id }); if (r?.mapped) set((st) => ({ console: { ...st.console, [s.id]: (st.console[s.id] ?? []).map((x) => (x.id === e.id ? { ...x, mapped: r.mapped } : x)) } })); else toast('No source map for this file'); }}>
                {e.mapped ?? `${e.url.split('/').pop()?.split('?')[0]}:${e.line}`}
              </button>
            )}
          </div>
        ))}
        {out.map((o, i) => <div key={'o' + i} className="px-3 py-1 border-b border-line/40"><div className="text-accent">› {o.in}</div><div className={cx('whitespace-pre-wrap', o.err ? 'text-err' : 'text-text')}>{o.out}</div></div>)}
      </div>
      <form className="flex items-center gap-2 px-3 h-9 border-t border-line shrink-0" onSubmit={async (e) => {
        e.preventDefault(); if (!js.trim()) return;
        try { setOut((o) => [...o, { in: js, out: '…' }]); const r = await call('eval', { session: s.id, js }); setOut((o) => [...o.slice(0, -1), { in: js, out: r }]); }
        catch (err) { setOut((o) => [...o.slice(0, -1), { in: js, out: (err as Error).message, err: true }]); }
        setJs('');
      }}>
        <span className="text-accent font-mono">›</span>
        <input aria-label="Run JavaScript in the page" value={js} onChange={(e) => setJs(e.target.value)} placeholder="Run JavaScript in the page (await ok)" className="flex-1 bg-transparent outline-none font-mono text-xs text-text" />
      </form>
    </div>
  );
}

// ---------------- Network ----------------
const FILTERS: [string, (e: NetEntry) => boolean][] = [
  ['All', () => true], ['Fetch/XHR', (e) => e.type === 'fetch' || e.type === 'xhr'], ['JS', (e) => e.type === 'script'], ['CSS', (e) => e.type === 'stylesheet'],
  ['Img', (e) => e.type === 'image'], ['Font', (e) => e.type === 'font'], ['Doc', (e) => e.type === 'document'], ['WS', (e) => e.type === 'websocket'],
];
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} kB` : `${n} B`);

function Network({ s }: { s: SessionInfo }) {
  const entries = useStore((st) => st.network[s.id] ?? []);
  const [f, setF] = useState('All');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [block, setBlock] = useState((s.state.emulation.blocked ?? []).join(', '));
  const [vitals, setVitals] = useState<any>(null);
  useEffect(() => { call('perf_metrics', { session: s.id }).then((r: any) => setVitals(r.vitals), () => {}); }, [s.id, entries.length > 0 && entries[entries.length - 1]!.pending]);
  const fn = FILTERS.find((x) => x[0] === f)![1];
  const list = entries.filter((e) => fn(e) && (!q || e.url.includes(q)));
  const t0 = Math.min(...entries.map((e) => e.start), Date.now());
  const tEnd = Math.max(...entries.map((e) => e.start + e.duration), t0 + 1);
  const span = tEnd - t0;
  const em = s.state.emulation;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-line shrink-0">
        <input aria-label="Filter requests" placeholder="Filter requests" value={q} onChange={(e) => setQ(e.target.value)} className={cx(inputCls, 'h-7 w-40')} />
        <div className="flex gap-0.5">{FILTERS.map(([n]) => <button key={n} type="button" onClick={() => setF(n)} className={cx('h-6 px-2 rounded text-[11px] cursor-pointer', f === n ? 'bg-line text-text' : 'text-muted hover:text-text')}>{n}</button>)}</div>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!em.cacheDisabled} onChange={(e) => setEmulation({ cacheDisabled: e.target.checked })} />Disable cache</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={s.state.network === 'offline'} onChange={(e) => setState({ network: e.target.checked ? 'offline' : 'none' })} />Offline</label>
        <select aria-label="Throttling" className="h-7 rounded-md border border-line bg-bg text-xs px-1" value={s.state.network === 'offline' ? 'none' : s.state.network} onChange={(e) => setState({ network: e.target.value as any })}>
          <option value="none">No throttling</option><option value="fast4g">Fast 4G</option><option value="slow4g">Slow 4G</option><option value="3g">3G</option><option value="custom">Custom…</option>
        </select>
        {s.state.network === 'custom' && <CustomNet s={s} />}
        <ChromiumOnly engine={s.engine} />
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); act('block_urls', { session: s.id, patterns: block.split(',').map((x) => x.trim()).filter(Boolean) }); }}>
          <input aria-label="Block URL pattern" placeholder="Block e.g. **/*.woff2" value={block} onChange={(e) => setBlock(e.target.value)} className={cx(inputCls, 'h-7 w-44 font-mono')} /><Btn size="sm" variant="ghost" type="submit">Block</Btn>
        </form>
        <div className="flex-1" />
        <Btn size="sm" variant="ghost" onClick={() => act('har', { session: s.id }).then((r: any) => r && window.open(`/shots/${encodeURIComponent(r.file)}?download`))}>Export HAR</Btn>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 bg-panel text-muted"><tr className="text-left border-b border-line">{['Name', 'Status', 'Type', 'Size', 'Time', 'Waterfall'].map((h) => <th key={h} className="font-normal px-2 h-7">{h}</th>)}</tr></thead>
            <tbody>
              {list.map((e) => {
                const name = (() => { try { const u = new URL(e.url); return (u.pathname.split('/').filter(Boolean).pop() ?? u.host) + u.search; } catch { return e.url; } })();
                const bad = e.failed || e.status >= 400;
                return (
                  <tr key={e.id} onClick={() => setSel(e.id)} className={cx('border-b border-line/40 cursor-pointer', sel === e.id ? 'bg-accentbg' : 'hover:bg-raised', bad && 'text-err')}>
                    <td className="px-2 h-6 max-w-[320px] truncate font-mono" title={e.url}>{name}</td>
                    <td className="px-2">{e.failed ? '(failed)' : e.pending ? 'pending' : e.status}</td>
                    <td className="px-2 text-muted">{e.type}</td>
                    <td className="px-2 text-muted">{e.size ? kb(e.size) : e.fromCache ? 'cache' : '—'}</td>
                    <td className="px-2 text-muted">{e.pending ? '…' : `${e.duration} ms`}</td>
                    <td className="px-2 w-[24%]"><div className="relative h-2"><div className={cx('absolute h-2 rounded-sm', bad ? 'bg-err' : 'bg-accent')} style={{ left: `${((e.start - t0) / span) * 100}%`, width: `${Math.max(0.6, (e.duration / span) * 100)}%` }} /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sel !== null && <RequestDetail session={s.id} id={sel} onClose={() => setSel(null)} />}
      </div>
      <div className="flex gap-4 px-3 h-7 items-center border-t border-line text-[11px] text-muted shrink-0">
        <span>{entries.length} requests</span><span>{kb(entries.reduce((a, e) => a + e.size, 0))} transferred</span><span>Finished {(span / 1000).toFixed(1)} s</span>
        {vitals && <span>LCP {vitals.lcp ?? '—'} ms · CLS {vitals.cls ?? 0} · INP {vitals.inp ?? '—'} ms</span>}
        <span className="flex-1 text-right">Click a row for headers, payload, response, timing</span>
      </div>
    </div>
  );
}

function CustomNet({ s }: { s: SessionInfo }) {
  const c = s.state.emulation.customNetwork ?? { downloadKbps: 1000, uploadKbps: 500, latencyMs: 200 };
  return <span className="flex gap-1 items-center text-[11px]">↓<input type="number" className={cx(inputCls, 'h-7 w-16')} defaultValue={c.downloadKbps} onBlur={(e) => setEmulation({ customNetwork: { ...c, downloadKbps: +e.target.value } })} />↑<input type="number" className={cx(inputCls, 'h-7 w-16')} defaultValue={c.uploadKbps} onBlur={(e) => setEmulation({ customNetwork: { ...c, uploadKbps: +e.target.value } })} />kbps<input type="number" className={cx(inputCls, 'h-7 w-14')} defaultValue={c.latencyMs} onBlur={(e) => setEmulation({ customNetwork: { ...c, latencyMs: +e.target.value } })} />ms</span>;
}

function RequestDetail({ session, id, onClose }: { session: string; id: number; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState('headers');
  useEffect(() => { setD(null); call('request_detail', { session, id }).then(setD, (e) => setD({ error: e.message })); }, [session, id]);
  const hdr = (o: Record<string, string> | null) => o ? Object.entries(o).map(([k, v]) => <div key={k} className="break-all"><span className="text-[#9CDCFE]">{k}</span>: <span className="text-soft">{v}</span></div>) : null;
  return (
    <div className="w-[42%] border-l border-line flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-2 h-8 border-b border-line shrink-0">
        <Seg small value={tab} onChange={setTab} options={[{ v: 'headers', l: 'Headers' }, { v: 'payload', l: 'Payload' }, { v: 'response', l: 'Response' }, { v: 'timing', l: 'Timing' }]} />
        <div className="flex-1" /><Btn size="sm" variant="ghost" label="Close" onClick={onClose}>{I.x}</Btn>
      </div>
      <div className="flex-1 overflow-auto p-2 font-mono text-[11px]">
        {!d ? '…' : d.error ? <span className="text-err">{d.error}</span>
          : tab === 'headers' ? <><div className="mb-2 break-all"><b>{d.method}</b> {d.url} → {d.status}</div><div className="text-muted mb-1">Request</div>{hdr(d.requestHeaders)}<div className="text-muted my-1">Response</div>{hdr(d.responseHeaders)}</>
          : tab === 'payload' ? <pre className="whitespace-pre-wrap m-0">{d.payload ?? '(no body)'}</pre>
          : tab === 'response' ? <pre className="whitespace-pre-wrap m-0">{d.response ?? '(no body)'}</pre>
          : <div>{Object.entries(d.timing ?? {}).map(([k, v]) => <div key={k}>{k}: {typeof v === 'number' ? (v as number).toFixed(1) : String(v)}</div>)}</div>}
      </div>
    </div>
  );
}

// ---------------- Performance ----------------
function Performance({ s }: { s: SessionInfo }) {
  const [p, setP] = useState<any>(null);
  const load = () => call('perf_metrics', { session: s.id }).then(setP, (e) => toast(e.message, true));
  useEffect(() => { load(); }, [s.id]);
  const v = p?.vitals ?? {};
  const card = (name: string, val: number | null | undefined, unit: string, good: number, poor: number) => {
    const tone = val == null ? 'text-muted' : val <= good ? 'text-ok' : val <= poor ? 'text-warn' : 'text-err';
    return <div className="border border-line rounded-lg p-3 min-w-[110px]"><div className="text-[11px] text-muted">{name}</div><div className={cx('text-xl font-semibold font-mono', tone)}>{val == null ? '—' : `${val}${unit}`}</div></div>;
  };
  return (
    <div className="p-3 overflow-auto h-full flex flex-col gap-3">
      <div className="flex gap-2 items-center flex-wrap">
        <Btn size="sm" variant="raised" onClick={load}>Refresh</Btn>
        <Btn size="sm" variant="raised" onClick={() => act('reload', { session: s.id }).then(() => setTimeout(load, 1500))}>Reload & measure</Btn>
        <Btn size="sm" variant="raised" onClick={() => act('show_layout_shifts', { session: s.id })}>Highlight layout shifts</Btn>
        <span className="text-xs text-muted ml-2">CPU throttle</span>
        <Seg small value={String(s.state.cpu)} onChange={(c) => setState({ cpu: +c })} options={[{ v: '1', l: 'None' }, { v: '4', l: '4×' }, { v: '6', l: '6×' }]} />
        <ChromiumOnly engine={s.engine} />
      </div>
      <div className="flex gap-2 flex-wrap">
        {card('LCP', v.lcp, ' ms', 2500, 4000)}{card('CLS', v.cls, '', 0.1, 0.25)}{card('INP', v.inp, ' ms', 200, 500)}{card('TTFB', v.ttfb, ' ms', 800, 1800)}{card('FCP', v.fcp, ' ms', 1800, 3000)}
      </div>
      {p?.metrics && <div className="grid gap-x-6 text-xs font-mono" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>{Object.entries(p.metrics).map(([k, val]) => <div key={k} className="flex justify-between border-b border-line/40 py-1"><span className="text-muted">{k}</span><span>{String(val)}{k.startsWith('JSHeap') ? ' MB' : ''}</span></div>)}</div>}
      <div className="text-[11px] text-muted uppercase tracking-wider">Long tasks ({v.longTasks?.length ?? 0})</div>
      <div className="flex flex-col gap-0.5 font-mono text-[11px]">{(v.longTasks ?? []).slice(-30).map((t: any, i: number) => <div key={i}>at {t.start} ms · <span className={t.duration > 200 ? 'text-err' : 'text-warn'}>{t.duration} ms</span></div>)}</div>
      {p?.note && <div className="text-xs text-muted">{p.note}</div>}
    </div>
  );
}

// ---------------- Storage ----------------
function Storage({ s }: { s: SessionInfo }) {
  const [area, setArea] = useState('local');
  const [data, setData] = useState<any>(null);
  const [k, setK] = useState(''), [v, setV] = useState('');
  const load = () => call('storage', { session: s.id, op: 'list' }).then(setData, (e) => toast(e.message, true));
  useEffect(() => { load(); }, [s.id, s.url]);
  const op = async (p: object) => { await act('storage', { session: s.id, ...p }); load(); };
  const rows: [string, string][] = !data ? [] : area === 'local' ? Object.entries(data.local) : area === 'session' ? Object.entries(data.session) : area === 'cookies' ? data.cookies.map((c: any) => [c.name, `${c.value}  (${c.domain}${c.path}${c.httpOnly ? ', HttpOnly' : ''}${c.secure ? ', Secure' : ''})`]) : area === 'telegram' ? Object.entries(data.telegram?.CloudStorage ?? {}) : [];
  const editable = ['local', 'session', 'cookies'].includes(area);
  return (
    <div className="flex h-full min-h-0">
      <div className="w-44 border-r border-line p-2 flex flex-col gap-0.5 text-xs">
        {[['local', 'Local storage'], ['session', 'Session storage'], ['cookies', 'Cookies'], ['indexedDB', 'IndexedDB'], ['cache', 'Cache storage'], ...(s.state.telegram.enabled ? [['telegram', 'Telegram CloudStorage']] : [])].map(([a, l]) => (
          <button key={a} type="button" onClick={() => setArea(a!)} className={cx('text-left h-7 px-2 rounded cursor-pointer', area === a ? 'bg-accentbg text-accentfg' : 'hover:bg-raised')}>{l}</button>
        ))}
        <div className="flex-1" />
        <Btn size="sm" variant="danger" cmd="freshVisit" label="Fresh visit: clear everything and reload" onClick={() => RUN.freshVisit!()}>Fresh visit</Btn>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 px-2 h-9 border-b border-line">
          <Btn size="sm" variant="ghost" onClick={load}>Refresh</Btn>
          <Btn size="sm" variant="ghost" onClick={() => op({ op: 'clear', area: area === 'indexedDB' ? 'indexedDB' : area === 'cache' ? 'cache' : area })}>Clear {area}</Btn>
          {editable && <form className="flex gap-1 items-center" onSubmit={(e) => { e.preventDefault(); if (k) op({ op: 'set', area, key: k, value: v }).then(() => { setK(''); setV(''); }); }}><input aria-label="Key" placeholder="key" value={k} onChange={(e) => setK(e.target.value)} className={cx(inputCls, 'h-7 w-32')} /><input aria-label="Value" placeholder="value" value={v} onChange={(e) => setV(e.target.value)} className={cx(inputCls, 'h-7 w-48')} /><Btn size="sm" variant="raised" type="submit">Set</Btn></form>}
        </div>
        <div className="flex-1 overflow-auto font-mono text-[11px]">
          {area === 'indexedDB' && (data?.indexedDB ?? []).map((d: any) => <div key={d.name} className="px-3 py-1.5 border-b border-line/40"><b>{d.name}</b> v{d.version} {d.stores?.map((st: any) => <span key={st.name} className="ml-3 text-muted">{st.name} ({st.count})</span>)}<Btn size="sm" variant="ghost" className="ml-2" onClick={() => op({ op: 'clear', area: 'indexedDB', db: d.name })}>Delete</Btn></div>)}
          {area === 'cache' && (data?.cacheStorage ?? []).map((c: any) => <div key={c.name} className="px-3 py-1.5 border-b border-line/40">{c.name} <span className="text-muted">{c.entries} entries</span></div>)}
          {rows.map(([key, val]) => (
            <div key={key} className="flex gap-3 px-3 py-1 border-b border-line/40 items-start group">
              <span className="text-[#9CDCFE] w-48 shrink-0 break-all">{key}</span><span className="flex-1 break-all text-soft">{val}</span>
              {editable && <button type="button" className="text-muted hover:text-err opacity-0 group-hover:opacity-100 cursor-pointer" aria-label={`Delete ${key}`} onClick={() => op({ op: 'remove', area, key })}>{I.x}</button>}
            </div>
          ))}
          {data && !rows.length && !['indexedDB', 'cache'].includes(area) && <div className="p-3 text-muted font-sans">Empty</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------- Accessibility ----------------
function A11y({ s }: { s: SessionInfo }) {
  const [r, setR] = useState<any>(null);
  const [tabs, setTabs] = useState(false);
  const inspected = useStore((st) => st.inspected);
  const counts = useMemo(() => r?.violations.reduce((a: any, v: any) => ({ ...a, [v.impact]: (a[v.impact] ?? 0) + 1 }), {}), [r]);
  return (
    <div className="p-3 overflow-auto h-full flex flex-col gap-3">
      <div className="flex gap-2 items-center flex-wrap">
        <Btn size="sm" variant="primary" onClick={() => act('a11y_audit', { session: s.id }, 'Running axe-core…').then(setR)}>Run axe audit</Btn>
        <Btn size="sm" variant="raised" active={tabs} onClick={() => { setTabs(!tabs); act('tab_order', { session: s.id, show: !tabs }); }}>Tab order overlay</Btn>
        <Btn size="sm" variant="raised" cmd="inspect" label="Tap an element to see its accessible name" onClick={() => RUN.inspect!()}>Accessible name of tapped element</Btn>
        {counts && <span className="text-xs text-muted">{Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(' · ')} · {r.passes} rules passed</span>}
      </div>
      {inspected && <div className="text-xs p-2 rounded border border-line bg-raised">Tapped <code className="font-mono">{inspected.selector}</code>: role <b>{inspected.a11y.role}</b>, name “{inspected.a11y.name || '—'}”</div>}
      {r?.violations.map((v: any) => (
        <div key={v.id} className={cx('border rounded-lg p-2.5 flex flex-col gap-1', v.impact === 'critical' || v.impact === 'serious' ? 'border-errline bg-errbg' : 'border-warnline bg-warnbg')}>
          <div className="flex gap-2 items-center"><span className="text-[10px] font-bold uppercase">{v.impact}</span><span className="font-semibold">{v.help}</span><span className="text-muted text-xs">({v.count})</span><a href={v.helpUrl} target="_blank" rel="noreferrer" className="text-xs ml-auto">rule</a></div>
          {v.nodes.map((n: any, i: number) => <button key={i} type="button" className="text-left font-mono text-[11px] text-soft hover:text-text cursor-pointer" title={n.summary} onClick={() => act('highlight', { session: s.id, items: [{ selector: n.target, label: v.id, color: '#FF7A7A' }] })}>{n.target}</button>)}
        </div>
      ))}
      {r && !r.violations.length && <div className="text-ok">No axe violations.</div>}
    </div>
  );
}
