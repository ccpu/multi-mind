import { AlertToast, Button, toast } from '@pixpilot/shadcn-ui';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

interface DownloadCompleteToastProps {
  path: string;
  onDismiss: () => void;
}

/** Opens the completed download's folder without opening the file itself. */
export function DownloadCompleteToast({ path, onDismiss }: DownloadCompleteToastProps) {
  const showInFolder = () => {
    revealItemInDir(path).then(onDismiss, (error: unknown) => {
      console.error('Failed to show the download in its folder:', error);
      toast.error({ title: 'Could not open download folder', description: path });
    });
  };

  return (
    <AlertToast variant="success" icon onClose={onDismiss}>
      <Button
        variant="ghost"
        className="h-auto w-full min-w-0 flex-col items-start gap-1 p-0 text-left whitespace-normal"
        onClick={showInFolder}
      >
        <span className="font-medium">Download complete</span>
        <span className="w-full text-xs font-normal wrap-anywhere">{path}</span>
        <span className="text-xs underline">Show in folder</span>
      </Button>
    </AlertToast>
  );
}
