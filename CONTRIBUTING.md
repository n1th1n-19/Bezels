# Contributing

Thanks for helping. The most valuable contributions are **accurate device data** and **real-device comparisons**.

## Setup

```bash
npm ci
npx playwright install --with-deps chromium webkit   # --with-deps installs WebKit's system libraries (Linux, needs sudo)
npm run build
npm test            # unit + Chromium and WebKit end-to-end
npm run bench       # memory benchmark
node dist/cli.js serve   # UI at http://localhost:4477
```

For UI work, run `node dist/cli.js serve` in one terminal and `npm run dev:ui` in another. Vite on :5173 proxies to the engine.

## Adding or correcting a device

Devices live in [src/shared/devices.ts](src/shared/devices.ts). Every entry needs a `source`:

- **CSS size and DPR:** the manufacturer's panel resolution ÷ the default `window.devicePixelRatio`, or Playwright's `deviceDescriptors`, or Chrome DevTools' device list. Say which.
- **Browser-bar heights:** nobody publishes these. Measure on a real device: `screen.height - innerHeight - statusBar` with bars expanded and after scrolling. Note the OS and browser version in the PR.
- **Safe areas and cutout:** Apple's HIG for iPhones; on Android, `env(safe-area-inset-*)` measured with `viewport-fit=cover`.

Then run `npm test` (it checks viewport maths against Playwright's measured iPhones) and `npm run devices:json`. Use the **Device correction** issue template if you have numbers but no PR.

## User-agent strings

Chrome UAs follow the running Chromium automatically (`Host.userAgent()`). These are hand-written and need bumping when a major version ships:

- Safari `Version/26.0` and the frozen `iPhone OS 18_6`
- `CriOS/…` for Chrome on iOS
- `SamsungBrowser/…`

All of them live at the top of `devices.ts`.

## Telegram Mini Apps

The mock follows [core.telegram.org/bots/webapps](https://core.telegram.org/bots/webapps). When a Bot API version adds methods, update `TG_MIN_VERSION` / `TG_VERSIONS` in [src/shared/telegram.ts](src/shared/telegram.ts) and the mock in [src/core/telegram.ts](src/core/telegram.ts).

## Rules of the road

- Keep the memory rules (README → Memory): no browser per device, no full-size images kept in memory, buffers capped. `npm run bench` must stay green.
- Engine features that only work in Chromium must show the **Chromium only** badge on WebKit devices, not disappear.
- Every new action needs an entry in [src/shared/keymap.ts](src/shared/keymap.ts) and a method in [src/core/rpc.ts](src/core/rpc.ts), so it's reachable from the keyboard, the palette and MCP.
- Small PRs with a test (`src/test/`) when logic changes.
