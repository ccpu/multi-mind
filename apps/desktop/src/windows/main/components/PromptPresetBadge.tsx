import type { PromptPreset, PromptPresetDraft } from '@internal/multi-mind';
import type { ReactNode } from 'react';
import { promptPresetLabel } from '@internal/multi-mind';
import { Checkbox, cn } from '@pixpilot/shadcn';
import { Popover, PopoverContent, PopoverTrigger } from '@pixpilot/shadcn-ui';
import { useCallback, useState } from 'react';
import { promptSurface } from './prompt-surface';
import { PromptPresetForm } from './PromptPresetForm';

interface BadgeShellProps {
  checked: boolean;
  children: ReactNode;
}

/**
 * The pill itself. The real badge and the one the row is measured with share
 * it, because a measurement is only worth anything if it is of the same box.
 */
function BadgeShell({ checked, children }: BadgeShellProps) {
  return (
    <span
      className={cn(
        'flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs',
        checked
          ? 'border-secondary bg-secondary text-secondary-foreground'
          : 'text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

interface PromptPresetBadgeProps {
  preset: PromptPreset;
  checked: boolean;
  onToggle: (promptId: string) => void;
  onChange: (promptId: string, draft: PromptPresetDraft) => void;
  onRemove: (promptId: string) => void;
}

/**
 * One preset above the prompt box: a tick that decides whether it wraps the
 * prompt, and a name that opens the editor over the badge itself, so a wording
 * can be fixed without leaving the prompt.
 */
export function PromptPresetBadge({
  preset,
  checked,
  onToggle,
  onChange,
  onRemove,
}: PromptPresetBadgeProps) {
  const [open, setOpen] = useState(false);
  const label = promptPresetLabel(preset);

  const handleToggle = useCallback(() => onToggle(preset.id), [onToggle, preset.id]);
  const handleClose = useCallback(() => setOpen(false), []);

  const handleSave = useCallback(
    (draft: PromptPresetDraft) => {
      onChange(preset.id, draft);
      setOpen(false);
    },
    [onChange, preset.id],
  );

  const handleRemove = useCallback(() => {
    onRemove(preset.id);
    setOpen(false);
  }, [onRemove, preset.id]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <BadgeShell checked={checked}>
        <Checkbox
          className="size-3.5"
          checked={checked}
          aria-label={`Use ${label}`}
          onCheckedChange={handleToggle}
        />
        <PopoverTrigger asChild>
          <button type="button" title={`Edit ${label}`} className="max-w-40 truncate">
            {label}
          </button>
        </PopoverTrigger>
      </BadgeShell>

      <PopoverContent {...promptSurface} align="start" className="w-80">
        <PromptPresetForm
          key={preset.id}
          preset={preset}
          onSave={handleSave}
          onRemove={handleRemove}
          onCancel={handleClose}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The badge with nothing behind it, laid out only so the row can be measured.
 * It is hidden from the accessibility tree, so nothing else ever sees it.
 */
export function PromptPresetBadgeGhost({
  preset,
  checked,
}: Pick<PromptPresetBadgeProps, 'checked' | 'preset'>) {
  return (
    <BadgeShell checked={checked}>
      <span className="size-3.5" />
      <span className="max-w-40 truncate">{promptPresetLabel(preset)}</span>
    </BadgeShell>
  );
}
