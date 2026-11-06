import { useEffect, useState } from 'react';
import { get, loadBuffers, set, useStore } from './store';
import { onKeyDown, openSet } from './actions';
import { onConnection } from './rpc';
import { TopBar, Library, Tray } from './components/Chrome';
import { Stage } from './components/Stage';
import { SidePanel } from './components/SidePanel';
import { Sensors } from './components/Sensors';
import { DevTools } from './components/DevTools';
import { ActivityPanel, Cheatsheet, ChordIndicator, CustomDialog, LimitsModal, MemoryModal, Palette, SetPicker, Settings, Toast } from './components/Overlays';

export function App() {
  const ready = useStore((s) => s.ready);
  const focused = useStore((s) => s.focused);
  const sensors = useStore((s) => s.sensors);
  const [conn, setConn] = useState(true);

  useEffect(() => { const un = onConnection(setConn); return () => { un(); }; }, []);
  useEffect(() => { addEventListener('keydown', onKeyDown); return () => removeEventListener('keydown', onKeyDown); }, []);
  useEffect(() => { if (focused) { loadBuffers(focused); set({ inspected: null }); } }, [focused]);
  // First run: open the remembered set if nothing is open yet.
  useEffect(() => { if (ready && !get().sessions.length && get().setName !== 'custom') openSet(get().setName); }, [ready]);

  if (!ready) return <div className="h-full flex items-center justify-center text-muted">{conn ? 'Connecting to Bezels…' : 'Bezels engine not reachable. Start it with: bezels serve'}</div>;
  return (
    <div className="h-full flex flex-col">
      <TopBar />
      {!conn && <div className="bg-errbg text-err border-b border-errline px-4 py-1.5 text-xs">Lost connection to the Bezels engine. Reconnecting…</div>}
      <div className="flex flex-1 min-h-0">
        <Library />
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <Stage />
          <DevTools />
        </div>
        {sensors ? <Sensors /> : <SidePanel />}
      </div>
      <Tray />
      <Footer />
      <Toast /><ChordIndicator /><Palette /><Cheatsheet /><Settings /><MemoryModal /><LimitsModal /><ActivityPanel /><SetPicker /><CustomDialog />
    </div>
  );
}

function Footer() {
  return (
    <div className="h-6 shrink-0 border-t border-line bg-bg flex items-center gap-3 px-4 text-[11px] text-muted">
      <span>Emulation, not a real phone: WebKit ≈ iOS Safari, browser-bar heights ≈.</span>
      <button type="button" className="underline decoration-dotted cursor-pointer hover:text-text" onClick={() => set({ limits: true })}>Honest limits</button>
      <span className="flex-1" />
      <button type="button" className="cursor-pointer hover:text-text" onClick={() => set({ palette: true })}><kbd>Ctrl</kbd> <kbd>K</kbd> commands</button><button type="button" className="cursor-pointer hover:text-text" onClick={() => set({ cheatsheet: true })}><kbd>?</kbd> shortcuts</button>
    </div>
  );
}
