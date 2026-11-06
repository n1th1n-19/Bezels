import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Core, type Source } from './core/core.js';
import { dispatch } from './core/rpc.js';

const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../ui/dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.har': 'application/json', '.ico': 'image/x-icon' };

/**
 * Bezels' own tiny HTTP server: static UI (pre-built, no Next/Vite runtime), JSON-RPC, WebSocket for live frames.
 * Binds to 127.0.0.1 only. Origin + Host checks stop other websites (and DNS rebinding) from driving it.
 */
export async function startServer(core: Core, port = core.cfg.port): Promise<{ close(): Promise<void>; port: number }> {
  const allowed = (req: IncomingMessage) => {
    const host = req.headers.host ?? '';
    if (!new RegExp(`^(localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}$`).test(host)) return false;
    const origin = req.headers.origin;
    if (!origin) return true; // CLI / MCP (no browser)
    return [`http://localhost:${port}`, `http://127.0.0.1:${port}`, 'http://localhost:5173', 'http://127.0.0.1:5173', 'tauri://localhost', 'http://tauri.localhost'].includes(origin);
  };

  const send = (res: ServerResponse, code: number, body: unknown, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const file = (res: ServerResponse, path: string, cache = false) => {
    if (!existsSync(path) || !statSync(path).isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream', 'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache' });
    createReadStream(path).pipe(res);
  };

  const server = createServer(async (req, res) => {
    if (!allowed(req)) return send(res, 403, { error: 'forbidden origin' });
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const p = decodeURIComponent(url.pathname);
    if (p === '/health') return send(res, 200, { ok: true, name: 'bezels', pid: process.pid, version: '0.1.0' });
    if (p === '/rpc' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 5e6) return send(res, 413, { error: 'too large' }); }
      try {
        const { method, params } = JSON.parse(body);
        const src = (req.headers['x-bezels-source'] as Source) ?? 'cli';
        return send(res, 200, { result: await dispatch(core, method, params, src === 'mcp' ? 'mcp' : src === 'ui' ? 'ui' : 'cli') });
      } catch (e) { return send(res, 200, { error: (e as Error).message }); }
    }
    if (p.startsWith('/shots/')) {
      const rel = normalize(p.slice('/shots/'.length));
      if (rel.startsWith('..') || rel.includes('\0')) return send(res, 400, { error: 'bad path' });
      const full = join(core.cfg.shotsDir, rel);
      if (!full.startsWith(core.cfg.shotsDir)) return send(res, 400, { error: 'bad path' });
      if (url.searchParams.has('download')) res.setHeader('Content-Disposition', `attachment; filename="${rel.split('/').pop()}"`);
      return file(res, full);
    }
    if (p.startsWith('/snap/')) {
      const id = p.slice(6).replace(/\.jpg$/, '');
      const s = core.sessions.get(id);
      return s?.host.snapshot ? file(res, s.host.snapshot) : send(res, 404, { error: 'no snapshot' });
    }
    // Static UI
    if (!existsSync(UI_DIR)) return send(res, 200, `<h1>Bezels</h1><p>UI not built. Run <code>npm run build</code>.</p>`, 'text/html');
    const rel = normalize(p).replace(/^(\.\.[/\\])+/, '');
    const f = join(UI_DIR, rel);
    if (f.startsWith(UI_DIR) && existsSync(f) && statSync(f).isFile()) return file(res, f, rel.startsWith('/assets/'));
    return file(res, join(UI_DIR, 'index.html'));
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 2e6 });
  server.on('upgrade', (req, sock, head) => {
    if (!allowed(req) || !req.url?.startsWith('/ws')) { sock.destroy(); return; }
    wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws, req));
  });

  const clients = new Set<WebSocket>();
  const onEvent = (event: string, data: unknown) => {
    const msg = JSON.stringify({ type: 'event', event, data });
    for (const ws of clients) if (ws.readyState === ws.OPEN && ws.bufferedAmount < 4e6) ws.send(msg);
  };
  core.on('event', onEvent);

  wss.on('connection', (ws) => {
    clients.add(ws);
    const subs = new Map<string, () => void>();
    ws.send(JSON.stringify({ type: 'hello', data: { catalog: core.catalog(), sessions: core.list(), focused: core.focused, compare: core.compare, sync: core.sync, agentPaused: core.agentPaused, stats: core.stats(), keymap: core.keymap(), shots: core.shots.list(), activity: core.activity.slice(-50), audits: Object.fromEntries([...core.sessions.values()].filter((s) => s.issues).map((s) => [s.id, s.issues])), mcpActive: Date.now() - core.lastMcp < 60_000 } }));
    ws.on('message', async (raw, isBinary) => {
      if (isBinary) return;
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === 'subscribe') {
        subs.get(m.session)?.();
        try {
          const un = core.subscribe(m.session, {
            maxW: m.maxW, maxH: m.maxH,
            send: (meta, jpeg) => {
              // Drop frames rather than queue them when the socket is slow.
              if (ws.readyState !== ws.OPEN || ws.bufferedAmount > 1.5e6) return;
              const head = Buffer.from(JSON.stringify({ session: m.session, ...meta }));
              const len = Buffer.alloc(4); len.writeUInt32BE(head.length);
              ws.send(Buffer.concat([len, head, jpeg]), { binary: true });
            },
          });
          subs.set(m.session, un);
        } catch (e) { ws.send(JSON.stringify({ type: 'event', event: 'toast', data: { text: (e as Error).message, error: true } })); }
        return;
      }
      if (m.type === 'unsubscribe') { subs.get(m.session)?.(); subs.delete(m.session); return; }
      if (m.type === 'rpc') {
        try { ws.send(JSON.stringify({ type: 'rpc', id: m.id, result: await dispatch(core, m.method, m.params, 'ui') })); }
        catch (e) { ws.send(JSON.stringify({ type: 'rpc', id: m.id, error: (e as Error).message })); }
      }
    });
    ws.on('close', () => { clients.delete(ws); for (const u of subs.values()) u(); });
  });

  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', () => ok()); });
  return {
    port,
    close: async () => { core.off('event', onEvent); for (const c of clients) c.terminate(); wss.close(); await new Promise<void>((r) => server.close(() => r())); },
  };
}

/** Is a Bezels daemon already running on this port? */
export async function ping(port: number): Promise<boolean> {
  try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) }); return r.ok && (await r.json()).name === 'bezels'; } catch { return false; }
}

/** RPC over HTTP to a running daemon. */
export function remote(port: number, source: Source) {
  return async (method: string, params?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bezels-Source': source }, body: JSON.stringify({ method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  };
}
