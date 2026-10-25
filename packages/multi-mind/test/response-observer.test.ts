// @vitest-environment jsdom
import type { ResponseObserverOptions } from '../src/response-completion/observe-response';
import { Script } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseResponseReport } from '../src/response-completion';
import { createResponseObserverScript } from '../src/response-completion/create-response-observer-script';
import { observeResponse } from '../src/response-completion/observe-response';
import { createRunPromptScript } from '../src/scripts';
import { DEFAULT_WEBSITES } from '../src/websites';

const options: ResponseObserverOptions = {
  bridgeKey: '_bridge',
  runtimeKey: '_response',
  attemptId: 'one',
  prompt: 'Hello',
  prefix: '__response__',
  settleMs: 100,
  timeoutMs: 3000,
  startUrl: 'https://chatgpt.com/',
};
const provider = {
  ...DEFAULT_WEBSITES.find((site) => site.id === 'chatgpt')!.responseSelectors,
  origins: ['https://chatgpt.com'],
};
let messages: string[];

function start(): boolean {
  return observeResponse(provider, options);
}
function completed() {
  return messages
    .map(parseResponseReport)
    .filter((value) => value?.status === 'completed');
}
function answer(text = 'Answer'): HTMLElement {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div data-message-author-role="user">Hello</div><article><div data-message-author-role="assistant" data-message-id="answer">${text}</div><button data-testid="copy-turn-action-button">Copy</button></article>`,
  );
  return document.querySelector<HTMLElement>('[data-message-author-role="assistant"]')!;
}
async function tick(ms = 200): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL('https://chatgpt.com/'));
  messages = [];
  Reflect.set(window, '_bridge', {
    postMessage: (message: string) => messages.push(message),
  });
  document.body.innerHTML = '';
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  Reflect.deleteProperty(window, '_bridge');
  Reflect.deleteProperty(window, '_find');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('response observer', () => {
  it.each([
    {
      id: 'chatgpt',
      url: 'https://chatgpt.com/',
      html: '<div data-talvt-turn-state="complete"><div data-user-message-bubble="true">Hello</div><div data-markdown-text-style="assistant-message">READY</div><button aria-label="Copy">Copy</button></div>',
    },
    {
      id: 'claude',
      url: 'https://claude.ai/new',
      html: '<div data-testid="user-message">Hello</div><div data-testid="transcript-row" data-perf-row="assistant"><div data-testid="assistant-message" data-is-streaming="false" data-turn-key="reply"><p>READY</p><div data-testid="message-actions"><button aria-label="Copy">Copy</button></div></div></div>',
    },
    {
      id: 'gemini',
      url: 'https://gemini.google.com/app',
      html: '<user-query>Hello</user-query><model-response><message-content>READY</message-content><message-actions><copy-button><button aria-label="Copy">Copy</button></copy-button></message-actions></model-response>',
    },
  ])(
    'recognises the live $id response markup with its default selectors',
    async ({ id, url, html }) => {
      const site = DEFAULT_WEBSITES.find((entry) => entry.id === id)!;
      vi.stubGlobal('location', new URL(url));
      observeResponse(
        { ...site.responseSelectors, origins: [new URL(url).origin] },
        { ...options, startUrl: url },
      );
      document.body.innerHTML = html;
      await tick();
      expect(completed()).toHaveLength(1);
    },
  );

  it('waits for ChatGPT to mark its live turn complete even if Copy is already rendered', async () => {
    start();
    document.body.innerHTML =
      '<div data-talvt-turn-state="streaming"><div data-user-message-bubble="true">Hello</div><div data-markdown-text-style="assistant-message">Answer</div><button aria-label="Copy">Copy</button></div>';
    await tick(500);
    expect(completed()).toEqual([]);
    document
      .querySelector('[data-talvt-turn-state]')!
      .setAttribute('data-talvt-turn-state', 'complete');
    await tick();
    expect(completed()).toHaveLength(1);
  });
  it('tracks a prompt through the complete injected sender and reports completion through its bridge', async () => {
    const website = DEFAULT_WEBSITES.find((site) => site.id === 'chatgpt')!;
    const configured = { ...website, inputSelector: '#input', buttonSelector: '#send' };
    document.body.innerHTML =
      '<textarea id="input"></textarea><button id="send" disabled>Send</button>';
    const input = document.querySelector<HTMLTextAreaElement>('#input')!;
    const send = document.querySelector<HTMLButtonElement>('#send')!;
    input.addEventListener('input', () => {
      send.disabled = input.value === '';
    });
    const submitted = (event: Event) => {
      if (event.target !== send) {
        return;
      }
      send.setAttribute('data-testid', 'stop-button');
      answer();
      setTimeout(() => send.remove(), 100);
    };
    document.addEventListener('click', submitted, true);
    Reflect.set(window, '_find', (selector: string) => document.querySelector(selector));
    try {
      const script = createRunPromptScript(
        configured,
        'Hello',
        { findKey: '_find', bridgeKey: '_bridge' },
        'full-send',
      );
      new Script(script).runInNewContext({
        window,
        document,
        location,
        getComputedStyle,
        Element,
        HTMLInputElement,
        HTMLTextAreaElement,
        Event,
        InputEvent,
        MutationObserver,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        Date,
        console,
      });
      await tick(5000);
      expect(input.value).toBe('Hello');
      expect(completed()).toContainEqual(
        expect.objectContaining({ attemptId: 'full-send' }),
      );
      expect(messages.map(parseResponseReport)).not.toContainEqual(
        expect.objectContaining({ status: 'cancelled' }),
      );
    } finally {
      document.removeEventListener('click', submitted, true);
    }
  });
  it('waits for a new answer with final controls and settled content', async () => {
    start();
    answer();
    await tick(100);
    expect(completed()).toEqual([]);
    await tick();
    expect(completed()).toHaveLength(1);
    expect(completed()[0]).toMatchObject({ attemptId: 'one', responseId: 'answer' });
    await tick();
    expect(completed()).toHaveLength(1);
  });

  it('ignores old answers and old copy buttons', async () => {
    answer('Old answer');
    start();
    await tick();
    expect(completed()).toEqual([]);
  });

  it('waits through thinking and tool pauses while generation is active', async () => {
    start();
    answer();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button data-testid="stop-button">Stop</button>',
    );
    await tick(1000);
    expect(completed()).toEqual([]);
    document.querySelector('[data-testid="stop-button"]')!.remove();
    await tick();
    expect(completed()).toHaveLength(1);
  });

  it('resets settling when text or generation changes', async () => {
    start();
    const element = answer();
    await tick(100);
    element.textContent = 'More text';
    await tick(60);
    expect(completed()).toEqual([]);
    await tick();
    expect(completed()).toHaveLength(1);
  });

  it('does not treat an answer without final controls as complete', async () => {
    start();
    answer();
    document.querySelector('button')!.remove();
    await tick(1000);
    expect(completed()).toEqual([]);
  });

  it('ignores disabled final controls', async () => {
    start();
    answer();
    document.querySelector('button')!.disabled = true;
    await tick(500);
    expect(completed()).toEqual([]);
    document.querySelector('button')!.disabled = false;
    await tick();
    expect(completed()).toHaveLength(1);
  });

  it('ignores a response to a different prompt', async () => {
    start();
    answer();
    document.querySelector('[data-message-author-role="user"]')!.textContent =
      'Other prompt';
    await tick();
    expect(completed()).toEqual([]);
  });

  it('cancels when the user stops generation', async () => {
    start();
    answer();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button data-testid="stop-button">Stop</button>',
    );
    await tick(60);
    document.querySelector<HTMLButtonElement>('[data-testid="stop-button"]')!.click();
    document.querySelector('[data-testid="stop-button"]')!.remove();
    await tick();
    expect(completed()).toEqual([]);
    expect(messages.map(parseResponseReport)).toContainEqual(
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('does not mistake the submitted Send click for Stop when the page changes the button during capture', async () => {
    document.body.innerHTML = '<button id="send">Send</button>';
    const send = document.querySelector<HTMLButtonElement>('#send')!;
    const submitted = (event: Event) => {
      if (event.target !== send) {
        return;
      }
      send.setAttribute('data-testid', 'stop-button');
      send.textContent = 'Stop';
      answer();
    };
    document.addEventListener('click', submitted, true);
    try {
      start();
      send.click();
      await tick(200);
      expect(messages.map(parseResponseReport)).not.toContainEqual(
        expect.objectContaining({ status: 'cancelled' }),
      );
      expect(completed()).toEqual([]);
      send.remove();
      await tick();
      expect(completed()).toHaveLength(1);
    } finally {
      document.removeEventListener('click', submitted, true);
    }
  });

  it('recognises multiline prompts rendered as adjacent paragraphs', async () => {
    observeResponse(provider, { ...options, prompt: 'Hello\nWorld' });
    answer();
    document.querySelector('[data-message-author-role="user"]')!.innerHTML =
      '<p>Hello</p><p>World</p>';
    await tick();
    expect(completed()).toHaveLength(1);
  });

  it('groups thinking and answer blocks inside one assistant turn', async () => {
    start();
    answer();
    const turn = document.querySelector('article')!;
    turn.insertAdjacentHTML(
      'afterbegin',
      '<div data-message-author-role="assistant">Thinking</div>',
    );
    await tick();
    expect(completed()).toHaveLength(1);
  });

  it('reports which completion condition is missing', async () => {
    start();
    answer();
    document.querySelector('button')!.remove();
    await tick();
    expect(messages.map(parseResponseReport)).toContainEqual(
      expect.objectContaining({
        status: 'observing',
        reason: 'waiting-for-finished-action',
      }),
    );
    expect(completed()).toEqual([]);
  });

  it('cancels on navigation and disconnects after pagehide', async () => {
    start();
    window.dispatchEvent(new Event('pagehide'));
    answer();
    await tick();
    expect(completed()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports new errors separately from successful completion', async () => {
    start();
    answer();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="alert">Rate limit reached</div>',
    );
    await tick();
    expect(completed()).toEqual([]);
    expect(messages.map(parseResponseReport)).toContainEqual(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('reports uncertainty on timeout and stops observing', async () => {
    start();
    await tick(3100);
    expect(completed()).toEqual([]);
    expect(messages.map(parseResponseReport)).toContainEqual(
      expect.objectContaining({ status: 'unknown' }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts the new conversation URL even when it arrives after the first token', async () => {
    start();
    answer();
    await tick(60);
    vi.stubGlobal('location', new URL('https://chatgpt.com/c/new-chat'));
    await tick();
    expect(completed()).toHaveLength(1);
    expect(completed()[0]?.url).toBe('https://chatgpt.com/c/new-chat');
  });

  it('does not borrow final controls from a different response', async () => {
    answer('Old answer');
    start();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-message-author-role="user">Hello</div><div data-message-author-role="assistant">New answer</div>',
    );
    await tick();
    expect(completed()).toEqual([]);
  });

  it('treats an invalid custom selector as unsupported without breaking prompt submission', () => {
    expect(observeResponse({ ...provider, responseSelector: '[' }, options)).toBe(true);
    expect(messages.map(parseResponseReport)).toContainEqual(
      expect.objectContaining({ status: 'unknown' }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not submit into an already generating conversation', () => {
    document.body.innerHTML = '<button data-testid="stop-button">Stop</button>';
    expect(start()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves unknown origins unsupported', () => {
    vi.stubGlobal('location', new URL('https://custom.test/'));
    start();
    expect(messages.map(parseResponseReport)).toContainEqual(
      expect.objectContaining({ status: 'unknown' }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('executes the generated script without module scope dependencies', async () => {
    const script = createResponseObserverScript(
      DEFAULT_WEBSITES.find((site) => site.id === 'chatgpt')!,
      'Hello',
      { findKey: '_find', bridgeKey: '_bridge' },
      'generated',
    );
    // Execute exactly what crosses guest_eval, independently of this module's scope.
    expect(
      new Script(script).runInNewContext({
        window,
        document,
        location,
        getComputedStyle,
        Element,
        MutationObserver,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        Date,
      }),
    ).toBe(true);
    answer();
    await tick(3000);
    expect(completed()).toContainEqual(
      expect.objectContaining({ attemptId: 'generated' }),
    );
  });

  it('uses the selectors saved on the website instead of hidden provider defaults', async () => {
    const website = DEFAULT_WEBSITES.find((site) => site.id === 'chatgpt')!;
    const custom = {
      ...website,
      useDefaults: false,
      responseSelectors: {
        responseSelector: '.reply',
        userSelector: '.user',
        turnSelector: '.turn',
        busySelector: '.busy',
        completeSelector: '.copy',
      },
    };
    const script = createResponseObserverScript(
      custom,
      'Hello',
      { findKey: '_find', bridgeKey: '_bridge' },
      'custom',
    );
    new Script(script).runInNewContext({
      window,
      document,
      location,
      getComputedStyle,
      Element,
      MutationObserver,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      URL,
      Date,
    });
    document.body.innerHTML =
      '<div class="user">Hello</div><article class="turn"><div class="reply">Answer</div><button class="copy">Copy</button></article>';
    await tick(3000);
    expect(completed()).toContainEqual(expect.objectContaining({ attemptId: 'custom' }));
  });
});
