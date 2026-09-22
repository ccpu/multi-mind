import { describe, expect, it } from 'vitest';
import { formatBytes, truncate } from '../src/format';

describe('formatBytes', () => {
  it('formats whole bytes without decimals', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('scales to the largest fitting unit', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('handles zero and nonsense input', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('counts the ellipsis against the budget', () => {
    expect(truncate('hello world', 6)).toBe('hello\u2026');
  });
});
