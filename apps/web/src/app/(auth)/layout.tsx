import { TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Auth route group — no sidebar, no header, no protection. A separate route
 * group rather than a nested layout so these pages never mount the dashboard
 * chrome or its authenticated queries.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <TrendingUp className="size-6 text-primary" aria-hidden="true" />
        <span className="text-lg font-semibold tracking-tight">PriceTrail</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
