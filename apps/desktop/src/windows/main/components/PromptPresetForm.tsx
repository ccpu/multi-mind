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
import { useCallback, useState } from 'react';
import { promptSurface } from './prompt-surface';

const LOCATION_SELECT_OPTIONS = PROMPT_LOCATION_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

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
  onSave: (draft: PromptPresetDraft) => void;
  onRemove: () => void;
  onCancel: () => void;
}

/**
 * The editor behind both a badge and a row in the manager. It works on a draft
 * rather than writing every keystroke back: the settings file is rewritten on
 * save, and an edit started by accident is thrown away by closing the editor.
 *
 * Mount it with `key={preset.id}` so switching to another preset starts a new
 * draft rather than carrying the last one over.
 */
export function PromptPresetForm({
  preset,
  onSave,
  onRemove,
  onCancel,
}: PromptPresetFormProps) {
  const [name, setName] = useState(preset.name);
  const [value, setValue] = useState(preset.value);
  const [location, setLocation] = useState<PromptLocation>(preset.location);
  const [sendOnce, setSendOnce] = useState(preset.sendOnce);
  const [untickOnNewChat, setUntickOnNewChat] = useState(preset.untickOnNewChat);
  const [overrideOthers, setOverrideOthers] = useState(preset.overrideOthers);

  const handleChangeName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    [],
  );

  const handleChangeValue = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value),
    [],
  );

  const handleChangeLocation = useCallback(
    (next: string) => setLocation(next as PromptLocation),
    [],
  );

  const handleSave = useCallback(
    () => onSave({ name, value, location, sendOnce, untickOnNewChat, overrideOthers }),
    [location, name, onSave, overrideOthers, sendOnce, untickOnNewChat, value],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${preset.id}-name`}>Name</Label>
        <Input
          id={`${preset.id}-name`}
          value={name}
          placeholder="Answer in English"
          spellCheck={false}
          onChange={handleChangeName}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${preset.id}-value`}>Text</Label>
        <Textarea
          id={`${preset.id}-value`}
          value={value}
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
          value={location}
          onChange={handleChangeLocation}
        />
      </div>

      <PresetSwitch
        id={`${preset.id}-send-once`}
        label="First message only"
        description="Added to the first message of a chat; the messages after it go without. New Chat adds it again."
        checked={sendOnce}
        onCheckedChange={setSendOnce}
      />

      <PresetSwitch
        id={`${preset.id}-untick-on-new-chat`}
        label="Untick on New Chat"
        description="Stays ticked for this chat only. New Chat unticks it; tick it again to use it in the next chat."
        checked={untickOnNewChat}
        onCheckedChange={setUntickOnNewChat}
      />

      <PresetSwitch
        id={`${preset.id}-override-others`}
        label="Override other prompts"
        description="While this is ticked, it is the only prompt added. The other ticked prompts are greyed out and left out until you untick it."
        checked={overrideOthers}
        onCheckedChange={setOverrideOthers}
      />

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 />
          Delete
        </Button>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
