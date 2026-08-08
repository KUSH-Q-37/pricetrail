import type { ReactNode } from 'react';

import { RequireAuth } from '@/components/auth/require-auth';
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';

/**
 * Dashboard shell.
 *
 * A route group `(dashboard)` rather than a `/dashboard` path segment: the
 * folder organises layout without appearing in the URL, so the dashboard can
 * own `/` while the Phase 5 auth pages sit in their own group with no sidebar.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="flex-1 p-4 sm:p-6">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}
