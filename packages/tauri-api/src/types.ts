/**
 * Mirrors of the Rust structs that cross the bridge.
 *
 * The Rust side serialises with `#[serde(rename_all = "camelCase")]`, so the
 * field names here are the camelCase ones that arrive. Keep them in step with
 * `apps/desktop/src-tauri/src/`, because a bridge call is a string and nothing
 * else will catch a rename.
 */

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  /** `windows`, `macos`, `linux`, … — `std::env::consts::OS`. */
  platform: string;
  /** `x86_64`, `aarch64`, … — `std::env::consts::ARCH`. */
  arch: string;
}

/** Where one embedded browser sits, in CSS pixels inside the host window. */
export interface GuestBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One embedded browser, as the host window wants it to be.
 *
 * `guestSync` takes the whole list rather than one change at a time: the panes
 * are created, closed and moved by the same layout pass, and reconciling from
 * a complete picture is what keeps a drag from racing a site being switched on.
 */
export interface GuestPane {
  /** `WebsiteInfo.id`; the webview label is derived from it. */
  websiteId: string;
  /** Where the site starts, and where **New Chat** takes it back to. */
  url: string;
  bounds: GuestBounds;
  /**
   * The initialization scripts this site's webview runs before every page of
   * its own — `createGuestScripts` from `@internal/multi-mind`. Only read when
   * the webview is created; an open one keeps the scripts it was built with.
   */
  scripts: readonly string[];
}

/** One stored cookie, as Rust reports it for {@link guestCookies}. */
export interface GuestCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
}

/** A cookie to delete, named the way the store needs it named. */
export interface GuestCookieRemoval {
  name: string;
  /** A URL the cookie would be sent to, from `cookieRemovalUrl`. */
  url: string;
}

/** One entry of the native right-click menu Rust pops for a guest. */
export interface NativeMenuEntry {
  /** Empty for a separator. */
  action: string;
  label: string;
  enabled: boolean;
}

/** What {@link newWindow} answers, kept as the Electron port shaped it. */
export interface OpenWindowResult {
  success: boolean;
  message: string;
}
