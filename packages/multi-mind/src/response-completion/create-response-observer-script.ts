import type { GuestGlobals } from '../messages';
import type { WebsiteInfo } from '../websites';
import type { ResponseObserverOptions } from './observe-response';
import type { ResponseProvider } from './types';
import { observeResponse } from './observe-response';
import { RESPONSE_MESSAGE_PREFIX } from './types';

const OBSERVATION_TIMEOUT_MS = 900_000;

/** Builds the observer expression used immediately before clicking a site's Send button. */
export function createResponseObserverScript(
  website: WebsiteInfo,
  prompt: string,
  globals: GuestGlobals,
  attemptId: string,
): string {
  const options: ResponseObserverOptions = {
    bridgeKey: globals.bridgeKey,
    runtimeKey: `${globals.findKey}_response`,
    attemptId,
    prompt,
    prefix: RESPONSE_MESSAGE_PREFIX,
    settleMs: 1500,
    timeoutMs: OBSERVATION_TIMEOUT_MS,
    startUrl: website.url,
  };
  const selectors = website.responseSelectors;
  const configured =
    selectors.responseSelector.trim() &&
    selectors.turnSelector.trim() &&
    selectors.busySelector.trim() &&
    selectors.completeSelector.trim();
  let provider: ResponseProvider | null = null;
  try {
    if (configured) {
      provider = { ...selectors, origins: [new URL(website.url).origin] };
    }
  } catch {
    // Treat an unfinished settings URL as unsupported, preserving other sends.
  }
  return `(${observeResponse.toString()})(${JSON.stringify(provider)}, ${JSON.stringify(options)})`;
}
