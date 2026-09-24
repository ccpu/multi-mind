import type { AppSettings } from '@internal/multi-mind';
import { IDLE_MEMORY_TRIM_DELAY_OPTIONS } from '@internal/multi-mind';
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
import { BrowserMemoryOptions } from './BrowserMemoryOptions';

const IDLE_MEMORY_TRIM_DELAY_SELECT_OPTIONS = IDLE_MEMORY_TRIM_DELAY_OPTIONS.map(
  (seconds) => ({
    value: String(seconds),
    label: `${seconds} seconds`,
  }),
);

interface MemoryCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/** Controls the browser startup budget and the live idle-cache trimming policy. */
export function MemoryCard({ settings, onChange }: MemoryCardProps) {
  const handleBrowserMemorySavingChange = useCallback(
    (checked: boolean) => onChange({ browserMemorySaving: checked }),
    [onChange],
  );

  const handleInactiveTrimmingChange = useCallback(
    (checked: boolean) => onChange({ trimInactiveWebviews: checked }),
    [onChange],
  );

  const handleTrimDelayChange = useCallback(
    (value: string) => {
      const seconds = IDLE_MEMORY_TRIM_DELAY_OPTIONS.find(
        (option) => String(option) === value,
      );

      if (seconds !== undefined) {
        onChange({ idleMemoryTrimDelaySeconds: seconds });
      }
    },
    [onChange],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Memory</CardTitle>
        <CardDescription>
          Keep several AI chat sites open while limiting the caches they retain in the
          background.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="browser-memory-saving">Use memory-saving browser mode</Label>
            <span className="text-xs text-muted-foreground">
              On Windows, lowers Chromium&apos;s cache and JavaScript memory budgets.
              Restart Multi Mind after changing this setting.
            </span>
          </div>
          <Switch
            id="browser-memory-saving"
            checked={settings.browserMemorySaving}
            onCheckedChange={handleBrowserMemorySavingChange}
          />
        </div>

        {settings.browserMemorySaving && (
          <BrowserMemoryOptions settings={settings} onChange={onChange} />
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="trim-inactive-webviews">Trim inactive chat sites</Label>
            <span className="text-xs text-muted-foreground">
              On Windows, asks WebView2 to release rebuildable caches when every window
              showing a chat site is inactive.
            </span>
          </div>
          <Switch
            id="trim-inactive-webviews"
            checked={settings.trimInactiveWebviews}
            onCheckedChange={handleInactiveTrimmingChange}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="idle-memory-trim-delay">Trim inactive sites after</Label>
          <Select
            id="idle-memory-trim-delay"
            className="w-36"
            disabled={!settings.trimInactiveWebviews}
            options={IDLE_MEMORY_TRIM_DELAY_SELECT_OPTIONS}
            value={String(settings.idleMemoryTrimDelaySeconds)}
            onChange={handleTrimDelayChange}
          />
        </div>
      </CardContent>
    </Card>
  );
}
