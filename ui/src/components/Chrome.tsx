import { useEffect, useMemo, useRef, useState } from 'react';
import type { Device } from '../../../src/shared/types';
import { act, get, set, toast, useStore } from '../store';
import { RUN, copyShotMeta, download, goUrl, openSet, setState, toggleCompare, toggleDevice } from '../actions';
import { Btn, I, Kbd, Seg, cx, inputCls, tip, useKey } from '../ui';

const SET_CHIPS: [string, string][] = [['phones', 'All phones'], ['folds', 'Foldables'], ['tablets', 'Tablets'], ['desktop', 'Desktop'], ['telegram', 'Telegram']];

export function TopBar() {
  const url = useStore((s) => s.url);
  const urlFocus = useStore((s) => s.urlFocus);
  const setName = useStore((s) => s.setName);
  const sessions = useStore((s) => s.sessions);
  const view = useStore((s) => s.view);
  const zoom = useStore((s) => s.zoom);
  const fitZoom = useStore((s) => s.fitZoom);
  const stats = useStore((s) => s.stats);
  const mcp = useStore((s) => s.mcpActive);
  const paused = useStore((s) => s.agentPaused);
  const devtools = useStore((s) => s.devtools);
  const sensors = useStore((s) => s.sensors);
  const [draft, setDraft] = useState(url);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(url), [url]);
  useEffect(() => { if (urlFocus) { inp.current?.focus(); inp.current?.select(); } }, [urlFocus]);
  const kReload = useKey('hardReloadAll');
  const pct = stats ? Math.min(100, Math.round((stats.totalMB / stats.budgetMB) * 100)) : 0;
  const z = Math.round((zoom === 'fit' ? fitZoom : zoom) * 100);
  const mixedLabel = setName === 'mixed' ? 'Mixed set' : setName === 'custom' ? 'Custom set' : get().catalog?.sets[setName]?.label ?? setName;
  return (
    <header className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-line bg-panel shrink-0">
      <div className="flex items-center gap-2 mr-1">{I.logo}<span className="font-bold text-base tracking-tight">bezels</span></div>
      <form className="flex items-center gap-1.5 flex-[1_1_200px] max-w-[380px] bg-bg border border-line rounded-lg pl-2.5 pr-1.5 h-[34px] focus-within:border-accent"
        onSubmit={(e) => { e.preventDefault(); goUrl(draft); inp.current?.blur(); }}>
        <label htmlFor="url" className="text-muted text-xs">URL</label>
        <input id="url" ref={inp} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} className="flex-1 min-w-0 bg-transparent border-0 text-text font-mono text-xs outline-none" title={tip('Focus URL bar', 'L')} />
        <button type="button" aria-label="Reload all devices" title={tip('Hard reload all', kReload)} onClick={() => RUN.hardReloadAll!()} className="w-7 h-7 rounded-md bg-raised text-text flex items-center justify-center cursor-pointer hover:bg-line">{I.reload}</button>
      </form>
      <nav aria-label="Device sets" className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => (setName === 'mixed' || setName === 'custom' ? RUN.switchSet!() : openSet('mixed'))} title={tip('Switch device set', 'Shift+D')}
          className={cx('h-[30px] px-2.5 rounded-[15px] border text-xs cursor-pointer whitespace-nowrap', setName === 'mixed' || setName === 'custom' ? 'border-accent bg-accentbg text-accentfg' : 'border-line text-muted hover:text-text')}>
          {setName === 'mixed' || setName === 'custom' ? `${mixedLabel} · ${sessions.length}` : 'Mixed set'}
        </button>
        {SET_CHIPS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => openSet(k)} className={cx('h-[30px] px-2.5 rounded-[15px] border text-xs cursor-pointer whitespace-nowrap', setName === k ? 'border-accent bg-accentbg text-accentfg' : 'border-line text-muted hover:text-text')}>
            {l}{setName === k ? ` · ${sessions.length}` : ''}
          </button>
        ))}
      </nav>
      <div className="flex-1" />
      <Seg label="View" value={view} onChange={(v) => v !== view && toggleCompare()} options={[{ v: 'single', l: 'Single', title: 'Single (V)' }, { v: 'compare', l: 'Compare 2', title: 'Compare 2 (V)' }]} />
      <Btn label="Zoom" title="Zoom: = in, - out, \ fit" onClick={() => set((s) => ({ zoom: s.zoom === 'fit' ? 0.5 : s.zoom === 0.5 ? 0.75 : s.zoom === 0.75 ? 1 : 'fit', pan: { x: 0, y: 0 } }))}>{zoom === 'fit' ? `Fit · ${z}%` : `${z}%`}</Btn>
      <Btn label="DevTools" cmd="devtools" active={devtools} onClick={() => RUN.devtools!()}>DevTools</Btn>
      <Btn label="Full screen: hide all panels" cmd="zen" size="icon" className="!w-[30px]" onClick={() => RUN.zen!()}>{I.expand}</Btn>
      <Btn label="Sensors & emulation" cmd="sensors" active={sensors} onClick={() => RUN.sensors!()}>{I.sensors}</Btn>
      <button type="button" onClick={() => RUN.memory!()} title={tip(`Memory used by Bezels (budget ${stats?.budgetMB ?? 1000} MB)`, 'Shift+M')} className="flex items-center gap-2 h-[30px] px-2.5 rounded-lg border border-line cursor-pointer hover:bg-raised">
        <span className="text-muted text-xs">RAM</span>
        <span className="w-10 h-1.5 rounded bg-line overflow-hidden"><span className="block h-full" style={{ width: `${pct}%`, background: pct > 90 ? '#FF7A7A' : pct > 70 ? '#FFB062' : '#5BD69A' }} /></span>
        <span className="font-mono text-xs">{stats ? `${stats.totalMB} MB` : '…'}</span>
      </button>
      <button type="button" onClick={() => RUN.activity!()} title={tip('Claude Code activity', 'g k')}
        className={cx('flex items-center gap-1.5 h-[30px] px-2.5 rounded-lg border text-xs cursor-pointer', paused ? 'bg-warnbg border-warnline text-warn' : mcp ? 'bg-okbg border-okline text-okfg' : 'border-line text-muted')}>
        <span className={cx('w-2 h-2 rounded-full', paused ? 'bg-warn' : mcp ? 'bg-ok' : 'bg-line2')} />
        {paused ? 'Claude paused' : mcp ? 'Claude Code' : 'Claude idle'}
      </button>
      <Btn variant="ghost" size="icon" label="Settings" cmd="settings" onClick={() => RUN.settings!()}>{I.gear}</Btn>
    </header>
  );
}

const GROUPS: [string, (d: Device) => boolean][] = [
  ['iPhone', (d) => d.os === 'ios'], ['Android', (d) => d.category === 'phone' && d.os === 'android'], ['Foldables', (d) => d.category === 'foldable'],
  ['Tablets', (d) => d.category === 'tablet'], ['Laptops', (d) => d.category === 'laptop'], ['Desktops', (d) => d.category === 'desktop'], ['Custom', (d) => d.category === 'custom'],
];
const ROW = 30;

/** Device library: searchable, grouped, virtualised (only visible rows render). */
export function Library() {
  const devices = useStore((s) => s.catalog?.devices ?? []);
  const sessions = useStore((s) => s.sessions);
  const focused = useStore((s) => s.focused);
  const searchFocus = useStore((s) => s.searchFocus);
  const f = sessions.find((x) => x.id === focused);
  const [q, setQ] = useState('');
  const [scroll, setScroll] = useState(0);
  const [h, setH] = useState(500);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searchFocus) search.current?.focus(); }, [searchFocus]);
  useEffect(() => { const el = box.current!; const ro = new ResizeObserver(() => setH(el.clientHeight)); ro.observe(el); return () => ro.disconnect(); }, []);
  const open = new Set(sessions.map((s) => s.deviceId));
  const rows = useMemo(() => {
    const m = devices.filter((d) => !q || `${d.name} ${d.id} ${d.screen.w}x${d.screen.h}`.toLowerCase().includes(q.toLowerCase()));
    const out: ({ h: string } | { d: Device })[] = [];
    for (const [g, fn] of GROUPS) { const ds = m.filter(fn); if (ds.length) out.push({ h: g }, ...ds.map((d) => ({ d }))); }
    return out;
  }, [devices, q]);
  const start = Math.max(0, Math.floor(scroll / ROW) - 4), end = Math.min(rows.length, Math.ceil((scroll + h) / ROW) + 4);
  return (
    <aside aria-label="Device library" className="w-[250px] shrink-0 border-r border-line bg-panel p-3 flex flex-col gap-3 min-h-0">
      {f && <OpenIn />}
      <label htmlFor="search" className="text-[11px] text-muted uppercase tracking-wider">Devices</label>
      <input id="search" ref={search} placeholder={`Search ${devices.length} devices`} value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { const first = rows.find((r) => 'd' in r) as { d: Device } | undefined; if (first) toggleDevice(first.d.id); } }}
        className={cx(inputCls, 'h-8')} title="Search devices (/)" />
      <div ref={box} className="flex-1 min-h-0 overflow-auto -mx-1 px-1" onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {rows.slice(start, end).map((r, i) => {
            const top = (start + i) * ROW;
            if ('h' in r) return <div key={'h' + r.h} className="absolute inset-x-0 text-[11px] text-muted px-1 flex items-end pb-1" style={{ top, height: ROW }}>{r.h}</div>;
            const d = r.d, on = open.has(d.id);
            return (
              <label key={d.id} className={cx('absolute inset-x-0 flex items-center gap-2 px-1.5 rounded-md cursor-pointer hover:bg-raised', on && 'bg-raised')} style={{ top, height: ROW - 2 }}>
                <input type="checkbox" checked={on} onChange={() => toggleDevice(d.id)} />
                <span className="flex-1 truncate">{d.name}</span>
                <span className="font-mono text-[11px] text-muted">{d.fold ? (sessions.find((s) => s.deviceId === d.id)?.state.fold === 'folded' ? 'folded' : 'open') : `${d.screen.w}×${d.screen.h}`}</span>
              </label>
            );
          })}
        </div>
      </div>
      <Btn className="!border-dashed !border-line2 text-muted h-8" cmd="customDevice" label="Custom size" onClick={() => RUN.customDevice!()}>+ Custom size</Btn>
    </aside>
  );
}

/** "Open in: Safari | PWA | Telegram" for the focused device (from the Focus mockup). */
function OpenIn() {
  const f = useStore((s) => s.sessions.find((x) => x.id === s.focused));
  const d = useStore((s) => s.catalog?.devices.find((x) => x.id === f?.deviceId));
  if (!f || !d) return null;
  const mode = f.state.telegram.enabled ? 'telegram' : f.state.bars === 'pwa' ? 'pwa' : 'browser';
  const bl = { safari: 'Safari', chrome: 'Chrome', samsung: 'Samsung', edge: 'Edge' }[f.state.browser];
  return (
    <div className="flex flex-col gap-2 pb-3 border-b border-line">
      <div className="text-[11px] text-muted uppercase tracking-wider">Device</div>
      <div className="font-semibold">{d.name}</div>
      <div className="text-[11px] text-muted">Open in</div>
      <Seg small value={mode} onChange={(v) => setState(v === 'telegram' ? { telegram: { enabled: true } } : v === 'pwa' ? { bars: 'pwa', telegram: { enabled: false } } : { bars: 'expanded', telegram: { enabled: false } })}
        options={[{ v: 'browser', l: bl }, { v: 'pwa', l: 'PWA' }, { v: 'telegram', l: 'Telegram' }]} />
    </div>
  );
}

export function Tray() {
  const open = useStore((s) => s.tray);
  const shots = useStore((s) => s.shots);
  const kCopy = useKey('copyShot'), kAll = useKey('captureAll');
  if (!open) return null;
  return (
    <footer className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-line bg-panel shrink-0">
      <span className="font-semibold">Screenshots</span>
      <Btn variant="primary" cmd="captureAll" label="Capture all (contact sheet) and copy" onClick={() => RUN.captureAll!()}>Capture all</Btn>
      <div className="flex gap-2.5 flex-1 min-w-0 overflow-x-auto py-0.5">
        {shots.slice(0, 20).map((m, i) => (
          <div key={m.id} className={cx('flex items-center gap-2 pl-1 pr-1.5 py-1 rounded-lg border bg-raised shrink-0', i === 0 ? 'border-accent' : 'border-line')}>
            <img src={m.thumb ? `/shots/.thumbs/${encodeURIComponent(m.thumb)}` : `/shots/${encodeURIComponent(m.file)}`} alt="" loading="lazy" className="h-[52px] w-auto max-w-[80px] rounded-md object-contain bg-bg" />
            <div className="flex flex-col"><span className="text-xs max-w-[140px] truncate">{m.label}</span><span className="text-[11px] text-muted">{m.kind === 'sheet' ? 'contact sheet' : m.framed ? 'framed' : 'plain'}{m.fullPage ? ' · full page' : ''} · {m.source === 'mcp' ? 'by Claude Code' : new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
            <Btn variant="raised" size="icon" label="Copy to clipboard" className="!border-0" onClick={() => copyShotMeta(m)}>{I.copy}</Btn>
            <Btn variant="ghost" size="icon" label="Save PNG" onClick={() => download(m)}>{I.save}</Btn>
            <Btn variant="ghost" size="icon" label="Delete" onClick={() => act('shot_delete', { id: m.id }).then(() => set((s) => ({ shots: s.shots.filter((x) => x.id !== m.id) })))}>{I.trash}</Btn>
          </div>
        ))}
        {!shots.length && <span className="text-muted text-xs self-center">No captures yet. Claude Code's screenshots show up here too.</span>}
      </div>
      <span className="text-muted text-xs">Press <Kbd k={kCopy} /> to copy · <Kbd k={kAll} /> capture all · <Kbd k="?" /> all shortcuts</span>
    </footer>
  );
}

export { toast };
