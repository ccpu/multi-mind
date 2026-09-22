import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, safeCommands } from '../src/commands';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('commands', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('passes the argument under the name the Rust command expects', async () => {
    invoke.mockResolvedValue('Hello, Ada!');

    await expect(commands.greet('Ada')).resolves.toBe('Hello, Ada!');
    expect(invoke).toHaveBeenCalledWith('greet', { name: 'Ada' });
  });

  it('invokes app_info without arguments', async () => {
    invoke.mockResolvedValue({ name: 'app', version: '0.1.0' });

    await commands.appInfo();

    expect(invoke).toHaveBeenCalledWith('app_info');
  });

  it('propagates a rejection', async () => {
    invoke.mockRejectedValue(new Error('command not found'));

    await expect(commands.greet('Ada')).rejects.toThrow('command not found');
  });
});

describe('safeCommands', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('returns a value result on success', async () => {
    invoke.mockResolvedValue('Hello, Ada!');

    await expect(safeCommands.greet('Ada')).resolves.toStrictEqual({
      ok: true,
      value: 'Hello, Ada!',
    });
  });

  it('returns an error result instead of rejecting', async () => {
    invoke.mockRejectedValue('permission denied');

    await expect(safeCommands.appInfo()).resolves.toStrictEqual({
      ok: false,
      error: 'permission denied',
    });
  });
});
