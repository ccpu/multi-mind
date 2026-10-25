import { appApi } from '@internal/tauri-api';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOfBrowsers,
  useOverlayPresence,
} from '../src/windows/main/hooks/useOverlayPresence';

vi.mock('@internal/tauri-api', () => ({
  appApi: { guest: { setOverlays: vi.fn() } },
}));

beforeEach(() => {
  vi.mocked(appApi.guest.setOverlays).mockReset().mockResolvedValue(true);
});

/** Portals a popper wrapper the way Radix does, around `content`. */
async function portal(content: HTMLElement): Promise<void> {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-radix-popper-content-wrapper', '');
  vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(20, 40, 300, 200),
  );
  wrapper.append(content);

  await act(async () => {
    document.body.append(wrapper);
  });
}

describe('useOverlayPresence', () => {
  afterEach(() => {
    document
      .querySelectorAll(
        '[data-radix-popper-content-wrapper], [data-sonner-toast], [data-slot="dialog-overlay"], [role="dialog"]',
      )
      .forEach((wrapper) => wrapper.remove());
    document.body.style.pointerEvents = '';
  });

  it('keeps browsers visible while toasts appear and disappear', async () => {
    const { result } = renderHook(() => useOverlayPresence());
    const first = document.createElement('li');
    const second = document.createElement('li');
    first.setAttribute('data-sonner-toast', '');
    second.setAttribute('data-sonner-toast', '');

    await act(async () => {
      document.body.append(first, second);
    });
    expect(result.current).toBe(false);

    await act(async () => first.remove());
    expect(result.current).toBe(false);

    await act(async () => second.remove());
    expect(result.current).toBe(false);
  });

  it('does not hide browsers for an empty toaster', async () => {
    const { result } = renderHook(() => useOverlayPresence());
    const toaster = document.createElement('ol');
    toaster.setAttribute('data-sonner-toaster', '');

    await act(async () => document.body.append(toaster));
    expect(result.current).toBe(false);
    toaster.remove();
  });

  it('clips the popover area while leaving native browsers visible', async () => {
    const { result } = renderHook(() => useOverlayPresence());

    await portal(document.createElement('div'));

    expect(result.current).toBe(false);
    expect(appApi.guest.setOverlays).toHaveBeenLastCalledWith(
      [{ x: 20, y: 40, width: 300, height: 200 }],
      false,
    );
  });

  it('clips a dialog without treating its full-window backdrop as covered browser content', async () => {
    const { result } = renderHook(() => useOverlayPresence());
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(300, 100, 500, 400),
    );
    const backdrop = document.createElement('div');
    backdrop.setAttribute('data-slot', 'dialog-overlay');
    await act(async () => document.body.append(backdrop, dialog));

    expect(result.current).toBe(false);
    expect(appApi.guest.setOverlays).toHaveBeenLastCalledWith(
      [{ x: 300, y: 100, width: 500, height: 400 }],
      true,
    );
    await act(async () => {
      backdrop.remove();
      dialog.remove();
    });
    expect(appApi.guest.setOverlays).toHaveBeenLastCalledWith([], false);
  });

  it('retains the visibility fallback on platforms without native clipping', async () => {
    vi.mocked(appApi.guest.setOverlays).mockResolvedValue(false);
    const { result } = renderHook(() => useOverlayPresence());
    await portal(document.createElement('div'));
    expect(result.current).toBe(true);
  });

  it('keeps a modal menu modal without hiding browsers', async () => {
    const { result } = renderHook(() => useOverlayPresence());
    document.body.style.pointerEvents = 'none';
    await portal(document.createElement('div'));
    expect(result.current).toBe(false);
    expect(appApi.guest.setOverlays).toHaveBeenLastCalledWith(
      [{ x: 20, y: 40, width: 300, height: 200 }],
      true,
    );
  });

  it('leaves the browsers alone for content kept clear of them', async () => {
    const { result } = renderHook(() => useOverlayPresence());
    const content = document.createElement('div');
    Object.entries(clearOfBrowsers).forEach(([name, value]) => {
      content.setAttribute(name, value);
    });

    await portal(content);

    expect(result.current).toBe(false);
  });
});
