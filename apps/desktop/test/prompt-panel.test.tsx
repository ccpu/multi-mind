import type { PromptPreset } from '@internal/multi-mind';
import type { RefObject } from 'react';
import type { PromptEditorHandle } from '../src/windows/main/types/prompt-editor';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PromptPanel } from '../src/windows/main/components/PromptPanel';

type PanelProps = Parameters<typeof PromptPanel>[0];

function editorHandle(): RefObject<PromptEditorHandle | null> {
  return { current: null };
}

function preset(overrides: Partial<PromptPreset> = {}): PromptPreset {
  return {
    id: 'english',
    name: 'English',
    value: 'Answer in English.',
    location: 'end',
    sendOnce: false,
    untickOnNewChat: false,
    overrideOthers: false,
    ...overrides,
  };
}

function panelProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    editorRef: editorHandle(),
    editor: 'plain' as const,
    value: '',
    heightPercent: 20,
    presets: [],
    activePrompts: [],
    onChange: vi.fn(),
    onActivate: vi.fn(),
    onSubmit: vi.fn(),
    onPreviousPrompt: vi.fn(),
    onNextPrompt: vi.fn(),
    onDismiss: vi.fn(),
    onTogglePreset: vi.fn(),
    onMovePreset: vi.fn(),
    onAddPreset: vi.fn(),
    onChangePreset: vi.fn(),
    onRemovePreset: vi.fn(),
    ...overrides,
  };
}

/** jsdom lays nothing out, so a drag needs the boxes it is measured against. */
function placeAt(element: Element, left: number, width: number): void {
  const rect = {
    x: left,
    y: 0,
    left,
    top: 0,
    right: left + width,
    bottom: 24,
    width,
    height: 24,
    toJSON: () => ({}),
  };

  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);
}

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props = panelProps(overrides);

  return { ...render(<PromptPanel {...props} />), props };
}

describe('promptPanel', () => {
  it('sizes itself as a percentage of the window, as the original did', () => {
    const { container } = renderPanel({ heightPercent: 35 });

    expect(container.querySelector('[style*="height: 35%"]')).not.toBeNull();
  });

  describe('plain editor', () => {
    it('renders a textarea holding the prompt', () => {
      renderPanel({ value: 'hello' });

      expect(screen.getByRole('textbox')).toHaveValue('hello');
    });

    it('reports typing and wakes the panel up', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel();

      await user.type(screen.getByRole('textbox'), 'a');

      expect(props.onChange).toHaveBeenCalledWith('a');
      expect(props.onActivate).toHaveBeenCalled();
    });

    it('submits on ctrl+enter', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ value: 'ask' });

      await user.click(screen.getByRole('textbox'));
      await user.keyboard('{Control>}{Enter}{/Control}');

      expect(props.onSubmit).toHaveBeenCalledTimes(1);
    });

    it('walks the prompt history on ctrl+shift+z and ctrl+shift+y', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel();

      await user.click(screen.getByRole('textbox'));
      await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
      await user.keyboard('{Control>}{Shift>}y{/Shift}{/Control}');

      expect(props.onPreviousPrompt).toHaveBeenCalledTimes(1);
      expect(props.onNextPrompt).toHaveBeenCalledTimes(1);
    });

    it('collapses on escape', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel();

      await user.click(screen.getByRole('textbox'));
      await user.keyboard('{Escape}');

      expect(props.onDismiss).toHaveBeenCalledTimes(1);
    });

    it('selects the whole prompt through the handle', () => {
      const editorRef = editorHandle();
      renderPanel({ editorRef, value: 'select me' });

      editorRef.current?.selectAll();

      const textarea = screen.getByRole<HTMLTextAreaElement>('textbox');
      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe('select me'.length);
    });
  });

  describe('markdown editor', () => {
    it('builds an EasyMDE editor over the prompt', () => {
      const { container } = renderPanel({ editor: 'markdown', value: '# hello' });

      expect(container.querySelector('.EasyMDEContainer')).not.toBeNull();
      expect(container.querySelector('.CodeMirror')).not.toBeNull();
    });

    it('answers the same handle, so the window need not know which editor it is', () => {
      const editorRef = editorHandle();
      const { container } = renderPanel({ editor: 'markdown', editorRef });

      const editor = container.querySelector('.CodeMirror');
      if (editor === null) {
        throw new Error('The markdown editor was not built.');
      }

      // The click-outside collapse asks this of whichever editor is mounted,
      // and EasyMDE's DOM is not the textarea it replaced.
      expect(editorRef.current?.contains(editor)).toBe(true);
      expect(editorRef.current?.contains(document.body)).toBe(false);
    });

    it('pushes a prompt set from outside into the editor', () => {
      const editorRef = editorHandle();
      const { rerender, container } = renderPanel({ editor: 'markdown', editorRef });

      rerender(
        <PromptPanel
          {...panelProps({ editorRef, editor: 'markdown', value: 'from the history' })}
        />,
      );

      expect(container.textContent).toContain('from the history');
    });
  });

  describe('prompt presets', () => {
    const presets = [
      preset(),
      preset({ id: 'terse', name: 'Terse', value: 'Be terse.', location: 'start' }),
    ];

    it('shows nothing above the prompt box while the library is empty', () => {
      renderPanel();

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('gives every preset a badge, ticked when it is in use', () => {
      renderPanel({ presets, activePrompts: ['terse'] });

      expect(screen.getByRole('checkbox', { name: 'Use English' })).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Use Terse' })).toBeChecked();
    });

    it('keeps the library order whatever is ticked', () => {
      renderPanel({ presets, activePrompts: ['terse'] });

      const badges = screen.getAllByRole('button', { name: /English|Terse/u });

      expect(badges.map((badge) => badge.textContent)).toStrictEqual([
        'English',
        'Terse',
      ]);
    });

    it('moves a preset by dragging the badge itself, without opening its editor', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });
      const name = screen.getByRole('button', { name: 'English' });
      const english = name.parentElement!;
      const terse = screen.getByRole('button', { name: 'Terse' }).parentElement!;
      placeAt(english.parentElement!, 0, 500);
      placeAt(english, 0, 60);
      placeAt(terse, 70, 60);

      await user.pointer([
        { keys: '[MouseLeft>]', target: name, coords: { clientX: 30, clientY: 12 } },
        { coords: { clientX: 60, clientY: 12 } },
        { coords: { clientX: 100, clientY: 12 } },
        { keys: '[/MouseLeft]' },
      ]);

      expect(props.onMovePreset).toHaveBeenCalledWith('english', 'terse');
      expect(screen.queryByLabelText('Text')).not.toBeInTheDocument();
    });

    it('ticks a preset from its badge', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('checkbox', { name: 'Use English' }));

      expect(props.onTogglePreset).toHaveBeenCalledWith('english');
    });

    it('edits a preset in place, from the badge itself', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'English' }));
      await user.clear(screen.getByLabelText('Text'));
      await user.type(screen.getByLabelText('Text'), 'Answer in French.');

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
      await waitFor(() => {
        expect(props.onChangePreset).toHaveBeenCalledWith('english', {
          name: 'English',
          value: 'Answer in French.',
          location: 'end',
          sendOnce: false,
          untickOnNewChat: false,
          overrideOthers: false,
        });
      });
      expect(props.onChangePreset).toHaveBeenCalledTimes(1);
    });

    it('moves a preset to the other side of the prompt from the badge editor', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'English' }));
      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: 'Before the prompt' }));

      await waitFor(() => {
        expect(props.onChangePreset).toHaveBeenCalledWith(
          'english',
          expect.objectContaining({ location: 'start' }),
        );
      });
    });

    it('sets a preset to go out once per chat from the badge editor', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'English' }));
      await user.click(screen.getByRole('switch', { name: 'First message only' }));

      await waitFor(() => {
        expect(props.onChangePreset).toHaveBeenCalledWith(
          'english',
          expect.objectContaining({ sendOnce: true }),
        );
      });
    });

    it('sets a preset to untick on New Chat from the badge editor', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'English' }));
      await user.click(screen.getByRole('switch', { name: 'Untick on New Chat' }));

      await waitFor(() => {
        expect(props.onChangePreset).toHaveBeenCalledWith(
          'english',
          expect.objectContaining({ untickOnNewChat: true }),
        );
      });
    });

    it('sets a preset to override the others from the badge editor', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'English' }));
      await user.click(screen.getByRole('switch', { name: 'Override other prompts' }));

      await waitFor(() => {
        expect(props.onChangePreset).toHaveBeenCalledWith(
          'english',
          expect.objectContaining({ overrideOthers: true }),
        );
      });
    });

    it('greys out the other presets while an overriding one is ticked, and says why', async () => {
      const user = userEvent.setup();
      renderPanel({
        presets: [
          preset({
            id: 'terse',
            name: 'Terse',
            value: 'Be terse.',
            overrideOthers: true,
          }),
          preset(),
        ],
        activePrompts: ['terse', 'english'],
      });

      const english = screen.getByRole('button', { name: 'English' }).parentElement!;
      const terse = screen.getByRole('button', { name: 'Terse' }).parentElement!;
      expect(english).toHaveClass('opacity-50');
      expect(terse).not.toHaveClass('opacity-50');

      await user.hover(english);

      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Not sent while “Terse” is ticked: it overrides the other prompts.',
      );
    });

    it('greys nothing out while the overriding preset is not ticked', () => {
      renderPanel({
        presets: [preset({ id: 'terse', name: 'Terse', overrideOthers: true }), preset()],
        activePrompts: ['english'],
      });

      expect(
        screen.getByRole('button', { name: 'English' }).parentElement,
      ).not.toHaveClass('opacity-50');
    });

    it('saves a pending edit when the badge editor closes', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'English' }));
      await user.type(screen.getByLabelText('Name'), '!');
      await user.keyboard('{Escape}');

      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
      expect(props.onChangePreset).toHaveBeenCalledWith(
        'english',
        expect.objectContaining({ name: 'English!' }),
      );
    });

    it('lists the library in the manager', async () => {
      const user = userEvent.setup();
      renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'Prompts' }));

      const manager = screen.getByRole('dialog');
      expect(within(manager).getByText('Terse')).toBeInTheDocument();
      expect(within(manager).getByText('English')).toBeInTheDocument();
    });

    it('adds a blank preset from the manager', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'Prompts' }));
      await user.click(screen.getByRole('button', { name: 'New prompt' }));

      expect(props.onAddPreset).toHaveBeenCalledWith(
        expect.objectContaining({ name: '', value: '', location: 'end' }),
      );
    });

    it('saves an edit when the manager row collapses', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'Prompts' }));
      const manager = screen.getByRole('dialog');
      await user.click(within(manager).getByRole('button', { name: /English/u }));
      await user.type(within(manager).getByLabelText('Name'), '!');
      await user.click(within(manager).getByRole('button', { name: /English/u }));

      expect(props.onChangePreset).toHaveBeenCalledWith(
        'english',
        expect.objectContaining({ name: 'English!' }),
      );
    });

    it('drops a preset from the manager', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'Prompts' }));
      const manager = screen.getByRole('dialog');
      await user.click(within(manager).getByRole('button', { name: /English/u }));
      await user.click(within(manager).getByRole('button', { name: 'Delete' }));

      expect(props.onRemovePreset).toHaveBeenCalledWith('english');
    });
  });
});
