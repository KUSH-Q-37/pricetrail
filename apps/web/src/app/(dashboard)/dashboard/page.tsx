'use client';

import { motion } from 'framer-motion';
import { Activity, Database, Package, Server } from 'lucide-react';

import { AddProductDialog } from '@/components/products/add-product-dialog';
import { ProductCard } from '@/components/products/product-card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiHealth, useApiMeta } from '@/hooks/use-api-status';
import { useProducts } from '@/hooks/use-products';

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
  const products = useProducts(1, 6);

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
              label="Products"
              value={products.data ? String(products.data.total) : '—'}
              hint={
                products.data?.total === 0 ? 'Nothing searched yet' : 'Across both platforms'
              }
              Icon={Package}
              loading={products.isPending}
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

          <motion.div variants={fadeUp}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-semibold">Products</h2>
              {products.data ? (
                <Badge variant="secondary">{products.data.total}</Badge>
              ) : null}
            </div>

            {products.isPending ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-44 rounded-xl" />
                ))}
              </div>
            ) : products.isError ? (
              <ErrorState error={products.error} onRetry={() => products.refetch()} />
            ) : products.data.items.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No products yet"
                description="Paste an Amazon or Flipkart product URL. Searching is all it takes — we record today’s price straight away, look for the same product on the other marketplace, and keep checking every day."
                action={<AddProductDialog />}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {products.data.items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
