import type { PromptPreset } from '../src/prompts';
import { describe, expect, it } from 'vitest';
import {
  BLANK_PROMPT_PRESET,
  composePrompt,
  createPromptPreset,
  normalizePromptPreset,
  normalizePromptPresets,
  promptPresetLabel,
  UNTITLED_PROMPT_NAME,
} from '../src/prompts';

function preset(overrides: Partial<PromptPreset> = {}): PromptPreset {
  return {
    id: 'english',
    name: 'English',
    value: 'Answer in English.',
    location: 'end',
    ...overrides,
  };
}

describe('createPromptPreset', () => {
  it('gives every new preset its own id', () => {
    expect(createPromptPreset().id).not.toBe(createPromptPreset().id);
  });

  it('starts from the blank draft and applies the overrides', () => {
    const created = createPromptPreset({ name: 'Terse' });

    expect(created.name).toBe('Terse');
    expect(created.value).toBe(BLANK_PROMPT_PRESET.value);
    expect(created.location).toBe(BLANK_PROMPT_PRESET.location);
  });
});

describe('normalizePromptPreset', () => {
  it('fills in the fields a hand-edited settings file left out', () => {
    expect(normalizePromptPreset({ id: 'terse', value: 'Be terse.' })).toStrictEqual({
      id: 'terse',
      name: '',
      value: 'Be terse.',
      location: BLANK_PROMPT_PRESET.location,
    });
  });

  it('falls back to a side the composer knows when the stored one is junk', () => {
    expect(normalizePromptPreset({ id: 'a', location: 'middle' })?.location).toBe('end');
  });

  it('rejects an entry that is not an object', () => {
    expect(normalizePromptPreset('Be terse.')).toBeNull();
  });
});

describe('normalizePromptPresets', () => {
  it('starts empty when the stored value is not a list', () => {
    expect(normalizePromptPresets(undefined)).toStrictEqual([]);
  });

  it('drops junk entries and duplicate ids', () => {
    const presets = normalizePromptPresets([
      { id: 'a', name: 'a' },
      null,
      { id: 'a', name: 'again' },
      { id: 'b', name: 'b' },
    ]);

    expect(presets.map((entry) => entry.name)).toStrictEqual(['a', 'b']);
  });
});

describe('promptPresetLabel', () => {
  it('names a preset that has not been named yet', () => {
    expect(promptPresetLabel(preset({ name: '  ' }))).toBe(UNTITLED_PROMPT_NAME);
  });

  it('is the name otherwise', () => {
    expect(promptPresetLabel(preset())).toBe('English');
  });
});

describe('composePrompt', () => {
  it('leaves the prompt alone when nothing is ticked', () => {
    expect(composePrompt('why is the sky blue?', [])).toBe('why is the sky blue?');
  });

  it('wraps the prompt in the ticked presets, each on the side it asked for', () => {
    const presets = [
      preset({ id: 'terse', value: 'Be terse.', location: 'start' }),
      preset(),
    ];

    expect(composePrompt('why is the sky blue?', presets)).toBe(
      'Be terse.\n\nwhy is the sky blue?\n\nAnswer in English.',
    );
  });

  it('keeps the presets in list order rather than the order they were ticked', () => {
    const presets = [
      preset({ id: 'first', value: 'First.', location: 'start' }),
      preset({ id: 'second', value: 'Second.', location: 'start' }),
    ];

    expect(composePrompt('ask', presets)).toBe('First.\n\nSecond.\n\nask');
  });

  it('skips a preset with nothing in it, so it cannot leave a hole', () => {
    const presets = [preset({ id: 'blank', value: '   ', location: 'start' }), preset()];

    expect(composePrompt('ask', presets)).toBe('ask\n\nAnswer in English.');
  });
});
