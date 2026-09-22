import type { ReactNode } from 'react';
import { cn } from '@internal/utils';
import { useTheme } from './theme-context';

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps): ReactNode {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn('inline-flex gap-1 rounded-lg bg-muted p-1', className)}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={theme === option.value}
          onClick={() => setTheme(option.value)}
          className={cn(
            'cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            theme === option.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
