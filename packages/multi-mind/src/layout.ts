import type { AppSettings } from './settings';

/** The `TexBox Size` dropdown of the WinForms menu strip. */
export const TEXTBOX_SIZE_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

/** The `Auto Shrink Size` sub-menu of the WinForms menu strip. */
export const AUTO_SHRINK_SIZE_OPTIONS = [5, 10, 15] as const;

/** Height of `panelTop` (the menu strip) in pixels, from `MainForm.Designer.cs`. */
export const TOP_PANEL_HEIGHT = 24;

/**
 * Port of `MainForm.GetBottomPanelSize`: the prompt box shrinks while it is
 * empty and auto-shrink is on.
 */
export function getBottomPanelPercent(settings: AppSettings, promptText: string): number {
  if (settings.autoShrink) {
    return promptText === '' ? settings.autoShrinkSize : settings.panelButtonSize;
  }
  return settings.panelButtonSize;
}

/**
 * Port of `MainForm.ForceBottomPanelSize`: shrink regardless of whether the
 * prompt box holds text.
 */
export function getForcedBottomPanelPercent(settings: AppSettings): number {
  return settings.autoShrink ? settings.autoShrinkSize : settings.panelButtonSize;
}
