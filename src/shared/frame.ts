import type { Device, DeviceState, Layout, TgRuntime } from "./types.js";
import { tgTheme } from "./telegram.js";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const host = (url: string) => {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
};

/** Colours come from the page under test (setHeaderColor etc.): only let real colour values into the SVG. */
const color = (v: unknown): string | undefined =>
  typeof v === "string" && /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-zA-Z]{3,20})$/.test(v) ? v : undefined;

/** Truncate text to roughly fit px at ~13px UI font. */
const fit = (t: string, px: number) => { const n = Math.max(4, Math.floor(px / 7.4)); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

export interface FrameParts {
  under: string;
  over: string;
  w: number;
  h: number;
}

/**
 * SVG device frame in two layers: `under` (body, bars, screen background) goes below the page image,
 * `over` (cutout, home indicator, hinge, Telegram fullscreen controls) goes on top.
 * Plain SVG strings so the UI and the screenshot compositor draw exactly the same thing.
 */
export function renderFrame(
  d: Device,
  s: DeviceState,
  L: Layout,
  url: string,
  tg?: TgRuntime,
  title = "Mini App",
): FrameParts {
  const { w, h, offsetX: ox, offsetY: oy, kind } = L.frame;
  const sw = L.screen.w,
    sh = L.screen.h;
  const dark = s.colorScheme === "dark";
  const fg = dark ? "#FFFFFF" : "#111318";
  const barBg = dark ? "#1C1C1E" : "#F2F2F4";
  const barLine = dark ? "#2C2C2E" : "#DADDE2";
  const pill = dark ? "#2C2C2E" : "#FFFFFF";
  const muted = dark ? "#A3AAB6" : "#5A606B";
  const r = d.cornerRadius;
  const u: string[] = [],
    o: string[] = [];
  const T = (x: number, y: number) => `translate(${ox + x} ${oy + y})`;

  // Body
  if (kind === "phone" || kind === "tablet") {
    const b = ox;
    u.push(
      `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${r ? r + b : kind === "tablet" ? 28 : 36}" fill="#1D1F24" stroke="#4A4E57"/>`,
    );
  } else if (kind === "laptop") {
    u.push(
      `<rect x="60.5" y="0.5" width="${sw + ox * 2 - 121}" height="${sh + oy * 2 - 1}" rx="14" fill="#1D1F24" stroke="#4A4E57"/>`,
    );
    u.push(
      `<path d="M0 ${h - 34} H${w} L${w - 40} ${h} H40 Z" fill="#2A2D33" stroke="#4A4E57"/>`,
    );
    u.push(
      `<rect x="${w / 2 - 60}" y="${h - 34}" width="120" height="6" rx="3" fill="#1D1F24"/>`,
    );
  } else {
    const mh = sh + oy * 2;
    u.push(
      `<rect x="0.5" y="0.5" width="${w - 1}" height="${mh - 1}" rx="10" fill="#1D1F24" stroke="#4A4E57"/>`,
    );
    u.push(
      `<path d="M${w / 2 - 50} ${mh} h100 l20 ${h - mh - 12} h-140 Z" fill="#2A2D33"/><rect x="${w / 2 - 160}" y="${h - 12}" width="320" height="12" rx="6" fill="#2A2D33"/>`,
    );
  }

  // Screen background
  u.push(
    `<g transform="${T(0, 0)}"><rect width="${sw}" height="${sh}" rx="${r}" fill="${dark ? "#000" : "#FFF"}"/>`,
  );

  // Status bar / OS menu bar
  if (L.statusBar) {
    const sb = L.statusBar;
    if (kind === "laptop" || kind === "desktop") {
      u.push(
        `<rect width="${sw}" height="${sb.h}" fill="${dark ? "#1E1E20" : "#ECECEE"}"/><text x="14" y="${sb.h / 2 + 4}" font-size="12" font-weight="600" fill="${fg}" font-family="Inter,system-ui">  Safari  File  Edit  View</text><text x="${sw - 14}" y="${sb.h / 2 + 4}" font-size="12" fill="${fg}" text-anchor="end" font-family="Inter,system-ui">Thu 9:41</text>`,
      );
    } else {
      const ty = Math.min(sb.h / 2 + 5, 34);
      const sideX =
        d.cutout === "island" || d.cutout === "notch"
          ? Math.max(28, (sw - 125) / 4)
          : Math.max(36, r * 0.75 + 14);
      u.push(
        `<text x="${sideX}" y="${ty}" font-size="15" font-weight="600" fill="${fg}" text-anchor="middle" font-family="Inter,system-ui">9:41</text>`,
      );
      u.push(
        `<g transform="translate(${sw - sideX - 14} ${ty - 10})"><rect width="25" height="12" rx="3.5" fill="none" stroke="${fg}" opacity=".5"/><rect x="2" y="2" width="18" height="8" rx="2" fill="${fg}"/><rect x="26" y="4" width="1.5" height="4" fill="${fg}" opacity=".5"/></g>`,
      );
      u.push(
        `<g transform="translate(${sw - sideX - 44} ${ty - 9})" fill="${fg}"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="5" y="5" width="3" height="6" rx="1"/><rect x="10" y="2.5" width="3" height="8.5" rx="1"/><rect x="15" y="0" width="3" height="11" rx="1"/></g>`,
      );
    }
  }

  // Browser bars
  const hostText = esc(host(url));
  if (L.chromeTop) {
    const c = L.chromeTop;
    if (
      kind === "laptop" ||
      kind === "desktop" ||
      (kind === "tablet" && d.os === "windows")
    ) {
      u.push(
        `<g transform="translate(0 ${c.y})"><rect width="${sw}" height="${c.h}" fill="${barBg}"/><rect x="0" y="${c.h - 1}" width="${sw}" height="1" fill="${barLine}"/>`,
      );
      if (c.h > 60)
        u.push(
          `<rect x="80" y="8" width="220" height="${c.h / 2 - 10}" rx="8" fill="${pill}"/><text x="96" y="${c.h / 4 + 6}" font-size="12" fill="${fg}" font-family="Inter,system-ui">${esc(title === "Mini App" ? host(url).split("/")[0]! : title)}</text>`,
        );
      const uy = c.h > 60 ? c.h / 2 + 6 : 10;
      u.push(
        `<rect x="${c.h > 60 ? 110 : sw * 0.25}" y="${uy}" width="${c.h > 60 ? sw - 200 : sw * 0.5}" height="${Math.min(30, c.h - uy - 8)}" rx="15" fill="${pill}" stroke="${barLine}"/><text x="${c.h > 60 ? 130 : sw / 2}" y="${uy + 19}" font-size="13" fill="${muted}" ${c.h > 60 ? "" : 'text-anchor="middle"'} font-family="Inter,system-ui">${esc(fit(host(url), c.h > 60 ? sw - 240 : sw * 0.45))}</text>`,
      );
      u.push(
        `<g fill="${muted}">${[0, 1, 2].map((i) => `<circle cx="${c.h > 60 ? 20 + i * 20 : 20 + i * 18}" cy="${c.h > 60 ? 18 : c.h / 2}" r="5" opacity=".6"/>`).join("")}</g></g>`,
      );
    } else {
      // Android Chrome / Samsung / iOS Chrome: url field on top
      u.push(
        `<g transform="translate(0 ${c.y})"><rect width="${sw}" height="${c.h}" fill="${barBg}"/>`,
      );
      if (c.h >= 40) {
        u.push(
          `<rect x="12" y="${(c.h - 36) / 2}" width="${sw - 84}" height="36" rx="18" fill="${dark ? "#2C2C2E" : "#E6E8EC"}"/><text x="40" y="${c.h / 2 + 5}" font-size="14" fill="${fg}" font-family="Inter,system-ui">${esc(fit(host(url), sw - 120))}</text>`,
        );
        u.push(
          `<rect x="${sw - 62}" y="${c.h / 2 - 9}" width="18" height="18" rx="4" fill="none" stroke="${fg}" stroke-width="2"/><text x="${sw - 53}" y="${c.h / 2 + 4}" font-size="10" text-anchor="middle" fill="${fg}" font-family="Inter,system-ui">1</text>`,
        );
        u.push(
          `<g fill="${fg}"><circle cx="${sw - 22}" cy="${c.h / 2 - 7}" r="2"/><circle cx="${sw - 22}" cy="${c.h / 2}" r="2"/><circle cx="${sw - 22}" cy="${c.h / 2 + 7}" r="2"/></g>`,
        );
      } else
        u.push(
          `<text x="${sw / 2}" y="${c.h / 2 + 4}" font-size="11" text-anchor="middle" fill="${muted}" font-family="Inter,system-ui">${hostText}</text>`,
        );
      u.push(`</g>`);
    }
  }
  if (L.chromeBottom) {
    const c = L.chromeBottom;
    const home = L.deviceSafeArea.bottom;
    const inner = c.h - home;
    u.push(
      `<g transform="translate(0 ${c.y})"><rect width="${sw}" height="${c.h}" fill="${barBg}"/><rect width="${sw}" height="1" fill="${barLine}"/>`,
    );
    if (s.browser === "safari" && inner > 60) {
      u.push(
        `<rect x="14" y="8" width="${sw - 28}" height="44" rx="14" fill="${pill}" stroke="${barLine}"/><text x="${sw / 2}" y="35" font-size="15" text-anchor="middle" fill="${fg}" font-family="Inter,system-ui">${hostText}</text>`,
      );
      const icons = 5;
      u.push(
        `<g fill="none" stroke="#0A84FF" stroke-width="2">${Array.from({ length: icons }, (_, i) => `<circle cx="${(sw / (icons + 1)) * (i + 1)}" cy="${inner - 20}" r="7"/>`).join("")}</g>`,
      );
    } else if (inner >= 40) {
      u.push(
        `<g fill="none" stroke="${fg}" stroke-width="2">${Array.from({ length: 5 }, (_, i) => `<circle cx="${(sw / 6) * (i + 1)}" cy="${inner / 2}" r="7"/>`).join("")}</g>`,
      );
    } else if (inner > 8) {
      u.push(
        `<text x="${sw / 2}" y="${inner / 2 + 5}" font-size="12" text-anchor="middle" fill="${muted}" font-family="Inter,system-ui">${hostText}</text>`,
      );
    }
    u.push(`</g>`);
  }
  if (L.navBar) {
    const n = L.navBar;
    u.push(
      `<g transform="translate(0 ${n.y})"><rect width="${sw}" height="${n.h}" fill="${dark ? "#202124" : "#F3F3F3"}"/><rect x="${sw / 2 - 160}" y="6" width="320" height="${n.h - 12}" rx="8" fill="${dark ? "#2C2C2E" : "#E3E3E6"}"/><text x="${sw / 2}" y="${n.h / 2 + 4}" font-size="12" text-anchor="middle" fill="${muted}" font-family="Inter,system-ui">${d.os === "windows" ? "Search" : ""}</text></g>`,
    );
  }

  // Telegram chrome
  if (L.tg && tg) {
    const th: Record<string, string> = Object.fromEntries(Object.entries(tgTheme(s.telegram)).filter(([, v]) => color(v)));
    const t = L.tg;
    const headerBg =
      color(tg.headerColor) ?? th.header_bg_color ?? th.bg_color ?? "#FFFFFF";
    const tgFg = th.text_color ?? fg;
    const btnC = th.button_color ?? "#2481CC";
    if (t.window.y > 0 && s.telegram.mode === "compact") {
      u.push(
        `<rect y="${L.statusBar?.h ?? 0}" width="${sw}" height="${t.window.y - (L.statusBar?.h ?? 0)}" fill="${dark ? "#0F1217" : "#9DB5C9"}"/><rect y="${L.statusBar?.h ?? 0}" width="${sw}" height="${t.window.y}" fill="#000" opacity=".35"/>`,
      );
    }
    if (t.header) {
      const hd = t.header;
      const left = tg.backButton
        ? "‹ Back"
        : s.telegram.platform === "android"
          ? "Close"
          : "Close";
      u.push(
        `<g transform="translate(${hd.x} ${hd.y})"><rect width="${hd.w}" height="${hd.h}" fill="${headerBg}" ${s.telegram.mode === "compact" ? 'rx="12"' : ""}/>`,
      );
      if (s.telegram.mode === "compact")
        u.push(
          `<rect x="${hd.w / 2 - 18}" y="5" width="36" height="5" rx="2.5" fill="${th.hint_color ?? "#999"}" opacity=".6"/>`,
        );
      u.push(
        `<text x="16" y="${hd.h / 2 + 6}" font-size="16" fill="${th.link_color ?? btnC}" font-family="Inter,system-ui">${left}</text>`,
      );
      u.push(
        `<text x="${hd.w / 2}" y="${hd.h / 2 + 6}" font-size="16" font-weight="600" text-anchor="middle" fill="${tgFg}" font-family="Inter,system-ui">${esc(title)}</text>`,
      );
      u.push(
        `<g fill="${th.link_color ?? btnC}"><circle cx="${hd.w - 34}" cy="${hd.h / 2 + 1}" r="2.2"/><circle cx="${hd.w - 26}" cy="${hd.h / 2 + 1}" r="2.2"/><circle cx="${hd.w - 18}" cy="${hd.h / 2 + 1}" r="2.2"/></g></g>`,
      );
    }
    if (t.bottomBar) {
      const bb = t.bottomBar;
      const bbBg =
        color(tg.bottomBarColor) ??
        th.bottom_bar_bg_color ??
        th.secondary_bg_color ??
        headerBg;
      u.push(
        `<g transform="translate(${bb.x} ${bb.y})"><rect width="${bb.w}" height="${bb.h}" fill="${bbBg}"/>`,
      );
      const both = tg.mainButton.visible && tg.secondaryButton.visible;
      const bw = both ? (bb.w - 36) / 2 : bb.w - 24;
      const btn = (x: number, b: TgRuntime["mainButton"], main: boolean) => {
        const bg =
          color(b.color) ?? (main ? btnC : (th.secondary_bg_color ?? "#E9EEF3"));
        const tc =
          color(b.textColor) ?? (main ? (th.button_text_color ?? "#FFF") : btnC);
        return `<rect x="${x}" y="8" width="${bw}" height="44" rx="10" fill="${bg}" opacity="${b.active ? 1 : 0.6}"/><text x="${x + bw / 2}" y="35" font-size="15" font-weight="600" text-anchor="middle" fill="${tc}" font-family="Inter,system-ui">${b.progress ? "…" : esc(b.text)}</text>`;
      };
      let x = 12;
      const secondFirst = tg.secondaryButton.position !== "right";
      const order = secondFirst
        ? ([
            [tg.secondaryButton, false],
            [tg.mainButton, true],
          ] as const)
        : ([
            [tg.mainButton, true],
            [tg.secondaryButton, false],
          ] as const);
      for (const [b, main] of order)
        if (b.visible) {
          u.push(btn(x, b, main));
          x += bw + 12;
        }
      u.push(`</g>`);
    }
    if (t.isFullscreen) {
      const cy = (L.deviceSafeArea.top || 0) + 6;
      o.push(
        `<g transform="${T(0, 0)}"><rect x="12" y="${cy}" width="74" height="30" rx="15" fill="#000" opacity=".35"/><text x="49" y="${cy + 20}" font-size="14" text-anchor="middle" fill="#FFF" font-family="Inter,system-ui">${tg.backButton ? "‹ Back" : "Close"}</text><rect x="${sw - 86}" y="${cy}" width="74" height="30" rx="15" fill="#000" opacity=".35"/><text x="${sw - 49}" y="${cy + 20}" font-size="14" text-anchor="middle" fill="#FFF" font-family="Inter,system-ui">Menu</text></g>`,
      );
    }
  }
  u.push(`</g>`);

  // Overlays above the page
  o.push(`<g transform="${T(0, 0)}">`);
  if (L.cutoutRect) {
    const c = L.cutoutRect;
    if (d.cutout === "punch-hole")
      o.push(
        `<circle cx="${c.x + c.w / 2}" cy="${c.y + c.h / 2}" r="${c.w / 2}" fill="#000"/>`,
      );
    else if (d.cutout === "island")
      o.push(
        `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="${Math.min(c.w, c.h) / 2}" fill="#000"/>`,
      );
    else
      o.push(
        `<rect x="${c.x}" y="${c.y - 10}" width="${c.w}" height="${c.h + 10}" rx="18" fill="#000"/>`,
      );
  }
  if (L.hinge) {
    const g = L.hinge;
    o.push(
      `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" fill="#000" opacity="${s.fold === "unfolded" ? 0.12 : 0.35}"/>`,
    );
  }
  if (d.os === "ios" && L.deviceSafeArea.bottom > 0) {
    const iw = Math.min(140, sw * 0.36);
    o.push(
      `<rect x="${(sw - iw) / 2}" y="${sh - 8}" width="${iw}" height="5" rx="2.5" fill="${dark || (L.tg?.isFullscreen ?? false) ? "#FFF" : "#000"}" opacity=".85"/>`,
    );
  } else if (d.os === "android" && kind === "phone") {
    o.push(
      `<rect x="${(sw - 108) / 2}" y="${sh - 10}" width="108" height="4" rx="2" fill="${dark ? "#FFF" : "#000"}" opacity=".6"/>`,
    );
  }
  // Rounded screen mask corners (paint the bezel colour outside the rounded rect).
  if (r)
    o.push(
      `<path fill-rule="evenodd" fill="#1D1F24" d="M-1 -1 H${sw + 1} V${sh + 1} H-1 Z M${r} 0 H${sw - r} A${r} ${r} 0 0 1 ${sw} ${r} V${sh - r} A${r} ${r} 0 0 1 ${sw - r} ${sh} H${r} A${r} ${r} 0 0 1 0 ${sh - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z"/>`,
    );
  o.push(`</g>`);

  const svg = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  return { under: svg(u.join("")), over: svg(o.join("")), w, h };
}
