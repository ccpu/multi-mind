import type { AppSettings } from '@internal/multi-mind';
import { Label, Switch } from '@pixpilot/shadcn';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@pixpilot/shadcn-ui';
import { useCallback } from 'react';

interface UpdatesCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/**
 * The switch behind the app's only unprompted network call. A packaged build
 * asks the same question once on its first run; this is where that answer is
 * changed afterwards.
 */
export function UpdatesCard({ settings, onChange }: UpdatesCardProps) {
  const handleToggle = useCallback(
    // Turning the switch is itself an answer, so the first-run question has no
    // reason to come back.
    (checked: boolean) => onChange({ autoUpdate: checked, autoUpdatePrompted: true }),
    [onChange],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>
          Whether Multi Mind looks for a newer release of itself when it starts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="auto-update">Check for updates automatically</Label>
            <span className="text-xs text-muted-foreground">
              Asks GitHub for the latest release on startup and offers to install it.
              Nothing but the version is sent. Switched off, the app makes no network call
              of its own.
            </span>
          </div>
          <Switch
            id="auto-update"
            checked={settings.autoUpdate}
            onCheckedChange={handleToggle}
          />
        </div>
      </CardContent>
    </Card>
  );
}
