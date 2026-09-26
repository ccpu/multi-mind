import type { PromptPreset, PromptPresetDraft } from '@internal/multi-mind';
import { createPromptPreset, promptOverriddenBy } from '@internal/multi-mind';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pixpilot/shadcn-ui';
import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { promptSurface } from './prompt-surface';
import { PromptPresetRow } from './PromptPresetRow';

interface PromptPresetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: readonly PromptPreset[];
  activePrompts: readonly string[];
  /** The ticked presets leaving every other one out. */
  overriding: readonly PromptPreset[];
  onAdd: (preset: PromptPreset) => void;
  onToggle: (promptId: string) => void;
  onChange: (promptId: string, draft: PromptPresetDraft) => void;
  onRemove: (promptId: string) => void;
}

/**
 * The library behind the prompt box. Everything here is also on the badge row;
 * this is where a preset is added, and where there is room to read the whole
 * list at once.
 */
export function PromptPresetsDialog({
  open,
  onOpenChange,
  presets,
  activePrompts,
  overriding,
  onAdd,
  onToggle,
  onChange,
  onRemove,
}: PromptPresetsDialogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleToggleExpanded = useCallback((promptId: string) => {
    setExpandedId((current) => (current === promptId ? null : promptId));
  }, []);

  const handleAdd = useCallback(() => {
    const preset = createPromptPreset();

    onAdd(preset);
    // A blank preset is only useful open, since there is nothing to read on it
    // yet.
    setExpandedId(preset.id);
  }, [onAdd]);

  const handleRemove = useCallback(
    (promptId: string) => {
      setExpandedId((current) => (current === promptId ? null : current));
      onRemove(promptId);
    },
    [onRemove],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...promptSurface} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prompts</DialogTitle>
          <DialogDescription>
            Ready-made text to tick on above the prompt box. A ticked prompt is added
            before or after whatever you type, as its own setting says.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {presets.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No prompts yet. Add one and it appears above the prompt box.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {presets.map((preset) => (
                <PromptPresetRow
                  key={preset.id}
                  preset={preset}
                  checked={activePrompts.includes(preset.id)}
                  overriddenBy={promptOverriddenBy(preset, overriding)}
                  expanded={expandedId === preset.id}
                  onToggleExpanded={handleToggleExpanded}
                  onToggle={onToggle}
                  onChange={onChange}
                  onRemove={handleRemove}
                />
              ))}
            </ul>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleAdd}>
            <Plus />
            New prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
