import { beforeEach, describe, expect, it, vi } from 'vitest';

const openUrl = vi.fn();

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

const { openExternal } = await import('../src/external');

beforeEach(() => {
  openUrl.mockReset();
});

describe('openExternal', () => {
  it('hands a web link to the browser the user actually chose', async () => {
    await openExternal('https://example.com/thread');

    expect(openUrl).toHaveBeenCalledWith('https://example.com/thread');
  });

  it('refuses a target the shell should never be handed', async () => {
    // eslint-disable-next-line no-script-url -- the point of the case is that this never leaves the app.
    await expect(openExternal('javascript:alert(1)')).rejects.toThrow(/Refusing/u);
    expect(openUrl).not.toHaveBeenCalled();
  });
});
