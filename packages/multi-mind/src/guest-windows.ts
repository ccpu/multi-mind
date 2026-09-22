/**
 * What an embedded site is allowed to open, and where.
 *
 * WebView2 gave the WinForms build one answer for everything: `window.open`
 * made a real window. That kept sign-in working, but it also meant a citation
 * in a chat answer opened in a bare app window with no address bar, no history
 * and no bookmarks — which is not what "open link" means to anyone.
 *
 * The line this needs is the one Chromium draws in the disposition it reports:
 * a `window.open` given a size is a popup, and a link the user clicked is a
 * tab. Sign-in flows are the first, so they stay in the app; a link is the
 * second, and belongs in the browser the user actually chose.
 *
 * A Tauri webview reports no disposition of its own, so the guest script in
 * {@link createGuestWindowScript} works one out the same way Chromium does —
 * from whether `window.open` was given window features — and the host decides
 * from that, exactly as the Electron port decided from Chromium's answer.
 */

/** The dispositions Chromium distinguishes, as the guest script reports them. */
export type GuestWindowDisposition =
  | 'background-tab'
  | 'default'
  | 'foreground-tab'
  | 'new-window'
  | 'other'
  | 'save-to-disk';

export type GuestWindowDecision =
  /** Hand it to the system browser and open nothing here. */
  | 'external'
  /** Open the in-app window WebView2 would have, for sign-in and the like. */
  | 'popup'
  /** Neither: not something the shell or a window should be given. */
  | 'block';

export interface GuestWindowRequest {
  readonly url: string;
  readonly disposition: GuestWindowDisposition;
}

/**
 * Sized popups, plus the bucket used when the kind cannot be told. Keeping an
 * unknown disposition in the app is the cautious way round: a sign-in that
 * opens in the wrong place cannot be finished, while a link that opens in the
 * wrong place can still be right-clicked out to the browser.
 */
const IN_APP_DISPOSITIONS = new Set<GuestWindowDisposition>(['new-window', 'other']);

/**
 * Only web links are worth handing to the system browser; a `javascript:` or
 * `data:` target would either do nothing or hand the shell something odd.
 */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//iu.test(url);
}

export function decideGuestWindow({
  url,
  disposition,
}: GuestWindowRequest): GuestWindowDecision {
  if (!isWebUrl(url)) {
    return 'block';
  }

  return IN_APP_DISPOSITIONS.has(disposition) ? 'popup' : 'external';
}
