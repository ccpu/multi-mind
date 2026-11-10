import type { WebsiteInfo } from '@internal/multi-mind';
import type { SearchConversation, SearchEntry } from '@internal/tauri-api';
import type { KeyboardEvent } from 'react';
import { appApi } from '@internal/tauri-api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  showConfirmDialog,
} from '@pixpilot/shadcn-ui';
import { History, Search, Star } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { chatTitle, openableConversations, searchTerms } from './search-text';
import { SearchResultList } from './SearchResultList';

const SEARCH_DELAY_MS = 200;

interface SearchHistoryProps {
  websites: readonly WebsiteInfo[];
  onOpenConversations: (conversations: readonly SearchConversation[]) => void;
}

/**
 * Searches saved chats from the navigation bar. Focusing it lists the most
 * recent ones; typing narrows them to chats holding every word, in one of
 * their prompts or in the title or address of one of their conversations.
 */
export function SearchHistory({ websites, onOpenConversations }: SearchHistoryProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchEntry[]>([]);
  /** The query `results` answer, or null before the first answer. */
  const [resultsQuery, setResultsQuery] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [all, setAll] = useState(false);
  const [favorites, setFavorites] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<SearchEntry | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [keyboardTarget, setKeyboardTarget] = useState<{ index: number } | null>(null);
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
        appApi.invoke.searchPrompts(query, all, favorites).then(
          (entries) => {
            if (!cancelled) {
              setResults(entries);
              setResultsQuery(query);
              setActiveIndex(0);
              setKeyboardTarget(null);
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
  }, [open, query, recent, all, favorites, revision]);

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
        const index = (activeIndex + step + results.length) % results.length;
        setActiveIndex(index);
        setKeyboardTarget({ index });
      }
    } else if (event.key === 'Enter') {
      const entry = results[activeIndex];
      if (entry !== undefined) {
        event.preventDefault();
        openConversations(openableConversations(entry, websites));
      }
    }
  };

  const updateChat = async (
    entry: SearchEntry,
    newTitle?: string,
    favorite?: boolean,
  ) => {
    setSaving(true);
    setActionError('');
    try {
      await appApi.invoke.searchUpdateChat(entry.id, newTitle, favorite);
      setRevision((value) => value + 1);
      setEditing(null);
    } catch (reason) {
      console.error('Failed to update saved chat:', reason);
      setActionError('Could not save changes. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const deleteChat = async (entry: SearchEntry) => {
    try {
      const confirmed = await showConfirmDialog({
        title: 'Delete saved chat?',
        description:
          'All locally saved prompts for this chat will be permanently deleted. Conversations on provider websites are unaffected.',
        confirmText: 'Delete permanently',
        variant: 'destructive',
      });
      if (!confirmed) return;
      setSaving(true);
      setActionError('');
      await appApi.invoke.searchDeleteChat(entry.id);
      setResults((items) => items.filter((item) => item.id !== entry.id));
      setActiveIndex(0);
      setKeyboardTarget(null);
      setRevision((value) => value + 1);
    } catch (reason) {
      console.error('Failed to delete saved chat:', reason);
      setActionError('Could not delete the saved chat. Try again.');
      setOpen(true);
    } finally {
      setSaving(false);
    }
  };

  const loaded = resultsQuery === query;
  let message = '';
  if (error) {
    message = 'Search failed. Try again.';
  } else if (resultsQuery === null || !loaded) {
    message = 'Loading saved prompts…';
  } else if (loaded && results.length === 0) {
    if (favorites) {
      message = 'No favorites found.';
    } else {
      message = recent ? 'No saved prompts yet.' : 'No saved prompts found.';
    }
  }

  let listHeading = 'Recent chats';
  if (favorites) listHeading = 'Favorites';
  else if (all) listHeading = 'All chats';

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            ref={anchorRef}
            className="relative flex w-72 min-w-40 shrink items-center gap-1"
          >
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
              className="h-8 min-w-0 pl-8"
            />
            <Button
              type="button"
              variant={all && !favorites ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Show all history"
              aria-pressed={all && !favorites}
              onClick={() => {
                if (!all || favorites || query !== '') {
                  setResults([]);
                  setResultsQuery(null);
                }
                setQuery('');
                setAll(true);
                setFavorites(false);
                setOpen(true);
              }}
            >
              <History className="size-4" />
            </Button>
            <Button
              type="button"
              variant={favorites ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Show favorites"
              aria-pressed={favorites}
              onClick={() => {
                setResults([]);
                setResultsQuery(null);
                setFavorites((value) => !value);
                setQuery('');
                setAll(true);
                setOpen(true);
              }}
            >
              <Star
                className={favorites ? 'size-4 fill-current text-amber-500' : 'size-4'}
              />
            </Button>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-96 p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            // The box is outside the list; pressing it must not close the list.
            if (anchorRef.current?.contains(event.target as Node)) {
              event.preventDefault();
            }
          }}
        >
          {actionError !== '' && (
            <p role="alert" className="p-3 text-sm text-destructive">
              {actionError}
            </p>
          )}
          {message !== '' && (
            <p
              className={
                error
                  ? 'p-3 text-sm text-destructive'
                  : 'p-3 text-sm text-muted-foreground'
              }
            >
              {message}
            </p>
          )}
          {!error && recent && results.length > 0 && (
            <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              {listHeading}
            </p>
          )}
          {!error && results.length > 0 && (
            <SearchResultList
              key={JSON.stringify([query, all, favorites])}
              entries={results}
              terms={terms}
              websites={websites}
              listId={listId}
              activeIndex={activeIndex}
              keyboardTarget={keyboardTarget}
              onHover={setActiveIndex}
              onOpen={openConversations}
              saving={saving}
              onFavorite={(item) => {
                void updateChat(item, undefined, !item.favorite);
              }}
              onEdit={(item) => {
                setEditing(item);
                setTitle(chatTitle(item, websites) || item.prompt);
                setActionError('');
              }}
              onDelete={(item) => {
                void deleteChat(item);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
      <Dialog
        open={editing !== null}
        onOpenChange={(value) => {
          if (!value) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit chat title</DialogTitle>
            <DialogDescription>
              Your title stays in place when the provider updates its page title.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (editing && title.trim()) void updateChat(editing, title.trim());
            }}
          >
            <Input
              aria-label="Chat title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
            {actionError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {actionError}
              </p>
            )}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim() || saving}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
