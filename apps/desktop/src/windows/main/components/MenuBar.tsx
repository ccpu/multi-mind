import type { WebsiteInfo } from '@internal/multi-mind';
import type { SearchConversation } from '@internal/tauri-api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@pixpilot/shadcn';
import { Button, ToggleButton } from '@pixpilot/shadcn-ui';
import { Columns3, Copy, EllipsisVertical, MessageCircle, Settings } from 'lucide-react';
import { SearchHistory } from './search/SearchHistory';

interface MenuBarProps {
  /** The sites enabled in the settings window, in the order set there. */
  websites: readonly WebsiteInfo[];
  /** Includes disabled providers so saved results can re-enable them. */
  allWebsites: readonly WebsiteInfo[];
  /** Ids of the sites whose browser is open. */
  activeWebsites: readonly string[];
  onReload: () => void;
  onResetLayout: () => void;
  onToggleWebsite: (websiteId: string) => void;
  onOpenSettings: () => void;
  /** Opens another copy of this window, signed in to the same sites. */
  onNewWindow: () => void;
  /** Reopens saved conversations picked in the search box. */
  onOpenConversations: (conversations: readonly SearchConversation[]) => void;
}

/**
 * Port of the `menuStrip` built in `MainForm.Designer.cs` and
 * `MainForm.InitializeMenues`, rebuilt on `@pixpilot/shadcn-ui`. What is left
 * here are the actions; everything configurable moved to the settings window,
 * which is also what decides which site toggles appear on the right.
 */
export function MenuBar({
  websites,
  allWebsites,
  activeWebsites,
  onReload,
  onResetLayout,
  onToggleWebsite,
  onOpenSettings,
  onNewWindow,
  onOpenConversations,
}: MenuBarProps) {
  return (
    <header className="grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b bg-background px-2 select-none">
      <div className="flex min-w-0 items-center gap-1">
        {/* `modal={false}` so closing the menu does not fight the settings dialog for focus. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More options">
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onSelect={onOpenSettings}>
              <Settings />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="sm" onClick={onReload}>
          <MessageCircle />
          New Chat
        </Button>

        <Button variant="ghost" size="sm" onClick={onResetLayout}>
          <Columns3 />
          Reset Layout
        </Button>
        <Button variant="ghost" size="sm" onClick={onNewWindow}>
          <Copy />
          New Window
        </Button>
      </div>

      <SearchHistory websites={allWebsites} onOpenConversations={onOpenConversations} />

      <div className="flex min-w-0 items-center justify-end gap-1">
        {websites.map((website) => {
          const label = website.name === '' ? '(unnamed)' : website.name.toUpperCase();

          return (
            <ToggleButton
              key={website.id}
              size="xs"
              variant="ghost"
              checkedProps={{ variant: 'secondary' }}
              checked={activeWebsites.includes(website.id)}
              onChange={() => onToggleWebsite(website.id)}
              checkedContent={label}
              uncheckedContent={label}
            />
          );
        })}
      </div>
    </header>
  );
}
