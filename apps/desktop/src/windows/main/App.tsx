import type { GuestConfig } from '@internal/multi-mind';
import type { PromptEditorHandle } from './types/prompt-editor';
import {
  composePrompt,
  createRunPromptScript,
  getActivePrompts,
  getActiveWebsites,
  getBottomPanelPercent,
  getForcedBottomPanelPercent,
  getMenuWebsites,
  HistoryManager,
} from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { cn } from '@pixpilot/shadcn';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsDialog } from '../settings/SettingsDialog';
import { MenuBar } from './components/MenuBar';
import { PROMPT_SURFACE_SELECTOR } from './components/prompt-surface';
import { PromptPanel } from './components/PromptPanel';
import { WebViewPanel } from './components/WebViewPanel';
import { useAppSettings } from './hooks/useAppSettings';
import { useGuestMessages } from './hooks/useGuestMessages';
import { useGuestPanes } from './hooks/useGuestPanes';
import { useOverlayPresence } from './hooks/useOverlayPresence';
import { useSplitLayout } from './hooks/useSplitLayout';

/**
 * Port of `Multi Mind/MainForm.cs`. The three docked WinForms panels become three
 * flex rows: the menu strip on top, the embedded browsers in the middle, and
 * the prompt box at the bottom sized as a percentage of the window. The
 * browsers themselves are split by Split.js, which the WinForms original could
 * not do: it always laid them out in equal columns.
 */
function App() {
  const {
    settings,
    loaded,
    toggleWebsite,
    togglePreset,
    addPreset,
    updatePreset,
    removePreset,
  } = useAppSettings();
  const [prompt, setPrompt] = useState('');
  const [bottomPercent, setBottomPercent] = useState(settings.autoShrinkSize);
  const [guestConfig, setGuestConfig] = useState<GuestConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const promptRef = useRef<PromptEditorHandle | null>(null);
  const historyRef = useRef(new HistoryManager());

  // Latest values for callbacks that must stay referentially stable, so that
  // re-measuring a pane never re-runs anything that depends on them.
  const settingsRef = useRef(settings);
  const promptTextRef = useRef(prompt);
  const guestConfigRef = useRef(guestConfig);
  settingsRef.current = settings;
  promptTextRef.current = prompt;
  guestConfigRef.current = guestConfig;

  // What the menu bar offers, and which of those browsers are actually open.
  const menuWebsites = useMemo(() => getMenuWebsites(settings), [settings]);
  const activeWebsites = useMemo(() => getActiveWebsites(settings), [settings]);

  // Panes only exist once the guest config is known, so the split has to wait
  // for it too.
  const paneKeys = useMemo(
    () => (guestConfig === null ? [] : activeWebsites.map((website) => website.id)),
    [activeWebsites, guestConfig],
  );

  const {
    containerRef: splitContainerRef,
    dragging,
    active: splitActive,
    reset: resetLayout,
  } = useSplitLayout(paneKeys);

  const { register: registerPane, boundsOf } = useGuestPanes(
    guestConfig === null ? [] : activeWebsites,
    guestConfig,
  );

  const collapsePrompt = useCallback(() => {
    setBottomPercent(getForcedBottomPanelPercent(settingsRef.current));
  }, []);

  useGuestMessages({ boundsOf, onClicked: collapsePrompt });

  const overlayOpen = useOverlayPresence();

  useEffect(() => {
    appApi.invoke.getGuestConfig().then(setGuestConfig, (error: unknown) => {
      console.error('Failed to resolve the guest webview config:', error);
    });
  }, []);

  /**
   * A guest is a native child webview drawn over the window, so it swallows the
   * pointer while the cursor is over it and covers anything the page puts
   * there. Electron's `<webview>` had the same two problems and the same
   * answer: take the browsers out of the way while a gutter is being dragged or
   * a popover is open, and put them back afterwards.
   */
  useEffect(() => {
    appApi.guest.setVisible(!dragging && !overlayOpen).catch((error: unknown) => {
      console.error('Failed to change the embedded browsers visibility:', error);
    });
  }, [dragging, overlayOpen]);

  /** `MainForm_Load` gives the prompt box focus. */
  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  /** `MainForm_Load` and the `WebViewsAdded` event both re-sized the panels. */
  useEffect(() => {
    setBottomPercent(getBottomPanelPercent(settingsRef.current, promptTextRef.current));
  }, [activeWebsites, loaded]);

  /** `Form1_Resize`. */
  useEffect(() => {
    const handleResize = () => {
      setBottomPercent(getBottomPanelPercent(settingsRef.current, promptTextRef.current));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /**
   * `AttachMouseDownEventHandlers` / `MainForm_MouseDown`: pressing anywhere
   * outside the prompt box collapses it.
   */
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const { target } = event;

      if (promptRef.current?.contains(target as Node) === true) {
        return;
      }

      // The preset badges and their editors are the prompt box's own
      // furniture rather than somewhere else in the window, and the editors
      // are portalled out of it, so they say so themselves.
      if (target instanceof Element && target.closest(PROMPT_SURFACE_SELECTOR) !== null) {
        return;
      }

      setBottomPercent(getForcedBottomPanelPercent(settingsRef.current));
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  /**
   * Port of `WebViewManager.RunPropt` plus the `MainForm.RunPropt` wrapper.
   * The ticked presets are wrapped around the prompt on the way out; the
   * history keeps what was actually typed, since the presets are applied
   * again — and may have been re-ticked — the next time it is sent.
   *
   * A ticked preset is a prompt in its own right, so an empty box is no
   * reason not to send: what has to be there is the composed text, not the
   * typed text.
   */
  const runPrompt = useCallback(() => {
    const typedPrompt = promptTextRef.current;
    const guestGlobals = guestConfigRef.current;
    const composed = composePrompt(typedPrompt, getActivePrompts(settingsRef.current));

    if (composed === '' || guestGlobals === null) {
      return;
    }

    getActiveWebsites(settingsRef.current).forEach((website) => {
      appApi.guest
        .run(website.id, createRunPromptScript(website, composed, guestGlobals))
        .catch((error: unknown) => {
          console.error(`Failed to run the prompt on ${website.name}:`, error);
        });
    });

    // Only what was typed is worth stepping back to; the presets re-apply
    // themselves, and an empty entry would just be a dead stop in the history.
    if (typedPrompt !== '') {
      historyRef.current.saveState(typedPrompt);
    }

    setPrompt('');
    setBottomPercent(getForcedBottomPanelPercent(settingsRef.current));
  }, []);

  /** Port of `WebViewManager.Reload`. */
  const handleReload = useCallback(() => {
    getActiveWebsites(settingsRef.current).forEach((website) => {
      appApi.guest.navigate(website.id, website.url).catch((error: unknown) => {
        console.error(`Failed to reload ${website.name}:`, error);
      });
    });
  }, []);

  const goLastPrompt = useCallback(() => {
    historyRef.current.previous();
    setPrompt(historyRef.current.getCurrentText());
  }, []);

  const goNextPrompt = useCallback(() => {
    historyRef.current.next();
    setPrompt(historyRef.current.getCurrentText());
  }, []);

  const handlePromptChange = useCallback((next: string) => {
    setPrompt(next);
  }, []);

  /**
   * **New Window**: another copy of this one, sharing the browser profile and
   * so every sign-in in it. The Rust side decides where it goes and what it is
   * called; there is nothing for this window to hand over, because everything
   * the new one needs is in the settings file both of them read.
   */
  const openNewWindow = useCallback(() => {
    appApi.invoke.newWindow().then(
      (result) => {
        if (!result.success) {
          console.error(result.message);
        }
      },
      (error: unknown) => {
        console.error('Failed to open another window:', error);
      },
    );
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  /** Typing in or clicking the prompt box takes it back to its full size. */
  const expandPrompt = useCallback(() => {
    setBottomPercent(settingsRef.current.panelButtonSize);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <MenuBar
        websites={menuWebsites}
        activeWebsites={settings.activeWebsites}
        onReload={handleReload}
        onResetLayout={resetLayout}
        onLastPrompt={goLastPrompt}
        onNextPrompt={goNextPrompt}
        onToggleWebsite={toggleWebsite}
        onOpenSettings={openSettings}
        onNewWindow={openNewWindow}
      />

      <div
        ref={splitContainerRef}
        className={cn('flex min-h-0 flex-1', dragging && 'select-none')}
      >
        {guestConfig === null
          ? null
          : activeWebsites.map((website) => (
              <WebViewPanel
                key={website.id}
                website={website}
                grow={!splitActive}
                onRegister={registerPane}
              />
            ))}
      </div>

      <PromptPanel
        editorRef={promptRef}
        editor={settings.promptEditor}
        value={prompt}
        heightPercent={bottomPercent}
        presets={settings.prompts}
        activePrompts={settings.activePrompts}
        onChange={handlePromptChange}
        onActivate={expandPrompt}
        onSubmit={runPrompt}
        onPreviousPrompt={goLastPrompt}
        onNextPrompt={goNextPrompt}
        onDismiss={collapsePrompt}
        onTogglePreset={togglePreset}
        onAddPreset={addPreset}
        onChangePreset={updatePreset}
        onRemovePreset={removePreset}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export default App;
