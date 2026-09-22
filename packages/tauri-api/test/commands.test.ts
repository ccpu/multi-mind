import type { AppSettings } from '@internal/multi-mind';
import { DEFAULT_SETTINGS } from '@internal/multi-mind';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const openDialog = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openDialog }));

const {
  browseSettingsLocation,
  resetSettingsLocation,
  saveSettings,
  setSettingsLocation,
} = await import('../src/commands');

beforeEach(() => {
  invoke.mockReset();
  openDialog.mockReset();
});

describe('saveSettings', () => {
  it('sends the patch under the name the Rust command takes', async () => {
    const patch: Partial<AppSettings> = { autoShrink: false };
    invoke.mockResolvedValue(DEFAULT_SETTINGS);

    await saveSettings(patch);

    expect(invoke).toHaveBeenCalledWith('save_settings', { patch });
  });
});

describe('setSettingsLocation', () => {
  /*
   * A folder that is missing or already occupied comes back as a status the
   * window asks about, and the same call is then made again with the answer.
   * An omitted request has to reach Rust as an empty object rather than
   * `undefined`, or the second call cannot be told from the first.
   */
  it('always sends a request object, answered or not', async () => {
    invoke.mockResolvedValue({ status: 'ok', directory: 'D:\\Multi Mind' });

    await setSettingsLocation('D:\\Multi Mind');

    expect(invoke).toHaveBeenCalledWith('set_settings_location', {
      directory: 'D:\\Multi Mind',
      request: {},
    });
  });

  it('carries the answer through on the second attempt', async () => {
    invoke.mockResolvedValue({ status: 'ok', directory: 'D:\\Multi Mind' });

    await setSettingsLocation('D:\\Multi Mind', { conflict: 'adopt' });

    expect(invoke).toHaveBeenCalledWith('set_settings_location', {
      directory: 'D:\\Multi Mind',
      request: { conflict: 'adopt' },
    });
  });
});

describe('resetSettingsLocation', () => {
  it('needs no folder, because the default is the one Rust knows', async () => {
    invoke.mockResolvedValue({ status: 'ok', directory: '' });

    await resetSettingsLocation();

    expect(invoke).toHaveBeenCalledWith('reset_settings_location', { request: {} });
  });
});

describe('browseSettingsLocation', () => {
  it('asks for one folder and gives back what was chosen', async () => {
    openDialog.mockResolvedValue('D:\\Multi Mind');

    await expect(browseSettingsLocation('C:\\current')).resolves.toBe('D:\\Multi Mind');
    expect(openDialog).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false }),
    );
  });

  it('answers null when the picker is cancelled', async () => {
    openDialog.mockResolvedValue(null);

    await expect(browseSettingsLocation()).resolves.toBeNull();
  });
});
