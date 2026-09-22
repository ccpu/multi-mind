import { cn } from '@pixpilot/shadcn';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Split from 'split.js';

type SplitInstance = ReturnType<typeof Split>;

/** Width of a drag handle, in pixels. */
const GUTTER_SIZE = 6;

/** A browser never shrinks below this, so its chat page stays usable. */
const MIN_PANE_WIDTH = 160;

/** Split.js sizes are percentages of the row. */
const FULL_WIDTH = 100;

/** Equal shares that always add up to exactly 100. */
function equalSizes(count: number): number[] {
  return Array.from<number>({ length: count }).fill(FULL_WIDTH / count);
}

function createGutter(_index: number, direction: 'horizontal' | 'vertical'): HTMLElement {
  const gutter = document.createElement('div');

  gutter.className = cn(
    'shrink-0 bg-border transition-colors hover:bg-primary',
    direction === 'horizontal' ? 'cursor-col-resize' : 'cursor-row-resize',
  );

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
 * Drives [Split.js](https://github.com/nathancahill/split) over the embedded
 * browsers. The instance is rebuilt whenever `paneKeys` changes, which is what
 * gives every pane an equal share again after a browser is added or removed;
 * `reset` does the same on demand.
 */
export function useSplitLayout(paneKeys: readonly string[]): UseSplitLayoutResult {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const splitRef = useRef<SplitInstance | null>(null);

  // Split.js only needs to know how many panes there are and that they changed
  // identity; joining the keys keeps the effect from re-running on every render.
  const key = paneKeys.join('\u0000');
  const count = paneKeys.length;
  const active = count > 1;

  useLayoutEffect(() => {
    if (container === null || !active) {
      return undefined;
    }

    // Split.js injects the gutters as siblings, so only the elements React
    // rendered may be handed to it.
    const panes = Array.from(container.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );

    if (panes.length !== count) {
      return undefined;
    }

    const instance = Split(panes, {
      sizes: equalSizes(count),
      minSize: MIN_PANE_WIDTH,
      gutterSize: GUTTER_SIZE,
      snapOffset: 0,
      direction: 'horizontal',
      gutter: createGutter,
      onDragStart: () => setDragging(true),
      onDragEnd: () => setDragging(false),
    });

    splitRef.current = instance;

    return () => {
      splitRef.current = null;
      setDragging(false);
      instance.destroy();
    };
    // `key` stands in for the identity of every pane; `count` is derived from it.
  }, [container, active, count, key]);

  const reset = useCallback(() => {
    if (splitRef.current !== null) {
      splitRef.current.setSizes(equalSizes(count));
    }
  }, [count]);

  return { containerRef: setContainer, dragging, active, reset };
}
