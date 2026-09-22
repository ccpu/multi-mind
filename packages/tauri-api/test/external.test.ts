import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openExternal } from '../src/external';

const openUrl = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

describe('openExternal', () => {
  beforeEach(() => {
    openUrl.mockReset();
    openUrl.mockResolvedValue(undefined);
  });

  it('opens an https url', async () => {
    await openExternal('https://tauri.app');

    expect(openUrl).toHaveBeenCalledWith('https://tauri.app/');
  });

  it('refuses a non-web protocol', async () => {
    await expect(openExternal('file:///etc/passwd')).rejects.toThrow(
      'Refusing to open a file: URL externally',
    );
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('rejects a string that is not a url', async () => {
    await expect(openExternal('not a url')).rejects.toThrow();
    expect(openUrl).not.toHaveBeenCalled();
  });
});
