import { openUrl } from '@tauri-apps/plugin-opener';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Open a link in the user's browser instead of inside the app window.
 *
 * A webview that navigates away from the frontend has no back button and keeps
 * the app's privileges, so external links go to the OS. The protocol check is
 * the frontend half of the defence; the other half is the `opener:` permission
 * in `src-tauri/capabilities/default.json`, which the Rust side enforces.
 */
export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url);

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Refusing to open a ${parsed.protocol} URL externally: ${url}`);
  }

  await openUrl(parsed.href);
}
