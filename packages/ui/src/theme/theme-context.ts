import { createContext, use } from 'react';

export type Theme = 'light' | 'dark' | 'system';
/** What the theme resolves to once `system` has been read. */
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext);

  if (context === undefined) {
    throw new Error('useTheme must be used inside a <ThemeProvider>');
  }

  return context;
}
