import { useEffect, useState } from 'react';

/**
 * Whatever the app draws over the browser row, a popover or a dialog, portals
 * itself to the end of the document. These are the shapes it lands in.
 */
const OVERLAY_SELECTOR = [
  '[data-radix-popper-content-wrapper]',
  '[data-slot="dialog-overlay"]',
  '[role="dialog"]',
  '[role="menu"]',
].join(',');

/**
 * Marks floating content placed so that it never reaches the browser row, and
 * so can show without the browsers being taken out of the way.
 */
const CLEAR_OF_BROWSERS_ATTRIBUTE = 'data-clear-of-browsers';

const CLEAR_OF_BROWSERS_SELECTOR = `[${CLEAR_OF_BROWSERS_ATTRIBUTE}]`;

/** Spread onto floating content that stays clear of the browsers. */
export const clearOfBrowsers = { [CLEAR_OF_BROWSERS_ATTRIBUTE]: '' } as const;

function coversBrowsers(overlay: Element): boolean {
  return (
    !overlay.matches(CLEAR_OF_BROWSERS_SELECTOR) &&
    overlay.querySelector(CLEAR_OF_BROWSERS_SELECTOR) === null
  );
}

/**
 * Whether anything is currently floating over the window.
 *
 * An embedded browser is a native child webview, which means it is drawn over
 * the page rather than in it — there is no z-index that puts a popover in front
 * of one. Electron had the same rule for a `<webview>` and the same answer for
 * it: take the browsers out of the way while something is over them.
 *
 * It is watched rather than wired, so the components that came over from the
 * Electron port did not have to learn about it. The cost of the watch being
 * wrong is a popover hidden for a moment, never a broken window.
 */
export function useOverlayPresence(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const check = () =>
      setOpen(
        Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some(coversBrowsers),
      );

    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();

    return () => observer.disconnect();
  }, []);

  return open;
}
