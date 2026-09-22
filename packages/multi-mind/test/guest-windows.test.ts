import type { GuestWindowDisposition } from '../src/guest-windows';
import { describe, expect, it } from 'vitest';
import { decideGuestWindow } from '../src/guest-windows';

function decide(disposition: GuestWindowDisposition, url = 'https://example.com/docs') {
  return decideGuestWindow({ url, disposition });
}

describe('decideGuestWindow', () => {
  /*
   * A citation in a chat answer is a `target="_blank"` link, which Chromium
   * reports as a tab. Opening it in a bare app window is what made "open
   * link" mean something other than what the user asked for.
   */
  it('should send a link the user clicked to the system browser', () => {
    expect(decide('foreground-tab')).toBe('external');
    expect(decide('background-tab')).toBe('external');
    expect(decide('default')).toBe('external');
  });

  it('should send a download to the browser that has somewhere to put it', () => {
    expect(decide('save-to-disk')).toBe('external');
  });

  /*
   * Sign-in is the reason popups are allowed at all: an OAuth window opened
   * outside the app would authorise the wrong browser's session.
   */
  it('should keep a sized popup in the app, where sign-in can finish', () => {
    expect(decide('new-window')).toBe('popup');
  });

  it('should keep a disposition it cannot classify in the app', () => {
    expect(decide('other')).toBe('popup');
  });

  it('should open nothing for a target the shell should never be handed', () => {
    // eslint-disable-next-line no-script-url -- the point of the case is that this never leaves the app.
    expect(decide('foreground-tab', 'javascript:alert(1)')).toBe('block');
    expect(decide('new-window', 'data:text/html,<p>hi')).toBe('block');
    expect(decide('foreground-tab', 'file:///C:/Windows/system32')).toBe('block');
  });
});
