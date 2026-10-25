import type { GuestMessageEvent } from '@internal/multi-mind';

const listeners = new Set<(event: GuestMessageEvent) => void>();

/** Delivers host-generated automation evidence without evaluating guest JavaScript. */
export function publishGuestMessage(event: GuestMessageEvent): void {
  for (const listener of listeners) listener(event);
}

/** Connects host automation to the existing guest-message consumers. */
export function onLocalGuestMessage(
  listener: (event: GuestMessageEvent) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
