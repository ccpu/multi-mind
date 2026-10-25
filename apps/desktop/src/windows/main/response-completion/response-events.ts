import type { AiResponseCompleted, ResponseTracker } from '@internal/multi-mind';
import { createResponseTracker } from '@internal/multi-mind';

/** One tracker per host window, preserved across development module updates. */
const trackerKey = Symbol.for('multi-mind.response-tracker');
const previousTracker = import.meta.env.DEV
  ? (Reflect.get(globalThis, trackerKey) as ResponseTracker | undefined)
  : undefined;
export const responseTracker = previousTracker ?? createResponseTracker();

// Vite dependency updates can load a new URL; keep one bus in this host window.
if (import.meta.env.DEV) {
  Reflect.set(globalThis, trackerKey, responseTracker);
}

/** Subscribe from non-React features; dispose the returned subscription when finished. */
export function onAiResponseCompleted(
  listener: (event: AiResponseCompleted) => void,
): () => void {
  return responseTracker.subscribe(listener);
}
