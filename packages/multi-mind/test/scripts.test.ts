import type { GuestGlobals } from '../src/messages';
import { describe, expect, it } from 'vitest';
import { createGuestGlobals } from '../src/messages';
import { createGuestScripts, createPopupScripts } from '../src/scripts';
import { DEFAULT_WEBSITES } from '../src/websites';

const claude = DEFAULT_WEBSITES.find((website) => website.name === 'claude')!;

// Fixed here so the assertions can name them; at runtime they are generated.
const globals: GuestGlobals = {
  bridgeKey: '_bridge',
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
  it('only installs click and context-menu reporters, without persistent automation', () => {
    const scripts = createGuestScripts(claude, globals);
    expect(scripts).toHaveLength(2);
    const source = scripts.join('\n');
    for (const forbidden of [
      '_find',
      'window.open =',
      'MutationObserver',
      'setInterval',
      'setTimeout',
      'keydown',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('reports clicks through the host bridge', () => {
    const [clickReporter] = createGuestScripts(claude, globals);

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
  it('reports user stop clicks so the host cancels response polling', () => {
    const [clickReporter] = createGuestScripts(claude, globals);
    expect(clickReporter).toContain('__cancel_response__');
    expect(clickReporter).toContain('button.matches(busySelector)');
  });

  it('reports a right-click with everything the menu model reads', () => {
    const [, menuReporter] = createGuestScripts(claude, globals);

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
  it('leaves popup handling to native browser callbacks', () => {
    expect(createPopupScripts()).toStrictEqual([]);
  });

  it('completes with undefined', () => {
    for (const script of createPopupScripts()) {
      expect(script.trimEnd().endsWith('undefined;')).toBe(true);
    }
  });
});
