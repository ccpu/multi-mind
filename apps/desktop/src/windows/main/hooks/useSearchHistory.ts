import type { GuestPageReport } from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { useCallback, useRef } from 'react';

/** Links submitted prompts to subsequent page metadata in this window. */
export interface UseSearchHistoryResult {
  /** Reserves submission order, then saves after the guest accepts the script. */
  recordPrompt: (websiteId: string, prompt: string) => () => Promise<void>;
  reportPage: (websiteId: string, page: GuestPageReport) => void;
  stopTracking: (websiteId: string) => void;
}

export function useSearchHistory(): UseSearchHistoryResult {
  const latestIdsRef = useRef(new Map<string, number>());
  const latestPagesRef = useRef(new Map<string, GuestPageReport>());
  const versionsRef = useRef(new Map<string, number>());
  const updatesRef = useRef(new Map<string, Promise<void>>());

  const updatePage = useCallback(
    async (websiteId: string, id: number, page: GuestPageReport) => {
      const previous = updatesRef.current.get(websiteId) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(async () => appApi.invoke.searchUpdatePrompt(id, page.title, page.url));
      updatesRef.current.set(websiteId, next);
      return next;
    },
    [],
  );

  const reportPage = useCallback(
    (websiteId: string, page: GuestPageReport) => {
      if (!/^https?:\/\//iu.test(page.url)) {
        return;
      }
      latestPagesRef.current.set(websiteId, page);
      const id = latestIdsRef.current.get(websiteId);
      if (id !== undefined) {
        updatePage(websiteId, id, page).catch((error: unknown) => {
          console.error('Failed to update prompt search history:', error);
        });
      }
    },
    [updatePage],
  );

  const recordPrompt = useCallback(
    (websiteId: string, prompt: string) => {
      const version = (versionsRef.current.get(websiteId) ?? 0) + 1;
      versionsRef.current.set(websiteId, version);
      return async () => {
        const id = await appApi.invoke.searchAddPrompt(websiteId, prompt);
        if (versionsRef.current.get(websiteId) !== version) {
          return;
        }
        latestIdsRef.current.set(websiteId, id);
        const page = latestPagesRef.current.get(websiteId);
        if (page !== undefined) {
          await updatePage(websiteId, id, page);
        }
      };
    },
    [updatePage],
  );

  const stopTracking = useCallback((websiteId: string) => {
    versionsRef.current.set(websiteId, (versionsRef.current.get(websiteId) ?? 0) + 1);
    latestIdsRef.current.delete(websiteId);
    latestPagesRef.current.delete(websiteId);
  }, []);

  return { recordPrompt, reportPage, stopTracking };
}
