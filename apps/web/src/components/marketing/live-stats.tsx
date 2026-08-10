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
 * Minimum accounts before the user count is shown.
 *
 * Set to 0 at the owner's request: the count is always displayed. The knob is
 * kept rather than deleted because the reason for it still holds — a small
 * number here reads as evidence against the product, and raising this is the
 * one-line way to hide it again if that becomes a concern.
 */
const USER_COUNT_FLOOR = 0;

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

  // No stats, or no accounts yet — render nothing rather than a zero. A zero
  // is a true number that tells a false story.
  if (!stats || stats.users === 0) return null;

  return (
    <section className="border-t border-border bg-muted/20">
      <div className="mx-auto w-full max-w-7xl px-4 py-14">
        <div className="text-center">
          <p className="text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl">
            {stats.users.toLocaleString('en-IN')}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Registered user{stats.users === 1 ? '' : 's'}
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Live from our database, updated hourly.
        </p>
      </div>
    </section>
  );
}
