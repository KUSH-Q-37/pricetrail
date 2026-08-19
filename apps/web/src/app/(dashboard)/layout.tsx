import type { ReactNode } from 'react';

import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';

/**
 * Dashboard shell.
 *
 * A route group `(dashboard)` rather than a `/dashboard` path segment: the
 * folder organises layout without appearing in the URL. There is no sign-in
 * any more, so nothing here is gated — the shell renders for everyone.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 p-4 sm:p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
