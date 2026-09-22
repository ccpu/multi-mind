import type { ReactNode } from 'react';
import { openExternal } from '@internal/tauri-api';
import { cn } from '@internal/utils';
import { SiReact, SiRust, SiTailwindcss } from 'react-icons/si';

const LINKS = [
  { href: 'https://v2.tauri.app', label: 'Tauri', Icon: SiRust },
  { href: 'https://react.dev', label: 'React', Icon: SiReact },
  { href: 'https://tailwindcss.com', label: 'Tailwind', Icon: SiTailwindcss },
] as const;

/**
 * A plain `<a href>` would navigate the app's own webview to the site, which
 * leaves the user stranded in a window with no browser chrome. External links
 * go to the OS browser through the opener plugin instead.
 */
export function ExternalLinks(): ReactNode {
  const open = (href: string): void => {
    openExternal(href).catch((error: unknown) => {
      console.error('Failed to open the link', error);
    });
  };

  return (
    <nav className="flex items-center justify-center gap-6">
      {LINKS.map(({ href, label, Icon }) => (
        <button
          key={href}
          type="button"
          onClick={() => open(href)}
          className={cn(
            'inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
            'rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          )}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </button>
      ))}
    </nav>
  );
}
