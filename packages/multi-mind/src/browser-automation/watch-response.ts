/* eslint-disable no-await-in-loop -- Sequential polling prevents overlapping snapshots. */
import type { ResponseReport } from '../response-completion/types';
import type { BrowserBackend, BrowserPromptRequest, BrowserSnapshot } from './types';
import { waitForBrowserPoll } from './wait-for-browser-poll';

const OBSERVATION_TIMEOUT_MS = 900_000;
const POLL_INTERVAL_MS = 750;
const SETTLE_MS = 1500;

/** Checks completion in the host; polling exists only while this attempt is pending. */
export async function watchResponse(
  request: BrowserPromptRequest,
  baseline: BrowserSnapshot,
  backend: BrowserBackend,
  report: (report: ResponseReport) => void,
  signal: AbortSignal,
): Promise<void> {
  const startedAt = Date.now();
  let boundUrl = baseline.url;
  let mayBind = new URL(boundUrl).pathname === new URL(request.website.url).pathname;
  let sawBusy = false;
  let previous = '';
  let settledAt = 0;
  let snapshotFailures = 0;
  const post = (
    status: ResponseReport['status'],
    snapshot: BrowserSnapshot,
    reason: string,
  ) =>
    report({
      attemptId: request.attemptId,
      status,
      responseId: snapshot.responseId,
      url: snapshot.url,
      reason,
    });
  const selectors = request.website.responseSelectors;
  if (
    ![
      selectors.responseSelector,
      selectors.turnSelector,
      selectors.busySelector,
      selectors.completeSelector,
    ].every((selector) => selector.trim() !== '')
  ) {
    post('unknown', baseline, 'missing-response-configuration');
    return;
  }
  post('observing', baseline, 'host-polling');
  try {
    while (!signal.aborted && Date.now() - startedAt < OBSERVATION_TIMEOUT_MS) {
      await waitForBrowserPoll(POLL_INTERVAL_MS, signal);
      if (signal.aborted) break;
      let next: BrowserSnapshot;
      try {
        next = await backend.snapshot();
        snapshotFailures = 0;
      } catch {
        snapshotFailures += 1;
        settledAt = 0;
        const maximumSnapshotFailures = 3;
        if (snapshotFailures >= maximumSnapshotFailures)
          throw new Error('Snapshot failed repeatedly.');
        continue;
      }
      if (signal.aborted) break;
      if (
        new URL(next.url).origin !== new URL(baseline.url).origin ||
        (!mayBind && next.url !== boundUrl)
      ) {
        post('cancelled', next, 'navigation');
        return;
      }
      if (next.error !== '' && next.error !== baseline.error) {
        post('failed', next, 'page-error');
        return;
      }
      sawBusy ||= next.busy;
      const hasUserSelector =
        (request.website.responseSelectors.userSelector ?? '').trim() !== '';
      if (hasUserSelector && next.userCount > baseline.userCount + 1) {
        post('cancelled', next, 'another-user-message');
        return;
      }
      const accepted = hasUserSelector
        ? next.userCount === baseline.userCount + 1 && next.userMatches
        : sawBusy;
      const newResponse = next.responseCount > baseline.responseCount;
      if (accepted && newResponse) {
        if (next.url !== boundUrl) {
          boundUrl = next.url;
          mayBind = false;
        }
        post('generating', next, 'new-response');
      }
      const identity = `${next.responseId}:${next.fingerprint}`;
      if (identity !== previous) {
        previous = identity;
        settledAt = 0;
      }
      if (!accepted || !newResponse || !next.hasText || next.busy || !next.complete) {
        settledAt = 0;
        continue;
      }
      settledAt ||= Date.now();
      if (Date.now() - settledAt >= SETTLE_MS) {
        post('completed', next, 'provider-ui');
        return;
      }
    }
    post(
      signal.aborted ? 'cancelled' : 'unknown',
      baseline,
      signal.aborted ? 'cancelled' : 'timeout',
    );
  } catch {
    post(signal.aborted ? 'cancelled' : 'unknown', baseline, 'snapshot-failed');
  }
}
