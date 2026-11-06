# Bezels desktop (Tauri) — experimental

> **Status: experimental, never built or tested.** The web UI (`bezels serve` → http://localhost:4477) is the supported interface. PRs that get this building on Linux/macOS/Windows are welcome.

A thin window around the Bezels UI using the **system webview** (far lighter than Electron), plus
global shortcuts that work when Bezels isn't focused:

- `Ctrl+Alt+C` — copy the focused device's framed screenshot to the clipboard

It starts `bezels serve` itself if no daemon is running (`BEZELS_CLI` overrides the path to `dist/cli.js`).

```bash
# Linux deps (once): sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
cargo install tauri-cli --version "^2" --locked
cd desktop/src-tauri && cargo tauri dev     # or: cargo tauri build
```

