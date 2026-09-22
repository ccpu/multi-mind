import { useCallback, useEffect, useRef } from 'react';

const CLICK_DELAY = 1000;

/**
 * Port of `Multi Mind/TextBoxTextSelectionHandler.cs`. The counter starts a 1s timer
 * on the second click and fires once the count passes three, which is what the
 * WinForms original did despite its "third click" naming.
 */
export function useThirdClickHandler(onThirdClick: () => void): () => void {
  const clickCount = useRef(0);
  const timeoutId = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callback = useRef(onThirdClick);

  callback.current = onThirdClick;

  const stopTimer = useCallback(() => {
    if (timeoutId.current !== undefined) {
      clearTimeout(timeoutId.current);
      timeoutId.current = undefined;
    }
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  return useCallback(() => {
    clickCount.current += 1;

    if (clickCount.current === 2) {
      stopTimer();
      timeoutId.current = setTimeout(() => {
        clickCount.current = 0;
        timeoutId.current = undefined;
      }, CLICK_DELAY);
    } else if (clickCount.current > 3) {
      callback.current();
      clickCount.current = 0;
      stopTimer();
    }
  }, [stopTimer]);
}
