import type { SearchEntry } from '@internal/tauri-api';

interface SearchResultItemProps {
  entry: SearchEntry;
  providerName: string;
  available: boolean;
  onOpen: (entry: SearchEntry) => void;
}

/** One saved prompt and its conversation address in the search list. */
export function SearchResultItem({
  entry,
  providerName,
  available,
  onOpen,
}: SearchResultItemProps) {
  let detail = 'Provider unavailable';
  if (available) {
    detail = entry.title || (entry.url ? 'Untitled conversation' : 'Waiting for URL');
  }

  return (
    <button
      type="button"
      disabled={!available || entry.url === ''}
      onClick={() => onOpen(entry)}
      className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
    >
      <span className="line-clamp-2 text-sm font-medium">{entry.prompt}</span>
      <span className="truncate text-xs text-muted-foreground">
        {providerName} · {detail}
      </span>
      {entry.url && (
        <span className="w-full truncate text-xs text-muted-foreground">{entry.url}</span>
      )}
    </button>
  );
}
