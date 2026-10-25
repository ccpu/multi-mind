import type { AiResponseCompleted, ResponseReport } from '@internal/multi-mind';
import { DEFAULT_WEBSITES } from '@internal/multi-mind';
import { toast } from '@pixpilot/shadcn-ui';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiResponseCompleted } from '../src/windows/main/response-completion/hooks/use-ai-response-completed';
import { useAiResponseTracking } from '../src/windows/main/response-completion/hooks/use-ai-response-tracking';
import { useResponseCompletionToast } from '../src/windows/main/response-completion/hooks/use-response-completion-toast';
import { responseTracker } from '../src/windows/main/response-completion/response-events';

vi.mock('@pixpilot/shadcn-ui', () => ({ toast: { success: vi.fn() } }));
const website = DEFAULT_WEBSITES.find((site) => site.id === 'chatgpt')!;
const report: ResponseReport = {
  attemptId: 'attempt',
  status: 'completed',
  responseId: 'answer',
  url: 'https://chatgpt.com/c/one',
};

beforeEach(() => {
  responseTracker.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('completion subscriptions', () => {
  it('keeps existing subscribers connected when the development event module reloads', async () => {
    vi.stubEnv('DEV', true);
    const first = await import('../src/windows/main/response-completion/response-events');
    const listener = vi.fn();
    const stop = first.onAiResponseCompleted(listener);
    try {
      vi.resetModules();
      const reloaded =
        await import('../src/windows/main/response-completion/response-events');
      reloaded.responseTracker.begin(website.id, report.attemptId, website.url);
      reloaded.responseTracker.accept(website.id, report);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });
  it('uses the latest callback and unsubscribes on unmount', () => {
    const first = vi.fn<(event: AiResponseCompleted) => void>();
    const second = vi.fn<(event: AiResponseCompleted) => void>();
    const { rerender, unmount } = renderHook(
      ({ listener }) => useAiResponseCompleted(listener),
      { initialProps: { listener: first } },
    );
    rerender({ listener: second });
    responseTracker.begin(website.id, report.attemptId, website.url);
    responseTracker.accept(website.id, report);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    unmount();
    responseTracker.begin(website.id, 'next', website.url);
    responseTracker.accept(website.id, { ...report, attemptId: 'next' });
    expect(second).toHaveBeenCalledOnce();
  });

  it('delivers toasts in either mode while the development guard is disabled', () => {
    vi.stubEnv('DEV', true);
    const { unmount } = renderHook(() => useResponseCompletionToast([website]));
    responseTracker.begin(website.id, report.attemptId, website.url);
    responseTracker.accept(website.id, report);
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'chatgpt finished responding' }),
    );
    unmount();
    vi.clearAllMocks();
    vi.stubEnv('DEV', false);
    renderHook(() => useResponseCompletionToast([website]));
    responseTracker.begin(website.id, 'production', website.url);
    responseTracker.accept(website.id, { ...report, attemptId: 'production' });
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'chatgpt finished responding' }),
    );
  });

  it('ignores stale reports, publishes once, and cancels closed providers', () => {
    const listener = vi.fn();
    const { result, rerender } = renderHook(
      ({ websites }) => {
        useAiResponseCompleted(listener);
        return useAiResponseTracking(websites);
      },
      { initialProps: { websites: [website] } },
    );
    act(() => {
      result.current.begin(website, 'old');
      result.current.begin(website, report.attemptId);
      result.current.report(website.id, {
        ...report,
        status: 'observing',
        reason: 'armed',
      });
      result.current.report(website.id, { ...report, attemptId: 'old' });
      result.current.report(website.id, { ...report, url: 'https://other.test/' });
    });
    expect(listener).not.toHaveBeenCalled();
    act(() => {
      result.current.report(website.id, report);
      result.current.report(website.id, report);
    });
    expect(listener).toHaveBeenCalledOnce();
    act(() => result.current.begin(website, 'closed'));
    rerender({ websites: [] });
    act(() => result.current.report(website.id, { ...report, attemptId: 'closed' }));
    expect(listener).toHaveBeenCalledOnce();
  });
});
