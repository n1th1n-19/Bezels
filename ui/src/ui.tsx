import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useStore } from './store';

/** Tiny UI kit matching the mockups. */
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

/** Formats "Shift+R" / "g e" / "Mod+K" for display. */
export function keyLabel(k?: string) {
  if (!k) return '';
  const mac = /Mac/.test(navigator.platform);
  return k.replace('Mod', mac ? '⌘' : 'Ctrl').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('Shift+', 'Shift ').replace('Alt+', mac ? '⌥ ' : 'Alt ').replace('Ctrl+', 'Ctrl ').replace('⌘+', '⌘ ');
}
export function Kbd({ k }: { k?: string }) { return k ? <span className="inline-flex gap-1">{keyLabel(k).split(' ').map((p, i) => <kbd key={i}>{p}</kbd>)}</span> : null; }
/** Key currently bound to a command (respects the user's keymap). */
export function useKey(cmd: string) { return useStore((s) => s.keymap?.map[cmd]); }
export function tip(title: string, key?: string) { return key ? `${title} (${keyLabel(key)})` : title; }

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'ghost' | 'raised' | 'primary' | 'accent' | 'outline' | 'danger'; size?: 'sm' | 'md' | 'icon'; active?: boolean; cmd?: string; label?: string };
export function Btn({ variant = 'outline', size = 'md', active, className, cmd, label, title, children, ...p }: BtnProps) {
  const key = useKey(cmd ?? '');
  return (
    <button
      type="button"
      title={title ?? (label ? tip(label, cmd ? key : undefined) : undefined)}
      aria-label={label}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-[inherit] text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none',
        size === 'icon' ? 'w-[30px] h-[30px] rounded-md' : size === 'sm' ? 'h-7 px-2.5 rounded-md' : 'h-[30px] px-3',
        variant === 'ghost' && 'bg-transparent text-text hover:bg-raised',
        variant === 'raised' && 'bg-raised text-text hover:bg-line border border-line',
        variant === 'primary' && 'bg-accent text-bg font-semibold hover:brightness-110',
        variant === 'outline' && 'border border-line bg-transparent text-text hover:bg-raised',
        variant === 'danger' && 'border border-errline bg-errbg text-err hover:brightness-125',
        active && (variant === 'ghost' ? '!bg-accentbg !text-accentfg' : '!border-accent !bg-accentbg !text-accentfg'),
        className,
      )}
      {...p}
    >
      {children}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange, label, small }: { value: T; options: { v: T; l: ReactNode; title?: string; disabled?: boolean }[]; onChange: (v: T) => void; label?: string; small?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex border border-line rounded-lg overflow-hidden shrink-0">
      {options.map((o) => (
        <button type="button" key={o.v} title={o.title} disabled={o.disabled} onClick={() => onChange(o.v)} aria-pressed={value === o.v}
          className={cx(small ? 'h-7 px-2 text-[11px]' : 'h-[30px] px-3 text-xs', 'font-[inherit] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed', value === o.v ? 'bg-line text-text' : 'bg-transparent text-muted hover:text-text')}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cx('flex flex-col gap-1', className)}><span className="text-[11px] text-muted">{label}</span>{children}</label>;
}
export const inputCls = 'h-8 px-2.5 rounded-lg border border-line bg-bg text-text text-xs font-[inherit] outline-none focus:border-accent min-w-0';

export function Badge({ tone, children }: { tone: 'error' | 'warn' | 'info' | 'ok' | 'accent'; children: ReactNode }) {
  return <span className={cx('text-[10px] font-bold px-1.5 py-px rounded', tone === 'error' && 'bg-errsolid text-white', tone === 'warn' && 'bg-warn text-[#2A1A05]', tone === 'info' && 'bg-line text-text', tone === 'ok' && 'bg-okbg text-okfg', tone === 'accent' && 'bg-accentbg text-accentfg')}>{children}</span>;
}

/** Chromium-only feature on a WebKit device: say so instead of hiding it. */
export function ChromiumOnly({ engine }: { engine?: string }) {
  return engine === 'webkit' ? <span title="WebKit has no DevTools protocol, so Bezels can't emulate this on Apple devices" className="text-[10px] px-1.5 rounded bg-warnbg border border-warnline text-warn whitespace-nowrap">Chromium only</span> : null;
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-start justify-center p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={cx('fade-in bg-panel border border-line rounded-xl shadow-2xl flex flex-col max-h-[84vh] w-full', wide ? 'max-w-[1100px]' : 'max-w-[560px]')}>
        <div className="flex items-center gap-3 px-4 h-12 border-b border-line shrink-0"><div className="font-semibold text-sm flex-1 flex items-center gap-3">{title}</div><Btn variant="ghost" size="icon" label="Close" onClick={onClose}>{I.x}</Btn></div>
        <div className="overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

const svg = (d: ReactNode, size = 15) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
export const I = {
  logo: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7AA7FF" strokeWidth="2" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="3" /><rect x="8" y="5" width="8" height="12" rx="1" strokeWidth="1.5" /></svg>,
  reload: svg(<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>, 14),
  rotate: svg(<><rect x="7" y="2" width="10" height="16" rx="2" /><path d="M3 19a9 9 0 0 0 15 2" /></>),
  bars: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 16h18" /></>),
  moon: svg(<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />),
  sun: svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  camera: svg(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>),
  copy: svg(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>, 14),
  save: svg(<><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></>, 14),
  trash: svg(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>, 14),
  left: svg(<path d="M15 6l-6 6 6 6" />, 14),
  right: svg(<path d="M9 6l6 6-6 6" />, 14),
  x: svg(<path d="M6 6l12 12M18 6L6 18" />, 14),
  fold: svg(<><path d="M12 3v18" /><rect x="3" y="4" width="18" height="16" rx="2" /></>),
  net: svg(<><path d="M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0" /><circle cx="12" cy="20" r="1" /></>),
  telegram: svg(<path d="M21 4L3 11l6 2 2 6 3-4 5 4z" />),
  pin: svg(<><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>, 14),
  inspect: svg(<><path d="M4 4l7 17 2-7 7-2z" /></>, 14),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>, 14),
  keyboard: svg(<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>, 14),
  sensors: svg(<><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2" /></>, 14),
  tray: svg(<><path d="M3 15h5l2 3h4l2-3h5" /><path d="M5 4h14l2 11v5H3v-5z" /></>, 14),
  expand: svg(<><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>),
  pause: svg(<path d="M8 5v14M16 5v14" />, 12),
  play: svg(<path d="M7 5l12 7-12 7z" />, 12),
};
