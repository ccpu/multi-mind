import type { WebsiteInfo } from '@internal/multi-mind';
import type { SearchConversation, SearchEntry } from '@internal/tauri-api';

/** Matches this early in a prompt are already within the two lines shown. */
const SNIPPET_VISIBLE = 48;
/** How much of a long prompt is kept before its first match. */
const SNIPPET_LEAD = 24;
const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
/** Older prompts show a date instead of an age. */
const DAYS_AS_AGE = 7;

export interface TextPart {
  text: string;
  match: boolean;
}

/** The lowercased words the search box matches, as the Rust side splits them. */
export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== '');
}

/** Conversations with a known provider and a captured address. */
export function openableConversations(
  entry: SearchEntry,
  websites: readonly WebsiteInfo[],
): SearchConversation[] {
  return entry.conversations.filter(
    (conversation) =>
      /^https?:\/\//iu.test(conversation.url) &&
      websites.some((website) => website.id === conversation.websiteId),
  );
}

/**
 * The prompt on one line, starting shortly before the first match when that
 * match would otherwise fall past the two lines a result shows.
 */
export function promptSnippet(prompt: string, terms: readonly string[]): string {
  const text = prompt.replace(/\s+/gu, ' ').trim();
  const lower = text.toLowerCase();
  const first = Math.min(
    ...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0),
  );
  if (!Number.isFinite(first) || first <= SNIPPET_VISIBLE) {
    return text;
  }
  const space = text.indexOf(' ', first - SNIPPET_LEAD);
  const start = space >= 0 && space < first ? space + 1 : first - SNIPPET_LEAD;
  return `…${text.slice(start)}`;
}

/** Splits text into matched and unmatched runs, case-insensitively. */
export function highlightParts(text: string, terms: readonly string[]): TextPart[] {
  const pattern = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('|');
  if (pattern === '') {
    return [{ text, match: false }];
  }
  // Text between matches holds no match, so a part matches only if all of it does.
  const whole = new RegExp(`^(?:${pattern})$`, 'iu');
  return text
    .split(new RegExp(`(${pattern})`, 'giu'))
    .filter((part) => part !== '')
    .map((part) => ({ text: part, match: whole.test(part) }));
}

/** A short age for a SQLite UTC timestamp, such as `5m ago` or a date. */
export function formatAge(createdAt: string, now = Date.now()): string {
  const time = Date.parse(`${createdAt.replace(' ', 'T')}Z`);
  if (Number.isNaN(time)) {
    return '';
  }
  const minutes = Math.floor((now - time) / MINUTE_MS);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days < DAYS_AS_AGE) {
    return `${days}d ago`;
  }
  return new Date(time).toLocaleDateString();
}
