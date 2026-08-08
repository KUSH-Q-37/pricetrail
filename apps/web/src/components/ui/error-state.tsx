'use client';

import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * Renders a failed query.
 *
 * Two things this does that a naive `{error.message}` does not:
 *
 *  1. Shows `userMessage`, never the raw error. A 500's real message can carry
 *     table names and query fragments.
 *
 *  2. Surfaces the correlation ID. When a user reports "it broke", that string
 *     turns an open-ended investigation into a single log lookup.
 *
 * The retry button is hidden for client-fault errors — re-issuing a request
 * that was rejected as malformed just fails identically.
 */
export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  const apiError = error instanceof ApiError ? error : null;
  const message = apiError?.userMessage ?? 'Something went wrong.';
  const canRetry = onRetry && (!apiError || apiError.isRetryable);

  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center rounded-xl border border-destructive/25 bg-destructive/5 px-6 py-12 text-center ${className ?? ''}`}
    >
      <h3 className="mb-1 font-semibold">Could not load this</h3>
      <p className="mb-4 max-w-sm text-sm text-muted-foreground">{message}</p>

      {canRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Try again
        </Button>
      ) : null}

      {apiError && apiError.correlationId !== 'client-generated' ? (
        <p className="mt-5 font-mono text-[11px] text-muted-foreground/70">
          Reference: {apiError.correlationId}
        </p>
      ) : null}
    </div>
  );
}
