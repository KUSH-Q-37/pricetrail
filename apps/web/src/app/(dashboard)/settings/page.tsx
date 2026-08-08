'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { useApiMeta } from '@/hooks/use-api-status';

export default function SettingsPage() {
  const { data, isPending, isError, error, refetch } = useApiMeta();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account and notification preferences arrive with authentication in Phase 5.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connected backend</CardTitle>
          <CardDescription>Live values reported by the API.</CardDescription>
        </CardHeader>
        <CardContent>
          {isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              {[
                ['API version', data?.apiVersion],
                ['Environment', data?.environment],
                ['Timezone', data?.timezone],
                [
                  'Server time',
                  data ? new Date(data.serverTime).toLocaleString() : undefined,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="mt-1 text-sm font-medium">
                    {isPending ? <Skeleton className="h-5 w-32" /> : (value ?? '—')}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
