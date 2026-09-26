import type { AppSettings, GuestMessageEvent } from '@internal/multi-mind';
import type { GuestPane, SearchEntry } from '@internal/tauri-api';
import { DEFAULT_SETTINGS, DEFAULT_WEBSITES } from '@internal/multi-mind';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/windows/main/App';

const settingsGet = vi.fn<() => Promise<AppSettings>>();
const settingsSave = vi.fn<(patch: Partial<AppSettings>) => Promise<AppSettings>>();
const newWindow = vi.fn<() => Promise<{ success: boolean; message: string }>>();
const guestSync = vi.fn<(panes: readonly GuestPane[]) => Promise<void>>();
const guestRun = vi.fn<(websiteId: string, script: string) => Promise<void>>();
const guestNavigate = vi.fn<(websiteId: string, url: string) => Promise<void>>();
const searchAddPrompt = vi.fn<(prompt: string) => Promise<number>>();
const searchAddConversation =
  vi.fn<(promptId: number, websiteId: string) => Promise<number>>();
const searchUpdateConversation =
  vi.fn<(id: number, title: string, url: string) => Promise<void>>();
const searchPrompts = vi.fn<(query: string) => Promise<SearchEntry[]>>();
const settingsListeners = new Set<(settings: AppSettings) => void>();
const guestListeners = new Set<(event: GuestMessageEvent) => void>();

vi.mock('@internal/tauri-api', () => ({
  openExternal: vi.fn(),
  appApi: {
    invoke: {
      getSettings: async () => settingsGet(),
      saveSettings: async (patch: Partial<AppSettings>) => settingsSave(patch),
      getSettingsLocation: async () => ({
        directory: 'C:\\settings',
        filePath: 'C:\\settings\\settings.json',
        defaultDirectory: 'C:\\settings',
        isDefault: true,
      }),
      newWindow: async () => newWindow(),
      getGuestConfig: async () => ({ bridgeKey: '_bridge', findKey: '_find' }),
      searchAddPrompt: async (prompt: string) => searchAddPrompt(prompt),
      searchAddConversation: async (promptId: number, websiteId: string) =>
        searchAddConversation(promptId, websiteId),
      searchUpdateConversation: async (id: number, title: string, url: string) =>
        searchUpdateConversation(id, title, url),
      searchPrompts: async (query: string) => searchPrompts(query),
    },
    events: {
      onSettingsChanged: (callback: (settings: AppSettings) => void) => {
        settingsListeners.add(callback);
        return () => settingsListeners.delete(callback);
      },
      onGuestMessage: (callback: (event: GuestMessageEvent) => void) => {
        guestListeners.add(callback);
        return () => guestListeners.delete(callback);
      },
    },
    guest: {
      sync: async (panes: readonly GuestPane[]) => guestSync(panes),
      setVisible: async () => undefined,
      run: async (websiteId: string, script: string) => guestRun(websiteId, script),
      navigate: async (websiteId: string, url: string) => guestNavigate(websiteId, url),
      reload: async () => undefined,
      url: async () => 'https://claude.ai/new',
      cookies: async () => [],
      deleteCookies: async () => undefined,
      openDevtools: async () => undefined,
      openPopup: async () => undefined,
      popupMenu: async () => null,
    },
  },
}));

function stub(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** Stands in for Rust broadcasting a change made in the settings window. */
function broadcast(settings: AppSettings): void {
  settingsListeners.forEach((listener) => listener(settings));
}

/** The panes are only measured and sent down once the guest config arrives. */
async function waitForPanes(): Promise<GuestPane[]> {
  await waitFor(() => {
    expect(guestSync).toHaveBeenCalled();
  });

  const calls = guestSync.mock.calls as [readonly GuestPane[]][];

  return [...(calls.at(-1)?.[0] ?? [])];
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsListeners.clear();
  guestListeners.clear();
  // The prompt box behaviour below is the same whichever editor is in it, and
  // the plain one is the one jsdom can be typed into.
  settingsGet.mockResolvedValue(stub({ promptEditor: 'plain' }));
  settingsSave.mockImplementation(async (patch) => stub(patch));
  newWindow.mockResolvedValue({
    success: true,
    message: 'Window "main-2" opened successfully.',
  });
  guestSync.mockResolvedValue(undefined);
  guestRun.mockResolvedValue(undefined);
  guestNavigate.mockResolvedValue(undefined);
  searchAddPrompt.mockResolvedValue(1);
  searchAddConversation.mockResolvedValue(1);
  searchUpdateConversation.mockResolvedValue(undefined);
  searchPrompts.mockResolvedValue([]);
});

describe('main window', () => {
  it('renders the menu strip and the prompt panel', async () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'New Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset Layout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(
      await screen.findByPlaceholderText(/Ask every enabled model/u),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(settingsGet).toHaveBeenCalledTimes(1);
    });
  });

  it('no longer configures the prompt size from the menu strip', () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: 'TexBox Size' })).not.toBeInTheDocument();
  });

  it('opens the settings dialog from the overflow menu', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Radix opens menus on pointerdown, which jsdom does not model; Enter does it.
    screen.getByRole('button', { name: 'More options' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Settings' }));

    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  /*
   * Another instance is another window in this process, because the signed-in
   * sites live in one browser profile that only one process may hold open.
   * Which window it becomes is Rust's to decide, so the press carries nothing.
   */
  it('opens another main window from the menu strip', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'New Window' }));

    expect(newWindow).toHaveBeenCalledTimes(1);
  });

  it('lists every enabled website as a toggle, unticked while closed', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: 'CLAUDE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CHATGPT' })).toBeInTheDocument();
  });

  it('presses a website toggle once its browser is open', async () => {
    const user = userEvent.setup();
    render(<App />);

    const claude = screen.getByRole('button', { name: 'CLAUDE' });
    expect(claude).toHaveAttribute('aria-pressed', 'false');

    await user.click(claude);

    expect(settingsSave).toHaveBeenCalledWith({ activeWebsites: ['claude'] });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'CLAUDE' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  it('drops a website from the menu strip once the settings window disables it', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: 'CLAUDE' })).toBeInTheDocument();

    broadcast(
      stub({
        websites: DEFAULT_WEBSITES.map((website) =>
          website.id === 'claude' ? { ...website, enabled: false } : website,
        ),
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'CLAUDE' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'CHATGPT' })).toBeInTheDocument();
  });

  it('follows the prompt size the settings window broadcasts', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({ panelButtonSize: 20, autoShrinkSize: 15, promptEditor: 'plain' }),
    );
    const { container } = render(<App />);

    // The stored settings have to have landed first, or the load resolving
    // after the broadcast would put the old size straight back.
    await waitFor(() => {
      expect(container.querySelector('[style*="height: 15%"]')).not.toBeNull();
    });

    broadcast(stub({ panelButtonSize: 40, autoShrinkSize: 5, promptEditor: 'plain' }));

    await waitFor(() => {
      expect(container.querySelector('[style*="height: 5%"]')).not.toBeNull();
    });

    await user.type(
      await screen.findByPlaceholderText(/Ask every enabled model/u),
      'hello',
    );

    expect(container.querySelector('[style*="height: 40%"]')).not.toBeNull();
  });

  it('builds the prompt box as a markdown editor by default', async () => {
    settingsGet.mockResolvedValue(stub());
    const { container } = render(<App />);

    await waitFor(() => {
      expect(container.querySelector('.EasyMDEContainer')).not.toBeNull();
    });
  });

  it('swaps the prompt box for a plain one when the setting says so', async () => {
    const { container } = render(<App />);

    expect(
      await screen.findByPlaceholderText(/Ask every enabled model/u),
    ).toBeInTheDocument();
    expect(container.querySelector('.EasyMDEContainer')).toBeNull();
  });

  it('clears the prompt and records it in the history on submit', async () => {
    const user = userEvent.setup();
    render(<App />);

    const textbox = await screen.findByPlaceholderText(/Ask every enabled model/u);
    await user.type(textbox, 'first prompt');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(textbox).toHaveValue('');

    await user.click(textbox);
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');

    expect(textbox).toHaveValue('first prompt');
  });

  /*
   * A ticked preset is a prompt of its own: the box being empty used to stop
   * the send outright, which left a preset-only prompt with no way out.
   */
  it('sends the ticked presets on their own when the box is empty', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({
        promptEditor: 'plain',
        activeWebsites: ['claude'],
        prompts: [
          {
            id: 'terse',
            name: 'Terse',
            value: 'Be terse.',
            location: 'start',
            sendOnce: false,
            untickOnNewChat: false,
            overrideOthers: false,
          },
        ],
        activePrompts: ['terse'],
      }),
    );
    render(<App />);
    await waitForPanes();

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(guestRun).toHaveBeenCalledTimes(1);
    });
    expect(guestRun.mock.calls[0]?.[0]).toBe('claude');
    expect(guestRun.mock.calls[0]?.[1]).toContain('Be terse.');
  });

  it('sends a send-once preset with the first prompt of a chat only', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({
        promptEditor: 'plain',
        activeWebsites: ['claude'],
        prompts: [
          {
            id: 'terse',
            name: 'Terse',
            value: 'Be terse.',
            location: 'start',
            sendOnce: true,
            untickOnNewChat: false,
            overrideOthers: false,
          },
        ],
        activePrompts: ['terse'],
      }),
    );
    render(<App />);
    await waitForPanes();
    const textbox = screen.getByPlaceholderText(/Ask every enabled model/u);

    await user.type(textbox, 'first');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.type(textbox, 'second');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(screen.getByRole('button', { name: 'New Chat' }));
    await user.type(textbox, 'third');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(guestRun).toHaveBeenCalledTimes(3);
    });
    const scripts = guestRun.mock.calls.map((call) => String(call[1]));
    expect(scripts[0]).toContain('Be terse.');
    expect(scripts[1]).not.toContain('Be terse.');
    expect(scripts[2]).toContain('Be terse.');
  });

  it('sends only the overriding preset while it is ticked', async () => {
    const user = userEvent.setup();
    const preset = {
      location: 'end',
      sendOnce: false,
      untickOnNewChat: false,
    } as const;
    settingsGet.mockResolvedValue(
      stub({
        promptEditor: 'plain',
        activeWebsites: ['claude'],
        prompts: [
          {
            ...preset,
            id: 'terse',
            name: 'Terse',
            value: 'Be terse.',
            overrideOthers: false,
          },
          {
            ...preset,
            id: 'json',
            name: 'JSON',
            value: 'Answer as JSON.',
            overrideOthers: true,
          },
        ],
        activePrompts: ['terse', 'json'],
      }),
    );
    render(<App />);
    await waitForPanes();

    await user.type(screen.getByPlaceholderText(/Ask every enabled model/u), 'ask');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(guestRun).toHaveBeenCalledTimes(1);
    });
    const script = String(guestRun.mock.calls[0]?.[1]);
    expect(script).toContain('Answer as JSON.');
    expect(script).not.toContain('Be terse.');
  });

  it('unticks the presets that last for one chat on New Chat', async () => {
    const user = userEvent.setup();
    const preset = {
      name: '',
      value: '',
      location: 'end',
      sendOnce: false,
      overrideOthers: false,
    } as const;
    settingsGet.mockResolvedValue(
      stub({
        promptEditor: 'plain',
        activeWebsites: ['claude'],
        prompts: [
          { ...preset, id: 'chat', untickOnNewChat: true },
          { ...preset, id: 'kept', untickOnNewChat: false },
        ],
        activePrompts: ['chat', 'kept'],
      }),
    );
    render(<App />);
    await waitForPanes();

    await user.click(screen.getByRole('button', { name: 'New Chat' }));

    expect(settingsSave).toHaveBeenCalledWith({ activePrompts: ['kept'] });
  });

  it('saves a prompt once with a conversation per provider and updates its address', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({ promptEditor: 'plain', activeWebsites: ['claude', 'chatgpt'] }),
    );
    searchAddPrompt.mockResolvedValue(7);
    searchAddConversation.mockImplementation(async (_promptId, websiteId) =>
      websiteId === 'claude' ? 1 : 2,
    );
    render(<App />);
    await waitForPanes();

    await user.type(
      screen.getByPlaceholderText(/Ask every enabled model/u),
      'Compare these',
    );
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => {
      expect(searchAddConversation).toHaveBeenCalledWith(7, 'claude');
      expect(searchAddConversation).toHaveBeenCalledWith(7, 'chatgpt');
    });
    expect(searchAddPrompt).toHaveBeenCalledTimes(1);
    expect(searchAddPrompt).toHaveBeenCalledWith('Compare these');

    guestListeners.forEach((listener) =>
      listener({
        websiteId: 'chatgpt',
        message: '__page__{"url":"https://chatgpt.com/c/123","title":"Comparison"}',
      }),
    );
    await waitFor(() => {
      expect(searchUpdateConversation).toHaveBeenCalledWith(
        2,
        'Comparison',
        'https://chatgpt.com/c/123',
      );
    });
  });

  it('enables a disabled provider and opens a saved conversation', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({
        promptEditor: 'plain',
        websites: DEFAULT_WEBSITES.map((website) =>
          website.id === 'chatgpt' ? { ...website, enabled: false } : website,
        ),
      }),
    );
    searchPrompts.mockResolvedValue([
      {
        id: 12,
        prompt: 'Compare these',
        createdAt: '2026-09-25 10:00:00',
        conversations: [
          {
            id: 3,
            websiteId: 'chatgpt',
            title: 'Comparison',
            url: 'https://chatgpt.com/c/123',
          },
        ],
      },
    ]);
    render(<App />);
    await screen.findByPlaceholderText(/Ask every enabled model/u);

    await user.type(
      screen.getByRole('textbox', { name: 'Search saved prompts' }),
      'Compare',
    );
    await user.click(await screen.findByRole('button', { name: /Compare these/u }));

    expect(settingsSave).toHaveBeenCalledWith(
      expect.objectContaining({
        activeWebsites: ['chatgpt'],
        websites: expect.arrayContaining([
          expect.objectContaining({ id: 'chatgpt', enabled: true }),
        ]),
      }),
    );
    await waitFor(() => {
      expect(guestNavigate).toHaveBeenCalledWith('chatgpt', 'https://chatgpt.com/c/123');
    });
  });

  it('lists a prompt once with its providers and opens all or one of them', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({ promptEditor: 'plain', activeWebsites: ['claude', 'chatgpt'] }),
    );
    searchPrompts.mockResolvedValue([
      {
        id: 12,
        prompt: 'Cache turbo in CI',
        createdAt: '2026-09-25 10:00:00',
        conversations: [
          { id: 3, websiteId: 'claude', title: '', url: 'https://claude.ai/chat/1' },
          { id: 4, websiteId: 'chatgpt', title: 'Turbo', url: 'https://chatgpt.com/c/2' },
          { id: 5, websiteId: 'gemini', title: '', url: '' },
        ],
      },
    ]);
    render(<App />);
    await waitForPanes();

    // Focusing the empty box lists recent prompts.
    await user.click(screen.getByRole('textbox', { name: 'Search saved prompts' }));
    expect(await screen.findByText('Recent prompts')).toBeInTheDocument();
    expect(searchPrompts).toHaveBeenCalledWith('');
    expect(screen.getAllByRole('button', { name: /Cache turbo in CI/u })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Open gemini conversation' }),
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Open chatgpt conversation' }));
    await waitFor(() => {
      expect(guestNavigate).toHaveBeenCalledWith('chatgpt', 'https://chatgpt.com/c/2');
    });
    expect(guestNavigate).not.toHaveBeenCalledWith('claude', 'https://claude.ai/chat/1');

    await user.click(screen.getByRole('textbox', { name: 'Search saved prompts' }));
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(guestNavigate).toHaveBeenCalledWith('claude', 'https://claude.ai/chat/1');
    });
  });

  it('sends nothing when the box is empty and no preset is ticked', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({ promptEditor: 'plain', activeWebsites: ['claude'] }),
    );
    render(<App />);
    await waitForPanes();

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(guestRun).not.toHaveBeenCalled();
  });

  /*
   * The preset text belongs to the sites, not to the box: what the user typed
   * is what comes back on Ctrl+Shift+Z.
   */
  it('keeps the presets out of the prompt history', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({
        promptEditor: 'plain',
        activeWebsites: ['claude'],
        prompts: [
          {
            id: 'terse',
            name: 'Terse',
            value: 'Be terse.',
            location: 'start',
            sendOnce: false,
            untickOnNewChat: false,
            overrideOthers: false,
          },
        ],
        activePrompts: ['terse'],
      }),
    );
    render(<App />);
    await waitForPanes();

    const textbox = screen.getByPlaceholderText(/Ask every enabled model/u);
    await user.type(textbox, 'first prompt');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await user.click(textbox);
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');

    expect(textbox).toHaveValue('first prompt');
  });

  it('writes a prompt preset added from the prompt panel back to the settings file', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Prompts' }));
    await user.click(screen.getByRole('button', { name: 'New prompt' }));

    expect(settingsSave).toHaveBeenCalledWith({
      prompts: [expect.objectContaining({ name: '', value: '', location: 'end' })],
    });
  });

  it('ticks a preset the settings file already holds', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({
        promptEditor: 'plain',
        prompts: [
          {
            id: 'terse',
            name: 'Terse',
            value: 'Be terse.',
            location: 'start',
            sendOnce: false,
            untickOnNewChat: false,
            overrideOthers: false,
          },
        ],
      }),
    );
    render(<App />);

    await user.click(await screen.findByRole('checkbox', { name: 'Use Terse' }));

    expect(settingsSave).toHaveBeenCalledWith({ activePrompts: ['terse'] });
  });

  /*
   * The Electron port put an actual `<webview>` in the tree. Here the page
   * lays out an empty box per site and Rust draws the browser over it, so what
   * has to be right is the list of boxes: one per open site, each with the URL
   * to start at and the scripts to run in it.
   */
  describe('embedded browsers', () => {
    it('sends one pane per open site, with its scripts', async () => {
      settingsGet.mockResolvedValue(
        stub({ promptEditor: 'plain', activeWebsites: ['claude', 'chatgpt'] }),
      );
      render(<App />);

      const panes = await waitForPanes();

      expect(panes.map((pane) => pane.websiteId)).toStrictEqual(['claude', 'chatgpt']);
      expect(panes[0]?.url).toBe('https://claude.ai/new');
      expect(panes[0]?.scripts.join('\n')).toContain('_find');
    });

    it('sends nothing at all while no site is open', async () => {
      render(<App />);
      await screen.findByPlaceholderText(/Ask every enabled model/u);

      const panes = await waitForPanes();

      expect(panes).toStrictEqual([]);
    });

    it('takes every open browser back to its URL on New Chat', async () => {
      const user = userEvent.setup();
      settingsGet.mockResolvedValue(
        stub({ promptEditor: 'plain', activeWebsites: ['claude'] }),
      );
      render(<App />);
      await waitForPanes();

      await user.click(screen.getByRole('button', { name: 'New Chat' }));

      expect(guestNavigate).toHaveBeenCalledWith('claude', 'https://claude.ai/new');
    });
  });
});
