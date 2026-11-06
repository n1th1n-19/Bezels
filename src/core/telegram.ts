import { createHmac } from 'node:crypto';
import type { TelegramSettings } from '../shared/types.js';
import { TG_MIN_VERSION, tgTheme } from '../shared/telegram.js';

export interface TgInit { initData: string; initDataUnsafe: Record<string, unknown>; signed: boolean }

/**
 * initData like Telegram sends it. Unsigned (fake hash) by default, so server-side validation fails on purpose.
 * With a *test* bot token it is signed exactly like Telegram does:
 *   secret = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = hex(HMAC_SHA256(key=secret, msg=data_check_string))
 */
export function buildInitData(s: TelegramSettings, botToken?: string, now = Date.now()): TgInit {
  const user = s.user ?? { id: 777000001, first_name: 'Test' };
  const fields: Record<string, string> = {
    query_id: 'AAHbezels' + Math.floor(now / 1000).toString(36),
    user: JSON.stringify({ ...user, language_code: s.language, allows_write_to_pm: true }),
    auth_date: String(Math.floor(now / 1000)),
    chat_type: 'private',
    chat_instance: '-4242424242424242424',
  };
  if (s.startParam) fields.start_param = s.startParam;
  const dcs = dataCheckString(fields);
  const hash = botToken ? createHmac('sha256', createHmac('sha256', 'WebAppData').update(botToken).digest()).update(dcs).digest('hex') : '0'.repeat(64);
  const params = new URLSearchParams({ ...fields, hash });
  return { initData: params.toString(), initDataUnsafe: { ...fields, user: JSON.parse(fields.user!), auth_date: Number(fields.auth_date), hash }, signed: !!botToken };
}

export function dataCheckString(fields: Record<string, string>): string {
  return Object.keys(fields).filter((k) => k !== 'hash' && k !== 'signature').sort().map((k) => `${k}=${fields[k]}`).join('\n');
}

/** Same check a bot backend does. Used by the self-test. */
export function validateInitData(initData: string, botToken: string): boolean {
  const p = Object.fromEntries(new URLSearchParams(initData));
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheckString(p)).digest('hex') === p.hash;
}

export interface TgMockConfig {
  version: string; platform: string; colorScheme: 'light' | 'dark'; themeParams: Record<string, string>;
  initData: string; initDataUnsafe: Record<string, unknown>; minVersion: Record<string, string>;
  viewportHeight: number; isExpanded: boolean; isFullscreen: boolean;
  safeAreaInset: Record<string, number>; contentSafeAreaInset: Record<string, number>;
}

export function mockConfig(s: TelegramSettings, init: TgInit, vp: { h: number; expanded: boolean; fullscreen: boolean; safe: Record<string, number>; content: Record<string, number> }): TgMockConfig {
  return {
    version: s.version, platform: s.platform, colorScheme: s.theme === 'dark' ? 'dark' : 'light', themeParams: tgTheme(s),
    initData: init.initData, initDataUnsafe: init.initDataUnsafe, minVersion: TG_MIN_VERSION,
    viewportHeight: vp.h, isExpanded: vp.expanded, isFullscreen: vp.fullscreen, safeAreaInset: vp.safe, contentSafeAreaInset: vp.content,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Mock window.Telegram.WebApp. Runs as an init script before page scripts. Calls go to core via window.__bezels. */
export function tgMock(cfg: TgMockConfig) {
  const w = window as any;
  const send = (m: any): Promise<any> => { try { return Promise.resolve(w.__bezels?.(m)); } catch { return Promise.resolve(null); } };
  const atLeast = (need: string) => { const a = cfg.version.split('.').map(Number), b = need.split('.').map(Number); for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] ?? 0, y = b[i] ?? 0; if (x !== y) return x > y; } return true; };
  const clean = (args: any[]) => args.map((a) => (typeof a === 'function' ? '[fn]' : a));
  const log = (method: string, args: any[] = []) => {
    const need = cfg.minVersion[method];
    const unsupported = !!need && !atLeast(need);
    send({ type: 'tg', method, args: clean(args), unsupported, minVersion: need });
    if (unsupported) console.warn(`[Telegram.WebApp] Method ${method} is not supported in version ${cfg.version}`);
    return !unsupported;
  };
  const listeners: Record<string, Function[]> = {};
  const emit = (ev: string, data?: any) => (listeners[ev] ?? []).slice().forEach((cb) => { try { cb.call(WebApp, data); } catch (e) { console.error(e); } });
  const root = document.documentElement;
  const setVar = (k: string, v: string) => root.style.setProperty(k, v);

  const state = { ...cfg, viewportStableHeight: cfg.viewportHeight, headerColor: cfg.themeParams.header_bg_color ?? cfg.themeParams.bg_color, backgroundColor: cfg.themeParams.bg_color, bottomBarColor: cfg.themeParams.bottom_bar_bg_color ?? cfg.themeParams.secondary_bg_color };
  const applyVars = () => {
    setVar('--tg-color-scheme', state.colorScheme);
    for (const [k, v] of Object.entries(state.themeParams)) setVar(`--tg-theme-${k.replace(/_/g, '-')}`, v);
    setVar('--tg-viewport-height', `${state.viewportHeight}px`);
    setVar('--tg-viewport-stable-height', `${state.viewportStableHeight}px`);
    for (const s of ['top', 'bottom', 'left', 'right']) {
      setVar(`--tg-safe-area-inset-${s}`, `${state.safeAreaInset[s] ?? 0}px`);
      setVar(`--tg-content-safe-area-inset-${s}`, `${state.contentSafeAreaInset[s] ?? 0}px`);
    }
  };

  const button = (which: 'main' | 'secondary', defaults: any) => {
    const evName = which === 'main' ? 'mainButtonClicked' : 'secondaryButtonClicked';
    const prefix = which === 'main' ? 'MainButton' : 'SecondaryButton';
    const b: any = { text: defaults.text, color: defaults.color, textColor: defaults.textColor, isVisible: false, isActive: true, isProgressVisible: false, hasShineEffect: false, position: defaults.position, iconCustomEmojiId: '' };
    const push = () => send({ type: 'tgButton', which, state: { visible: b.isVisible, text: b.text, color: b.color, textColor: b.textColor, active: b.isActive, progress: b.isProgressVisible, hasShineEffect: b.hasShineEffect, position: b.position } });
    const m = (name: string, fn: (...a: any[]) => void) => { b[name] = (...a: any[]) => { if (log(`${prefix}.${name}`, a)) { fn(...a); push(); } return b; }; };
    m('setText', (t: string) => { b.text = String(t); });
    m('show', () => { b.isVisible = true; });
    m('hide', () => { b.isVisible = false; });
    m('enable', () => { b.isActive = true; });
    m('disable', () => { b.isActive = false; });
    m('showProgress', () => { b.isProgressVisible = true; });
    m('hideProgress', () => { b.isProgressVisible = false; });
    m('setParams', (p: any) => {
      if ('text' in p) b.text = p.text; if ('color' in p) b.color = p.color; if ('text_color' in p) b.textColor = p.text_color;
      if ('is_active' in p) b.isActive = p.is_active; if ('is_visible' in p) b.isVisible = p.is_visible; if ('has_shine_effect' in p) b.hasShineEffect = p.has_shine_effect; if ('position' in p) b.position = p.position;
    });
    b.onClick = (cb: Function) => { log(`${prefix}.onClick`); (listeners[evName] ??= []).push(cb); return b; };
    b.offClick = (cb: Function) => { listeners[evName] = (listeners[evName] ?? []).filter((x) => x !== cb); return b; };
    return b;
  };
  const simpleButton = (name: string, ev: string) => {
    const b: any = { isVisible: false };
    b.show = () => { if (log(`${name}.show`)) { b.isVisible = true; send({ type: 'tgSimpleButton', name, visible: true }); } return b; };
    b.hide = () => { if (log(`${name}.hide`)) { b.isVisible = false; send({ type: 'tgSimpleButton', name, visible: false }); } return b; };
    b.onClick = (cb: Function) => { (listeners[ev] ??= []).push(cb); return b; };
    b.offClick = (cb: Function) => { listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== cb); return b; };
    return b;
  };
  const storage = (name: string, cloud: boolean) => {
    const op = (method: string) => (...args: any[]) => {
      const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      if (!log(`${name}.${method}`, args)) { cb?.(new Error('WebAppMethodUnsupported')); return; }
      send({ type: 'tgCall', method: `${name}.${method}`, args }).then((r) => cb?.(r?.error ?? null, r?.result), (e) => cb?.(e));
    };
    const s: any = { setItem: op('setItem'), getItem: op('getItem'), removeItem: op('removeItem') };
    if (cloud) Object.assign(s, { getItems: op('getItems'), removeItems: op('removeItems'), getKeys: op('getKeys') });
    else s.clear = op('clear');
    return s;
  };
  const popupCbs: Record<string, Function> = {};
  let popupSeq = 0;
  const popup = (kind: string, params: any, cb?: Function) => {
    const id = String(++popupSeq);
    if (cb) popupCbs[id] = cb;
    send({ type: 'tgPopup', id, kind, params });
  };
  const sensor = (name: string) => ({ isStarted: false, start: (_p: any, cb?: Function) => { log(`${name}.start`, [_p]); cb?.(true); }, stop: (cb?: Function) => { log(`${name}.stop`); cb?.(true); } });
  const noopLog = (name: string) => (...a: any[]) => { log(name, a); const cb = a.find((x) => typeof x === 'function'); cb?.(false); };

  const WebApp: any = {
    initData: cfg.initData, initDataUnsafe: cfg.initDataUnsafe, version: cfg.version, platform: cfg.platform,
    get colorScheme() { return state.colorScheme; }, get themeParams() { return { ...state.themeParams }; },
    isActive: true, get isExpanded() { return state.isExpanded; }, get viewportHeight() { return state.viewportHeight; }, get viewportStableHeight() { return state.viewportStableHeight; },
    get headerColor() { return state.headerColor; }, get backgroundColor() { return state.backgroundColor; }, get bottomBarColor() { return state.bottomBarColor; },
    isClosingConfirmationEnabled: false, isVerticalSwipesEnabled: true, get isFullscreen() { return state.isFullscreen; }, isOrientationLocked: false,
    get safeAreaInset() { return { ...state.safeAreaInset }; }, get contentSafeAreaInset() { return { ...state.contentSafeAreaInset }; },
    isVersionAtLeast: (v: string) => atLeast(v),
    setHeaderColor: (c: string) => { if (log('setHeaderColor', [c])) { state.headerColor = state.themeParams[c] ?? c; send({ type: 'tgColor', key: 'headerColor', value: state.headerColor }); } },
    setBackgroundColor: (c: string) => { if (log('setBackgroundColor', [c])) { state.backgroundColor = state.themeParams[c] ?? c; send({ type: 'tgColor', key: 'backgroundColor', value: state.backgroundColor }); } },
    setBottomBarColor: (c: string) => { if (log('setBottomBarColor', [c])) { state.bottomBarColor = state.themeParams[c] ?? c; send({ type: 'tgColor', key: 'bottomBarColor', value: state.bottomBarColor }); } },
    enableClosingConfirmation: () => { if (log('enableClosingConfirmation')) { WebApp.isClosingConfirmationEnabled = true; send({ type: 'tgFlag', key: 'closingConfirmation', value: true }); } },
    disableClosingConfirmation: () => { if (log('disableClosingConfirmation')) { WebApp.isClosingConfirmationEnabled = false; send({ type: 'tgFlag', key: 'closingConfirmation', value: false }); } },
    enableVerticalSwipes: () => { if (log('enableVerticalSwipes')) { WebApp.isVerticalSwipesEnabled = true; send({ type: 'tgFlag', key: 'verticalSwipes', value: true }); } },
    disableVerticalSwipes: () => { if (log('disableVerticalSwipes')) { WebApp.isVerticalSwipesEnabled = false; send({ type: 'tgFlag', key: 'verticalSwipes', value: false }); } },
    requestFullscreen: () => { if (log('requestFullscreen')) send({ type: 'tgMode', mode: 'fullscreen' }); else emit('fullscreenFailed', { error: 'UNSUPPORTED' }); },
    exitFullscreen: () => { if (log('exitFullscreen')) send({ type: 'tgMode', mode: 'expanded' }); },
    lockOrientation: () => { if (log('lockOrientation')) WebApp.isOrientationLocked = true; },
    unlockOrientation: () => { if (log('unlockOrientation')) WebApp.isOrientationLocked = false; },
    addToHomeScreen: () => { if (log('addToHomeScreen')) setTimeout(() => emit('homeScreenAdded'), 300); },
    checkHomeScreenStatus: (cb?: Function) => { if (log('checkHomeScreenStatus')) { cb?.('missed'); emit('homeScreenChecked', { status: 'missed' }); } },
    onEvent: (ev: string, cb: Function) => { (listeners[ev] ??= []).push(cb); },
    offEvent: (ev: string, cb: Function) => { listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== cb); },
    sendData: (d: string) => { log('sendData', [d]); },
    switchInlineQuery: (q: string, t?: string[]) => { log('switchInlineQuery', [q, t]); },
    openLink: (u: string, o?: any) => { log('openLink', [u, o]); },
    openTelegramLink: (u: string) => { log('openTelegramLink', [u]); },
    openInvoice: (u: string, cb?: Function) => { if (log('openInvoice', [u])) setTimeout(() => { cb?.('cancelled'); emit('invoiceClosed', { url: u, status: 'cancelled' }); }, 500); },
    shareToStory: (...a: any[]) => { log('shareToStory', a); },
    shareMessage: (id: string, cb?: Function) => { if (log('shareMessage', [id])) { cb?.(false); emit('shareMessageFailed', { error: 'USER_DECLINED' }); } },
    setEmojiStatus: noopLog('setEmojiStatus'), requestEmojiStatusAccess: noopLog('requestEmojiStatusAccess'), downloadFile: noopLog('downloadFile'),
    hideKeyboard: () => { if (log('hideKeyboard')) (document.activeElement as HTMLElement | null)?.blur(); },
    showPopup: (p: any, cb?: Function) => { if (log('showPopup', [p])) popup('popup', p, cb); },
    showAlert: (m: string, cb?: Function) => { if (log('showAlert', [m])) popup('alert', { message: m, buttons: [{ id: 'ok', type: 'ok' }] }, cb); },
    showConfirm: (m: string, cb?: Function) => { if (log('showConfirm', [m])) popup('confirm', { message: m, buttons: [{ id: 'ok', type: 'ok' }, { id: 'cancel', type: 'cancel' }] }, cb ? (id: string) => cb(id === 'ok') : undefined); },
    showScanQrPopup: (p: any, cb?: Function) => { if (log('showScanQrPopup', [p])) popup('qr', { message: p?.text ?? 'Scan QR code', buttons: [{ id: 'cancel', type: 'cancel' }] }, cb); },
    closeScanQrPopup: () => { if (log('closeScanQrPopup')) send({ type: 'tgPopupClose' }); },
    readTextFromClipboard: (cb?: Function) => { if (log('readTextFromClipboard')) send({ type: 'tgCall', method: 'readTextFromClipboard', args: [] }).then((r) => { cb?.(r?.result ?? null); emit('clipboardTextReceived', { data: r?.result ?? null }); }); },
    requestWriteAccess: (cb?: Function) => { if (log('requestWriteAccess')) { cb?.(true); emit('writeAccessRequested', { status: 'allowed' }); } },
    requestContact: (cb?: Function) => { if (log('requestContact')) { cb?.(false); emit('contactRequested', { status: 'cancelled' }); } },
    requestChat: noopLog('requestChat'),
    ready: () => { log('ready'); },
    expand: () => { log('expand'); send({ type: 'tgMode', mode: 'expanded' }); },
    close: (o?: any) => { log('close', [o]); },
    MainButton: null, BottomButton: null, SecondaryButton: null,
    BackButton: simpleButton('BackButton', 'backButtonClicked'),
    SettingsButton: simpleButton('SettingsButton', 'settingsButtonClicked'),
    HapticFeedback: {
      impactOccurred: (s: string) => { log('HapticFeedback.impactOccurred', [s]); return WebApp.HapticFeedback; },
      notificationOccurred: (s: string) => { log('HapticFeedback.notificationOccurred', [s]); return WebApp.HapticFeedback; },
      selectionChanged: () => { log('HapticFeedback.selectionChanged'); return WebApp.HapticFeedback; },
    },
    CloudStorage: storage('CloudStorage', true), DeviceStorage: storage('DeviceStorage', false), SecureStorage: storage('SecureStorage', false),
    BiometricManager: { isInited: false, isBiometricAvailable: false, biometricType: 'unknown', isAccessRequested: false, isAccessGranted: false, isBiometricTokenSaved: false, deviceId: '',
      init: (cb?: Function) => { log('BiometricManager.init'); WebApp.BiometricManager.isInited = true; cb?.(); emit('biometricManagerUpdated'); },
      requestAccess: noopLog('BiometricManager.requestAccess'), authenticate: noopLog('BiometricManager.authenticate'), updateBiometricToken: noopLog('BiometricManager.updateBiometricToken'), openSettings: noopLog('BiometricManager.openSettings') },
    Accelerometer: sensor('Accelerometer'), DeviceOrientation: sensor('DeviceOrientation'), Gyroscope: sensor('Gyroscope'),
    LocationManager: { isInited: false, isLocationAvailable: true, isAccessRequested: false, isAccessGranted: false, init: (cb?: Function) => { log('LocationManager.init'); WebApp.LocationManager.isInited = true; cb?.(); }, getLocation: (cb?: Function) => { log('LocationManager.getLocation'); navigator.geolocation.getCurrentPosition((p) => cb?.({ latitude: p.coords.latitude, longitude: p.coords.longitude, altitude: null, course: null, speed: null, horizontal_accuracy: p.coords.accuracy, vertical_accuracy: null, course_accuracy: null, speed_accuracy: null }), () => cb?.(null)); }, openSettings: noopLog('LocationManager.openSettings') },
  };
  WebApp.MainButton = WebApp.BottomButton = button('main', { text: 'Continue', color: cfg.themeParams.button_color, textColor: cfg.themeParams.button_text_color });
  WebApp.SecondaryButton = button('secondary', { text: 'Cancel', color: cfg.themeParams.bottom_bar_bg_color, textColor: cfg.themeParams.button_color, position: 'left' });

  // Messages from Bezels (UI buttons, sheet drag, theme switch...).
  w.__bezelsTgReceive = (m: any) => {
    switch (m.type) {
      case 'viewport':
        state.viewportHeight = m.height; if (m.isStateStable) state.viewportStableHeight = m.height;
        state.isExpanded = m.isExpanded; applyVars(); emit('viewportChanged', { isStateStable: m.isStateStable }); break;
      case 'safeArea':
        state.safeAreaInset = m.safe; state.contentSafeAreaInset = m.content; applyVars(); emit('safeAreaChanged'); emit('contentSafeAreaChanged'); break;
      case 'fullscreen':
        state.isFullscreen = m.value; emit('fullscreenChanged', { isFullscreen: m.value }); break;
      case 'theme':
        state.colorScheme = m.colorScheme; state.themeParams = m.themeParams; applyVars(); emit('themeChanged'); break;
      case 'event': emit(m.name, m.data); break;
      case 'popupClosed': { const cb = popupCbs[m.id]; delete popupCbs[m.id]; cb?.(m.buttonId); emit('popupClosed', { button_id: m.buttonId }); break; }
      case 'qrText': { const cb = popupCbs[m.id]; const close = cb?.(m.text); emit('qrTextReceived', { data: m.text }); if (close === true) send({ type: 'tgPopupClose' }); break; }
      case 'active': WebApp.isActive = m.value; emit(m.value ? 'activated' : 'deactivated'); break;
    }
  };

  const tg = (w.Telegram = w.Telegram || {});
  Object.defineProperty(tg, 'WebApp', { value: WebApp, writable: false, configurable: false, enumerable: true });
  tg.WebView ??= { initParams: {}, isIframe: false, onEvent: WebApp.onEvent, offEvent: WebApp.offEvent, postEvent: (e: string, cb?: Function, d?: any) => { log(`WebView.postEvent:${e}`, [d]); cb?.(); }, receiveEvent: () => {}, callEventCallbacks: () => {} };
  tg.Utils ??= { urlSafeDecode: (s: string) => decodeURIComponent(s), urlParseQueryString: (s: string) => Object.fromEntries(new URLSearchParams(s)), urlParseHashParams: (s: string) => Object.fromEntries(new URLSearchParams(s.replace(/^#/, ''))) };
  if (document.documentElement) applyVars();
  else { const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); applyVars(); } }); mo.observe(document, { childList: true }); }
  addEventListener('DOMContentLoaded', applyVars);
}
