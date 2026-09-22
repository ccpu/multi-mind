/**
 * A command either succeeded with a value or failed with a message.
 *
 * Rust returns `Result<T, String>` from `#[tauri::command]`, which arrives in
 * JavaScript as a resolved promise or a rejected one. Wrapping that in a value
 * keeps call sites free of try/catch when the failure is expected - a missing
 * file, a denied permission - and keeps the error text typed as a string
 * instead of `unknown`.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}

/**
 * Run a promise and capture its rejection as an error string.
 */
export async function toResult<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    return ok(await promise);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}
