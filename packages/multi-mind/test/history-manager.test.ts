import { describe, expect, it } from 'vitest';
import { HistoryManager } from '../src/history-manager';

describe('historyManager', () => {
  it('starts empty', () => {
    expect(new HistoryManager().getCurrentText()).toBe('');
  });

  it('parks the cursor past the newest entry after saving', () => {
    const history = new HistoryManager();
    history.saveState('first');

    expect(history.getCurrentText()).toBe('');
  });

  it('walks backwards through saved prompts', () => {
    const history = new HistoryManager();
    history.saveState('first');
    history.saveState('second');

    history.previous();
    expect(history.getCurrentText()).toBe('second');

    history.previous();
    expect(history.getCurrentText()).toBe('first');

    history.previous();
    expect(history.getCurrentText()).toBe('first');
  });

  it('walks forwards again without passing the newest entry', () => {
    const history = new HistoryManager();
    history.saveState('first');
    history.saveState('second');
    history.previous();
    history.previous();

    history.next();
    expect(history.getCurrentText()).toBe('second');

    history.next();
    expect(history.getCurrentText()).toBe('second');
  });
});
