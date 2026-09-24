import type { AppSettings } from '@internal/multi-mind';
import { Label, Switch } from '@pixpilot/shadcn';
import { useCallback } from 'react';

interface BrowserMemoryOptionsProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

interface BrowserMemoryOptionProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function BrowserMemoryOption({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: BrowserMemoryOptionProps) {
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

/** The independently configurable Chromium flags behind memory-saving mode. */
export function BrowserMemoryOptions({ settings, onChange }: BrowserMemoryOptionsProps) {
  const handleBackForwardCacheChange = useCallback(
    (checked: boolean) => onChange({ disableBackForwardCache: checked }),
    [onChange],
  );
  const handleLowEndDeviceModeChange = useCallback(
    (checked: boolean) => onChange({ enableLowEndDeviceMode: checked }),
    [onChange],
  );
  const handleProcessPerSiteChange = useCallback(
    (checked: boolean) => onChange({ processPerSite: checked }),
    [onChange],
  );
  const handleOptimizeForSizeChange = useCallback(
    (checked: boolean) => onChange({ optimizeForSize: checked }),
    [onChange],
  );

  return (
    <div className="ml-4 flex flex-col gap-4 border-l pl-4">
      <BrowserMemoryOption
        id="disable-back-forward-cache"
        label="Disable Back/Forward cache"
        description="Keeps an extra page from staying in memory for browser Back navigation."
        checked={settings.disableBackForwardCache}
        onCheckedChange={handleBackForwardCacheChange}
      />
      <BrowserMemoryOption
        id="enable-low-end-device-mode"
        label="Enable low-end device mode"
        description="Uses Chromium's smaller JavaScript, image, and tile-cache budgets."
        checked={settings.enableLowEndDeviceMode}
        onCheckedChange={handleLowEndDeviceModeChange}
      />
      <BrowserMemoryOption
        id="process-per-site"
        label="Share one renderer per site"
        description="Lets the same chat site reuse its renderer across app windows."
        checked={settings.processPerSite}
        onCheckedChange={handleProcessPerSiteChange}
      />
      <BrowserMemoryOption
        id="optimize-for-size"
        label="Optimise JavaScript for size"
        description="Tells V8 to favour a smaller memory footprint over peak speed."
        checked={settings.optimizeForSize}
        onCheckedChange={handleOptimizeForSizeChange}
      />
    </div>
  );
}
