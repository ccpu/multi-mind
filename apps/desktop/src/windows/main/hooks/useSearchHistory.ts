import type { GuestPageReport } from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { useCallback, useRef } from 'react';

/** Links submitted prompts to subsequent page metadata in this window. */
export interface UseSearchHistoryResult {
  /**
   * Reserves submission order on every targeted provider, then returns a saver
   * to call once a provider accepts the script. The prompt is saved once, on
   * the first provider that accepts it, and each provider becomes one of its
   * conversations.
   */
  recordPrompt: (
    prompt: string,
    websiteIds: readonly string[],
  ) => (websiteId: string) => Promise<void>;
  reportPage: (websiteId: string, page: GuestPageReport) => void;
  stopTracking: (websiteId: string) => void;
}

export function useSearchHistory(): UseSearchHistoryResult {
  /** The conversation each provider's page reports belong to. */
  const latestIdsRef = useRef(new Map<string, number>());
  const latestPagesRef = useRef(new Map<string, GuestPageReport>());
  const versionsRef = useRef(new Map<string, number>());
  const updatesRef = useRef(new Map<string, Promise<void>>());

  const updatePage = useCallback(
    async (websiteId: string, id: number, page: GuestPageReport) => {
      const previous = updatesRef.current.get(websiteId) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(async () =>
          appApi.invoke.searchUpdateConversation(id, page.title, page.url),
        );
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
    (prompt: string, websiteIds: readonly string[]) => {
      const versions = new Map<string, number>();
      for (const websiteId of websiteIds) {
        const version = (versionsRef.current.get(websiteId) ?? 0) + 1;
        versionsRef.current.set(websiteId, version);
        versions.set(websiteId, version);
      }

      let promptId: Promise<number> | undefined;
      return async (websiteId: string) => {
        promptId ??= appApi.invoke.searchAddPrompt(prompt);
        const id = await appApi.invoke.searchAddConversation(await promptId, websiteId);
        if (versionsRef.current.get(websiteId) !== versions.get(websiteId)) {
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
