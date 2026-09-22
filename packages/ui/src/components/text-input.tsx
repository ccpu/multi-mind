import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@internal/utils';
import { useId } from 'react';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextInput({ label, className, ...props }: TextInputProps): ReactNode {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        className={cn(
          'h-10 rounded-md border border-input bg-background px-3 text-sm',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}
