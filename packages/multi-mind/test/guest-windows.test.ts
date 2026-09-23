import { describe, expect, it } from 'vitest';
import { decideGuestWindow } from '../src/guest-windows';

function decide(url: string) {
  return decideGuestWindow({ url });
}

describe('decideGuestWindow', () => {
  /*
   * The split this used to make — sized popups in, plain links out to the
   * system browser — could not tell a "Continue with Google" from a citation,
   * because sites open both the same way. A sign-in finished in the user's own
   * browser authorises a session the panes never get, so it is the case that
   * has to work; a link opened in the wrong place can still be right-clicked
   * out to the browser.
   */
  it('should keep everything a site opens in the app', () => {
    expect(decide('https://accounts.google.com/o/oauth2/auth')).toBe('popup');
    expect(decide('https://example.com/docs')).toBe('popup');
    expect(decide('http://example.com/docs')).toBe('popup');
  });

  it('should open nothing for a target no window should be given', () => {
    // eslint-disable-next-line no-script-url -- the point of the case is that this opens nothing.
    expect(decide('javascript:alert(1)')).toBe('block');
    expect(decide('data:text/html,<p>hi')).toBe('block');
    expect(decide('file:///C:/Windows/system32')).toBe('block');
  });
});
