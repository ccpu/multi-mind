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
 * The folder the app keeps its data in — `settings.json` today, anything else
 * it stores later. Pointing it at a synced folder is the reason this exists, so
 * the folder can be typed as well as picked — a network share is often quicker
 * to paste than to browse to.
 */
export function DataFolderCard() {
  const { location, draft, setDraft, status, busy, browse, save, useDefault } =
    useSettingsLocation();

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    [setDraft],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data folder</CardTitle>
        <CardDescription>
          Where Multi Mind keeps its data, such as <code>settings.json</code>. Moving it
          takes the current data along.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="data-directory">Folder</Label>
          <div className="flex gap-2">
            <Input
              id="data-directory"
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
            {location.directory}
            {location.isDefault && ' (default)'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
