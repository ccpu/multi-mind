import type { ReactNode } from 'react';
import { cn } from '@internal/utils';

export interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
}

export function Card({ children, className, title, description }: CardProps): ReactNode {
  return (
    <section
      className={cn(
        'rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm',
        className,
      )}
    >
      {title !== undefined && (
        <header className="mb-4">
          <h3 className="text-base font-semibold">{title}</h3>
          {description !== undefined && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
