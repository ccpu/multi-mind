import type { AppSettings, PromptEditorKind, PromptSizeKey } from '@internal/multi-mind';
import type { ChangeEvent } from 'react';
import {
  clampPromptSize,
  PROMPT_EDITOR_OPTIONS,
  PROMPT_SIZE_MAX,
  PROMPT_SIZE_MIN,
} from '@internal/multi-mind';
import { Label, Switch } from '@pixpilot/shadcn';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@pixpilot/shadcn-ui';
import { useCallback, useState } from 'react';

const PROMPT_EDITOR_SELECT_OPTIONS = PROMPT_EDITOR_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

interface PromptBoxCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/**
 * The `TexBox Size` menu the WinForms build (and the first Electron port) put
 * in the menu strip. Every setting now lives in this window instead, so the
 * main window's bar is left with the actions.
 */
export function PromptBoxCard({ settings, onChange }: PromptBoxCardProps) {
  const handleChangeSize = useCallback(
    (key: PromptSizeKey, percent: number) => onChange({ [key]: percent }),
    [onChange],
  );

  const handleToggleAutoShrink = useCallback(
    (checked: boolean) => onChange({ autoShrink: checked }),
    [onChange],
  );

  const handleSelectEditor = useCallback(
    (value: string) => onChange({ promptEditor: value as PromptEditorKind }),
    [onChange],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt box</CardTitle>
        <CardDescription>
          How much of the main window the prompt box takes up, as a percentage of its
          height. Drag the bar above the prompt box to set the size it is showing.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="prompt-editor">Editor</Label>
            <span className="text-xs text-muted-foreground">
              Markdown gives the prompt box highlighting, lists that carry on by
              themselves, and the usual formatting shortcuts.
            </span>
          </div>
          <Select
            id="prompt-editor"
            className="w-36"
            options={PROMPT_EDITOR_SELECT_OPTIONS}
            value={settings.promptEditor}
            onChange={handleSelectEditor}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="textbox-size">Text box size</Label>
          <PercentInput
            id="textbox-size"
            sizeKey="panelButtonSize"
            value={settings.panelButtonSize}
            onChange={handleChangeSize}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="auto-shrink">Auto shrink</Label>
            <span className="text-xs text-muted-foreground">
              Collapse the prompt box while it is empty.
            </span>
          </div>
          <Switch
            id="auto-shrink"
            checked={settings.autoShrink}
            onCheckedChange={handleToggleAutoShrink}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="auto-shrink-size">Auto shrink size</Label>
          <PercentInput
            id="auto-shrink-size"
            sizeKey="autoShrinkSize"
            disabled={!settings.autoShrink}
            value={settings.autoShrinkSize}
            onChange={handleChangeSize}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface PercentInputProps {
  id: string;
  sizeKey: PromptSizeKey;
  value: number;
  disabled?: boolean;
  onChange: (key: PromptSizeKey, percent: number) => void;
}

/**
 * A size the splitter also sets. What is typed is kept as typed while the box
 * has focus, so a half-typed number is not overwritten; only a number inside
 * the allowed range is saved, and leaving the box shows the saved size again.
 */
function PercentInput({ id, sizeKey, value, disabled, onChange }: PercentInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const text = event.target.value;
      const percent = Number(text);
      setDraft(text);

      if (
        text.trim() !== '' &&
        Number.isFinite(percent) &&
        percent >= PROMPT_SIZE_MIN &&
        percent <= PROMPT_SIZE_MAX
      ) {
        onChange(sizeKey, clampPromptSize(percent));
      }
    },
    [onChange, sizeKey],
  );

  const handleBlur = useCallback(() => setDraft(null), []);

  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={PROMPT_SIZE_MIN}
      max={PROMPT_SIZE_MAX}
      step={1}
      suffix="%"
      groupClassName="w-32"
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
