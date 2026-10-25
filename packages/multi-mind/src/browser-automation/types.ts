import type { WebsiteInfo } from '../websites';

/** Host-owned request; selectors and text are data rather than a page script. */
export interface BrowserPromptRequest {
  website: WebsiteInfo;
  prompt: string;
  attemptId: string;
}

/** Short, stateless operations implemented by each browser backend. */
export type BrowserAction =
  | { kind: 'fill'; selector: string; text: string }
  | { kind: 'click'; selector: string }
  | { kind: 'snapshot'; selectors: WebsiteInfo['responseSelectors']; prompt: string };

/** Evidence returned to the host without transferring the assistant's answer. */
export interface BrowserSnapshot {
  url: string;
  title: string;
  responseCount: number;
  userCount: number;
  userMatches: boolean;
  responseId: string;
  fingerprint: string;
  hasText: boolean;
  busy: boolean;
  complete: boolean;
  error: string;
}

/** Shared workflow depends on operations, independently of the OS executor. */
export interface BrowserBackend {
  fill: (selector: string, text: string) => Promise<boolean>;
  click: (selector: string) => Promise<boolean>;
  snapshot: () => Promise<BrowserSnapshot>;
}
