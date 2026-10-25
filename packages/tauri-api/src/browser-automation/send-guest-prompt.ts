import type {
  BrowserAction,
  BrowserPromptRequest,
  BrowserSnapshot,
} from '@internal/multi-mind';
import {
  createBrowserActionScript,
  PAGE_MESSAGE_PREFIX,
  PROMPT_ERROR_MESSAGE_PREFIX,
  RESPONSE_MESSAGE_PREFIX,
  sendBrowserPrompt,
} from '@internal/multi-mind';
import { invoke } from '@tauri-apps/api/core';
import { publishGuestMessage } from './guest-message-bus';

const attempts = new Map<string, AbortController>();

/** Stops retries and response polling when a pane navigates, closes, or is superseded. */
export function cancelGuestPrompt(websiteId: string): void {
  attempts.get(websiteId)?.abort();
  attempts.delete(websiteId);
}

/** Cancels attempts whose browser panes have been removed. */
export function retainGuestPrompts(websiteIds: ReadonlySet<string>): void {
  for (const websiteId of attempts.keys()) {
    if (!websiteIds.has(websiteId)) cancelGuestPrompt(websiteId);
  }
}

/** Uses a native Windows executor or a temporary WebKit operation per action. */
export async function sendGuestPrompt(
  websiteId: string,
  request: BrowserPromptRequest,
): Promise<void> {
  cancelGuestPrompt(websiteId);
  const controller = new AbortController();
  attempts.set(websiteId, controller);
  let previousPage = '';
  let reportedError = false;
  const post = (prefix: string, payload: unknown) => {
    if (attempts.get(websiteId) === controller) {
      publishGuestMessage({ websiteId, message: prefix + JSON.stringify(payload) });
    }
  };
  controller.signal.addEventListener(
    'abort',
    () =>
      post(RESPONSE_MESSAGE_PREFIX, {
        attemptId: request.attemptId,
        status: 'cancelled',
        responseId: '',
        url: request.website.url,
        reason: 'host-cancelled',
      }),
    { once: true },
  );
  const execute = async <T>(action: BrowserAction): Promise<T> => {
    controller.signal.throwIfAborted();
    const result = await invoke<T | { failure: string }>('guest_automation', {
      websiteId,
      request: {
        action,
        fallbackScript: createBrowserActionScript(action),
        prepareScript:
          action.kind === 'fill' ? createBrowserActionScript(action, true) : null,
        expectedOrigin: new URL(request.website.url).origin,
      },
    });
    if (typeof result === 'object' && result !== null && 'failure' in result) {
      throw new Error(String(result.failure));
    }
    return result;
  };
  try {
    await sendBrowserPrompt(
      request,
      {
        fill: async (selector, text) =>
          execute<boolean>({ kind: 'fill', selector, text }),
        click: async (selector) => execute<boolean>({ kind: 'click', selector }),
        snapshot: async () => {
          const snapshot = await execute<BrowserSnapshot>({
            kind: 'snapshot',
            selectors: request.website.responseSelectors,
            prompt: request.prompt,
          });
          const page = { url: snapshot.url, title: snapshot.title };
          const serialized = JSON.stringify(page);
          if (serialized !== previousPage) {
            previousPage = serialized;
            post(PAGE_MESSAGE_PREFIX, page);
          }
          return snapshot;
        },
      },
      (report) => {
        post(RESPONSE_MESSAGE_PREFIX, report);
        if (
          !['observing', 'generating'].includes(report.status) &&
          attempts.get(websiteId) === controller
        )
          attempts.delete(websiteId);
      },
      (error) => {
        reportedError = true;
        post(PROMPT_ERROR_MESSAGE_PREFIX, error);
      },
      controller.signal,
    );
  } catch (error) {
    if (!controller.signal.aborted && !reportedError)
      post(PROMPT_ERROR_MESSAGE_PREFIX, {
        attemptId: request.attemptId,
        kind: 'insert',
        selector: request.website.inputSelector,
      });
    if (attempts.get(websiteId) === controller) attempts.delete(websiteId);
    throw error;
  }
}
