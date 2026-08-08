import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

/**
 * The "nothing here yet" state.
 *
 * Kept as a first-class component because empty is a *normal* state in this
 * product, not an edge case — a new account has no tracked products, and a
 * filtered list legitimately returns nothing. Treating it as an afterthought
 * is how users end up staring at a blank panel wondering if it broke.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border',
        'px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-4 rounded-full bg-muted p-3">
        <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <p className="mb-5 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
