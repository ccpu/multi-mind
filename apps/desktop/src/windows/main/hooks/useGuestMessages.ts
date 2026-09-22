import type { GuestContextMenuReport, GuestWindowRequest } from '@internal/multi-mind';
import type { GuestBounds } from '@internal/tauri-api';
import {
  CLICKED_MESSAGE,
  CTRL_ENTER_MESSAGE,
  decideGuestWindow,
  MENU_MESSAGE_PREFIX,
  OPEN_MESSAGE_PREFIX,
  parsePrefixedMessage,
} from '@internal/multi-mind';
import { appApi, openExternal } from '@internal/tauri-api';
import { useCallback, useEffect } from 'react';
import { useGuestContextMenu } from './useGuestContextMenu';

export interface UseGuestMessagesOptions {
  /** Where each pane sits, for placing the right-click menu. */
  boundsOf: (websiteId: string) => GuestBounds | null;
  /** A press inside a browser, which collapses the prompt box. */
  onClicked: () => void;
}

/**
 * Everything an embedded site says to the app.
 *
 * Port of `webView2_WebMessageReceived`, by way of the Electron port's
 * `ipc-message` handler. The original also took an `__inputChange__` message
 * carrying whatever had been typed into the site's own compose box, and
 * mirrored it into the prompt box; that mirror has been removed.
 *
 * Two of the four kinds are new here, and neither is a new feature: Electron
 * answered a `window.open` and a right-click in its main process, and Tauri has
 * no hook for either, so the guest reports them and the window decides — with
 * the same functions, `decideGuestWindow` and `buildContextMenuModel`, that
 * decided them before.
 */
export function useGuestMessages({ boundsOf, onClicked }: UseGuestMessagesOptions): void {
  const showContextMenu = useGuestContextMenu({ boundsOf });

  const handleOpenRequest = useCallback((message: string) => {
    const request = parsePrefixedMessage<GuestWindowRequest>(
      message,
      OPEN_MESSAGE_PREFIX,
    );

    if (request === null) {
      return;
    }

    const decision = decideGuestWindow(request);

    if (decision === 'external') {
      openExternal(request.url).catch(console.error);
      return;
    }

    if (decision === 'popup') {
      // A sign-in flow, or something that could not be classified; either way
      // it belongs in the app, the way WebView2 would have opened it, sharing
      // the profile so the session it authorises is the one the panes use.
      appApi.guest.openPopup(request.url).catch(console.error);
    }
  }, []);

  const handleMenuRequest = useCallback(
    (websiteId: string, message: string) => {
      const report = parsePrefixedMessage<GuestContextMenuReport>(
        message,
        MENU_MESSAGE_PREFIX,
      );

      if (report === null) {
        return;
      }

      showContextMenu(websiteId, report).catch((error: unknown) => {
        console.error('Failed to show the right-click menu:', error);
      });
    },
    [showContextMenu],
  );

  const handleMessage = useCallback(
    ({ websiteId, message }: { websiteId: string; message: string }) => {
      if (message === CLICKED_MESSAGE) {
        onClicked();
        return;
      }

      // The WinForms handler for Ctrl+Enter inside a page was commented out,
      // and fell through to a parse that would throw. Ignoring it keeps the
      // original behaviour without the crash.
      if (message === CTRL_ENTER_MESSAGE) {
        return;
      }

      if (message.startsWith(OPEN_MESSAGE_PREFIX)) {
        handleOpenRequest(message);
        return;
      }

      if (message.startsWith(MENU_MESSAGE_PREFIX)) {
        handleMenuRequest(websiteId, message);
        return;
      }

      console.error('Unexpected message from an embedded browser:', message);
    },
    [handleMenuRequest, handleOpenRequest, onClicked],
  );

  useEffect(() => appApi.events.onGuestMessage(handleMessage), [handleMessage]);
}
