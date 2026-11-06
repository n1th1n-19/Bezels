/** Every command in Bezels with its default key. "Mod" = Ctrl on Linux/Windows, Cmd on macOS. "g e" = chord. */
export interface CommandDef { id: string; title: string; area: string; key: string }

export const COMMANDS: CommandDef[] = [
  { id: 'palette', title: 'Command palette', area: 'General', key: 'Mod+K' },
  { id: 'cheatsheet', title: 'Shortcut cheat sheet', area: 'General', key: '?' },
  { id: 'focusUrl', title: 'Focus URL bar', area: 'General', key: 'L' },
  { id: 'reload', title: 'Reload device', area: 'General', key: 'R' },
  { id: 'hardReloadAll', title: 'Hard reload all (clear cache)', area: 'General', key: 'Shift+R' },
  { id: 'keysToDevice', title: 'Send keys to device', area: 'General', key: 'Enter' },
  { id: 'settings', title: 'Settings & keymap', area: 'General', key: 'Mod+,' },
  { id: 'memory', title: 'Memory meter details', area: 'General', key: 'Shift+M' },
  { id: 'limits', title: 'Honest limits of emulation', area: 'General', key: 'g h' },
  { id: 'zen', title: 'Full screen: hide all panels', area: 'General', key: 'Z' },
  { id: 'browserFullscreen', title: 'Browser full screen (hides browser UI too)', area: 'General', key: 'g z' },
  { id: 'prevDevice', title: 'Previous device', area: 'Devices', key: 'ArrowLeft' },
  { id: 'nextDevice', title: 'Next device', area: 'Devices', key: 'ArrowRight' },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `device${i + 1}`, title: `Jump to device ${i + 1}`, area: 'Devices', key: String(i + 1) })),
  { id: 'searchDevices', title: 'Search devices', area: 'Devices', key: '/' },
  { id: 'switchSet', title: 'Switch device set', area: 'Devices', key: 'Shift+D' },
  { id: 'toggleCompare', title: 'Single ↔ Compare 2', area: 'Devices', key: 'V' },
  { id: 'comparePrev', title: 'Compare: previous second device', area: 'Devices', key: 'Shift+ArrowLeft' },
  { id: 'compareNext', title: 'Compare: next second device', area: 'Devices', key: 'Shift+ArrowRight' },
  { id: 'toggleSync', title: 'Compare: sync scroll & navigation', area: 'Devices', key: 'Shift+V' },
  { id: 'zoomIn', title: 'Zoom in', area: 'Devices', key: '=' },
  { id: 'zoomOut', title: 'Zoom out', area: 'Devices', key: '-' },
  { id: 'zoomFit', title: 'Zoom to fit', area: 'Devices', key: '\\' },
  { id: 'customDevice', title: 'New custom device', area: 'Devices', key: 'g d' },
  { id: 'rotateCw', title: 'Rotate clockwise', area: 'Device state', key: 'O' },
  { id: 'rotateCcw', title: 'Rotate anticlockwise', area: 'Device state', key: 'Shift+O' },
  { id: 'fold', title: 'Fold / unfold', area: 'Device state', key: 'F' },
  { id: 'halfOpen', title: 'Half-open posture (tabletop / book)', area: 'Device state', key: 'Shift+F' },
  { id: 'bars', title: 'Browser bars: expanded → collapsed → PWA', area: 'Device state', key: 'B' },
  { id: 'switchBrowser', title: 'Switch browser', area: 'Device state', key: 'Shift+B' },
  { id: 'theme', title: 'Light / dark', area: 'Device state', key: 'T' },
  { id: 'telegram', title: 'Telegram Mini App on / off', area: 'Device state', key: 'Shift+T' },
  { id: 'tgCompact', title: 'Telegram compact', area: 'Device state', key: 'Alt+1' },
  { id: 'tgExpanded', title: 'Telegram expanded', area: 'Device state', key: 'Alt+2' },
  { id: 'tgFullscreen', title: 'Telegram fullscreen', area: 'Device state', key: 'Alt+3' },
  { id: 'tgBack', title: 'Telegram BackButton press', area: 'Device state', key: 'Alt+B' },
  { id: 'copyShot', title: 'Copy device screenshot', area: 'Screenshots', key: 'C' },
  { id: 'copyFullShot', title: 'Copy full-page screenshot', area: 'Screenshots', key: 'Shift+C' },
  { id: 'toggleFramed', title: 'Framed / plain for next capture', area: 'Screenshots', key: 'Alt+C' },
  { id: 'saveShot', title: 'Save PNG', area: 'Screenshots', key: 'S' },
  { id: 'captureAll', title: 'Capture all (contact sheet) + copy', area: 'Screenshots', key: 'Shift+S' },
  { id: 'tray', title: 'Screenshot tray', area: 'Screenshots', key: 'Y' },
  { id: 'shotOptions', title: 'Screenshot options', area: 'Screenshots', key: 'g o' },
  { id: 'devtools', title: 'Open / close DevTools drawer', area: 'DevTools', key: '`' },
  { id: 'inspect', title: 'Inspect: pick an element', area: 'DevTools', key: 'I' },
  { id: 'panelElements', title: 'Elements', area: 'DevTools', key: 'g e' },
  { id: 'panelConsole', title: 'Console', area: 'DevTools', key: 'g c' },
  { id: 'panelNetwork', title: 'Network', area: 'DevTools', key: 'g n' },
  { id: 'panelPerformance', title: 'Performance', area: 'DevTools', key: 'g p' },
  { id: 'panelStorage', title: 'Storage', area: 'DevTools', key: 'g s' },
  { id: 'panelA11y', title: 'Accessibility', area: 'DevTools', key: 'g a' },
  { id: 'panelAudit', title: 'Audit', area: 'DevTools', key: 'g u' },
  { id: 'panelTelegram', title: 'Telegram events', area: 'DevTools', key: 'g t' },
  { id: 'clearPanel', title: 'Clear current panel', area: 'DevTools', key: 'X' },
  { id: 'cycleNetwork', title: 'Cycle network speed', area: 'DevTools', key: 'Shift+N' },
  { id: 'offline', title: 'Offline on / off', area: 'DevTools', key: 'Shift+W' },
  { id: 'cycleCpu', title: 'Cycle CPU throttle', area: 'DevTools', key: 'Shift+P' },
  { id: 'audit', title: 'Run layout audit (device)', area: 'DevTools', key: 'A' },
  { id: 'auditAll', title: 'Run layout audit (whole set)', area: 'DevTools', key: 'Shift+A' },
  { id: 'freshVisit', title: 'Fresh visit (clear storage + reload)', area: 'DevTools', key: 'g f' },
  { id: 'sensors', title: 'Sensors panel', area: 'Sensors', key: 'g l' },
  { id: 'locationPicker', title: 'Location preset picker', area: 'Sensors', key: 'Shift+L' },
  { id: 'tzPicker', title: 'Timezone & language picker', area: 'Sensors', key: 'Shift+Z' },
  { id: 'shake', title: 'Send shake event', area: 'Sensors', key: 'K' },
  { id: 'emulationMenu', title: 'Emulation menu', area: 'Sensors', key: 'Shift+E' },
  { id: 'activity', title: 'Show Claude Code activity', area: 'Claude Code', key: 'g k' },
  { id: 'pauseAgent', title: 'Pause / resume Claude Code control', area: 'Claude Code', key: 'Shift+K' },
];

export const DEFAULT_KEYMAP: Record<string, string> = Object.fromEntries(COMMANDS.map((c) => [c.id, c.key]));

/** Combos the browser keeps for itself: never bind these. */
export const RESERVED = ['Mod+T', 'Mod+W', 'Mod+N', 'Mod+Tab', 'Mod+L', 'Mod+Shift+C', 'Mod+Shift+I', 'Mod+Shift+J', 'Mod+=', 'Mod+-', 'Mod+0', 'Mod+R', 'Mod+Q', 'F5', 'F12'];

/** Returns { key: [commandIds] } for keys bound more than once, plus reserved-key bindings. */
export function keymapConflicts(map: Record<string, string>): { duplicates: Record<string, string[]>; reserved: string[] } {
  const by: Record<string, string[]> = {};
  for (const [id, k] of Object.entries(map)) if (k) (by[k] ??= []).push(id);
  const duplicates = Object.fromEntries(Object.entries(by).filter(([, ids]) => ids.length > 1));
  // A chord "g x" also conflicts with a single-key binding "G".
  const reserved = Object.entries(map).filter(([, k]) => RESERVED.includes(k)).map(([id]) => id);
  return { duplicates, reserved };
}

/** Normalise a KeyboardEvent into our key string. */
export function eventToKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; code?: string }, mac: boolean): string {
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  let k = e.key;
  // Alt+digit gives odd characters on macOS; use the code.
  if (e.altKey && e.code?.startsWith('Digit')) k = e.code.slice(5);
  if (e.altKey && e.code?.startsWith('Key')) k = e.code.slice(3);
  const printableShifted = k.length === 1 && !/[a-zA-Z0-9]/.test(k);
  if (e.shiftKey && !printableShifted) parts.push('Shift');
  if (k === ' ') k = 'Space';
  if (k.length === 1) k = k.toUpperCase() === k.toLowerCase() ? k : k.toUpperCase();
  parts.push(k);
  return parts.join('+');
}
