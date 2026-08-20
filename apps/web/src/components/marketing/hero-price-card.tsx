import type { CSSProperties } from 'react';

/**
 * The hero's visual argument.
 *
 * The right half of the hero used to be empty, and before that it held two
 * blurred colour blobs. Neither said anything. This says the whole thing
 * without the reader touching the paragraph: a sticker price quietly raised, a
 * "40% off" badge that is therefore worth less than it looks, the real floor
 * weeks later — and both marketplaces on one scale, which is the comparison
 * the product exists to make.
 *
 * A server component drawing inline SVG. No chart library, no client
 * JavaScript, present in the HTML a crawler receives. The one animation is a
 * CSS line draw, which works without hydration and stops under
 * prefers-reduced-motion.
 *
 * Every figure is HAND-WRITTEN and the card says so on its face. It illustrates
 * the idea; it is not a claim about a real product. A page whose whole argument
 * is "beware numbers presented without context" cannot itself present invented
 * numbers as observations.
 */

const WIDTH = 520;
const HEIGHT = 118;
const PAD = { top: 12, right: 6, bottom: 12, left: 6 };

/**
 * Ninety days of a familiar Indian marketplace pattern: a long flat stretch, a
 * lift just before a sale, then the "discount" landing near the old baseline —
 * with the genuine floor arriving weeks later.
 */
const FLIPKART = [
  62990, 62990, 61500, 61500, 60990, 60990, 59990, 59990, 58990, 58990,
  57990, 57990, 57990, 59990, 62990, 64990, 66990, 66990, 66990, 64990,
  61990, 58990, 55990, 53990, 52990, 51990, 51990, 50990, 49990, 48990,
  47990, 46990, 45990, 45990,
];

/** The same product on the other marketplace: same shape, its own timing. */
const AMAZON = [
  63990, 63990, 63990, 62490, 62490, 61990, 60490, 60490, 60490, 59490,
  58490, 58490, 59990, 61990, 63990, 65990, 65990, 64490, 62990, 60990,
  59490, 57990, 56490, 54990, 53490, 52990, 51490, 50490, 49990, 49490,
  48990, 48490, 47990, 47499,
];

const ALL = [...FLIPKART, ...AMAZON];
const MIN = Math.min(...ALL);
const MAX = Math.max(...ALL);

const x = (i: number): number =>
  PAD.left + (i / (FLIPKART.length - 1)) * (WIDTH - PAD.left - PAD.right);

const y = (value: number): number => {
  // 10% headroom so the peak and the floor are not pinned to the frame.
  const lo = MIN - (MAX - MIN) * 0.1;
  const hi = MAX + (MAX - MIN) * 0.1;
  return PAD.top + (1 - (value - lo) / (hi - lo)) * (HEIGHT - PAD.top - PAD.bottom);
};

const toPath = (series: number[]): string =>
  series
    .map((value, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)},${y(value).toFixed(1)}`)
    .join(' ');

/** Approximate length, for the draw-in. getTotalLength() is a DOM call. */
const lengthOf = (series: number[]): number =>
  Math.ceil(
    series.reduce((total, value, i) => {
      if (i === 0) return 0;
      return total + Math.hypot(x(i) - x(i - 1), y(value) - y(series[i - 1] as number));
    }, 0),
  );

const inr = (rupees: number): string => `₹${rupees.toLocaleString('en-IN')}`;

const FK_NOW = FLIPKART[FLIPKART.length - 1] as number;
const AZ_NOW = AMAZON[AMAZON.length - 1] as number;
const GAP = AZ_NOW - FK_NOW;

/** One row per marketplace: swatch, name, price. */
function PriceRow({
  name,
  colour,
  price,
  cheapest,
}: {
  name: string;
  colour: string;
  price: number;
  cheapest?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex items-center gap-2">
        {/* The swatch is the legend. Two series always need one, and pairing it
            with the name here means identity is never carried by colour alone
            — which is also what lets the chart itself stay unlabelled. */}
        <span
          className="size-2 shrink-0 rounded-sm"
          style={{ background: colour }}
          aria-hidden="true"
        />
        <span className="text-sm text-muted-foreground">{name}</span>
      </span>

      <span className="flex items-baseline gap-2">
        <span
          className={
            cheapest
              ? 'text-xl font-semibold tabular-price tracking-tight'
              : 'text-sm tabular-price text-muted-foreground'
          }
        >
          {inr(price)}
        </span>
        {cheapest ? (
          <span className="rounded bg-price-down-surface px-1.5 py-0.5 text-[11px] font-medium text-price-down">
            cheapest
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function HeroPriceCard() {
  return (
    <figure className="m-0 w-full">
      {/*
        `border-sweep` is used on exactly one element in the whole product, and
        this is it. A conic highlight travelling around a border is the most
        attention-seeking effect in globals.css; a second one anywhere would
        turn both into wallpaper. `edge-light` is the quieter half — a hairline
        that brightens toward the top, which is what stops the card reading as
        a flat rectangle on the dark themes.
      */}
      <div className="border-sweep edge-light rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-md)]">
        {/* --- product ------------------------------------------------------ */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Wireless headphones</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              90 days of daily observations
            </p>
          </div>

          {/* The claim, stated the way the marketplace states it. */}
          <span className="shrink-0 rounded-md bg-price-up-surface px-2 py-1 text-xs font-medium text-price-up">
            &ldquo;40% off&rdquo;
          </span>
        </div>

        {/* --- both marketplaces -------------------------------------------- */}
        <div className="mt-4 space-y-2 border-y border-border py-3">
          <PriceRow
            name="Flipkart"
            colour="var(--chart-flipkart)"
            price={FK_NOW}
            cheapest
          />
          <PriceRow name="Amazon.in" colour="var(--chart-amazon)" price={AZ_NOW} />
        </div>

        {/* Arrow AND sign, so movement survives without colour. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1 rounded-md bg-price-down-surface px-1.5 py-0.5 text-xs font-medium tabular-price text-price-down">
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
          <span className="text-xs text-muted-foreground tabular-price">
            {inr(GAP)} cheaper on Flipkart today
          </span>
        </div>

        {/* --- chart --------------------------------------------------------- */}
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="mt-4 h-auto w-full overflow-visible"
          role="img"
          aria-label="Ninety days of price history on both marketplaces. Both sat near ₹60,000, rose to about ₹66,000 shortly before a sale, then fell — Flipkart to ₹45,990 and Amazon.in to ₹47,499. The advertised discount was measured against the raised price, and the genuine low came weeks later."
        >
          <defs>
            <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-flipkart)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="var(--chart-flipkart)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Fill under the cheaper series only. Two translucent fills overlap
              into a third colour that means nothing. */}
          <path
            d={`${toPath(FLIPKART)} L ${x(FLIPKART.length - 1).toFixed(1)},${HEIGHT} L ${x(0).toFixed(1)},${HEIGHT} Z`}
            fill="url(#hero-fill)"
          />

          {/* Amazon drawn first so Flipkart — the one the numbers above lead
              with — sits on top where the two lines converge. */}
          <path
            d={toPath(AMAZON)}
            fill="none"
            stroke="var(--chart-amazon)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="chart-line"
            style={{ '--dash': lengthOf(AMAZON) } as CSSProperties}
          />
          <path
            d={toPath(FLIPKART)}
            fill="none"
            stroke="var(--chart-flipkart)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="chart-line"
            style={
              { '--dash': lengthOf(FLIPKART), animationDelay: '0.18s' } as CSSProperties
            }
          />

          {/* Two markers, not sixty-eight. The peak is the number the discount
              was measured against; the low is what it actually reached. */}
          <circle
            cx={x(FLIPKART.indexOf(Math.max(...FLIPKART)))}
            cy={y(Math.max(...FLIPKART))}
            r="3.5"
            fill="var(--card)"
            stroke="var(--price-up)"
            strokeWidth="2"
          />
          <circle
            cx={x(FLIPKART.length - 1)}
            cy={y(FK_NOW)}
            r="3.5"
            fill="var(--card)"
            stroke="var(--price-down)"
            strokeWidth="2"
          />
        </svg>

        <p className="mt-3 text-xs text-muted-foreground">
          Lowest recorded{' '}
          <span className="font-medium tabular-price text-price-down">{inr(MIN)}</span> ·
          highest <span className="tabular-price">{inr(MAX)}</span>
        </p>
      </div>

      <figcaption className="mt-2 text-center text-xs text-muted-foreground">
        Illustrative example — not a real product
      </figcaption>
    </figure>
  );
}
