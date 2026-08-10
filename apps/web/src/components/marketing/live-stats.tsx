/**
 * Real counts from the API, rendered on the marketing page.
 *
 * An async server component, so the numbers are in the HTML rather than
 * appearing after hydration — a figure that pops in a second late reads as
 * less trustworthy than one that was simply there.
 */

interface PublicStats {
  users: number;
  products: number;
  observations: number;
  daysTracking: number;
}

/**
 * Below this many accounts, the user count is not shown at all.
 *
 * "Join 2 users" is worse than saying nothing: an empty room is evidence
 * against the product, and this is the one metric that becomes more persuasive
 * by being withheld until it is real. Above the floor it appears on its own,
 * with no code change.
 */
const USER_COUNT_FLOOR = 50;

async function fetchStats(): Promise<PublicStats | null> {
  const base = process.env['NEXT_PUBLIC_API_URL'];
  if (!base) return null;

  try {
    const res = await fetch(`${base}/api/v1/stats`, {
      // Revalidate hourly. The API caches for five minutes of its own, and
      // these numbers move once a day — there is nothing to gain from asking
      // more often, and a marketing page must not depend on API latency.
      next: { revalidate: 3600 },
      // A free-tier API can cold-start for ~50s. Waiting that long would block
      // the page render, so give up early and render without the row.
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) return null;
    return (await res.json()) as PublicStats;
  } catch {
    // Deliberately silent. The stats row is decoration; the API being asleep
    // must never cost a visitor the landing page.
    return null;
  }
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
        {value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export async function LiveStats() {
  const stats = await fetchStats();

  // No stats, or nothing recorded yet — render nothing rather than a row of
  // zeroes. A zero is a true number that tells a false story.
  if (!stats || stats.observations === 0) return null;

  return (
    <section className="border-t border-border bg-muted/20">
      <div className="mx-auto w-full max-w-7xl px-4 py-14">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {/* Observations leads deliberately: it only ever goes up, and it is
              the number that says "this has been running", which is the claim
              a price tracker actually needs to make. */}
          <Stat
            value={stats.observations.toLocaleString('en-IN')}
            label={`Price${stats.observations === 1 ? '' : 's'} recorded`}
          />
          <Stat
            value={stats.products.toLocaleString('en-IN')}
            label="Products tracked"
          />
          <Stat
            value={stats.daysTracking.toLocaleString('en-IN')}
            label={`Day${stats.daysTracking === 1 ? '' : 's'} of history`}
          />

          {stats.users >= USER_COUNT_FLOOR ? (
            <Stat value={stats.users.toLocaleString('en-IN')} label="Members" />
          ) : (
            <Stat value="2" label="Marketplaces compared" />
          )}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Live figures from our database, updated hourly. Every recorded price
          is an observation we made ourselves — none are estimated.
        </p>
      </div>
    </section>
  );
}
