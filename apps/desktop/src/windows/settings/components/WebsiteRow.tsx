import type { WebsiteInfo } from '@internal/multi-mind';
import type { ChangeEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getWebsiteSeed, resolveWebsite } from '@internal/multi-mind';
import { cn, Label, Switch } from '@pixpilot/shadcn';
import { Button, Input, showConfirmDialog } from '@pixpilot/shadcn-ui';
import { ChevronRight, GripVertical, Trash2 } from 'lucide-react';
import { useCallback } from 'react';

type WebsitePatch = Partial<Omit<WebsiteInfo, 'id'>>;

interface WebsiteRowProps {
  website: WebsiteInfo;
  expanded: boolean;
  onToggleExpanded: (websiteId: string) => void;
  onChange: (websiteId: string, patch: WebsitePatch) => void;
  onRemove: (websiteId: string) => void;
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  className?: string;
  onChange: (value: string) => void;
}

function Field({ id, label, value, placeholder, className, onChange }: FieldProps) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    [onChange],
  );

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={handleChange}
      />
    </div>
  );
}

/**
 * One site in the catalogue: a draggable row that opens into its own editor.
 * The switch in the row is the `enabled` flag, which is what decides whether the
 * site gets a toggle in the main window's menu bar at all.
 *
 * A seeded site gets a second switch inside the editor. With it on the site
 * follows the definition that ships with the app and the fields are hidden
 * altogether; what the user had typed stays in the settings file and comes
 * back, fields and all, the moment the switch goes off.
 */
export function WebsiteRow({
  website,
  expanded,
  onToggleExpanded,
  onChange,
  onRemove,
}: WebsiteRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: website.id });

  const label = website.name === '' ? 'Untitled site' : website.name;
  const seeded = getWebsiteSeed(website.id) !== null;
  const shown = resolveWebsite(website);
  const followsDefaults = seeded && website.useDefaults;

  const handleToggleExpanded = useCallback(
    () => onToggleExpanded(website.id),
    [onToggleExpanded, website.id],
  );

  const handleToggleEnabled = useCallback(
    (checked: boolean) => onChange(website.id, { enabled: checked }),
    [onChange, website.id],
  );

  const handleToggleUseDefaults = useCallback(
    (checked: boolean) => onChange(website.id, { useDefaults: checked }),
    [onChange, website.id],
  );

  const handleChangeName = useCallback(
    (name: string) => onChange(website.id, { name }),
    [onChange, website.id],
  );

  const handleChangeUrl = useCallback(
    (url: string) => onChange(website.id, { url }),
    [onChange, website.id],
  );

  const handleChangeInputSelector = useCallback(
    (inputSelector: string) => onChange(website.id, { inputSelector }),
    [onChange, website.id],
  );

  const handleChangeButtonSelector = useCallback(
    (buttonSelector: string) => onChange(website.id, { buttonSelector }),
    [onChange, website.id],
  );

  const handleRemove = useCallback(() => {
    showConfirmDialog({
      title: `Remove ${label}?`,
      description: 'The site is dropped from the catalogue and from the menu bar.',
      confirmText: 'Remove',
      variant: 'destructive',
      onConfirm: () => onRemove(website.id),
    }).catch((error: unknown) => {
      console.error('Failed to confirm the removal:', error);
    });
  }, [label, onRemove, website.id]);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'overflow-hidden rounded-md border bg-card',
        isDragging && 'relative z-10 shadow-lg',
      )}
    >
      <div className="flex items-center gap-1 p-2">
        <button
          type="button"
          aria-label={`Reorder ${label}`}
          className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>

        <button
          type="button"
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left"
          onClick={handleToggleExpanded}
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <span className="shrink-0 text-sm font-medium">{shown.name}</span>
          <span className="truncate text-xs text-muted-foreground">{shown.url}</span>
        </button>

        <Switch
          aria-label={`Enable ${label}`}
          checked={website.enabled}
          onCheckedChange={handleToggleEnabled}
        />
      </div>

      {expanded && (
        <div className="grid gap-3 border-t bg-muted/40 p-3 sm:grid-cols-2">
          {seeded && (
            <div className="flex items-start justify-between gap-4 sm:col-span-2">
              <div className="flex flex-col gap-0.5">
                <div className="mb-0.5 flex items-center gap-2">
                  <Switch
                    id={`${website.id}-use-defaults`}
                    checked={website.useDefaults}
                    onCheckedChange={handleToggleUseDefaults}
                  />
                  <Label htmlFor={`${website.id}-use-defaults`}>
                    Use the built-in settings
                  </Label>
                </div>
                <span className="text-xs text-muted-foreground">
                  Follows the definition that ships with the app, so a selector fixed in
                  an update arrives on its own. Anything typed here is kept, and the
                  fields come back when this is off.
                </span>
              </div>
            </div>
          )}

          {!followsDefaults && (
            <>
              <Field
                id={`${website.id}-name`}
                label="Name"
                value={shown.name}
                placeholder="claude"
                onChange={handleChangeName}
              />
              <Field
                id={`${website.id}-url`}
                label="URL"
                value={shown.url}
                placeholder="https://claude.ai/new"
                onChange={handleChangeUrl}
              />
              <Field
                id={`${website.id}-input-selector`}
                label="Input selector"
                value={shown.inputSelector}
                placeholder="textarea"
                onChange={handleChangeInputSelector}
              />
              <Field
                id={`${website.id}-button-selector`}
                label="Submit button selector"
                value={shown.buttonSelector}
                placeholder='button[type="submit"]'
                onChange={handleChangeButtonSelector}
              />
            </>
          )}

          <div className="sm:col-span-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleRemove}
            >
              <Trash2 />
              Remove site
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
