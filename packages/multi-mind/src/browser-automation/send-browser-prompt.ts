/* eslint-disable no-await-in-loop -- Retries must be sequential to avoid filling or clicking twice. */
import type { GuestPromptError } from '../messages';
import type { ResponseReport } from '../response-completion/types';
import type { BrowserBackend, BrowserPromptRequest } from './types';
import { waitForBrowserPoll } from './wait-for-browser-poll';
import { watchResponse } from './watch-response';

const ACTION_TIMEOUT_MS = 4000;
const RETRY_INTERVAL_MS = 200;

/** Sends once through an OS backend; retries and response state stay in the host. */
export async function sendBrowserPrompt(
  request: BrowserPromptRequest,
  backend: BrowserBackend,
  report: (report: ResponseReport) => void,
  onError: (error: GuestPromptError) => void,
  signal: AbortSignal,
): Promise<void> {
  const { website, prompt, attemptId } = request;
  const ensure = async (
    kind: GuestPromptError['kind'],
    selector: string,
    action: () => Promise<boolean>,
  ) => {
    const deadline = Date.now() + ACTION_TIMEOUT_MS;
    do {
      signal.throwIfAborted();
      if (await action()) {
        signal.throwIfAborted();
        return;
      }
      await waitForBrowserPoll(RETRY_INTERVAL_MS, signal);
    } while (Date.now() < deadline);
    onError({ attemptId, kind, selector });
    throw new Error(`Unable to use ${kind} selector: ${selector}`);
  };
  const initial = await backend.snapshot();
  signal.throwIfAborted();
  if (new URL(initial.url).origin !== new URL(website.url).origin) {
    onError({ attemptId, kind: 'input', selector: website.inputSelector });
    throw new Error('The browser is on a different origin; sign in before sending.');
  }
  if (initial.busy) throw new Error('This site is already generating a response.');
  await ensure('insert', website.inputSelector, async () =>
    backend.fill(website.inputSelector, prompt),
  );
  const baseline = await backend.snapshot();
  signal.throwIfAborted();
  if (baseline.busy || new URL(baseline.url).origin !== new URL(initial.url).origin) {
    throw new Error('The page changed before the prompt could be sent.');
  }
  await ensure('button', website.buttonSelector, async () =>
    backend.click(website.buttonSelector),
  );
  void watchResponse(request, baseline, backend, report, signal);
}
