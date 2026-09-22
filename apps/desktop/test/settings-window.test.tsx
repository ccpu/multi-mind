import type {
  AppSettings,
  SettingsLocation,
  SettingsLocationRequest,
  SettingsLocationResult,
} from '@internal/multi-mind';
import { DEFAULT_SETTINGS, DEFAULT_WEBSITES } from '@internal/multi-mind';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/windows/settings/App';

const settingsGet = vi.fn<() => Promise<AppSettings>>();
const settingsSave = vi.fn<(patch: Partial<AppSettings>) => Promise<AppSettings>>();
const settingsListeners = new Set<(settings: AppSettings) => void>();

const locationGet = vi.fn<() => Promise<SettingsLocation>>();
const locationBrowse = vi.fn<() => Promise<string | null>>();
const locationSet =
  vi.fn<
    (
      directory: string,
      request?: SettingsLocationRequest,
    ) => Promise<SettingsLocationResult>
  >();
const locationReset =
  vi.fn<(request?: SettingsLocationRequest) => Promise<SettingsLocationResult>>();

const DEFAULT_DIRECTORY = 'C:\\Users\\me\\AppData\\Roaming\\multi-mind';

function makeLocation(directory = DEFAULT_DIRECTORY): SettingsLocation {
  return {
    directory,
    filePath: `${directory}\\settings.json`,
    defaultDirectory: DEFAULT_DIRECTORY,
    isDefault: directory === DEFAULT_DIRECTORY,
  };
}

vi.mock('@internal/tauri-api', () => ({
  openExternal: vi.fn(),
  appApi: {
    invoke: {
      getSettings: async () => settingsGet(),
      saveSettings: async (patch: Partial<AppSettings>) => settingsSave(patch),
      getSettingsLocation: async () => locationGet(),
      browseSettingsLocation: async () => locationBrowse(),
      setSettingsLocation: async (directory: string, request?: SettingsLocationRequest) =>
        locationSet(directory, request),
      resetSettingsLocation: async (request?: SettingsLocationRequest) =>
        locationReset(request),
    },
    events: {
      onSettingsChanged: (callback: (settings: AppSettings) => void) => {
        settingsListeners.add(callback);
        return () => settingsListeners.delete(callback);
      },
      onGuestMessage: () => () => undefined,
    },
  },
}));

function stub(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** The seeded claude, which is what a site following the app resolves to. */
function seededClaude(): AppSettings['websites'][number] {
  return DEFAULT_WEBSITES.find((website) => website.id === 'claude')!;
}

/** The same site, re-pointed by the user and no longer following the seed. */
function ownClaude(): AppSettings['websites'][number] {
  return { ...seededClaude(), url: 'https://mine.test/', useDefaults: false };
}

/** Two named sites keep the assertions about order readable. */
function twoSites(): AppSettings {
  return stub({
    websites: DEFAULT_WEBSITES.filter((website) =>
      ['claude', 'chatgpt'].includes(website.id),
    ),
  });
}

/** The row's own patch, once the debounced write has gone through. */
async function lastSavedWebsites(): Promise<AppSettings['websites']> {
  await waitFor(() => {
    expect(settingsSave).toHaveBeenCalled();
  });

  const patches = settingsSave.mock.calls.map(([patch]) => patch);

  return patches.reduce<AppSettings['websites']>(
    (websites, patch) => patch.websites ?? websites,
    [],
  );
}

describe('settings window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsListeners.clear();
    settingsGet.mockResolvedValue(twoSites());
    settingsSave.mockImplementation(async (patch) => stub(patch));
    locationGet.mockResolvedValue(makeLocation());
    locationBrowse.mockResolvedValue(null);
    locationSet.mockImplementation(async (directory) => ({
      status: 'ok',
      directory,
      location: makeLocation(directory),
    }));
    locationReset.mockImplementation(async () => ({
      status: 'ok',
      directory: DEFAULT_DIRECTORY,
      location: makeLocation(),
    }));
  });

  it('renders the application', async () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByText('claude')).toBeInTheDocument();
  });

  it('lists a row per site, with the prompt box settings above them', async () => {
    render(<App />);

    expect(screen.getByLabelText('Text box size')).toBeInTheDocument();
    expect(screen.getByLabelText('Auto shrink')).toBeInTheDocument();
    expect(screen.getByLabelText('Auto shrink size')).toBeInTheDocument();

    expect(await screen.findByRole('switch', { name: 'Enable claude' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Enable chatgpt' })).toBeInTheDocument();
  });

  it('starts the prompt box on the markdown editor', async () => {
    render(<App />);

    expect(await screen.findByLabelText('Editor')).toHaveTextContent('Markdown');
  });

  it('switches the prompt box to the plain editor', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByLabelText('Editor'));
    await user.click(await screen.findByRole('option', { name: 'Plain text' }));

    await waitFor(() => {
      expect(settingsSave).toHaveBeenCalledWith({ promptEditor: 'plain' });
    });
  });

  it('persists the auto shrink toggle', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText('Auto shrink'));

    await waitFor(() => {
      expect(settingsSave).toHaveBeenCalledWith({ autoShrink: false });
    });
  });

  it('starts with the update check on', async () => {
    render(<App />);

    expect(await screen.findByLabelText('Check for updates automatically')).toBeChecked();
  });

  it('switches the update check off, and counts as having been asked', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByLabelText('Check for updates automatically'));

    await waitFor(() => {
      expect(settingsSave).toHaveBeenCalledWith({
        autoUpdate: false,
        autoUpdatePrompted: true,
      });
    });
  });

  it('disables a site without removing it', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('switch', { name: 'Enable claude' }));

    const websites = await lastSavedWebsites();
    expect(websites.map((website) => website.id)).toStrictEqual(['claude', 'chatgpt']);
    expect(websites.find((website) => website.id === 'claude')?.enabled).toBe(false);
  });

  it('opens a row into its editor and saves an edited url', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(stub({ websites: [ownClaude()] }));
    render(<App />);

    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument();

    await user.click(
      await screen.findByRole('button', { expanded: false, name: /claude/u }),
    );
    await user.clear(screen.getByLabelText('URL'));
    await user.type(screen.getByLabelText('URL'), 'https://claude.ai/');

    const websites = await lastSavedWebsites();
    expect(websites[0]?.url).toBe('https://claude.ai/');
    // Renaming or re-pointing a site must not disturb what refers to it.
    expect(websites[0]?.id).toBe('claude');
  });

  it('hides the fields while a site follows the built-in definition', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({ websites: [{ ...ownClaude(), useDefaults: true }] }),
    );
    render(<App />);

    await user.click(
      await screen.findByRole('button', { expanded: false, name: /claude/u }),
    );

    expect(screen.getByLabelText('Use the built-in settings')).toBeChecked();
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    // The row still shows the built-in definition rather than what was typed.
    expect(
      screen.getByRole('button', { expanded: true, name: /claude/u }),
    ).toHaveTextContent(seededClaude().url);
  });

  it('brings the fields back when the site stops following the built-in one', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({ websites: [{ ...ownClaude(), useDefaults: true }] }),
    );
    render(<App />);

    await user.click(
      await screen.findByRole('button', { expanded: false, name: /claude/u }),
    );
    await user.click(screen.getByLabelText('Use the built-in settings'));

    expect(await screen.findByLabelText('URL')).toHaveValue('https://mine.test/');
  });

  it('gives back what was typed when the site stops following the built-in one', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      stub({ websites: [{ ...ownClaude(), useDefaults: true }] }),
    );
    render(<App />);

    await user.click(
      await screen.findByRole('button', { expanded: false, name: /claude/u }),
    );
    await user.click(screen.getByLabelText('Use the built-in settings'));

    const websites = await lastSavedWebsites();
    expect(websites[0]?.useDefaults).toBe(false);
    // The typed url was never thrown away, only covered up.
    expect(websites[0]?.url).toBe('https://mine.test/');
  });

  it('offers no built-in switch on a site the user added', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Add site' }));

    expect(screen.queryByLabelText('Use the built-in settings')).not.toBeInTheDocument();
  });

  it('adds a blank site, already open for editing', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Add site' }));

    const websites = await lastSavedWebsites();
    expect(websites).toHaveLength(3);
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('removes a site once the removal is confirmed', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole('button', { expanded: false, name: /claude/u }),
    );
    await user.click(screen.getByRole('button', { name: 'Remove site' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    const websites = await lastSavedWebsites();
    expect(websites.map((website) => website.id)).toStrictEqual(['chatgpt']);
  });

  it('follows a change made in another window', async () => {
    render(<App />);
    expect(await screen.findByText('claude')).toBeInTheDocument();

    settingsListeners.forEach((listener) =>
      listener(stub({ ...twoSites(), panelButtonSize: 60 })),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Text box size')).toHaveTextContent('60%');
    });
  });

  describe('settings file location', () => {
    it('shows where the settings file is kept', async () => {
      render(<App />);

      expect(await screen.findByLabelText('Folder')).toHaveValue(DEFAULT_DIRECTORY);
      expect(
        screen.getByText(`${DEFAULT_DIRECTORY}\\settings.json (default)`),
      ).toBeInTheDocument();
    });

    it('fills the box from the native folder picker', async () => {
      const user = userEvent.setup();
      locationBrowse.mockResolvedValue('D:\\Multi Mind');
      render(<App />);

      await user.click(await screen.findByRole('button', { name: 'Browse' }));

      await waitFor(() => {
        expect(screen.getByLabelText('Folder')).toHaveValue('D:\\Multi Mind');
      });
    });

    it('moves the settings file to a typed folder', async () => {
      const user = userEvent.setup();
      render(<App />);

      const folder = await screen.findByLabelText('Folder');
      await user.clear(folder);
      await user.type(folder, 'D:\\Multi Mind');
      await user.click(screen.getByRole('button', { name: 'Save location' }));

      await waitFor(() => {
        expect(locationSet).toHaveBeenCalledWith('D:\\Multi Mind', {});
      });
      expect(await screen.findByText(/has been moved/u)).toBeInTheDocument();
    });

    it('asks before creating a folder that is not there', async () => {
      const user = userEvent.setup();
      locationSet.mockImplementationOnce(async (directory) => ({
        status: 'missing',
        directory,
      }));
      render(<App />);

      await user.click(await screen.findByRole('button', { name: 'Save location' }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('does not exist');
      await user.click(within(dialog).getByRole('button', { name: 'Create folder' }));

      await waitFor(() => {
        expect(locationSet).toHaveBeenLastCalledWith(DEFAULT_DIRECTORY, { create: true });
      });
    });

    it('leaves the file where it is when the folder is not created', async () => {
      const user = userEvent.setup();
      locationSet.mockResolvedValue({ status: 'missing', directory: 'D:\\Multi Mind' });
      render(<App />);

      await user.click(await screen.findByRole('button', { name: 'Save location' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(locationSet).toHaveBeenCalledTimes(1);
      });
    });

    it('asks before replacing a settings file already in the folder', async () => {
      const user = userEvent.setup();
      locationSet.mockImplementationOnce(async (directory) => ({
        status: 'occupied',
        directory,
      }));
      render(<App />);

      await user.click(await screen.findByRole('button', { name: 'Save location' }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('already has a settings file');
      await user.click(within(dialog).getByRole('button', { name: 'Overwrite them' }));

      await waitFor(() => {
        expect(locationSet).toHaveBeenLastCalledWith(DEFAULT_DIRECTORY, {
          conflict: 'replace',
        });
      });
    });

    it('can keep the settings file already in the folder instead', async () => {
      const user = userEvent.setup();
      locationSet.mockImplementationOnce(async (directory) => ({
        status: 'occupied',
        directory,
      }));
      render(<App />);

      await user.click(await screen.findByRole('button', { name: 'Save location' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(
        within(dialog).getByRole('button', { name: 'Keep those settings' }),
      );

      await waitFor(() => {
        expect(locationSet).toHaveBeenLastCalledWith(DEFAULT_DIRECTORY, {
          conflict: 'adopt',
        });
      });
      expect(await screen.findByText(/already in that folder/u)).toBeInTheDocument();
    });

    it('leaves both settings files alone when the conflict is not answered', async () => {
      const user = userEvent.setup();
      locationSet.mockResolvedValue({
        status: 'occupied',
        directory: 'D:\\Multi Mind',
      });
      render(<App />);

      await user.click(await screen.findByRole('button', { name: 'Save location' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(locationSet).toHaveBeenCalledTimes(1);
      });
    });

    it('reports a folder it cannot use', async () => {
      const user = userEvent.setup();
      locationSet.mockResolvedValue({
        status: 'invalid',
        directory: 'D:\\Multi Mind',
        message: 'That folder cannot be written to.',
      });
      render(<App />);

      await user.click(await screen.findByRole('button', { name: 'Save location' }));

      expect(
        await screen.findByText('That folder cannot be written to.'),
      ).toBeInTheDocument();
    });

    it('offers a way back to the default folder once it has moved', async () => {
      const user = userEvent.setup();
      locationGet.mockResolvedValue(makeLocation('D:\\Multi Mind'));
      render(<App />);

      await user.click(await screen.findByRole('button', { name: 'Use default' }));

      await waitFor(() => {
        expect(locationReset).toHaveBeenCalledWith({});
      });
    });

    it('hides that way back while the file is already in the default folder', async () => {
      render(<App />);

      expect(await screen.findByLabelText('Folder')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Use default' }),
      ).not.toBeInTheDocument();
    });
  });
});
