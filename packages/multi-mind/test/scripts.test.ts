import type { GuestGlobals } from '../src/messages';
import { describe, expect, it } from 'vitest';
import { createGuestGlobals } from '../src/messages';
import {
  createGuestScripts,
  createPopupScripts,
  createRunPromptScript,
} from '../src/scripts';
import { DEFAULT_WEBSITES } from '../src/websites';

const claude = DEFAULT_WEBSITES.find((website) => website.name === 'claude')!;

// Fixed here so the assertions can name them; at runtime they are generated.
const globals: GuestGlobals = {
  bridgeKey: '_bridge',
  findKey: '_find',
};

describe('createGuestGlobals', () => {
  /*
   * These names land on the embedded page's own `window`. A constant would let
   * any site recognise the app -- and let it be blocklisted by name.
   */
  it('names the globals differently on every run', () => {
    const first = createGuestGlobals();
    const second = createGuestGlobals();

    expect(first.bridgeKey).not.toBe(second.bridgeKey);
    expect(first.findKey).not.toBe(second.findKey);
    expect(new Set(Object.values(first)).size).toBe(Object.keys(first).length);
  });

  it('never gives away the app in a name', () => {
    for (const name of Object.values(createGuestGlobals())) {
      expect(name.toLowerCase()).not.toContain('multi');
      expect(name.toLowerCase()).not.toContain('mind');
    }
  });
});

describe('createGuestScripts', () => {
  it('installs the query helper the prompt runner depends on', () => {
    // The runner is a separate evaluation that cannot install the helper
    // itself, so the navigation scripts have to have left it on `window`.
    const [helper] = createGuestScripts(claude, globals);

    expect(helper).toContain('_find');
    expect(createRunPromptScript(claude, 'hi', globals)).toContain('window["_find"]');
  });

  it('reports clicks through the host bridge', () => {
    const [, clickReporter] = createGuestScripts(claude, globals);

    expect(clickReporter).toContain('window["_bridge"].postMessage("__clicked__")');
  });

  it('completes every script with undefined', () => {
    // A completion value that cannot be serialised broke the whole injection
    // chain on WebView2 and on Electron alike.
    for (const script of createGuestScripts(claude, globals)) {
      expect(script.trimEnd().endsWith('undefined;')).toBe(true);
    }
  });

  /*
   * Electron answered `window.open` in its main process and Tauri has no such
   * hook, so both the ways a page asks for a window are reported instead --
   * and a `target="_blank"` click has to be one of them, because that is how
   * as many sign-ins start as start with `window.open`.
   */
  it('reports both ways a page asks for another window', () => {
    const [, , , windowOpener] = createGuestScripts(claude, globals);

    expect(windowOpener).toContain('window.open = function');
    expect(windowOpener).toContain("anchor.target !== '_blank'");
    expect(windowOpener).toContain('window["_bridge"].postMessage');
  });

  it('reports a right-click with everything the menu model reads', () => {
    const [, , , , menuReporter] = createGuestScripts(claude, globals);

    for (const field of ['canGoBack', 'canGoForward', 'linkUrl', 'isEditable']) {
      expect(menuReporter).toContain(field);
    }
    expect(menuReporter).toContain('"__menu__"');
  });
});

describe('createPopupScripts', () => {
  /*
   * A popup has no bridge to report to, so a link it cannot answer itself is a
   * dead end: the window has no address bar to type a way out of.
   */
  it('answers a window a popup opens by navigating the popup', () => {
    const [popupScript] = createPopupScripts();

    expect(popupScript).toContain('location.href');
    expect(popupScript).not.toContain('postMessage');
  });

  it('completes with undefined', () => {
    for (const script of createPopupScripts()) {
      expect(script.trimEnd().endsWith('undefined;')).toBe(true);
    }
  });
});

describe('createRunPromptScript', () => {
  it('embeds the selectors and the prompt as JSON literals', () => {
    const script = createRunPromptScript(claude, 'what is 2 + 2?', globals);

    expect(script).toContain('"[contenteditable]"');
    expect(script).toContain('"button[aria-label=\'Send message\']"');
    expect(script).toContain('"what is 2 + 2?"');
  });

  it('escapes a prompt that would otherwise break out of the script', () => {
    const script = createRunPromptScript(claude, '"; alert(1); //', globals);

    expect(script).toContain('"\\"; alert(1); //"');
  });

  it('completes with undefined', () => {
    expect(
      createRunPromptScript(claude, 'hi', globals).trimEnd().endsWith('undefined;'),
    ).toBe(true);
  });

  /*
   * Perplexity's input is Lexical and ChatGPT's and Claude's are ProseMirror.
   * Each keeps its own document model and reverts a direct `textContent`
   * write, so the page stayed empty -- and since these sites only render their
   * send button once there is text, the click found nothing to press.
   */
  it('types into a rich-text editor instead of overwriting its text', () => {
    const script = createRunPromptScript(claude, 'hi', globals);

    expect(script).not.toContain('input.textContent = inputValue');
    expect(script).toContain("document.execCommand('insertText', false, value)");
    // The fallback for when the embedded page does not hold focus, which is
    // the normal case: the prompt goes to every site and one of them is front.
    expect(script).toContain("inputType: 'insertText'");
  });

  /*
   * React keeps its own record of what it last rendered into a form field, and
   * a plain `input.value = ...` updates that record too, so the `input` event
   * behind it counts as a change to nothing. DeepSeek's send button stayed
   * greyed out, and the click then sent whatever had been in the box before.
   */
  it('writes into a form field underneath the value setter React swaps in', () => {
    const script = createRunPromptScript(claude, 'hi', globals);

    expect(script).toContain('setFormFieldValue(input, inputValue);');
    expect(script).toContain("Object.getOwnPropertyDescriptor(prototype, 'value').set");
    expect(script).not.toContain('input.value = inputValue;');
  });

  /*
   * Calling the page's own `onChange` with a hand-made event threw on
   * DeepSeek, which took the real events down with it.
   */
  it('leaves the page own change handler alone', () => {
    const script = createRunPromptScript(claude, 'hi', globals);

    expect(script).not.toContain('reactInstance.onChange');
    expect(script).toContain("['input', 'change', 'blur'].forEach");
  });

  /*
   * `selectionchange` only reaches the editor after the current task, so an
   * insert fired in the same breath as the selection was dropped outright.
   */
  it('selects what is already there before it types', () => {
    const script = createRunPromptScript(claude, 'hi', globals);

    expect(script).toContain('focusAndSelectAll(input);');
    expect(script).toContain('selection.addRange(range);');
  });
});
