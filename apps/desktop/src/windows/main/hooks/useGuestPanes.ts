import type { GuestConfig, WebsiteInfo } from '@internal/multi-mind';
import type { GuestBounds, GuestPane } from '@internal/tauri-api';
import { createGuestScripts } from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export interface UseGuestPanesResult {
  /** Hand each pane's box to the hook; null when it unmounts. */
  register: (websiteId: string, element: HTMLDivElement | null) => void;
  /** Where a pane sits right now, for turning a guest click into a window point. */
  boundsOf: (websiteId: string) => GuestBounds | null;
  /** Navigates now, or after the site's pane has been created. */
  openUrl: (websiteId: string, url: string) => void;
}

function readBounds(element: HTMLElement): GuestBounds {
  const { x, y, width, height } = element.getBoundingClientRect();

  return { x, y, width, height };
}

/**
 * Keeps the embedded browsers where the layout says they should be.
 *
 * This is the one place the Tauri port really parts company with the Electron
 * one. There, a `<webview>` was an element: React put it in the tree, Split.js
 * sized it, and that was the whole story. A Tauri guest is a child webview the
 * Rust side owns, drawn over the window in window coordinates and knowing
 * nothing about the page underneath it.
 *
 * So the page keeps the layout — the same flex row, the same Split.js, the same
 * gutters — but what it lays out is an empty box per site. Its measurements go
 * to Rust, which puts the real browser exactly there. Everything the user
 * touches is still decided by CSS; only the last step is not.
 *
 * Measurements are sent as one list rather than one change at a time, because
 * opening a site, closing one and dragging a divider are all the same layout
 * pass, and reconciling from a complete picture is what stops them racing.
 */
export function useGuestPanes(
  websites: readonly WebsiteInfo[],
  guestConfig: GuestConfig | null,
): UseGuestPanesResult {
  const elements = useRef(new Map<string, HTMLDivElement>());
  const lastPayload = useRef('');
  const pendingUrlsRef = useRef(new Map<string, string>());

  /*
   * The sites whose scripts Rust already holds.
   *
   * A pane's scripts are some kilobytes of source, they are the same on every
   * pass, and Rust only ever reads them when it builds the webview. Sending
   * them in each layout pass meant building and serialising all of that on
   * every frame of a divider drag, which is the one moment the app can least
   * afford it. So they go once per site and Rust keeps them; a site switched
   * off drops out of this set with its browser, and sends them again if it
   * comes back.
   */
  const sentScripts = useRef(new Set<string>());

  // Read inside a callback that must stay referentially stable, so registering
  // a box never re-runs the observers.
  const websitesRef = useRef(websites);
  const guestConfigRef = useRef(guestConfig);
  websitesRef.current = websites;
  guestConfigRef.current = guestConfig;

  const sync = useCallback(() => {
    const config = guestConfigRef.current;

    if (config === null) {
      return;
    }

    const panes = websitesRef.current.reduce<GuestPane[]>((open, website) => {
      const element = elements.current.get(website.id);

      // A site switched on this render has no box until the DOM is there; the
      // layout effect that follows the commit picks it up.
      if (element === undefined) {
        return open;
      }

      open.push({
        websiteId: website.id,
        url: website.url,
        bounds: readBounds(element),
        scripts: sentScripts.current.has(website.id)
          ? []
          : createGuestScripts(website, config),
      });

      return open;
    }, []);

    // A site that has gone has taken Rust's copy of its scripts with it.
    const open = new Set(panes.map((pane) => pane.websiteId));

    for (const websiteId of sentScripts.current) {
      if (!open.has(websiteId)) {
        sentScripts.current.delete(websiteId);
      }
    }

    // A pane's box is remeasured on every render and on every resize, and is
    // usually the same box. Only a real move is worth a trip into Rust.
    const payload = JSON.stringify(
      panes.map((pane) => [pane.websiteId, pane.url, pane.bounds]),
    );

    if (payload === lastPayload.current) {
      return;
    }

    lastPayload.current = payload;

    appApi.guest.sync(panes).then(
      () => {
        for (const pane of panes) {
          sentScripts.current.add(pane.websiteId);
          const url = pendingUrlsRef.current.get(pane.websiteId);
          if (url !== undefined) {
            appApi.guest.navigate(pane.websiteId, url).then(
              () => {
                if (pendingUrlsRef.current.get(pane.websiteId) === url) {
                  pendingUrlsRef.current.delete(pane.websiteId);
                }
              },
              (error: unknown) =>
                console.error('Failed to open saved conversation:', error),
            );
          }
        }
      },
      (error: unknown) => {
        // The scripts went unrecorded, so the next pass sends them again --
        // which is what a failed layout needs.
        console.error('Failed to lay out the embedded browsers:', error);
      },
    );
  }, []);

  const register = useCallback(
    (websiteId: string, element: HTMLDivElement | null) => {
      if (element === null) {
        elements.current.delete(websiteId);
      } else {
        elements.current.set(websiteId, element);
      }

      sync();
    },
    [sync],
  );

  const boundsOf = useCallback((websiteId: string): GuestBounds | null => {
    const element = elements.current.get(websiteId);

    return element === undefined ? null : readBounds(element);
  }, []);

  const openUrl = useCallback((websiteId: string, url: string) => {
    pendingUrlsRef.current.set(websiteId, url);
    if (sentScripts.current.has(websiteId)) {
      appApi.guest.navigate(websiteId, url).then(
        () => {
          if (pendingUrlsRef.current.get(websiteId) === url) {
            pendingUrlsRef.current.delete(websiteId);
          }
        },
        (error: unknown) => console.error('Failed to open saved conversation:', error),
      );
    }
  }, []);

  // Sites come and go, and the prompt panel's height changes the row above it,
  // so the boxes are remeasured after every commit rather than on a dependency
  // list that would have to name all of that. `sync` drops a measurement that
  // has not moved, so this settles without a round trip.
  useLayoutEffect(sync);

  /*
   * Dragging a Split.js gutter resizes the boxes without React hearing about
   * it, and so does the window itself. A `ResizeObserver` per box catches both,
   * which is what keeps a browser under the divider the user is dragging.
   */
  useEffect(() => {
    const observer = new ResizeObserver(sync);

    for (const element of elements.current.values()) {
      observer.observe(element);
    }

    window.addEventListener('resize', sync);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
    // Re-observed whenever the set of boxes changes, which is what the joined
    // ids stand for.
  }, [sync, websites.map((website) => website.id).join('\u0000')]);

  return { register, boundsOf, openUrl };
}
