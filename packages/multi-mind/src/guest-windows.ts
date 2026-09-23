/**
 * What an embedded site is allowed to open, and where.
 *
 * WebView2 gave the WinForms build one answer for everything: `window.open`
 * made a real window, inside the app, on the app's profile. That is what kept
 * sign-in working, because a sign-in finished in a browser the app cannot see
 * authorises a session the panes never get.
 *
 * The Tauri port briefly tried to be cleverer — sized popups stayed in, plain
 * links were handed to the system browser, the way Chromium's own disposition
 * splits them. Sites do not cooperate: a "Continue with Google" is as likely
 * to be a bare `window.open` or an `<a target="_blank">` as a sized one, so
 * the split sent sign-ins to the user's browser, where they are useless.
 *
 * So the WinForms answer is back. Everything opens in the app, sharing the
 * guest profile, and the right-click menu's "Open Link in Browser" is the one
 * deliberate way out to the system browser.
 */

export type GuestWindowDecision =
  /** Open it here, in a window on the guest profile. */
  | 'popup'
  /** Not something a window should be given. */
  | 'block';

export interface GuestWindowRequest {
  readonly url: string;
}

/**
 * Only web links are worth opening; a `javascript:` or `data:` target would
 * either do nothing or hand a window something odd.
 */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//iu.test(url);
}

export function decideGuestWindow({ url }: GuestWindowRequest): GuestWindowDecision {
  return isWebUrl(url) ? 'popup' : 'block';
}
