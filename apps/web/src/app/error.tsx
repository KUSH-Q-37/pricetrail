'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

/**
 * Route-level error boundary.
 *
 * Next requires this to be a client component. It catches render-time crashes,
 * not fetch failures — TanStack Query surfaces those through `isError` so a
 * failed request degrades one card instead of blanking the page.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Phase 14 forwards this to Sentry.
    console.error('Unhandled render error:', error);
  }, [error]);

  const reference =
    error instanceof ApiError ? error.correlationId : error.digest;

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {error instanceof ApiError
          ? error.userMessage
          : 'An unexpected error occurred while rendering this page.'}
      </p>
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
      {reference ? (
        <p className="font-mono text-[11px] text-muted-foreground/70">
          Reference: {reference}
        </p>
      ) : null}
    </div>
  );
}
