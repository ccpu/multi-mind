import type { GuestDownloadEvent } from '@internal/multi-mind';
import { toast, Toaster } from '@pixpilot/shadcn-ui';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDownloadToasts } from '../src/windows/main/hooks/useDownloadToasts';
import { useOverlayPresence } from '../src/windows/main/hooks/useOverlayPresence';

const { listeners } = vi.hoisted(() => ({
  listeners: new Set<(event: GuestDownloadEvent) => void>(),
}));

vi.mock('@internal/tauri-api', () => ({
  appApi: {
    guest: { setOverlays: async () => true },
    events: {
      onGuestDownload: (listener: (event: GuestDownloadEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  },
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

const download: GuestDownloadEvent = {
  websiteId: 'chatgpt',
  url: 'https://example.com/report.pdf',
  state: 'finished',
  path: 'C:\\Users\\User\\Downloads\\report.pdf',
};

async function announce(event: GuestDownloadEvent): Promise<void> {
  await act(async () => listeners.forEach((listener) => listener(event)));
}

beforeEach(() => {
  listeners.clear();
  vi.mocked(revealItemInDir).mockReset().mockResolvedValue(undefined);
  render(
    <>
      <button type="button">Outside toast</button>
      <Toaster position="top-right" />
    </>,
  );
  screen.getByRole('button', { name: 'Outside toast' }).focus();
});

afterEach(() => {
  act(() => toast.dismissAll());
  vi.restoreAllMocks();
});

describe('download toasts', () => {
  it('reveals the completed file without hiding the browsers', async () => {
    const user = userEvent.setup();
    const { result } = renderHook(() => {
      useDownloadToasts();
      return useOverlayPresence();
    });
    await announce(download);
    const action = await screen.findByRole('button', { name: /Show in folder/u });
    expect(result.current).toBe(false);
    expect(action).toHaveTextContent(download.path!);

    await user.click(action);

    expect(revealItemInDir).toHaveBeenCalledExactlyOnceWith(download.path);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('supports opening the folder with the keyboard', async () => {
    const user = userEvent.setup();
    renderHook(() => useDownloadToasts());
    await announce(download);
    const action = await screen.findByRole('button', { name: /Show in folder/u });
    action.focus();

    await user.keyboard('{Enter}');

    expect(revealItemInDir).toHaveBeenCalledExactlyOnceWith(download.path);
  });

  it('closes without opening the folder when dismissed', async () => {
    const user = userEvent.setup();
    renderHook(() => useDownloadToasts());
    await announce(download);

    await user.click(await screen.findByRole('button', { name: 'Close' }));

    expect(revealItemInDir).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Download complete')).toBeNull());
  });

  it('offers no folder action when the saved path is unavailable', async () => {
    renderHook(() => useDownloadToasts());
    await announce({ ...download, path: null });

    expect(await screen.findByText('Download complete')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show in folder/u })).toBeNull();
  });

  it('reports folder-opening errors and keeps the download available to retry', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(revealItemInDir).mockRejectedValueOnce(new Error('Explorer failed'));
    renderHook(() => useDownloadToasts());
    await announce(download);

    await user.click(await screen.findByRole('button', { name: /Show in folder/u }));

    expect(await screen.findByText('Could not open download folder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show in folder/u })).toBeInTheDocument();
  });

  it('announces started and failed downloads without a folder action', async () => {
    renderHook(() => useDownloadToasts());
    await announce({ ...download, state: 'started' });
    await announce({ ...download, state: 'failed' });

    expect(await screen.findByText('Downloading')).toBeInTheDocument();
    expect(screen.getByText('Download failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show in folder/u })).toBeNull();
  });

  it('unsubscribes when the window unmounts', () => {
    const { unmount } = renderHook(() => useDownloadToasts());
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
