import { useEffect, useMemo, useRef, useState } from 'react';
import { act, get, set, toast, useStore } from '../store';
import { RUN, commandList, copyImage, openSet, setIds } from '../actions';
import { keymapConflicts, RESERVED, eventToKey } from '../../../src/shared/keymap';
import { Btn, Field, I, Kbd, Modal, Seg, cx, inputCls, keyLabel } from '../ui';

export function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return (
    <div role="status" className={cx('fade-in fixed left-1/2 top-16 -translate-x-1/2 z-[60] flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] font-medium shadow-[0_8px_24px_rgba(0,0,0,.4)] max-w-[80vw]', t.error ? 'bg-errbg text-err border border-errline' : 'bg-text text-bg')}>
      {!t.error && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1D7A4C" strokeWidth="2.5" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>}
      {t.text}
    </div>
  );
}

export function ChordIndicator() {
  const chord = useStore((s) => s.chord);
  return chord ? <div className="fixed bottom-16 right-4 z-50 px-3 py-1.5 rounded-lg bg-raised border border-accent font-mono text-sm text-accentfg">{chord}…</div> : null;
}

export function ShotPopover() {
  const o = useStore((s) => s.shotOpts);
  const framed = useStore((s) => s.framed);
  const f = useStore((s) => s.sessions.find((x) => x.id === s.focused));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) set({ shotPopover: false }); }; setTimeout(() => addEventListener('mousedown', h)); return () => removeEventListener('mousedown', h); }, []);
  const up = (p: Partial<typeof o>) => set({ shotOpts: { ...o, ...p } });
  const dpr = useStore((s) => s.catalog?.devices.find((d) => d.id === f?.deviceId)?.dpr ?? 2);
  return (
    <div ref={ref} className="fade-in absolute top-12 z-40 w-[280px] bg-panel border border-line rounded-xl p-3.5 flex flex-col gap-3 shadow-2xl" role="dialog" aria-label="Screenshot">
      <div className="font-semibold">Screenshot</div>
      <Field label="Area"><Seg value={o.fullPage ? 'full' : 'screen'} onChange={(v) => up({ fullPage: v === 'full' })} options={[{ v: 'screen', l: 'Screen' }, { v: 'full', l: 'Full page' }]} /></Field>
      <Field label="Frame"><Seg value={framed ? 'framed' : 'plain'} onChange={(v) => set({ framed: v === 'framed' })} options={[{ v: 'framed', l: 'With device' }, { v: 'plain', l: 'Plain' }]} /></Field>
      <Field label="Background"><Seg value={o.background} onChange={(v) => up({ background: v })} options={[{ v: 'transparent', l: 'Transparent' }, { v: 'solid', l: 'Solid' }]} /></Field>
      <Field label="Scale"><Seg value={o.scale} onChange={(v) => up({ scale: v })} options={[{ v: 'css', l: '1×' }, { v: 'device', l: `${dpr}× (device)` }]} /></Field>
      <Btn variant="primary" className="h-9" onClick={() => { set({ shotPopover: false }); RUN.copyShot!(); }}>{I.copy} Copy to clipboard</Btn>
      <Btn variant="outline" onClick={() => { set({ shotPopover: false }); RUN.saveShot!(); }}>{I.save} Save PNG</Btn>
      <div className="text-[11px] text-muted flex flex-wrap gap-x-2 gap-y-1"><span><Kbd k="C" /> copy</span><span><Kbd k="Shift+C" /> full page</span><span><Kbd k="S" /> save</span></div>
    </div>
  );
}

export function Palette() {
  const open = useStore((s) => s.palette);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const cmds = useMemo(() => commandList(), [open]);
  const sets = useStore((s) => s.catalog?.sets ?? {});
  const all = useMemo(() => [...cmds, ...Object.entries(sets).map(([k, v]) => ({ id: `set:${k}`, title: `Device set: ${v.label}`, area: 'Sets', key: '' }))], [cmds, sets]);
  const list = all.filter((c) => (c.title + ' ' + c.area).toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  useEffect(() => { setQ(''); setI(0); }, [open]);
  if (!open) return null;
  const run = (id: string) => { set({ palette: false }); if (id.startsWith('set:')) openSet(id.slice(4)); else RUN[id]?.(); };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-center pt-[12vh] p-4" onMouseDown={(e) => e.target === e.currentTarget && set({ palette: false })}>
      <div role="dialog" aria-label="Command palette" className="fade-in w-full max-w-[600px] bg-panel border border-line rounded-xl shadow-2xl flex flex-col max-h-[70vh] overflow-hidden">
        <input autoFocus value={q} placeholder="Type a command…" aria-label="Command"
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } else if (e.key === 'Enter' && list[i]) run(list[i]!.id); }}
          className="h-12 px-4 bg-transparent border-b border-line outline-none text-sm text-text" />
        <div className="overflow-auto py-1" role="listbox">
          {list.map((c, j) => (
            <button key={c.id} type="button" role="option" aria-selected={j === i} onMouseEnter={() => setI(j)} onClick={() => run(c.id)}
              className={cx('w-full flex items-center gap-3 px-4 h-9 text-left cursor-pointer', j === i ? 'bg-accentbg text-accentfg' : 'text-text')}>
              <span className="text-[11px] text-muted w-24 shrink-0">{c.area}</span><span className="flex-1">{c.title}</span><Kbd k={c.key} />
            </button>
          ))}
          {!list.length && <div className="px-4 py-6 text-muted">No command matches</div>}
        </div>
      </div>
    </div>
  );
}

export function Cheatsheet() {
  const open = useStore((s) => s.cheatsheet);
  const [q, setQ] = useState('');
  if (!open) return null;
  const cmds = commandList().filter((c) => !/^device[2-9]$/.test(c.id)).map((c) => (c.id === 'device1' ? { ...c, title: 'Jump to device', key: '1 – 9' } : c));
  const areas = [...new Set(cmds.map((c) => c.area))];
  const match = (c: { title: string; key: string }) => !q || (c.title + c.key).toLowerCase().includes(q.toLowerCase());
  return (
    <div className="fixed inset-0 z-50 bg-[#08090B]/95 overflow-auto p-6" onMouseDown={(e) => e.target === e.currentTarget && set({ cheatsheet: false })}>
      <div className="max-w-[1300px] mx-auto flex flex-col gap-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold m-0 flex-1">Keyboard shortcuts</h1>
          <input autoFocus aria-label="Search shortcuts" placeholder="Search shortcuts" value={q} onChange={(e) => setQ(e.target.value)} className={cx(inputCls, 'w-64 h-9')} />
          <Btn onClick={() => set({ cheatsheet: false, settings: true })}>Edit keymap (<Kbd k="Mod+," />)</Btn>
          <Btn variant="ghost" size="icon" label="Close" onClick={() => set({ cheatsheet: false })}>{I.x}</Btn>
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {areas.map((a) => {
            const items = cmds.filter((c) => c.area === a && match(c));
            if (!items.length) return null;
            return (
              <section key={a} className="bg-panel border border-line rounded-xl p-4">
                <h2 className="text-[11px] uppercase tracking-wider text-muted m-0 mb-2">{a}</h2>
                {items.map((c) => <div key={c.id} className="flex items-center justify-between gap-3 h-8 border-b border-line/50 last:border-0"><span>{c.title}</span>{c.key === '1 – 9' ? <kbd>1 – 9</kbd> : <Kbd k={c.key} />}</div>)}
              </section>
            );
          })}
        </div>
        <p className="text-muted text-xs">Single keys work when Bezels has focus. Click a device (or press <Kbd k="Enter" />) to type into the page; <Kbd k="Esc" /> gives keys back. <Kbd k="G" /> starts a two-key chord (1 s).</p>
      </div>
    </div>
  );
}

export function Settings() {
  const open = useStore((s) => s.settings);
  const km = useStore((s) => s.keymap);
  const [tab, setTab] = useState<'keys' | 'general' | 'devices'>('keys');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [rec, setRec] = useState<string | null>(null);
  const [cfg, setCfg] = useState<any>(null);
  const custom = useStore((s) => s.catalog?.devices.filter((d) => d.category === 'custom') ?? []);
  useEffect(() => { if (open) { setDraft({ ...(km?.map ?? {}) }); act('config_get').then(setCfg); } }, [open]);
  useEffect(() => {
    if (!rec) return;
    const h = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setRec(null); return; }
      setDraft((d) => ({ ...d, [rec]: eventToKey(e, /Mac/.test(navigator.platform)) }));
      setRec(null);
    };
    addEventListener('keydown', h, true);
    return () => removeEventListener('keydown', h, true);
  }, [rec]);
  if (!open) return null;
  const conflicts = keymapConflicts(draft);
  const dupOf = (id: string) => Object.values(conflicts.duplicates).find((ids) => ids.includes(id));
  const cmds = commandList();
  return (
    <Modal wide title={<>Settings <Seg small value={tab} onChange={setTab} options={[{ v: 'keys', l: 'Keymap' }, { v: 'general', l: 'General' }, { v: 'devices', l: 'Custom devices' }]} /></>} onClose={() => set({ settings: false })}>
      {tab === 'keys' && (
        <div className="flex flex-col gap-3">
          <div className="text-muted text-xs">Saved to <code className="font-mono">~/.config/bezels/keymap.json</code>. Click a key to record a new one (Esc cancels). Type <code className="font-mono">g x</code> by hand for a chord.</div>
          <div className="grid gap-x-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))' }}>
            {cmds.map((c) => {
              const dup = dupOf(c.id);
              const reserved = RESERVED.includes(draft[c.id] ?? '');
              return (
                <div key={c.id} className="flex items-center gap-2 h-9 border-b border-line/50">
                  <span className="text-[11px] text-muted w-20 shrink-0">{c.area}</span>
                  <span className="flex-1 truncate">{c.title}</span>
                  {(dup || reserved) && <span className="text-[10px] text-err" title={dup ? `Also bound to: ${dup.filter((x) => x !== c.id).join(', ')}` : 'Browser-reserved combo'}>{dup ? 'conflict' : 'reserved'}</span>}
                  <button type="button" onClick={() => setRec(c.id)} className={cx('min-w-[90px] h-7 px-2 rounded border font-mono text-[11px] cursor-pointer', rec === c.id ? 'border-accent text-accentfg bg-accentbg' : dup || reserved ? 'border-errline text-err' : 'border-line text-text')}>
                    {rec === c.id ? 'press keys…' : keyLabel(draft[c.id]) || '—'}
                  </button>
                  <input aria-label={`Key for ${c.title}`} value={draft[c.id] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))} className={cx(inputCls, 'w-20 h-7 font-mono text-[11px]')} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 justify-end sticky bottom-0 bg-panel pt-2">
            <Btn onClick={() => setDraft({ ...(km?.defaults ?? {}) })}>Reset to defaults</Btn>
            <Btn variant="primary" disabled={Object.keys(conflicts.duplicates).length > 0} onClick={async () => { const r = await act('keymap_set', { map: draft }); if (r) { set({ keymap: r }); toast('Keymap saved'); } }}>Save keymap</Btn>
          </div>
        </div>
      )}
      {tab === 'general' && cfg && (
        <form className="grid grid-cols-2 gap-3 max-w-[640px]" onSubmit={async (e) => { e.preventDefault(); await act('config_set', { maxMemoryMB: +cfg.maxMemoryMB, maxLive: +cfg.maxLive, idleCloseMs: +cfg.idleCloseMs, engineIdleMs: +cfg.engineIdleMs, screencastFps: +cfg.screencastFps }); toast('Settings saved'); }}>
          <Field label="Memory budget (MB)"><input type="number" min={300} className={inputCls} value={cfg.maxMemoryMB} onChange={(e) => setCfg({ ...cfg, maxMemoryMB: e.target.value })} /></Field>
          <Field label="Max live devices"><input type="number" min={1} max={4} className={inputCls} value={cfg.maxLive} onChange={(e) => setCfg({ ...cfg, maxLive: e.target.value })} /></Field>
          <Field label="Close idle background page after (ms)"><input type="number" className={inputCls} value={cfg.idleCloseMs} onChange={(e) => setCfg({ ...cfg, idleCloseMs: e.target.value })} /></Field>
          <Field label="Shut idle engine after (ms)"><input type="number" className={inputCls} value={cfg.engineIdleMs} onChange={(e) => setCfg({ ...cfg, engineIdleMs: e.target.value })} /></Field>
          <Field label="Live view max fps"><input type="number" min={2} max={30} className={inputCls} value={cfg.screencastFps} onChange={(e) => setCfg({ ...cfg, screencastFps: e.target.value })} /></Field>
          <Field label="Screenshots folder"><input readOnly className={inputCls} value={cfg.shotsDir} /></Field>
          <WatchField />
          <div className="col-span-2 flex justify-end"><Btn variant="primary" type="submit">Save</Btn></div>
        </form>
      )}
      {tab === 'devices' && (
        <div className="flex flex-col gap-3">
          <CustomDeviceForm />
          {custom.map((d) => <div key={d.id} className="flex items-center gap-3 h-9 border-b border-line"><span className="flex-1">{d.name}</span><span className="font-mono text-xs text-muted">{d.screen.w}×{d.screen.h} @{d.dpr}</span><Btn size="sm" variant="danger" onClick={() => act('delete_custom_device', { id: d.id })}>Delete</Btn></div>)}
        </div>
      )}
    </Modal>
  );
}

function WatchField() {
  const [dir, setDir] = useState('');
  return (
    <Field label="Hot reload: reload all devices when files change in" className="col-span-2">
      <div className="flex gap-2"><input className={cx(inputCls, 'flex-1 font-mono')} placeholder="/path/to/your/app/src" value={dir} onChange={(e) => setDir(e.target.value)} /><Btn onClick={async () => { const r = await act('watch', { dir: dir || null }); if (r) toast(r.watching ? `Watching ${r.watching}` : 'Stopped watching'); }}>{dir ? 'Watch' : 'Stop'}</Btn></div>
    </Field>
  );
}

export function CustomDeviceForm({ onDone }: { onDone?: () => void }) {
  const [f, setF] = useState({ name: '', w: 390, h: 844, dpr: 3, mobile: true, touch: true, ua: '' });
  return (
    <form className="grid grid-cols-6 gap-2 items-end" onSubmit={async (e) => {
      e.preventDefault();
      const d = await act('save_custom_device', { name: f.name || undefined, w: +f.w, h: +f.h, dpr: +f.dpr, mobile: f.mobile, touch: f.touch, ua: f.ua || undefined });
      if (d) { toast(`Saved ${d.name}`); onDone?.(); const r = await act<any[]>('open', { url: get().url, devices: [d.id] }); if (r?.[0]) act('focus', { session: r[0].id }); }
    }}>
      <Field label="Name" className="col-span-2"><input className={inputCls} placeholder="My phone" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Width"><input type="number" min={200} max={4000} className={inputCls} value={f.w} onChange={(e) => setF({ ...f, w: +e.target.value })} /></Field>
      <Field label="Height"><input type="number" min={200} max={4000} className={inputCls} value={f.h} onChange={(e) => setF({ ...f, h: +e.target.value })} /></Field>
      <Field label="DPR"><input type="number" step="0.125" min={1} max={4} className={inputCls} value={f.dpr} onChange={(e) => setF({ ...f, dpr: +e.target.value })} /></Field>
      <div className="flex flex-col gap-1 text-xs"><label className="flex gap-1.5 items-center"><input type="checkbox" checked={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.checked })} />Mobile</label><label className="flex gap-1.5 items-center"><input type="checkbox" checked={f.touch} onChange={(e) => setF({ ...f, touch: e.target.checked })} />Touch</label></div>
      <Field label="User agent (optional)" className="col-span-5"><input className={cx(inputCls, 'font-mono')} value={f.ua} onChange={(e) => setF({ ...f, ua: e.target.value })} /></Field>
      <Btn variant="primary" type="submit" className="h-8">Save & open</Btn>
    </form>
  );
}

export function CustomDialog() {
  const open = useStore((s) => s.customDialog);
  return open ? <Modal title="Custom device" onClose={() => set({ customDialog: false })}><CustomDeviceForm onDone={() => set({ customDialog: false })} /></Modal> : null;
}

export function MemoryModal() {
  const open = useStore((s) => s.memory);
  const st = useStore((s) => s.stats);
  if (!open || !st) return null;
  return (
    <Modal title="Memory" onClose={() => set({ memory: false })}>
      <div className="flex flex-col gap-3">
        <div className="text-2xl font-semibold font-mono">{st.totalMB} <span className="text-muted text-sm">/ {st.budgetMB} MB budget</span></div>
        <table className="w-full text-xs"><tbody>
          <tr className="border-b border-line"><td className="py-1.5">Bezels (Node, Playwright driver)</td><td className="text-right font-mono">{st.nodeMB} MB</td></tr>
          {st.engines.map((e) => <tr key={e.engine} className="border-b border-line"><td className="py-1.5">{e.engine === 'chromium' ? 'Chromium (Android, desktop)' : 'WebKit (iPhone, iPad, Safari)'} · {e.running ? `${e.contexts} context(s)` : 'not running'}</td><td className="text-right font-mono">{e.mb} MB</td></tr>)}
        </tbody></table>
        <div className="text-[11px] uppercase tracking-wider text-muted">Pages ({st.live} live, {st.hosts} total, deduped)</div>
        {st.sessions.map((s) => <div key={s.id} className="flex justify-between text-xs"><span>{s.deviceName}</span><span className={cx('font-mono', s.status === 'live' ? 'text-ok' : 'text-muted')}>{s.status}</span></div>)}
        <p className="text-muted text-xs">PSS from /proc (shared pages split fairly). Only the focused device (and the Compare partner) stays live; others are frozen, then closed when idle or over budget, and reopen at the same URL and scroll.</p>
      </div>
    </Modal>
  );
}

export function LimitsModal() {
  const open = useStore((s) => s.limits);
  if (!open) return null;
  return (
    <Modal title="Honest limits" onClose={() => set({ limits: false })}>
      <ul className="flex flex-col gap-2 text-soft list-disc pl-5 m-0">
        <li>iPhone/iPad run in Playwright's WebKit: close to iOS Safari but not identical (no iOS-only quirks, real address-bar animation, or keyboard resize).</li>
        <li>WebKit has no DevTools protocol: network/CPU throttling, posture, vision deficiency, idle, sensors override, live timezone/locale and native safe-area insets are Chromium-only. Safe areas on WebKit are approximated by rewriting <code className="font-mono">env(safe-area-inset-*)</code> rules.</li>
        <li>It's emulation: no real GPU, fonts, or performance of the actual phone. Browser-bar heights are measured values (≈).</li>
        <li>Telegram mode is a mock of <code className="font-mono">Telegram.WebApp</code>. initData is unsigned unless <code className="font-mono">BEZELS_TG_BOT_TOKEN</code> (a test bot) is set. Do a final check in real Telegram (test environment + test bot).</li>
        <li>Final checks: one real Android (Chrome remote debugging) and one real iPhone.</li>
      </ul>
    </Modal>
  );
}

export function ActivityPanel() {
  const open = useStore((s) => s.activityOpen);
  const a = useStore((s) => s.activity);
  const paused = useStore((s) => s.agentPaused);
  if (!open) return null;
  return (
    <Modal title={<>Claude Code activity <Btn size="sm" variant={paused ? 'primary' : 'outline'} cmd="pauseAgent" label={paused ? 'Resume control' : 'Pause control'} onClick={() => RUN.pauseAgent!()}>{paused ? I.play : I.pause}{paused ? 'Resume' : 'Pause'}</Btn></>} onClose={() => set({ activityOpen: false })}>
      <div className="flex flex-col gap-1 font-mono text-xs">
        {!a.length && <div className="text-muted font-sans">Nothing yet. Register the MCP server: <code>claude mcp add bezels -- node dist/mcp.js</code></div>}
        {[...a].reverse().map((x, i) => <div key={i} className="flex gap-3 border-b border-line/50 py-1"><span className="text-muted shrink-0">{new Date(x.time).toLocaleTimeString()}</span><span className="break-all">{x.summary}</span></div>)}
      </div>
    </Modal>
  );
}

export function SetPicker() {
  const open = useStore((s) => s.picker === 'set');
  const sets = useStore((s) => s.catalog?.sets ?? {});
  const custom = useStore((s) => s.catalog?.customSets ?? {});
  if (!open) return null;
  const all = [...Object.entries(custom).map(([k, v]) => [k, `${k[0]!.toUpperCase()}${k.slice(1)} set`, v.length] as const), ...Object.entries(sets).map(([k, v]) => [k, v.label, v.ids.length] as const)];
  return (
    <Modal title="Switch device set" onClose={() => set({ picker: null })}>
      <div className="grid grid-cols-2 gap-2">
        {all.map(([k, label, n]) => <Btn key={k} className="justify-between h-10" onClick={() => openSet(k)}>{label}<span className="text-muted font-mono">{n}</span></Btn>)}
      </div>
      <p className="text-muted text-xs mt-3">Large sets open lazily: only the focused device renders; the rest are audited and captured one at a time. {setIds('all').length} devices in the catalog.</p>
    </Modal>
  );
}

export { copyImage };
