import type { ReactNode } from 'react';
import type { ResolvedTheme, Theme } from './theme-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext } from './theme-context';

const STORAGE_KEY = 'app-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readStoredTheme(fallback: Theme): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : fallback;
  } catch {
    // Storage can be unavailable; the default is a fine answer.
    return fallback;
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

/**
 * Applies the theme by toggling `.dark` on the document element, which is what
 * the `dark` variant defined in `@internal/tailwind` keys off.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: ThemeProviderProps): ReactNode {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme(defaultTheme));
  const [systemPreference, setSystemPreference] = useState<ResolvedTheme>(systemTheme);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemPreference : theme;

  const selectTheme = useCallback((next: Theme) => {
    setTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice is not worth failing over.
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void =>
      setSystemPreference(event.matches ? 'dark' : 'light');

    media.addEventListener('change', onChange);

    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme: selectTheme }),
    [theme, resolvedTheme, selectTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
