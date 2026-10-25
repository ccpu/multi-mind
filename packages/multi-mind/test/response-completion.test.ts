import type { ResponseReport } from '../src/response-completion';
import { describe, expect, it, vi } from 'vitest';
import {
  createResponseTracker,
  parseResponseReport,
  RESPONSE_MESSAGE_PREFIX,
} from '../src/response-completion';

const report: ResponseReport = {
  attemptId: 'attempt-1',
  status: 'completed',
  responseId: 'answer-1',
  url: 'https://chatgpt.com/c/one',
};

describe('response completion tracker', () => {
  it('leaves invalid settings URLs untracked without throwing', () => {
    const tracker = createResponseTracker();
    expect(() => tracker.begin('custom', 'attempt', 'invalid url')).not.toThrow();
  });
  it('announces a matching completion once, including the provider and attempt', () => {
    const tracker = createResponseTracker();
    const listener = vi.fn();
    tracker.subscribe(listener);
    tracker.begin('chatgpt', report.attemptId, 'https://chatgpt.com/');
    tracker.accept('chatgpt', { ...report, status: 'generating' });
    tracker.accept('chatgpt', { ...report, status: 'observing', reason: 'settling' });
    expect(listener).not.toHaveBeenCalled();
    tracker.accept('chatgpt', report);
    tracker.accept('chatgpt', report);
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      attemptId: report.attemptId,
      responseId: report.responseId,
      url: report.url,
      websiteId: 'chatgpt',
      completedAt: expect.any(Number),
      evidence: 'provider-ui',
    });
  });

  it('rejects stale attempts, other panes and unexpected origins', () => {
    const tracker = createResponseTracker();
    const listener = vi.fn();
    tracker.subscribe(listener);
    tracker.begin('chatgpt', 'new-attempt', report.url);
    tracker.accept('chatgpt', report);
    tracker.accept('claude', { ...report, attemptId: 'new-attempt' });
    tracker.accept('chatgpt', {
      ...report,
      attemptId: 'new-attempt',
      url: 'https://evil.test/',
    });
    expect(listener).not.toHaveBeenCalled();
    tracker.accept('chatgpt', { ...report, attemptId: 'new-attempt' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it.each(['cancelled', 'failed', 'unknown'] as const)(
    'never treats %s as completion',
    (status) => {
      const tracker = createResponseTracker();
      const listener = vi.fn();
      tracker.subscribe(listener);
      tracker.begin('chatgpt', report.attemptId, report.url);
      tracker.accept('chatgpt', { ...report, status });
      tracker.accept('chatgpt', report);
      expect(listener).not.toHaveBeenCalled();
    },
  );

  it('cancels pending work and disposes listeners', () => {
    const tracker = createResponseTracker();
    const listener = vi.fn();
    const stop = tracker.subscribe(listener);
    tracker.begin('chatgpt', report.attemptId, report.url);
    tracker.cancel('chatgpt');
    tracker.accept('chatgpt', report);
    tracker.begin('chatgpt', report.attemptId, report.url);
    stop();
    tracker.accept('chatgpt', report);
    expect(listener).not.toHaveBeenCalled();
  });

  it('allows a completion subscriber to immediately start another attempt', () => {
    const tracker = createResponseTracker();
    const listener = vi.fn(() => tracker.begin('chatgpt', 'next', report.url));
    tracker.subscribe(listener);
    tracker.begin('chatgpt', report.attemptId, report.url);
    tracker.accept('chatgpt', report);
    tracker.accept('chatgpt', { ...report, attemptId: 'next' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('page report validation', () => {
  it('accepts a valid report', () => {
    expect(parseResponseReport(RESPONSE_MESSAGE_PREFIX + JSON.stringify(report))).toEqual(
      report,
    );
  });
  it.each([
    null,
    [],
    {},
    { ...report, attemptId: '' },
    { ...report, responseId: '' },
    { ...report, status: 'timeout' },
    { ...report, status: ['completed'] },
    { ...report, url: 'file:///private' },
  ])('rejects malformed reports: %j', (value) => {
    expect(
      parseResponseReport(RESPONSE_MESSAGE_PREFIX + JSON.stringify(value)),
    ).toBeNull();
  });
  it('rejects invalid JSON and oversized messages', () => {
    expect(parseResponseReport(`${RESPONSE_MESSAGE_PREFIX}{`)).toBeNull();
    expect(parseResponseReport(RESPONSE_MESSAGE_PREFIX + ' '.repeat(9000))).toBeNull();
  });
});
