'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';

import { AuthProvider } from '@/components/auth/auth-provider';
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
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        // Without this, every colour transition animates during the theme
        // swap and the whole page visibly smears for ~200ms.
        disableTransitionOnChange
      >
        {/* Inside QueryClientProvider: AuthProvider clears the query cache on
            sign-out, so it needs the client. Inside ThemeProvider so the login
            screen is themed like everything else. */}
        <AuthProvider>{children}</AuthProvider>
      </ThemeProvider>

      {process.env.NODE_ENV === 'development' ? (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      ) : null}
    </QueryClientProvider>
  );
}
