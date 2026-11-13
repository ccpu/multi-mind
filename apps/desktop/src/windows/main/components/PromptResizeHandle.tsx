import type { KeyboardEvent, PointerEvent } from 'react';
import { clampPromptSize, PROMPT_SIZE_MAX, PROMPT_SIZE_MIN } from '@internal/multi-mind';
import { cn } from '@pixpilot/shadcn';
import { useCallback, useRef, useState } from 'react';
import { promptSurface } from './prompt-surface';

/** How far one arrow key press moves the splitter, in percent of the window. */
const KEYBOARD_STEP = 1;

/** Sizes are percentages of the window. */
const FULL_HEIGHT = 100;

/** Sizes are kept to one decimal place; the least one is rounded up. */
const PRECISION = 10;

interface PromptResizeHandleProps {
  /** The prompt box's current height, as a percentage of the window. */
  percent: number;
  /** The least height the prompt box can take, in pixels, so nothing in it overflows. */
  minHeight: number;
  /** Called on every move, so the box follows the pointer. */
  onResize: (percent: number) => void;
  /** Called once the drag is let go, with the size to keep. */
  onResizeEnd: (percent: number) => void;
  /** Told when a drag starts and stops, so the browsers can step aside. */
  onDraggingChange: (dragging: boolean) => void;
}

/**
 * The splitter between the browsers and the prompt box. The box is sized as a
 * share of the window it sits at the bottom of, so the share is read off how
 * far the pointer is from the bottom of that window.
 *
 * It is part of the prompt box's surface, so pressing it is not clicking away:
 * the box keeps whichever size it had, and that is the size the drag sets.
 */
export function PromptResizeHandle({
  percent,
  minHeight,
  onResize,
  onResizeEnd,
  onDraggingChange,
}: PromptResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const boundsRef = useRef<DOMRect | null>(null);
  const lastRef = useRef(percent);

  /**
   * Keeps a size inside the allowed range, and no smaller than the panel's
   * least height in pixels, which is a larger share the smaller the window.
   */
  const fit = useCallback(
    (next: number, bounds: DOMRect) => {
      if (bounds.height === 0) {
        return clampPromptSize(next);
      }
      const least =
        Math.ceil((minHeight / bounds.height) * FULL_HEIGHT * PRECISION) / PRECISION;
      return clampPromptSize(Math.max(next, least));
    },
    [minHeight],
  );

  const percentAt = useCallback(
    (clientY: number) => {
      const bounds = boundsRef.current;
      if (bounds === null || bounds.height === 0) {
        return lastRef.current;
      }
      return fit(((bounds.bottom - clientY) / bounds.height) * FULL_HEIGHT, bounds);
    },
    [fit],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const frame = event.currentTarget.parentElement;
      if (frame === null) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      boundsRef.current = frame.getBoundingClientRect();
      lastRef.current = percent;
      setDragging(true);
      onDraggingChange(true);
    },
    [percent, onDraggingChange],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragging) {
        return;
      }

      const next = percentAt(event.clientY);
      if (next !== lastRef.current) {
        lastRef.current = next;
        onResize(next);
      }
    },
    [dragging, percentAt, onResize],
  );

  const finish = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragging) {
        return;
      }

      event.currentTarget.releasePointerCapture?.(event.pointerId);
      boundsRef.current = null;
      setDragging(false);
      onDraggingChange(false);
      onResizeEnd(lastRef.current);
    },
    [dragging, onDraggingChange, onResizeEnd],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null;
      switch (event.key) {
        case 'ArrowUp':
          next = percent + KEYBOARD_STEP;
          break;
        case 'ArrowDown':
          next = percent - KEYBOARD_STEP;
          break;
        case 'Home':
          next = PROMPT_SIZE_MAX;
          break;
        case 'End':
          next = PROMPT_SIZE_MIN;
          break;
        default:
          return;
      }

      event.preventDefault();
      const frame = event.currentTarget.parentElement;
      onResizeEnd(
        frame === null ? clampPromptSize(next) : fit(next, frame.getBoundingClientRect()),
      );
    },
    [percent, fit, onResizeEnd],
  );

  // A focusable separator is a widget in ARIA terms, which jsx-a11y does not
  // know: it takes every separator for a static rule.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      {...promptSurface}
      role="separator"
      aria-label="Resize prompt box"
      aria-orientation="horizontal"
      aria-valuemin={PROMPT_SIZE_MIN}
      aria-valuemax={PROMPT_SIZE_MAX}
      aria-valuenow={percent}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={cn(
        // A 1px line. The browsers above are native windows that would swallow
        // a press, so the area that can be grabbed reaches down instead, over
        // the prompt panel's top padding.
        'relative h-px shrink-0 cursor-row-resize touch-none bg-border transition-colors after:absolute after:inset-x-0 after:top-0 after:z-10 after:h-1.5 hover:bg-primary focus-visible:bg-primary focus-visible:outline-none',
        dragging && 'bg-primary',
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={handleKeyDown}
    />
  );
}
