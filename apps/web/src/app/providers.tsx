'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, type ReactNode } from 'react';

import { getQueryClient } from '@/lib/query-client';

/**
 * `useState` rather than a module-level constant is deliberate.
 *
 * A client created at module scope is instantiated once when the chunk is
 * evaluated. If React suspends and re-renders during hydration, that instance
 * can be discarded and recreated, silently dropping cache. Holding it in state
 * ties its lifetime to the component instance instead.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}

      {process.env.NODE_ENV === 'development' ? (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      ) : null}
    </QueryClientProvider>
  );
}
