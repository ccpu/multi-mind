/**
 * The WinForms build talked to its WebView2 controls over
 * `window.chrome.webview.postMessage`. A Tauri child webview showing a remote
 * page has no such channel of its own, so a bridge is installed into every
 * guest as an initialization script and forwards whatever it is given to the
 * host window.
 *
 * Both of the globals it defines live on the embedded page's own `window`,
 * where any site can enumerate them. Fixed names would announce to every AI
 * site exactly which app is embedding it — and could be blocklisted by name —
 * so they are generated fresh each run and handed to the bridge and the
 * injected scripts at startup. Nothing outside this session can predict them.
 */

export interface GuestGlobals {
  /** Global the guest bridge is exposed under. */
  bridgeKey: string;
  /** Global the shadow-root-aware query helper is attached to. */
  findKey: string;
}

/**
 * Everything the host window needs to wire up a guest webview. Unlike the
 * Electron port there is no preload file to point at: the bridge is a script
 * the Rust side prepends to the ones {@link createGuestScripts} produces.
 */
export type GuestConfig = GuestGlobals;

const RANDOM_NAME_RADIX = 36;
const RANDOM_NAME_LENGTH = 10;

function randomGlobalName(): string {
  // Not a secret, so `Math.random` is enough: it only has to be unguessable
  // ahead of time and different between runs.
  return `_${Math.random().toString(RANDOM_NAME_RADIX).slice(2, RANDOM_NAME_LENGTH)}`;
}

/** Fresh, non-identifying names for the globals a guest page can see. */
export function createGuestGlobals(): GuestGlobals {
  return {
    bridgeKey: randomGlobalName(),
    findKey: randomGlobalName(),
  };
}

/**
 * Tauri event the Rust side re-broadcasts a guest message on, carrying the id
 * of the site it came from. The bridge itself reaches Rust through the
 * `guest_message` command, which is the only thing a guest is allowed to call.
 */
export const GUEST_MESSAGE_EVENT = 'multi-mind://guest-message';

/** Payload of {@link GUEST_MESSAGE_EVENT}. */
export interface GuestMessageEvent {
  /** Id of the site the message came from, as `activeWebsites` holds it. */
  websiteId: string;
  message: string;
}

/**
 * All the embedded browsers share one profile folder, mirroring the single
 * WebView2 user-data folder the WinForms build gave all of its controls and
 * the `persist:multi-mind` partition the Electron port used. The Rust side
 * resolves it under the app's data directory.
 */
export const GUEST_PROFILE_DIRECTORY = 'browser-profile';

/** Label prefix every guest webview is created under, as the ACL matches it. */
export const GUEST_LABEL_PREFIX = 'chat-';

/** The webview label carrying one site's browser. */
export function guestLabel(websiteId: string): string {
  return `${GUEST_LABEL_PREFIX}${websiteId}`;
}

export const CLICKED_MESSAGE = '__clicked__';
export const CTRL_ENTER_MESSAGE = '__ctrl_enter__';

/** Prefix of the message a guest sends when it wants to open a window. */
export const OPEN_MESSAGE_PREFIX = '__open__';

/** Prefix of the message a guest sends when it was right-clicked. */
export const MENU_MESSAGE_PREFIX = '__menu__';

/** Bridge shape exposed into the guest page's main world. */
export interface MultiMindHostBridge {
  postMessage: (message: string) => void;
}

/**
 * Reads back the JSON a prefixed message carries. Null for a message that is
 * not of that kind, or whose payload did not survive the trip.
 */
export function parsePrefixedMessage<T>(message: string, prefix: string): T | null {
  if (!message.startsWith(prefix)) {
    return null;
  }

  try {
    return JSON.parse(message.slice(prefix.length)) as T;
  } catch {
    return null;
  }
}
