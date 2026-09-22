import type { AppInfo } from '@internal/tauri-api';
import type { ReactNode } from 'react';
import { safeCommands } from '@internal/tauri-api';
import { Card } from '@internal/ui';
import { useEffect, useState } from 'react';

const LABELS: Record<keyof AppInfo, string> = {
  name: 'Product name',
  version: 'Version',
  tauriVersion: 'Tauri',
  platform: 'Platform',
  arch: 'Architecture',
};

export function AppInfoCard(): ReactNode {
  const [info, setInfo] = useState<AppInfo | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    void safeCommands.appInfo().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setInfo(result.value);
      } else {
        setError(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card
      title="Runtime"
      description="Read from the Tauri runtime on the Rust side, not from package.json."
    >
      {error !== '' && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {info === undefined && error === '' && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {info !== undefined && (
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          {Object.entries(LABELS).map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono">{info[key as keyof AppInfo]}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
