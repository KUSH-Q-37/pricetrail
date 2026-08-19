/**
 * The hero's visual argument.
 *
 * The right half of the hero used to be empty, and before that it held two
 * blurred colour blobs. Neither said anything. This says the whole thing
 * without the reader touching the paragraph: a sticker price that was quietly
 * raised, a "40% off" badge that is therefore worth less than it looks, and
 * the real floor the product has actually reached.
 *
 * A server component drawing inline SVG — no chart library, no client
 * JavaScript, present in the HTML a crawler receives. The one animation is a
 * CSS line draw, which works without hydration and stops under
 * prefers-reduced-motion.
 *
 * Every figure here is HAND-WRITTEN and the card says so on its face. It is an
 * illustration of the idea, not a claim about a real product, and a page whose
 * whole argument is "beware numbers presented without context" cannot itself
 * present invented numbers as observations.
 */

const WIDTH = 520;
const HEIGHT = 132;
const PAD = { top: 14, right: 8, bottom: 14, left: 8 };

/**
 * Ninety days of a familiar Indian marketplace pattern: a long flat stretch,
 * a lift just before a sale, then the "discount" that lands near the old
 * baseline — with the genuine floor arriving weeks later.
 */
const SERIES = [
  62990, 62990, 62990, 61500, 61500, 60990, 60990, 60990, 59990, 59990,
  59990, 58990, 58990, 58990, 57990, 57990, 57990, 59990, 62990, 64990,
  66990, 66990, 66990, 66990, 64990, 61990, 58990, 55990, 53990, 52990,
  52990, 51990, 51990, 50990, 49990, 49990, 48990, 47990, 46990, 45990,
];

const MIN = Math.min(...SERIES);
const MAX = Math.max(...SERIES);

const x = (i: number): number =>
  PAD.left + (i / (SERIES.length - 1)) * (WIDTH - PAD.left - PAD.right);

const y = (value: number): number => {
  // 12% headroom so the peak and the floor are not pinned to the frame.
  const lo = MIN - (MAX - MIN) * 0.12;
  const hi = MAX + (MAX - MIN) * 0.12;
  return PAD.top + (1 - (value - lo) / (hi - lo)) * (HEIGHT - PAD.top - PAD.bottom);
};

const linePath = SERIES.map(
  (value, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)},${y(value).toFixed(1)}`,
).join(' ');

/** Same path, closed to the baseline, for the fill beneath the line. */
const areaPath = `${linePath} L ${x(SERIES.length - 1).toFixed(1)},${HEIGHT} L ${x(0).toFixed(1)},${HEIGHT} Z`;

/** Approximate length, for the draw-in. getTotalLength() is a DOM call. */
const pathLength = Math.ceil(
  SERIES.reduce((total, value, index) => {
    if (index === 0) return 0;
    return (
      total +
      Math.hypot(x(index) - x(index - 1), y(value) - y(SERIES[index - 1] as number))
    );
  }, 0),
);

const peakIndex = SERIES.indexOf(MAX);
const lowIndex = SERIES.lastIndexOf(MIN);

const inr = (paise: number): string => `₹${paise.toLocaleString('en-IN')}`;

export function HeroPriceCard() {
  return (
    <figure className="m-0 w-full">
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-md)]">
        {/* --- product row ------------------------------------------------ */}
        <div className="flex items-start gap-3">
          {/* A neutral placeholder, not a fake product photo. */}
          <div
            className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-[10px] font-medium text-muted-foreground"
            aria-hidden="true"
          >
            IMG
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Wireless headphones</p>
            <div className="mt-1 flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full"
                style={{ background: 'var(--chart-flipkart)' }}
                aria-hidden="true"
              />
              <span className="text-xs text-muted-foreground">Flipkart</span>
            </div>
          </div>

          {/* The claim, stated as the marketplace states it. */}
          <span className="shrink-0 rounded-md bg-price-up-surface px-2 py-1 text-xs font-medium text-price-up">
            40% off
          </span>
        </div>

        {/* --- prices ------------------------------------------------------ */}
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-semibold tabular-price tracking-tight">
            {inr(SERIES[SERIES.length - 1] as number)}
          </span>
          <span className="text-sm text-muted-foreground line-through tabular-price">
            {inr(MAX)}
          </span>
          {/* Arrow AND sign, so the movement survives without colour. */}
          <span className="inline-flex items-center gap-1 rounded-md bg-price-down-surface px-1.5 py-0.5 text-xs font-medium text-price-down tabular-price">
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
              <path
                d="M6 2 v6 M3 6.5 L6 9.5 L9 6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            −31% in 90 days
          </span>
        </div>

        {/* --- chart ------------------------------------------------------- */}
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="mt-4 h-auto w-full overflow-visible"
          role="img"
          aria-label="Ninety days of price history. The price sat near ₹58,000, rose to ₹66,990 shortly before a sale, then fell to ₹45,990 — so the advertised discount was measured against a raised price, and the genuine low came weeks later."
        >
          <defs>
            <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-flipkart)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--chart-flipkart)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <path d={areaPath} fill="url(#hero-fill)" />

          <path
            d={linePath}
            fill="none"
            stroke="var(--chart-flipkart)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="chart-line"
            style={{ '--dash': pathLength } as React.CSSProperties}
          />

          {/* Two markers, not forty. The peak is the number the discount was
              measured against; the low is what it actually reached. */}
          <circle
            cx={x(peakIndex)}
            cy={y(MAX)}
            r="4"
            fill="var(--card)"
            stroke="var(--price-up)"
            strokeWidth="2"
          />
          <circle
            cx={x(lowIndex)}
            cy={y(MIN)}
            r="4"
            fill="var(--card)"
            stroke="var(--price-down)"
            strokeWidth="2"
          />
        </svg>

        {/* --- footnote ---------------------------------------------------- */}
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">
            Lowest recorded{' '}
            <span className="font-medium text-price-down tabular-price">{inr(MIN)}</span>
          </span>
          <span className="text-xs text-muted-foreground">90 days</span>
        </div>
      </div>

      <figcaption className="mt-2 text-center text-xs text-muted-foreground">
        Illustrative example — not a real product
      </figcaption>
    </figure>
  );
}
