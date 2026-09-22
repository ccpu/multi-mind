/**
 * The shape of the right-click menu, decided away from the shell so it can be
 * tested on its own and the Rust side is left with nothing but the wiring.
 *
 * Two menus come out of here. The embedded AI chat sites get a browser menu —
 * back, forward, reload, and the one thing a browser keeps behind a settings
 * page that an app with no address bar has nowhere else to put: clearing the
 * site's cookies. WebView2 gave the WinForms build the first three for free;
 * a Tauri child webview, like an Electron `<webview>`, comes with none of
 * them. The app's own windows get the clipboard items, plus `Inspect
 * Element`, which a packaged build offers too: an embedded site misbehaving
 * is exactly what it is for.
 */

/** What a chosen entry does; the host window maps these onto guest commands. */
export type ContextMenuAction =
  | 'back'
  | 'clearCookies'
  | 'copy'
  | 'copyImage'
  | 'copyLink'
  | 'cut'
  | 'forward'
  | 'inspect'
  | 'openLinkExternally'
  | 'paste'
  | 'redo'
  | 'reload'
  | 'selectAll'
  | 'undo';

export interface ContextMenuItem {
  readonly type: 'item';
  readonly action: ContextMenuAction;
  readonly label: string;
  readonly enabled: boolean;
}

export interface ContextMenuSeparator {
  readonly type: 'separator';
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

/** The subset of the click's edit flags the menu actually reads. */
export interface ContextMenuEditFlags {
  readonly canCopy: boolean;
  readonly canCut: boolean;
  readonly canPaste: boolean;
  readonly canRedo: boolean;
  readonly canSelectAll: boolean;
  readonly canUndo: boolean;
}

/** Everything about the click that changes what the menu should offer. */
export interface ContextMenuState {
  /** True for the embedded sites, which are the only ones that navigate. */
  readonly isBrowser: boolean;
  /** False on a page whose scheme has no cookies, such as `about:blank`. */
  readonly hasSiteCookies: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** The link under the pointer, if the click landed on one. */
  readonly linkUrl: string;
  readonly hasImage: boolean;
  readonly isEditable: boolean;
  readonly hasSelection: boolean;
  readonly editFlags: ContextMenuEditFlags;
  /** Opens Chrome DevTools on the element clicked. */
  readonly canInspect: boolean;
}

const SEPARATOR: ContextMenuSeparator = { type: 'separator' };

function item(action: ContextMenuAction, label: string, enabled = true): ContextMenuItem {
  return { type: 'item', action, label, enabled };
}

/**
 * Only web links are worth handing to the system browser; a `javascript:` or
 * `data:` href would either do nothing or hand the shell something odd.
 */
function isWebLink(linkUrl: string): boolean {
  return /^https?:\/\//iu.test(linkUrl);
}

function editEntries(state: ContextMenuState): ContextMenuEntry[] {
  const { canCopy, canCut, canPaste, canRedo, canSelectAll, canUndo } = state.editFlags;

  if (state.isEditable) {
    return [
      item('undo', 'Undo', canUndo),
      item('redo', 'Redo', canRedo),
      SEPARATOR,
      item('cut', 'Cut', canCut),
      item('copy', 'Copy', canCopy),
      item('paste', 'Paste', canPaste),
      item('selectAll', 'Select All', canSelectAll),
    ];
  }

  // Outside a text box there is nothing to copy without a selection, so the
  // clipboard items are left out rather than shown greyed.
  return state.hasSelection ? [item('copy', 'Copy', canCopy)] : [];
}

/**
 * Separators only make sense between sections, so the ones left over by a
 * section that produced no items are dropped.
 */
function tidy(entries: ContextMenuEntry[]): ContextMenuEntry[] {
  const kept = entries.reduce<ContextMenuEntry[]>((result, entry) => {
    const previous = result.at(-1);
    const isDangling =
      entry.type === 'separator' &&
      (previous === undefined || previous.type === 'separator');

    return isDangling ? result : [...result, entry];
  }, []);

  return kept.at(-1)?.type === 'separator' ? kept.slice(0, -1) : kept;
}

/** Builds the entries for one right-click, in the order they are shown. */
export function buildContextMenuModel(state: ContextMenuState): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [];

  if (state.isBrowser) {
    entries.push(
      item('back', 'Back', state.canGoBack),
      item('forward', 'Forward', state.canGoForward),
      item('reload', 'Reload'),
      // A bot check that keeps re-asking, or a sign-in stuck half-done, is a
      // stale cookie; this is the way out of one without signing out of the
      // sites in the panes next to it. Only offered on a real page, because
      // `about:blank` has no cookies to clear.
      item('clearCookies', 'Clear Cookies and Reload', state.hasSiteCookies),
      SEPARATOR,
    );
  }

  if (isWebLink(state.linkUrl)) {
    entries.push(
      item('openLinkExternally', 'Open Link in Browser'),
      item('copyLink', 'Copy Link Address'),
      SEPARATOR,
    );
  }

  if (state.hasImage) {
    entries.push(item('copyImage', 'Copy Image'), SEPARATOR);
  }

  entries.push(...editEntries(state), SEPARATOR);

  if (state.canInspect) {
    entries.push(item('inspect', 'Inspect Element'));
  }

  return tidy(entries);
}
