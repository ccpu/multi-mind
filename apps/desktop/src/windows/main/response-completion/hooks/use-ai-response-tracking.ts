import type { ResponseReport, WebsiteInfo } from '@internal/multi-mind';
import { useCallback, useEffect, useRef } from 'react';
import { responseTracker } from '../response-events';

interface AiResponseTracking {
  begin: (website: WebsiteInfo, attemptId: string) => void;
  cancel: (websiteId: string) => void;
  report: (websiteId: string, value: ResponseReport) => void;
}

const HOST_TIMEOUT_MS = 960_000;

function trace(websiteId: string, status: string, reason = ''): void {
  // eslint-disable-next-line no-console -- Diagnose missing completion events without logging prompt or answer content.
  console.debug('[AI response]', websiteId, status, reason);
}

/** Owns host-side attempt lifetimes; mount once in the main window. */
export function useAiResponseTracking(
  websites: readonly WebsiteInfo[],
): AiResponseTracking {
  const attemptsRef = useRef(
    new Map<
      string,
      { attemptId: string; origin: string; timer: ReturnType<typeof setTimeout> }
    >(),
  );
  const cancel = useCallback((websiteId: string) => {
    clearTimeout(attemptsRef.current.get(websiteId)?.timer);
    attemptsRef.current.delete(websiteId);
    responseTracker.cancel(websiteId);
  }, []);
  const begin = useCallback(
    (website: WebsiteInfo, attemptId: string) => {
      cancel(website.id);
      let origin: string;
      try {
        origin = new URL(website.url).origin;
      } catch {
        return;
      }
      responseTracker.begin(website.id, attemptId, website.url);
      trace(website.id, 'submitted');
      const timer = setTimeout(cancel, HOST_TIMEOUT_MS, website.id);
      attemptsRef.current.set(website.id, {
        attemptId,
        origin,
        timer,
      });
    },
    [cancel],
  );
  const report = useCallback((websiteId: string, value: ResponseReport) => {
    trace(websiteId, value.status, value.reason ?? '');
    const attempt = attemptsRef.current.get(websiteId);
    if (attempt?.attemptId !== value.attemptId) {
      return;
    }
    try {
      if (new URL(value.url).origin !== attempt.origin) {
        return;
      }
    } catch {
      return;
    }
    // Clear before dispatch: a subscriber may immediately start another attempt.
    if (value.status !== 'generating' && value.status !== 'observing') {
      clearTimeout(attemptsRef.current.get(websiteId)?.timer);
      attemptsRef.current.delete(websiteId);
    }
    responseTracker.accept(websiteId, value);
  }, []);
  useEffect(() => {
    const active = new Set(websites.map((website) => website.id));
    for (const websiteId of attemptsRef.current.keys()) {
      if (!active.has(websiteId)) {
        cancel(websiteId);
      }
    }
  }, [websites, cancel]);
  useEffect(() => {
    const pending = attemptsRef.current;
    return () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
      }
      pending.clear();
      responseTracker.clear();
    };
  }, []);
  return { begin, cancel, report };
}
