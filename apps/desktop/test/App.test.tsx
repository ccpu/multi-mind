import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const { appInfo, greet, openExternal } = vi.hoisted(() => ({
  appInfo: vi.fn(),
  greet: vi.fn(),
  openExternal: vi.fn(),
}));

// The whole Rust boundary is one module, so one mock covers the window.
vi.mock('@internal/tauri-api', () => ({
  safeCommands: { appInfo, greet },
  openExternal,
}));

describe('app', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appInfo.mockResolvedValue({
      ok: true,
      value: {
        name: 'Tauri Template',
        version: '0.1.0',
        tauriVersion: '2.0.0',
        platform: 'linux',
        arch: 'x86_64',
      },
    });
    greet.mockResolvedValue({ ok: true, value: 'Hello, Ada!' });
    openExternal.mockResolvedValue(undefined);
  });

  it('renders the runtime info returned by Rust', async () => {
    render(<App />);

    expect(await screen.findByText('Tauri Template', { selector: 'dd' })).toBeVisible();
    expect(screen.getByText('x86_64')).toBeVisible();
  });

  it('shows the greeting for the submitted name', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Greet' }));

    expect(greet).toHaveBeenCalledWith('Ada');
    expect(await screen.findByText('Hello, Ada!')).toBeVisible();
  });

  it('surfaces a failed command instead of throwing', async () => {
    greet.mockResolvedValue({ ok: false, error: 'command greet not found' });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Greet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('command greet not found');
  });

  it('opens external links through the opener plugin, not the webview', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Tauri' }));

    await waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith('https://v2.tauri.app'),
    );
  });
});
