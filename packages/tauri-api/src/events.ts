import type {
  AppSettings,
  GuestDownloadEvent,
  GuestMessageEvent,
} from '@internal/multi-mind';
import type { UnlistenFn } from '@tauri-apps/api/event';
import {
  GUEST_DOWNLOAD_EVENT,
  GUEST_MESSAGE_EVENT,
  normalizeSettings,
} from '@internal/multi-mind';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onLocalGuestMessage } from './browser-automation/guest-message-bus';

/** Broadcast after the settings file changes, whoever changed it. */
export const SETTINGS_CHANGED_EVENT = 'multi-mind://settings-changed';

/**
 * Subscribing is asynchronous in Tauri and synchronous in React, so the
 * unsubscribe has to be given back straight away and hold the real one once it
 * arrives. An effect that unmounts before the listener is attached still stops
 * it, because the flag is checked when it lands.
 *
 * `scope` says whose events to hear. A broadcast is for every window, but an
 * event Rust sends to one window must be heard there only: a listener with no
 * target hears every event, whichever window it was sent to, so without it a
 * right-click in one window's browser would open the menu in every window.
 */
function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
  scope: 'broadcast' | 'this-window' = 'broadcast',
): () => void {
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;

  const options =
    scope === 'this-window' ? { target: getCurrentWindow().label } : undefined;

  listen<T>(event, ({ payload }) => handler(payload), options).then(
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
 * Combines the two guest UI reporters, native browser lifecycle events and
 * host-generated automation evidence into one window-scoped subscription.
 */
export function onGuestMessage(handler: (event: GuestMessageEvent) => void): () => void {
  const stopLocal = onLocalGuestMessage(handler);
  const stopNative = subscribe<GuestMessageEvent>(
    GUEST_MESSAGE_EVENT,
    handler,
    'this-window',
  );
  return () => {
    stopLocal();
    stopNative();
  };
}

/** A download an embedded site started, finished or failed. */
export function onGuestDownload(
  handler: (event: GuestDownloadEvent) => void,
): () => void {
  return subscribe<GuestDownloadEvent>(GUEST_DOWNLOAD_EVENT, handler, 'this-window');
}
