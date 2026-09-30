import type { GuestPromptError, WebsiteInfo } from '@internal/multi-mind';
import { cn } from '@pixpilot/shadcn';
import { X } from 'lucide-react';
import { useCallback } from 'react';

interface WebViewPanelProps {
  website: WebsiteInfo;
  /**
   * False while Split.js owns the width of this pane. A lone browser has no
   * gutter to drag, so it grows to fill the row instead.
   */
  grow: boolean;
  onRegister: (websiteId: string, element: HTMLDivElement | null) => void;
  promptError: GuestPromptError | undefined;
  onDismissError: (websiteId: string) => void;
}

/**
 * One embedded browser, replacing a `WebView2` control from
 * `Multi Mind/WebViewManager.cs` — or rather, the space one takes up.
 *
 * The Electron port put an actual `<webview>` element here. A Tauri guest is a
 * child webview owned by Rust and drawn over the window, so what this renders
 * is the box that says where: the layout is still the page's, and `useGuestPanes`
 * sends the measurements down. The box is not empty for long enough to see,
 * but it carries the background so a browser that is still loading does not
 * show through to whatever was behind the window.
 */
export function WebViewPanel({
  website,
  grow,
  onRegister,
  promptError,
  onDismissError,
}: WebViewPanelProps) {
  const attachRef = useCallback(
    (element: HTMLDivElement | null) => {
      onRegister(website.id, element);
    },
    [onRegister, website.id],
  );

  // Split.js writes an inline width onto this wrapper, so it must not be a flex
  // item with a basis of its own.
  return (
    <div
      data-website={website.id}
      className={cn(
        'flex h-full min-w-0 flex-col overflow-hidden bg-background',
        grow && 'flex-1',
      )}
    >
      <div ref={attachRef} className="min-h-0 flex-1" />
      {promptError === undefined ? null : (
        <div
          role="alert"
          title={promptError.selector}
          className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-red-300 bg-red-50 px-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          <span className="truncate">
            {promptError.kind === 'insert'
              ? 'Could not enter prompt'
              : 'Selector not found'}
          </span>
          <button
            type="button"
            aria-label={`Dismiss ${website.name} prompt error`}
            className="shrink-0 rounded p-0.5 hover:bg-red-100 focus-visible:outline-2 dark:hover:bg-red-900"
            onClick={() => onDismissError(website.id)}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
