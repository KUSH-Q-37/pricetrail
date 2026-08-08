import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * Loading placeholder.
 *
 * `aria-hidden` matters: without it a screen reader announces a stack of empty
 * boxes. The live region announcing "Loading…" is the container's job, not each
 * individual shimmer's.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
