import type { GuestDownloadEvent } from '@internal/multi-mind';
import { appApi } from '@internal/tauri-api';
import { toast } from '@pixpilot/shadcn-ui';
import { createElement, useEffect } from 'react';
import { DownloadCompleteToast } from '../components/downloads/DownloadCompleteToast';

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
          toast.info({ title: 'Downloading', description: name }, { duration: 2000 });
        } else if (event.state === 'finished') {
          const { path } = event;
          if (path !== null && path !== '') {
            toast.custom(
              ({ dismiss }) =>
                createElement(DownloadCompleteToast, { path, onDismiss: dismiss }),
              { duration: 10000 },
            );
          } else {
            toast.success(
              { title: 'Download complete', description: name },
              { duration: 10000 },
            );
          }
        } else {
          toast.error({ title: 'Download failed', description: name });
        }
      }),
    [],
  );
}
