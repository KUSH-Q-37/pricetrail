import { Skeleton } from '@/components/ui/skeleton';

/**
 * Streamed while a dashboard route segment resolves.
 *
 * The skeleton mirrors the real layout's dimensions so the page does not jump
 * when content arrives. `aria-busy` + `sr-only` text give screen readers one
 * clear announcement instead of a silent wait.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[104px] rounded-xl" />
        ))}
      </div>

      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
