import type { WebsiteInfo } from '@internal/multi-mind';
import { toast } from '@pixpilot/shadcn-ui';
import { useEffect } from 'react';
import { onAiResponseCompleted } from '../response-events';

/** Development feedback only; production features can subscribe independently. */
export function useResponseCompletionToast(websites: readonly WebsiteInfo[]): void {
  useEffect(
    () =>
      import.meta.env.DEV
        ? onAiResponseCompleted((event) => {
            const name =
              websites.find((website) => website.id === event.websiteId)?.name ??
              event.websiteId;
            toast.success({
              title: `${name} finished responding`,
              description: 'Response completion detected',
            });
          })
        : undefined,
    [websites],
  );
}
