import type { DragEndEvent } from '@dnd-kit/core';
import type { PromptPreset, PromptPresetDraft } from '@internal/multi-mind';
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  horizontalListSortingStrategy,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { promptOverriddenBy } from '@internal/multi-mind';
import { Popover, PopoverContent, PopoverTrigger } from '@pixpilot/shadcn-ui';
import { MoreHorizontal } from 'lucide-react';
import { useCallback } from 'react';
import { useOverflowCount } from '../hooks/useOverflowCount';
import { promptSurface } from './prompt-surface';
import { PromptPresetBadge, PromptPresetBadgeGhost } from './PromptPresetBadge';

interface PromptPresetBarProps {
  presets: readonly PromptPreset[];
  activePrompts: readonly string[];
  /** The ticked presets leaving every other one out. */
  overriding: readonly PromptPreset[];
  onToggle: (promptId: string) => void;
  /** Moves the dragged preset to where the one it was dropped on is. */
  onMove: (activeId: string, overId: string) => void;
  onChange: (promptId: string, draft: PromptPresetDraft) => void;
  onRemove: (promptId: string) => void;
}

const OVERFLOW_BUTTON_CLASS =
  'text-muted-foreground hover:text-foreground flex h-6 shrink-0 items-center rounded-md border px-1.5';

/**
 * How far the pointer has to travel before pressing a badge counts as dragging
 * it rather than clicking its tick or its name.
 */
const DRAG_DISTANCE = 4;

const ROW_MODIFIERS = [restrictToHorizontalAxis, restrictToParentElement];
const OVERFLOW_MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];

/**
 * The row of presets over the prompt box. It is one line and stays one line:
 * what does not fit moves into a popover behind a `…` button rather than under
 * a scrollbar. The badges keep the library's order whatever is ticked, and are
 * dragged to change it, in the row and in the popover alike. While a ticked
 * preset overrides the rest, every other badge is greyed out and says so on
 * hover.
 */
export function PromptPresetBar({
  presets,
  activePrompts,
  overriding,
  onToggle,
  onMove,
  onChange,
  onRemove,
}: PromptPresetBarProps) {
  const { containerRef, ghostRef, visibleCount } = useOverflowCount(presets.length);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }),
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (over !== null && active.id !== over.id) {
        onMove(String(active.id), String(over.id));
      }
    },
    [onMove],
  );

  const visible = presets.slice(0, visibleCount);
  const hidden = presets.slice(visibleCount);

  if (presets.length === 0) {
    return null;
  }

  const badge = (preset: PromptPreset) => (
    <PromptPresetBadge
      key={preset.id}
      preset={preset}
      checked={activePrompts.includes(preset.id)}
      overriddenBy={promptOverriddenBy(preset, overriding)}
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={ROW_MODIFIERS}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visible.map((preset) => preset.id)}
          strategy={horizontalListSortingStrategy}
        >
          {visible.map(badge)}
        </SortableContext>
      </DndContext>

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
            {/*
              A context of its own: the popover is a column rather than a row,
              and a badge dragged out of it would have nowhere on screen to go.
            */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={OVERFLOW_MODIFIERS}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={hidden.map((preset) => preset.id)}
                strategy={verticalListSortingStrategy}
              >
                {hidden.map(badge)}
              </SortableContext>
            </DndContext>
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
        {presets.map((preset) => (
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
