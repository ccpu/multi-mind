import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../src/theme/theme-provider';
import { ThemeToggle } from '../src/theme/theme-toggle';

function renderToggle(defaultTheme?: 'light' | 'dark' | 'system') {
  return render(
    <ThemeProvider {...(defaultTheme === undefined ? {} : { defaultTheme })}>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('themeProvider', () => {
  it('adds the dark class to the document element when dark is selected', () => {
    renderToggle('dark');

    expect(document.documentElement).toHaveClass('dark');
  });

  it('falls back to the system preference, which the test setup reports as light', () => {
    renderToggle('system');

    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('switches the theme and remembers the choice', async () => {
    const user = userEvent.setup();
    renderToggle('light');

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('app-theme')).toBe('dark');
  });

  it('prefers the stored theme over the default', () => {
    window.localStorage.setItem('app-theme', 'dark');

    renderToggle('light');

    expect(document.documentElement).toHaveClass('dark');
  });

  it('marks the active option as pressed', () => {
    renderToggle('light');

    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
