import type { WebsiteInfo } from '@internal/multi-mind';
import type { SearchEntry } from '@internal/tauri-api';
import { appApi } from '@internal/tauri-api';
import { Input, Popover, PopoverContent, PopoverTrigger } from '@pixpilot/shadcn-ui';
import { Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SearchResultItem } from './SearchResultItem';

const SEARCH_DELAY_MS = 200;

interface SearchHistoryProps {
  websites: readonly WebsiteInfo[];
  onOpenResult: (entry: SearchEntry) => void;
}

/** Searches saved prompt and conversation records from the navigation bar. */
export function SearchHistory({ websites, onOpenResult }: SearchHistoryProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchEntry[]>([]);
  const [resultsQuery, setResultsQuery] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || query.trim() === '') {
      return undefined;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      appApi.invoke.searchPrompts(query).then(
        (entries) => {
          if (!cancelled) {
            setResults(entries);
            setResultsQuery(query);
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
    }, SEARCH_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [open, query]);

  const visibleResults = resultsQuery === query ? results : [];

  const openResult = useCallback(
    (entry: SearchEntry) => {
      onOpenResult(entry);
      setOpen(false);
      setQuery('');
      setResults([]);
      setError(false);
    },
    [onOpenResult],
  );

  return (
    <Popover open={open && query.trim() !== ''} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative w-56 min-w-32 shrink">
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
            placeholder="Search prompts…"
            className="h-8 pl-8"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-80 w-96 overflow-y-auto p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {error && (
          <p className="p-3 text-sm text-destructive">Search failed. Try again.</p>
        )}
        {!error && visibleResults.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">No saved prompts found.</p>
        )}
        {!error &&
          visibleResults.map((entry) => {
            const website = websites.find((item) => item.id === entry.websiteId);
            return (
              <SearchResultItem
                key={entry.id}
                entry={entry}
                providerName={website?.name ?? entry.websiteId}
                available={website !== undefined}
                onOpen={openResult}
              />
            );
          })}
      </PopoverContent>
    </Popover>
  );
}
