# Security

## Threat model

Bezels runs a local server (default `127.0.0.1:4477`) that can open URLs, run JavaScript in the emulated pages (`eval`), read their storage and cookies, and write screenshots to disk. Treat it like a local dev server with remote-control powers:

- It binds to **127.0.0.1 only**.
- `/rpc` and the WebSocket reject requests whose `Origin` isn't Bezels' own UI (CLI and MCP send no Origin). Requests with a foreign `Host` header are rejected too, which blocks DNS rebinding.
- Pages under test are untrusted. Values they pass to Telegram APIs (colours, button text, popup text) are validated or escaped before they reach the Bezels UI.
- No telemetry. Nothing leaves your machine except the page loads you ask for.
- `BEZELS_TG_BOT_TOKEN` is read from the environment or `.env`, used only to sign test `initData` locally, and never logged or saved. Use a **test** bot token, never a production one.

Out of scope: anything that requires already running code as your user on the same machine.

## Reporting

Please report vulnerabilities privately through **GitHub → Security → Report a vulnerability** on this repository, not in a public issue. Include steps to reproduce and the Bezels version (`package.json`). You should get a reply within 7 days.
