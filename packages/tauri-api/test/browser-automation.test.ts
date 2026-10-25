import type {
  BrowserAction,
  BrowserPromptRequest,
  BrowserSnapshot,
  GuestMessageEvent,
} from '@internal/multi-mind';
import { DEFAULT_WEBSITES } from '@internal/multi-mind';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface AutomationArguments {
  websiteId: string;
  request: {
    action: BrowserAction;
    expectedOrigin: string;
    prepareScript: string | null;
    fallbackScript: string;
  };
}
const invoke =
  vi.fn<
    (
      command: string,
      args: AutomationArguments,
    ) => Promise<boolean | BrowserSnapshot | { failure: string }>
  >();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const { onLocalGuestMessage } =
  await import('../src/browser-automation/guest-message-bus');
const { cancelGuestPrompt, retainGuestPrompts, sendGuestPrompt } =
  await import('../src/browser-automation/send-guest-prompt');
const request: BrowserPromptRequest = {
  website: DEFAULT_WEBSITES.find((website) => website.id === 'chatgpt')!,
  prompt: 'Hello',
  attemptId: 'attempt',
};
const snapshot: BrowserSnapshot = {
  url: request.website.url,
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
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  invoke.mockImplementation(
    async (_command, args: { request: { action: { kind: string } } }) =>
      args.request.action.kind === 'snapshot' ? snapshot : true,
  );
});
afterEach(async () => {
  cancelGuestPrompt('chatgpt');
  stop?.();
  await vi.advanceTimersByTimeAsync(1000);
  vi.useRealTimers();
});

describe('guest automation bridge', () => {
  it('sends structured operations with origin guards and WebKit preparation, without guest_eval', async () => {
    await sendGuestPrompt('chatgpt', request);
    expect(invoke.mock.calls.every(([command]) => command === 'guest_automation')).toBe(
      true,
    );
    const actions = invoke.mock.calls.map(([, args]) => args.request.action.kind);
    expect(actions).toEqual(['snapshot', 'fill', 'snapshot', 'click']);
    const fill = invoke.mock.calls.find(
      ([, args]) => args.request.action.kind === 'fill',
    )?.[1].request;
    expect(fill).toEqual(
      expect.objectContaining({
        expectedOrigin: 'https://chatgpt.com',
        prepareScript: expect.any(String),
        fallbackScript: expect.any(String),
        action: { kind: 'fill', selector: request.website.inputSelector, text: 'Hello' },
      }),
    );
  });

  it('publishes metadata once and cancels host polling immediately when the pane closes', async () => {
    const events: GuestMessageEvent[] = [];
    stop = onLocalGuestMessage((event) => events.push(event));
    await sendGuestPrompt('chatgpt', request);
    expect(events.filter((event) => event.message.startsWith('__page__'))).toHaveLength(
      1,
    );
    retainGuestPrompts(new Set());
    expect(events.at(-1)?.message).toContain('host-cancelled');
    const calls = invoke.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(invoke).toHaveBeenCalledTimes(calls);
  });

  it('does not click Send after cancellation while a native fill is in flight', async () => {
    invoke.mockImplementation(
      async (_command, args: { request: { action: { kind: string } } }) => {
        if (args.request.action.kind === 'snapshot') return snapshot;
        cancelGuestPrompt('chatgpt');
        return true;
      },
    );
    await expect(sendGuestPrompt('chatgpt', request)).rejects.toThrow();
    expect(
      invoke.mock.calls.some(([, args]) => args.request.action.kind === 'click'),
    ).toBe(false);
  });

  it('preserves the failing button selector instead of overwriting it with an insert error', async () => {
    const events: GuestMessageEvent[] = [];
    stop = onLocalGuestMessage((event) => events.push(event));
    invoke.mockImplementation(
      async (_command, args: { request: { action: { kind: string } } }) =>
        args.request.action.kind === 'snapshot'
          ? snapshot
          : args.request.action.kind !== 'click',
    );
    const pending = sendGuestPrompt('chatgpt', request);
    const rejected = expect(pending).rejects.toThrow('button selector');
    await vi.advanceTimersByTimeAsync(4200);
    await rejected;
    const errors = events.filter((event) => event.message.startsWith('__prompt_error__'));
    expect(errors).toHaveLength(1);
    expect(JSON.parse(errors[0]!.message.slice('__prompt_error__'.length))).toEqual({
      attemptId: 'attempt',
      kind: 'button',
      selector: request.website.buttonSelector,
    });
  });

  it('reports a WebKit operation failure without sending the prompt', async () => {
    invoke.mockResolvedValue({ failure: 'Invalid selector' });
    await expect(sendGuestPrompt('chatgpt', request)).rejects.toThrow('Invalid selector');
    expect(invoke).toHaveBeenCalledOnce();
  });
});
