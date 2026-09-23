import type { GuestGlobals } from './messages';
import type { WebsiteInfo } from './websites';
import {
  CLICKED_MESSAGE,
  CTRL_ENTER_MESSAGE,
  MENU_MESSAGE_PREFIX,
  OPEN_MESSAGE_PREFIX,
} from './messages';

/**
 * Port of the scripts `WebViewManager.LoadScriptsAsync` pushed into each
 * WebView2 after `NavigationCompleted`, and of the prompt runner in
 * `WebViewManager.RunPropt`. The only change is the transport: the WinForms
 * build posted to `window.chrome.webview`, this one posts to the bridge the
 * Rust side installs under {@link GuestGlobals.bridgeKey}.
 *
 * The Electron port re-ran the whole set from the host after every completed
 * navigation. Tauri takes them once, as a webview's initialization script, and
 * runs them itself before each page's own scripts — which is both earlier and
 * one fewer thing to get wrong when a site navigates on its own.
 */

/**
 * Shadow-root-aware `querySelector`. The original declared this as a bare
 * function so later `ExecuteScriptAsync` calls could reuse it; here it is
 * pinned to `window` so the same is guaranteed across separate `eval` calls.
 */
export function createFindHelperScript({ findKey }: GuestGlobals): string {
  return `
  window[${JSON.stringify(findKey)}] = function findInDocumentOrShadowRoots(selector, rootNode = document.body) {
    const mainDocumentResult = rootNode.querySelector(selector);
    if (mainDocumentResult) {
      return mainDocumentResult;
    }

    function traverseAndFind(node) {
      if (node.shadowRoot) {
        const found = node.shadowRoot.querySelector(selector);
        if (found) {
          return found;
        }
        const shadowResult = traverseChildren(node.shadowRoot);
        if (shadowResult) {
          return shadowResult;
        }
      }

      // Traverse child elements
      return traverseChildren(node);
    }

    function traverseChildren(parent) {
      const children = parent.children;
      for (let i = 0; i < children.length; i++) {
        const result = traverseAndFind(children[i]);
        if (result) {
          return result;
        }
      }
      return null;
    }

    return traverseAndFind(rootNode);
  };
`;
}

/** Reports every click inside a guest so the prompt panel can shrink. */
export function createClickReporterScript({ bridgeKey }: GuestGlobals): string {
  return `
  document.addEventListener('click', function () {
    window[${JSON.stringify(bridgeKey)}].postMessage(${JSON.stringify(CLICKED_MESSAGE)});
  });
`;
}

/** Forwards Ctrl+Enter pressed inside a guest to the host. */
export function createCtrlEnterReporterScript({ bridgeKey }: GuestGlobals): string {
  return `
  setTimeout(function () {
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        window[${JSON.stringify(bridgeKey)}].postMessage(${JSON.stringify(CTRL_ENTER_MESSAGE)});
        return false;
      }
    }, true);
  }, 1000);
`;
}

/**
 * Hands anything the page wants to open in another window to the host.
 *
 * Electron answered this in the main process, out of `setWindowOpenHandler`.
 * A Tauri webview has no such hook — a `window.open` simply opens nothing, and
 * a `target="_blank"` click goes nowhere — so both are reported instead, and
 * {@link decideGuestWindow} decides what the window does about them.
 */
export function createGuestWindowScript({ bridgeKey }: GuestGlobals): string {
  const bridge = JSON.stringify(bridgeKey);
  const prefix = JSON.stringify(OPEN_MESSAGE_PREFIX);

  return `
  (function () {
    function request(url) {
      if (!url) {
        return;
      }

      window[${bridge}].postMessage(
        ${prefix} + JSON.stringify({ url: new URL(url, location.href).href })
      );
    }

    var nativeOpen = window.open;

    window.open = function (url) {
      request(url);

      // Nothing is opened here, but a caller that reads the return value has
      // to get an answer back rather than a crash. A sign-in flow that polls
      // the handle it was given sees a window it cannot reach, which is what
      // it would see for a blocked popup — and what it did before this.
      return null;
    };
    window.open.toString = function () { return nativeOpen.toString(); };

    document.addEventListener(
      'click',
      function (event) {
        var anchor = event.target instanceof Element
          ? event.target.closest('a[href]')
          : null;

        if (anchor === null || anchor.target !== '_blank') {
          return;
        }

        event.preventDefault();
        request(anchor.href);
      },
      true
    );
  })();
`;
}

/**
 * What runs inside one of those windows once it is open.
 *
 * A popup is a plain Tauri window with no bridge and no capability, so it
 * cannot ask the app for anything — and, like a pane, it opens nothing of its
 * own accord. A sign-in that steps through a second `window.open`, or a page
 * whose every link is `target="_blank"`, would dead-end in a window with no
 * address bar to type its way out of.
 *
 * Needing no host for that is the point: a popup is already the window the
 * link asked for, so it answers both by navigating itself.
 */
export function createPopupWindowScript(): string {
  return `
  (function () {
    function go(url) {
      if (url) {
        location.href = new URL(url, location.href).href;
      }
    }

    var nativeOpen = window.open;

    window.open = function (url) {
      go(url);

      // The caller asked for a window and got this one.
      return window;
    };
    window.open.toString = function () { return nativeOpen.toString(); };

    document.addEventListener(
      'click',
      function (event) {
        var anchor = event.target instanceof Element
          ? event.target.closest('a[href]')
          : null;

        if (anchor === null || anchor.target !== '_blank') {
          return;
        }

        event.preventDefault();
        go(anchor.href);
      },
      true
    );
  })();
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

/**
 * Every script `LoadScriptsAsync` ran, in order, plus the two the Electron
 * port answered in its main process and Tauri has no hook for. The query
 * helper goes in first because {@link createRunPromptScript} calls it on every
 * send and cannot install it itself: it runs as its own evaluation, long after
 * these.
 *
 * `LoadScriptsAsync` also installed a mirror that echoed whatever was typed
 * into the site's own compose box back into the host prompt box. It is gone.
 * Finding the box meant walking the document and every shadow root under it,
 * on a retry that never gave up, so a site whose selector had gone stale — or
 * one sitting on a sign-in screen, which has no compose box at all — ran that
 * walk every four seconds for as long as the app stayed open, in each guest,
 * which is enough on its own to keep a renderer from going idle.
 */
export function createGuestScripts(
  _website: WebsiteInfo,
  globals: GuestGlobals,
): string[] {
  return [
    createFindHelperScript(globals),
    createClickReporterScript(globals),
    createCtrlEnterReporterScript(globals),
    createGuestWindowScript(globals),
    createContextMenuReporterScript(globals),
  ].map(asVoidScript);
}

/**
 * The scripts a popup window opened for a guest is built with.
 *
 * A popup is on the same profile as the panes but is nobody's guest: it has no
 * bridge to report to and no site whose selectors would mean anything, so the
 * only thing it needs is to stop being a dead end.
 */
export function createPopupScripts(): string[] {
  return [createPopupWindowScript()].map(asVoidScript);
}

/** Port of the `script2` template in `WebViewManager.RunPropt`. */
export function createRunPromptScript(
  website: WebsiteInfo,
  prompt: string,
  { findKey }: GuestGlobals,
): string {
  const inputSelector = JSON.stringify(website.inputSelector);
  const buttonSelector = JSON.stringify(website.buttonSelector);
  const promptLiteral = JSON.stringify(prompt);
  const find = JSON.stringify(findKey);

  return asVoidScript(`
    (function () {
      /** A native form field takes a plain \`value\` write; nothing else does. */
      function isFormField(input) {
        return input.tagName === 'TEXTAREA' || input.tagName === 'INPUT';
      }

      function readValue(input) {
        return isFormField(input) ? input.value : input.innerText;
      }

      /**
       * Puts the caret in the input and selects whatever is already there, so
       * the insert below replaces it rather than appending to it.
       */
      function focusAndSelectAll(input) {
        input.focus();

        if (isFormField(input)) {
          input.select();
          return;
        }

        var selection = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      /**
       * React replaces a form field's own \`value\` setter with one that records
       * what it last rendered, so assigning to \`input.value\` updates that
       * record too and the \`input\` event fired afterwards is dismissed as a
       * change to nothing. DeepSeek's send button stayed greyed out for
       * exactly that reason, and a greyed-out button ignores the click below.
       * The prototype's setter goes underneath the record, which is what lets
       * the event through.
       */
      function setFormFieldValue(input, value) {
        var prototype = input.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

        setter.call(input, value);
      }

      /**
       * Writes into a rich-text editor the way the browser does when a key is
       * pressed. Perplexity's input is Lexical, ChatGPT's and Claude's are
       * ProseMirror; each keeps its own document model, ignores a direct
       * \`textContent\` write and reverts it on the next tick. The page then
       * still counts as empty, and since these sites only render their send
       * button once there is text, the click below found nothing to press.
       */
      function insertText(input, value) {
        document.execCommand('insertText', false, value);

        setTimeout(function () {
          if (readValue(input).indexOf(value) !== -1) {
            return;
          }

          // execCommand is refused when the embedded page does not hold focus,
          // which is the normal case here: the prompt goes to every site at
          // once and only one of them can be the focused one. This is the
          // event execCommand would have sent.
          input.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: value
          }));
        }, 100);
      }

      /**
       * The original also reached into the element's \`__reactProps\` and called
       * the page's own \`onChange\` with a hand-made event first. DeepSeek's
       * handler wants a real synthetic event and threw on the stand-in, which
       * took the dispatch below down with it -- leaving whatever was in the box
       * beforehand to be sent instead of the prompt. It was only ever there to
       * work around the \`value\` write not registering, which
       * {@link setFormFieldValue} now handles at the source.
       */
      function triggerInputEvent(input) {
        ['input', 'change', 'blur'].forEach(eventType => {
          const event = new Event(eventType, { bubbles: true, cancelable: true });
          input.dispatchEvent(event);
        });
      }

      try {
        var input = window[${find}](${inputSelector});
        if (!input) throw new Error("Unable to find input '" + ${inputSelector} + "'");
        var inputValue = ${promptLiteral};

        focusAndSelectAll(input);

        window.setTimeout(() => {
          try {
            // Selecting fires \`selectionchange\` asynchronously, and an editor
            // that tracks its own selection only learns where the caret is
            // when that arrives. Inserting any sooner is dropped outright.
            if (isFormField(input)) {
              setFormFieldValue(input, inputValue);
              triggerInputEvent(input);
            } else {
              insertText(input, inputValue);
            }
          } catch (error) {
            console.error(error.message)
          }
        }, 150);

        setTimeout(() => {
          try {
            var submitButton = window[${find}](${buttonSelector});
            if (!submitButton) throw new Error("Unable to find submit button '" + ${buttonSelector} + "'");
            submitButton.disabled = false;
            submitButton.click();
          } catch (error) {
            console.error(error.message)
          }
        }, 1200);

      } catch (error) {
        console.error(error.message)
      }
    })();
  `);
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
