import type { WebsiteInfo } from '@internal/multi-mind';
import { Logo } from '@internal/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@pixpilot/shadcn';
import { Button, ToggleButton } from '@pixpilot/shadcn-ui';
import {
  Columns3,
  Copy,
  History,
  MessageCircle,
  Redo2,
  Settings,
  Undo2,
} from 'lucide-react';

interface MenuBarProps {
  /** The sites enabled in the settings window, in the order set there. */
  websites: readonly WebsiteInfo[];
  /** Ids of the sites whose browser is open. */
  activeWebsites: readonly string[];
  onReload: () => void;
  onResetLayout: () => void;
  onLastPrompt: () => void;
  onNextPrompt: () => void;
  onToggleWebsite: (websiteId: string) => void;
  onOpenSettings: () => void;
  /** Opens another copy of this window, signed in to the same sites. */
  onNewWindow: () => void;
}

/**
 * Port of the `menuStrip` built in `MainForm.Designer.cs` and
 * `MainForm.InitializeMenues`, rebuilt on `@pixpilot/shadcn-ui`. What is left
 * here are the actions; everything configurable moved to the settings window,
 * which is also what decides which site toggles appear on the right.
 */
export function MenuBar({
  websites,
  activeWebsites,
  onReload,
  onResetLayout,
  onLastPrompt,
  onNextPrompt,
  onToggleWebsite,
  onOpenSettings,
  onNewWindow,
}: MenuBarProps) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2 select-none">
      <Logo className="size-5 shrink-0 text-muted-foreground" />
      <Button variant="ghost" size="sm" onClick={onReload}>
        <MessageCircle />
        New Chat
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <History />
            History
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={onLastPrompt}>
            <Undo2 />
            Last Prompt
            <DropdownMenuShortcut>ctrl+shift+z</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onNextPrompt}>
            <Redo2 />
            Next Propmt
            <DropdownMenuShortcut>ctrl+shift+y</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="sm" onClick={onResetLayout}>
        <Columns3 />
        Reset Layout
      </Button>
      <Button variant="ghost" size="sm" onClick={onNewWindow}>
        <Copy />
        New Window
      </Button>
      <Button variant="ghost" size="sm" onClick={onOpenSettings}>
        <Settings />
        Settings
      </Button>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
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
