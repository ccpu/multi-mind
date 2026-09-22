/**
 * Where `settings.json` lives. It sits in the app's own data folder unless the
 * user points it somewhere else — a synced folder, say — from the settings
 * window.
 *
 * The chosen folder cannot be recorded in the settings file itself, since the
 * app would have to already know where that is to read it. A pointer file stays
 * behind in the data folder instead, and is the one thing that never moves.
 */
export const SETTINGS_FILE_NAME = 'settings.json';

/** Name of the pointer file that survives in the data folder after a move. */
export const SETTINGS_LOCATION_FILE_NAME = 'settings-location.json';

export interface SettingsLocation {
  /** Absolute path of the folder holding the settings file. */
  directory: string;
  /** Absolute path of the settings file itself. */
  filePath: string;
  /** The app's own data folder, which is where the file lives by default. */
  defaultDirectory: string;
  /** False once the file has been moved somewhere else. */
  isDefault: boolean;
}

/**
 * What came of a request to move the settings file.
 *
 * - `ok` — the file is at the new folder, and `location` describes it.
 * - `missing` — the folder is not there; ask whether to create it, then send
 *   the same request again with `create`.
 * - `occupied` — the folder already holds a settings file; ask which of the two
 *   settings files to keep, then send the same request again with `conflict`.
 * - `invalid` — the path cannot be used at all, and `message` says why.
 */
export type SettingsLocationStatus = 'invalid' | 'missing' | 'occupied' | 'ok';

/**
 * Which settings survive when the folder already holds a settings file. The
 * file already there is as likely to be the one worth keeping — a second
 * machine pointed at the same synced folder — as the one being moved, so this
 * is never decided without asking.
 */
export type SettingsFileConflictChoice = 'adopt' | 'replace';

export interface SettingsLocationRequest {
  /** Create the folder, having asked, rather than answering `missing`. */
  create?: boolean;
  /**
   * What to do about a settings file already in the folder, having asked:
   * `adopt` loads it and drops the settings in use, `replace` overwrites it.
   */
  conflict?: SettingsFileConflictChoice;
}

export interface SettingsLocationResult {
  status: SettingsLocationStatus;
  /** The absolute folder the request resolved to. */
  directory: string;
  /** Set when the status is `ok`. */
  location?: SettingsLocation;
  /** Why the path was rejected; set when the status is `invalid`. */
  message?: string;
}

/**
 * The frontend check, which is only about the shape of the text typed into the
 * box. Whether the folder is really there, and writable, is something only the
 * Rust side can answer.
 */
export function describeSettingsPathProblem(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed === '') {
    return 'Enter a folder for the settings file.';
  }

  // A settings file has to be findable from a path alone, wherever the app was
  // started from, so a relative path is not good enough.
  if (!/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]|\/)/iu.test(trimmed)) {
    return 'Enter a full path, such as D:\\Multi Mind or \\\\server\\share\\Multi Mind.';
  }

  return null;
}
