'use client';

import { motion } from 'framer-motion';
import { Activity, Database, Package, Server } from 'lucide-react';

import { AddProductDialog } from '@/components/products/add-product-dialog';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiHealth, usePublicStats, useApiMeta } from '@/hooks/use-api-status';

const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

function StatCard({
  label,
  value,
  hint,
  Icon,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  Icon: typeof Server;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p className="text-2xl font-semibold tabular-price">{value}</p>
        )}
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const meta = useApiMeta();
  const health = useApiHealth();
  const stats = usePublicStats();

  const db = health.data?.dependencies['database'];
  const redis = health.data?.dependencies['redis'];

  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={{ animate: { transition: { staggerChildren: 0.05 } } }}
      className="space-y-6"
    >
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Daily price tracking across Amazon and Flipkart.
          </p>
        </div>
        <AddProductDialog />
      </motion.div>

      {/* The API being unreachable is its own state, distinct from an empty
          dashboard — otherwise a backend outage looks like "no data yet". */}
      {meta.isError ? (
        <motion.div variants={fadeUp}>
          <ErrorState error={meta.error} onRetry={() => meta.refetch()} />
        </motion.div>
      ) : (
        <>
          <motion.div
            variants={fadeUp}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <StatCard
              label="Prices recorded"
              value={stats.data ? stats.data.observations.toLocaleString('en-IN') : '—'}
              hint={
                stats.data?.observations === 0
                  ? 'Nothing searched yet'
                  : `over ${stats.data?.daysTracking ?? 0} day${stats.data?.daysTracking === 1 ? '' : 's'}`
              }
              Icon={Package}
              loading={stats.isPending}
            />
            <StatCard
              label="API"
              value={meta.data ? `v${meta.data.apiVersion}` : '—'}
              hint={meta.data?.environment}
              Icon={Server}
              loading={meta.isPending}
            />
            <StatCard
              label="Database"
              value={db ? db.status : '—'}
              hint={db?.latencyMs !== undefined ? `${db.latencyMs} ms` : undefined}
              Icon={Database}
              loading={health.isPending}
            />
            <StatCard
              label="Redis"
              value={redis ? redis.status : '—'}
              hint={
                redis?.latencyMs !== undefined ? `${redis.latencyMs} ms` : undefined
              }
              Icon={Activity}
              loading={health.isPending}
            />
          </motion.div>

          {health.isError ? (
            <motion.div variants={fadeUp}>
              <Alert tone="error" title="Backend unreachable">
                <p>
                  The API is not responding. Start it with{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    pnpm api:dev
                  </code>{' '}
                  and confirm Docker is running.
                </p>
              </Alert>
            </motion.div>
          ) : health.data?.status === 'degraded' ? (
            <motion.div variants={fadeUp}>
              <Alert tone="warning" title="Some dependencies are down">
                <p>Price tracking will not run until these recover.</p>
              </Alert>
            </motion.div>
          ) : null}

        </>
      )}
    </motion.div>
  );
}
