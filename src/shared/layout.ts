import type {
  Device,
  DeviceState,
  Insets,
  Layout,
  Rect,
  Size,
  TgRuntime,
} from "./types.js";
import { engineFor } from "./devices.js";

export const DEFAULT_TG = {
  enabled: false,
  mode: "expanded" as const,
  platform: "ios" as const,
  theme: "light" as const,
  version: "10.1",
  language: "en",
  user: {
    id: 777000001,
    first_name: "Test",
    last_name: "User",
    username: "bezels_test",
    language_code: "en",
    is_premium: false,
  },
};

export function defaultState(d: Device): DeviceState {
  return {
    orientation: "portrait",
    fold: "unfolded",
    bars: "expanded",
    browser: d.defaultBrowser,
    colorScheme: "light",
    reducedMotion: false,
    network: "none",
    cpu: 1,
    width: null,
    telegram: {
      ...DEFAULT_TG,
      platform:
        d.os === "ios" || d.os === "ipados"
          ? "ios"
          : d.os === "android"
            ? "android"
            : d.os === "macos"
              ? "macos"
              : "tdesktop",
    },
    emulation: {},
  };
}

export const emptyTgRuntime = (): TgRuntime => ({
  mainButton: {
    visible: false,
    text: "Continue",
    active: true,
    progress: false,
  },
  secondaryButton: {
    visible: false,
    text: "Cancel",
    active: true,
    progress: false,
    position: "left",
  },
  backButton: false,
  settingsButton: false,
  closingConfirmation: false,
  verticalSwipes: true,
  closed: false,
  popup: null,
  dragOffset: 0,
});

const zero: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
const isComputer = (d: Device) =>
  d.category === "laptop" ||
  d.category === "desktop" ||
  (d.category === "tablet" && d.os === "windows");

export const TG = {
  headerH: 56,
  bottomBarH: 58,
  fullscreenControlsH: 46,
  compactRatio: 0.62,
  desktopWindow: { w: 384, h: 640 },
  desktopHeader: 40,
};

/** Screen for the current fold state, before orientation. */
function baseScreen(d: Device, s: DeviceState): Size {
  if (d.fold)
    return s.fold === "folded" ? d.fold.foldedScreen : d.fold.unfoldedScreen;
  return d.screen;
}

/**
 * The realism rule: page viewport = screen − status bar − browser bars (− nav/task bar),
 * per orientation, bar state and Telegram mode. Pure function, shared by core and UI.
 */
export function computeLayout(
  d: Device,
  s: DeviceState,
  tg?: TgRuntime,
): Layout {
  const engine = engineFor(d, s.browser);
  const landscape =
    s.orientation === "landscape-left" || s.orientation === "landscape-right";
  const computer = isComputer(d);
  let screen = baseScreen(d, s);
  // Desktops are native landscape; "landscape" on them = rotated monitor (portrait). Phones/tablets: portrait native.
  if (!computer && landscape) screen = { w: screen.h, h: screen.w };
  if (computer && landscape) screen = { w: screen.h, h: screen.w };
  if (s.width) screen = { w: s.width, h: screen.h };

  const rotation = (
    {
      portrait: 0,
      "landscape-left": 90,
      "portrait-upside-down": 180,
      "landscape-right": 270,
    } as const
  )[s.orientation];

  // Safe area rotates with the device.
  const sa = d.safeArea;
  const hasHome = sa.bottom > 0 && d.os === "ios";
  let deviceSafeArea: Insets;
  if (computer) deviceSafeArea = zero;
  else if (s.orientation === "portrait") deviceSafeArea = { ...sa };
  else if (s.orientation === "portrait-upside-down")
    deviceSafeArea = { top: sa.bottom, bottom: sa.top, left: 0, right: 0 };
  else {
    const side = d.cutout === "none" || d.os !== "ios" ? 0 : sa.top;
    deviceSafeArea =
      s.orientation === "landscape-left"
        ? { top: 0, bottom: hasHome ? 21 : 0, left: side, right: side }
        : { top: 0, bottom: hasHome ? 21 : 0, left: side, right: side };
    if (d.os !== "ios") deviceSafeArea.top = d.statusBarHeight;
  }

  // Status bar: iPhones hide it in landscape; others keep it.
  const statusH = computer
    ? d.statusBarHeight
    : landscape && d.os === "ios" && d.category === "phone"
      ? 0
      : d.statusBarHeight;
  const navH = d.navBarHeight ?? 0;
  const bc = d.browserChrome[s.browser] ?? Object.values(d.browserChrome)[0]!;
  let top = landscape && !computer ? bc.landscapeTop : bc.top;
  let bottom = landscape && !computer ? bc.landscapeBottom : bc.bottom;
  if (s.bars === "collapsed") {
    top = landscape ? Math.min(top, bc.collapsedTop) : bc.collapsedTop;
    bottom = landscape ? 0 : bc.collapsedBottom;
  }
  if (s.bars === "pwa") {
    top = computer ? 32 : 0;
    bottom = d.os === "ios" && !landscape ? 0 : 0;
  }

  let tgOut: Layout["tg"] = null;
  let vp: Rect;
  // Safari letterboxes landscape pages by the safe area (no viewport-fit=cover assumed).
  const letterbox =
    landscape && d.os === "ios" && s.bars !== "pwa" ? deviceSafeArea : zero;

  if (s.telegram.enabled) {
    const r = tg ?? emptyTgRuntime();
    const buttons = r.mainButton.visible || r.secondaryButton.visible;
    const desktopTg =
      ["tdesktop", "macos", "weba", "webk"].includes(s.telegram.platform) ||
      computer;
    if (desktopTg) {
      const ww = Math.min(TG.desktopWindow.w, screen.w),
        wh = Math.min(TG.desktopWindow.h, screen.h - statusH - navH);
      const win = {
        x: Math.round((screen.w - ww) / 2),
        y: Math.round(statusH + (screen.h - statusH - navH - wh) / 2),
        w: ww,
        h: wh,
      };
      const header = { x: win.x, y: win.y, w: ww, h: TG.desktopHeader };
      const bb = buttons
        ? { x: win.x, y: win.y + wh - TG.bottomBarH, w: ww, h: TG.bottomBarH }
        : null;
      vp = {
        x: win.x,
        y: win.y + TG.desktopHeader,
        w: ww,
        h: wh - TG.desktopHeader - (bb ? bb.h : 0),
      };
      tgOut = {
        window: win,
        header,
        bottomBar: bb,
        safeAreaInset: zero,
        contentSafeAreaInset: zero,
        isExpanded: true,
        isFullscreen: false,
      };
    } else {
      const mode = s.telegram.mode;
      const fullscreen = mode === "fullscreen";
      const safeBottom = deviceSafeArea.bottom;
      const gesture = d.os === "android" ? 16 : 0;
      const bbH = buttons ? TG.bottomBarH + safeBottom + gesture : 0;
      let winTop = fullscreen ? 0 : statusH;
      if (mode === "compact")
        winTop = Math.round(screen.h * (1 - TG.compactRatio));
      winTop += r.dragOffset;
      const header = fullscreen
        ? null
        : { x: 0, y: winTop, w: screen.w, h: TG.headerH };
      const pageTop = fullscreen ? 0 : winTop + TG.headerH;
      const pageBottom = screen.h - bbH;
      vp = {
        x: 0,
        y: pageTop,
        w: screen.w,
        h: Math.max(100, pageBottom - pageTop),
      };
      const bottomBar = buttons
        ? { x: 0, y: pageBottom, w: screen.w, h: bbH }
        : null;
      tgOut = {
        window: { x: 0, y: winTop, w: screen.w, h: screen.h - winTop },
        header,
        bottomBar,
        safeAreaInset: fullscreen
          ? { ...deviceSafeArea, bottom: buttons ? 0 : deviceSafeArea.bottom }
          : {
              top: 0,
              left: deviceSafeArea.left,
              right: deviceSafeArea.right,
              bottom: buttons ? 0 : safeBottom,
            },
        contentSafeAreaInset: fullscreen
          ? { top: TG.fullscreenControlsH, bottom: 0, left: 0, right: 0 }
          : zero,
        isExpanded: mode !== "compact",
        isFullscreen: fullscreen,
      };
    }
  } else {
    const y = statusH + top;
    const h = screen.h - statusH - top - bottom - navH;
    vp = {
      x: letterbox.left,
      y,
      w: screen.w - letterbox.left - letterbox.right,
      h,
    };
  }

  const pageSafeArea: Insets = tgOut
    ? tgOut.safeAreaInset
    : {
        top: Math.max(0, deviceSafeArea.top - vp.y),
        left: Math.max(0, deviceSafeArea.left - vp.x),
        right: Math.max(0, vp.x + vp.w - (screen.w - deviceSafeArea.right)),
        bottom: Math.max(0, vp.y + vp.h - (screen.h - deviceSafeArea.bottom)),
      };

  // 100vh on mobile browsers = viewport with bars collapsed.
  const collapsedTop = landscape
    ? Math.min(bc.landscapeTop, bc.collapsedTop)
    : bc.collapsedTop;
  const collapsedBottom = landscape ? 0 : bc.collapsedBottom;
  const largeViewportH =
    d.mobile && s.bars !== "pwa" && !s.telegram.enabled
      ? screen.h - statusH - collapsedTop - collapsedBottom - navH
      : vp.h;

  const statusBar = statusH ? { x: 0, y: 0, w: screen.w, h: statusH } : null;
  const chromeTop =
    !s.telegram.enabled && top
      ? { x: 0, y: statusH, w: screen.w, h: top }
      : null;
  const chromeBottom =
    !s.telegram.enabled && bottom
      ? { x: 0, y: screen.h - navH - bottom, w: screen.w, h: bottom }
      : null;
  const navBar = navH
    ? { x: 0, y: screen.h - navH, w: screen.w, h: navH }
    : null;

  let cutoutRect: Rect | null = null;
  if (!computer && d.cutout !== "none") {
    const cw = d.cutout === "island" ? 125 : d.cutout === "notch" ? 162 : 12;
    const ch = d.cutout === "island" ? 37 : d.cutout === "notch" ? 32 : 12;
    const off = d.cutout === "island" ? 11 : d.cutout === "notch" ? 0 : 9;
    if (s.orientation === "portrait")
      cutoutRect = { x: (screen.w - cw) / 2, y: off, w: cw, h: ch };
    else if (s.orientation === "portrait-upside-down")
      cutoutRect = {
        x: (screen.w - cw) / 2,
        y: screen.h - off - ch,
        w: cw,
        h: ch,
      };
    else if (s.orientation === "landscape-left")
      cutoutRect = { x: off, y: (screen.h - cw) / 2, w: ch, h: cw };
    else
      cutoutRect = {
        x: screen.w - off - ch,
        y: (screen.h - cw) / 2,
        w: ch,
        h: cw,
      };
  }

  let hinge: Rect | null = null;
  if (d.fold && s.fold !== "folded") {
    let vertical = d.fold.hinge.orientation === "vertical";
    if (landscape) vertical = !vertical;
    hinge = vertical
      ? { x: screen.w / 2 - 1, y: 0, w: 2, h: screen.h }
      : { x: 0, y: screen.h / 2 - 1, w: screen.w, h: 2 };
  }

  const kind: Layout["frame"]["kind"] =
    d.category === "laptop"
      ? "laptop"
      : d.category === "desktop"
        ? "desktop"
        : d.category === "tablet"
          ? "tablet"
          : "phone";
  const homeBezel = kind === "phone" && d.os === "ios" && d.cutout === "none" ? 62 : 0;
  const bezel =
    kind === "phone"
      ? 12
      : kind === "tablet"
        ? 22
        : kind === "laptop"
          ? 16
          : 18;
  const frame =
    kind === "laptop"
      ? {
          w: screen.w + bezel * 2 + 120,
          h: screen.h + bezel * 2 + 34,
          offsetX: bezel + 60,
          offsetY: bezel,
          kind,
        }
      : kind === "desktop"
        ? {
            w: screen.w + bezel * 2,
            h: screen.h + bezel * 2 + Math.round(screen.h * 0.16),
            offsetX: bezel,
            offsetY: bezel,
            kind,
          }
        : {
            // Home-button iPhones (SE) have thick bezels above and below the screen.
            w: screen.w + bezel * 2 + (landscape ? homeBezel * 2 : 0),
            h: screen.h + bezel * 2 + (landscape ? 0 : homeBezel * 2),
            offsetX: bezel + (landscape ? homeBezel : 0),
            offsetY: bezel + (landscape ? 0 : homeBezel),
            kind,
          };

  return {
    engine,
    screen,
    viewport: vp,
    statusBar,
    chromeTop,
    chromeBottom,
    navBar,
    deviceSafeArea,
    pageSafeArea,
    cutoutRect,
    hinge,
    rotation,
    largeViewportH,
    tg: tgOut,
    frame,
  };
}

/** Next orientation clockwise (O) or anticlockwise (Shift+O). */
export function rotate(
  o: DeviceState["orientation"],
  dir: 1 | -1,
  allowUpsideDown = true,
): DeviceState["orientation"] {
  const order: DeviceState["orientation"][] = allowUpsideDown
    ? ["portrait", "landscape-right", "portrait-upside-down", "landscape-left"]
    : ["portrait", "landscape-right", "landscape-left"];
  const i = order.indexOf(o);
  return order[(i + dir + order.length) % order.length]!;
}

export const NETWORK_PRESETS: Record<
  string,
  { label: string; downloadKbps: number; uploadKbps: number; latencyMs: number }
> = {
  fast4g: {
    label: "Fast 4G",
    downloadKbps: 9000,
    uploadKbps: 9000,
    latencyMs: 60,
  },
  slow4g: {
    label: "Slow 4G",
    downloadKbps: 1600,
    uploadKbps: 750,
    latencyMs: 150,
  },
  "3g": { label: "3G", downloadKbps: 400, uploadKbps: 400, latencyMs: 400 },
};
