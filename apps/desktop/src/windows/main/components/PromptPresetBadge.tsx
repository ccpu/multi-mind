import type { PromptPreset, PromptPresetDraft } from '@internal/multi-mind';
import type { ComponentProps } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { promptPresetLabel } from '@internal/multi-mind';
import { Checkbox, cn } from '@pixpilot/shadcn';
import { Popover, PopoverContent, PopoverTrigger } from '@pixpilot/shadcn-ui';
import { useCallback, useState } from 'react';
import { OverriddenTooltip } from './OverriddenTooltip';
import { promptSurface } from './prompt-surface';
import { PromptPresetForm } from './PromptPresetForm';

interface BadgeShellProps extends ComponentProps<'span'> {
  checked: boolean;
  /** Greys the pill out while another preset is leaving it out. */
  overridden?: boolean;
}

/**
 * The pill itself. The real badge and the one the row is measured with share
 * it, because a measurement is only worth anything if it is of the same box.
 * The rest of its props are for the tooltip hung off it.
 */
function BadgeShell({
  checked,
  overridden = false,
  className,
  ...props
}: BadgeShellProps) {
  return (
    <span
      {...props}
      className={cn(
        'flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs',
        checked
          ? 'border-secondary bg-secondary text-secondary-foreground'
          : 'text-muted-foreground',
        overridden && 'opacity-50',
        className,
      )}
    />
  );
}

interface PromptPresetBadgeProps {
  preset: PromptPreset;
  checked: boolean;
  /** The ticked presets leaving this one out; empty when nothing does. */
  overriddenBy: readonly PromptPreset[];
  onToggle: (promptId: string) => void;
  onChange: (promptId: string, draft: PromptPresetDraft) => void;
  onRemove: (promptId: string) => void;
}

/**
 * One preset above the prompt box: a tick that decides whether it wraps the
 * prompt, and a name that opens the editor over the badge itself, so a wording
 * can be fixed without leaving the prompt. Dragging it reorders the library.
 * It has to sit inside the bar's `SortableContext`.
 */
export function PromptPresetBadge({
  preset,
  checked,
  overriddenBy,
  onToggle,
  onChange,
  onRemove,
}: PromptPresetBadgeProps) {
  const [open, setOpen] = useState(false);
  const label = promptPresetLabel(preset);

  const handleToggle = useCallback(() => onToggle(preset.id), [onToggle, preset.id]);

  const handleChange = useCallback(
    (draft: PromptPresetDraft) => onChange(preset.id, draft),
    [onChange, preset.id],
  );

  const handleRemove = useCallback(() => {
    onRemove(preset.id);
    setOpen(false);
  }, [onRemove, preset.id]);

  /*
   * The whole pill is the drag source, with no handle of its own. The tick
   * and the name are still plain clicks: the bar's sensor only starts a drag
   * once the pointer has moved, and swallows the click that ends one.
   */
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: preset.id,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <OverriddenTooltip overriddenBy={overriddenBy}>
        <BadgeShell
          ref={setNodeRef}
          {...listeners}
          checked={checked}
          overridden={overriddenBy.length > 0}
          style={{ transform: CSS.Translate.toString(transform), transition }}
          className={cn(
            'cursor-grab',
            isDragging && 'relative z-10 cursor-grabbing shadow-md',
          )}
        >
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
      </OverriddenTooltip>

      <PopoverContent {...promptSurface} align="start" className="w-80">
        <PromptPresetForm
          key={preset.id}
          preset={preset}
          onChange={handleChange}
          onRemove={handleRemove}
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
