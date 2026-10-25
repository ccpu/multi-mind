import type { ResponseProvider, ResponseReport } from './types';

export interface ResponseObserverOptions {
  bridgeKey: string;
  runtimeKey: string;
  attemptId: string;
  prompt: string;
  prefix: string;
  settleMs: number;
  timeoutMs: number;
  startUrl: string;
}

/** Self-contained browser runtime, serialized into the guest just before submission. */
export function observeResponse(
  provider: ResponseProvider | null,
  options: ResponseObserverOptions,
): boolean {
  const previous = Reflect.get(window, options.runtimeKey) as
    { cancel: () => void } | undefined;
  previous?.cancel();
  const post = (status: ResponseReport['status'], responseId = '', reason = '') => {
    const bridge = Reflect.get(window, options.bridgeKey) as {
      postMessage: (message: string) => void;
    };
    bridge.postMessage(
      options.prefix +
        JSON.stringify({
          attemptId: options.attemptId,
          status,
          responseId,
          url: location.href,
          reason,
        }),
    );
  };
  if (window.top !== window || !provider?.origins.includes(location.origin)) {
    post('unknown', '', 'missing-configuration-or-unexpected-origin');
    return true;
  }
  try {
    for (const selector of [
      provider.responseSelector,
      provider.turnSelector,
      provider.busySelector,
      provider.completeSelector,
      provider.userSelector,
      provider.errorSelector,
    ]) {
      if (selector !== undefined && selector !== '') {
        document.querySelector(selector);
      }
    }
  } catch {
    post('unknown', '', 'invalid-selector');
    return true;
  }
  const visible = (element: Element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        node.hasAttribute('hidden') ||
        node.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' ||
        style.visibility === 'hidden'
      ) {
        return false;
      }
    }
    return true;
  };
  const busy = () => [...document.querySelectorAll(provider.busySelector)].some(visible);
  if (busy()) {
    post('unknown', '', 'already-generating');
    return false;
  }
  const responsesInDocument = () => {
    const turns = new Map<Element, Element>();
    for (const element of document.querySelectorAll(provider.responseSelector)) {
      const turn = element.closest(provider.turnSelector) ?? element;
      if (!turns.has(turn)) {
        turns.set(turn, element);
      }
    }
    return [...turns.values()];
  };
  const baseline = responsesInDocument().length;
  const userCount =
    provider.userSelector !== undefined && provider.userSelector !== ''
      ? document.querySelectorAll(provider.userSelector).length
      : 0;
  const errorElements = () =>
    provider.errorSelector !== undefined && provider.errorSelector !== ''
      ? [...document.querySelectorAll(provider.errorSelector)]
      : [];
  const errors = new Map(
    errorElements().map((element) => [element, element.textContent]),
  );
  const startedAt = Date.now();
  const initialUrl = location.href;
  let boundUrl = initialUrl;
  let canBindConversation =
    new URL(initialUrl).pathname === new URL(options.startUrl).pathname;
  let stopped = false;
  let sawBusy = false;
  let announced = false;
  let submitting = true;
  let lastReason = '';
  // The page can turn Send into Stop inside its capture handler for this click.
  void Promise.resolve().then(() => {
    submitting = false;
  });
  let text = '';
  let response: Element | null = null;
  let settledAt = 0;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let dispose = () => {};

  const progress = (reason: string) => {
    if (reason !== lastReason) {
      lastReason = reason;
      post('observing', '', reason);
    }
  };
  const finish = (status: ResponseReport['status'], responseId = '', reason = '') => {
    if (stopped) {
      return;
    }
    stopped = true;
    dispose();
    post(status, responseId, reason);
  };
  const leaving = () => finish('cancelled', '', 'navigation');
  const clicked = (event: Event) => {
    if (submitting) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button, [role="button"]');
    if (
      button?.matches(provider.busySelector) === true ||
      target?.closest('a[href]:not([target="_blank"])') != null
    ) {
      finish('cancelled', '', 'stop-or-navigation-click');
    }
  };
  const check = () => {
    if (stopped) {
      return;
    }
    if (Date.now() - startedAt >= options.timeoutMs) {
      finish('unknown', '', `timeout: ${lastReason}`);
      return;
    }
    if (
      location.origin !== new URL(initialUrl).origin ||
      (!canBindConversation && location.href !== boundUrl)
    ) {
      finish('cancelled', '', 'conversation-changed');
      return;
    }
    const failed = errorElements().some(
      (element) =>
        visible(element) &&
        (element.textContent?.trim() ?? '') !== '' &&
        errors.get(element) !== element.textContent,
    );
    if (failed) {
      finish('failed', '', 'page-error');
      return;
    }
    const isBusy = busy();
    sawBusy ||= isBusy;
    const responses = responsesInDocument();
    const next = responses.length > baseline ? (responses.at(-1) ?? null) : null;
    const users =
      provider.userSelector !== undefined && provider.userSelector !== ''
        ? document.querySelectorAll(provider.userSelector)
        : null;
    // textContent joins adjacent paragraphs without spaces; match their content.
    const compact = (value: string) => value.replace(/\s+/gu, '');
    const accepted =
      users === null
        ? sawBusy
        : users.length === userCount + 1 &&
          compact(users.item(userCount)?.textContent ?? '').includes(
            compact(options.prompt),
          );
    if (users !== null && users.length > userCount + 1) {
      finish('cancelled', '', 'another-user-message');
      return;
    }
    if (next !== null && accepted) {
      if (location.href !== boundUrl) {
        boundUrl = location.href;
        canBindConversation = false;
      }
      if (!announced) {
        post('generating', '', 'new-response');
        announced = true;
      }
    }
    const turn = next?.closest(provider.turnSelector);
    const nextText = turn?.textContent?.trim() ?? next?.textContent?.trim() ?? '';
    if (next !== response || nextText !== text) {
      response = next;
      text = nextText;
      settledAt = 0;
    }
    const belongsToResponse =
      turn != null &&
      (turn === next || turn.querySelector(provider.responseSelector) === next);
    const ready =
      belongsToResponse &&
      [...turn.querySelectorAll(provider.completeSelector)].some(
        (element) =>
          visible(element) &&
          !element.closest('pre') &&
          !element.hasAttribute('disabled') &&
          element.getAttribute('aria-disabled') !== 'true',
      );
    if (!accepted || next === null || text === '' || isBusy || !ready) {
      settledAt = 0;
      let reason = 'waiting-for-content';
      if (!ready) {
        reason = 'waiting-for-finished-action';
      }
      if (turn == null) {
        reason = 'waiting-for-response-container';
      }
      if (next === null) {
        reason = 'waiting-for-assistant-response';
      }
      if (!accepted) {
        reason = 'waiting-for-user-message';
      }
      if (isBusy) {
        reason = 'waiting-for-generation-end';
      }
      progress(reason);
      return;
    }
    progress('settling');
    settledAt ||= Date.now();
    if (Date.now() - settledAt >= options.settleMs) {
      finish(
        'completed',
        (next.getAttribute('data-message-id') ?? '') || next.id || options.attemptId,
      );
    }
  };
  const safelyCheck = () => {
    try {
      check();
    } catch (error) {
      finish('unknown', '', 'observer-check-failed');
      console.error('Unable to check response completion:', error);
    }
  };
  const observer = new MutationObserver(() => {
    if (scheduled !== undefined) {
      return;
    }
    const mutationDebounceMs = 50;
    scheduled = setTimeout(() => {
      scheduled = undefined;
      safelyCheck();
    }, mutationDebounceMs);
  });
  const watchdogIntervalMs = 1000;
  const watchdog = setInterval(
    safelyCheck,
    Math.min(options.settleMs, watchdogIntervalMs),
  );
  const controller = { cancel: leaving };
  dispose = () => {
    observer.disconnect();
    clearInterval(watchdog);
    clearTimeout(scheduled);
    document.removeEventListener('click', clicked, true);
    window.removeEventListener('pagehide', leaving);
    if (Reflect.get(window, options.runtimeKey) === controller) {
      Reflect.deleteProperty(window, options.runtimeKey);
    }
  };
  Object.defineProperty(window, options.runtimeKey, {
    value: controller,
    configurable: true,
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'disabled',
      'aria-disabled',
      'aria-busy',
      'data-is-streaming',
      'data-talvt-turn-state',
      'data-perf-row-streaming',
      'class',
      'hidden',
      'aria-hidden',
    ],
  });
  document.addEventListener('click', clicked, true);
  window.addEventListener('pagehide', leaving);
  progress('armed');
  return true;
}
