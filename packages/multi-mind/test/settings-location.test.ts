import { describe, expect, it } from 'vitest';
import { describeSettingsPathProblem } from '../src/settings-location';

describe('describeSettingsPathProblem', () => {
  it('accepts a drive path', () => {
    expect(describeSettingsPathProblem('D:\\Multi Mind')).toBeNull();
  });

  it('accepts a forward-slash drive path', () => {
    expect(describeSettingsPathProblem('C:/Users/me/Multi Mind')).toBeNull();
  });

  it('accepts a UNC share', () => {
    expect(describeSettingsPathProblem('\\\\server\\share\\Multi Mind')).toBeNull();
  });

  it('accepts a posix path', () => {
    expect(describeSettingsPathProblem('/home/me/multi-mind')).toBeNull();
  });

  it('ignores the whitespace a paste brings with it', () => {
    expect(describeSettingsPathProblem('  D:\\Multi Mind  ')).toBeNull();
  });

  it('rejects a blank box', () => {
    expect(describeSettingsPathProblem('   ')).toBe(
      'Enter a folder for the settings file.',
    );
  });

  it('rejects a relative path, which would depend on where the app was started', () => {
    expect(describeSettingsPathProblem('Multi Mind\\config')).toMatch(/full path/u);
  });

  it('rejects a bare drive letter with no separator', () => {
    expect(describeSettingsPathProblem('D:')).toMatch(/full path/u);
  });
});
