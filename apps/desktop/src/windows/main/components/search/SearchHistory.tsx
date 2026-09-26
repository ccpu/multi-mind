import type { WebsiteInfo } from '@internal/multi-mind';
import type { SearchConversation, SearchEntry } from '@internal/tauri-api';
import type { KeyboardEvent } from 'react';
import { appApi } from '@internal/tauri-api';
import { Input, Popover, PopoverAnchor, PopoverContent } from '@pixpilot/shadcn-ui';
import { Search } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { openableConversations, searchTerms } from './search-text';
import { SearchResultItem } from './SearchResultItem';

const SEARCH_DELAY_MS = 200;

interface SearchHistoryProps {
  websites: readonly WebsiteInfo[];
  onOpenConversations: (conversations: readonly SearchConversation[]) => void;
}

/**
 * Searches saved prompts from the navigation bar. Focusing it lists the most
 * recent ones; typing narrows them to prompts holding every word, in the prompt
 * or in the title or address of a conversation it started.
 */
export function SearchHistory({ websites, onOpenConversations }: SearchHistoryProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchEntry[]>([]);
  /** The query `results` answer, or null before the first answer. */
  const [resultsQuery, setResultsQuery] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const recent = query.trim() === '';
  const terms = searchTerms(query);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let cancelled = false;
    const timeout = window.setTimeout(
      () => {
        appApi.invoke.searchPrompts(query).then(
          (entries) => {
            if (!cancelled) {
              setResults(entries);
              setResultsQuery(query);
              setActiveIndex(0);
              setError(false);
            }
          },
          (reason: unknown) => {
            console.error('Failed to search saved prompts:', reason);
            if (!cancelled) {
              setError(true);
            }
          },
        );
      },
      recent ? 0 : SEARCH_DELAY_MS,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [open, query, recent]);

  useEffect(() => {
    document
      .getElementById(`${listId}-${activeIndex}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, listId]);

  const openConversations = useCallback(
    (conversations: readonly SearchConversation[]) => {
      if (conversations.length === 0) {
        return;
      }
      onOpenConversations(conversations);
      setOpen(false);
      setQuery('');
      setResults([]);
      setResultsQuery(null);
      setError(false);
    },
    [onOpenConversations],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (results.length > 0) {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((index) => (index + step + results.length) % results.length);
      }
    } else if (event.key === 'Enter') {
      const entry = results[activeIndex];
      if (entry !== undefined) {
        event.preventDefault();
        openConversations(openableConversations(entry, websites));
      }
    }
  };

  const loaded = resultsQuery === query;
  let message = '';
  if (error) {
    message = 'Search failed. Try again.';
  } else if (loaded && results.length === 0) {
    message = recent ? 'No saved prompts yet.' : 'No saved prompts found.';
  }

  return (
    <Popover open={open && (error || resultsQuery !== null)} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative w-56 min-w-32 shrink">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search saved prompts"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError(false);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search prompts…"
            className="h-8 pl-8"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="max-h-96 w-96 overflow-y-auto p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // The box is outside the list; pressing it must not close the list.
          if (anchorRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
      >
        {message !== '' && (
          <p
            className={
              error ? 'p-3 text-sm text-destructive' : 'p-3 text-sm text-muted-foreground'
            }
          >
            {message}
          </p>
        )}
        {!error && recent && results.length > 0 && (
          <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
            Recent prompts
          </p>
        )}
        {!error &&
          results.map((entry, index) => (
            <SearchResultItem
              key={entry.id}
              id={`${listId}-${index}`}
              entry={entry}
              terms={terms}
              websites={websites}
              active={index === activeIndex}
              onHover={() => setActiveIndex(index)}
              onOpen={openConversations}
            />
          ))}
      </PopoverContent>
    </Popover>
  );
}
