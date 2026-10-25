import type { ResponseReport } from './types';
import { RESPONSE_MESSAGE_PREFIX } from './types';

const MAX_REPORT_LENGTH = 8192;
const MAX_REASON_LENGTH = 256;

/** Validates untrusted page messages before they reach the completion tracker. */
export function parseResponseReport(message: string): ResponseReport | null {
  if (
    !message.startsWith(RESPONSE_MESSAGE_PREFIX) ||
    message.length > MAX_REPORT_LENGTH
  ) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(message.slice(RESPONSE_MESSAGE_PREFIX.length));
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const report = value as Partial<Record<keyof ResponseReport, unknown>>;
    if (
      typeof report.attemptId !== 'string' ||
      report.attemptId === '' ||
      typeof report.responseId !== 'string' ||
      typeof report.url !== 'string' ||
      typeof report.status !== 'string' ||
      ![
        'observing',
        'generating',
        'completed',
        'cancelled',
        'failed',
        'unknown',
      ].includes(String(report.status)) ||
      (report.status === 'completed' && report.responseId === '')
    ) {
      return null;
    }
    if (
      report.reason !== undefined &&
      (typeof report.reason !== 'string' || report.reason.length > MAX_REASON_LENGTH)
    ) {
      return null;
    }
    if (!['https:', 'http:'].includes(new URL(report.url).protocol)) {
      return null;
    }
    return {
      attemptId: report.attemptId,
      responseId: report.responseId,
      url: report.url,
      status: report.status as ResponseReport['status'],
      ...(typeof report.reason === 'string' ? { reason: report.reason } : {}),
    };
  } catch {
    return null;
  }
}
