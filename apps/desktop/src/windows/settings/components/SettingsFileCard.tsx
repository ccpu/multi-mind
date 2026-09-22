import type { ChangeEvent } from 'react';
import { cn, Label } from '@pixpilot/shadcn';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@pixpilot/shadcn-ui';
import { FolderOpen, RotateCcw, Save } from 'lucide-react';
import { useCallback } from 'react';
import { useSettingsLocation } from '../hooks/useSettingsLocation';

/**
 * Where `settings.json` is kept. Pointing it at a synced folder is the reason
 * this exists, so the folder can be typed as well as picked — a network share
 * is often quicker to paste than to browse to.
 */
export function SettingsFileCard() {
  const { location, draft, setDraft, status, busy, browse, save, useDefault } =
    useSettingsLocation();

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    [setDraft],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings file</CardTitle>
        <CardDescription>
          The folder holding <code>settings.json</code>. Moving it takes the current
          settings along.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-directory">Folder</Label>
          <div className="flex gap-2">
            <Input
              id="settings-directory"
              value={draft}
              spellCheck={false}
              placeholder="D:\Multi Mind"
              className="flex-1 font-mono text-xs"
              onChange={handleChange}
            />
            <Button variant="outline" disabled={busy} onClick={browse}>
              <FolderOpen />
              Browse
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button disabled={busy} onClick={save}>
            <Save />
            Save location
          </Button>
          {location !== null && !location.isDefault && (
            <Button variant="ghost" disabled={busy} onClick={useDefault}>
              <RotateCcw />
              Use default
            </Button>
          )}
        </div>

        {status !== null && (
          <p
            role="status"
            className={cn(
              'text-xs',
              status.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {status.message}
          </p>
        )}

        {location !== null && (
          <p className="font-mono text-xs break-all text-muted-foreground">
            {location.filePath}
            {location.isDefault && ' (default)'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
