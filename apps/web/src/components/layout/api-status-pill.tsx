'use client';

import { useApiHealth } from '@/hooks/use-api-status';
import { cn } from '@/lib/utils';

/**
 * Live backend status in the header.
 *
 * Deliberately renders three distinct states rather than collapsing failure
 * into "offline": a 503 with a degraded dependency report is different
 * information from an unreachable API, and during Phases 5-12 that distinction
 * is the fastest way to tell "my code is wrong" from "Docker isn't running".
 */
export function ApiStatusPill() {
  const { data, isPending, isError } = useApiHealth();

  const state = isPending
    ? { label: 'Checking', dot: 'bg-muted-foreground', pulse: true }
    : isError
      ? { label: 'API offline', dot: 'bg-destructive', pulse: false }
      : data?.status === 'ok'
        ? { label: 'Operational', dot: 'bg-success', pulse: false }
        : { label: 'Degraded', dot: 'bg-warning', pulse: false };

  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex"
      title={
        isError
          ? 'Could not reach the API'
          : data
            ? Object.entries(data.dependencies)
                .map(([name, d]) => `${name}: ${d.status}`)
                .join(' · ')
            : undefined
      }
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          state.dot,
          state.pulse && 'animate-pulse',
        )}
        aria-hidden="true"
      />
      {state.label}
    </span>
  );
}
