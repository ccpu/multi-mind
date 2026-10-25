import type { ResponseProvider } from './types';

/** Editable page selectors, stored with the rest of each site's settings. */
export type ResponseSelectors = Omit<ResponseProvider, 'origins'>;

/** Migrates older sites to provider defaults while preserving explicit empty/custom selectors. */
export function normalizeResponseSelectors(
  value: unknown,
  defaults?: ResponseSelectors,
): ResponseSelectors {
  const stored =
    typeof value === 'object' && value !== null
      ? (value as Partial<Record<keyof ResponseSelectors, unknown>>)
      : {};
  const field = (key: keyof ResponseSelectors) =>
    typeof stored[key] === 'string' ? stored[key] : (defaults?.[key] ?? '');
  return {
    responseSelector: field('responseSelector'),
    turnSelector: field('turnSelector'),
    busySelector: field('busySelector'),
    completeSelector: field('completeSelector'),
    userSelector: field('userSelector'),
    errorSelector: field('errorSelector'),
  };
}
