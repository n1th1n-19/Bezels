import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../../../src/shared/types';
import { act, set, useStore } from '../store';
import { RUN, setEmulation, setState } from '../actions';
import { Btn, ChromiumOnly, Field, I, Seg, cx, inputCls } from '../ui';

const TZS: string[] = (() => { try { return (Intl as any).supportedValuesOf('timeZone'); } catch { return ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney']; } })();
const LOCALES = ['en-IN', 'hi-IN', 'kn-IN', 'ta-IN', 'te-IN', 'bn-IN', 'mr-IN', 'en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ja-JP', 'zh-CN', 'ar-AE', 'ru-RU'];

export function Sensors() {
  const f = useStore((s) => s.sessions.find((x) => x.id === s.focused));
  const picker = useStore((s) => s.picker);
  if (!f) return <aside className="w-[330px] shrink-0 border-l border-line bg-panel p-3 text-muted">Open a device first.</aside>;
  const wk = f.engine;
  return (
    <aside aria-label="Sensors and emulation" className="w-[330px] shrink-0 border-l border-line bg-panel flex flex-col min-h-0">
      <div className="flex items-center h-10 px-3 border-b border-line shrink-0"><span className="font-semibold flex-1">Sensors & emulation</span><Btn variant="ghost" size="icon" label="Close sensors" onClick={() => set({ sensors: false })}>{I.x}</Btn></div>
      <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-4">
        <Location s={f} highlight={picker === 'location'} />
        <TimeLocale s={f} highlight={picker === 'timezone'} engine={wk} />
        <Orientation s={f} engine={wk} />
        <Emulate s={f} highlight={picker === 'emulation'} engine={wk} />
        <Permissions s={f} engine={wk} />
        <UserAgent s={f} />
      </div>
    </aside>
  );
}

const Section = ({ title, children, right, highlight }: { title: string; children: React.ReactNode; right?: React.ReactNode; highlight?: boolean }) => (
  <section className={cx('flex flex-col gap-2 pb-4 border-b border-line', highlight && 'ring-1 ring-accent rounded-lg p-2')}>
    <div className="flex items-center gap-2"><span className="font-semibold flex-1">{title}</span>{right}</div>{children}
  </section>
);

function Location({ s, highlight }: { s: SessionInfo; highlight: boolean }) {
  const cities = useStore((st) => st.catalog?.cities ?? []);
  const g = s.state.emulation.geolocation;
  const on = !!g;
  const [auto, setAuto] = useState(true);
  const [ll, setLl] = useState({ lat: '', lng: '', acc: '20' });
  const sel = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (highlight) sel.current?.focus(); }, [highlight]);
  useEffect(() => { if (g && g !== 'unavailable') setLl({ lat: String(g.lat), lng: String(g.lng), acc: String(g.accuracy) }); }, [g]);
  const current = g && g !== 'unavailable' ? cities.find((c) => Math.abs(c.lat - g.lat) < 0.01 && Math.abs(c.lng - g.lng) < 0.01)?.name ?? 'custom' : g === 'unavailable' ? 'unavailable' : '';
  const pick = (v: string) => {
    if (v === 'unavailable') act('set_location', { session: s.id, unavailable: true });
    else if (v && v !== 'custom') act('set_location', { session: s.id, city: v, autoTimezone: auto });
  };
  return (
    <Section highlight={highlight} title="Location" right={<label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={on} onChange={(e) => (e.target.checked ? pick(cities[0]!.name) : setEmulation({ geolocation: null }))} />On</label>}>
      <Field label="Preset (type to search)">
        <select ref={sel} className={inputCls} value={current} onChange={(e) => pick(e.target.value)}>
          <option value="">—</option>
          {cities.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          <option value="custom">Custom…</option>
          <option value="unavailable">Location unavailable (error)</option>
        </select>
      </Field>
      <div className="grid grid-cols-3 gap-1.5">
        <input aria-label="Latitude" className={inputCls} placeholder="lat" value={ll.lat} onChange={(e) => setLl({ ...ll, lat: e.target.value })} />
        <input aria-label="Longitude" className={inputCls} placeholder="lng" value={ll.lng} onChange={(e) => setLl({ ...ll, lng: e.target.value })} />
        <input aria-label="Accuracy (m)" className={inputCls} placeholder="± m" value={ll.acc} onChange={(e) => setLl({ ...ll, acc: e.target.value })} />
      </div>
      <Btn size="sm" variant="raised" onClick={() => act('set_location', { session: s.id, lat: +ll.lat, lng: +ll.lng, accuracy: +ll.acc || 20 })}>Set custom position</Btn>
      <MapPick cities={cities} value={g && g !== 'unavailable' ? g : null} onPick={(lat, lng) => act('set_location', { session: s.id, lat, lng, accuracy: 50 })} />
      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Set timezone & language from the city</label>
    </Section>
  );
}

/** Click-to-pick on an equirectangular grid (offline, no map tiles). City dots for orientation. */
function MapPick({ cities, value, onPick }: { cities: { name: string; lat: number; lng: number }[]; value: { lat: number; lng: number } | null; onPick: (lat: number, lng: number) => void }) {
  const W = 300, H = 150;
  const px = (lng: number) => ((lng + 180) / 360) * W, py = (lat: number) => ((90 - lat) / 180) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md bg-bg border border-line cursor-crosshair" role="img" aria-label="Pick a location on the map"
      onClick={(e) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H; onPick(+(90 - (y / H) * 180).toFixed(4), +((x / W) * 360 - 180).toFixed(4)); }}>
      {Array.from({ length: 11 }, (_, i) => <line key={'v' + i} x1={(i * W) / 10} x2={(i * W) / 10} y1={0} y2={H} stroke="#22262D" />)}
      {Array.from({ length: 7 }, (_, i) => <line key={'h' + i} y1={(i * H) / 6} y2={(i * H) / 6} x1={0} x2={W} stroke={i === 3 ? '#2A2E36' : '#22262D'} />)}
      {cities.map((c) => <g key={c.name}><circle cx={px(c.lng)} cy={py(c.lat)} r="2" fill="#A3AAB6" /><title>{c.name}</title></g>)}
      {value && <g><circle cx={px(value.lng)} cy={py(value.lat)} r="5" fill="none" stroke="#7AA7FF" strokeWidth="2" /><circle cx={px(value.lng)} cy={py(value.lat)} r="1.5" fill="#7AA7FF" /></g>}
    </svg>
  );
}

function TimeLocale({ s, highlight, engine }: { s: SessionInfo; highlight: boolean; engine: string }) {
  const e = s.state.emulation;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (highlight) ref.current?.focus(); }, [highlight]);
  return (
    <Section highlight={highlight} title="Timezone & language" right={engine === 'webkit' ? <span className="text-[10px] text-muted">WebKit: reloads page</span> : null}>
      <Field label="Timezone (IANA)">
        <input ref={ref} list="tz-list" className={inputCls} defaultValue={e.timezone ?? ''} placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone} onBlur={(ev) => ev.target.value !== (e.timezone ?? '') && setEmulation({ timezone: ev.target.value || undefined })} onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()} />
        <datalist id="tz-list">{TZS.map((t) => <option key={t} value={t} />)}</datalist>
      </Field>
      <Field label="Locale / Accept-Language">
        <select className={inputCls} value={e.locale ?? ''} onChange={(ev) => setEmulation({ locale: ev.target.value || undefined })}>
          <option value="">Default</option>{LOCALES.map((l) => <option key={l}>{l}</option>)}
        </select>
      </Field>
    </Section>
  );
}

function Orientation({ s, engine }: { s: SessionInfo; engine: string }) {
  const sn = s.state.emulation.sensors ?? { alpha: 0, beta: 90, gamma: 0 };
  const [v, setV] = useState(sn);
  return (
    <Section title="Orientation" right={<ChromiumOnly engine={engine} />}>
      <Seg small value={s.state.orientation} onChange={(o) => setState({ orientation: o }, s.id)} options={[{ v: 'portrait', l: 'Portrait' }, { v: 'landscape-left', l: 'Land. L' }, { v: 'landscape-right', l: 'Land. R' }, { v: 'portrait-upside-down', l: 'Upside' }]} />
      {(['alpha', 'beta', 'gamma'] as const).map((k) => (
        <label key={k} className="flex items-center gap-2 text-xs"><span className="w-10 text-muted">{k}</span>
          <input type="range" min={k === 'alpha' ? 0 : -180} max={k === 'alpha' ? 360 : 180} value={v[k]} className="flex-1" onChange={(e) => setV({ ...v, [k]: +e.target.value })} onPointerUp={() => setEmulation({ sensors: v })} onKeyUp={() => setEmulation({ sensors: v })} />
          <span className="font-mono w-9 text-right">{v[k]}°</span>
        </label>
      ))}
      <div className="flex gap-1.5"><Btn size="sm" variant="raised" cmd="shake" label="Send shake event" onClick={() => RUN.shake!()}>Shake</Btn><Btn size="sm" variant="ghost" onClick={() => { setV({ alpha: 0, beta: 90, gamma: 0 }); setEmulation({ sensors: null }); }}>Reset sensors</Btn></div>
    </Section>
  );
}

function Emulate({ s, highlight, engine }: { s: SessionInfo; highlight: boolean; engine: string }) {
  const st = s.state, e = st.emulation;
  const touchDefault = useTouchDefault(s);
  const row = (label: string, el: React.ReactNode, chromium = false) => <div className="flex items-center gap-2 justify-between min-h-7"><span className="text-xs flex items-center gap-1.5">{label}{chromium && <ChromiumOnly engine={engine} />}</span>{el}</div>;
  const check = (v: boolean, fn: (v: boolean) => void) => <input type="checkbox" checked={v} onChange={(ev) => fn(ev.target.checked)} />;
  return (
    <Section highlight={highlight} title="Emulate">
      {row('Colour scheme', <Seg small value={st.colorScheme} onChange={(v) => setState({ colorScheme: v }, s.id)} options={[{ v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }]} />)}
      {row('Reduced motion', check(st.reducedMotion, (v) => setState({ reducedMotion: v }, s.id)))}
      {row('Forced colors / high contrast', check(!!e.forcedColors, (v) => setEmulation({ forcedColors: v })))}
      {row('Print media', check(!!e.print, (v) => setEmulation({ print: v })))}
      {row('Touch input', check(e.touch ?? touchDefault, (v) => setEmulation({ touch: v })))}
      {row('Vision', <select className="h-7 rounded-md border border-line bg-bg text-xs px-1" value={e.vision ?? 'none'} onChange={(ev) => setEmulation({ vision: ev.target.value })}><option value="none">Normal</option><option value="protanopia">Protanopia</option><option value="deuteranopia">Deuteranopia</option><option value="tritanopia">Tritanopia</option><option value="achromatopsia">Achromatopsia</option><option value="blurredVision">Blurred vision</option></select>, true)}
      {row('Idle / locked', <select className="h-7 rounded-md border border-line bg-bg text-xs px-1" value={e.idle ?? 'active'} onChange={(ev) => setEmulation({ idle: ev.target.value })}><option value="active">Active</option><option value="idle">Idle</option><option value="locked">Locked screen</option></select>, true)}
      {row('Battery', <span className="flex items-center gap-1.5"><input type="range" min={0} max={100} defaultValue={e.battery != null ? e.battery * 100 : 100} onPointerUp={(ev) => setEmulation({ battery: +(ev.target as HTMLInputElement).value / 100 })} className="w-24" /><span className="font-mono text-[11px] w-9">{e.battery != null ? `${Math.round(e.battery * 100)}%` : 'real'}</span></span>)}
      {row('CPU', <Seg small value={String(st.cpu)} onChange={(v) => setState({ cpu: +v }, s.id)} options={[{ v: '1', l: 'None' }, { v: '4', l: '4×' }, { v: '6', l: '6×' }]} />, true)}
      {row('Network', <select className="h-7 rounded-md border border-line bg-bg text-xs px-1" value={st.network} onChange={(ev) => setState({ network: ev.target.value as any }, s.id)}><option value="none">No throttling</option><option value="fast4g">Fast 4G</option><option value="slow4g">Slow 4G</option><option value="3g">3G</option><option value="offline">Offline</option></select>, st.network !== 'offline')}
    </Section>
  );
}
const useTouchDefault = (s: SessionInfo) => useStore((st) => st.catalog?.devices.find((d) => d.id === s.deviceId)?.touch ?? false);

function Permissions({ s, engine }: { s: SessionInfo; engine: string }) {
  const p = s.state.emulation.permissions ?? {};
  return (
    <Section title="Permissions" right={engine === 'webkit' ? <span className="text-[10px] text-muted">WebKit: allow/ask only</span> : null}>
      {['location', 'camera', 'microphone', 'notifications', 'clipboard'].map((k) => (
        <div key={k} className="flex items-center justify-between"><span className="text-xs capitalize">{k}</span>
          <Seg small value={p[k] ?? 'ask'} onChange={(v) => setEmulation({ permissions: { ...p, [k]: v } })} options={[{ v: 'allow', l: 'Allow' }, { v: 'ask', l: 'Ask' }, { v: 'block', l: 'Block', disabled: engine === 'webkit' }]} />
        </div>
      ))}
    </Section>
  );
}

function UserAgent({ s }: { s: SessionInfo }) {
  const d = useStore((st) => st.catalog?.devices.find((x) => x.id === s.deviceId));
  const ua = s.state.emulation.userAgent ?? '';
  const [v, setV] = useState(ua);
  useEffect(() => setV(ua), [ua]);
  return (
    <Section title="User agent & Client Hints">
      <textarea aria-label="User agent" className={cx(inputCls, 'h-20 py-1.5 font-mono text-[11px] resize-none')} value={v || d?.userAgent[s.state.browser] || ''} onChange={(e) => setV(e.target.value)} />
      <div className="flex gap-1.5"><Btn size="sm" variant="raised" onClick={() => setEmulation({ userAgent: v || null })}>Override</Btn><Btn size="sm" variant="ghost" onClick={() => { setV(''); setEmulation({ userAgent: null }); }}>Device default</Btn></div>
      <div className="text-[11px] text-muted">Chromium devices also send matching Client Hints (Sec-CH-UA-Mobile, platform, model) unless overridden.</div>
    </Section>
  );
}
