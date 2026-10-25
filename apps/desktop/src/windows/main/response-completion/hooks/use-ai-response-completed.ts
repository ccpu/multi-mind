import type { AiResponseCompleted } from '@internal/multi-mind';
import { useEffect, useRef } from 'react';
import { onAiResponseCompleted } from '../response-events';

/** Listen to confirmed completions in this window without owning detection or tracking. */
export function useAiResponseCompleted(
  listener: (event: AiResponseCompleted) => void,
): void {
  const latestRef = useRef(listener);
  useEffect(() => {
    latestRef.current = listener;
  }, [listener]);
  useEffect(() => onAiResponseCompleted((event) => latestRef.current(event)), []);
}
