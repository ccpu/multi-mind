import type { PromptPreset } from '@internal/multi-mind';
import { unusedPrompts } from '@internal/multi-mind';
import { useCallback, useRef, useState } from 'react';

export interface UseUsedPresetsResult {
  /** Ids of the use-once presets already sent in this window's chat. */
  usedPrompts: readonly string[];
  /** The ticked presets still to go out, read at the moment of sending. */
  unused: (ticked: readonly PromptPreset[]) => PromptPreset[];
  /** Records the use-once presets that went out with a message. */
  markSent: (sent: readonly PromptPreset[]) => void;
  /** Lets a used preset go out with one more message in this chat. */
  reuse: (promptId: string) => void;
  /** Starts the chat over, as **New Chat** does, so every preset goes out again. */
  reset: () => void;
}

/**
 * Which use-once presets have already gone out in this window's chat. Unlike
 * the ticks, this belongs to the window and is never saved: each window has a
 * chat of its own, and a new one starts with every ticked preset ready to go.
 */
export function useUsedPresets(): UseUsedPresetsResult {
  const [usedPrompts, setUsedPrompts] = useState<readonly string[]>([]);

  // Read when sending, which can happen twice before a render catches up.
  const usedRef = useRef(usedPrompts);

  const update = useCallback((next: readonly string[]) => {
    usedRef.current = next;
    setUsedPrompts(next);
  }, []);

  const unused = useCallback(
    (ticked: readonly PromptPreset[]) => unusedPrompts(ticked, usedRef.current),
    [],
  );

  const markSent = useCallback(
    (sent: readonly PromptPreset[]) => {
      const fresh = sent
        .filter((preset) => preset.sendOnce && !usedRef.current.includes(preset.id))
        .map((preset) => preset.id);

      if (fresh.length > 0) {
        update([...usedRef.current, ...fresh]);
      }
    },
    [update],
  );

  const reuse = useCallback(
    (promptId: string) => {
      if (usedRef.current.includes(promptId)) {
        update(usedRef.current.filter((id) => id !== promptId));
      }
    },
    [update],
  );

  const reset = useCallback(() => {
    if (usedRef.current.length > 0) {
      update([]);
    }
  }, [update]);

  return { usedPrompts, unused, markSent, reuse, reset };
}
