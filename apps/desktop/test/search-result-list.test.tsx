import type { SearchEntry } from '@internal/tauri-api';
import { DEFAULT_WEBSITES } from '@internal/multi-mind';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchResultList } from '../src/windows/main/components/search/SearchResultList';

afterEach(() => vi.restoreAllMocks());

describe('search result list', () => {
  it('renders only nearby rows and retains actions after scrolling to a keyboard selection', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 96 : 340;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(384);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(340);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(9600);
    const entries: SearchEntry[] = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      title: `Chat ${index}`,
      prompt: `Prompt ${index}`,
      updatedAt: '',
      conversations: [],
    }));
    const onFavorite = vi.fn();
    const props = {
      entries,
      terms: [],
      websites: DEFAULT_WEBSITES,
      listId: 'history',
      activeIndex: 0,
      keyboardTarget: null,
      saving: false,
      onHover: vi.fn(),
      onOpen: vi.fn(),
      onFavorite,
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    };
    const { container, rerender } = render(<SearchResultList {...props} />);
    expect(screen.getByText('Chat 0')).toBeInTheDocument();
    expect(screen.queryByText('Chat 99')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-index]').length).toBeLessThan(20);

    const scroll = container.firstElementChild as HTMLElement;
    const scrollTo = vi.fn();
    scroll.scrollTo = scrollTo;
    rerender(
      <SearchResultList {...props} activeIndex={99} keyboardTarget={{ index: 99 }} />,
    );

    expect(scrollTo).toHaveBeenCalled();
    const options = scrollTo.mock.lastCall?.[0] as ScrollToOptions;
    expect(options.top).toBeGreaterThan(0);
    scroll.scrollTop = options.top!;
    fireEvent.scroll(scroll);
    expect(await screen.findByText('Chat 99')).toBeInTheDocument();
    const favoriteButtons = screen.getAllByRole('button', { name: 'Add to favorites' });
    await userEvent.click(favoriteButtons[favoriteButtons.length - 1]!);
    expect(onFavorite).toHaveBeenCalledWith(entries[99]);
  });
});
