import type { BrowserChrome, BrowserId, Device, Insets } from "./types.js";

/*
 * Device catalog.
 *
 * Sources (noted per device in `source`):
 *  - PW   = Playwright deviceDescriptors (screen, viewport, DPR measured on real hardware)
 *  - APL  = Apple tech specs (resolution ÷ scale factor) + Apple HIG safe-area values
 *  - PANEL = manufacturer panel resolution ÷ default Android DPR (Chrome's window.devicePixelRatio)
 *  - CDT  = Chrome DevTools device list
 * Browser-chrome heights are not published anywhere; they are measured values
 * (Playwright's innerHeight for Safari, screenshots for Chrome/Samsung) and are marked ≈ in the UI.
 * iOS Safari: bottom bar = 99 + home-indicator inset (PW: iPhone SE 3 → 548, iPhone 14 → 664, 15 Pro → 659).
 * iOS Safari landscape letterboxes the page by the safe area (PW: iPhone 15 Pro landscape → 734×343).
 */

const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  ipadChrome:
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1",
  // Chrome's reduced UA: model is frozen to "K", Android to 10. Lets same-size Android phones share one page.
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidTabletChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  samsung:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  samsungTablet:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  winChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  winEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
};

const ins = (top: number, bottom: number, left = 0, right = 0): Insets => ({
  top,
  bottom,
  left,
  right,
});

const chrome = {
  safariPhone: (homeInset: number): BrowserChrome => ({
    top: 0,
    bottom: 99 + homeInset,
    collapsedTop: 0,
    collapsedBottom: 24 + homeInset,
    landscapeTop: 50,
    landscapeBottom: 0,
  }),
  chromeIOS: (homeInset: number): BrowserChrome => ({
    top: 50,
    bottom: 44 + homeInset,
    collapsedTop: 22,
    collapsedBottom: homeInset,
    landscapeTop: 50,
    landscapeBottom: 0,
  }),
  chromeAndroid: (): BrowserChrome => ({
    top: 56,
    bottom: 0,
    collapsedTop: 0,
    collapsedBottom: 0,
    landscapeTop: 56,
    landscapeBottom: 0,
  }),
  samsung: (): BrowserChrome => ({
    top: 56,
    bottom: 48,
    collapsedTop: 0,
    collapsedBottom: 0,
    landscapeTop: 56,
    landscapeBottom: 0,
  }),
  safariIPad: (): BrowserChrome => ({
    top: 50,
    bottom: 0,
    collapsedTop: 50,
    collapsedBottom: 0,
    landscapeTop: 50,
    landscapeBottom: 0,
  }),
  chromeTablet: (): BrowserChrome => ({
    top: 88,
    bottom: 0,
    collapsedTop: 88,
    collapsedBottom: 0,
    landscapeTop: 88,
    landscapeBottom: 0,
  }),
  desktop: (top: number): BrowserChrome => ({
    top,
    bottom: 0,
    collapsedTop: top,
    collapsedBottom: 0,
    landscapeTop: top,
    landscapeBottom: 0,
  }),
};

type IPhoneSpec = [
  id: string,
  name: string,
  w: number,
  h: number,
  cutout: "notch" | "island" | "none",
  safeTop: number,
  source: string,
];

function iphone([id, name, w, h, cutout, safeTop, source]: IPhoneSpec): Device {
  const home = cutout === "none" ? 0 : 34;
  return {
    id,
    name,
    short: name.replace("iPhone ", ""),
    category: "phone",
    os: "ios",
    defaultBrowser: "safari",
    browsers: ["safari", "chrome"],
    screen: { w, h },
    dpr: cutout === "none" ? 2 : 3,
    userAgent: { safari: UA.iosSafari, chrome: UA.iosChrome },
    statusBarHeight: safeTop,
    browserChrome: {
      safari: chrome.safariPhone(home),
      chrome: chrome.chromeIOS(home),
    },
    safeArea: ins(safeTop, home),
    cutout,
    cornerRadius: cutout === "none" ? 0 : cutout === "notch" ? 47 : 55,
    touch: true,
    mobile: true,
    source,
  };
}

type AndroidSpec = [
  id: string,
  name: string,
  w: number,
  h: number,
  dpr: number,
  brand: "google" | "samsung" | "other",
  source: string,
  radius?: number,
];

function android([
  id,
  name,
  w,
  h,
  dpr,
  brand,
  source,
  radius = 28,
]: AndroidSpec): Device {
  const samsung = brand === "samsung";
  return {
    id,
    name,
    category: "phone",
    os: "android",
    defaultBrowser: "chrome",
    browsers: samsung ? ["chrome", "samsung"] : ["chrome"],
    screen: { w, h },
    dpr,
    userAgent: samsung
      ? { chrome: UA.androidChrome, samsung: UA.samsung }
      : { chrome: UA.androidChrome },
    statusBarHeight: 24,
    browserChrome: samsung
      ? { chrome: chrome.chromeAndroid(), samsung: chrome.samsung() }
      : { chrome: chrome.chromeAndroid() },
    safeArea: ins(24, 0),
    cutout: "punch-hole",
    cornerRadius: radius,
    touch: true,
    mobile: true,
    source,
  };
}

function foldable(
  id: string,
  name: string,
  folded: [number, number],
  unfolded: [number, number],
  dpr: number,
  hinge: "vertical" | "horizontal",
  samsung: boolean,
  source: string,
): Device {
  const d = android([
    id,
    name,
    unfolded[0],
    unfolded[1],
    dpr,
    samsung ? "samsung" : "google",
    source,
    18,
  ]);
  d.category = "foldable";
  d.fold = {
    foldedScreen: { w: folded[0], h: folded[1] },
    unfoldedScreen: { w: unfolded[0], h: unfolded[1] },
    hinge: { orientation: hinge, width: 0 },
  };
  return d;
}

function ipad(
  id: string,
  name: string,
  w: number,
  h: number,
  homeIndicator: boolean,
  source: string,
): Device {
  return {
    id,
    name,
    category: "tablet",
    os: "ipados",
    defaultBrowser: "safari",
    browsers: ["safari", "chrome"],
    screen: { w, h },
    dpr: 2,
    userAgent: { safari: UA.ipadSafari, chrome: UA.ipadChrome },
    statusBarHeight: 24,
    browserChrome: {
      safari: chrome.safariIPad(),
      chrome: chrome.chromeTablet(),
    },
    safeArea: ins(24, homeIndicator ? 20 : 0),
    cutout: "none",
    cornerRadius: homeIndicator ? 18 : 0,
    touch: true,
    mobile: true,
    source,
  };
}

function computer(
  id: string,
  name: string,
  category: "laptop" | "desktop" | "tablet",
  os: "macos" | "windows",
  w: number,
  h: number,
  dpr: number,
  source: string,
  notch = false,
): Device {
  const mac = os === "macos";
  return {
    id,
    name,
    category,
    os,
    defaultBrowser: mac ? "safari" : "chrome",
    browsers: mac ? ["safari", "chrome"] : ["chrome", "edge"],
    screen: { w, h },
    dpr,
    userAgent: mac
      ? { safari: UA.macSafari, chrome: UA.macChrome }
      : { chrome: UA.winChrome, edge: UA.winEdge },
    statusBarHeight: mac ? (notch ? 37 : 24) : 0,
    navBarHeight: mac ? 0 : 48,
    browserChrome: mac
      ? { safari: chrome.desktop(52), chrome: chrome.desktop(80) }
      : { chrome: chrome.desktop(87), edge: chrome.desktop(85) },
    safeArea: ins(0, 0),
    cutout: "none",
    cornerRadius: 0,
    touch: false,
    mobile: false,
    source,
  };
}

const iphones: IPhoneSpec[] = [
  [
    "iphone-se",
    "iPhone SE",
    375,
    667,
    "none",
    20,
    "PW iPhone SE (3rd gen); APL 1334×750 @2",
  ],
  [
    "iphone-13-mini",
    "iPhone 13 mini",
    375,
    812,
    "notch",
    50,
    "PW iPhone 13 Mini; APL 2340×1080 @3",
  ],
  [
    "iphone-14",
    "iPhone 14",
    390,
    844,
    "notch",
    47,
    "PW iPhone 14; APL 2532×1170 @3",
  ],
  [
    "iphone-15",
    "iPhone 15",
    393,
    852,
    "island",
    59,
    "PW iPhone 15; APL 2556×1179 @3",
  ],
  [
    "iphone-15-pro-max",
    "iPhone 15 Pro Max",
    430,
    932,
    "island",
    59,
    "PW iPhone 15 Pro Max; APL 2796×1290 @3",
  ],
  ["iphone-16", "iPhone 16", 393, 852, "island", 59, "APL 2556×1179 @3"],
  [
    "iphone-16-plus",
    "iPhone 16 Plus",
    430,
    932,
    "island",
    59,
    "APL 2796×1290 @3",
  ],
  [
    "iphone-16-pro",
    "iPhone 16 Pro",
    402,
    874,
    "island",
    62,
    "APL 2622×1206 @3; safe top 62 per HIG",
  ],
  [
    "iphone-16-pro-max",
    "iPhone 16 Pro Max",
    440,
    956,
    "island",
    62,
    "APL 2868×1320 @3",
  ],
  ["iphone-16e", "iPhone 16e", 390, 844, "notch", 47, "APL 2532×1170 @3"],
  ["iphone-17", "iPhone 17", 402, 874, "island", 62, "APL 2622×1206 @3"],
  [
    "iphone-air",
    "iPhone Air",
    420,
    912,
    "island",
    68,
    "APL 2736×1260 @3; safe top ≈",
  ],
  [
    "iphone-17-pro",
    "iPhone 17 Pro",
    402,
    874,
    "island",
    62,
    "APL 2622×1206 @3",
  ],
  [
    "iphone-17-pro-max",
    "iPhone 17 Pro Max",
    440,
    956,
    "island",
    62,
    "APL 2868×1320 @3",
  ],
];

const androids: AndroidSpec[] = [
  ["pixel-7", "Pixel 7", 412, 915, 2.625, "google", "PW Pixel 7"],
  [
    "pixel-7-pro",
    "Pixel 7 Pro",
    412,
    892,
    3.5,
    "google",
    "PANEL 1440×3120 ÷ 3.5",
  ],
  ["pixel-8", "Pixel 8", 412, 915, 2.625, "google", "PANEL 1080×2400 ÷ 2.625"],
  ["pixel-8-pro", "Pixel 8 Pro", 448, 998, 3, "google", "PANEL 1344×2992 ÷ 3"],
  ["pixel-9", "Pixel 9", 412, 923, 2.625, "google", "PANEL 1080×2424 ÷ 2.625"],
  [
    "pixel-9-pro",
    "Pixel 9 Pro",
    410,
    914,
    3.125,
    "google",
    "PANEL 1280×2856 ÷ 3.125",
  ],
  [
    "pixel-9-pro-xl",
    "Pixel 9 Pro XL",
    448,
    997,
    3,
    "google",
    "PANEL 1344×2992 ÷ 3",
  ],
  [
    "galaxy-s23",
    "Galaxy S23",
    360,
    780,
    3,
    "samsung",
    "CDT Samsung Galaxy S20-class; PANEL 1080×2340 ÷ 3",
  ],
  [
    "galaxy-s23-ultra",
    "Galaxy S23 Ultra",
    384,
    824,
    3.75,
    "samsung",
    "PANEL 1440×3088 ÷ 3.75",
  ],
  ["galaxy-s24", "Galaxy S24", 360, 780, 3, "samsung", "PANEL 1080×2340 ÷ 3"],
  [
    "galaxy-s24-ultra",
    "Galaxy S24 Ultra",
    384,
    824,
    3.75,
    "samsung",
    "PANEL 1440×3120 ÷ 3.75",
  ],
  ["galaxy-s25", "Galaxy S25", 360, 780, 3, "samsung", "PANEL 1080×2340 ÷ 3"],
  [
    "galaxy-s25-ultra",
    "Galaxy S25 Ultra",
    412,
    891,
    3.5,
    "samsung",
    "PANEL 1440×3120 ÷ 3.5",
  ],
  [
    "galaxy-a55",
    "Galaxy A55",
    384,
    832,
    2.8125,
    "samsung",
    "PANEL 1080×2340 ÷ 2.8125",
  ],
  [
    "galaxy-a15",
    "Galaxy A15",
    412,
    892,
    2.625,
    "samsung",
    "PANEL 1080×2340 ÷ 2.625",
  ],
  ["galaxy-a05", "Galaxy A05", 360, 800, 2, "samsung", "PANEL 720×1600 ÷ 2"],
  ["oneplus-12", "OnePlus 12", 412, 905, 3.5, "other", "PANEL 1440×3168 ÷ 3.5"],
  [
    "oneplus-nord-4",
    "OnePlus Nord 4",
    412,
    915,
    2.625,
    "other",
    "PANEL 1080×2400 ÷ 2.625 (≈)",
  ],
  [
    "redmi-note-13",
    "Redmi Note 13",
    393,
    873,
    2.75,
    "other",
    "PANEL 1080×2400 ÷ 2.75",
  ],
  ["xiaomi-14", "Xiaomi 14", 400, 890, 3, "other", "PANEL 1200×2670 ÷ 3"],
  [
    "android-360",
    "Generic 360",
    360,
    800,
    3,
    "other",
    "Most common Android CSS size (StatCounter)",
  ],
  [
    "android-412",
    "Generic 412",
    412,
    915,
    2.625,
    "other",
    "Most common large Android CSS size",
  ],
];

export const DEVICES: Device[] = [
  ...iphones.map(iphone),
  ...androids.map(android),
  foldable(
    "galaxy-z-fold-5",
    "Galaxy Z Fold 5",
    [344, 882],
    [690, 829],
    2.625,
    "vertical",
    true,
    "PANEL cover 904×2316, main 1812×2176 ÷ 2.625",
  ),
  foldable(
    "galaxy-z-fold-6",
    "Galaxy Z Fold 6",
    [369, 905],
    [707, 823],
    2.625,
    "vertical",
    true,
    "PANEL cover 968×2376, main 1856×2160 ÷ 2.625",
  ),
  foldable(
    "galaxy-z-flip-5",
    "Galaxy Z Flip 5",
    [274, 285],
    [412, 1006],
    2.625,
    "horizontal",
    true,
    "PANEL main 1080×2640 ÷ 2.625; cover 720×748",
  ),
  foldable(
    "galaxy-z-flip-6",
    "Galaxy Z Flip 6",
    [274, 285],
    [412, 1006],
    2.625,
    "horizontal",
    true,
    "PANEL main 1080×2640 ÷ 2.625; cover 720×748",
  ),
  foldable(
    "pixel-fold",
    "Pixel Fold",
    [412, 797],
    [841, 701],
    2.625,
    "vertical",
    false,
    "PANEL outer 1080×2092, inner 2208×1840 ÷ 2.625",
  ),
  foldable(
    "pixel-9-pro-fold",
    "Pixel 9 Pro Fold",
    [412, 923],
    [791, 820],
    2.625,
    "vertical",
    false,
    "PANEL outer 1080×2424, inner 2076×2152 ÷ 2.625",
  ),
  foldable(
    "oneplus-open",
    "OnePlus Open",
    [425, 946],
    [813, 756],
    3,
    "vertical",
    false,
    "PANEL outer 1116×2484 ÷ 2.625, inner 2440×2268 ÷ 3 (≈)",
  ),
  ipad("ipad-mini", "iPad mini", 744, 1133, true, "APL 2266×1488 @2"),
  ipad("ipad-10", "iPad (10th gen)", 820, 1180, true, "APL 2360×1640 @2"),
  ipad("ipad-air-11", 'iPad Air 11"', 820, 1180, true, "APL 2360×1640 @2"),
  ipad("ipad-air-13", 'iPad Air 13"', 1024, 1366, true, "APL 2732×2048 @2"),
  ipad("ipad-pro-11", 'iPad Pro 11"', 834, 1210, true, "APL 2420×1668 @2"),
  ipad("ipad-pro-13", 'iPad Pro 13"', 1032, 1376, true, "APL 2752×2064 @2"),
  {
    ...android([
      "galaxy-tab-s9",
      "Galaxy Tab S9",
      800,
      1280,
      2,
      "samsung",
      "PANEL 1600×2560 ÷ 2",
      16,
    ]),
    category: "tablet",
    userAgent: { chrome: UA.androidTabletChrome, samsung: UA.samsungTablet },
    browserChrome: {
      chrome: chrome.chromeTablet(),
      samsung: chrome.chromeTablet(),
    },
    safeArea: ins(24, 0),
    cutout: "none",
  },
  {
    ...computer(
      "surface-pro",
      "Surface Pro",
      "tablet",
      "windows",
      1440,
      960,
      2,
      "PANEL 2880×1920 @200%",
    ),
    touch: true,
  },
  computer(
    "laptop-1280",
    "Laptop 1280",
    "laptop",
    "windows",
    1280,
    800,
    1,
    "Common laptop CSS size",
  ),
  computer(
    "laptop-1366",
    "Laptop 1366",
    "laptop",
    "windows",
    1366,
    768,
    1,
    "Most common laptop CSS size (StatCounter)",
  ),
  computer(
    "laptop-1440",
    "Laptop 1440",
    "laptop",
    "windows",
    1440,
    900,
    1,
    "Common laptop CSS size",
  ),
  computer(
    "laptop-1536",
    "Laptop 1536",
    "laptop",
    "windows",
    1536,
    864,
    1.25,
    "1920×1080 panel @125%",
  ),
  computer(
    "macbook-air-13",
    'MacBook Air 13"',
    "laptop",
    "macos",
    1470,
    956,
    2,
    'APL 2940×1912 default "looks like"',
    true,
  ),
  computer(
    "macbook-air-15",
    'MacBook Air 15"',
    "laptop",
    "macos",
    1710,
    1112,
    2,
    "APL 3420×2224 default",
    true,
  ),
  computer(
    "macbook-pro-14",
    'MacBook Pro 14"',
    "laptop",
    "macos",
    1512,
    982,
    2,
    "APL 3024×1964 default",
    true,
  ),
  computer(
    "macbook-pro-16",
    'MacBook Pro 16"',
    "laptop",
    "macos",
    1728,
    1117,
    2,
    "APL 3456×2234 default",
    true,
  ),
  computer(
    "desktop-1080",
    "Desktop 1920×1080",
    "desktop",
    "windows",
    1920,
    1080,
    1,
    "FHD @100%",
  ),
  computer(
    "desktop-1080-150",
    "Desktop 1080 @150%",
    "desktop",
    "windows",
    1280,
    720,
    1.5,
    "FHD @150%",
  ),
  computer(
    "desktop-1440",
    "Desktop 2560×1440",
    "desktop",
    "windows",
    2560,
    1440,
    1,
    "QHD @100%",
  ),
  computer(
    "desktop-ultrawide",
    "Ultrawide 3440×1440",
    "desktop",
    "windows",
    3440,
    1440,
    1,
    "UWQHD @100%",
  ),
  computer(
    "desktop-4k",
    "4K @100%",
    "desktop",
    "windows",
    3840,
    2160,
    1,
    "UHD @100%",
  ),
  computer(
    "desktop-4k-150",
    "4K @150%",
    "desktop",
    "windows",
    2560,
    1440,
    1.5,
    "UHD @150%",
  ),
  computer(
    "desktop-4k-200",
    "4K @200%",
    "desktop",
    "windows",
    1920,
    1080,
    2,
    "UHD @200%",
  ),
];

export const DEVICE_MAP = new Map(DEVICES.map((d) => [d.id, d]));

export const TEST_SETS: Record<
  string,
  { label: string; match: (d: Device) => boolean }
> = {
  phones: { label: "All phones", match: (d) => d.category === "phone" },
  iphones: { label: "iPhones", match: (d) => d.os === "ios" },
  android: {
    label: "Android",
    match: (d) => d.category === "phone" && d.os === "android",
  },
  folds: { label: "Foldables", match: (d) => d.category === "foldable" },
  tablets: { label: "Tablets", match: (d) => d.category === "tablet" },
  laptops: { label: "Laptops", match: (d) => d.category === "laptop" },
  desktop: {
    label: "Desktop",
    match: (d) => d.category === "laptop" || d.category === "desktop",
  },
  breakpoints: {
    label: "Breakpoints",
    match: (d) =>
      [
        "iphone-se",
        "android-412",
        "ipad-mini",
        "ipad-pro-13",
        "laptop-1280",
        "desktop-1080",
      ].includes(d.id),
  },
  telegram: {
    label: "Telegram",
    match: (d) =>
      ["iphone-16-pro", "pixel-9", "galaxy-s25", "iphone-se"].includes(d.id),
  },
  all: { label: "All", match: () => true },
};

/** Resolve "phones,folds,iphone-16-pro" into device ids. */
export function resolveDevices(
  spec: string | string[],
  all: Device[] = DEVICES,
): Device[] {
  const parts = (Array.isArray(spec) ? spec : spec.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  const out = new Map<string, Device>();
  for (const p of parts) {
    const set = TEST_SETS[p];
    if (set) all.filter(set.match).forEach((d) => out.set(d.id, d));
    else {
      const d =
        all.find((x) => x.id === p) ??
        all.find((x) => x.name.toLowerCase() === p.toLowerCase());
      if (!d)
        throw new Error(
          `Unknown device or set "${p}". Sets: ${Object.keys(TEST_SETS).join(", ")}`,
        );
      out.set(d.id, d);
    }
  }
  return [...out.values()];
}

export function customDevice(o: {
  id?: string;
  name?: string;
  w: number;
  h: number;
  dpr?: number;
  ua?: string;
  mobile?: boolean;
  touch?: boolean;
}): Device {
  const mobile = o.mobile ?? o.w < 900;
  return {
    id: o.id ?? `custom-${o.w}x${o.h}`,
    name: o.name ?? `Custom ${o.w}×${o.h}`,
    category: "custom",
    os: mobile ? "android" : "linux",
    defaultBrowser: "chrome",
    browsers: ["chrome"],
    screen: { w: o.w, h: o.h },
    dpr: o.dpr ?? (mobile ? 3 : 1),
    userAgent: { chrome: o.ua ?? (mobile ? UA.androidChrome : UA.winChrome) },
    statusBarHeight: 0,
    browserChrome: {
      chrome: {
        top: 0,
        bottom: 0,
        collapsedTop: 0,
        collapsedBottom: 0,
        landscapeTop: 0,
        landscapeBottom: 0,
      },
    },
    safeArea: ins(0, 0),
    cutout: "none",
    cornerRadius: mobile ? 24 : 0,
    touch: o.touch ?? mobile,
    mobile,
    source: "custom",
  };
}

export function engineFor(
  d: Device,
  browser: BrowserId,
): "chromium" | "webkit" {
  if (d.os === "ios" || d.os === "ipados") return "webkit"; // every iOS browser is WebKit
  if (d.os === "macos" && browser === "safari") return "webkit";
  return "chromium";
}
