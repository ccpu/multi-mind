import type { AppSettings } from '../src/settings';
import { describe, expect, it } from 'vitest';
import {
  clampPromptSize,
  getPromptPanelPercent,
  getPromptSizeKey,
  PROMPT_SIZE_MAX,
  PROMPT_SIZE_MIN,
  resizeSplitPanes,
} from '../src/layout';
import { DEFAULT_SETTINGS } from '../src/settings';

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, panelButtonSize: 40, autoShrinkSize: 5, ...overrides };
}

describe('getPromptPanelPercent', () => {
  it('uses the collapsed size while collapsed and auto shrink is on', () => {
    expect(getPromptPanelPercent(makeSettings(), true)).toBe(5);
  });

  it('uses the expanded size once expanded', () => {
    expect(getPromptPanelPercent(makeSettings(), false)).toBe(40);
  });

  it('never shrinks while auto shrink is off', () => {
    expect(getPromptPanelPercent(makeSettings({ autoShrink: false }), true)).toBe(40);
  });
});

describe('getPromptSizeKey', () => {
  it('names the size a drag should set', () => {
    expect(getPromptSizeKey(makeSettings(), true)).toBe('autoShrinkSize');
    expect(getPromptSizeKey(makeSettings(), false)).toBe('panelButtonSize');
    expect(getPromptSizeKey(makeSettings({ autoShrink: false }), true)).toBe(
      'panelButtonSize',
    );
  });
});

describe('clampPromptSize', () => {
  it('keeps the size within the allowed range', () => {
    expect(clampPromptSize(0)).toBe(PROMPT_SIZE_MIN);
    expect(clampPromptSize(100)).toBe(PROMPT_SIZE_MAX);
  });

  it('rounds to one decimal place', () => {
    expect(clampPromptSize(23.456)).toBe(23.5);
  });
});

describe('resizeSplitPanes', () => {
  const mins = [10, 10, 10, 10];

  it('takes from the nearest pane only while it has room', () => {
    expect(resizeSplitPanes([25, 25, 25, 25], 2, -10, mins)).toStrictEqual([
      25, 25, 15, 35,
    ]);
  });

  it('moves on to the next pane once the nearest is at its minimum', () => {
    expect(resizeSplitPanes([25, 25, 25, 25], 2, -30, mins)).toStrictEqual([
      25, 10, 10, 55,
    ]);
  });

  it('cascades the other way when dragged right', () => {
    expect(resizeSplitPanes([25, 25, 25, 25], 0, 30, mins)).toStrictEqual([
      55, 10, 10, 25,
    ]);
  });

  it('stops once every pane on that side is at its minimum', () => {
    expect(resizeSplitPanes([25, 25, 25, 25], 2, -100, mins)).toStrictEqual([
      10, 10, 10, 70,
    ]);
  });

  it('gives every pane its old size back when dragged back', () => {
    expect(resizeSplitPanes([25, 25, 25, 25], 2, 0, mins)).toStrictEqual([
      25, 25, 25, 25,
    ]);
  });

  it('ignores a divider that does not exist', () => {
    expect(resizeSplitPanes([50, 50], 1, 10, [10, 10])).toStrictEqual([50, 50]);
  });
});
