import type { AppSettings, PromptEditorKind } from '@internal/multi-mind';
import {
  AUTO_SHRINK_SIZE_OPTIONS,
  PROMPT_EDITOR_OPTIONS,
  TEXTBOX_SIZE_OPTIONS,
} from '@internal/multi-mind';
import { Label, Switch } from '@pixpilot/shadcn';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
} from '@pixpilot/shadcn-ui';
import { useCallback } from 'react';

const TEXTBOX_SIZE_SELECT_OPTIONS = TEXTBOX_SIZE_OPTIONS.map((size) => ({
  value: String(size),
  label: `${size}%`,
}));

const AUTO_SHRINK_SIZE_SELECT_OPTIONS = AUTO_SHRINK_SIZE_OPTIONS.map((size) => ({
  value: String(size),
  label: `${size}%`,
}));

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
  const handleSelectSize = useCallback(
    (value: string) => onChange({ panelButtonSize: Number(value) }),
    [onChange],
  );

  const handleToggleAutoShrink = useCallback(
    (checked: boolean) => onChange({ autoShrink: checked }),
    [onChange],
  );

  const handleSelectAutoShrinkSize = useCallback(
    (value: string) => onChange({ autoShrinkSize: Number(value) }),
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
          height.
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
          <Select
            id="textbox-size"
            className="w-32"
            options={TEXTBOX_SIZE_SELECT_OPTIONS}
            value={String(settings.panelButtonSize)}
            onChange={handleSelectSize}
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
          <Select
            id="auto-shrink-size"
            className="w-32"
            disabled={!settings.autoShrink}
            options={AUTO_SHRINK_SIZE_SELECT_OPTIONS}
            value={String(settings.autoShrinkSize)}
            onChange={handleSelectAutoShrinkSize}
          />
        </div>
      </CardContent>
    </Card>
  );
}
