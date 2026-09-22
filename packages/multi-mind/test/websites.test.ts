import { describe, expect, it } from 'vitest';
import {
  BLANK_WEBSITE,
  createWebsite,
  DEFAULT_WEBSITES,
  getWebsiteSeed,
  normalizeWebsite,
  normalizeWebsites,
  resolveWebsite,
} from '../src/websites';

const CHATGPT = DEFAULT_WEBSITES.find((website) => website.id === 'chatgpt')!;

describe('dEFAULT_WEBSITES', () => {
  it('uses each seeded name as its id, which is what carries old settings over', () => {
    expect(DEFAULT_WEBSITES.every((website) => website.id === website.name)).toBe(true);
  });

  it('switches the everyday sites on and leaves the rest for the settings window', () => {
    expect(
      DEFAULT_WEBSITES.filter((website) => website.enabled).map((website) => website.id),
    ).toStrictEqual(['claude', 'chatgpt', 'gemini', 'deepseek']);
  });
});

describe('createWebsite', () => {
  it('gives every new site its own id', () => {
    expect(createWebsite().id).not.toBe(createWebsite().id);
  });

  it('starts from the blank draft and applies the overrides', () => {
    const website = createWebsite({ name: 'local' });

    expect(website.name).toBe('local');
    expect(website.inputSelector).toBe(BLANK_WEBSITE.inputSelector);
    expect(website.enabled).toBe(true);
  });
});

describe('normalizeWebsite', () => {
  it('fills in the fields a hand-edited settings file left out', () => {
    expect(normalizeWebsite({ name: 'local', url: 'http://localhost/' })).toStrictEqual({
      id: 'local',
      name: 'local',
      url: 'http://localhost/',
      inputSelector: BLANK_WEBSITE.inputSelector,
      buttonSelector: BLANK_WEBSITE.buttonSelector,
      enabled: true,
      useDefaults: false,
    });
  });

  it('leaves a settings file written before the flag on the fields it holds', () => {
    const stored = normalizeWebsite({
      id: 'chatgpt',
      name: 'chatgpt',
      url: 'https://mine.test/',
    });

    expect(stored?.useDefaults).toBe(false);
    expect(resolveWebsite(stored!).url).toBe('https://mine.test/');
  });

  it('rejects an entry that is not an object', () => {
    expect(normalizeWebsite('claude')).toBeNull();
  });
});

describe('resolveWebsite', () => {
  it('answers with the seeded definition while the site follows it', () => {
    const edited = { ...CHATGPT, url: 'https://mine.test/', inputSelector: '#mine' };

    expect(resolveWebsite(edited)).toStrictEqual(CHATGPT);
  });

  it('leaves the menu toggle alone, since that is never the seed to give', () => {
    expect(resolveWebsite({ ...CHATGPT, enabled: false }).enabled).toBe(false);
  });

  it('answers with what was typed once the site stops following the seed', () => {
    const edited = { ...CHATGPT, useDefaults: false, url: 'https://mine.test/' };

    expect(resolveWebsite(edited)).toStrictEqual(edited);
  });

  it('has nothing to fall back on for a site the user added', () => {
    const added = createWebsite({ name: 'local', useDefaults: true });

    expect(resolveWebsite(added)).toStrictEqual(added);
  });
});

describe('getWebsiteSeed', () => {
  it('finds a seeded site by id', () => {
    expect(getWebsiteSeed('chatgpt')).toStrictEqual(CHATGPT);
  });

  it('has none for a site the user added', () => {
    expect(getWebsiteSeed(createWebsite().id)).toBeNull();
  });
});

describe('normalizeWebsites', () => {
  it('reseeds the catalogue when the stored value is not a list', () => {
    expect(normalizeWebsites(undefined)).toStrictEqual([...DEFAULT_WEBSITES]);
  });

  it('drops junk entries and duplicate ids', () => {
    const websites = normalizeWebsites([
      { id: 'a', name: 'a' },
      null,
      { id: 'a', name: 'again' },
      { id: 'b', name: 'b' },
    ]);

    expect(websites.map((website) => website.name)).toStrictEqual(['a', 'b']);
  });

  it('keeps an empty catalogue empty rather than reseeding it', () => {
    expect(normalizeWebsites([])).toStrictEqual([]);
  });
});
