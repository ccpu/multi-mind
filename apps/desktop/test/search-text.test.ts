import type { WebsiteInfo } from '@internal/multi-mind';
import { DEFAULT_WEBSITES } from '@internal/multi-mind';
import { describe, expect, it } from 'vitest';
import {
  formatAge,
  highlightParts,
  openableConversations,
  promptSnippet,
  searchTerms,
} from '../src/windows/main/components/search/search-text';

describe('search text', () => {
  it('splits a query into lowercased words', () => {
    expect(searchTerms('  GitHub   cache ')).toEqual(['github', 'cache']);
    expect(searchTerms('   ')).toEqual([]);
  });

  it('marks every term case-insensitively, treating regex characters as text', () => {
    expect(highlightParts('Use C++ cache in GitHub', ['github', 'c++'])).toEqual([
      { text: 'Use ', match: false },
      { text: 'C++', match: true },
      { text: ' cache in ', match: false },
      { text: 'GitHub', match: true },
    ]);
    expect(highlightParts('plain', [])).toEqual([{ text: 'plain', match: false }]);
  });

  it('starts a long prompt shortly before its first match', () => {
    const prompt = `${'lorem ipsum '.repeat(10)}the  github cache question`;

    expect(promptSnippet(prompt, ['cache'])).toBe(
      '…lorem ipsum the github cache question',
    );
    expect(promptSnippet('short github prompt', ['github'])).toBe('short github prompt');
    expect(promptSnippet(prompt, ['missing'])).toBe(prompt.replace(/\s+/gu, ' ').trim());
  });

  it('only opens conversations with an address and a known provider', () => {
    const websites: readonly WebsiteInfo[] = DEFAULT_WEBSITES;
    const conversations = [
      { id: 1, websiteId: 'claude', title: '', url: 'https://claude.ai/chat/1' },
      { id: 2, websiteId: 'chatgpt', title: '', url: '' },
      { id: 3, websiteId: 'removed', title: '', url: 'https://example.com/c/1' },
    ];

    expect(
      openableConversations(
        { id: 1, prompt: '', createdAt: '', conversations },
        websites,
      ).map((conversation) => conversation.id),
    ).toEqual([1]);
  });

  it('formats the age of a SQLite UTC timestamp', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');

    expect(formatAge('2026-09-26 11:59:40', now)).toBe('just now');
    expect(formatAge('2026-09-26 11:15:00', now)).toBe('45m ago');
    expect(formatAge('2026-09-26 07:00:00', now)).toBe('5h ago');
    expect(formatAge('2026-09-23 12:00:00', now)).toBe('3d ago');
    expect(formatAge('not a date', now)).toBe('');
  });
});
