import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from '../src/logo';

describe('logo', () => {
  it('hides itself from the accessibility tree when it only decorates', () => {
    const { container } = render(<Logo />);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('becomes an image once it is given a name', () => {
    render(<Logo title="Multi Mind" />);

    expect(screen.getByRole('img', { name: 'Multi Mind' })).toBeInTheDocument();
  });
});
