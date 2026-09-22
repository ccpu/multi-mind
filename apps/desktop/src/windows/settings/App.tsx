import { appConfig } from '@internal/configs';
import {
  Logo,
  OverlayProvider,
  ThemeModeToggleButton,
  ThemeProvider,
} from '@internal/ui';
import { PromptBoxCard } from './components/PromptBoxCard';
import { SettingsFileCard } from './components/SettingsFileCard';
import { UpdatesCard } from './components/UpdatesCard';
import { WebsitesCard } from './components/WebsitesCard';
import { useSettingsStore } from './hooks/useSettingsStore';

/**
 * Everything the WinForms menu strip could configure now lives here, in a real
 * window of its own rather than a dropdown over the browsers. The main window
 * keeps only the actions — reload, prompt history, layout — and the per-site
 * toggles this window decides the contents of.
 */
function App() {
  const { settings, update } = useSettingsStore();

  return (
    <ThemeProvider defaultTheme={appConfig.theme.defaultTheme}>
      <OverlayProvider>
        <div className="min-h-screen bg-background text-foreground">
          <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-background/95 px-6 py-4 backdrop-blur">
            <div className="flex items-center gap-3">
              <Logo className="size-6 shrink-0" />
              <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            </div>
            <ThemeModeToggleButton />
          </header>

          <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
            <PromptBoxCard settings={settings} onChange={update} />
            <WebsitesCard settings={settings} onChange={update} />
            <UpdatesCard settings={settings} onChange={update} />
            <SettingsFileCard />
          </main>
        </div>
      </OverlayProvider>
    </ThemeProvider>
  );
}

export default App;
