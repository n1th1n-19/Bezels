import type { AuditIssue, SessionInfo } from '../../../src/shared/types';
import { TG_VERSIONS } from '../../../src/shared/telegram';
import { act, set, useStore, type SideTab } from '../store';
import { RUN, focusSession, setState } from '../actions';
import { Badge, Btn, Field, Seg, cx } from '../ui';

export function SidePanel() {
  const tab = useStore((s) => s.sideTab);
  const f = useStore((s) => s.sessions.find((x) => x.id === s.focused) ?? s.sessions[0]);
  const errs = useStore((s) => (f ? (s.console[f.id] ?? []).filter((e) => e.level === 'error').length : 0));
  const tabs: { v: SideTab; l: string }[] = [{ v: 'audit', l: 'Audit' }, { v: 'console', l: `Console${errs ? ` ${errs}` : ''}` }, { v: 'network', l: 'Network' }, { v: 'telegram', l: 'Telegram' }];
  return (
    <aside aria-label="Inspector" className="w-[330px] shrink-0 border-l border-line bg-panel flex flex-col min-h-0">
      <div role="tablist" className="flex border-b border-line px-2 shrink-0">
        {tabs.map((t) => (
          <button key={t.v} role="tab" type="button" aria-selected={tab === t.v} onClick={() => set({ sideTab: t.v })}
            className={cx('h-10 px-2.5 text-[13px] cursor-pointer border-b-2', tab === t.v ? 'border-accent text-text font-semibold' : 'border-transparent text-muted hover:text-text')}>{t.l}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-2.5">
        {!f ? <span className="text-muted">Open a device first.</span>
          : tab === 'audit' ? <AuditList />
          : tab === 'console' ? <MiniConsole s={f} />
          : tab === 'network' ? <MiniNetwork s={f} />
          : <><TelegramControls s={f} /><TgEvents s={f} /></>}
      </div>
    </aside>
  );
}

const TONE = { error: { box: 'border-errline bg-errbg', badge: 'error' as const, l: 'ERROR' }, warn: { box: 'border-warnline bg-warnbg', badge: 'warn' as const, l: 'WARN' }, info: { box: 'border-line bg-raised', badge: 'info' as const, l: 'INFO' } };

/** Issues across every audited device, focused device first, grouped when several devices share one. */
export function AuditList() {
  const audits = useStore((s) => s.audits);
  const sessions = useStore((s) => s.sessions);
  const focused = useStore((s) => s.focused);
  const activity = useStore((s) => s.activity);
  const busy = useStore((s) => s.busy);
  const order = [...sessions].sort((a, b) => (a.id === focused ? -1 : b.id === focused ? 1 : 0));
  const groups = new Map<string, { issue: AuditIssue; devs: SessionInfo[] }>();
  for (const s of order) for (const i of audits[s.id] ?? []) {
    const k = `${i.type}|${i.selector ?? i.message}`;
    const g = groups.get(k);
    if (g) { if (!g.devs.includes(s)) g.devs.push(s); } else groups.set(k, { issue: i, devs: [s] });
  }
  const list = [...groups.values()].sort((a, b) => ['error', 'warn', 'info'].indexOf(a.issue.severity) - ['error', 'warn', 'info'].indexOf(b.issue.severity));
  const audited = order.filter((s) => audits[s.id]);
  const devCount = new Set(list.flatMap((g) => g.devs.map((d) => d.id))).size;
  const lastClaude = [...activity].reverse().find((a) => a.method.startsWith('audit'));
  const short = (s: SessionInfo) => s.deviceName.replace(/^(Galaxy|iPhone) /, (m) => (m === 'iPhone ' ? 'iPhone ' : '')) + (s.state.fold !== 'unfolded' && s.deviceId.includes('fold') ? ` (${s.state.fold})` : s.deviceId.includes('fold') ? ' (open)' : '');
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{audited.length ? `${list.length} issue${list.length === 1 ? '' : 's'} on ${devCount} device${devCount === 1 ? '' : 's'}` : 'Not audited yet'}</span>
        <div className="flex gap-1.5">
          <Btn size="sm" variant="raised" cmd="audit" label="Audit this device" onClick={() => RUN.audit!()}>Re-run</Btn>
          <Btn size="sm" variant="raised" cmd="auditAll" label="Audit the whole set (one at a time, in the background)" onClick={() => RUN.auditAll!()}>All</Btn>
        </div>
      </div>
      {busy && <div className="text-xs text-muted">{busy}</div>}
      {list.map(({ issue: i, devs }, n) => {
        const t = TONE[i.severity];
        return (
          <div key={n} className={cx('border rounded-lg p-2.5 flex flex-col gap-1.5', t.box)}>
            <div className="flex gap-1.5 items-center"><Badge tone={t.badge}>{t.l}</Badge><span className="font-semibold">{i.title}</span></div>
            <span className="text-soft break-words">{devs.map(short).join(', ')} · {i.message}</span>
            {(i.selector || i.rect) && (
              <a href="#" className="text-xs" onClick={async (e) => { e.preventDefault(); const s = devs[0]!; if (s.id !== focused) await focusSession(s.id); act('highlight', { session: s.id, items: [{ selector: i.selector, rect: i.selector ? undefined : i.rect, label: i.title, color: i.severity === 'error' ? '#FF7A7A' : '#FFB062' }], ms: 5000 }); }}>Highlight on device</a>
            )}
          </div>
        );
      })}
      {!audited.length && <p className="text-muted text-xs">Press <kbd>A</kbd> to audit this device, <kbd>Shift</kbd> <kbd>A</kbd> for the whole set. Checks: overflow, tap targets, small text, notch/browser-bar/home-indicator overlap, fixed overlap, images, 100vh, Telegram rules.</p>}
      {lastClaude && Date.now() - lastClaude.time < 30 * 60_000 && (
        <div className="mt-1 p-2.5 rounded-lg border border-okline bg-[#131D18] flex gap-2 items-start">
          <span className="w-2 h-2 rounded-full bg-ok mt-1 shrink-0" />
          <span className="text-[#C9EEDA] text-xs">Claude Code ran {lastClaude.method.replace('_', ' ')} {Math.max(1, Math.round((Date.now() - lastClaude.time) / 60_000))} min ago.</span>
        </div>
      )}
    </>
  );
}

function MiniConsole({ s }: { s: SessionInfo }) {
  const entries = useStore((st) => st.console[s.id] ?? []);
  return (
    <>
      <div className="flex justify-between items-center"><span className="text-muted text-xs">{entries.length} messages</span><Btn size="sm" variant="raised" onClick={() => set({ devtools: true, panel: 'console' })}>Open in DevTools</Btn></div>
      {entries.slice(-150).map((e) => (
        <div key={e.id} className={cx('font-mono text-[11px] border-b border-line/50 pb-1 break-words', e.level === 'error' ? 'text-err' : e.level === 'warning' ? 'text-warn' : 'text-soft')}>
          {e.text}{e.url && <div className="text-muted">{(e.mapped ?? `${e.url.split('/').pop()}:${e.line}`)}</div>}
        </div>
      ))}
    </>
  );
}

function MiniNetwork({ s }: { s: SessionInfo }) {
  const entries = useStore((st) => (st.network[s.id] ?? []).filter((e) => e.failed || e.status >= 400));
  return (
    <>
      <div className="flex justify-between items-center"><span className="text-muted text-xs">{entries.length} failed request{entries.length === 1 ? '' : 's'}</span><Btn size="sm" variant="raised" onClick={() => set({ devtools: true, panel: 'network' })}>Open in DevTools</Btn></div>
      {entries.map((e) => <div key={e.id} className="font-mono text-[11px] flex gap-2 border-b border-line/50 pb-1"><span className="text-err shrink-0">{e.failed ? 'ERR' : e.status}</span><span className="break-all text-soft">{e.url}</span></div>)}
    </>
  );
}

/** Mode / platform / theme / version + simulate buttons (Focus mockup, left column). */
export function TelegramControls({ s }: { s: SessionInfo }) {
  const t = s.state.telegram;
  const botToken = useStore((st) => st.catalog?.botToken);
  const tg = (p: Partial<typeof t>) => setState({ telegram: p }, s.id);
  const trig = (what: string) => act('telegram_trigger', { session: s.id, what });
  const L = s.layout;
  if (!t.enabled) return (
    <div className="flex flex-col gap-2 p-3 border border-line rounded-lg">
      <div className="font-semibold">Telegram Mini App</div>
      <div className="text-muted text-xs">Run this page inside a mocked Telegram web view: header, native buttons, theme, viewport and safe-area variables, initData.</div>
      <Btn variant="primary" cmd="telegram" label="Telegram on" onClick={() => tg({ enabled: true })}>Open as Mini App</Btn>
    </div>
  );
  return (
    <div className="flex flex-col gap-2.5 pb-3 border-b border-line">
      <div className="flex justify-between items-center"><span className="font-semibold">Telegram Mini App</span><Btn size="sm" variant="ghost" onClick={() => tg({ enabled: false })}>Turn off</Btn></div>
      <Field label="Platform"><Seg small value={['tdesktop', 'macos'].includes(t.platform) ? 'tdesktop' : ['weba', 'webk'].includes(t.platform) ? 'weba' : t.platform} onChange={(v) => tg({ platform: v as any })} options={[{ v: 'ios', l: 'iOS' }, { v: 'android', l: 'Android' }, { v: 'tdesktop', l: 'Desktop' }, { v: 'weba', l: 'Web' }]} /></Field>
      <Field label="Mode"><Seg small value={t.mode} onChange={(v) => tg({ mode: v })} options={[{ v: 'compact', l: 'Compact' }, { v: 'expanded', l: 'Expanded' }, { v: 'fullscreen', l: 'Fullscreen' }]} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Theme"><select className="h-7 rounded-md border border-line bg-bg text-xs px-1" value={t.theme} onChange={(e) => tg({ theme: e.target.value as any })}><option value="light">Light</option><option value="dark">Dark</option><option value="custom">Custom</option></select></Field>
        <Field label="API version"><select className="h-7 rounded-md border border-line bg-bg text-xs px-1" value={t.version} onChange={(e) => tg({ version: e.target.value })}>{[...TG_VERSIONS].reverse().map((v, i) => <option key={v} value={v}>{i === 0 ? `Latest (${v})` : v}</option>)}</select></Field>
      </div>
      {t.theme === 'custom' && <CustomTheme s={s} />}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start param"><input className="h-7 rounded-md border border-line bg-bg text-xs px-2" defaultValue={t.startParam ?? ''} onBlur={(e) => e.target.value !== (t.startParam ?? '') && tg({ startParam: e.target.value })} /></Field>
        <Field label="Language"><input className="h-7 rounded-md border border-line bg-bg text-xs px-2" defaultValue={t.language} onBlur={(e) => e.target.value !== t.language && tg({ language: e.target.value })} /></Field>
      </div>
      <div className="text-[11px] text-muted">Simulate</div>
      <div className="flex flex-wrap gap-1.5">
        <Btn size="sm" variant="raised" cmd="tgBack" label="Back button" onClick={() => trig('backButton')}>Back button</Btn>
        <Btn size="sm" variant="raised" onClick={() => trig('themeChanged')}>Theme change</Btn>
        <Btn size="sm" variant="raised" onClick={() => trig('dragSheet')}>Drag sheet</Btn>
        <Btn size="sm" variant="raised" onClick={() => trig('mainButton')}>MainButton</Btn>
        <Btn size="sm" variant="raised" onClick={() => trig('settingsButton')}>Settings</Btn>
        <Btn size="sm" variant="raised" onClick={() => trig('close')}>Close</Btn>
      </div>
      <div className="font-mono text-[11px] text-muted leading-5 p-2 rounded-md bg-bg border border-line">
        viewport {L.viewport.w}×{L.viewport.h} · stable {L.viewport.h}<br />
        safeArea top {L.tg?.safeAreaInset.top ?? 0} · bottom {L.tg?.safeAreaInset.bottom ?? 0}<br />
        contentSafeArea top {L.tg?.contentSafeAreaInset.top ?? 0}<br />
        initData: test user ({botToken ? 'signed with test bot token' : 'unsigned: server validation will fail'})
      </div>
    </div>
  );
}

function CustomTheme({ s }: { s: SessionInfo }) {
  const keys = ['bg_color', 'text_color', 'hint_color', 'link_color', 'button_color', 'button_text_color', 'secondary_bg_color', 'header_bg_color', 'bottom_bar_bg_color', 'accent_text_color', 'section_bg_color', 'destructive_text_color'];
  const tp = s.state.telegram.themeParams ?? {};
  return (
    <div className="grid grid-cols-2 gap-1">
      {keys.map((k) => <label key={k} className="flex items-center gap-1.5 text-[11px]"><input type="color" value={tp[k] ?? '#ffffff'} onChange={(e) => setState({ telegram: { themeParams: { ...tp, [k]: e.target.value } } }, s.id)} className="w-6 h-5 bg-transparent border-0 p-0" />{k.replace(/_color$/, '')}</label>)}
    </div>
  );
}

export function TgEvents({ s }: { s: SessionInfo }) {
  const ev = useStore((st) => st.tgEvents[s.id] ?? []);
  if (!s.state.telegram.enabled) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] text-muted uppercase tracking-wider">Calls from your app</div>
      {!ev.length && <span className="text-muted text-xs">No Telegram.WebApp calls yet.</span>}
      {[...ev].reverse().slice(0, 300).map((e, i) => (
        <div key={i} className="font-mono text-[11px] flex gap-2">
          <span className="text-muted shrink-0">{new Date(e.time).toLocaleTimeString([], { hour12: false })}</span>
          <span className={cx('break-all', e.unsupported ? 'text-err' : 'text-text')}>{e.method}({e.args.map((a) => JSON.stringify(a)).join(', ').slice(0, 120)}){e.unsupported ? ` (needs ${e.minVersion})` : ''}</span>
        </div>
      ))}
    </div>
  );
}
