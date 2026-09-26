import type { WebsiteInfo } from '@internal/multi-mind';
import type { SearchConversation, SearchEntry } from '@internal/tauri-api';
import { cn } from '@pixpilot/shadcn';
import { Fragment } from 'react';
import {
  formatAge,
  highlightParts,
  openableConversations,
  promptSnippet,
} from './search-text';

interface SearchResultItemProps {
  id: string;
  entry: SearchEntry;
  terms: readonly string[];
  websites: readonly WebsiteInfo[];
  /** Picked with the arrow keys or the pointer; Enter opens it. */
  active: boolean;
  onHover: () => void;
  onOpen: (conversations: readonly SearchConversation[]) => void;
}

function describe(conversation: SearchConversation, website: WebsiteInfo | undefined) {
  if (website === undefined) {
    return 'Provider unavailable';
  }
  if (conversation.url === '') {
    return 'Waiting for the conversation address';
  }
  return conversation.title || conversation.url;
}

/**
 * One saved prompt, with the providers it was sent to listed after it. The
 * prompt opens every conversation it started; a provider name opens just that
 * one.
 */
export function SearchResultItem({
  id,
  entry,
  terms,
  websites,
  active,
  onHover,
  onOpen,
}: SearchResultItemProps) {
  const openable = openableConversations(entry, websites);
  const age = formatAge(entry.createdAt);

  return (
    <div
      id={id}
      onMouseMove={onHover}
      className={cn('rounded-md px-3 py-2', active && 'bg-accent')}
    >
      <button
        type="button"
        disabled={openable.length === 0}
        onClick={() => onOpen(openable)}
        className="block w-full text-left disabled:opacity-50"
      >
        <span className="line-clamp-2 text-sm wrap-break-word">
          {highlightParts(promptSnippet(entry.prompt, terms), terms).map((part, index) =>
            part.match ? (
              // eslint-disable-next-line react/no-array-index-key -- parts have no other identity
              <mark key={index} className="bg-transparent font-semibold text-foreground">
                {part.text}
              </mark>
            ) : (
              // eslint-disable-next-line react/no-array-index-key -- parts have no other identity
              <Fragment key={index}>{part.text}</Fragment>
            ),
          )}
        </span>
      </button>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {entry.conversations.map((conversation, index) => {
            const website = websites.find((item) => item.id === conversation.websiteId);
            const name =
              website === undefined || website.name === ''
                ? conversation.websiteId
                : website.name;
            return (
              <Fragment key={conversation.id}>
                {index > 0 && ', '}
                <button
                  type="button"
                  aria-label={`Open ${name} conversation`}
                  title={describe(conversation, website)}
                  disabled={!openable.includes(conversation)}
                  onClick={() => onOpen([conversation])}
                  className="hover:text-foreground hover:underline disabled:no-underline disabled:opacity-60"
                >
                  {name}
                </button>
              </Fragment>
            );
          })}
        </span>
        {age !== '' && <span className="shrink-0">· {age}</span>}
      </div>
    </div>
  );
}
