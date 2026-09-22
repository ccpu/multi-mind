import type { ReactNode } from 'react';
import { ThemeProvider, ThemeToggle } from '@internal/ui';
import { AppInfoCard } from './components/app-info-card';
import { ExternalLinks } from './components/external-links';
import { GreetCard } from './components/greet-card';

export function App(): ReactNode {
  return (
    <ThemeProvider defaultTheme="system">
      <div className="flex min-h-full flex-col bg-background text-foreground">
        <header className="flex items-center justify-between border-b border-border px-8 py-4">
          <h1 className="text-lg font-semibold no-select">Tauri Template</h1>
          <ThemeToggle />
        </header>

        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
          <GreetCard />
          <AppInfoCard />
        </main>

        <footer className="border-t border-border px-8 py-4">
          <ExternalLinks />
        </footer>
      </div>
    </ThemeProvider>
  );
}

export default App;
