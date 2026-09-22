import type { AppSettings, GuestMessageEvent } from '@internal/multi-mind';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { GUEST_MESSAGE_EVENT, normalizeSettings } from '@internal/multi-mind';
import { listen } from '@tauri-apps/api/event';

/** Broadcast after the settings file changes, whoever changed it. */
export const SETTINGS_CHANGED_EVENT = 'multi-mind://settings-changed';

/**
 * Subscribing is asynchronous in Tauri and synchronous in React, so the
 * unsubscribe has to be given back straight away and hold the real one once it
 * arrives. An effect that unmounts before the listener is attached still stops
 * it, because the flag is checked when it lands.
 */
function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;

  listen<T>(event, ({ payload }) => handler(payload)).then(
    (stop) => {
      if (cancelled) {
        stop();
        return;
      }

      unlisten = stop;
    },
    (error: unknown) => {
      console.error(`Failed to listen for "${event}":`, error);
    },
  );

  return () => {
    cancelled = true;
    unlisten?.();
    unlisten = null;
  };
}

/**
 * Settings are edited in one window and acted on in another, so every change
 * is saved and then announced to all of them.
 */
export function onSettingsChanged(handler: (settings: AppSettings) => void): () => void {
  // Normalised on the way in, as a read is: Rust announces the file's contents,
  // and what those mean is decided in `@internal/multi-mind`.
  return subscribe<unknown>(SETTINGS_CHANGED_EVENT, (payload) =>
    handler(normalizeSettings(payload)),
  );
}

/**
 * A message from an embedded site: a click, a Ctrl+Enter, a window it wants
 * opened, or a right-click. The Electron port took these as a `<webview>`
 * `ipc-message`; here they come through the `guest_message` command and back
 * out as an app event, which is the only thing a guest is allowed to call.
 */
export function onGuestMessage(handler: (event: GuestMessageEvent) => void): () => void {
  return subscribe<GuestMessageEvent>(GUEST_MESSAGE_EVENT, handler);
}
