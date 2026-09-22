import type { SettingsFileConflictChoice } from '@internal/multi-mind';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useDialog,
} from '@pixpilot/shadcn-ui';

export interface SettingsFileConflictDialogProps {
  /** The folder that already holds a settings file. */
  directory: string;
}

/**
 * Asked when the folder being moved to already holds a settings file. Only one
 * of the two files can survive, and the one already there is just as likely to
 * be the one worth keeping — a second machine pointed at the same synced folder
 * — so each outcome is spelled out and picked by name.
 *
 * Resolves with the chosen side, or null when the user backs out.
 */
export function SettingsFileConflictDialog({
  directory,
}: SettingsFileConflictDialogProps) {
  const modal = useDialog();

  const answer = (choice: SettingsFileConflictChoice | null) => {
    modal.resolve(choice);
    modal.hide().catch((error: unknown) => {
      console.error('Failed to close the settings file dialog:', error);
    });
  };

  return (
    <Dialog
      open={modal.visible}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          answer(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>That folder already has a settings file</DialogTitle>
          <DialogDescription>
            <span className="font-mono break-all">{directory}</span> already has its own{' '}
            <code>settings.json</code>. Only one set of settings can be kept.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Keep those settings</strong> — the app
              starts using the file already in that folder. The settings you are using now
              are discarded.
            </li>
            <li>
              <strong className="text-foreground">Overwrite them</strong> — the settings
              you are using now are written over that file. The settings in that folder
              are lost.
            </li>
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => answer(null)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => answer('adopt')}>
            Keep those settings
          </Button>
          <Button variant="destructive" onClick={() => answer('replace')}>
            Overwrite them
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
