import { GUEST_DOWNLOAD_EVENT, GUEST_MESSAGE_EVENT } from '@internal/multi-mind';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listen = vi.fn(async () => () => undefined);

vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main-2' }),
}));

const { onGuestDownload, onGuestMessage, onSettingsChanged, SETTINGS_CHANGED_EVENT } =
  await import('../src/events');

beforeEach(() => {
  listen.mockClear();
});

describe('event subscriptions', () => {
  it('hears a guest message only when it was sent to this window', () => {
    onGuestMessage(() => undefined);

    expect(listen).toHaveBeenCalledWith(GUEST_MESSAGE_EVENT, expect.any(Function), {
      target: 'main-2',
    });
  });

  it('hears a download only when it was sent to this window', () => {
    onGuestDownload(() => undefined);

    expect(listen).toHaveBeenCalledWith(GUEST_DOWNLOAD_EVENT, expect.any(Function), {
      target: 'main-2',
    });
  });

  it('hears a settings change whichever window made it', () => {
    onSettingsChanged(() => undefined);

    expect(listen).toHaveBeenCalledWith(
      SETTINGS_CHANGED_EVENT,
      expect.any(Function),
      undefined,
    );
  });
});
