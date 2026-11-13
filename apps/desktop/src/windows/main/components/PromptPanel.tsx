import type {
  PromptEditorKind,
  PromptPreset,
  PromptPresetDraft,
  WebsiteInfo,
} from '@internal/multi-mind';
import type { RefObject } from 'react';
import type { PromptEditorHandle } from '../types/prompt-editor';
import { overridingPrompts, unusedPrompts } from '@internal/multi-mind';
import { Button } from '@pixpilot/shadcn-ui';
import { SendHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import { MarkdownPromptEditor } from './MarkdownPromptEditor';
import { PlainPromptEditor } from './PlainPromptEditor';
import { promptSurface } from './prompt-surface';
import { PromptPresetBar } from './PromptPresetBar';
import { PromptPresetsDialog } from './PromptPresetsDialog';
import { SendToOneButton } from './SendToOneButton';

const PLACEHOLDER = 'Ask every enabled model at once…  (ctrl+enter to send)';

/** Height of one of the stacked buttons (`h-9`), in pixels. */
const BUTTON_HEIGHT = 36;

/** The `gap-2` between the stacked buttons, in pixels. */
const BUTTON_GAP = 8;

/** The panel's own `pt-1` and `pb-2` together, in pixels. */
const PANEL_PADDING = 12;

/**
 * The least height the panel can be dragged or set to, in pixels: the two
 * stacked buttons plus the panel's padding. The preset row and a line of the
 * editor fit beside them.
 */
export const PROMPT_PANEL_MIN_HEIGHT =
  BUTTON_HEIGHT + BUTTON_GAP + BUTTON_HEIGHT + PANEL_PADDING;

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
  /** Ids of the use-once presets already sent in this chat. */
  usedPrompts: readonly string[];
  /** Whether the full list of presets is open; it is opened from the menu. */
  presetsDialogOpen: boolean;
  onPresetsDialogOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  onActivate: () => void;
  onSubmit: () => void;
  /** The open browsers, any one of which a prompt can be sent to on its own. */
  websites: readonly WebsiteInfo[];
  /** Sends the prompt to the one browser picked, and no other. */
  onSubmitTo: (websiteId: string) => void;
  onPreviousPrompt: () => void;
  onNextPrompt: () => void;
  onDismiss: () => void;
  onTogglePreset: (promptId: string) => void;
  /** Lets a used preset go out with one more message in this chat. */
  onReusePreset: (promptId: string) => void;
  onMovePreset: (activeId: string, overId: string) => void;
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
  usedPrompts,
  presetsDialogOpen,
  onPresetsDialogOpenChange,
  onChange,
  onActivate,
  onSubmit,
  websites,
  onSubmitTo,
  onPreviousPrompt,
  onNextPrompt,
  onDismiss,
  onTogglePreset,
  onReusePreset,
  onMovePreset,
  onAddPreset,
  onChangePreset,
  onRemovePreset,
}: PromptPanelProps) {
  // A used preset is not going out, so it cannot leave the others out either.
  const overriding = useMemo(
    () =>
      overridingPrompts(
        unusedPrompts(
          presets.filter((preset) => activePrompts.includes(preset.id)),
          usedPrompts,
        ),
      ),
    [activePrompts, presets, usedPrompts],
  );

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
      className="flex shrink-0 gap-2 bg-background p-2 pt-1"
      style={{ height: `${heightPercent}%`, minHeight: PROMPT_PANEL_MIN_HEIGHT }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <PromptPresetBar
          presets={presets}
          activePrompts={activePrompts}
          usedPrompts={usedPrompts}
          overriding={overriding}
          onToggle={onTogglePreset}
          onReuse={onReusePreset}
          onMove={onMovePreset}
          onAdd={onAddPreset}
          onChange={onChangePreset}
          onRemove={onRemovePreset}
        />

        <div className="flex min-h-0 flex-1">
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
        <SendToOneButton websites={websites} onSubmitTo={onSubmitTo} />
      </div>

      <PromptPresetsDialog
        open={presetsDialogOpen}
        onOpenChange={onPresetsDialogOpenChange}
        presets={presets}
        activePrompts={activePrompts}
        usedPrompts={usedPrompts}
        overriding={overriding}
        onAdd={onAddPreset}
        onToggle={onTogglePreset}
        onReuse={onReusePreset}
        onChange={onChangePreset}
        onRemove={onRemovePreset}
      />
    </div>
  );
}
