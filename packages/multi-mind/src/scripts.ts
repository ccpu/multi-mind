import type { GuestGlobals } from './messages';
import type { WebsiteInfo } from './websites';
import {
  CANCEL_RESPONSE_MESSAGE,
  CLICKED_MESSAGE,
  MENU_MESSAGE_PREFIX,
} from './messages';

/** Reports every click inside a guest so the prompt panel can shrink. */
export function createClickReporterScript(
  { bridgeKey }: GuestGlobals,
  busySelector = '',
): string {
  return `
  document.addEventListener('click', function (event) {
    window[${JSON.stringify(bridgeKey)}].postMessage(${JSON.stringify(CLICKED_MESSAGE)});
    var target = event.target instanceof Element ? event.target : null;
    var button = target && target.closest('button, [role="button"]');
    var busySelector = ${JSON.stringify(busySelector)};
    try {
      if ((button && busySelector && button.matches(busySelector)) ||
          (target && target.closest('a[href]:not([target="_blank"])'))) {
        window[${JSON.stringify(bridgeKey)}].postMessage(${JSON.stringify(CANCEL_RESPONSE_MESSAGE)});
      }
    } catch (error) { /* Invalid custom selectors must not affect page clicks. */ }
  }, true);
`;
}

/**
 * Reports a right-click, with everything
 * {@link buildContextMenuModel} needs to decide what the menu should offer.
 *
 * Electron handed the main process a `ContextMenuParams` for this. Tauri has
 * no equivalent, so the page is asked instead, and the host builds the same
 * model from the answer.
 */
export function createContextMenuReporterScript({ bridgeKey }: GuestGlobals): string {
  const bridge = JSON.stringify(bridgeKey);
  const prefix = JSON.stringify(MENU_MESSAGE_PREFIX);

  return `
  document.addEventListener('contextmenu', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    var anchor = target === null ? null : target.closest('a[href]');
    var selection = String(window.getSelection() || '');
    var editable =
      target !== null &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA');

    function can(command) {
      try {
        return document.queryCommandEnabled(command);
      } catch (error) {
        return false;
      }
    }

    // The Navigation API answers this outright on Chromium, which is what
    // Windows runs. WebKit has no equivalent, so there the entries are offered
    // and a press that has nowhere to go is a harmless no-op.
    var nav = window.navigation;

    event.preventDefault();

    window[${bridge}].postMessage(
      ${prefix} +
        JSON.stringify({
          x: event.clientX,
          y: event.clientY,
          canGoBack: nav ? nav.canGoBack : history.length > 1,
          canGoForward: nav ? nav.canGoForward : true,
          linkUrl: anchor === null ? '' : anchor.href,
          hasImage: target !== null && target.tagName === 'IMG',
          imageUrl: target !== null && target.tagName === 'IMG' ? target.src : '',
          isEditable: editable,
          hasSelection: selection.trim() !== '',
          editFlags: {
            canCopy: selection.trim() !== '',
            canCut: editable && selection.trim() !== '',
            canPaste: editable,
            canRedo: can('redo'),
            canSelectAll: true,
            canUndo: can('undo')
          }
        })
    );
  });
`;
}

/** The shape {@link createContextMenuReporterScript} posts back. */
export interface GuestContextMenuReport {
  /** Where the click landed, in CSS pixels from the guest's top-left corner. */
  x: number;
  y: number;
  canGoBack: boolean;
  canGoForward: boolean;
  linkUrl: string;
  hasImage: boolean;
  imageUrl: string;
  isEditable: boolean;
  hasSelection: boolean;
  editFlags: {
    canCopy: boolean;
    canCut: boolean;
    canPaste: boolean;
    canRedo: boolean;
    canSelectAll: boolean;
    canUndo: boolean;
  };
}

/**
 * Tauri resolves `eval` with nothing at all, but the WebView2 and Electron
 * builds both rejected on a completion value that could not be serialised —
 * which a function or a DOM node cannot. Every injected script is still
 * terminated to complete with `undefined`, because a page's own CSP reporting
 * and a future runtime are both happier for it, and because it costs nothing.
 */
function asVoidScript(script: string): string {
  return `${script}\nundefined;\n`;
}

/** The two startup listeners retained for pane clicks and the custom context menu. */
export function createGuestScripts(
  website: WebsiteInfo,
  globals: GuestGlobals,
): string[] {
  return [
    createClickReporterScript(globals, website.responseSelectors.busySelector),
    createContextMenuReporterScript(globals),
  ].map(asVoidScript);
}

/** Popup navigation is handled by native callbacks without page scripts. */
export function createPopupScripts(): string[] {
  return [];
}

/**
 * The clipboard and history entries of the right-click menu, as a script to
 * run in the guest that was clicked.
 *
 * Electron aimed each of these at the exact `webContents` through a method of
 * its own — `contents.cut()`, `navigationHistory.goBack()`. Tauri's webview
 * has `reload` and nothing else, so the rest go through the page, which is
 * where `document.execCommand` has done this job since long before either.
 *
 * `paste` is the exception: Chromium refuses `execCommand('paste')` outright,
 * so the host reads the clipboard itself and the text is inserted instead.
 */
export function createEditCommandScript(command: string): string {
  return asVoidScript(`document.execCommand(${JSON.stringify(command)});`);
}

/** Inserts text the host read from the clipboard at the caret. */
export function createPasteScript(text: string): string {
  return asVoidScript(
    `document.execCommand('insertText', false, ${JSON.stringify(text)});`,
  );
}

/** `history.back()` / `history.forward()`, which is all Back and Forward are. */
export function createHistoryScript(direction: 'back' | 'forward'): string {
  return asVoidScript(`history.${direction}();`);
}

/**
 * Copies the image that was right-clicked.
 *
 * Electron had `copyImageAt`. Here the page fetches its own image and hands it
 * to the async clipboard, which is the only route a webview has. PNG because
 * that is the only bitmap type Chromium's clipboard writer accepts.
 */
export function createCopyImageScript(imageUrl: string): string {
  return asVoidScript(`
    (function () {
      var source = ${JSON.stringify(imageUrl)};

      if (!source) {
        return;
      }

      fetch(source)
        .then(function (response) { return response.blob(); })
        .then(function (blob) {
          if (blob.type === 'image/png') {
            return blob;
          }

          // Anything else goes through a canvas, because the clipboard takes
          // PNG and nothing else.
          return createImageBitmap(blob).then(function (bitmap) {
            var canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);

            return new Promise(function (resolve) {
              canvas.toBlob(resolve, 'image/png');
            });
          });
        })
        .then(function (png) {
          return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        })
        .catch(function (error) {
          console.error('Failed to copy the image:', error);
        });
    })();
  `);
}
