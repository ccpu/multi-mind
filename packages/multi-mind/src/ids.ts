let fallbackIdCounter = 0;

/**
 * Identity for anything the settings file keeps a list of.
 *
 * `crypto.randomUUID` is there in every webview the app opens; the fallback
 * only covers test environments that ship a partial `crypto`. The prefix is
 * what makes such a fallback id readable in a hand-edited settings file.
 */
export function createId(prefix: string): string {
  const { crypto } = globalThis;

  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  fallbackIdCounter += 1;
  return `${prefix}-${String(Date.now())}-${String(fallbackIdCounter)}`;
}
