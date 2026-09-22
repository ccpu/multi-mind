const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const BYTES_PER_UNIT = 1024;

/**
 * Format a byte count for display, e.g. `1536` becomes `1.5 KB`.
 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${BYTE_UNITS[0]}`;

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(BYTES_PER_UNIT)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / BYTES_PER_UNIT ** exponent;

  return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${BYTE_UNITS[exponent]}`;
}

/**
 * Truncate text to `maxLength` characters, ellipsis included in the budget.
 */
export function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0 || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}
