import type { Result } from '@internal/utils';
import type { AppInfo } from './types';
import { toResult } from '@internal/utils';
import { invoke } from '@tauri-apps/api/core';

/**
 * Every Rust command the frontend is allowed to call, in one place.
 *
 * Nothing else should import `invoke` directly: `invoke` takes a string and
 * returns `unknown`, so a renamed command or a changed payload only shows up at
 * runtime. Going through this module means a rename breaks the build instead.
 */
export const commands = {
  /** `greet(name)` -> greeting built on the Rust side. */
  async greet(name: string): Promise<string> {
    return invoke<string>('greet', { name });
  },

  /** Name, version and host details read from the Tauri runtime. */
  async appInfo(): Promise<AppInfo> {
    return invoke<AppInfo>('app_info');
  },
} as const;

/**
 * The same commands, with rejections turned into `Result` values.
 *
 * A command that fails - a denied permission, a panic in Rust - rejects the
 * promise with a string. Use this variant where the failure is part of the UI
 * rather than a bug worth crashing over.
 */
export const safeCommands = {
  async greet(name: string): Promise<Result<string>> {
    return toResult(commands.greet(name));
  },

  async appInfo(): Promise<Result<AppInfo>> {
    return toResult(commands.appInfo());
  },
} as const;
