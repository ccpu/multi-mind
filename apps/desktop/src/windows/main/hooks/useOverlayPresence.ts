import { appApi } from '@internal/tauri-api';
import { useEffect, useState } from 'react';
import { measureOverlays } from '../utils/browser-overlays/measure-overlays';

export { clearOfBrowsers } from '../utils/browser-overlays/measure-overlays';

/** Keeps floating UI above live Windows browsers; returns whether a fallback must hide them. */
export function useOverlayPresence(): boolean {
  const [fallbackOpen, setFallbackOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let frame: number | null = null;
    let sending = false;
    let lastSent = '';
    let latest = measureOverlays();
    let latestKey = JSON.stringify(latest);

    const flush = async () => {
      if (sending || cancelled || latestKey === lastSent) {
        return;
      }
      sending = true;
      const layout = latest;
      const key = latestKey;
      lastSent = key;
      try {
        const clipped = await appApi.guest.setOverlays(layout.overlays, layout.modal);
        if (!cancelled && key === latestKey) {
          setFallbackOpen(layout.open && !clipped);
        }
      } catch (error) {
        console.error('Failed to position browser overlays:', error);
        if (!cancelled && key === latestKey) {
          setFallbackOpen(layout.open);
        }
      } finally {
        sending = false;
        if (!cancelled && latestKey !== key) {
          void flush();
        }
      }
    };

    const check = () => {
      latest = measureOverlays();
      latestKey = JSON.stringify(latest);
      void flush();
      // Transforms move toasts/popovers without resizing their DOM boxes.
      if (latest.open && frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          check();
        });
      }
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener('resize', check);
    document.addEventListener('scroll', check, true);
    check();

    return () => {
      cancelled = true;
      observer.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener('resize', check);
      document.removeEventListener('scroll', check, true);
      appApi.guest.setOverlays([], false).catch((error: unknown) => {
        console.error('Failed to restore browser regions:', error);
      });
    };
  }, []);

  return fallbackOpen;
}
