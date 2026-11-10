import type { WebsiteInfo } from '@internal/multi-mind';
import type { SearchConversation, SearchEntry } from '@internal/tauri-api';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef } from 'react';
import { SearchResultItem } from './SearchResultItem';

const ESTIMATED_ROW_HEIGHT = 96;
const MAX_LIST_HEIGHT = 340;
const OVERSCAN = 4;

interface SearchResultListProps {
  entries: readonly SearchEntry[];
  terms: readonly string[];
  websites: readonly WebsiteInfo[];
  listId: string;
  activeIndex: number;
  keyboardTarget: { index: number } | null;
  saving: boolean;
  onHover: (index: number) => void;
  onOpen: (conversations: readonly SearchConversation[]) => void;
  onFavorite: (entry: SearchEntry) => void;
  onEdit: (entry: SearchEntry) => void;
  onDelete: (entry: SearchEntry) => void;
}

/** Renders the visible saved chats, measuring rows as their contents change. */
export function SearchResultList({
  entries,
  terms,
  websites,
  listId,
  activeIndex,
  keyboardTarget,
  saving,
  onHover,
  onOpen,
  onFavorite,
  onEdit,
  onDelete,
}: SearchResultListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const getItemKey = useCallback((index: number) => entries[index]!.id, [entries]);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    useFlushSync: false,
  });

  useEffect(() => {
    if (keyboardTarget !== null && keyboardTarget.index < entries.length) {
      virtualizer.scrollToIndex(keyboardTarget.index, { align: 'auto' });
    }
  }, [keyboardTarget, entries.length, virtualizer]);

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto"
      style={{ height: Math.min(virtualizer.getTotalSize(), MAX_LIST_HEIGHT) }}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={row.index}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            <SearchResultItem
              id={`${listId}-${row.index}`}
              entry={entries[row.index]!}
              terms={terms}
              websites={websites}
              active={row.index === activeIndex}
              saving={saving}
              onHover={() => onHover(row.index)}
              onOpen={onOpen}
              onFavorite={onFavorite}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
