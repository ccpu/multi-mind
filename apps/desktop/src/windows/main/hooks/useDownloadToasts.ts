import type { GuestDownloadEvent } from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { toast } from '@pixpilot/shadcn-ui';
import { useEffect } from 'react';

function fileName(event: GuestDownloadEvent): string {
  const source = event.path ?? event.url;
  const name = source.replaceAll('\\', '/').split('/').at(-1);
  return name !== undefined && name !== '' ? name : source;
}

/**
 * An embedded browser has no download bar of its own, so each download it
 * starts, finishes or loses is announced here instead.
 */
export function useDownloadToasts(): void {
  useEffect(
    () =>
      appApi.events.onGuestDownload((event) => {
        const name = fileName(event);

        if (event.state === 'started') {
          toast.info({ title: 'Downloading', description: name });
        } else if (event.state === 'finished') {
          toast.success({ title: 'Download complete', description: event.path ?? name });
        } else {
          toast.error({ title: 'Download failed', description: name });
        }
      }),
    [],
  );
}
