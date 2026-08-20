import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * Loading placeholder.
 *
 * `aria-hidden` matters: without it a screen reader announces a stack of empty
 * boxes. The live region announcing "Loading…" is the container's job, not each
 * individual shimmer's.
 *
 * A TRAVELLING sheen rather than the opacity pulse this used to have. The
 * difference is not decorative: a pulse fades the whole block in and out, which
 * at a glance is hard to tell from a block that has finished loading and simply
 * has nothing in it. A highlight sweeping left to right can only be motion, so
 * it reads unambiguously as "still working".
 *
 * `overflow-hidden` is required, not tidiness — the sheen is an inset
 * pseudo-element translated past its own bounds, and without clipping it paints
 * over whatever sits beside the skeleton.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('shimmer overflow-hidden rounded-md bg-muted', className)}
      {...props}
    />
  );
}
