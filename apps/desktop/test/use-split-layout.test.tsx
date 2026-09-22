import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
 * Split.js subtracts a share of the neighbouring gutters from each pane, so only
 * the percentage is equal across panes.
 */
function percentOf(pane: HTMLElement): string {
  return /calc\((?<percent>[\d.]+)%/u.exec(pane.style.width)?.groups?.['percent'] ?? '';
}

function gutterCountOf(container: HTMLElement): number {
  return Array.from(container.children).filter(
    (child) => !child.hasAttribute('data-pane'),
  ).length;
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
});
