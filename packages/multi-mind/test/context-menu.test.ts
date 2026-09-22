import type {
  ContextMenuAction,
  ContextMenuEntry,
  ContextMenuState,
} from '../src/context-menu';
import { describe, expect, it } from 'vitest';
import { buildContextMenuModel } from '../src/context-menu';

function state(overrides: Partial<ContextMenuState> = {}): ContextMenuState {
  return {
    isBrowser: false,
    hasSiteCookies: true,
    canGoBack: false,
    canGoForward: false,
    linkUrl: '',
    hasImage: false,
    isEditable: false,
    hasSelection: false,
    editFlags: {
      canCopy: false,
      canCut: false,
      canPaste: false,
      canRedo: false,
      canSelectAll: false,
      canUndo: false,
    },
    canInspect: false,
    ...overrides,
  };
}

function actions(entries: ContextMenuEntry[]): (ContextMenuAction | 'separator')[] {
  return entries.map((entry) =>
    entry.type === 'separator' ? 'separator' : entry.action,
  );
}

function find(entries: ContextMenuEntry[], action: ContextMenuAction) {
  return entries.find((entry) => entry.type === 'item' && entry.action === action);
}

describe('buildContextMenuModel', () => {
  it('should offer navigation on an embedded site', () => {
    const entries = buildContextMenuModel(
      state({ isBrowser: true, canGoBack: true, canGoForward: true }),
    );

    expect(actions(entries)).toEqual(['back', 'forward', 'reload', 'clearCookies']);
  });

  it('should grey out navigation the site cannot do yet', () => {
    const entries = buildContextMenuModel(state({ isBrowser: true }));

    expect(find(entries, 'back')).toMatchObject({ enabled: false });
    expect(find(entries, 'forward')).toMatchObject({ enabled: false });
    expect(find(entries, 'reload')).toMatchObject({ enabled: true });
  });

  it('should grey out clearing cookies on a page that has none', () => {
    const entries = buildContextMenuModel(
      state({ isBrowser: true, hasSiteCookies: false }),
    );

    expect(find(entries, 'clearCookies')).toMatchObject({ enabled: false });
  });

  it("should leave navigation out of the app's own windows", () => {
    const entries = buildContextMenuModel(state({ canInspect: true }));

    expect(actions(entries)).toEqual(['inspect']);
  });

  it('should hide Inspect Element where it is not on offer', () => {
    expect(buildContextMenuModel(state({ isBrowser: true, canInspect: false }))).toEqual(
      buildContextMenuModel(state({ isBrowser: true })),
    );
    expect(actions(buildContextMenuModel(state()))).toEqual([]);
  });

  it('should offer the link items on a web link', () => {
    const entries = buildContextMenuModel(
      state({ isBrowser: true, linkUrl: 'https://example.com/thread' }),
    );

    expect(actions(entries)).toEqual([
      'back',
      'forward',
      'reload',
      'clearCookies',
      'separator',
      'openLinkExternally',
      'copyLink',
    ]);
  });

  it('should ignore a link the system browser cannot open', () => {
    const entries = buildContextMenuModel(
      state({ linkUrl: 'mailto:someone@example.com' }),
    );

    expect(find(entries, 'openLinkExternally')).toBeUndefined();
  });

  it('should offer the full clipboard set in a text box', () => {
    const entries = buildContextMenuModel(
      state({
        isEditable: true,
        editFlags: {
          canCopy: true,
          canCut: true,
          canPaste: true,
          canRedo: false,
          canSelectAll: true,
          canUndo: true,
        },
      }),
    );

    expect(actions(entries)).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'selectAll',
    ]);
    expect(find(entries, 'redo')).toMatchObject({ enabled: false });
  });

  it('should offer Copy on a selection outside a text box', () => {
    const entries = buildContextMenuModel(
      state({ hasSelection: true, editFlags: { ...state().editFlags, canCopy: true } }),
    );

    expect(actions(entries)).toEqual(['copy']);
  });

  it('should keep one separator between the sections that have items', () => {
    const entries = buildContextMenuModel(
      state({
        isBrowser: true,
        hasSelection: true,
        canInspect: true,
        editFlags: { ...state().editFlags, canCopy: true },
      }),
    );

    expect(actions(entries)).toEqual([
      'back',
      'forward',
      'reload',
      'clearCookies',
      'separator',
      'copy',
      'separator',
      'inspect',
    ]);
  });

  it('should never start or end with a separator', () => {
    const entries = buildContextMenuModel(state({ isBrowser: true, canInspect: true }));

    expect(entries.at(0)).toMatchObject({ type: 'item' });
    expect(entries.at(-1)).toMatchObject({ type: 'item' });
  });
});
