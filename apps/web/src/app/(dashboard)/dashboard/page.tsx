'use client';

import { motion } from 'framer-motion';
import { CalendarRange, LineChart, Package, Server, Zap } from 'lucide-react';

import { DashboardSearch } from '@/components/products/dashboard-search';
import { Alert } from '@/components/ui/alert';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiHealth, useApiMeta, usePublicStats } from '@/hooks/use-api-status';

const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

/**
 * A headline figure about the data itself.
 *
 * This row used to be Prices recorded, API, Database and Redis — one product
 * metric and three pieces of infrastructure, all at identical weight. That is
 * a monitoring console, not a price tracker. Service health still matters and
 * is still shown, but at the bottom of the page rather than in the row a
 * person reads first.
 */
function Metric({
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
    <div className="lift rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-9 w-28" />
      ) : (
        <p className="mt-3 text-3xl font-semibold tabular-price tracking-tight">{value}</p>
      )}

      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * One dependency's state, deliberately understated.
 *
 * The word carries the state, not the dot. Colour alone would leave a
 * colourblind reader looking at two identical grey circles.
 */
function StatusDot({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`size-1.5 rounded-full ${ok ? 'bg-success' : 'bg-destructive'}`}
        aria-hidden="true"
      />
      <span className="text-xs text-muted-foreground">
        {label} {ok ? 'up' : 'down'}
        {detail ? ` · ${detail}` : ''}
      </span>
    </span>
  );
}

const JOURNEY = [
  { Icon: Package, label: 'Search', body: 'Paste any product link' },
  { Icon: CalendarRange, label: 'Record', body: 'One price, every day' },
  { Icon: LineChart, label: 'Compare', body: 'Amazon against Flipkart' },
  { Icon: Zap, label: 'Decide', body: 'Spot a real discount' },
];

export default function DashboardPage() {
  const meta = useApiMeta();
  const health = useApiHealth();
  const stats = usePublicStats();

  const db = health.data?.dependencies['database'];
  const redis = health.data?.dependencies['redis'];

  // Nothing recorded ever — a genuinely fresh install, not a loading state.
  // Worth distinguishing: the answer is "go and search something", not "wait".
  const isEmpty = stats.data?.observations === 0;

  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={{ animate: { transition: { staggerChildren: 0.05 } } }}
      className="space-y-8"
    >
      {/* --- header ------------------------------------------------------ */}
      <motion.div variants={fadeUp}>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Daily price tracking across Amazon.in and Flipkart.
        </p>
      </motion.div>

      {/* --- the primary action ------------------------------------------ */}
      <motion.div variants={fadeUp}>
        <DashboardSearch />
      </motion.div>

      {/* The API being unreachable is its own state, distinct from an empty
          dashboard — otherwise a backend outage reads as "no data yet". */}
      {meta.isError ? (
        <motion.div variants={fadeUp}>
          <ErrorState error={meta.error} onRetry={() => meta.refetch()} />
        </motion.div>
      ) : (
        <>
          {health.isError ? (
            <motion.div variants={fadeUp}>
              <Alert tone="error" title="Backend unreachable">
                <p>
                  The API is not responding. Start it with{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">pnpm api:dev</code>{' '}
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

          {/* --- what the data says ---------------------------------------- */}
          <motion.div variants={fadeUp} className="grid gap-4 sm:grid-cols-3">
            <Metric
              label="Prices recorded"
              value={stats.data ? stats.data.observations.toLocaleString('en-IN') : '—'}
              hint={
                stats.data
                  ? `across ${stats.data.daysTracking.toLocaleString('en-IN')} day${
                      stats.data.daysTracking === 1 ? '' : 's'
                    }`
                  : undefined
              }
              Icon={LineChart}
              loading={stats.isPending}
            />
            <Metric
              label="Products followed"
              value={stats.data ? stats.data.products.toLocaleString('en-IN') : '—'}
              hint="checked daily, kept permanently"
              Icon={Package}
              loading={stats.isPending}
            />
            <Metric
              label="Marketplaces"
              value="2"
              hint="Amazon.in and Flipkart"
              Icon={Server}
            />
          </motion.div>

          {/* --- what happens next ----------------------------------------- */}
          {/*
            This band replaces a large blank area under the metrics. It is not
            filler: on a fresh install it is the only thing answering "what
            now", and once data exists it still explains what the daily job is
            doing between visits — which is otherwise invisible.
          */}
          <motion.div variants={fadeUp}>
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-sm font-medium">
                {isEmpty ? 'Start tracking a product' : 'How your prices are collected'}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {isEmpty
                  ? 'Nothing has been recorded yet. Paste a product URL above and PriceTrail starts building its price history from today.'
                  : 'Every product searched here is checked once a day and each observation is kept — so the chart keeps growing whether or not anyone is watching.'}
              </p>

              <ol className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                {JOURNEY.map(({ Icon, label, body }) => (
                  <li key={label} className="bg-card p-4">
                    <Icon className="size-4 text-primary" aria-hidden="true" />
                    <p className="mt-2.5 text-sm font-medium">{label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {body}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </motion.div>

          {/* --- service health, subordinate -------------------------------- */}
          <motion.div
            variants={fadeUp}
            className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4"
          >
            <span className="text-xs font-medium text-muted-foreground">System</span>

            {health.isPending ? (
              <Skeleton className="h-4 w-56" />
            ) : (
              <>
                <StatusDot
                  ok={db?.status === 'up'}
                  label="Database"
                  detail={db?.latencyMs !== undefined ? `${db.latencyMs} ms` : undefined}
                />
                <StatusDot
                  ok={redis?.status === 'up'}
                  label="Queue"
                  detail={redis?.latencyMs !== undefined ? `${redis.latencyMs} ms` : undefined}
                />
                {meta.data ? (
                  <span className="text-xs text-muted-foreground">
                    API v{meta.data.apiVersion} · {meta.data.environment}
                  </span>
                ) : null}
              </>
            )}
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
