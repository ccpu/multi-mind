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
    const check = () => setOpen(document.querySelector(OVERLAY_SELECTOR) !== null);

    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();

    return () => observer.disconnect();
  }, []);

  return open;
}
