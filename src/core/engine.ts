import { chromium, webkit, type Browser } from 'playwright';
import type { Engine } from '../shared/types.js';

/**
 * One browser process per engine, shared by every device (separate contexts, never a browser per device).
 * Engines launch lazily (WebKit only when an Apple device is opened) and shut down after `idleMs` with no contexts.
 */
const LEAN_CHROMIUM_FLAGS = [
  '--renderer-process-limit=4',
  '--disable-features=Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions,CalculateNativeWinOcclusion',
  '--disable-default-apps',
  '--no-first-run',
  '--mute-audio',
  '--disable-breakpad',
  '--metrics-recording-only',
  '--password-store=basic',
];

export class EnginePool {
  private browsers = new Map<Engine, Promise<Browser>>();
  private contexts = new Map<Engine, number>();
  private timers = new Map<Engine, NodeJS.Timeout>();
  constructor(private idleMs: number) {}

  async get(engine: Engine): Promise<Browser> {
    clearTimeout(this.timers.get(engine));
    let p = this.browsers.get(engine);
    if (!p) {
      p = (engine === 'chromium'
        ? chromium.launch({ headless: true, args: LEAN_CHROMIUM_FLAGS })
        : webkit.launch({ headless: true })
      ).catch((e: Error) => {
        this.browsers.delete(engine);
        if (engine === 'webkit' && /missing dependencies/i.test(e.message)) {
          const libs = /apt-get install ([\s\S]*?)║\s*\n║\s*║/.exec(e.message)?.[1]?.replace(/[\\║\s]+/g, ' ').trim();
          throw new Error(`WebKit (iPhone/iPad/Safari) needs system libraries. Run: sudo apt-get install ${libs || 'libevent-2.1-7t64 libavif16'}   (or: sudo npx playwright install-deps webkit)`);
        }
        if (/Executable doesn't exist/i.test(e.message)) throw new Error(`${engine} is not installed. Run: npx playwright install ${engine}`);
        throw e;
      });
      this.browsers.set(engine, p);
      p.then((b) => b.on('disconnected', () => this.browsers.delete(engine))).catch(() => {});
    }
    return p;
  }

  /** Track live contexts so idle engines can be shut down. */
  retain(engine: Engine) { this.contexts.set(engine, (this.contexts.get(engine) ?? 0) + 1); clearTimeout(this.timers.get(engine)); }
  release(engine: Engine) {
    const n = Math.max(0, (this.contexts.get(engine) ?? 1) - 1);
    this.contexts.set(engine, n);
    if (n === 0) {
      clearTimeout(this.timers.get(engine));
      this.timers.set(engine, setTimeout(() => this.shutdown(engine), this.idleMs).unref());
    }
  }
  count(engine: Engine) { return this.contexts.get(engine) ?? 0; }
  running(engine: Engine) { return this.browsers.has(engine); }

  async shutdown(engine: Engine) {
    if (this.count(engine) > 0) return;
    const p = this.browsers.get(engine);
    this.browsers.delete(engine);
    if (p) await p.then((b) => b.close()).catch(() => {});
  }
  async closeAll() { await Promise.all([...this.browsers.keys()].map((e) => { this.contexts.set(e, 0); return this.shutdown(e); })); }
}
