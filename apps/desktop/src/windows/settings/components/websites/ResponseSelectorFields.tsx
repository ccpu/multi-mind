import type { ResponseSelectors } from '@internal/multi-mind';
import type { ChangeEvent } from 'react';
import { Label } from '@pixpilot/shadcn';
import { Input } from '@pixpilot/shadcn-ui';
import { useCallback } from 'react';

interface ResponseSelectorFieldsProps {
  websiteId: string;
  value: ResponseSelectors;
  onChange: (selectors: ResponseSelectors) => void;
}

const fields: readonly {
  key: keyof ResponseSelectors;
  label: string;
  placeholder: string;
}[] = [
  {
    key: 'responseSelector',
    label: 'Assistant response selector',
    placeholder: '[data-message-author-role="assistant"]',
  },
  { key: 'turnSelector', label: 'Response container selector', placeholder: 'article' },
  {
    key: 'busySelector',
    label: 'Generating indicator selector',
    placeholder: 'button[aria-label="Stop generating"]',
  },
  {
    key: 'completeSelector',
    label: 'Finished response action selector',
    placeholder: 'button[aria-label="Copy response"]',
  },
  {
    key: 'userSelector',
    label: 'User message selector (optional)',
    placeholder: '[data-message-author-role="user"]',
  },
  {
    key: 'errorSelector',
    label: 'Response error selector (optional)',
    placeholder: '[role="alert"]',
  },
];

function ResponseSelectorField({
  websiteId,
  value,
  onChange,
  field,
}: ResponseSelectorFieldsProps & { field: (typeof fields)[number] }) {
  const id = `${websiteId}-response-${field.key}`;
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange({ ...value, [field.key]: event.target.value });
    },
    [onChange, value, field.key],
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      <Input
        id={id}
        value={value[field.key] ?? ''}
        placeholder={field.placeholder}
        spellCheck={false}
        onChange={handleChange}
      />
    </div>
  );
}

/** Completion selectors share the site's built-in/custom settings switch and persistence. */
export function ResponseSelectorFields(props: ResponseSelectorFieldsProps) {
  return (
    <div className="grid gap-3 border-t pt-3 sm:col-span-2 sm:grid-cols-2">
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Response completion: identify assistant messages, their enclosing containers, the
        active generation indicator, and a whole-answer action shown when finished. The
        action selector is relative to the response container. Leave a required selector
        empty to disable detection. Changes apply to the next prompt.
      </p>
      {fields.map((field) => (
        <ResponseSelectorField key={field.key} {...props} field={field} />
      ))}
    </div>
  );
}
