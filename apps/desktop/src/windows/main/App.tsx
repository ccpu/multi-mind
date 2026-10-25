import type { GuestConfig, GuestPromptError, PromptPreset } from '@internal/multi-mind';
import type { SearchConversation } from '@internal/tauri-api';
import type { PromptEditorHandle } from './types/prompt-editor';
import {
  composePrompt,
  createId,
  getActivePrompts,
  getActiveWebsites,
  getBottomPanelPercent,
  getForcedBottomPanelPercent,
  getMenuWebsites,
  HistoryManager,
  promptsToSend,
} from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { cn } from '@pixpilot/shadcn';
import { Toaster } from '@pixpilot/shadcn-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsDialog } from '../settings/SettingsDialog';
import { MenuBar } from './components/MenuBar';
import { PROMPT_SURFACE_SELECTOR } from './components/prompt-surface';
import { PromptPanel } from './components/PromptPanel';
import { WebViewPanel } from './components/WebViewPanel';
import { useAppSettings } from './hooks/useAppSettings';
import { useDownloadToasts } from './hooks/useDownloadToasts';
import { useGuestMessages } from './hooks/useGuestMessages';
import { useGuestPanes } from './hooks/useGuestPanes';
import { useOverlayPresence } from './hooks/useOverlayPresence';
import { useSearchHistory } from './hooks/useSearchHistory';
import { useSplitLayout } from './hooks/useSplitLayout';
import { useUsedPresets } from './hooks/useUsedPresets';
import { useAiResponseTracking } from './response-completion/hooks/use-ai-response-tracking';
import { useResponseCompletionToast } from './response-completion/hooks/use-response-completion-toast';

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
    openWebsites,
    togglePreset,
    untickChatPresets,
    movePreset,
    addPreset,
    updatePreset,
    removePreset,
  } = useAppSettings();
  const {
    usedPrompts,
    unused: unusedPresets,
    markSent: markPresetsSent,
    reuse: reusePreset,
    reset: resetUsedPresets,
  } = useUsedPresets();
  useDownloadToasts();
  const [prompt, setPrompt] = useState('');
  const [bottomPercent, setBottomPercent] = useState(settings.autoShrinkSize);
  const [guestConfig, setGuestConfig] = useState<GuestConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [promptErrors, setPromptErrors] = useState<Record<string, GuestPromptError>>({});

  const promptRef = useRef<PromptEditorHandle | null>(null);
  const historyRef = useRef(new HistoryManager());
  const attemptsRef = useRef(new Map<string, string>());

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
  const {
    begin: beginResponse,
    cancel: cancelResponse,
    report: reportResponse,
  } = useAiResponseTracking(activeWebsites);
  useResponseCompletionToast(settings.websites);

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

  const {
    register: registerPane,
    boundsOf,
    openUrl,
  } = useGuestPanes(guestConfig === null ? [] : activeWebsites, guestConfig);

  const collapsePrompt = useCallback(() => {
    setBottomPercent(getForcedBottomPanelPercent(settingsRef.current));
  }, []);

  const { recordPrompt, reportPage, stopTracking } = useSearchHistory();
  const handlePromptError = useCallback(
    (websiteId: string, error: GuestPromptError) => {
      if (attemptsRef.current.get(websiteId) === error.attemptId) {
        cancelResponse(websiteId);
        setPromptErrors((current) => ({ ...current, [websiteId]: error }));
      }
    },
    [cancelResponse],
  );
  const dismissPromptError = useCallback((websiteId: string) => {
    setPromptErrors((current) => {
      const next = { ...current };
      delete next[websiteId];
      return next;
    });
  }, []);
  useGuestMessages({
    boundsOf,
    onClicked: collapsePrompt,
    onPageReported: reportPage,
    onResponseReported: reportResponse,
    onPromptError: handlePromptError,
  });

  const overlayOpen = useOverlayPresence();

  useEffect(() => {
    appApi.invoke.getGuestConfig().then(setGuestConfig, (error: unknown) => {
      console.error('Failed to resolve the guest webview config:', error);
    });
  }, []);

  /**
   * Dragging still hides native browsers to release pointer capture. Windows
   * overlays clip only the covered browser pixels; other platforms retain the
   * visibility fallback until native clipping is available there.
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
   *
   * A use-once preset stays ticked after it is sent, but sits out the rest of
   * the chat. A ticked overriding preset leaves the other ticked ones out
   * altogether.
   */
  const sendPrompt = useCallback(
    (onlyWebsiteId?: string, immediatePreset?: PromptPreset) => {
      const typedPrompt = immediatePreset === undefined ? promptTextRef.current : '';
      const guestGlobals = guestConfigRef.current;
      const presets =
        immediatePreset === undefined
          ? promptsToSend(unusedPresets(getActivePrompts(settingsRef.current)))
          : [];
      const composed = composePrompt(
        typedPrompt,
        immediatePreset === undefined ? presets : [immediatePreset],
      );

      if (composed === '' || guestGlobals === null) {
        return;
      }

      markPresetsSent(presets);

      const websites = getActiveWebsites(settingsRef.current).filter(
        (website) => onlyWebsiteId === undefined || website.id === onlyWebsiteId,
      );
      const savePrompt = recordPrompt(
        composed,
        websites.map((website) => website.id),
      );
      websites.forEach((website) => {
        const attemptId = createId('prompt-attempt');
        attemptsRef.current.set(website.id, attemptId);
        beginResponse(website, attemptId);
        dismissPromptError(website.id);
        appApi.guest
          .sendPrompt(website.id, { website, prompt: composed, attemptId })
          .then(
            () => {
              savePrompt(website.id).catch((error: unknown) => {
                console.error(
                  `Failed to save prompt history for ${website.name}:`,
                  error,
                );
              });
            },
            (error: unknown) => {
              if (attemptsRef.current.get(website.id) === attemptId) {
                cancelResponse(website.id);
              }
              console.error(`Failed to run the prompt on ${website.name}:`, error);
            },
          );
      });

      if (immediatePreset !== undefined) {
        return;
      }

      // Only what was typed is worth stepping back to; the presets re-apply
      // themselves, and an empty entry would just be a dead stop in the history.
      if (typedPrompt !== '') {
        historyRef.current.saveState(typedPrompt);
      }

      setPrompt('');
      setBottomPercent(getForcedBottomPanelPercent(settingsRef.current));
    },
    [
      beginResponse,
      cancelResponse,
      dismissPromptError,
      markPresetsSent,
      recordPrompt,
      unusedPresets,
    ],
  );

  const runPrompt = useCallback(() => sendPrompt(), [sendPrompt]);

  /** The same, to one of the open browsers only. */
  const runPromptOn = useCallback(
    (websiteId: string) => sendPrompt(websiteId),
    [sendPrompt],
  );

  /** Reopens saved conversations, enabling and opening their providers first. */
  const openConversations = useCallback(
    (conversations: readonly SearchConversation[]) => {
      const openable = conversations.filter((conversation) =>
        /^https?:\/\//iu.test(conversation.url),
      );
      openable.forEach((conversation) => {
        stopTracking(conversation.websiteId);
        cancelResponse(conversation.websiteId);
        openUrl(conversation.websiteId, conversation.url);
      });
      openWebsites(openable.map((conversation) => conversation.websiteId));
    },
    [cancelResponse, openUrl, openWebsites, stopTracking],
  );

  /**
   * Port of `WebViewManager.Reload`. A new chat unticks the presets that only
   * last for one chat, and lets the use-once ones go out again.
   */
  const handleReload = useCallback(() => {
    untickChatPresets();
    resetUsedPresets();
    getActiveWebsites(settingsRef.current).forEach((website) => {
      stopTracking(website.id);
      cancelResponse(website.id);
      appApi.guest.navigate(website.id, website.url).catch((error: unknown) => {
        console.error(`Failed to reload ${website.name}:`, error);
      });
    });
  }, [cancelResponse, resetUsedPresets, stopTracking, untickChatPresets]);

  /** Sends an immediate preset, or toggles a preset to join the next message. */
  const handleTogglePreset = useCallback(
    (promptId: string) => {
      const preset = settingsRef.current.prompts.find((entry) => entry.id === promptId);
      if (preset?.sendImmediately === true) {
        sendPrompt(undefined, preset);
        return;
      }
      reusePreset(promptId);
      togglePreset(promptId);
    },
    [reusePreset, sendPrompt, togglePreset],
  );

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
  const openPrompts = useCallback(() => setPromptsOpen(true), []);

  /** Typing in or clicking the prompt box takes it back to its full size. */
  const expandPrompt = useCallback(() => {
    setBottomPercent(settingsRef.current.panelButtonSize);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <MenuBar
        websites={menuWebsites}
        allWebsites={settings.websites}
        activeWebsites={settings.activeWebsites}
        onReload={handleReload}
        onResetLayout={resetLayout}
        onToggleWebsite={toggleWebsite}
        onOpenSettings={openSettings}
        onOpenPrompts={openPrompts}
        onNewWindow={openNewWindow}
        onOpenConversations={openConversations}
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
                promptError={promptErrors[website.id]}
                onDismissError={dismissPromptError}
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
        usedPrompts={usedPrompts}
        presetsDialogOpen={promptsOpen}
        onPresetsDialogOpenChange={setPromptsOpen}
        onChange={handlePromptChange}
        onActivate={expandPrompt}
        onSubmit={runPrompt}
        websites={activeWebsites}
        onSubmitTo={runPromptOn}
        onPreviousPrompt={goLastPrompt}
        onNextPrompt={goNextPrompt}
        onDismiss={collapsePrompt}
        onTogglePreset={handleTogglePreset}
        onReusePreset={reusePreset}
        onMovePreset={movePreset}
        onAddPreset={addPreset}
        onChangePreset={updatePreset}
        onRemovePreset={removePreset}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <Toaster position="top-right" />
    </div>
  );
}

export default App;
