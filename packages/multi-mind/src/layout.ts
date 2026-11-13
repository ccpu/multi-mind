import type { AppSettings } from './settings';

/** Smallest share of the window the prompt box can be dragged or set to. */
export const PROMPT_SIZE_MIN = 3;

/** Largest share, so the browsers above always keep a strip of their own. */
export const PROMPT_SIZE_MAX = 90;

/** Sizes are kept to one decimal place. */
const SIZE_PRECISION = 10;

/** Height of `panelTop` (the menu strip) in pixels, from `MainForm.Designer.cs`. */
export const TOP_PANEL_HEIGHT = 24;

/** The two sizes the prompt box switches between. */
export type PromptSizeKey = 'panelButtonSize' | 'autoShrinkSize';

/**
 * Keeps a prompt box size inside the range the splitter allows, to one decimal
 * place: fine enough that a drag does not visibly snap when it is let go.
 */
export function clampPromptSize(percent: number): number {
  const clamped = Math.min(PROMPT_SIZE_MAX, Math.max(PROMPT_SIZE_MIN, percent));
  return Math.round(clamped * SIZE_PRECISION) / SIZE_PRECISION;
}

/**
 * Which of the two sizes is showing. Collapsing only shrinks the box while auto
 * shrink is on; otherwise it always keeps its full size. Dragging the splitter
 * sets whichever one this names.
 */
export function getPromptSizeKey(
  settings: AppSettings,
  collapsed: boolean,
): PromptSizeKey {
  return settings.autoShrink && collapsed ? 'autoShrinkSize' : 'panelButtonSize';
}

/** Height of the prompt box as a percentage of the window. */
export function getPromptPanelPercent(settings: AppSettings, collapsed: boolean): number {
  return settings[getPromptSizeKey(settings, collapsed)];
}

/**
 * Moves the divider after pane `gutter` by `delta`, taking the space from as
 * many panes as it needs on the side it moves towards: the nearest one first,
 * then, once that is down to its minimum, the next one beyond it, and so on.
 * The pane on the other side of the divider gets all of it.
 *
 * Every size, minimum and the delta share one unit — percentages of the row in
 * the app. Always worked out from the sizes the drag started at, so dragging
 * back gives every pane its old size again. A divider stops once every pane
 * on that side is at its minimum.
 */
export function resizeSplitPanes(
  start: readonly number[],
  gutter: number,
  delta: number,
  minimums: readonly number[],
): number[] {
  const next = [...start];
  if (gutter < 0 || gutter >= start.length - 1 || delta === 0) {
    return next;
  }

  const growing = delta > 0 ? gutter : gutter + 1;
  // The panes that give up space, nearest the divider first.
  const giving =
    delta > 0
      ? Array.from(
          { length: start.length - gutter - 1 },
          (_, index) => gutter + 1 + index,
        )
      : Array.from({ length: gutter + 1 }, (_, index) => gutter - index);

  let remaining = Math.abs(delta);
  let moved = 0;

  for (const index of giving) {
    if (remaining <= 0) {
      break;
    }
    const spare = Math.max(0, start[index]! - (minimums[index] ?? 0));
    const taken = Math.min(spare, remaining);
    next[index] = start[index]! - taken;
    remaining -= taken;
    moved += taken;
  }

  next[growing] = start[growing]! + moved;
  return next;
}
