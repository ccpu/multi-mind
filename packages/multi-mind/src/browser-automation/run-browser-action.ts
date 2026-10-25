import type { BrowserAction, BrowserSnapshot } from './types';

/** WebKit fallback: executes once, leaving no globals, observers, timers, or listeners. */
export function runBrowserAction(
  action: BrowserAction,
  prepare = false,
): boolean | BrowserSnapshot | { failure: string } {
  try {
    const compact = (text: string) => text.replace(/\s+/gu, '');
    const fingerprint = (text: string) => {
      const multiplier = 31;
      const modulus = 4294967296;
      let hash = 0;
      for (let index = 0; index < text.length; index += 1) {
        hash = (hash * multiplier + text.charCodeAt(index)) % modulus;
      }
      return `${text.length}:${hash}`;
    };
    const visible = (element: Element) => {
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          node.hasAttribute('hidden') ||
          node.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' ||
          style.visibility === 'hidden'
        )
          return false;
      }
      return true;
    };
    const find = (
      selector: string,
      root: Document | ShadowRoot = document,
    ): Element | null => {
      for (const match of root.querySelectorAll(selector)) {
        if (
          match instanceof HTMLElement &&
          visible(match) &&
          !match.hasAttribute('disabled') &&
          match.getAttribute('aria-disabled') !== 'true'
        )
          return match;
      }
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot !== null) {
          const nested = find(selector, element.shadowRoot);
          if (nested !== null) return nested;
        }
      }
      return null;
    };
    if (action.kind !== 'snapshot') {
      const element = find(action.selector);
      if (
        !(element instanceof HTMLElement) ||
        !visible(element) ||
        element.hasAttribute('disabled') ||
        element.getAttribute('aria-disabled') === 'true'
      )
        return false;
      if (action.kind === 'click') {
        element.click();
        return true;
      }
      if (prepare) {
        element.focus();
        if (
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLInputElement
        ) {
          element.select();
        } else {
          const range = document.createRange();
          range.selectNodeContents(element);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
        return true;
      }
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        const prototype =
          element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
          element,
          action.text,
        );
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        document.execCommand('insertText', false, action.text);
      }
      const value =
        element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
          ? element.value
          : (element.textContent ?? '');
      return compact(value) === compact(action.text);
    }
    const { selectors } = action;
    const all = (selector: string) =>
      selector.trim() === '' ? [] : [...document.querySelectorAll(selector)];
    const responses = new Map<Element, Element>();
    for (const element of all(selectors.responseSelector)) {
      const turn =
        selectors.turnSelector.trim() === ''
          ? element
          : (element.closest(selectors.turnSelector) ?? element);
      if (!responses.has(turn)) responses.set(turn, element);
    }
    const last = [...responses.entries()].at(-1);
    const turn = last?.[0];
    const response = last?.[1];
    const text = turn?.textContent?.trim() ?? '';
    const users = all(selectors.userSelector ?? '');
    const errors = all(selectors.errorSelector ?? '')
      .filter(visible)
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean)
      .join('\n');
    return {
      url: location.href,
      title: document.title,
      responseCount: responses.size,
      userCount: users.length,
      userMatches: compact(users.at(-1)?.textContent ?? '').includes(
        compact(action.prompt),
      ),
      responseId:
        [response?.getAttribute('data-message-id'), response?.id].find(
          (value) => value !== null && value !== undefined && value !== '',
        ) ?? String(responses.size),
      fingerprint: fingerprint(text),
      hasText: (response?.textContent?.trim() ?? '') !== '',
      busy: all(selectors.busySelector).some(visible),
      complete:
        turn !== undefined &&
        selectors.completeSelector.trim() !== '' &&
        [...turn.querySelectorAll(selectors.completeSelector)].some(
          (element) =>
            visible(element) &&
            element.closest('pre') === null &&
            !element.hasAttribute('disabled') &&
            element.getAttribute('aria-disabled') !== 'true',
        ),
      error: errors === '' ? '' : fingerprint(errors),
    };
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) };
  }
}

/** Serializes the temporary WebKit operation with JSON-escaped arguments. */
export function createBrowserActionScript(
  action: BrowserAction,
  prepare = false,
): string {
  return `(${runBrowserAction.toString()})(${JSON.stringify(action)}, ${JSON.stringify(prepare)})`;
}
