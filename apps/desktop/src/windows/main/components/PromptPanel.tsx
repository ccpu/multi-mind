import type {
  PromptEditorKind,
  PromptPreset,
  PromptPresetDraft,
} from '@internal/multi-mind';
import type { RefObject } from 'react';
import type { PromptEditorHandle } from '../types/prompt-editor';
import { Button } from '@pixpilot/shadcn-ui';
import { Library, SendHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useThirdClickHandler } from '../hooks/useThirdClickHandler';
import { MarkdownPromptEditor } from './MarkdownPromptEditor';
import { PlainPromptEditor } from './PlainPromptEditor';
import { promptSurface } from './prompt-surface';
import { PromptPresetBar } from './PromptPresetBar';
import { PromptPresetsDialog } from './PromptPresetsDialog';

const PLACEHOLDER = 'Ask every enabled model at once…  (ctrl+enter to send)';

interface PromptPanelProps {
  editorRef: RefObject<PromptEditorHandle | null>;
  /** Which editor the settings window asked for. */
  editor: PromptEditorKind;
  value: string;
  /** Height of `panelBottom` as a percentage of the window, as in the original. */
  heightPercent: number;
  /** The whole prompt library, in the order the badges appear in. */
  presets: readonly PromptPreset[];
  /** Ids of the presets that are wrapping the prompt. */
  activePrompts: readonly string[];
  onChange: (value: string) => void;
  onActivate: () => void;
  onSubmit: () => void;
  onPreviousPrompt: () => void;
  onNextPrompt: () => void;
  onDismiss: () => void;
  onTogglePreset: (promptId: string) => void;
  onAddPreset: (preset: PromptPreset) => void;
  onChangePreset: (promptId: string, draft: PromptPresetDraft) => void;
  onRemovePreset: (promptId: string) => void;
}

/**
 * Port of `panelBottom` from `MainForm.Designer.cs`: a multiline prompt box
 * filling the panel, with the submit button docked to its right. Which editor
 * fills it is a setting; both answer to the same handle, so nothing else in the
 * window has to know which one is there.
 */
export function PromptPanel({
  editorRef,
  editor,
  value,
  heightPercent,
  presets,
  activePrompts,
  onChange,
  onActivate,
  onSubmit,
  onPreviousPrompt,
  onNextPrompt,
  onDismiss,
  onTogglePreset,
  onAddPreset,
  onChangePreset,
  onRemovePreset,
}: PromptPanelProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const openManager = useCallback(() => setManagerOpen(true), []);
  const selectAll = useCallback(() => editorRef.current?.selectAll(), [editorRef]);
  const handleThirdClick = useThirdClickHandler(selectAll);

  /*
   * The gesture is counted on the wrapper rather than on the editor: EasyMDE
   * replaces the textarea with a tree of its own, and only the wrapper is there
   * whichever editor is in use. It is bound here rather than as a prop because
   * the wrapper is an observer of the gesture, not a control in its own right.
   */
  useEffect(() => {
    const element = wrapperRef.current;
    if (element === null) {
      return undefined;
    }

    element.addEventListener('mousedown', handleThirdClick);
    return () => element.removeEventListener('mousedown', handleThirdClick);
  }, [handleThirdClick]);

  const editorProps = {
    value,
    placeholder: PLACEHOLDER,
    onChange,
    onActivate,
    onSubmit,
    onPreviousPrompt,
    onNextPrompt,
    onDismiss,
  };

  return (
    <div
      {...promptSurface}
      className="flex shrink-0 gap-2 border-t bg-background p-2 pt-1"
      style={{ height: `${heightPercent}%` }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <PromptPresetBar
          presets={presets}
          activePrompts={activePrompts}
          onToggle={onTogglePreset}
          onChange={onChangePreset}
          onRemove={onRemovePreset}
        />

        <div ref={wrapperRef} className="flex min-h-0 flex-1">
          {editor === 'plain' ? (
            <PlainPromptEditor ref={editorRef} {...editorProps} />
          ) : (
            <MarkdownPromptEditor ref={editorRef} {...editorProps} />
          )}
        </div>
      </div>

      <div className="flex w-44 shrink-0 flex-col-reverse gap-2">
        <Button className="w-full" onClick={onSubmit}>
          <SendHorizontal />
          Submit
        </Button>
        <Button variant="outline" className="w-full" onClick={openManager}>
          <Library />
          Prompts
        </Button>
      </div>

      <PromptPresetsDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        presets={presets}
        activePrompts={activePrompts}
        onAdd={onAddPreset}
        onToggle={onTogglePreset}
        onChange={onChangePreset}
        onRemove={onRemovePreset}
      />
    </div>
  );
}
