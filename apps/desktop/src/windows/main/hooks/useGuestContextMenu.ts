import type {
  ContextMenuAction,
  ContextMenuEntry,
  GuestContextMenuReport,
} from '@internal/multi-mind';
import type { GuestBounds, NativeMenuEntry } from '@internal/tauri-api';
import {
  buildContextMenuModel,
  cookieBelongsToSite,
  cookieRemovalUrl,
  createCopyImageScript,
  createEditCommandScript,
  createHistoryScript,
  createPasteScript,
  siteHostname,
} from '@internal/multi-mind';
import { appApi, openExternal } from '@internal/tauri-api';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useCallback } from 'react';

/**
 * `Inspect Element` is offered in every build, not just a dev one: the
 * embedded sites break in ways only their own DevTools explain, and a packaged
 * app is where that happens. The Rust side turns the `devtools` feature on for
 * release builds so the entry has something to open.
 */
const ALLOW_INSPECT = true;

/** The menu model as Rust wants it: separators are entries with no action. */
function toNativeEntries(entries: readonly ContextMenuEntry[]): NativeMenuEntry[] {
  return entries.map((entry) =>
    entry.type === 'separator'
      ? { action: '', label: '', enabled: false }
      : { action: entry.action, label: entry.label, enabled: entry.enabled },
  );
}

/**
 * Clearing the cookies of one embedded site.
 *
 * All the browsers share one profile, so the profile-wide calls would sign the
 * user out of every one of them at once. Going cookie by cookie is what keeps
 * the other panes alone, and which cookies count as this site's is decided in
 * `@internal/multi-mind`, where it is tested — a `domain` filter would leave
 * behind exactly the parent-domain cookies a bot check tends to sit in.
 */
async function clearSiteCookies(websiteId: string, pageUrl: string): Promise<void> {
  const hostname = siteHostname(pageUrl);

  if (hostname === null) {
    return;
  }

  const stored = await appApi.guest.cookies(websiteId);
  const doomed = stored
    .filter((cookie) => cookieBelongsToSite(cookie.domain, hostname))
    .map((cookie) => ({ name: cookie.name, url: cookieRemovalUrl(cookie) }))
    .filter((cookie): cookie is { name: string; url: string } => cookie.url !== null);

  await appApi.guest.deleteCookies(websiteId, doomed);

  // The point of clearing them is the page that comes back without them.
  await appApi.guest.reload(websiteId);
}

async function runAction(
  action: ContextMenuAction,
  websiteId: string,
  report: GuestContextMenuReport,
  pageUrl: string,
): Promise<void> {
  const run = async (script: string) => appApi.guest.run(websiteId, script);

  switch (action) {
    case 'back':
      return run(createHistoryScript('back'));
    case 'forward':
      return run(createHistoryScript('forward'));
    case 'reload':
      return appApi.guest.reload(websiteId);
    case 'clearCookies':
      return clearSiteCookies(websiteId, pageUrl);
    case 'openLinkExternally':
      return openExternal(report.linkUrl);
    case 'copyLink':
      return writeText(report.linkUrl);
    case 'copyImage':
      return run(createCopyImageScript(report.imageUrl));
    case 'paste':
      // Chromium refuses `execCommand('paste')` outright, so the host reads
      // the clipboard and the text is inserted at the caret instead.
      return run(createPasteScript((await readText()) || ''));
    case 'undo':
    case 'redo':
    case 'cut':
    case 'copy':
    case 'selectAll':
      // Every one of these is named the same as the `execCommand` it maps to.
      return run(createEditCommandScript(action));
    case 'inspect':
      return appApi.guest.openDevtools(websiteId);
    default:
      return undefined;
  }
}

export interface UseGuestContextMenuOptions {
  /** Where the site's pane sits, so a click in it becomes a window point. */
  boundsOf: (websiteId: string) => GuestBounds | null;
}

/**
 * The right-click menu over an embedded site.
 *
 * WebView2 came with a browser menu built in, so the WinForms build never had
 * to think about it; neither an Electron `<webview>` nor a Tauri child webview
 * has one, which leaves the sites with no way to go back or reload.
 *
 * The menu is still decided by `buildContextMenuModel`, which is where it can
 * be tested. What changed is who draws it: Electron popped it from the main
 * process off a `ContextMenuParams`, and here the guest reports the same facts
 * about the click, the window builds the model, and Rust draws the native menu
 * because the page underneath a child webview cannot.
 */
export function useGuestContextMenu({
  boundsOf,
}: UseGuestContextMenuOptions): (
  websiteId: string,
  report: GuestContextMenuReport,
) => Promise<void> {
  return useCallback(
    async (websiteId: string, report: GuestContextMenuReport): Promise<void> => {
      const pageUrl = await appApi.guest.url(websiteId);

      const model = buildContextMenuModel({
        isBrowser: true,
        hasSiteCookies: siteHostname(pageUrl) !== null,
        canGoBack: report.canGoBack,
        canGoForward: report.canGoForward,
        linkUrl: report.linkUrl,
        hasImage: report.hasImage,
        isEditable: report.isEditable,
        hasSelection: report.hasSelection,
        editFlags: report.editFlags,
        canInspect: ALLOW_INSPECT,
      });

      // A click on plain page text with nothing to inspect, copy or navigate
      // leaves nothing to offer, and an empty menu flashing open is worse than
      // none.
      if (model.length === 0) {
        return;
      }

      // The guest measures the click from its own top-left corner; the menu is
      // placed from the window's.
      const pane = boundsOf(websiteId) ?? { x: 0, y: 0, width: 0, height: 0 };
      const action = await appApi.guest.popupMenu(toNativeEntries(model), {
        x: pane.x + report.x,
        y: pane.y + report.y,
      });

      if (action !== null) {
        await runAction(action, websiteId, report, pageUrl);
      }
    },
    [boundsOf],
  );
}
