import { describe, expect, it } from 'vitest';
import { err, ok, toResult } from '../src/result';

describe('toResult', () => {
  it('wraps a resolved value', async () => {
    await expect(toResult(Promise.resolve(1))).resolves.toStrictEqual(ok(1));
  });

  it('captures a rejected Error as its message', async () => {
    await expect(toResult(Promise.reject(new Error('boom')))).resolves.toStrictEqual(
      err('boom'),
    );
  });

  it('stringifies a non-Error rejection', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    await expect(toResult(Promise.reject('plain'))).resolves.toStrictEqual(err('plain'));
  });
});
