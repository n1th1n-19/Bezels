// Shared types used by core (Node) and UI (browser). No runtime imports here.

export type Engine = "chromium" | "webkit";
export type Category =
  | "phone"
  | "foldable"
  | "tablet"
  | "laptop"
  | "desktop"
  | "custom";
export type OS = "ios" | "ipados" | "android" | "macos" | "windows" | "linux";
export type BrowserId = "safari" | "chrome" | "samsung" | "edge";
export type Cutout = "notch" | "island" | "punch-hole" | "none";

export interface Size {
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Heights in CSS px of the browser's own UI. */
export interface BrowserChrome {
  top: number;
  bottom: number; // portrait, bars expanded
  collapsedTop: number;
  collapsedBottom: number; // portrait, scrolled (bars collapsed)
  landscapeTop: number;
  landscapeBottom: number; // landscape, bars expanded
}

export interface FoldSpec {
  foldedScreen: Size;
  unfoldedScreen: Size;
  /** Hinge axis in the unfolded, portrait screen. */
  hinge: { orientation: "vertical" | "horizontal"; width: number };
}

export interface Device {
  id: string;
  name: string;
  short?: string;
  category: Category;
  os: OS;
  defaultBrowser: BrowserId;
  browsers: BrowserId[];
  /** Portrait (or native for desktops) screen in CSS px. For foldables: the unfolded screen. */
  screen: Size;
  dpr: number;
  /** UA per browser. */
  userAgent: Partial<Record<BrowserId, string>>;
  statusBarHeight: number;
  /** OS bar at the bottom of desktops (taskbar) or Android gesture/nav bar. */
  navBarHeight?: number;
  browserChrome: Partial<Record<BrowserId, BrowserChrome>>;
  safeArea: Insets;
  cutout: Cutout;
  cornerRadius: number;
  fold?: FoldSpec;
  touch: boolean;
  mobile: boolean;
  source: string;
}

export type Orientation =
  | "portrait"
  | "landscape-left"
  | "landscape-right"
  | "portrait-upside-down";
export type FoldState = "folded" | "unfolded" | "tabletop" | "book";
export type Bars = "expanded" | "collapsed" | "pwa";
export type NetworkPreset =
  | "none"
  | "fast4g"
  | "slow4g"
  | "3g"
  | "offline"
  | "custom";
export type TgMode = "compact" | "expanded" | "fullscreen";
export type TgPlatform =
  | "ios"
  | "android"
  | "tdesktop"
  | "macos"
  | "weba"
  | "webk";

export interface TelegramSettings {
  enabled: boolean;
  mode: TgMode;
  platform: TgPlatform;
  theme: "light" | "dark" | "custom";
  themeParams?: Record<string, string>;
  version: string;
  language: string;
  startParam?: string;
  user?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
  };
}

export interface Emulation {
  timezone?: string;
  locale?: string;
  geolocation?:
    | { lat: number; lng: number; accuracy: number }
    | "unavailable"
    | null;
  permissions?: Record<string, "allow" | "ask" | "block">;
  vision?:
    | "none"
    | "protanopia"
    | "deuteranopia"
    | "tritanopia"
    | "achromatopsia"
    | "blurredVision";
  forcedColors?: boolean;
  print?: boolean;
  touch?: boolean;
  idle?: "active" | "idle" | "locked";
  battery?: number | null;
  sensors?: { alpha: number; beta: number; gamma: number } | null;
  userAgent?: string | null;
  cacheDisabled?: boolean;
  blocked?: string[];
  customNetwork?: {
    downloadKbps: number;
    uploadKbps: number;
    latencyMs: number;
  };
}

export interface DeviceState {
  orientation: Orientation;
  fold: FoldState;
  bars: Bars;
  browser: BrowserId;
  colorScheme: "light" | "dark";
  reducedMotion: boolean;
  network: NetworkPreset;
  cpu: number;
  /** Custom viewport width override (breakpoints bar). */
  width?: number | null;
  telegram: TelegramSettings;
  emulation: Emulation;
}

/** Runtime state of Telegram's own UI, driven by the page's WebApp calls. */
export interface TgButton {
  visible: boolean;
  text: string;
  color?: string;
  textColor?: string;
  active: boolean;
  progress: boolean;
  hasShineEffect?: boolean;
  position?: string;
}
export interface TgRuntime {
  mainButton: TgButton;
  secondaryButton: TgButton;
  backButton: boolean;
  settingsButton: boolean;
  headerColor?: string;
  backgroundColor?: string;
  bottomBarColor?: string;
  closingConfirmation: boolean;
  verticalSwipes: boolean;
  closed: boolean;
  popup?: {
    kind: "popup" | "alert" | "confirm" | "qr";
    title?: string;
    message: string;
    buttons: { id: string; type?: string; text?: string }[];
  } | null;
  /** extra px subtracted from the viewport while the sheet is being dragged */
  dragOffset: number;
}

export interface Layout {
  engine: Engine;
  /** Oriented screen size. */
  screen: Size;
  /** Page viewport inside the screen. */
  viewport: Rect;
  statusBar: Rect | null;
  chromeTop: Rect | null;
  chromeBottom: Rect | null;
  navBar: Rect | null;
  /** Screen-level safe area for the current orientation. */
  deviceSafeArea: Insets;
  /** Safe-area insets relative to the page viewport (what env(safe-area-inset-*) should return). */
  pageSafeArea: Insets;
  cutoutRect: Rect | null;
  hinge: Rect | null;
  rotation: 0 | 90 | 180 | 270;
  /** Collapsed-bars viewport height (what 100vh means on mobile browsers). */
  largeViewportH: number;
  tg: null | {
    window: Rect; // area Telegram uses (sheet / window / screen)
    header: Rect | null; // Telegram header (close / title / menu)
    bottomBar: Rect | null;
    safeAreaInset: Insets;
    contentSafeAreaInset: Insets;
    isExpanded: boolean;
    isFullscreen: boolean;
  };
  /** Frame (bezel) geometry, in CSS px; screen is drawn at (bezel.x, bezel.y). */
  frame: {
    w: number;
    h: number;
    offsetX: number;
    offsetY: number;
    kind: "phone" | "tablet" | "laptop" | "desktop";
  };
}

export interface AuditIssue {
  severity: "error" | "warn" | "info";
  type: string;
  title: string;
  message: string;
  selector?: string;
  rect?: Rect;
}

export interface SessionInfo {
  id: string;
  deviceId: string;
  deviceName: string;
  url: string;
  title?: string;
  state: DeviceState;
  layout: Layout;
  status: "live" | "frozen" | "evicted" | "loading";
  engine: Engine;
  sharedWith: string[];
  errors: { console: number; network: number };
  issues: number | null;
  source: "ui" | "mcp" | "cli";
  focused: boolean;
  snapshot?: string;
  error?: string;
}

export interface ConsoleEntry {
  id: number;
  time: number;
  level: string;
  text: string;
  url?: string;
  line?: number;
  col?: number;
  stack?: string;
  mapped?: string;
}
export interface NetEntry {
  id: number;
  time: number;
  url: string;
  method: string;
  status: number;
  type: string;
  size: number;
  duration: number;
  start: number;
  failed?: string;
  fromCache?: boolean;
  pending?: boolean;
}
export interface TgEvent {
  time: number;
  method: string;
  args: unknown[];
  unsupported?: boolean;
  minVersion?: string;
}

export interface ShotMeta {
  id: string;
  file: string;
  thumb: string;
  label: string;
  deviceId?: string;
  framed: boolean;
  fullPage: boolean;
  kind: "device" | "sheet";
  source: "ui" | "mcp" | "cli";
  time: number;
  w: number;
  h: number;
}

export interface Stats {
  totalMB: number;
  budgetMB: number;
  nodeMB: number;
  engines: { engine: Engine; running: boolean; mb: number; contexts: number }[];
  sessions: {
    id: string;
    deviceName: string;
    status: string;
    heapMB?: number;
  }[];
  hosts: number;
  live: number;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  framed?: boolean;
  background?: "transparent" | "solid";
  scale?: "css" | "device";
}
