import type { WebsiteInfo } from '@internal/multi-mind';
import type { SearchConversation, SearchEntry } from '@internal/tauri-api';
import { cn } from '@pixpilot/shadcn';
import { Button } from '@pixpilot/shadcn-ui';
import { Pencil, Star, Trash2 } from 'lucide-react';
import { Fragment } from 'react';
import {
  chatTitle,
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
  saving: boolean;
  onHover: () => void;
  onOpen: (conversations: readonly SearchConversation[]) => void;
  onFavorite: (entry: SearchEntry) => void;
  onEdit: (entry: SearchEntry) => void;
  onDelete: (entry: SearchEntry) => void;
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

function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((part, index) =>
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
    </>
  );
}

/**
 * One saved chat: its captured title, then its first prompt and any later one
 * that matches better, with its providers listed after them. The chat opens
 * every conversation in it; a provider name opens just that one.
 */
export function SearchResultItem({
  id,
  entry,
  terms,
  websites,
  active,
  saving,
  onHover,
  onOpen,
  onFavorite,
  onEdit,
  onDelete,
}: SearchResultItemProps) {
  const openable = openableConversations(entry, websites);
  const title = chatTitle(entry, websites);
  const age = formatAge(entry.updatedAt);

  return (
    <div
      id={id}
      onMouseEnter={onHover}
      className={cn('flex rounded-md px-3 py-2', active && 'bg-accent')}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <button
          type="button"
          disabled={openable.length === 0}
          onClick={() => onOpen(openable)}
          className="block w-full text-left disabled:opacity-50"
        >
          {title !== '' && (
            <span className="block truncate text-sm font-medium" title={title}>
              <Highlighted text={title} terms={terms} />
            </span>
          )}
          <span
            className={cn(
              'line-clamp-2 wrap-break-word',
              title === '' ? 'text-sm' : 'text-xs text-muted-foreground',
            )}
          >
            <Highlighted text={promptSnippet(entry.prompt, terms)} terms={terms} />
          </span>
          {entry.matchedPrompt !== undefined && (
            <span className="mt-0.5 line-clamp-1 text-xs wrap-break-word text-muted-foreground">
              {'↳ '}
              <Highlighted
                text={promptSnippet(entry.matchedPrompt, terms)}
                terms={terms}
              />
            </span>
          )}
        </button>

        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <div className="">
            <span className="min-w-0 truncate">
              {entry.conversations.map((conversation, index) => {
                const website = websites.find(
                  (item) => item.id === conversation.websiteId,
                );
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
          <div className="flex shrink-0 flex-row">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Edit chat title"
              onClick={() => onEdit(entry)}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={saving}
              aria-label={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={Boolean(entry.favorite)}
              className="mb-0"
              onClick={() => onFavorite(entry)}
            >
              <Star
                className={cn('size-4', entry.favorite && 'fill-current text-amber-500')}
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={saving}
              aria-label="Delete saved chat"
              onClick={() => onDelete(entry)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
