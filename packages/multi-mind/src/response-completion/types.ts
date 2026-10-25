/** Page evidence for one submitted prompt; never includes the answer text. */
export interface ResponseReport {
  attemptId: string;
  status: 'observing' | 'generating' | 'completed' | 'cancelled' | 'failed' | 'unknown';
  responseId: string;
  url: string;
  /** Diagnostic state only; never contains prompt or answer text. */
  reason?: string;
}

/** A completion accepted by the host for its current prompt attempt. */
export interface AiResponseCompleted {
  websiteId: string;
  attemptId: string;
  responseId: string;
  url: string;
  completedAt: number;
  evidence: 'provider-ui';
}

/** Selectors stay together per provider and must identify whole answer actions. */
export interface ResponseProvider {
  origins: readonly string[];
  responseSelector: string;
  turnSelector: string;
  busySelector: string;
  completeSelector: string;
  userSelector?: string;
  errorSelector?: string;
}

export const RESPONSE_MESSAGE_PREFIX = '__response__';

export interface ResponseTracker {
  begin: (websiteId: string, attemptId: string, url: string) => void;
  cancel: (websiteId: string) => void;
  clear: () => void;
  accept: (websiteId: string, report: ResponseReport) => void;
  subscribe: (listener: (event: AiResponseCompleted) => void) => () => void;
}
