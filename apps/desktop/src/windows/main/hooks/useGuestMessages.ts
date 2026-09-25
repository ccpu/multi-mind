import type {
  GuestContextMenuReport,
  GuestPageReport,
  GuestWindowRequest,
} from '@internal/multi-mind';
import type { GuestBounds } from '@internal/tauri-api';
import {
  CLICKED_MESSAGE,
  createPopupScripts,
  CTRL_ENTER_MESSAGE,
  decideGuestWindow,
  MENU_MESSAGE_PREFIX,
  OPEN_MESSAGE_PREFIX,
  PAGE_MESSAGE_PREFIX,
  parsePrefixedMessage,
} from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { useCallback, useEffect } from 'react';
import { useGuestContextMenu } from './useGuestContextMenu';

export interface UseGuestMessagesOptions {
  /** Where each pane sits, for placing the right-click menu. */
  boundsOf: (websiteId: string) => GuestBounds | null;
  /** A press inside a browser, which collapses the prompt box. */
  onClicked: () => void;
  onPageReported?: (websiteId: string, page: GuestPageReport) => void;
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
export function useGuestMessages({
  boundsOf,
  onClicked,
  onPageReported,
}: UseGuestMessagesOptions): void {
  const showContextMenu = useGuestContextMenu({ boundsOf });

  const handleOpenRequest = useCallback((message: string) => {
    const request = parsePrefixedMessage<GuestWindowRequest>(
      message,
      OPEN_MESSAGE_PREFIX,
    );

    if (request === null) {
      return;
    }

    if (decideGuestWindow(request) === 'popup') {
      // Everything a site opens stays here, the way WebView2 opened it, on the
      // profile the panes are signed in to — a sign-in finished in the user's
      // own browser authorises a session this app never sees. Right-click's
      // "Open Link in Browser" is the way out for a link that wants one.
      appApi.guest.openPopup(request.url, createPopupScripts()).catch(console.error);
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

      if (message.startsWith(PAGE_MESSAGE_PREFIX)) {
        const report = parsePrefixedMessage<GuestPageReport>(
          message,
          PAGE_MESSAGE_PREFIX,
        );
        if (
          report !== null &&
          typeof report.url === 'string' &&
          typeof report.title === 'string'
        ) {
          onPageReported?.(websiteId, report);
        }
        return;
      }

      console.error('Unexpected message from an embedded browser:', message);
    },
    [handleMenuRequest, handleOpenRequest, onClicked, onPageReported],
  );

  useEffect(() => appApi.events.onGuestMessage(handleMessage), [handleMessage]);
}
