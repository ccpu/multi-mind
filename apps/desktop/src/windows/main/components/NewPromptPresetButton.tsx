import type { PromptPreset, PromptPresetDraft } from '@internal/multi-mind';
import { createPromptPreset } from '@internal/multi-mind';
import { Popover, PopoverAnchor, PopoverContent } from '@pixpilot/shadcn-ui';
import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { promptSurface } from './prompt-surface';
import { PromptPresetForm } from './PromptPresetForm';

interface NewPromptPresetButtonProps {
  className: string;
  /** The library, to find the preset just added in once it is saved. */
  presets: readonly PromptPreset[];
  onAdd: (preset: PromptPreset) => void;
  onChange: (promptId: string, draft: PromptPresetDraft) => void;
  onRemove: (promptId: string) => void;
}

/**
 * The `+` at the end of the preset row. It adds a blank preset straight away,
 * so it shows up in the row, and opens its editor beside it: a blank preset
 * has nothing on it worth reading until it is filled in.
 *
 * The button is the popover's anchor rather than its trigger, so a second
 * click while the editor is open starts another preset instead of only closing
 * the first.
 */
export function NewPromptPresetButton({
  className,
  presets,
  onAdd,
  onChange,
  onRemove,
}: NewPromptPresetButtonProps) {
  // The id outlives the popover closing, so an edit still settling when it
  // closes is saved against the right preset.
  const [newId, setNewId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const preset = presets.find((candidate) => candidate.id === newId);

  const handleAdd = useCallback(() => {
    const created = createPromptPreset();

    onAdd(created);
    setNewId(created.id);
    setOpen(true);
  }, [onAdd]);

  const handleChange = useCallback(
    (draft: PromptPresetDraft) => {
      if (newId !== null) {
        onChange(newId, draft);
      }
    },
    [newId, onChange],
  );

  const handleRemove = useCallback(() => {
    if (newId !== null) {
      onRemove(newId);
    }
    setOpen(false);
  }, [newId, onRemove]);

  return (
    <Popover open={open && preset !== undefined} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label="New prompt"
          title="New prompt"
          className={className}
          onClick={handleAdd}
        >
          <Plus className="size-4" />
        </button>
      </PopoverAnchor>

      {preset !== undefined && (
        <PopoverContent {...promptSurface} align="start" className="w-150">
          <PromptPresetForm
            key={preset.id}
            preset={preset}
            onChange={handleChange}
            onRemove={handleRemove}
          />
        </PopoverContent>
      )}
    </Popover>
  );
}
