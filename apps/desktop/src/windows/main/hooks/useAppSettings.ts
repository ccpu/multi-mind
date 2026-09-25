import type { AppSettings, PromptPreset, PromptPresetDraft } from '@internal/multi-mind';
import {
  addPrompt,
  DEFAULT_SETTINGS,
  removePrompt,
  togglePrompt,
  toggleWebsite as toggleWebsiteIn,
  updatePrompt,
} from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAppSettingsResult {
  settings: AppSettings;
  /** False until the persisted settings have come back from Rust. */
  loaded: boolean;
  toggleWebsite: (websiteId: string) => void;
  /** Enables and opens a provider when a saved result is selected. */
  openWebsite: (websiteId: string) => void;
  /** Ticks a prompt preset on or off. */
  togglePreset: (promptId: string) => void;
  /** Adds a preset to the library. */
  addPreset: (preset: PromptPreset) => void;
  /** Saves an edit made to one preset. */
  updatePreset: (promptId: string, draft: PromptPresetDraft) => void;
  /** Drops a preset, and unticks it with it. */
  removePreset: (promptId: string) => void;
}

/**
 * The main window's view of `Multi Mind/Settings.cs`. The WinForms build mutated
 * a `Settings` instance in place and flushed it on close; here Rust owns the
 * file, and broadcasts every change so an edit made in the settings window
 * shows up in this one straight away.
 */
export function useAppSettings(): UseAppSettingsResult {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  // The preset editors work out the next list from the current one, and are
  // called from callbacks that must not go stale between renders.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let cancelled = false;

    appApi.invoke
      .getSettings()
      .then((stored) => {
        if (!cancelled) {
          setSettings(stored);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load settings:', error);
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => appApi.events.onSettingsChanged(setSettings), []);

  /**
   * Presets are edited here rather than in the settings window, so this window
   * writes to the settings file as well as reading it. The patch is applied at
   * once and then saved; the broadcast that comes back says the same thing.
   */
  const save = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));

    appApi.invoke.saveSettings(patch).catch((error: unknown) => {
      console.error('Failed to save settings:', error);
    });
  }, []);

  /**
   * Port of `Settings.ToggleWebsite`, keyed by id rather than name.
   *
   * The Electron port had a handler of its own for this in the main process.
   * There is no reason for one: which sites are open is a field of the settings
   * like any other, and `toggleWebsite` works out the next list here, where it
   * is tested, rather than in a backend that would have to learn what a site is.
   */
  const toggleWebsite = useCallback(
    (websiteId: string) => {
      save({
        activeWebsites: toggleWebsiteIn(settingsRef.current, websiteId).activeWebsites,
      });
    },
    [save],
  );

  const openWebsite = useCallback(
    (websiteId: string) => {
      const { current } = settingsRef;
      const website = current.websites.find((item) => item.id === websiteId);
      if (website === undefined) {
        return;
      }
      const patch: Partial<AppSettings> = {};
      if (!website.enabled) {
        patch.websites = current.websites.map((item) =>
          item.id === websiteId ? { ...item, enabled: true } : item,
        );
      }
      if (!current.activeWebsites.includes(websiteId)) {
        patch.activeWebsites = [...current.activeWebsites, websiteId];
      }
      if (Object.keys(patch).length > 0) {
        save(patch);
      }
    },
    [save],
  );

  const togglePreset = useCallback(
    (promptId: string) => {
      save({ activePrompts: togglePrompt(settingsRef.current, promptId).activePrompts });
    },
    [save],
  );

  const addPreset = useCallback(
    (preset: PromptPreset) => {
      save({ prompts: addPrompt(settingsRef.current, preset).prompts });
    },
    [save],
  );

  const updatePreset = useCallback(
    (promptId: string, draft: PromptPresetDraft) => {
      save({ prompts: updatePrompt(settingsRef.current, promptId, draft).prompts });
    },
    [save],
  );

  const removePreset = useCallback(
    (promptId: string) => {
      const next = removePrompt(settingsRef.current, promptId);

      save({ prompts: next.prompts, activePrompts: next.activePrompts });
    },
    [save],
  );

  return {
    settings,
    loaded,
    toggleWebsite,
    openWebsite,
    togglePreset,
    addPreset,
    updatePreset,
    removePreset,
  };
}
