import type { GuestBounds } from '@internal/tauri-api';

const OVERLAY_SELECTOR = [
  '[data-radix-popper-content-wrapper]',
  '[data-slot="dialog-content"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[data-sonner-toast]',
].join(',');
const CLEAR_SELECTOR = '[data-clear-of-browsers]';

/** Marks floating content placed entirely outside the browser row. */
export const clearOfBrowsers = { 'data-clear-of-browsers': '' } as const;

/** Measures visible overlay content, excluding full-window modal backdrops. */
export function measureOverlays(): {
  overlays: GuestBounds[];
  modal: boolean;
  open: boolean;
} {
  const elements = Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).filter(
    (element) =>
      !element.matches(CLEAR_SELECTOR) && element.querySelector(CLEAR_SELECTOR) === null,
  );
  const overlays = elements.flatMap((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    if (width <= 0 || height <= 0 || getComputedStyle(element).visibility === 'hidden') {
      return [];
    }
    // Round outward to avoid subpixel browser edges showing through the overlay.
    const left = Math.floor(x);
    const top = Math.floor(y);
    return [
      {
        x: left,
        y: top,
        width: Math.ceil(x + width) - left,
        height: Math.ceil(y + height) - top,
      },
    ];
  });
  return {
    overlays,
    modal:
      document.body.style.pointerEvents === 'none' ||
      document.querySelector('[data-slot="dialog-overlay"], [aria-modal="true"]') !==
        null,
    open: elements.length > 0,
  };
}
