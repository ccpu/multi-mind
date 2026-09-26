import { createId } from './ids';

/**
 * Ready-made text the user keeps around and ticks on when it applies — a
 * house style, an output format, a language to answer in. The WinForms build
 * had nothing like it; every prompt was typed from scratch.
 *
 * A preset is not a prompt of its own: it wraps whatever was typed, in front
 * of it or behind it, and the sites only ever see the two joined together.
 */
export type PromptLocation = 'end' | 'start';

export const PROMPT_LOCATION_OPTIONS = [
  { value: 'start', label: 'Before the prompt' },
  { value: 'end', label: 'After the prompt' },
] as const satisfies readonly { value: PromptLocation; label: string }[];

export interface PromptPreset {
  /**
   * Stable identity, as for a site: the settings file, the badge row and the
   * ticked list all refer to a preset by this, so renaming one keeps it
   * ticked.
   */
  readonly id: string;
  /** What the badge reads. */
  readonly name: string;
  /** The text that joins the prompt. */
  readonly value: string;
  /** Which side of the typed prompt {@link value} goes on. */
  readonly location: PromptLocation;
  /**
   * Whether the preset goes out with the first prompt of a chat only. The
   * sites keep the conversation, so a standing instruction needs saying once;
   * **New Chat** is what makes it due again.
   */
  readonly sendOnce: boolean;
  /**
   * Whether **New Chat** unticks the preset, so it only lasts for the chat it
   * was ticked in. This is about whether it stays ticked, not about which
   * messages carry it; that is {@link sendOnce}.
   */
  readonly untickOnNewChat: boolean;
  /**
   * Whether ticking the preset leaves every other ticked preset out, so it is
   * the only one that joins the prompt. The others stay ticked, and go back
   * to joining it once this one is unticked.
   */
  readonly overrideOthers: boolean;
}

/** The fields the editor lets the user type into. */
export type PromptPresetDraft = Omit<PromptPreset, 'id'>;

/** Shape a brand new preset starts with, before the user types anything. */
export const BLANK_PROMPT_PRESET: PromptPresetDraft = {
  name: '',
  value: '',
  location: 'end',
  sendOnce: false,
  untickOnNewChat: false,
  overrideOthers: false,
};

/** What the badge and the manager show for a preset with no name yet. */
export const UNTITLED_PROMPT_NAME = 'Untitled prompt';

/** What a badge or a row reads, so a nameless preset is never blank. */
export function promptPresetLabel(preset: PromptPreset): string {
  return preset.name.trim() === '' ? UNTITLED_PROMPT_NAME : preset.name;
}

export function isPromptLocation(value: unknown): value is PromptLocation {
  return PROMPT_LOCATION_OPTIONS.some((option) => option.value === value);
}

/** Builds a preset with a fresh id, ready to be appended to the list. */
export function createPromptPreset(draft: Partial<PromptPresetDraft> = {}): PromptPreset {
  return { ...BLANK_PROMPT_PRESET, ...draft, id: createId('prompt') };
}

/** Coerces one entry read from `settings.json` into a complete preset. */
export function normalizePromptPreset(value: unknown): PromptPreset | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const source = value as Partial<Record<keyof PromptPreset, unknown>>;

  return {
    id: typeof source.id === 'string' ? source.id : createId('prompt'),
    name: typeof source.name === 'string' ? source.name : '',
    value: typeof source.value === 'string' ? source.value : '',
    location: isPromptLocation(source.location)
      ? source.location
      : BLANK_PROMPT_PRESET.location,
    sendOnce:
      typeof source.sendOnce === 'boolean'
        ? source.sendOnce
        : BLANK_PROMPT_PRESET.sendOnce,
    untickOnNewChat:
      typeof source.untickOnNewChat === 'boolean'
        ? source.untickOnNewChat
        : BLANK_PROMPT_PRESET.untickOnNewChat,
    overrideOthers:
      typeof source.overrideOthers === 'boolean'
        ? source.overrideOthers
        : BLANK_PROMPT_PRESET.overrideOthers,
  };
}

/** Coerces the stored list, dropping junk entries and duplicate ids. */
export function normalizePromptPresets(value: unknown): PromptPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();

  return value.reduce<PromptPreset[]>((presets, entry) => {
    const preset = normalizePromptPreset(entry);

    if (preset !== null && !seen.has(preset.id)) {
      seen.add(preset.id);
      presets.push(preset);
    }

    return presets;
  }, []);
}

/** The ticked presets that leave the rest out. */
export function overridingPrompts(ticked: readonly PromptPreset[]): PromptPreset[] {
  return ticked.filter((preset) => preset.overrideOthers);
}

/**
 * The ticked presets that join the prompt: only the overriding ones while any
 * is ticked, and every ticked preset otherwise. Several overriding presets
 * ticked at once all go out together.
 */
export function promptsToSend(ticked: readonly PromptPreset[]): PromptPreset[] {
  const overriding = overridingPrompts(ticked);

  return overriding.length > 0 ? overriding : [...ticked];
}

/**
 * Which of `overriding` leave `preset` out, so the badge row can name them.
 * Empty when `preset` is one of them, or when nothing overrides.
 */
export function promptOverriddenBy(
  preset: PromptPreset,
  overriding: readonly PromptPreset[],
): PromptPreset[] {
  return overriding.some((entry) => entry.id === preset.id) ? [] : [...overriding];
}

/**
 * The ticked presets still due in this chat: a send-once preset drops out
 * once its id is in `sent`, and every other preset goes out every time.
 */
export function duePrompts(
  presets: readonly PromptPreset[],
  sent: ReadonlySet<string>,
): PromptPreset[] {
  return presets.filter((preset) => !preset.sendOnce || !sent.has(preset.id));
}

/**
 * Wraps the typed prompt in the ticked presets: everything set to `start`
 * first, in list order, then the prompt, then everything set to `end`. Empty
 * parts are dropped so an unfilled preset cannot leave a hole in the text.
 */
export function composePrompt(prompt: string, presets: readonly PromptPreset[]): string {
  const at = (location: PromptLocation) =>
    presets
      .filter((preset) => preset.location === location)
      .map((preset) => preset.value);

  return [...at('start'), prompt, ...at('end')]
    .filter((part) => part.trim() !== '')
    .join('\n\n');
}
