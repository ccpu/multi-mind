import type { AppSettings } from '@internal/multi-mind';
import { DEFAULT_SETTINGS } from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long an edit settles before it reaches the settings file. */
const WRITE_DELAY_MS = 300;

export interface UseSettingsStoreResult {
  settings: AppSettings;
  /** False until the persisted settings have come back from Rust. */
  loaded: boolean;
  /** Merges a patch into the settings; only the write itself is debounced. */
  update: (patch: Partial<AppSettings>) => void;
}

/**
 * The settings dialog's view of `Multi Mind/Settings.cs`. Edits land in local
 * state at once and are flushed to Rust shortly after, so typing in a text
 * field does not rewrite `settings.json` on every keystroke.
 */
export function useSettingsStore(): UseSettingsStoreResult {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const pendingRef = useRef<Partial<AppSettings> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(0);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const patch = pendingRef.current;
    if (patch === null) {
      return;
    }

    pendingRef.current = null;
    inFlightRef.current += 1;

    appApi.invoke
      .saveSettings(patch)
      .catch((error: unknown) => {
        console.error('Failed to save settings:', error);
      })
      .finally(() => {
        inFlightRef.current -= 1;
      });
  }, []);

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((current) => ({ ...current, ...patch }));
      pendingRef.current = { ...pendingRef.current, ...patch };

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(flush, WRITE_DELAY_MS);
    },
    [flush],
  );

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

  useEffect(
    () =>
      appApi.events.onSettingsChanged((next) => {
        // Every save comes straight back as a broadcast. Applying one while an
        // edit is still settling would undo whatever was typed in the meantime,
        // so the dialog only follows changes made somewhere else.
        if (pendingRef.current === null && inFlightRef.current === 0) {
          setSettings(next);
        }
      }),
    [],
  );

  // A settling edit must not be lost to the dialog or window closing, whether that tears
  // the renderer down or only unmounts the tree.
  useEffect(() => {
    window.addEventListener('beforeunload', flush);

    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [flush]);

  return { settings, loaded, update };
}
