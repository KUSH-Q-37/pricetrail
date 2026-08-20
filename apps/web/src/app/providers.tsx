'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';

import { AccentProvider } from '@/components/theme/accent';
import { ThemeChrome, ThemeReady } from '@/components/theme/theme-chrome';
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
    <ThemeProvider
      // `data-theme` rather than a class. The palette in globals.css is keyed
      // on the attribute, and an attribute cannot collide with a Tailwind
      // utility the way a bare `.dark` class on <html> can.
      attribute="data-theme"
      themes={['light', 'dark', 'midnight']}
      defaultTheme="system"
      enableSystem
      // Left OFF on purpose. next-themes' version of this stamps a global
      // `* { transition: none }` element during a switch, which would defeat
      // the crossfade this app deliberately wants. The equivalent protection
      // for the FIRST paint is handled by <ThemeReady> above, which is the only
      // case where the flash actually matters.
      disableTransitionOnChange={false}
    >
      <AccentProvider>
        <ThemeReady />
        <ThemeChrome />
        <QueryClientProvider client={queryClient}>
          {children}

          {process.env.NODE_ENV === 'development' ? (
            <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
          ) : null}
        </QueryClientProvider>
      </AccentProvider>
    </ThemeProvider>
  );
}
