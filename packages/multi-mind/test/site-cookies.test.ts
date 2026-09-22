import { describe, expect, it } from 'vitest';
import { cookieBelongsToSite, cookieRemovalUrl, siteHostname } from '../src/site-cookies';

describe('cookieBelongsToSite', () => {
  it('should match the site itself, with or without the scope dot', () => {
    expect(cookieBelongsToSite('claude.ai', 'claude.ai')).toBe(true);
    expect(cookieBelongsToSite('.claude.ai', 'claude.ai')).toBe(true);
  });

  /*
   * The one a bot check tends to sit in: the page is on `www.`, the cookie is
   * on the parent, and a naive `domain` filter would not return it.
   */
  it('should match a cookie set on a parent domain', () => {
    expect(cookieBelongsToSite('.perplexity.ai', 'www.perplexity.ai')).toBe(true);
  });

  it('should match a cookie set on a subdomain', () => {
    expect(cookieBelongsToSite('api.claude.ai', 'claude.ai')).toBe(true);
  });

  it('should not match a different site that ends the same way', () => {
    expect(cookieBelongsToSite('notclaude.ai', 'claude.ai')).toBe(false);
    expect(cookieBelongsToSite('claude.ai.example.com', 'claude.ai')).toBe(false);
  });

  it('should ignore case, which a cookie domain is not sensitive to', () => {
    expect(cookieBelongsToSite('.Claude.AI', 'claude.ai')).toBe(true);
  });

  it('should match nothing when either side is empty', () => {
    expect(cookieBelongsToSite('', 'claude.ai')).toBe(false);
    expect(cookieBelongsToSite('claude.ai', '')).toBe(false);
  });
});

describe('cookieRemovalUrl', () => {
  it('should drop the scope dot, which is not part of a host name', () => {
    expect(cookieRemovalUrl({ name: 'cf_clearance', domain: '.claude.ai' })).toBe(
      'http://claude.ai/',
    );
  });

  it('should use https for a Secure cookie, which http cannot remove', () => {
    expect(
      cookieRemovalUrl({ name: 'cf_clearance', domain: '.claude.ai', secure: true }),
    ).toBe('https://claude.ai/');
  });

  it('should keep the path, because a cookie scoped to one is not removed at /', () => {
    expect(cookieRemovalUrl({ name: 'token', domain: 'claude.ai', path: '/api' })).toBe(
      'http://claude.ai/api',
    );
  });

  it('should have no URL to offer for a cookie with no domain', () => {
    expect(cookieRemovalUrl({ name: 'token' })).toBeNull();
  });
});

describe('siteHostname', () => {
  it('should read the host out of a page URL', () => {
    expect(siteHostname('https://claude.ai/new')).toBe('claude.ai');
  });

  it('should refuse a scheme that has no cookies to clear', () => {
    expect(siteHostname('about:blank')).toBeNull();
    expect(siteHostname('file:///C:/app/index.html')).toBeNull();
    expect(siteHostname('')).toBeNull();
  });
});
