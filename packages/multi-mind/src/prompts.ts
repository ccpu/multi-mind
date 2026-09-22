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
}

/** The fields the editor lets the user type into. */
export type PromptPresetDraft = Omit<PromptPreset, 'id'>;

/** Shape a brand new preset starts with, before the user types anything. */
export const BLANK_PROMPT_PRESET: PromptPresetDraft = {
  name: '',
  value: '',
  location: 'end',
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
