import { describe, expect, it } from 'vitest';
import { decideGuestWindow } from '../src/guest-windows';

function decide(url: string) {
  return decideGuestWindow({ url });
}

describe('decideGuestWindow', () => {
  it('should open web links in the OS default browser', () => {
    expect(decide('https://accounts.google.com/o/oauth2/auth')).toBe('external');
    expect(decide('https://example.com/docs')).toBe('external');
    expect(decide('http://example.com/docs')).toBe('external');
  });

  it('should open nothing for a target no window should be given', () => {
    // eslint-disable-next-line no-script-url -- the point of the case is that this opens nothing.
    expect(decide('javascript:alert(1)')).toBe('block');
    expect(decide('data:text/html,<p>hi')).toBe('block');
    expect(decide('file:///C:/Windows/system32')).toBe('block');
  });
});
