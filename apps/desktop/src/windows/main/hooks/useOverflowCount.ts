import type { RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface UseOverflowCountResult {
  /** The single-line row the items are laid out in. */
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * A copy of the same row, hidden and never clipped, holding one child per
   * item plus a last child standing in for the overflow button. Widths are
   * read from it, because reading them from the visible row would mean
   * measuring a row that has already had items taken out of it.
   */
  ghostRef: RefObject<HTMLDivElement | null>;
  /** How many items fit; the rest belong behind the overflow button. */
  visibleCount: number;
}

/** How many of `widths` fit into `budget`, laid out with `gap` between them. */
function countThatFit(widths: number[], budget: number, gap: number): number {
  let used = 0;
  let count = 0;

  for (const width of widths) {
    const next = used + (count === 0 ? 0 : gap) + width;

    if (next > budget) {
      break;
    }

    used = next;
    count += 1;
  }

  return count;
}

/**
 * Splits a row of items into the ones that fit on one line and the ones that
 * do not, so the overflow can go in a popover rather than behind a scrollbar.
 *
 * Measuring is done off the ghost row rather than the real one: hiding an item
 * changes the layout that decided to hide it, which is how such a row ends up
 * flickering between two answers.
 */
export function useOverflowCount(itemCount: number): UseOverflowCountResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(itemCount);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const ghost = ghostRef.current;

    if (container === null || ghost === null) {
      return;
    }

    const children = [...ghost.children];
    // The ghost is one child longer than the row: the overflow button.
    if (children.length !== itemCount + 1) {
      return;
    }

    const widths = children.map((child) => child.getBoundingClientRect().width);
    const overflowWidth = widths.pop() ?? 0;
    const gap = Number.parseFloat(getComputedStyle(ghost).columnGap) || 0;
    const available = container.clientWidth;

    const fits = countThatFit(widths, available, gap);

    setVisibleCount(
      fits === widths.length
        ? fits
        : countThatFit(widths, available - overflowWidth - gap, gap),
    );
  }, [itemCount]);

  // Labels change width as they are edited, and items come and go, so the row
  // is remeasured after every render rather than on a dependency list that
  // would have to name all of that. React drops the re-render when the count
  // has not moved, so this settles in one pass.
  useLayoutEffect(measure);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return { containerRef, ghostRef, visibleCount };
}
