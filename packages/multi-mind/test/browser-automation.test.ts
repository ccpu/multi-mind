import type {
  BrowserBackend,
  BrowserPromptRequest,
  BrowserSnapshot,
  ResponseReport,
} from '../src';
// @vitest-environment jsdom
import { Script } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserActionScript,
  DEFAULT_WEBSITES,
  runBrowserAction,
  sendBrowserPrompt,
} from '../src';
import { watchResponse } from '../src/browser-automation/watch-response';

const website = {
  ...DEFAULT_WEBSITES.find((site) => site.id === 'chatgpt')!,
  inputSelector: '#input',
  buttonSelector: '#send',
};
const request: BrowserPromptRequest = { website, prompt: 'Hello', attemptId: 'attempt' };
const empty: BrowserSnapshot = {
  url: website.url,
  title: 'Chat',
  responseCount: 0,
  userCount: 0,
  userMatches: false,
  responseId: '',
  fingerprint: '',
  hasText: false,
  busy: false,
  complete: false,
  error: '',
};
const answer: BrowserSnapshot = {
  ...empty,
  url: 'https://chatgpt.com/c/one',
  responseCount: 1,
  userCount: 1,
  userMatches: true,
  responseId: 'answer',
  fingerprint: 'answer-v1',
  hasText: true,
  complete: true,
};
let controller: AbortController;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL(website.url));
  document.body.innerHTML = '';
  controller = new AbortController();
});
afterEach(async () => {
  controller.abort();
  await vi.advanceTimersByTimeAsync(1000);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function backend(snapshot: BrowserSnapshot = empty): BrowserBackend {
  return {
    fill: vi.fn(async () => true),
    click: vi.fn(async () => true),
    snapshot: vi.fn(async () => snapshot),
  };
}

describe('temporary WebKit operations', () => {
  it('prepares a rich editor selection in a separate operation without changing its content', () => {
    document.body.innerHTML = '<div id="input" contenteditable="true">Old draft</div>';
    expect(
      runBrowserAction({ kind: 'fill', selector: '#input', text: 'Hello' }, true),
    ).toBe(true);
    expect(window.getSelection()?.toString()).toBe('Old draft');
    expect(document.querySelector('#input')?.textContent).toBe('Old draft');
  });
  it('fills a native field with a normal input event, without installing runtime state', async () => {
    document.body.innerHTML = '<textarea id="input">Old text</textarea>';
    const input = document.querySelector('textarea')!;
    const onInput = vi.fn();
    input.addEventListener('input', onInput);
    const globals = Reflect.ownKeys(window);
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const listen = vi.spyOn(document, 'addEventListener');
    // eslint-disable-next-line no-template-curly-in-string -- Literal user input must survive script serialization.
    const text = 'Quotes: " \' ` ${value}\nNext line ☃';
    const source = createBrowserActionScript({ kind: 'fill', selector: '#input', text });
    expect(
      new Script(source).runInNewContext({
        document,
        window,
        HTMLElement,
        HTMLTextAreaElement,
        HTMLInputElement,
        Event,
        getComputedStyle,
      }),
    ).toBe(true);
    expect(input.value).toBe(text);
    expect(onInput).toHaveBeenCalledOnce();
    expect(Reflect.ownKeys(window)).toStrictEqual(globals);
    expect(observe).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    // jsdom schedules the browser's own selectionchange event after focus().
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finds a composer in a shadow root and refuses disabled buttons', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<textarea id="input"></textarea><button disabled id="send">Send</button>';
    expect(runBrowserAction({ kind: 'fill', selector: '#input', text: 'Hello' })).toBe(
      true,
    );
    expect(shadow.querySelector('textarea')?.value).toBe('Hello');
    const click = vi.fn();
    shadow.querySelector('button')?.addEventListener('click', click);
    expect(runBrowserAction({ kind: 'click', selector: '#send' })).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('returns selector errors as failures without throwing into the page', () => {
    expect(runBrowserAction({ kind: 'click', selector: '[' })).toEqual({
      failure: expect.any(String),
    });
  });

  it('deduplicates nested assistant selectors, excludes code-copy controls, and returns no answer text', () => {
    document.body.innerHTML =
      '<div data-message-author-role="user">Hello</div><article><div data-message-author-role="assistant"><div data-markdown-text-style="assistant-message">Private answer</div></div><pre><button aria-label="Copy">Copy</button></pre></article>';
    const snapshot = () =>
      runBrowserAction({
        kind: 'snapshot',
        selectors: website.responseSelectors,
        prompt: 'Hello',
      });
    expect(snapshot()).toEqual(
      expect.objectContaining({
        responseCount: 1,
        userCount: 1,
        userMatches: true,
        hasText: true,
        complete: false,
      }),
    );
    expect(JSON.stringify(snapshot())).not.toContain('Private answer');
    document
      .querySelector('article')
      ?.insertAdjacentHTML('beforeend', '<button aria-label="Copy">Copy</button>');
    expect(snapshot()).toEqual(expect.objectContaining({ complete: true }));
  });

  it('ignores hidden busy indicators and recognises a visible one', () => {
    document.body.innerHTML =
      '<div hidden><button data-testid="stop-button">Stop</button></div>';
    const action = {
      kind: 'snapshot',
      selectors: website.responseSelectors,
      prompt: 'Hello',
    } as const;
    expect(runBrowserAction(action)).toEqual(expect.objectContaining({ busy: false }));
    document.querySelector('div')?.removeAttribute('hidden');
    expect(runBrowserAction(action)).toEqual(expect.objectContaining({ busy: true }));
  });
});

describe('host-owned submission', () => {
  it('passes selectors and text to the backend and clicks Send exactly once', async () => {
    const browser = backend();
    await sendBrowserPrompt(request, browser, vi.fn(), vi.fn(), controller.signal);
    expect(browser.fill).toHaveBeenCalledExactlyOnceWith('#input', 'Hello');
    expect(browser.click).toHaveBeenCalledExactlyOnceWith('#send');
    controller.abort();
  });

  it('does not fill or send on a sign-in origin or while generation is active', async () => {
    for (const snapshot of [
      { ...empty, url: 'https://accounts.example.com/' },
      { ...empty, busy: true },
    ]) {
      const browser = backend(snapshot);
      await expect(
        sendBrowserPrompt(request, browser, vi.fn(), vi.fn(), controller.signal),
      ).rejects.toThrow();
      expect(browser.fill).not.toHaveBeenCalled();
      expect(browser.click).not.toHaveBeenCalled();
    }
  });

  it('bounds missing-composer retries, reports the error, and never clicks Send', async () => {
    const browser = backend();
    vi.mocked(browser.fill).mockResolvedValue(false);
    const error = vi.fn();
    const pending = sendBrowserPrompt(
      request,
      browser,
      vi.fn(),
      error,
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow('Unable to use insert selector');
    await vi.advanceTimersByTimeAsync(4200);
    await rejected;
    expect(error).toHaveBeenCalledExactlyOnceWith({
      attemptId: 'attempt',
      kind: 'insert',
      selector: '#input',
    });
    expect(browser.click).not.toHaveBeenCalled();
  });

  it('does not click Send if the attempt was cancelled during an in-flight fill', async () => {
    const browser = backend();
    browser.fill = async () => {
      controller.abort();
      return true;
    };
    await expect(
      sendBrowserPrompt(request, browser, vi.fn(), vi.fn(), controller.signal),
    ).rejects.toThrow();
    expect(browser.click).not.toHaveBeenCalled();
  });
});

describe('host-owned response observation', () => {
  it('ends unsupported response tracking immediately without installing a poll timer', async () => {
    const browser = backend();
    const report = vi.fn();
    await watchResponse(
      {
        ...request,
        website: {
          ...website,
          responseSelectors: { ...website.responseSelectors, completeSelector: '' },
        },
      },
      empty,
      browser,
      report,
      controller.signal,
    );
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'unknown',
        reason: 'missing-response-configuration',
      }),
    );
    expect(browser.snapshot).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers from a transient snapshot error while the page replaces DOM nodes', async () => {
    const browser = backend(answer);
    vi.mocked(browser.snapshot).mockRejectedValueOnce(new Error('Node was removed'));
    const report = vi.fn();
    const pending = watchResponse(request, empty, browser, report, controller.signal);
    await vi.advanceTimersByTimeAsync(3750);
    await pending;
    expect(report.mock.calls.at(-1)?.[0].status).toBe('completed');
  });
  it('binds a new conversation, waits for stable finished controls, and completes once', async () => {
    const browser = backend(answer);
    const report = vi.fn<(report: ResponseReport) => void>();
    const pending = watchResponse(request, empty, browser, report, controller.signal);
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(report.mock.calls.filter(([event]) => event.status === 'completed')).toEqual([
      [
        expect.objectContaining({
          attemptId: 'attempt',
          responseId: 'answer',
          url: answer.url,
        }),
      ],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { name: 'existing answers', baseline: answer, next: answer },
    {
      name: 'missing final controls',
      baseline: empty,
      next: { ...answer, complete: false },
    },
    { name: 'ongoing generation', baseline: empty, next: { ...answer, busy: true } },
    {
      name: 'a different user message',
      baseline: empty,
      next: { ...answer, userMatches: false },
    },
  ])('never completes for $name', async ({ baseline, next }) => {
    const report = vi.fn();
    const pending = watchResponse(
      request,
      baseline,
      backend(next),
      report,
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(6000);
    expect(report.mock.calls.some(([event]) => event.status === 'completed')).toBe(false);
    controller.abort();
    await pending;
  });

  it('resets the settling window when response content changes', async () => {
    const browser = backend(answer);
    const report = vi.fn();
    const pending = watchResponse(request, empty, browser, report, controller.signal);
    await vi.advanceTimersByTimeAsync(1500);
    vi.mocked(browser.snapshot).mockResolvedValue({ ...answer, fingerprint: 'changed' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(report.mock.calls.some(([event]) => event.status === 'completed')).toBe(false);
    await vi.advanceTimersByTimeAsync(750);
    await pending;
    expect(report.mock.calls.at(-1)?.[0].status).toBe('completed');
  });

  it.each([
    { next: { ...answer, url: 'https://elsewhere.example/' }, status: 'cancelled' },
    { next: { ...answer, error: 'new-alert' }, status: 'failed' },
    { next: { ...answer, userCount: 2 }, status: 'cancelled' },
  ])(
    'ends observation with $status without claiming completion',
    async ({ next, status }) => {
      const report = vi.fn();
      const pending = watchResponse(
        request,
        empty,
        backend(next),
        report,
        controller.signal,
      );
      await vi.advanceTimersByTimeAsync(750);
      await pending;
      expect(report.mock.calls.at(-1)?.[0].status).toBe(status);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('times out and stops polling instead of running forever', async () => {
    const browser = backend();
    const report = vi.fn();
    const pending = watchResponse(request, empty, browser, report, controller.signal);
    await vi.advanceTimersByTimeAsync(900_000);
    await pending;
    expect(report.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ status: 'unknown', reason: 'timeout' }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
