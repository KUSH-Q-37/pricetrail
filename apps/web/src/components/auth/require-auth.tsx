'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Client-side route protection for the dashboard.
 *
 * IMPORTANT: this is a UX affordance, not a security boundary. It stops a
 * signed-out visitor from seeing an empty shell — it does not protect data.
 * Every protected byte comes from the API, which authenticates each request
 * independently via JwtAuthGuard. Bypassing this component in devtools reveals
 * an empty layout and a page of 401s.
 *
 * The redirect fires from an effect rather than during render because
 * navigating while rendering is a React error, and because `isLoading` must
 * settle first — redirecting during session restore would bounce every
 * legitimate reload to /login.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Preserve the destination so sign-in can return the user there.
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <span className="sr-only">Checking your session…</span>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // The effect above is already redirecting; render nothing rather than a
    // flash of protected chrome.
    return null;
  }

  return <>{children}</>;
}
