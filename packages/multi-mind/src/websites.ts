import { createId } from './ids';

/**
 * Port of `Multi Mind/Models/Website.cs` (`WebsiteInfo`) and the `websites` field of
 * `Multi Mind/MainForm.cs`. The WinForms build hard-coded that list; here it is only
 * the seed for {@link AppSettings.websites}, which the settings window owns and
 * the user can edit, reorder and extend. The defaults, their order and every
 * selector are still byte-for-byte identical to the original.
 */
export interface WebsiteInfo {
  /**
   * Stable identity. Everything that refers to a site — the settings file, the
   * guest webview registry, the drag-and-drop list — uses this rather than
   * `name`, so renaming a site keeps it wired up. The seeded sites use their
   * original name as their id, which is what lets a settings file written
   * before the catalogue became editable keep working.
   */
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly inputSelector: string;
  readonly buttonSelector: string;
  /** Whether the site gets a toggle in the main window's menu bar. */
  readonly enabled: boolean;
  /**
   * Follow the seeded definition in {@link DEFAULT_WEBSITES} rather than the
   * fields stored here. A site's selectors break whenever the site itself is
   * redesigned, and the fix then ships with the app; leaving this on is what
   * lets that fix arrive without the user having to retype anything. The
   * stored fields are kept as they are, so turning it off brings back whatever
   * was typed before. Meaningless on a site the user added, which has no seed.
   */
  readonly useDefaults: boolean;
}

/** The fields the settings window lets the user type into. */
export type WebsiteDraft = Omit<WebsiteInfo, 'id'>;

function seed(website: Omit<WebsiteInfo, 'id' | 'useDefaults'>): WebsiteInfo {
  return { ...website, id: website.name, useDefaults: true };
}

export const DEFAULT_WEBSITES: readonly WebsiteInfo[] = [
  seed({
    name: 'claude',
    url: 'https://claude.ai/new',
    inputSelector: '[contenteditable]',
    buttonSelector: "button[aria-label='Send message']",
    enabled: true,
  }),
  seed({
    name: 'chatgpt',
    url: 'https://chatgpt.com/',
    inputSelector: 'div[contenteditable="true"][role="textbox"]',
    enabled: true,
    buttonSelector: 'button[type="submit"][aria-label="Send"]',
  }),
  seed({
    name: 'gemini',
    url: 'https://gemini.google.com/app',
    inputSelector: '[contenteditable]',
    enabled: true,
    buttonSelector: '.send-button',
  }),
  seed({
    name: 'deepseek',
    url: 'https://chat.deepseek.com/',
    inputSelector: 'textarea[name="search"][autocomplete="off"]',
    enabled: true,
    buttonSelector:
      'div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle',
  }),
  seed({
    name: 'grok',
    url: 'https://x.com/i/grok',
    inputSelector: 'textarea[placeholder="Ask anything"][autocapitalize="sentences"]',
    enabled: false,
    buttonSelector: 'button[aria-label="Grok something"][role="button"][type="button"]',
  }),
  seed({
    name: 'perplexity',
    url: 'https://www.perplexity.ai/',
    inputSelector:
      '#ask-input[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
    buttonSelector: 'button[aria-label="Submit"][type="button"]',
    enabled: false,
  }),

  seed({
    name: 'qwenlm',
    // qwenlm.ai only redirects here; going straight to the chat skips a hop.
    url: 'https://chat.qwen.ai/',
    inputSelector: 'textarea.message-input-textarea',
    enabled: false,
    // Only rendered once the textarea has text in it, which is why the prompt
    // runner looks for the button after it has filled the input rather than
    // up front.
    buttonSelector: 'button.send-button[aria-label="Send"]',
  }),
];

/** Shape a brand new row starts with, before the user types anything. */
export const BLANK_WEBSITE: WebsiteDraft = {
  name: '',
  url: '',
  inputSelector: 'textarea',
  buttonSelector: 'button[type="submit"]',
  enabled: true,
  // A site the user adds is theirs; there is no seed for it to follow.
  useDefaults: false,
};

const SEEDS_BY_ID = new Map(DEFAULT_WEBSITES.map((website) => [website.id, website]));

/** The seeded definition a site can fall back on, or null for an added site. */
export function getWebsiteSeed(websiteId: string): WebsiteInfo | null {
  return SEEDS_BY_ID.get(websiteId) ?? null;
}

/**
 * The site as everything outside the settings window should see it: the seeded
 * definition when the site is set to follow it, and what the user typed
 * otherwise.
 *
 * `enabled` is never taken from the seed. It is the main window's menu toggle
 * rather than part of what the site is, so switching a site off has to stick
 * whichever way this flag is set.
 */
export function resolveWebsite(website: WebsiteInfo): WebsiteInfo {
  const seeded = website.useDefaults ? getWebsiteSeed(website.id) : null;

  return seeded === null
    ? website
    : {
        ...seeded,
        enabled: website.enabled,
        useDefaults: true,
      };
}

/** A fresh id for a site the user has just added. */
export function createWebsiteId(): string {
  return createId('website');
}

/** Builds a site with a fresh id, ready to be appended to the catalogue. */
export function createWebsite(draft: Partial<WebsiteDraft> = {}): WebsiteInfo {
  return { ...BLANK_WEBSITE, ...draft, id: createWebsiteId() };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Coerces one entry read from `settings.json` into a complete site. Anything
 * that is not an object at all is dropped, because a row with no fields left is
 * not something the settings window could show.
 */
export function normalizeWebsite(value: unknown): WebsiteInfo | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const source = value as Partial<Record<keyof WebsiteInfo, unknown>>;
  const name = asString(source.name, '');

  return {
    // Pre-catalogue settings files stored sites by name and had no id at all.
    id: asString(source.id, name === '' ? createWebsiteId() : name),
    name,
    url: asString(source.url, ''),
    inputSelector: asString(source.inputSelector, BLANK_WEBSITE.inputSelector),
    buttonSelector: asString(source.buttonSelector, BLANK_WEBSITE.buttonSelector),
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
    // A settings file written before the flag existed holds fields the user
    // may well have edited, so it keeps them rather than being pulled back to
    // the seed behind their back.
    useDefaults: source.useDefaults === true,
  };
}

/** Coerces the stored catalogue, dropping junk entries and duplicate ids. */
export function normalizeWebsites(value: unknown): WebsiteInfo[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_WEBSITES];
  }

  const seen = new Set<string>();

  return value.reduce<WebsiteInfo[]>((websites, entry) => {
    const website = normalizeWebsite(entry);

    if (website !== null && !seen.has(website.id)) {
      seen.add(website.id);
      websites.push(website);
    }

    return websites;
  }, []);
}
