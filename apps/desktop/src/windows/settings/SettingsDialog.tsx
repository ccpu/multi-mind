import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ThemeModeToggleButton,
} from '@internal/ui';
import { DataFolderCard } from './components/DataFolderCard';
import { MemoryCard } from './components/MemoryCard';
import { PromptBoxCard } from './components/PromptBoxCard';
import { UpdatesCard } from './components/UpdatesCard';
import { WebsitesCard } from './components/WebsitesCard';
import { useSettingsStore } from './hooks/useSettingsStore';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Everything the WinForms menu strip could configure, in a dialog over the
 * main window. The main window keeps only the actions — reload, prompt
 * history, layout — and the per-site toggles this dialog decides the contents
 * of. The browsers step aside while it is open, as for any other overlay.
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-3xl">
        <DialogHeader className="flex-row items-center justify-between pr-8">
          <div className="flex flex-col gap-1">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Changes are saved as you make them.</DialogDescription>
          </div>
          <ThemeModeToggleButton />
        </DialogHeader>
        <DialogBody>
          <SettingsCards />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted only while the dialog is open, so the settings are read afresh each
 * time and an edit still settling is flushed when it closes.
 */
function SettingsCards() {
  const { settings, update } = useSettingsStore();

  return (
    <div className="flex flex-col gap-6">
      <PromptBoxCard settings={settings} onChange={update} />
      <WebsitesCard settings={settings} onChange={update} />
      <MemoryCard settings={settings} onChange={update} />
      <UpdatesCard settings={settings} onChange={update} />
      <DataFolderCard />
    </div>
  );
}
