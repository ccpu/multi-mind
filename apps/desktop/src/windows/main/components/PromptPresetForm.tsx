import type {
  PromptLocation,
  PromptPreset,
  PromptPresetDraft,
} from '@internal/multi-mind';
import type { Select as SelectComponent } from '@pixpilot/shadcn-ui';
import type { ChangeEvent, ComponentProps } from 'react';
import { PROMPT_LOCATION_OPTIONS } from '@internal/multi-mind';
import { Label, Switch, Textarea } from '@pixpilot/shadcn';
import { Button, Input, Select } from '@pixpilot/shadcn-ui';
import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { promptSurface } from './prompt-surface';

const LOCATION_SELECT_OPTIONS = PROMPT_LOCATION_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));
const AUTO_SAVE_DELAY_MS = 300;

/**
 * The dropdown is portalled to the end of the document like the editors
 * themselves, so it has to say it belongs to the prompt box too. Its props
 * type does not admit data attributes, which the component passes on all the
 * same.
 */
const LOCATION_CONTENT_PROPS = promptSurface as NonNullable<
  ComponentProps<typeof SelectComponent>['contentProps']
>;

interface PresetSwitchProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function PresetSwitch({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: PresetSwitchProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

interface PromptPresetFormProps {
  preset: PromptPreset;
  onChange: (draft: PromptPresetDraft) => void;
  onRemove: () => void;
}

/** Edits a preset from either its badge or the manager, saving changes as they settle. */
export function PromptPresetForm({ preset, onChange, onRemove }: PromptPresetFormProps) {
  const [draft, setDraft] = useState<PromptPresetDraft>(() => ({
    name: preset.name,
    value: preset.value,
    location: preset.location,
    sendOnce: preset.sendOnce,
    untickOnNewChat: preset.untickOnNewChat,
    overrideOthers: preset.overrideOthers,
  }));
  const draftRef = useRef(draft);
  const onChangeRef = useRef(onChange);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onChangeRef.current = onChange;

  const updateDraft = useCallback((patch: Partial<PromptPresetDraft>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);

    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      onChangeRef.current(draftRef.current);
    }, AUTO_SAVE_DELAY_MS);
  }, []);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        onChangeRef.current(draftRef.current);
      }
    },
    [],
  );

  const handleChangeName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => updateDraft({ name: event.target.value }),
    [updateDraft],
  );

  const handleChangeValue = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
      updateDraft({ value: event.target.value }),
    [updateDraft],
  );

  const handleChangeLocation = useCallback(
    (next: string) => updateDraft({ location: next as PromptLocation }),
    [updateDraft],
  );

  const handleChangeSendOnce = useCallback(
    (checked: boolean) => updateDraft({ sendOnce: checked }),
    [updateDraft],
  );

  const handleChangeUntickOnNewChat = useCallback(
    (checked: boolean) => updateDraft({ untickOnNewChat: checked }),
    [updateDraft],
  );

  const handleChangeOverrideOthers = useCallback(
    (checked: boolean) => updateDraft({ overrideOthers: checked }),
    [updateDraft],
  );

  const handleRemove = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    onRemove();
  }, [onRemove]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${preset.id}-name`}>Name</Label>
        <Input
          id={`${preset.id}-name`}
          value={draft.name}
          placeholder="Answer in English"
          spellCheck={false}
          onChange={handleChangeName}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${preset.id}-value`}>Text</Label>
        <Textarea
          id={`${preset.id}-value`}
          value={draft.value}
          rows={4}
          placeholder="Text to add to the prompt"
          onChange={handleChangeValue}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${preset.id}-location`}>Insert at</Label>
        <Select
          id={`${preset.id}-location`}
          contentProps={LOCATION_CONTENT_PROPS}
          options={LOCATION_SELECT_OPTIONS}
          value={draft.location}
          onChange={handleChangeLocation}
        />
      </div>

      <PresetSwitch
        id={`${preset.id}-send-once`}
        label="First message only"
        description="Added to the first message of a chat; the messages after it go without. New Chat adds it again."
        checked={draft.sendOnce}
        onCheckedChange={handleChangeSendOnce}
      />

      <PresetSwitch
        id={`${preset.id}-untick-on-new-chat`}
        label="Untick on New Chat"
        description="Stays ticked for this chat only. New Chat unticks it; tick it again to use it in the next chat."
        checked={draft.untickOnNewChat}
        onCheckedChange={handleChangeUntickOnNewChat}
      />

      <PresetSwitch
        id={`${preset.id}-override-others`}
        label="Override other prompts"
        description="While this is ticked, it is the only prompt added. The other ticked prompts are greyed out and left out until you untick it."
        checked={draft.overrideOthers}
        onCheckedChange={handleChangeOverrideOthers}
      />

      <div className="flex items-center">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={handleRemove}
        >
          <Trash2 />
          Delete
        </Button>
      </div>
    </div>
  );
}
