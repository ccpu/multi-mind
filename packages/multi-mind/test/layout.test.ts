import type { AppSettings } from '../src/settings';
import { describe, expect, it } from 'vitest';
import { getBottomPanelPercent, getForcedBottomPanelPercent } from '../src/layout';
import { DEFAULT_SETTINGS } from '../src/settings';

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, panelButtonSize: 40, autoShrinkSize: 5, ...overrides };
}

describe('getBottomPanelPercent', () => {
  it('shrinks while the prompt box is empty and auto shrink is on', () => {
    expect(getBottomPanelPercent(makeSettings(), '')).toBe(5);
  });

  it('expands as soon as the prompt box holds text', () => {
    expect(getBottomPanelPercent(makeSettings(), 'hi')).toBe(40);
  });

  it('ignores the prompt text when auto shrink is off', () => {
    expect(getBottomPanelPercent(makeSettings({ autoShrink: false }), '')).toBe(40);
  });
});

describe('getForcedBottomPanelPercent', () => {
  it('shrinks even when the prompt box holds text', () => {
    expect(getForcedBottomPanelPercent(makeSettings())).toBe(5);
  });

  it('uses the configured size when auto shrink is off', () => {
    expect(getForcedBottomPanelPercent(makeSettings({ autoShrink: false }))).toBe(40);
  });
});
