import type { AiResponseCompleted, ResponseReport, ResponseTracker } from './types';

/** Correlates page evidence with host-owned attempts and publishes completion once. */
export function createResponseTracker(): ResponseTracker {
  const pending = new Map<string, { attemptId: string; origin: string }>();
  const listeners = new Set<(event: AiResponseCompleted) => void>();

  return {
    begin(websiteId: string, attemptId: string, url: string) {
      pending.delete(websiteId);
      try {
        pending.set(websiteId, { attemptId, origin: new URL(url).origin });
      } catch {
        // An unfinished URL in settings must not interrupt sends to other sites.
      }
    },
    cancel(websiteId: string) {
      pending.delete(websiteId);
    },
    clear() {
      pending.clear();
    },
    accept(websiteId: string, report: ResponseReport) {
      const current = pending.get(websiteId);
      if (current?.attemptId !== report.attemptId) {
        return;
      }
      try {
        if (new URL(report.url).origin !== current.origin) {
          return;
        }
      } catch {
        return;
      }
      if (report.status === 'generating' || report.status === 'observing') {
        return;
      }
      pending.delete(websiteId);
      if (report.status !== 'completed') {
        return;
      }
      const event: AiResponseCompleted = {
        websiteId,
        attemptId: report.attemptId,
        responseId: report.responseId,
        url: report.url,
        completedAt: Date.now(),
        evidence: 'provider-ui',
      };
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error('Response completion listener failed:', error);
        }
      }
    },
    subscribe(listener: (event: AiResponseCompleted) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
