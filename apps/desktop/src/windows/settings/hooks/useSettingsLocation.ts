import type {
  SettingsFileConflictChoice,
  SettingsLocation,
  SettingsLocationRequest,
  SettingsLocationResult,
} from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { registerDialog, showConfirmDialog } from '@pixpilot/shadcn-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingsFileConflictDialog } from '../components/SettingsFileConflictDialog';

const conflictDialog = registerDialog(
  'settings-file-conflict',
  SettingsFileConflictDialog,
);

export interface SettingsLocationStatus {
  tone: 'error' | 'success';
  message: string;
}

export interface UseSettingsLocationResult {
  /** Null until Rust has said where the settings file is. */
  location: SettingsLocation | null;
  /** The folder in the text box, which is not saved until `save` is called. */
  draft: string;
  setDraft: (value: string) => void;
  status: SettingsLocationStatus | null;
  /** True while a move is in flight, so the buttons can be held. */
  busy: boolean;
  browse: () => void;
  save: () => void;
  useDefault: () => void;
}

type Invoker = (request: SettingsLocationRequest) => Promise<SettingsLocationResult>;

interface AppliedMove {
  result: SettingsLocationResult;
  /** True when the settings file already in the folder was the one kept. */
  adopted: boolean;
}

/**
 * Asks about a folder that is not there, or one that already holds a settings
 * file, and sends the same request again once the user has answered. Resolves
 * to null when they back out.
 */
async function applyWithPrompts(
  invoke: Invoker,
  request: SettingsLocationRequest = {},
): Promise<AppliedMove | null> {
  const result = await invoke(request);

  if (result.status === 'missing') {
    const confirmed = await showConfirmDialog({
      title: 'That folder does not exist',
      description: `${result.directory} is not there yet. Create it and move the settings file into it?`,
      confirmText: 'Create folder',
    });

    return confirmed ? applyWithPrompts(invoke, { ...request, create: true }) : null;
  }

  if (result.status === 'occupied') {
    const choice = await conflictDialog.show<
      SettingsFileConflictChoice | null | undefined
    >({ directory: result.directory });

    return choice === null || choice === undefined
      ? null
      : applyWithPrompts(invoke, { ...request, conflict: choice });
  }

  return { result, adopted: request.conflict === 'adopt' };
}

/**
 * Drives the folder the settings file is kept in. The folder can be typed or
 * picked from the native dialog; either way Rust is what validates it, so the
 * two routes cannot disagree.
 */
export function useSettingsLocation(): UseSettingsLocationResult {
  const [location, setLocation] = useState<SettingsLocation | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<SettingsLocationStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    let cancelled = false;

    appApi.invoke
      .getSettingsLocation()
      .then((stored) => {
        if (!cancelled) {
          setLocation(stored);
          setDraft(stored.directory);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to read the settings location:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const commit = useCallback((invoke: Invoker) => {
    setBusy(true);
    setStatus(null);

    applyWithPrompts(invoke)
      .then((applied) => {
        if (applied === null) {
          return;
        }

        const { result, adopted } = applied;

        if (result.status === 'ok' && result.location !== undefined) {
          setLocation(result.location);
          setDraft(result.location.directory);
          setStatus({
            tone: 'success',
            message: adopted
              ? 'Now using the settings file that was already in that folder.'
              : 'Your data has been moved to that folder.',
          });
          return;
        }

        setStatus({
          tone: 'error',
          message: result.message ?? 'That folder could not be used.',
        });
      })
      .catch((error: unknown) => {
        console.error('Failed to move the data folder:', error);
        setStatus({ tone: 'error', message: 'Your data could not be moved.' });
      })
      .finally(() => {
        setBusy(false);
      });
  }, []);

  const browse = useCallback(() => {
    appApi.invoke.browseSettingsLocation(draftRef.current).then(
      (directory) => {
        if (directory !== null) {
          setDraft(directory);
          setStatus(null);
        }
      },
      (error: unknown) => {
        console.error('Failed to open the folder picker:', error);
      },
    );
  }, []);

  const save = useCallback(() => {
    commit(async (request) =>
      appApi.invoke.setSettingsLocation(draftRef.current, request),
    );
  }, [commit]);

  const useDefault = useCallback(() => {
    commit(async (request) => appApi.invoke.resetSettingsLocation(request));
  }, [commit]);

  return { location, draft, setDraft, status, busy, browse, save, useDefault };
}
