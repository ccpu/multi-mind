import type { WebsiteInfo } from '@internal/multi-mind';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@pixpilot/shadcn-ui';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { promptSurface } from './prompt-surface';

interface SendToOneButtonProps {
  /** The browsers that are open, in the order they are laid out in. */
  websites: readonly WebsiteInfo[];
  onSubmitTo: (websiteId: string) => void;
}

/**
 * Beside **Submit**: sends the prompt to one of the open browsers rather than
 * all of them. The popover lists them, and picking one sends straight away.
 */
export function SendToOneButton({ websites, onSubmitTo }: SendToOneButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full" disabled={websites.length === 0}>
          <MessageSquare />
          Conversation
        </Button>
      </PopoverTrigger>
      <PopoverContent
        {...promptSurface}
        side="top"
        align="end"
        className="flex w-44 flex-col gap-1 p-1"
      >
        <span className="px-2 py-1 text-xs text-muted-foreground">Send only to</span>
        {websites.map((website) => (
          <Button
            key={website.id}
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => {
              setOpen(false);
              onSubmitTo(website.id);
            }}
          >
            {website.name === '' ? '(unnamed)' : website.name}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
