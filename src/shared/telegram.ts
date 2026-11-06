import type { TelegramSettings, TgPlatform } from "./types.js";

/** Mini Apps versions we offer in the UI. Source: core.telegram.org/bots/webapps changelog (latest 10.1, Jun 2026). */
export const TG_VERSIONS = [
  "6.0",
  "6.1",
  "6.2",
  "6.4",
  "6.7",
  "6.9",
  "7.0",
  "7.2",
  "7.7",
  "7.8",
  "7.10",
  "8.0",
  "9.0",
  "9.1",
  "9.6",
  "10.0",
  "10.1",
];
export const TG_LATEST = "10.1";

/** Minimum Mini Apps version per WebApp method/field (from the docs). Absent = available since 6.0. */
export const TG_MIN_VERSION: Record<string, string> = {
  isVersionAtLeast: "6.1",
  setHeaderColor: "6.1",
  setBackgroundColor: "6.1",
  setBottomBarColor: "7.10",
  enableClosingConfirmation: "6.2",
  disableClosingConfirmation: "6.2",
  enableVerticalSwipes: "7.7",
  disableVerticalSwipes: "7.7",
  requestFullscreen: "8.0",
  exitFullscreen: "8.0",
  lockOrientation: "8.0",
  unlockOrientation: "8.0",
  addToHomeScreen: "8.0",
  checkHomeScreenStatus: "8.0",
  switchInlineQuery: "6.7",
  openLink: "6.1",
  openTelegramLink: "6.1",
  openInvoice: "6.1",
  shareToStory: "7.8",
  shareMessage: "8.0",
  setEmojiStatus: "8.0",
  requestEmojiStatusAccess: "8.0",
  downloadFile: "8.0",
  hideKeyboard: "9.1",
  showPopup: "6.2",
  showAlert: "6.2",
  showConfirm: "6.2",
  showScanQrPopup: "6.4",
  closeScanQrPopup: "6.4",
  readTextFromClipboard: "6.4",
  requestWriteAccess: "6.9",
  requestContact: "6.9",
  requestChat: "9.6",
  "BackButton.show": "6.1",
  "BackButton.hide": "6.1",
  "SettingsButton.show": "7.0",
  "SettingsButton.hide": "7.0",
  "SecondaryButton.show": "7.10",
  "SecondaryButton.setParams": "7.10",
  "SecondaryButton.setText": "7.10",
  "HapticFeedback.impactOccurred": "6.1",
  "HapticFeedback.notificationOccurred": "6.1",
  "HapticFeedback.selectionChanged": "6.1",
  "CloudStorage.setItem": "6.9",
  "CloudStorage.getItem": "6.9",
  "CloudStorage.getItems": "6.9",
  "CloudStorage.removeItem": "6.9",
  "CloudStorage.removeItems": "6.9",
  "CloudStorage.getKeys": "6.9",
  "DeviceStorage.setItem": "9.0",
  "DeviceStorage.getItem": "9.0",
  "DeviceStorage.removeItem": "9.0",
  "DeviceStorage.clear": "9.0",
  "SecureStorage.setItem": "9.0",
  "SecureStorage.getItem": "9.0",
  "SecureStorage.removeItem": "9.0",
  "SecureStorage.clear": "9.0",
  "BiometricManager.init": "7.2",
  "Accelerometer.start": "8.0",
  "DeviceOrientation.start": "8.0",
  "Gyroscope.start": "8.0",
  "LocationManager.init": "8.0",
};

export function versionAtLeast(have: string, need: string): boolean {
  const a = have.split(".").map(Number),
    b = need.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0,
      y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

type Theme = Record<string, string>;
/** Approximate theme presets per platform (sampled from the default clients). */
const THEMES: Record<string, { light: Theme; dark: Theme }> = {
  ios: {
    light: {
      bg_color: "#ffffff",
      text_color: "#000000",
      hint_color: "#8e8e93",
      link_color: "#007aff",
      button_color: "#007aff",
      button_text_color: "#ffffff",
      secondary_bg_color: "#efeff4",
      header_bg_color: "#f8f8f8",
      bottom_bar_bg_color: "#f2f2f2",
      accent_text_color: "#007aff",
      section_bg_color: "#ffffff",
      section_header_text_color: "#6d6d72",
      section_separator_color: "#c8c7cc",
      subtitle_text_color: "#8e8e93",
      destructive_text_color: "#ff3b30",
    },
    dark: {
      bg_color: "#000000",
      text_color: "#ffffff",
      hint_color: "#98989e",
      link_color: "#3e88f7",
      button_color: "#3e88f7",
      button_text_color: "#ffffff",
      secondary_bg_color: "#1c1c1d",
      header_bg_color: "#1a1a1a",
      bottom_bar_bg_color: "#1d1d1d",
      accent_text_color: "#3e88f7",
      section_bg_color: "#2c2c2e",
      section_header_text_color: "#8d8e93",
      section_separator_color: "#545458",
      subtitle_text_color: "#98989e",
      destructive_text_color: "#eb5545",
    },
  },
  android: {
    light: {
      bg_color: "#ffffff",
      text_color: "#222222",
      hint_color: "#a8a8a8",
      link_color: "#2678b6",
      button_color: "#50a8eb",
      button_text_color: "#ffffff",
      secondary_bg_color: "#f0f0f0",
      header_bg_color: "#527da3",
      bottom_bar_bg_color: "#f0f0f0",
      accent_text_color: "#1c93e3",
      section_bg_color: "#ffffff",
      section_header_text_color: "#3a95d5",
      section_separator_color: "#d9d9d9",
      subtitle_text_color: "#82868a",
      destructive_text_color: "#cc2929",
    },
    dark: {
      bg_color: "#212d3b",
      text_color: "#ffffff",
      hint_color: "#7d8b99",
      link_color: "#5eabe1",
      button_color: "#5288c1",
      button_text_color: "#ffffff",
      secondary_bg_color: "#1d2733",
      header_bg_color: "#242d39",
      bottom_bar_bg_color: "#1d2733",
      accent_text_color: "#64b5ef",
      section_bg_color: "#1d2733",
      section_header_text_color: "#79c4fc",
      section_separator_color: "#0d1218",
      subtitle_text_color: "#7b8790",
      destructive_text_color: "#ee686f",
    },
  },
  tdesktop: {
    light: {
      bg_color: "#ffffff",
      text_color: "#000000",
      hint_color: "#999999",
      link_color: "#168acd",
      button_color: "#40a7e3",
      button_text_color: "#ffffff",
      secondary_bg_color: "#f1f1f1",
      header_bg_color: "#ffffff",
      bottom_bar_bg_color: "#ffffff",
      accent_text_color: "#168acd",
      section_bg_color: "#ffffff",
      section_header_text_color: "#168acd",
      section_separator_color: "#e7e7e7",
      subtitle_text_color: "#999999",
      destructive_text_color: "#d14e4e",
    },
    dark: {
      bg_color: "#282e33",
      text_color: "#f5f5f5",
      hint_color: "#82868a",
      link_color: "#6ab3f3",
      button_color: "#5288c1",
      button_text_color: "#ffffff",
      secondary_bg_color: "#313b43",
      header_bg_color: "#282e33",
      bottom_bar_bg_color: "#282e33",
      accent_text_color: "#6ab2f2",
      section_bg_color: "#282e33",
      section_header_text_color: "#6ab3f3",
      section_separator_color: "#3d454c",
      subtitle_text_color: "#82868a",
      destructive_text_color: "#ec3942",
    },
  },
};

export function tgTheme(
  s: Pick<TelegramSettings, "platform" | "theme" | "themeParams">,
): Theme {
  if (s.theme === "custom" && s.themeParams) return s.themeParams;
  const p: TgPlatform = s.platform;
  const fam =
    p === "ios" || p === "macos"
      ? "ios"
      : p === "android"
        ? "android"
        : "tdesktop";
  return THEMES[fam]![s.theme === "dark" ? "dark" : "light"];
}
