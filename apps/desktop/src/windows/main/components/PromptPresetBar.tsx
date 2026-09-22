import type { PromptPreset, PromptPresetDraft } from '@internal/multi-mind';
import { Popover, PopoverContent, PopoverTrigger } from '@pixpilot/shadcn-ui';
import { MoreHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import { useOverflowCount } from '../hooks/useOverflowCount';
import { promptSurface } from './prompt-surface';
import { PromptPresetBadge, PromptPresetBadgeGhost } from './PromptPresetBadge';

interface PromptPresetBarProps {
  presets: readonly PromptPreset[];
  activePrompts: readonly string[];
  onToggle: (promptId: string) => void;
  onChange: (promptId: string, draft: PromptPresetDraft) => void;
  onRemove: (promptId: string) => void;
}

const OVERFLOW_BUTTON_CLASS =
  'text-muted-foreground hover:text-foreground flex h-6 shrink-0 items-center rounded-md border px-1.5';

/**
 * The row of presets over the prompt box. It is one line and stays one line:
 * what does not fit moves into a popover behind a `…` button rather than under
 * a scrollbar. Ticked presets are laid out first, so the ones actually wrapping
 * the prompt are the ones that never end up hidden.
 */
export function PromptPresetBar({
  presets,
  activePrompts,
  onToggle,
  onChange,
  onRemove,
}: PromptPresetBarProps) {
  const ordered = useMemo(() => {
    const checked = (preset: PromptPreset) => activePrompts.includes(preset.id);

    return [...presets.filter(checked), ...presets.filter((p) => !checked(p))];
  }, [activePrompts, presets]);

  const { containerRef, ghostRef, visibleCount } = useOverflowCount(ordered.length);

  const visible = ordered.slice(0, visibleCount);
  const hidden = ordered.slice(visibleCount);

  if (presets.length === 0) {
    return null;
  }

  const badge = (preset: PromptPreset) => (
    <PromptPresetBadge
      key={preset.id}
      preset={preset}
      checked={activePrompts.includes(preset.id)}
      onToggle={onToggle}
      onChange={onChange}
      onRemove={onRemove}
    />
  );

  return (
    <div
      ref={containerRef}
      className="relative flex h-6 shrink-0 items-center gap-1 overflow-hidden"
    >
      {visible.map(badge)}

      {hidden.length > 0 && (
        <Popover>
          <PopoverTrigger
            className={OVERFLOW_BUTTON_CLASS}
            aria-label={`Show ${String(hidden.length)} more prompts`}
          >
            <MoreHorizontal className="size-4" />
          </PopoverTrigger>
          <PopoverContent
            {...promptSurface}
            align="end"
            className="flex w-auto flex-col items-start gap-1"
          >
            {hidden.map(badge)}
          </PopoverContent>
        </Popover>
      )}

      {/*
        The row as it would be if nothing were clipped, which is what says how
        much of it fits. `invisible` rather than `hidden`, because a box with no
        layout has no width to read.
      */}
      <div
        ref={ghostRef}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex w-max items-center gap-1"
      >
        {ordered.map((preset) => (
          <PromptPresetBadgeGhost
            key={preset.id}
            preset={preset}
            checked={activePrompts.includes(preset.id)}
          />
        ))}
        <span className={OVERFLOW_BUTTON_CLASS}>
          <MoreHorizontal className="size-4" />
        </span>
      </div>
    </div>
  );
}
