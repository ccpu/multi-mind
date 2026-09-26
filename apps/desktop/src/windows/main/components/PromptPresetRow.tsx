import type { PromptPreset, PromptPresetDraft } from '@internal/multi-mind';
import { PROMPT_LOCATION_OPTIONS, promptPresetLabel } from '@internal/multi-mind';
import { Checkbox, cn } from '@pixpilot/shadcn';
import { ChevronRight } from 'lucide-react';
import { useCallback } from 'react';
import { OverriddenTooltip } from './OverriddenTooltip';
import { PromptPresetForm } from './PromptPresetForm';

interface PromptPresetRowProps {
  preset: PromptPreset;
  checked: boolean;
  /** The ticked presets leaving this one out; empty when nothing does. */
  overriddenBy: readonly PromptPreset[];
  expanded: boolean;
  onToggleExpanded: (promptId: string) => void;
  onToggle: (promptId: string) => void;
  onChange: (promptId: string, draft: PromptPresetDraft) => void;
  onRemove: (promptId: string) => void;
}

function locationLabel(preset: PromptPreset): string {
  return (
    PROMPT_LOCATION_OPTIONS.find((option) => option.value === preset.location)?.label ??
    ''
  );
}

/** One preset in the manager: a row that opens into its own editor. */
export function PromptPresetRow({
  preset,
  checked,
  overriddenBy,
  expanded,
  onToggleExpanded,
  onToggle,
  onChange,
  onRemove,
}: PromptPresetRowProps) {
  const label = promptPresetLabel(preset);

  const handleToggleExpanded = useCallback(
    () => onToggleExpanded(preset.id),
    [onToggleExpanded, preset.id],
  );

  const handleToggle = useCallback(() => onToggle(preset.id), [onToggle, preset.id]);

  const handleChange = useCallback(
    (draft: PromptPresetDraft) => onChange(preset.id, draft),
    [onChange, preset.id],
  );

  const handleRemove = useCallback(() => onRemove(preset.id), [onRemove, preset.id]);

  return (
    <li className="overflow-hidden rounded-md border bg-card">
      <OverriddenTooltip overriddenBy={overriddenBy}>
        <div
          className={cn(
            'flex items-center gap-2 p-2',
            overriddenBy.length > 0 && 'opacity-50',
          )}
        >
          <Checkbox
            checked={checked}
            aria-label={`Use ${label}`}
            onCheckedChange={handleToggle}
          />

          <button
            type="button"
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left"
            onClick={handleToggleExpanded}
          >
            <ChevronRight
              className={cn(
                'size-4 shrink-0 transition-transform',
                expanded && 'rotate-90',
              )}
            />
            <span className="shrink-0 text-sm font-medium">{label}</span>
            <span className="truncate text-xs text-muted-foreground">
              {preset.value === '' ? locationLabel(preset) : preset.value}
            </span>
          </button>
        </div>
      </OverriddenTooltip>

      {expanded && (
        <div className="border-t bg-muted/40 p-3">
          <PromptPresetForm
            key={preset.id}
            preset={preset}
            onChange={handleChange}
            onRemove={handleRemove}
          />
        </div>
      )}
    </li>
  );
}
