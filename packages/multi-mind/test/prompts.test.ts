import type { PromptPreset } from '../src/prompts';
import { describe, expect, it } from 'vitest';
import {
  BLANK_PROMPT_PRESET,
  composePrompt,
  createPromptPreset,
  duePrompts,
  normalizePromptPreset,
  normalizePromptPresets,
  overridingPrompts,
  promptOverriddenBy,
  promptPresetLabel,
  promptsToSend,
  UNTITLED_PROMPT_NAME,
} from '../src/prompts';

function preset(overrides: Partial<PromptPreset> = {}): PromptPreset {
  return {
    id: 'english',
    name: 'English',
    value: 'Answer in English.',
    location: 'end',
    sendOnce: false,
    untickOnNewChat: false,
    overrideOthers: false,
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
      sendOnce: false,
      untickOnNewChat: false,
      overrideOthers: false,
    });
  });

  it('falls back to a side the composer knows when the stored one is junk', () => {
    expect(normalizePromptPreset({ id: 'a', location: 'middle' })?.location).toBe('end');
  });

  it('sends every time unless the settings file says to send once', () => {
    expect(normalizePromptPreset({ id: 'a', sendOnce: 'yes' })?.sendOnce).toBe(false);
    expect(normalizePromptPreset({ id: 'a', sendOnce: true })?.sendOnce).toBe(true);
  });

  it('stays ticked across chats unless the settings file says to untick it', () => {
    expect(normalizePromptPreset({ id: 'a' })?.untickOnNewChat).toBe(false);
    expect(
      normalizePromptPreset({ id: 'a', untickOnNewChat: true })?.untickOnNewChat,
    ).toBe(true);
  });

  it('leaves the other prompts alone unless the settings file says to override them', () => {
    expect(normalizePromptPreset({ id: 'a' })?.overrideOthers).toBe(false);
    expect(normalizePromptPreset({ id: 'a', overrideOthers: true })?.overrideOthers).toBe(
      true,
    );
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

describe('promptsToSend', () => {
  const alone = preset({ id: 'alone', overrideOthers: true });
  const other = preset({ id: 'other' });

  it('sends every ticked preset while none overrides the rest', () => {
    expect(overridingPrompts([other])).toStrictEqual([]);
    expect(promptsToSend([other])).toStrictEqual([other]);
  });

  it('sends only the overriding preset while it is ticked', () => {
    expect(overridingPrompts([other, alone])).toStrictEqual([alone]);
    expect(promptsToSend([other, alone])).toStrictEqual([alone]);
  });

  it('sends every overriding preset together when several are ticked', () => {
    const second = preset({ id: 'second', overrideOthers: true });

    expect(promptsToSend([alone, other, second])).toStrictEqual([alone, second]);
  });
});

describe('promptOverriddenBy', () => {
  const alone = preset({ id: 'alone', overrideOthers: true });

  it('names the presets leaving another one out', () => {
    expect(promptOverriddenBy(preset(), [alone])).toStrictEqual([alone]);
  });

  it('is empty for an overriding preset itself', () => {
    expect(promptOverriddenBy(alone, [alone])).toStrictEqual([]);
  });

  it('is empty while nothing overrides', () => {
    expect(promptOverriddenBy(preset(), [])).toStrictEqual([]);
  });
});

describe('duePrompts', () => {
  it('drops a send-once preset once it has gone out', () => {
    const presets = [preset({ id: 'once', sendOnce: true }), preset()];

    expect(duePrompts(presets, new Set(['once'])).map(({ id }) => id)).toStrictEqual([
      'english',
    ]);
  });

  it('keeps a send-once preset that has not gone out yet', () => {
    const presets = [preset({ id: 'once', sendOnce: true })];

    expect(duePrompts(presets, new Set())).toStrictEqual(presets);
  });

  it('keeps every other preset, whatever went out before', () => {
    const presets = [preset()];

    expect(duePrompts(presets, new Set(['english']))).toStrictEqual(presets);
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
