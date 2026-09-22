import type { PromptPreset } from '../src/prompts';
import type { AppSettings } from '../src/settings';
import { describe, expect, it } from 'vitest';
import {
  addPrompt,
  addWebsite,
  DEFAULT_SETTINGS,
  getActivePrompts,
  getActiveWebsites,
  getMenuWebsites,
  moveWebsite,
  normalizeSettings,
  removePrompt,
  removeWebsite,
  togglePrompt,
  toggleWebsite,
  updatePrompt,
  updateWebsite,
} from '../src/settings';
import { createWebsite, DEFAULT_WEBSITES } from '../src/websites';

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** Two sites is enough to show ordering; naming them keeps the assertions short. */
function makeCatalogue(): AppSettings {
  return makeSettings({
    websites: [
      createWebsite({ name: 'first', url: 'https://first.test/' }),
      createWebsite({ name: 'second', url: 'https://second.test/' }),
    ],
  });
}

describe('toggleWebsite', () => {
  it('opens a website that is not active', () => {
    expect(toggleWebsite(makeSettings(), 'claude').activeWebsites).toStrictEqual([
      'claude',
    ]);
  });

  it('closes a website that is already active', () => {
    const settings = makeSettings({ activeWebsites: ['claude', 'poe'] });

    expect(toggleWebsite(settings, 'claude').activeWebsites).toStrictEqual(['poe']);
  });

  it('rejects a blank website id', () => {
    expect(() => toggleWebsite(makeSettings(), '  ')).toThrow(
      'Website cannot be null or empty',
    );
  });
});

describe('getMenuWebsites', () => {
  it('offers the seeded sites that are switched on', () => {
    expect(getMenuWebsites(makeSettings())).toHaveLength(
      DEFAULT_WEBSITES.filter((website) => website.enabled).length,
    );
  });

  it('drops a site that has been switched off', () => {
    const settings = updateWebsite(makeSettings(), 'claude', { enabled: false });

    expect(getMenuWebsites(settings).map((site) => site.id)).not.toContain('claude');
  });

  it('hands over the seeded definition for a site that follows it', () => {
    const settings = updateWebsite(makeSettings(), 'chatgpt', {
      url: 'https://mine.test/',
    });
    const chatgpt = getMenuWebsites(settings).find((site) => site.id === 'chatgpt');

    expect(chatgpt?.url).toBe(
      DEFAULT_WEBSITES.find((site) => site.id === 'chatgpt')?.url,
    );
  });

  it('hands over what was typed for a site that does not', () => {
    const settings = updateWebsite(makeSettings(), 'chatgpt', {
      url: 'https://mine.test/',
      useDefaults: false,
    });
    const chatgpt = getMenuWebsites(settings).find((site) => site.id === 'chatgpt');

    expect(chatgpt?.url).toBe('https://mine.test/');
  });
});

describe('getActiveWebsites', () => {
  it('returns nothing when no website is active', () => {
    expect(getActiveWebsites(makeSettings())).toStrictEqual([]);
  });

  it('keeps the catalogue order rather than the order sites were opened', () => {
    const settings = makeSettings({ activeWebsites: ['gemini', 'claude'] });

    expect(getActiveWebsites(settings).map((site) => site.name)).toStrictEqual([
      'claude',
      'gemini',
    ]);
  });

  it('closes the browser of a site that was switched off', () => {
    const settings = updateWebsite(
      makeSettings({ activeWebsites: ['claude'] }),
      'claude',
      {
        enabled: false,
      },
    );

    expect(getActiveWebsites(settings)).toStrictEqual([]);
  });
});

describe('addWebsite', () => {
  it('appends the new site to the end of the catalogue', () => {
    const website = createWebsite({ name: 'local' });

    expect(addWebsite(makeSettings(), website).websites.at(-1)).toStrictEqual(website);
  });
});

describe('updateWebsite', () => {
  it('applies the patch to the matching site only', () => {
    const settings = updateWebsite(makeSettings(), 'claude', { name: 'renamed' });

    expect(settings.websites[0]?.name).toBe('renamed');
    expect(settings.websites[1]?.name).toBe('chatgpt');
  });

  it('keeps the id, so an open browser stays wired up', () => {
    // Renaming is only offered once the site has stopped following the seed;
    // with that flag on, the seeded name is what every window shows.
    const settings = updateWebsite(
      makeSettings({ activeWebsites: ['claude'] }),
      'claude',
      { name: 'renamed', useDefaults: false },
    );

    expect(getActiveWebsites(settings).map((site) => site.name)).toStrictEqual([
      'renamed',
    ]);
  });
});

describe('removeWebsite', () => {
  it('drops the site and closes its browser', () => {
    const settings = removeWebsite(
      makeSettings({ activeWebsites: ['claude'] }),
      'claude',
    );

    expect(settings.websites.map((site) => site.id)).not.toContain('claude');
    expect(settings.activeWebsites).toStrictEqual([]);
  });
});

describe('moveWebsite', () => {
  it('moves the dragged site onto the position it was dropped on', () => {
    const settings = makeCatalogue();
    const [first, second] = settings.websites;

    const moved = moveWebsite(settings, second!.id, first!.id);

    expect(moved.websites.map((site) => site.name)).toStrictEqual(['second', 'first']);
  });

  it('leaves the order alone for an unknown id', () => {
    const settings = makeCatalogue();

    expect(moveWebsite(settings, 'nope', settings.websites[0]!.id)).toStrictEqual(
      settings,
    );
  });
});

describe('normalizeSettings', () => {
  it('falls back to defaults for missing or malformed fields', () => {
    const settings = normalizeSettings({
      panelButtonSize: '40',
      activeWebsites: [1, 'poe'],
    });

    // Read from DEFAULT_SETTINGS rather than repeated here: the point is that
    // a malformed field falls back to the default, whatever that default is.
    expect(settings.panelButtonSize).toBe(DEFAULT_SETTINGS.panelButtonSize);
    expect(settings.activeWebsites).toStrictEqual(['poe']);
    expect(settings.autoShrink).toBe(DEFAULT_SETTINGS.autoShrink);
    expect(settings.autoShrinkSize).toBe(DEFAULT_SETTINGS.autoShrinkSize);
    expect(settings.websites).toStrictEqual([...DEFAULT_WEBSITES]);
  });

  it('leaves the update check on, and unasked about, in a settings file without it', () => {
    const settings = normalizeSettings({ panelButtonSize: 40 });

    expect(settings.autoUpdate).toBe(true);
    expect(settings.autoUpdatePrompted).toBe(false);
  });

  it('keeps an update check that has been switched off', () => {
    const settings = normalizeSettings({ autoUpdate: false, autoUpdatePrompted: true });

    expect(settings.autoUpdate).toBe(false);
    expect(settings.autoUpdatePrompted).toBe(true);
  });

  it('carries a pre-catalogue settings file over, names and all', () => {
    const settings = normalizeSettings({ enabledWebsites: ['claude', 'gemini'] });

    expect(settings.activeWebsites).toStrictEqual(['claude', 'gemini']);
    expect(getActiveWebsites(settings).map((site) => site.name)).toStrictEqual([
      'claude',
      'gemini',
    ]);
  });

  it('keeps an edited catalogue instead of reseeding it', () => {
    const websites = [createWebsite({ name: 'local', url: 'http://localhost/' })];

    expect(normalizeSettings({ websites }).websites).toStrictEqual(websites);
  });

  it('returns defaults for a non-object value', () => {
    expect(normalizeSettings(null)).toStrictEqual(DEFAULT_SETTINGS);
  });
});

describe('prompt presets', () => {
  const english: PromptPreset = {
    id: 'english',
    name: 'English',
    value: 'Answer in English.',
    location: 'end',
  };

  const terse: PromptPreset = {
    id: 'terse',
    name: 'Terse',
    value: 'Be terse.',
    location: 'start',
  };

  function withPrompts(activePrompts: string[] = []): AppSettings {
    return { ...DEFAULT_SETTINGS, prompts: [english, terse], activePrompts };
  }

  it('starts with an empty library', () => {
    expect(DEFAULT_SETTINGS.prompts).toStrictEqual([]);
    expect(DEFAULT_SETTINGS.activePrompts).toStrictEqual([]);
  });

  it('reads a library written by hand into the settings file', () => {
    const settings = normalizeSettings({
      prompts: [{ id: 'terse', name: 'Terse', value: 'Be terse.', location: 'start' }],
      activePrompts: ['terse'],
    });

    expect(settings.prompts).toStrictEqual([terse]);
    expect(settings.activePrompts).toStrictEqual(['terse']);
  });

  it('ticks a preset on and off again', () => {
    const ticked = togglePrompt(withPrompts(), 'terse');

    expect(ticked.activePrompts).toStrictEqual(['terse']);
    expect(togglePrompt(ticked, 'terse').activePrompts).toStrictEqual([]);
  });

  it('hands back the ticked presets in library order', () => {
    expect(getActivePrompts(withPrompts(['terse', 'english']))).toStrictEqual([
      english,
      terse,
    ]);
  });

  it('appends a new preset to the library', () => {
    const added = addPrompt(withPrompts(), {
      id: 'json',
      name: 'JSON',
      value: 'Answer as JSON.',
      location: 'end',
    });

    expect(added.prompts.map((prompt) => prompt.id)).toStrictEqual([
      'english',
      'terse',
      'json',
    ]);
  });

  it('applies an edit to one preset and leaves the rest alone', () => {
    const edited = updatePrompt(withPrompts(), 'terse', { value: 'Keep it short.' });

    expect(edited.prompts).toStrictEqual([
      english,
      { ...terse, value: 'Keep it short.' },
    ]);
  });

  it('unticks a preset as it is dropped, so no id is left dangling', () => {
    const removed = removePrompt(withPrompts(['terse', 'english']), 'terse');

    expect(removed.prompts).toStrictEqual([english]);
    expect(removed.activePrompts).toStrictEqual(['english']);
  });
});
