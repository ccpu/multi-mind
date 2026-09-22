import {
  appInfo,
  browseSettingsLocation,
  getSettings,
  getSettingsLocation,
  openWindow,
  resetSettingsLocation,
  saveSettings,
  setSettingsLocation,
} from './commands';
import { onGuestMessage, onSettingsChanged } from './events';
import {
  guestConfig,
  guestCookies,
  guestDeleteCookies,
  guestEval,
  guestNavigate,
  guestOpenDevtools,
  guestOpenPopup,
  guestPopupMenu,
  guestReload,
  guestSetVisible,
  guestSync,
  guestUrl,
} from './guest';

/**
 * The whole bridge, as one object.
 *
 * The Electron port reached the main process through `appApi.invoke.x()` and
 * subscribed with `appApi.events.onX()`, and the windows are written against
 * that shape. Keeping it means the components that were ported over did not
 * have to be rewritten around a different call style to say the same thing —
 * what changed underneath is that `invoke` now crosses into Rust rather than
 * into a Node process, and that nothing is exposed on `window`.
 */
export const appApi = {
  /** Request/response calls into Rust. */
  invoke: {
    appInfo,
    getSettings,
    saveSettings,
    getGuestConfig: guestConfig,
    getSettingsLocation,
    browseSettingsLocation,
    setSettingsLocation,
    resetSettingsLocation,
    openWindow,
  },

  /** Things Rust announces, each returning its own unsubscribe. */
  events: {
    onSettingsChanged,
    onGuestMessage,
  },

  /** The embedded browsers, which only the main window drives. */
  guest: {
    sync: guestSync,
    setVisible: guestSetVisible,
    navigate: guestNavigate,
    reload: guestReload,
    run: guestEval,
    url: guestUrl,
    cookies: guestCookies,
    deleteCookies: guestDeleteCookies,
    openDevtools: guestOpenDevtools,
    openPopup: guestOpenPopup,
    popupMenu: guestPopupMenu,
  },
} as const;
