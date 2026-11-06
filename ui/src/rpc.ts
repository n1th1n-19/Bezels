/** WebSocket client: JSON-RPC, server events, and binary live frames. Reconnects on its own. */
type FrameCb = (meta: { w: number; h: number }, blob: Blob) => void;

let ws: WebSocket | null = null;
let seq = 0;
const pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
const eventCbs = new Set<(event: string, data: any) => void>();
const frameCbs = new Map<string, FrameCb>();
const subs = new Map<string, { maxW: number; maxH: number }>();
const queue: string[] = [];
let connected = false;
const connCbs = new Set<(c: boolean) => void>();

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    connected = true; connCbs.forEach((c) => c(true));
    for (const m of queue.splice(0)) ws!.send(m);
    for (const [session, s] of subs) ws!.send(JSON.stringify({ type: 'subscribe', session, ...s }));
  };
  ws.onclose = () => {
    connected = false; connCbs.forEach((c) => c(false));
    for (const p of pending.values()) p.fail(new Error('Disconnected from Bezels'));
    pending.clear();
    setTimeout(connect, 1000);
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') {
      const buf = ev.data as ArrayBuffer;
      const len = new DataView(buf).getUint32(0);
      const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
      frameCbs.get(meta.session)?.(meta, new Blob([new Uint8Array(buf, 4 + len)], { type: 'image/jpeg' }));
      return;
    }
    const m = JSON.parse(ev.data);
    if (m.type === 'rpc') {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p?.fail(new Error(m.error)); else p?.ok(m.result);
    } else if (m.type === 'hello') eventCbs.forEach((c) => c('hello', m.data));
    else if (m.type === 'event') eventCbs.forEach((c) => c(m.event, m.data));
  };
}

function send(m: object) {
  const s = JSON.stringify(m);
  if (ws?.readyState === WebSocket.OPEN) ws.send(s); else queue.push(s);
}

export function call<T = any>(method: string, params?: object): Promise<T> {
  const id = ++seq;
  return new Promise((ok, fail) => { pending.set(id, { ok, fail }); send({ type: 'rpc', id, method, params }); });
}
export const onEvent = (cb: (event: string, data: any) => void) => { eventCbs.add(cb); return () => eventCbs.delete(cb); };
export const onConnection = (cb: (c: boolean) => void) => { connCbs.add(cb); cb(connected); return () => connCbs.delete(cb); };

/** Live view of one session, sized to its on-screen frame. */
export function subscribe(session: string, maxW: number, maxH: number, cb: FrameCb) {
  frameCbs.set(session, cb);
  subs.set(session, { maxW, maxH });
  send({ type: 'subscribe', session, maxW, maxH });
  return () => { if (frameCbs.get(session) === cb) { frameCbs.delete(session); subs.delete(session); send({ type: 'unsubscribe', session }); } };
}

connect();
