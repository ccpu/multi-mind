import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearOfBrowsers,
  useOverlayPresence,
} from '../src/windows/main/hooks/useOverlayPresence';

/** Portals a popper wrapper the way Radix does, around `content`. */
async function portal(content: HTMLElement): Promise<void> {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-radix-popper-content-wrapper', '');
  wrapper.append(content);

  await act(async () => {
    document.body.append(wrapper);
  });
}

describe('useOverlayPresence', () => {
  afterEach(() => {
    document
      .querySelectorAll('[data-radix-popper-content-wrapper]')
      .forEach((wrapper) => wrapper.remove());
  });

  it('reports a popover drawn over the window', async () => {
    const { result } = renderHook(() => useOverlayPresence());

    await portal(document.createElement('div'));

    expect(result.current).toBe(true);
  });

  it('leaves the browsers alone for content kept clear of them', async () => {
    const { result } = renderHook(() => useOverlayPresence());
    const content = document.createElement('div');
    Object.entries(clearOfBrowsers).forEach(([name, value]) => {
      content.setAttribute(name, value);
    });

    await portal(content);

    expect(result.current).toBe(false);
  });
});
