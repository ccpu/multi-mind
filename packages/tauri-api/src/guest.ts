import type { ContextMenuAction, GuestConfig } from '@internal/multi-mind';
import type {
  GuestBounds,
  GuestCookie,
  GuestCookieRemoval,
  GuestPane,
  NativeMenuEntry,
} from './types';
import { invoke } from '@tauri-apps/api/core';
import {
  cancelGuestPrompt,
  retainGuestPrompts,
} from './browser-automation/send-guest-prompt';

/**
 * The embedded browsers.
 *
 * WebView2 gave the WinForms build a control it could dock like any other, and
 * Electron gave the port a `<webview>` element the renderer laid out itself.
 * Tauri has neither: a guest is a child webview of the window, owned by Rust
 * and positioned in window coordinates, drawn over whatever the host page has
 * there. So the host still decides the layout — Split.js still runs — but what
 * it lays out is an empty box whose measurements are sent down here.
 *
 * Everything below is plumbing on purpose. What a guest should show, when it
 * should be reloaded and what a right-click on it offers are all decided in
 * `@internal/multi-mind`, which is where they can be tested.
 */

/** The per-run names of the globals the bridge and the injected scripts share. */
export async function guestConfig(): Promise<GuestConfig> {
  return invoke<GuestConfig>('get_guest_config');
}

/**
 * Brings the open guests in line with `panes`: opens the ones that are new,
 * closes the ones that are gone, and moves the rest.
 *
 * The whole list rather than one change at a time, because a drag and a site
 * being switched on are the same layout pass and reconciling from a complete
 * picture is what keeps them from racing.
 */
export async function guestSync(panes: readonly GuestPane[]): Promise<void> {
  retainGuestPrompts(new Set(panes.map((pane) => pane.websiteId)));
  return invoke<void>('guest_sync', { panes });
}

/**
 * Hides or shows every open guest at once.
 *
 * A child webview is drawn over the window, so while one is up the page under
 * it gets neither the pointer nor the pixels. Dragging a divider needs the
 * first and a popover needs the second, so both ask the browsers to step aside
 * and put them back afterwards. Electron's `<webview>` needed the same, and got
 * it from a `pointer-events: none` the page could set itself.
 */
export async function guestSetVisible(visible: boolean): Promise<void> {
  return invoke<void>('guest_set_visible', { visible });
}

/** Clips native browser regions behind floating UI; false requests the platform fallback. */
export async function guestSetOverlays(
  overlays: readonly GuestBounds[],
  modal: boolean,
): Promise<boolean> {
  return invoke<boolean>('guest_set_overlays', { overlays, modal });
}

/** Port of `WebViewManager.Reload`: back to the site's configured URL. */
export async function guestNavigate(websiteId: string, url: string): Promise<void> {
  cancelGuestPrompt(websiteId);
  return invoke<void>('guest_navigate', { websiteId, url });
}

/** Reloads the page a guest is on, which is what the right-click menu does. */
export async function guestReload(websiteId: string): Promise<void> {
  cancelGuestPrompt(websiteId);
  return invoke<void>('guest_reload', { websiteId });
}

/** Runs an explicit context-menu action; prompt automation uses structured requests. */
export async function guestEval(websiteId: string, script: string): Promise<void> {
  return invoke<void>('guest_eval', { websiteId, script });
}

/** The URL a guest is showing, for the menu model and for clearing cookies. */
export async function guestUrl(websiteId: string): Promise<string> {
  return invoke<string>('guest_url', { websiteId });
}

/**
 * Every cookie in the shared browser profile.
 *
 * The whole profile rather than a filtered read: a `domain` filter matches a
 * domain and its subdomains, which leaves behind exactly the parent-domain
 * cookies a bot check tends to sit in. `cookieBelongsToSite` does the filtering
 * instead, where it is tested.
 */
export async function guestCookies(websiteId: string): Promise<GuestCookie[]> {
  return invoke<GuestCookie[]>('guest_cookies', { websiteId });
}

/** Deletes the named cookies, each through a URL it would have been sent to. */
export async function guestDeleteCookies(
  websiteId: string,
  cookies: readonly GuestCookieRemoval[],
): Promise<void> {
  return invoke<void>('guest_delete_cookies', { websiteId, cookies });
}

/** Opens the guest's own DevTools, which is what `Inspect Element` is for. */
export async function guestOpenDevtools(websiteId: string): Promise<void> {
  return invoke<void>('guest_open_devtools', { websiteId });
}

/**
 * Opens the in-app window a guest asked for — the one WebView2 would have
 * given it — sharing the profile so the session a sign-in authorises is the
 * one the panes are signed in to.
 *
 * The window gets no app bridge or capability. The legacy scripts argument is
 * accepted for compatibility and ignored; native callbacks handle popup links.
 */
export async function guestOpenPopup(url: string, scripts: string[]): Promise<void> {
  return invoke<void>('guest_open_popup', { url, scripts });
}

/**
 * Pops a native menu over a guest and resolves with the action chosen, or null
 * when it is dismissed.
 *
 * The entries come from `buildContextMenuModel`, so the shape of the menu is
 * still decided in TypeScript; Rust only draws it, because a menu over a child
 * webview cannot be drawn by the page underneath it.
 */
export async function guestPopupMenu(
  entries: readonly NativeMenuEntry[],
  position: Pick<GuestBounds, 'x' | 'y'>,
): Promise<ContextMenuAction | null> {
  return invoke<ContextMenuAction | null>('guest_popup_menu', {
    entries,
    x: position.x,
    y: position.y,
  });
}
