import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Device, SessionInfo, TgRuntime } from '../../../src/shared/types';
import { renderFrame } from '../../../src/shared/frame';
import { emptyTgRuntime } from '../../../src/shared/layout';
import { act, deviceOf, get, set, toast, useStore } from '../store';
import { call, subscribe } from '../rpc';
import { RUN, focusSession, setState, copyImage } from '../actions';
import { Badge, Btn, ChromiumOnly, I, cx, useKey, tip, Kbd } from '../ui';
import { ShotPopover } from './Overlays';

function useVisible() {
  const [v, setV] = useState(!document.hidden);
  useEffect(() => { const f = () => setV(!document.hidden); document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, []);
  return v;
}

const BROWSER_LABEL: Record<string, string> = { safari: 'Safari', chrome: 'Chrome', samsung: 'Samsung Internet', edge: 'Edge' };

export function Stage() {
  const sessions = useStore((s) => s.sessions);
  const focused = useStore((s) => s.focused);
  const compare = useStore((s) => s.compare);
  const view = useStore((s) => s.view);
  const zoomSetting = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  const catalog = useStore((s) => s.catalog);
  const devtools = useStore((s) => s.devtools);
  const zen = useStore((s) => s.zen);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [spaceDown, setSpaceDown] = useState(false);

  const main = sessions.find((s) => s.id === focused) ?? sessions[0];
  const second = view === 'compare' ? sessions.find((s) => s.id === compare && s.id !== main?.id) : undefined;
  const shown = [main, second].filter(Boolean) as SessionInfo[];

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (!shown.length) return 0.7;
    const tw = shown.reduce((a, s) => a + s.layout.frame.w, 0) + (shown.length - 1) * 80;
    const th = Math.max(...shown.map((s) => s.layout.frame.h));
    return zen
      ? Math.max(0.1, Math.min(2, (box.w - 32) / tw, (box.h - 32) / th))
      : Math.max(0.1, Math.min(1, (box.w - 64) / tw, (box.h - 230) / th));
  }, [shown.map((s) => `${s.layout.frame.w}x${s.layout.frame.h}`).join(), box.w, box.h, zen]);
  useEffect(() => { if (Math.abs(get().fitZoom - fit) > 0.001) set({ fitZoom: fit }); }, [fit]);
  const zoom = zoomSetting === 'fit' ? fit : zoomSetting;

  // Space + drag pans the stage.
  useEffect(() => {
    const d = (e: KeyboardEvent) => { if (e.code === 'Space' && !get().keysToDevice && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); setSpaceDown(true); } };
    const u = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    addEventListener('keydown', d); addEventListener('keyup', u);
    return () => { removeEventListener('keydown', d); removeEventListener('keyup', u); };
  }, []);
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  return (
    <main className="flex-1 min-w-0 min-h-0 relative dots flex flex-col">
      {devtools && !zen && main && <BreakpointsBar session={main} />}
      <div
        ref={ref}
        className={cx('flex-1 min-h-0 relative overflow-auto flex flex-col items-center justify-center-safe', zen ? 'p-4' : 'gap-3.5 px-6 pb-4 pt-4', spaceDown && 'cursor-grab')}
        onPointerDown={(e) => { if (spaceDown) { panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId); e.preventDefault(); } }}
        onPointerMove={(e) => { const p = panStart.current; if (p) set({ pan: { x: p.px + e.clientX - p.x, y: p.py + e.clientY - p.y } }); }}
        onPointerUp={() => { panStart.current = null; }}
      >
        {!sessions.length && <Empty />}
        {!!shown.length && (
          <div className="flex items-start gap-20" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
            {shown.map((s) => {
              const d = catalog?.devices.find((x) => x.id === s.deviceId);
              return d ? <DeviceView key={s.id} session={s} device={d} zoom={zoom} primary={s.id === main!.id} blockInput={spaceDown} /> : null;
            })}
          </div>
        )}
        {sessions.length > 0 && !zen && <Switcher />}
      </div>
      {zen && <ZenPill main={main} />}
    </main>
  );
}

function Empty() {
  const url = useStore((s) => s.url);
  return (
    <div className="text-center flex flex-col gap-3 items-center max-w-md">
      <div className="text-base font-semibold">No devices open</div>
      <div className="text-muted">Pick a set at the top or tick devices on the left. They open <code className="font-mono text-xs">{url}</code>. Only one device renders at a time; the rest are checked in the background.</div>
      <div className="flex gap-2"><Btn variant="primary" onClick={() => RUN.switchSet!()}>Choose a device set</Btn></div>
    </div>
  );
}

export function DeviceView({ session: s, device: d, zoom, primary, blockInput }: { session: SessionInfo; device: Device; zoom: number; primary: boolean; blockInput: boolean }) {
  const tgStore = useStore((st) => st.tgRuntime[s.id]);
  const inspecting = useStore((st) => st.inspecting);
  const keysToDevice = useStore((st) => st.keysToDevice);
  const shotPopover = useStore((st) => st.shotPopover);
  const zen = useStore((st) => st.zen);
  const tg: TgRuntime | undefined = s.state.telegram.enabled ? tgStore ?? emptyTgRuntime() : undefined;
  const L = s.layout;
  const fr = useMemo(() => renderFrame(d, s.state, L, s.url, tg, s.title || 'Mini App'), [d, s.state, L, s.url, tg, s.title]);
  const imgRef = useRef<HTMLImageElement>(null);
  const [live, setLive] = useState(false);
  const visible = useVisible();
  const dpr = window.devicePixelRatio || 1;
  const vp = L.viewport;

  // Live screencast, sized to the on-screen frame; stops when the tab is hidden or the view unmounts.
  useEffect(() => {
    if (!visible) return;
    let last: string | null = null;
    const un = subscribe(s.id, Math.round(vp.w * zoom * dpr), Math.round(vp.h * zoom * dpr), (_m, blob) => {
      const url = URL.createObjectURL(blob);
      const img = imgRef.current;
      if (!img) { URL.revokeObjectURL(url); return; }
      img.src = url;
      if (last) URL.revokeObjectURL(last);
      last = url;
      setLive(true);
    });
    return () => { un(); if (last) URL.revokeObjectURL(last); setLive(false); };
  }, [s.id, visible, Math.round(vp.w * zoom * dpr / 32), Math.round(vp.h * zoom * dpr / 32)]);

  // ---- input forwarding (pointer → touch/mouse, wheel → scroll) ----
  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * vp.w), y: Math.round(((e.clientY - r.top) / r.height) * vp.h) };
  };
  const down = useRef(false);
  const lastMove = useRef(0);
  const wheelAcc = useRef({ dx: 0, dy: 0, t: 0 as number | undefined, x: 0, y: 0 });
  const send = (action: object) => call('interact', { session: s.id, action }).catch((e) => toast(e.message, true));
  const onDown = async (e: React.PointerEvent) => {
    if (blockInput || e.button !== 0) return;
    if (!primary) { focusSession(s.id); return; }
    const p = toPage(e);
    if (inspecting) { const r = await act('inspect', { session: s.id, x: p.x, y: p.y }); if (r) set({ inspected: r, inspecting: false, devtools: true, panel: 'elements' }); return; }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    down.current = true;
    set({ keysToDevice: true });
    send({ type: 'pointer', phase: 'down', ...p });
  };
  const onMove = (e: React.PointerEvent) => {
    if (blockInput || !primary || inspecting) return;
    const now = performance.now();
    if (now - lastMove.current < (down.current ? 16 : 60)) return;
    if (!down.current && d.touch) return; // no hover on touch devices
    lastMove.current = now;
    send({ type: 'pointer', phase: 'move', ...toPage(e) });
  };
  const onUp = (e: React.PointerEvent) => { if (!down.current) return; down.current = false; send({ type: 'pointer', phase: 'up', ...toPage(e) }); };
  const onWheel = (e: React.WheelEvent) => {
    if (blockInput || !primary) return;
    const w = wheelAcc.current;
    w.dx += e.deltaX; w.dy += e.deltaY; Object.assign(w, toPage(e));
    if (w.t) return;
    w.t = window.setTimeout(() => { send({ type: 'wheel', x: w.x, y: w.y, dx: Math.round(w.dx), dy: Math.round(w.dy) }); w.dx = w.dy = 0; w.t = undefined; }, 40);
  };

  const ox = L.frame.offsetX, oy = L.frame.offsetY;
  const ring = primary ? (d.cornerRadius ? d.cornerRadius + ox : L.frame.kind === 'phone' ? 36 : 14) : 0;

  return (
    <figure className="m-0 flex flex-col items-center gap-2.5 relative">
      {!zen && <DeviceToolbar s={s} d={d} />}
      {primary && shotPopover && <ShotPopover />}
      <div className="relative" style={{ width: fr.w * zoom, height: fr.h * zoom }}>
        {primary && (L.frame.kind === 'phone' || L.frame.kind === 'tablet') && <div className="absolute inset-0 pointer-events-none" style={{ borderRadius: ring * zoom, boxShadow: '0 0 0 2px #7AA7FF' }} />}
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: fr.w, height: fr.h, transform: `scale(${zoom})` }}>
          <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: fr.under }} />
          <div className="absolute overflow-hidden" style={{ left: ox, top: oy, width: L.screen.w, height: L.screen.h, borderRadius: d.cornerRadius }}>
          <img
            ref={imgRef}
            alt={`${d.name} screen`}
            src={s.snapshot ?? 'data:image/gif;base64,R0lGODlhAQABAAAAACw='}
            draggable={false}
            className={cx('absolute select-none touch-none', inspecting && primary ? 'cursor-crosshair' : primary ? (d.touch ? 'cursor-pointer' : 'cursor-default') : 'cursor-pointer')}
            style={{ left: vp.x, top: vp.y, width: vp.w, height: vp.h, background: s.state.colorScheme === 'dark' ? '#000' : '#fff', imageRendering: 'auto' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
          </div>
          <div className="absolute inset-0 pointer-events-none" dangerouslySetInnerHTML={{ __html: fr.over }} />
          {tg && <TelegramOverlay s={s} tg={tg} />}
          {s.error && <div className="absolute flex flex-col gap-3 items-center justify-center text-center p-6 text-err text-sm" style={{ left: ox + vp.x, top: oy + vp.y, width: vp.w, height: vp.h, background: '#1F1616f2' }}><b>Can't start this device</b><span className="text-soft text-xs break-words">{s.error}</span><Btn size="sm" variant="raised" onClick={() => act('reload', { session: s.id })}>Retry</Btn></div>}
          {s.status === 'loading' && !s.error && <div className="absolute flex items-center justify-center text-muted text-sm" style={{ left: ox + vp.x, top: oy + vp.y, width: vp.w, height: vp.h, background: '#0E0F12cc' }}>Loading…</div>}
        </div>
      </div>
      {!zen && <figcaption className="text-center flex flex-col gap-1">
        <span className="font-semibold flex items-center gap-1.5 justify-center flex-wrap">
          {d.name} · {BROWSER_LABEL[s.state.browser]}{s.state.telegram.enabled ? ` · Telegram (${s.state.telegram.platform}, ${s.state.telegram.mode})` : ''}
          {live ? <Badge tone="ok">LIVE</Badge> : <span className="text-[10px] font-semibold px-1.5 rounded-lg bg-line text-muted">{s.status === 'frozen' || s.status === 'evicted' ? 'SNAPSHOT' : s.status.toUpperCase()}</span>}
          {s.source === 'mcp' && <Badge tone="accent">Claude</Badge>}
          {primary && keysToDevice && <span className="text-[10px] font-semibold px-1.5 rounded-lg bg-accentbg text-accentfg">Keys → device · Esc</span>}
        </span>
        <span className="font-mono text-[11px] text-muted">
          {L.screen.w}×{L.screen.h} @{d.dpr}x · page {vp.w}×{vp.h}{s.state.orientation !== 'portrait' ? ` · ${s.state.orientation}` : ''}{d.fold ? ` · ${s.state.fold}` : ''}{s.state.bars !== 'expanded' ? ` · bars ${s.state.bars}` : ''}{s.state.network !== 'none' ? ` · ${s.state.network}` : ''}{s.state.cpu > 1 ? ` · CPU ${s.state.cpu}×` : ''}
        </span>
        {s.engine === 'webkit' && primary && <span className="text-[11px] text-muted" title="Playwright WebKit is close to iOS Safari but not identical">WebKit ≈ Safari · safe-area insets approximated · live view polled</span>}
        {s.state.telegram.enabled && primary && <span className="text-[11px] text-muted">Dashed blue = drawn by Telegram, not your page</span>}
      </figcaption>}
    </figure>
  );
}

function DeviceToolbar({ s, d }: { s: SessionInfo; d: Device }) {
  const framed = useStore((st) => st.framed);
  const keyShot = useKey('copyShot');
  const sid = s.id;
  const st = (p: Parameters<typeof setState>[0]) => setState(p, sid);
  const cycle = <T,>(l: readonly T[], v: T) => l[(l.indexOf(v) + 1) % l.length]!;
  return (
    <div className="flex gap-1 p-1 rounded-[10px] bg-raised border border-line items-center flex-wrap justify-center">
      <Btn variant="ghost" size="icon" label="Rotate" cmd="rotateCw" onClick={() => RUN.rotateCw!()}>{I.rotate}</Btn>
      {d.fold && <Btn variant="ghost" size="icon" label={`Fold (${s.state.fold})`} cmd="fold" active={s.state.fold !== 'unfolded'} onClick={() => st({ fold: s.state.fold === 'folded' ? 'unfolded' : 'folded' })}>{I.fold}</Btn>}
      {d.fold && <Btn variant="ghost" size="sm" label="Half-open posture" cmd="halfOpen" active={s.state.fold === 'tabletop' || s.state.fold === 'book'} onClick={() => RUN.halfOpen!()}>{s.state.fold === 'tabletop' ? 'Tabletop' : s.state.fold === 'book' ? 'Book' : 'Half'}</Btn>}
      <Btn variant="ghost" size="sm" label="Browser bars: expanded → collapsed → PWA" cmd="bars" onClick={() => st({ bars: cycle(['expanded', 'collapsed', 'pwa'] as const, s.state.bars) })}>{I.bars}<span className="text-[11px]">{s.state.bars === 'pwa' ? 'PWA' : s.state.bars === 'collapsed' ? 'Scrolled' : 'Bars'}</span></Btn>
      {d.browsers.length > 1 && (
        <select aria-label="Browser" title={tip('Switch browser', 'Shift+B')} value={s.state.browser} onChange={(e) => st({ browser: e.target.value as any })} className="h-[30px] bg-transparent text-xs text-text rounded-md px-1 hover:bg-line cursor-pointer outline-none">
          {d.browsers.map((b) => <option key={b} value={b} className="bg-panel">{BROWSER_LABEL[b]}</option>)}
        </select>
      )}
      <Btn variant="ghost" size="icon" label="Light / dark" cmd="theme" onClick={() => RUN.theme!()}>{s.state.colorScheme === 'dark' ? I.sun : I.moon}</Btn>
      <Btn variant="ghost" size="icon" label="Network speed" cmd="cycleNetwork" active={s.state.network !== 'none'} onClick={() => RUN.cycleNetwork!()}>{I.net}</Btn>
      {s.engine === 'webkit' && s.state.network !== 'none' && s.state.network !== 'offline' && <ChromiumOnly engine="webkit" />}
      <Btn variant="ghost" size="icon" label="Telegram Mini App" cmd="telegram" active={s.state.telegram.enabled} onClick={() => st({ telegram: { enabled: !s.state.telegram.enabled } })}>{I.telegram}</Btn>
      <span className="w-px h-5 bg-line mx-0.5" />
      <Btn variant="ghost" size="icon" label="Screenshot options" cmd="shotOptions" onClick={() => RUN.shotOptions!()}>{I.camera}</Btn>
      <Btn variant="ghost" size="icon" label={`Copy screenshot (${framed ? 'framed' : 'plain'})`} title={tip(`Copy screenshot to clipboard (${framed ? 'framed' : 'plain'})`, keyShot)} active onClick={() => copyImage(() => act('screenshot', { session: sid, framed: get().framed, ...get().shotOpts }, 'Capturing…'))}>{I.copy}</Btn>
    </div>
  );
}

function TelegramOverlay({ s, tg }: { s: SessionInfo; tg: TgRuntime }) {
  const L = s.layout, t = L.tg!;
  const ox = L.frame.offsetX, oy = L.frame.offsetY;
  const trig = (what: string, arg?: string) => act('telegram_trigger', { session: s.id, what, arg });
  const pos = (r: { x: number; y: number; w: number; h: number }) => ({ left: ox + r.x, top: oy + r.y, width: r.w, height: r.h });
  const bb = t.bottomBar;
  const both = tg.mainButton.visible && tg.secondaryButton.visible;
  const bw = bb ? (both ? (bb.w - 36) / 2 : bb.w - 24) : 0;
  const order = tg.secondaryButton.position !== 'right' ? (['secondary', 'main'] as const) : (['main', 'secondary'] as const);
  let x = 12;
  const btns = bb ? order.filter((k) => (k === 'main' ? tg.mainButton : tg.secondaryButton).visible).map((k) => { const r = { k, x }; x += bw + 12; return r; }) : [];
  const dragStart = useRef<number | null>(null);
  return (
    <>
      {t.header && (
        <div className="absolute tgline" style={pos(t.header)}
          onPointerDown={(e) => { dragStart.current = e.clientY; }}
          onPointerUp={(e) => { if (dragStart.current !== null && Math.abs(e.clientY - dragStart.current) > 12) trig('dragSheet'); dragStart.current = null; }}>
          <button type="button" className="absolute left-0 top-0 h-full w-24 cursor-pointer" title={tg.backButton ? 'Telegram BackButton (Alt+B)' : 'Close Mini App'} onClick={() => trig(tg.backButton ? 'backButton' : 'close')} />
          <button type="button" className="absolute right-0 top-0 h-full w-16 cursor-pointer" title={tg.settingsButton ? 'Settings button' : 'Telegram menu'} onClick={() => (tg.settingsButton ? trig('settingsButton') : toast('Telegram menu (Settings button not enabled by the app)'))} />
        </div>
      )}
      {t.isFullscreen && <div className="absolute tgline pointer-events-none" style={pos({ x: 0, y: L.deviceSafeArea.top, w: L.screen.w, h: t.contentSafeAreaInset.top })} />}
      {bb && (
        <div className="absolute tgline" style={pos(bb)}>
          {btns.map((b) => {
            const btn = b.k === 'main' ? tg.mainButton : tg.secondaryButton;
            return <button key={b.k} type="button" disabled={!btn.active} title={`${b.k === 'main' ? 'MainButton' : 'SecondaryButton'}: fires ${b.k}ButtonClicked`} className="absolute cursor-pointer rounded-[10px] disabled:cursor-not-allowed" style={{ left: b.x, top: 8, width: bw, height: 44 }} onClick={() => trig(b.k === 'main' ? 'mainButton' : 'secondaryButton')} />;
          })}
        </div>
      )}
      {tg.popup && (
        <div className="absolute flex items-center justify-center" style={{ ...pos({ x: 0, y: 0, w: L.screen.w, h: L.screen.h }), background: 'rgba(0,0,0,.35)' }}>
          <div className="tgline bg-white text-[#111] rounded-2xl w-[78%] p-4 flex flex-col gap-2 shadow-xl" style={{ fontSize: 15 }}>
            {tg.popup.title && <div className="font-semibold text-[17px] text-center">{tg.popup.title}</div>}
            <div className="text-center whitespace-pre-wrap">{tg.popup.kind === 'qr' ? `QR scanner: ${tg.popup.message}` : tg.popup.message}</div>
            {tg.popup.kind === 'qr' && <QrInput onSubmit={(v) => trig('qr', v)} />}
            <div className="flex flex-col gap-1 mt-1">
              {tg.popup.buttons.map((b) => (
                <button key={b.id} type="button" onClick={() => (b.id === 'close' && tg.popup?.message.startsWith('Changes') ? trig('close', 'force') : trig('popup', b.id))} className={cx('h-10 rounded-lg cursor-pointer font-medium', b.type === 'destructive' ? 'text-[#e53935]' : 'text-[#2481cc]', 'hover:bg-black/5')}>
                  {b.text || ({ ok: 'OK', close: 'Close', cancel: 'Cancel' } as Record<string, string>)[b.type ?? 'ok'] || b.id}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {tg.closed && (
        <div className="absolute flex flex-col gap-3 items-center justify-center bg-[#0E0F12ee] text-text" style={pos({ x: 0, y: 0, w: L.screen.w, h: L.screen.h })}>
          <div className="text-lg font-semibold">Mini App closed</div>
          <div className="text-muted text-sm">The app called Telegram.WebApp.close()</div>
          <Btn variant="primary" onClick={() => trig('reopen')}>Reopen</Btn>
        </div>
      )}
    </>
  );
}

function QrInput({ onSubmit }: { onSubmit: (v: string) => void }) {
  const [v, setV] = useState('https://t.me/');
  return <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}><input aria-label="QR content" value={v} onChange={(e) => setV(e.target.value)} className="flex-1 border rounded px-2 h-9 text-sm" /><button className="px-3 rounded bg-[#2481cc] text-white text-sm" type="submit">Scan</button></form>;
}

function Switcher() {
  const sessions = useStore((s) => s.sessions);
  const focused = useStore((s) => s.focused);
  const compare = useStore((s) => s.compare);
  const view = useStore((s) => s.view);
  const audits = useStore((s) => s.audits);
  const catalog = useStore((s) => s.catalog);
  const busy = useStore((s) => s.busy);
  const idx = Math.max(0, sessions.findIndex((s) => s.id === focused));
  return (
    <div className="flex flex-col items-center gap-2 shrink-0 max-w-full">
      <nav aria-label="Switch device" className="flex items-center gap-1.5 p-1.5 rounded-xl bg-panel border border-line max-w-full overflow-x-auto">
        <Btn variant="raised" size="icon" label="Previous device" cmd="prevDevice" className="!w-[34px] !h-[34px] !border-0 shrink-0 sticky left-0 z-10" onClick={() => RUN.prevDevice!()}>{I.left}</Btn>
        {sessions.map((s, i) => {
          const n = (audits[s.id] ?? null)?.filter((x) => x.severity !== 'info').length ?? (s.issues ?? 0);
          const sev = audits[s.id]?.some((x) => x.severity === 'error') ? 'bg-errsolid' : 'bg-[#B5701F]';
          const d = deviceOf({ catalog } as any, s.deviceId);
          return (
            <button key={s.id} type="button" aria-current={s.id === focused} title={`${s.deviceName}${i < 9 ? ` (${i + 1})` : ''}${s.sharedWith.length ? ' · shares a page with ' + s.sharedWith.length + ' other' : ''}`}
              onClick={() => focusSession(s.id)}
              ref={s.id === focused ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) : undefined}
              className={cx('h-[34px] px-3 rounded-lg border text-xs flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap', s.id === focused ? 'border-accent bg-accentbg text-accentfg font-semibold' : view === 'compare' && s.id === compare ? 'border-line2 bg-raised text-text' : 'border-line bg-transparent text-soft hover:bg-raised')}>
              {d?.short ?? s.deviceName.replace(/^Galaxy /, '')}
              {n > 0 && <span className={cx('text-[10px] font-bold px-1.5 rounded-lg text-white', sev)}>{n}</span>}
              {s.source === 'mcp' && <span className="w-1.5 h-1.5 rounded-full bg-ok" title="Opened by Claude Code" />}
            </button>
          );
        })}
        <Btn variant="raised" size="icon" label="Next device" cmd="nextDevice" className="!w-[34px] !h-[34px] !border-0 shrink-0 sticky right-0 z-10" onClick={() => RUN.nextDevice!()}>{I.right}</Btn>
      </nav>
      <span className="text-xs text-muted text-center">
        {busy ?? <>{idx + 1} of {sessions.length} · use <Kbd k="ArrowLeft" /> <Kbd k="ArrowRight" /> to switch · other devices are checked in the background, not shown</>}
      </span>
    </div>
  );
}

function BreakpointsBar({ session }: { session: SessionInfo }) {
  const [bps, setBps] = useState<{ px: number; query: string }[]>([]);
  useEffect(() => { call('breakpoints', { session: session.id }).then(setBps, () => setBps([])); }, [session.id, session.url]);
  const w = session.layout.viewport.w;
  if (!bps.length) return <div className="h-9 shrink-0 border-b border-line bg-panel flex items-center px-4 text-[11px] text-muted">No width media queries found on this page</div>;
  const ranges: { from: number; to: number; label: string; q?: string }[] = [{ from: 0, to: bps[0]!.px - 1, label: `0–${bps[0]!.px - 1}` }, ...bps.map((b, i) => ({ from: b.px, to: (bps[i + 1]?.px ?? 9999) - 1, label: `${b.px}`, q: b.query }))];
  return (
    <div className="h-9 shrink-0 border-b border-line bg-panel flex items-center gap-1 px-3 overflow-x-auto" aria-label="Media query breakpoints">
      <span className="text-[11px] text-muted mr-1 shrink-0">Breakpoints</span>
      {ranges.map((r) => {
        const on = w >= r.from && w <= r.to;
        return (
          <button key={r.label} type="button" title={r.q ? `@media (${r.q}) · click to resize the device to ${r.from}px` : 'Below the first breakpoint'}
            onClick={() => setState({ width: Math.max(280, r.from || 360) }, session.id)}
            className={cx('h-6 px-2.5 rounded text-[11px] font-mono shrink-0 cursor-pointer', on ? 'bg-accentbg text-accentfg border border-accent' : 'text-muted border border-line hover:text-text')}>
            {r.label}
          </button>
        );
      })}
      {session.state.width ? <Btn size="sm" variant="ghost" className="ml-1 shrink-0" onClick={() => setState({ width: null }, session.id)}>Reset width ({w}px)</Btn> : null}
    </div>
  );
}

/** Full-screen controls: one small pill that fades out while the mouse is still. */
function ZenPill({ main }: { main?: SessionInfo }) {
  const sessions = useStore((s) => s.sessions);
  const [shown, setShown] = useState(true);
  const [fs, setFs] = useState(!!document.fullscreenElement);
  useEffect(() => {
    let t = window.setTimeout(() => setShown(false), 2500);
    const wake = () => { setShown(true); clearTimeout(t); t = window.setTimeout(() => setShown(false), 2500); };
    const onFs = () => setFs(!!document.fullscreenElement);
    addEventListener('pointermove', wake); addEventListener('keydown', wake); document.addEventListener('fullscreenchange', onFs);
    return () => { clearTimeout(t); removeEventListener('pointermove', wake); removeEventListener('keydown', wake); document.removeEventListener('fullscreenchange', onFs); };
  }, []);
  const idx = sessions.findIndex((s) => s.id === main?.id);
  return (
    <div role="toolbar" aria-label="Full screen controls"
      className={cx('absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 p-1 rounded-full bg-panel/90 border border-line shadow-xl backdrop-blur transition-opacity duration-300', shown ? 'opacity-100' : 'opacity-0 pointer-events-none')}
      onPointerEnter={() => setShown(true)}>
      <Btn variant="ghost" size="icon" label="Previous device" cmd="prevDevice" className="!rounded-full" onClick={() => RUN.prevDevice!()}>{I.left}</Btn>
      <span className="text-xs px-1 whitespace-nowrap">{main ? `${main.deviceName}` : 'No device'}{sessions.length > 1 ? <span className="text-muted"> · {idx + 1}/{sessions.length}</span> : null}</span>
      <Btn variant="ghost" size="icon" label="Next device" cmd="nextDevice" className="!rounded-full" onClick={() => RUN.nextDevice!()}>{I.right}</Btn>
      <span className="w-px h-4 bg-line" />
      <Btn variant="ghost" size="icon" label="Rotate" cmd="rotateCw" className="!rounded-full" onClick={() => RUN.rotateCw!()}>{I.rotate}</Btn>
      <Btn variant="ghost" size="icon" label="Copy screenshot" cmd="copyShot" className="!rounded-full" onClick={() => RUN.copyShot!()}>{I.copy}</Btn>
      <Btn variant="ghost" size="sm" label={fs ? 'Leave browser full screen' : 'Browser full screen'} cmd="browserFullscreen" className="!rounded-full" onClick={() => RUN.browserFullscreen!()}>{fs ? 'Exit browser FS' : 'Browser FS'}</Btn>
      <Btn variant="ghost" size="sm" label="Show panels" cmd="zen" className="!rounded-full" onClick={() => RUN.zen!()}>Exit <kbd>Esc</kbd></Btn>
    </div>
  );
}
