import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no matchMedia, and the theme code asks for the system preference.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

/*
 * jsdom implements the DOM a page needs and stops there. Everything below is a
 * browser API the app's own components reach for and jsdom does not have — so
 * the alternative to standing them up here is not testing those components.
 */

// Radix primitives (dropdown menus, selects, popovers) reach for pointer
// capture, scrolling and resize observation; the main window watches its panes
// with a ResizeObserver so it can tell Rust where to draw the browsers.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: window.ResizeObserver ?? ResizeObserverStub,
});

Object.assign(Element.prototype, {
  hasPointerCapture: Element.prototype.hasPointerCapture ?? (() => false),
  setPointerCapture: Element.prototype.setPointerCapture ?? (() => {}),
  releasePointerCapture: Element.prototype.releasePointerCapture ?? (() => {}),
  scrollIntoView: Element.prototype.scrollIntoView ?? (() => {}),
});

// jsdom has a `window.focus`, but it only logs that it is not implemented.
// CodeMirror calls it whenever the editor takes focus, which would otherwise
// bury every run in stack traces.
window.focus = () => {};

// CodeMirror (which EasyMDE builds on) measures text by asking a DOM Range for
// its rects. jsdom implements neither, and returns undefined for both.
function emptyRect() {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  };
}

Object.assign(Range.prototype, {
  getBoundingClientRect: Range.prototype.getBoundingClientRect ?? emptyRect,
  getClientRects:
    Range.prototype.getClientRects ?? (() => Object.assign([], { item: () => null })),
});
