import type {
  AppSettings,
  SettingsLocation,
  SettingsLocationRequest,
  SettingsLocationResult,
} from '@internal/multi-mind';
import type { AppInfo, OpenWindowResult } from './types';
import { describeSettingsPathProblem, normalizeSettings } from '@internal/multi-mind';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

/**
 * Every Rust command the frontend is allowed to call, in one place.
 *
 * Nothing else should import `invoke` directly: it takes a string and returns
 * `unknown`, so a renamed command or a changed payload only shows up at
 * runtime. Going through this module means a rename breaks the build instead.
 *
 * This is the file that replaced `@internal/ipc` in the Electron port. The
 * shape either side sees is the same — a settings object in, a settings object
 * out — because it is `AppSettings` that both windows are really talking
 * about, not the mechanism carrying it.
 */

/** Name, version and host details read from the Tauri runtime. */
export async function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('app_info');
}

/**
 * Reads the persisted settings (port of `Settings.Load`).
 *
 * Rust keeps the file but not the shape: what a setting means, what it falls
 * back to and how an older file is carried forward are all `normalizeSettings`,
 * which is tested. So the raw JSON is normalised here, on the way in, and a
 * settings file that is empty, half-written or a version old comes out as a
 * complete `AppSettings` all the same.
 */
export async function getSettings(): Promise<AppSettings> {
  return normalizeSettings(await invoke<unknown>('get_settings'));
}

/** Merges a patch into the persisted settings (port of `Settings.Save`). */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return normalizeSettings(await invoke<unknown>('save_settings', { patch }));
}

/** Which folder `settings.json` is in, and whether that is the default. */
export async function getSettingsLocation(): Promise<SettingsLocation> {
  return invoke<SettingsLocation>('get_settings_location');
}

/**
 * Opens the native folder picker; resolves to null when it is cancelled.
 *
 * The Electron port answered this in its main process, because a renderer had
 * no way to raise a native dialog. Tauri's dialog plugin has one, so the call
 * goes straight out from here — the Rust side never sees it.
 */
export async function browseSettingsLocation(
  defaultPath?: string,
): Promise<string | null> {
  const chosen = await open({
    title: 'Choose a folder for the settings file',
    directory: true,
    multiple: false,
    // Only sent when there is one: the picker takes a folder to start in, not
    // the absence of one.
    ...(defaultPath === undefined ? {} : { defaultPath }),
  });

  return typeof chosen === 'string' ? chosen : null;
}

/**
 * Moves the settings file to `directory`. A folder that is missing or already
 * holds a settings file comes back as a status to ask the user about rather
 * than an error; sending the request again with the matching flag goes ahead
 * with it.
 */
export async function setSettingsLocation(
  directory: string,
  request: SettingsLocationRequest = {},
): Promise<SettingsLocationResult> {
  // The shape of the path is decided here, where it is tested; whether the
  // folder is really there, and writable, is something only Rust can answer.
  const problem = describeSettingsPathProblem(directory);

  if (problem !== null) {
    return { status: 'invalid', directory: directory.trim(), message: problem };
  }

  return invoke<SettingsLocationResult>('set_settings_location', {
    directory,
    request,
  });
}

/** Moves the settings file back to the app's own data folder. */
export async function resetSettingsLocation(
  request: SettingsLocationRequest = {},
): Promise<SettingsLocationResult> {
  return invoke<SettingsLocationResult>('reset_settings_location', { request });
}

/**
 * Raises a window by name, opening it if it is not up yet.
 *
 * `main` and `settings` are the two the app configures. Asking for one that is
 * already open focuses it rather than opening a second copy, which is what the
 * Electron port's `openWindow` did.
 */
export async function openWindow(windowName: string): Promise<OpenWindowResult> {
  return invoke<OpenWindowResult>('open_window', { windowName });
}
