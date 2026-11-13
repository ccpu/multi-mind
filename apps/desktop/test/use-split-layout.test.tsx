import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useSplitLayout } from '../src/windows/main/hooks/useSplitLayout';

function Harness({ paneKeys }: { paneKeys: string[] }) {
  const { containerRef, active, reset } = useSplitLayout(paneKeys);

  return (
    <div>
      <button type="button" onClick={reset}>
        Reset
      </button>
      <span data-testid="active">{String(active)}</span>
      <div ref={containerRef} data-testid="split" className="flex">
        {paneKeys.map((key) => (
          <div key={key} data-pane={key} />
        ))}
      </div>
    </div>
  );
}

function panesOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-pane]'));
}

/**
 * Each pane gives up a share of the neighbouring gutters, so only the
 * percentage is equal across panes.
 */
function percentOf(pane: HTMLElement): string {
  return /calc\((?<percent>[\d.]+)%/u.exec(pane.style.width)?.groups?.['percent'] ?? '';
}

function guttersOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && !child.hasAttribute('data-pane'),
  );
}

function gutterCountOf(container: HTMLElement): number {
  return guttersOf(container).length;
}

/** Lays the row out 1000px wide, which jsdom does not do by itself. */
function widen(container: HTMLElement): void {
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: 1000,
  } as DOMRect);
}

function drag(gutter: HTMLElement, from: number, to: number): void {
  fireEvent.pointerDown(gutter, { button: 0, pointerId: 1, clientX: from });
  fireEvent.pointerMove(gutter, { pointerId: 1, clientX: to });
  fireEvent.pointerUp(gutter, { pointerId: 1, clientX: to });
}

function percentsOf(container: HTMLElement): number[] {
  return panesOf(container).map((pane) => Math.round(Number(percentOf(pane)) * 10) / 10);
}

describe('useSplitLayout', () => {
  it('leaves a single browser alone', () => {
    render(<Harness paneKeys={['claude']} />);

    expect(screen.getByTestId('active')).toHaveTextContent('false');
    expect(gutterCountOf(screen.getByTestId('split'))).toBe(0);
    expect(panesOf(screen.getByTestId('split'))[0]?.style.width).toBe('');
  });

  it('splits two browsers in half, with one gutter between them', () => {
    render(<Harness paneKeys={['claude', 'chatgpt']} />);

    const container = screen.getByTestId('split');
    expect(screen.getByTestId('active')).toHaveTextContent('true');
    expect(gutterCountOf(container)).toBe(1);
    expect(panesOf(container).map((pane) => pane.style.width)).toStrictEqual([
      'calc(50% - 3px)',
      'calc(50% - 3px)',
    ]);
  });

  it('shares the row equally again when a browser is added', () => {
    const { rerender } = render(<Harness paneKeys={['claude', 'chatgpt']} />);

    // A drag would leave the panes uneven.
    const [first] = panesOf(screen.getByTestId('split'));
    first!.style.width = 'calc(90% - 3px)';

    rerender(<Harness paneKeys={['claude', 'chatgpt', 'grok']} />);

    const container = screen.getByTestId('split');
    const percents = panesOf(container).map(percentOf);
    expect(gutterCountOf(container)).toBe(2);
    expect(new Set(percents).size).toBe(1);
    expect(percents[0]).toMatch(/^33\.33/u);
  });

  it('shares the row equally again when a browser is removed', () => {
    const { rerender } = render(<Harness paneKeys={['claude', 'chatgpt', 'grok']} />);

    rerender(<Harness paneKeys={['claude', 'chatgpt']} />);

    const container = screen.getByTestId('split');
    expect(gutterCountOf(container)).toBe(1);
    expect(panesOf(container).map((pane) => pane.style.width)).toStrictEqual([
      'calc(50% - 3px)',
      'calc(50% - 3px)',
    ]);
  });

  it('restores equal shares on reset', async () => {
    const user = userEvent.setup();
    render(<Harness paneKeys={['claude', 'chatgpt']} />);

    const [first] = panesOf(screen.getByTestId('split'));
    first!.style.width = 'calc(90% - 3px)';

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(
      panesOf(screen.getByTestId('split')).map((pane) => pane.style.width),
    ).toStrictEqual(['calc(50% - 3px)', 'calc(50% - 3px)']);
  });

  it('only moves the two panes beside a gutter while the nearer one has room', () => {
    render(<Harness paneKeys={['claude', 'chatgpt', 'grok']} />);
    const container = screen.getByTestId('split');
    widen(container);

    drag(guttersOf(container)[1]!, 600, 500);

    expect(percentsOf(container)).toStrictEqual([33.3, 23.3, 43.3]);
  });

  it('shrinks the browsers further along once the nearest is at its minimum', () => {
    render(<Harness paneKeys={['claude', 'chatgpt', 'grok']} />);
    const container = screen.getByTestId('split');
    widen(container);

    // 300px left: the middle pane can only give up about 167px before it is
    // down to 160px plus its gutters, so the first pane gives the rest.
    drag(guttersOf(container)[1]!, 600, 300);

    expect(percentsOf(container)).toStrictEqual([20.1, 16.6, 63.3]);
  });

  it('cascades to the right as well', () => {
    render(<Harness paneKeys={['claude', 'chatgpt', 'grok']} />);
    const container = screen.getByTestId('split');
    widen(container);

    drag(guttersOf(container)[0]!, 300, 600);

    expect(percentsOf(container)).toStrictEqual([63.3, 16.6, 20.1]);
  });
});
