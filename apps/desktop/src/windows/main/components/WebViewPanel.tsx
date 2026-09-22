import type { WebsiteInfo } from '@internal/multi-mind';
import { cn } from '@pixpilot/shadcn';
import { useCallback } from 'react';

interface WebViewPanelProps {
  website: WebsiteInfo;
  /**
   * False while Split.js owns the width of this pane. A lone browser has no
   * gutter to drag, so it grows to fill the row instead.
   */
  grow: boolean;
  onRegister: (websiteId: string, element: HTMLDivElement | null) => void;
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
export function WebViewPanel({ website, grow, onRegister }: WebViewPanelProps) {
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
      ref={attachRef}
      data-website={website.id}
      className={cn(
        'relative h-full min-w-0 overflow-hidden bg-background',
        grow && 'flex-1',
      )}
    />
  );
}
