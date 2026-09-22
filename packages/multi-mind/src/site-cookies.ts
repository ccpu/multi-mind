/**
 * Clearing the cookies of one embedded site.
 *
 * A bot check that keeps re-asking, or a sign-in that half-finished, is almost
 * always a stale cookie, and the only fix from inside the app was to throw the
 * whole shared browser profile away — which signs the user out of every other
 * site at the same time. The right-click menu offers to clear one site
 * instead, and these are the two decisions that takes.
 *
 * They live here, away from the shell, because a cookie API is easy to use in
 * a way that quietly misses cookies: a `domain` filter of `www.example.com`
 * does not match a cookie set on `.example.com`, and removing one takes a URL
 * the cookie itself would be sent to rather than the URL the page is showing.
 */

/** The fields of a stored cookie that clearing one depends on. */
export interface SiteCookie {
  readonly name: string;
  readonly domain?: string;
  readonly path?: string;
  readonly secure?: boolean;
}

/** A cookie domain as a host name: the leading dot is scope, not part of it. */
function toHost(domain: string): string {
  return domain.trim().replace(/^\./u, '').toLowerCase();
}

/**
 * Whether a cookie is one the user would call "this site's".
 *
 * That is wider than the set the page is sent: a cookie on `.example.com` and
 * one on `api.example.com` both belong to `www.example.com` as far as anyone
 * clearing cookies is concerned, and leaving either behind is what makes a bot
 * check come straight back.
 */
export function cookieBelongsToSite(cookieDomain: string, hostname: string): boolean {
  const host = toHost(cookieDomain);
  const site = toHost(hostname);

  if (host === '' || site === '') {
    return false;
  }

  return host === site || host.endsWith(`.${site}`) || site.endsWith(`.${host}`);
}

/**
 * The URL the delete has to be given, built from the cookie rather than from
 * the page: a cookie scoped to `/api` is not removed through a URL at `/`,
 * and a `Secure` one is not removed through `http`.
 *
 * Null for a cookie with no domain at all, which there is no URL to name.
 */
export function cookieRemovalUrl(cookie: SiteCookie): string | null {
  const host = toHost(cookie.domain ?? '');

  if (host === '') {
    return null;
  }

  const scheme = cookie.secure === true ? 'https' : 'http';
  const path = cookie.path ?? '/';

  return `${scheme}://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The host whose cookies a right-click on a given page should clear. */
export function siteHostname(pageUrl: string): string | null {
  try {
    const { hostname, protocol } = new URL(pageUrl);

    // `about:blank` and friends have no cookies to speak of.
    return protocol === 'http:' || protocol === 'https:' ? hostname : null;
  } catch {
    return null;
  }
}
