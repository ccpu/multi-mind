import { resizeSplitPanes } from '@internal/multi-mind';
import { cn } from '@pixpilot/shadcn';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Width of a drag handle, in pixels. */
const GUTTER_SIZE = 4;

/** A browser never shrinks below this, so its chat page stays usable. */
const MIN_PANE_WIDTH = 160;

/** A pane at either end of the row has a gutter on one side only. */
const HALF_GUTTER = GUTTER_SIZE / 2;

/** Pane sizes are percentages of the row. */
const FULL_WIDTH = 100;

/** Equal shares that always add up to exactly 100. */
function equalSizes(count: number): number[] {
  return Array.from<number>({ length: count }).fill(FULL_WIDTH / count);
}

/**
 * How much of the gutters each pane gives up, in pixels: half a gutter for a
 * pane at either end, a whole one for a pane with a gutter on each side.
 */
function gutterShares(count: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    index === 0 || index === count - 1 ? HALF_GUTTER : GUTTER_SIZE,
  );
}

function createGutter(): HTMLElement {
  const gutter = document.createElement('div');

  gutter.className = cn(
    'shrink-0 cursor-col-resize touch-none bg-border transition-colors hover:bg-primary',
  );
  gutter.style.width = `${GUTTER_SIZE}px`;

  return gutter;
}

export interface UseSplitLayoutResult {
  /** Attach to the flex row that holds one child element per pane. */
  containerRef: (element: HTMLDivElement | null) => void;
  /** True while a gutter is being dragged. */
  dragging: boolean;
  /** False while there is nothing to split, so panes should grow on their own. */
  active: boolean;
  /** Restores an equal share for every pane. */
  reset: () => void;
}

/**
 * Splits the embedded browsers with a draggable gutter between each pair.
 *
 * Dragging a gutter takes space from more than the pane next to it: once that
 * pane is down to its minimum, the next one along gives way, and so on, so one
 * browser can be widened across all the others from either side.
 *
 * The gutters are added as siblings of the panes React rendered, and the widths
 * written onto the panes directly, so a drag never re-renders the window. The
 * layout is rebuilt whenever `paneKeys` changes, which is what gives every pane
 * an equal share again after a browser is added or removed; `reset` does the
 * same on demand.
 */
export function useSplitLayout(paneKeys: readonly string[]): UseSplitLayoutResult {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const applyRef = useRef<((sizes: number[]) => void) | null>(null);

  // Only how many panes there are and that they changed identity matters;
  // joining the keys keeps the effect from re-running on every render.
  const key = paneKeys.join('\u0000');
  const count = paneKeys.length;
  const active = count > 1;

  useLayoutEffect(() => {
    if (container === null || !active) {
      return undefined;
    }

    // Only the elements React rendered are panes; the gutters are added here.
    const panes = Array.from(container.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );

    if (panes.length !== count) {
      return undefined;
    }

    const shares = gutterShares(count);
    let sizes = equalSizes(count);

    const apply = (next: number[]) => {
      sizes = next;
      for (const [index, pane] of panes.entries()) {
        pane.style.width = `calc(${next[index]}% - ${shares[index]}px)`;
      }
    };

    apply(sizes);
    applyRef.current = apply;

    const gutters = panes.slice(0, -1).map((pane) => {
      const gutter = createGutter();
      pane.after(gutter);
      return gutter;
    });

    // One drag at a time, measured from where it started so that dragging
    // back puts every pane back as it was.
    let drag: {
      gutter: HTMLElement;
      index: number;
      pointerId: number;
      x: number;
      width: number;
      start: number[];
    } | null = null;

    // Bound on the row rather than on each gutter; a captured pointer's
    // events still bubble up to it from the gutter being dragged.
    const handlePointerDown = (event: PointerEvent) => {
      const index = gutters.indexOf(event.target as HTMLElement);
      const { width } = container.getBoundingClientRect();
      if (index === -1 || event.button !== 0 || width === 0) {
        return;
      }

      const gutter = gutters[index]!;
      event.preventDefault();
      gutter.setPointerCapture?.(event.pointerId);
      drag = {
        gutter,
        index,
        pointerId: event.pointerId,
        x: event.clientX,
        width,
        start: sizes,
      };
      setDragging(true);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) {
        return;
      }

      const { index, width, start, x } = drag;
      const minimums = shares.map(
        (share) => ((MIN_PANE_WIDTH + share) / width) * FULL_WIDTH,
      );
      const delta = ((event.clientX - x) / width) * FULL_WIDTH;
      apply(resizeSplitPanes(start, index, delta, minimums));
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) {
        return;
      }

      const { gutter } = drag;
      drag = null;
      if (gutter.hasPointerCapture?.(event.pointerId)) {
        gutter.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerEnd);
    container.addEventListener('pointercancel', handlePointerEnd);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerEnd);
      container.removeEventListener('pointercancel', handlePointerEnd);
      applyRef.current = null;
      setDragging(false);
      for (const gutter of gutters) {
        gutter.remove();
      }
      for (const pane of panes) {
        pane.style.width = '';
      }
    };
    // `key` stands in for the identity of every pane; `count` is derived from it.
  }, [container, active, count, key]);

  const reset = useCallback(() => {
    applyRef.current?.(equalSizes(count));
  }, [count]);

  return { containerRef: setContainer, dragging, active, reset };
}
