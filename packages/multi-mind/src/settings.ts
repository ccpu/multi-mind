import type { PromptPreset } from './prompts';
import type { WebsiteInfo } from './websites';
import { normalizePromptPresets } from './prompts';
import { DEFAULT_WEBSITES, normalizeWebsites, resolveWebsite } from './websites';

/**
 * Which editor the prompt box is. `markdown` is EasyMDE, which the WinForms
 * build had no equivalent of; `plain` is the bare textarea the first port
 * used, kept for anyone who wants nothing between them and the text.
 */
export type PromptEditorKind = 'markdown' | 'plain';

export const PROMPT_EDITOR_OPTIONS = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'plain', label: 'Plain text' },
] as const satisfies readonly { value: PromptEditorKind; label: string }[];

/** Delays offered before an unfocused chat window releases its rebuildable caches. */
export const IDLE_MEMORY_TRIM_DELAY_OPTIONS = [5, 10, 30, 60] as const;

export type IdleMemoryTrimDelaySeconds = (typeof IDLE_MEMORY_TRIM_DELAY_OPTIONS)[number];

const IDLE_MEMORY_TRIM_DELAY_OPTION_SET = new Set<number>(IDLE_MEMORY_TRIM_DELAY_OPTIONS);

/**
 * Port of `Multi Mind/Settings.cs`. The WinForms version serialised itself to
 * `settings.xml` next to the executable; this one stores the same values as
 * JSON in the app's data folder. Window bounds
 * (`Top`/`Left`/`Width`/`Height`/`Maximized`) are not part of this type because
 * Tauri's window state plugin already persists and restores them.
 *
 * Two lists describe the browsers, and they mean different things:
 *
 * - `websites` is the catalogue the settings window edits. Its order is the
 *   order everything shows the sites in, and `enabled` decides whether a site
 *   gets a toggle in the main window's menu bar at all.
 * - `activeWebsites` holds the ids of the sites whose browser is open right
 *   now, which is what those menu bar toggles flip.
 *
 * The two prompt lists are split the same way: `prompts` is the library the
 * main window's badge row shows, and `activePrompts` holds the ids of the ones
 * ticked, which are the ones that wrap whatever is typed.
 *
 * `autoUpdate` is the only setting that reaches the network: it decides whether
 * the app asks GitHub for a newer release on startup. `autoUpdatePrompted`
 * records that the question has been put to the user, so a packaged app asks
 * once on its first run and never again.
 *
 * `browserMemorySaving` is read when WebView2 starts, so it applies after a
 * full app restart. Its individual browser flags are used only while that
 * switch is on. The inactive-window controls are safe to change live.
 */
export interface AppSettings {
  panelButtonSize: number;
  autoShrink: boolean;
  autoShrinkSize: number;
  promptEditor: PromptEditorKind;
  autoUpdate: boolean;
  autoUpdatePrompted: boolean;
  browserMemorySaving: boolean;
  disableBackForwardCache: boolean;
  enableLowEndDeviceMode: boolean;
  processPerSite: boolean;
  optimizeForSize: boolean;
  trimInactiveWebviews: boolean;
  idleMemoryTrimDelaySeconds: IdleMemoryTrimDelaySeconds;
  websites: WebsiteInfo[];
  activeWebsites: string[];
  prompts: PromptPreset[];
  activePrompts: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  panelButtonSize: 20,
  autoShrink: true,
  autoShrinkSize: 15,
  promptEditor: 'markdown',
  autoUpdate: true,
  autoUpdatePrompted: false,
  browserMemorySaving: false,
  disableBackForwardCache: true,
  enableLowEndDeviceMode: true,
  processPerSite: true,
  optimizeForSize: true,
  trimInactiveWebviews: true,
  idleMemoryTrimDelaySeconds: 10,
  websites: [...DEFAULT_WEBSITES],
  activeWebsites: [],
  prompts: [],
  activePrompts: [],
};

function isPromptEditorKind(value: unknown): value is PromptEditorKind {
  return PROMPT_EDITOR_OPTIONS.some((option) => option.value === value);
}

function isIdleMemoryTrimDelaySeconds(
  value: unknown,
): value is IdleMemoryTrimDelaySeconds {
  return typeof value === 'number' && IDLE_MEMORY_TRIM_DELAY_OPTION_SET.has(value);
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : null;
}

/** Coerces an unknown value read from disk into a complete settings object. */
export function normalizeSettings(value: unknown): AppSettings {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Partial<
    Record<keyof AppSettings | 'enabledWebsites', unknown>
  >;

  return {
    panelButtonSize:
      typeof source.panelButtonSize === 'number'
        ? source.panelButtonSize
        : DEFAULT_SETTINGS.panelButtonSize,
    autoShrink:
      typeof source.autoShrink === 'boolean'
        ? source.autoShrink
        : DEFAULT_SETTINGS.autoShrink,
    autoShrinkSize:
      typeof source.autoShrinkSize === 'number'
        ? source.autoShrinkSize
        : DEFAULT_SETTINGS.autoShrinkSize,
    promptEditor: isPromptEditorKind(source.promptEditor)
      ? source.promptEditor
      : DEFAULT_SETTINGS.promptEditor,
    autoUpdate:
      typeof source.autoUpdate === 'boolean'
        ? source.autoUpdate
        : DEFAULT_SETTINGS.autoUpdate,
    autoUpdatePrompted:
      typeof source.autoUpdatePrompted === 'boolean'
        ? source.autoUpdatePrompted
        : DEFAULT_SETTINGS.autoUpdatePrompted,
    browserMemorySaving:
      typeof source.browserMemorySaving === 'boolean'
        ? source.browserMemorySaving
        : DEFAULT_SETTINGS.browserMemorySaving,
    disableBackForwardCache:
      typeof source.disableBackForwardCache === 'boolean'
        ? source.disableBackForwardCache
        : DEFAULT_SETTINGS.disableBackForwardCache,
    enableLowEndDeviceMode:
      typeof source.enableLowEndDeviceMode === 'boolean'
        ? source.enableLowEndDeviceMode
        : DEFAULT_SETTINGS.enableLowEndDeviceMode,
    processPerSite:
      typeof source.processPerSite === 'boolean'
        ? source.processPerSite
        : DEFAULT_SETTINGS.processPerSite,
    optimizeForSize:
      typeof source.optimizeForSize === 'boolean'
        ? source.optimizeForSize
        : DEFAULT_SETTINGS.optimizeForSize,
    trimInactiveWebviews:
      typeof source.trimInactiveWebviews === 'boolean'
        ? source.trimInactiveWebviews
        : DEFAULT_SETTINGS.trimInactiveWebviews,
    idleMemoryTrimDelaySeconds: isIdleMemoryTrimDelaySeconds(
      source.idleMemoryTrimDelaySeconds,
    )
      ? source.idleMemoryTrimDelaySeconds
      : DEFAULT_SETTINGS.idleMemoryTrimDelaySeconds,
    websites: normalizeWebsites(source.websites),
    // `enabledWebsites` is what this field was called before the catalogue
    // became editable. It held site names, and the seeded sites use their name
    // as their id, so an old settings file carries straight over.
    activeWebsites: asStringArray(source.activeWebsites) ??
      asStringArray(source.enabledWebsites) ?? [...DEFAULT_SETTINGS.activeWebsites],
    prompts: normalizePromptPresets(source.prompts),
    activePrompts: asStringArray(source.activePrompts) ?? [
      ...DEFAULT_SETTINGS.activePrompts,
    ],
  };
}

/**
 * Port of `Settings.ToggleWebsite`, now keyed by id rather than name. Returns a
 * new settings object rather than mutating in place; persistence is the
 * caller's job.
 */
export function toggleWebsite(settings: AppSettings, websiteId: string): AppSettings {
  if (websiteId.trim() === '') {
    throw new Error('Website cannot be null or empty');
  }

  const activeWebsites = settings.activeWebsites.includes(websiteId)
    ? settings.activeWebsites.filter((id) => id !== websiteId)
    : [...settings.activeWebsites, websiteId];

  return { ...settings, activeWebsites };
}

/**
 * The sites the main window's menu bar offers a toggle for, each one already
 * resolved: a site set to follow the app comes back as its seeded definition,
 * so nothing outside the settings window has to know about the flag.
 */
export function getMenuWebsites(settings: AppSettings): WebsiteInfo[] {
  return settings.websites
    .filter((website) => website.enabled)
    .map((website) => resolveWebsite(website));
}

/**
 * Port of `MainForm.GetEnabledWebsiteInfos`: the browsers that are open, in
 * catalogue order rather than the order they were switched on. Disabling a site
 * in the settings window closes its browser here too, which is what keeps the
 * menu bar and the browser row showing the same set.
 */
export function getActiveWebsites(settings: AppSettings): WebsiteInfo[] {
  return getMenuWebsites(settings).filter((website) =>
    settings.activeWebsites.includes(website.id),
  );
}

/** Appends a site to the catalogue. */
export function addWebsite(settings: AppSettings, website: WebsiteInfo): AppSettings {
  return { ...settings, websites: [...settings.websites, website] };
}

/** Applies an edit from the settings window to one site. */
export function updateWebsite(
  settings: AppSettings,
  websiteId: string,
  patch: Partial<Omit<WebsiteInfo, 'id'>>,
): AppSettings {
  return {
    ...settings,
    websites: settings.websites.map((website) =>
      website.id === websiteId ? { ...website, ...patch } : website,
    ),
  };
}

/** Drops a site, and with it any browser that was open for it. */
export function removeWebsite(settings: AppSettings, websiteId: string): AppSettings {
  return {
    ...settings,
    websites: settings.websites.filter((website) => website.id !== websiteId),
    activeWebsites: settings.activeWebsites.filter((id) => id !== websiteId),
  };
}

/**
 * Moves the dragged site to the position of the one it was dropped on, which is
 * the reorder a `@dnd-kit` sortable list asks for. An id that is not in the
 * catalogue leaves the order alone.
 */
export function moveWebsite(
  settings: AppSettings,
  activeId: string,
  overId: string,
): AppSettings {
  const from = settings.websites.findIndex((website) => website.id === activeId);
  const to = settings.websites.findIndex((website) => website.id === overId);

  if (from === -1 || to === -1 || from === to) {
    return settings;
  }

  const websites = [...settings.websites];
  const [moved] = websites.splice(from, 1);
  websites.splice(to, 0, moved!);

  return { ...settings, websites };
}

/**
 * The presets that are ticked, in library order rather than the order they
 * were ticked, which is the order {@link composePrompt} joins them in.
 */
export function getActivePrompts(settings: AppSettings): PromptPreset[] {
  return settings.prompts.filter((prompt) => settings.activePrompts.includes(prompt.id));
}

/** Ticks a preset on or off, as the badge row's checkbox does. */
export function togglePrompt(settings: AppSettings, promptId: string): AppSettings {
  const activePrompts = settings.activePrompts.includes(promptId)
    ? settings.activePrompts.filter((id) => id !== promptId)
    : [...settings.activePrompts, promptId];

  return { ...settings, activePrompts };
}

/** Appends a preset to the library. */
export function addPrompt(settings: AppSettings, prompt: PromptPreset): AppSettings {
  return { ...settings, prompts: [...settings.prompts, prompt] };
}

/** Applies an edit made in the badge popover or the manager to one preset. */
export function updatePrompt(
  settings: AppSettings,
  promptId: string,
  patch: Partial<Omit<PromptPreset, 'id'>>,
): AppSettings {
  return {
    ...settings,
    prompts: settings.prompts.map((prompt) =>
      prompt.id === promptId ? { ...prompt, ...patch } : prompt,
    ),
  };
}

/** Drops a preset, and unticks it with it. */
export function removePrompt(settings: AppSettings, promptId: string): AppSettings {
  return {
    ...settings,
    prompts: settings.prompts.filter((prompt) => prompt.id !== promptId),
    activePrompts: settings.activePrompts.filter((id) => id !== promptId),
  };
}
