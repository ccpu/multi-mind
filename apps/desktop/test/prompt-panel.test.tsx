import type { PromptPreset } from '@internal/multi-mind';
import type { RefObject } from 'react';
import type { PromptEditorHandle } from '../src/windows/main/types/prompt-editor';
import { render, screen, within } from '@testing-library/react';
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
    onAddPreset: vi.fn(),
    onChangePreset: vi.fn(),
    onRemovePreset: vi.fn(),
    ...overrides,
  };
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

    it('lays the ticked presets out first, so they are the ones that stay on the row', () => {
      renderPanel({ presets, activePrompts: ['terse'] });

      const badges = screen.getAllByRole('button', { name: /English|Terse/u });

      expect(badges.map((badge) => badge.textContent)).toStrictEqual([
        'Terse',
        'English',
      ]);
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
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(props.onChangePreset).toHaveBeenCalledWith('english', {
        name: 'English',
        value: 'Answer in French.',
        location: 'end',
      });
    });

    it('moves a preset to the other side of the prompt from the badge editor', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'English' }));
      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: 'Before the prompt' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(props.onChangePreset).toHaveBeenCalledWith(
        'english',
        expect.objectContaining({ location: 'start' }),
      );
    });

    it('throws an in-place edit away when it is cancelled', async () => {
      const user = userEvent.setup();
      const { props } = renderPanel({ presets });

      await user.click(screen.getByRole('button', { name: 'English' }));
      await user.type(screen.getByLabelText('Name'), '!');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(props.onChangePreset).not.toHaveBeenCalled();
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
