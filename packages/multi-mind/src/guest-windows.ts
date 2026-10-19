/** What an embedded site is allowed to open in the OS default browser. */

export type GuestWindowDecision =
  /** Open it in the OS default browser. */
  | 'external'
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

/** Route web links to the default browser and block other protocols. */
export function decideGuestWindow({ url }: GuestWindowRequest): GuestWindowDecision {
  return isWebUrl(url) ? 'external' : 'block';
}
