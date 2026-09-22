import { describe, expect, it } from 'vitest';
import { appConfig } from '../src/app-config';

describe('appConfig', () => {
  it('names the app the way both windows title themselves', () => {
    expect(appConfig.name).toBe('Multi Mind');
  });

  it('starts on the system theme', () => {
    expect(appConfig.theme.defaultTheme).toBe('system');
  });
});
