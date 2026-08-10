import type { CSSProperties } from 'react';

/**
 * Illustrative price chart for the landing page.
 *
 * Inline SVG, not ECharts. Three reasons:
 *  - it is a server component, so the visual is in the HTML a crawler or a
 *    reviewer with JavaScript disabled receives
 *  - no chart library is shipped to visitors who have not signed up
 *  - nothing here is real data, so interactivity would imply precision the
 *    figure does not have
 *
 * The real product charts (ECharts, zoom, tooltips, table view) live behind
 * sign-in. Data below is fixed and hand-written — clearly labelled as an
 * example on the page itself.
 */

const WIDTH = 900;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

/** Weekly observations, in rupees. `null` = a day with no recorded price. */
const AMAZON: Array<number | null> = [
  134900, 134900, 133500, 132000, 132000, 129900, 128400, 128400, 126900,
  null, null,
  124900, 124900, 123500, 121900, 119900, 119900, 121500, 121500, 120400,
  118900, 117500, 117500, 116900, 116900,
];

const FLIPKART: Array<number | null> = [
  135900, 134500, 134500, 131900, 130900, 130900, 127900, 127900, 127900,
  126500, 125900, 125900, 124200, 122900, 122900, 120900, 118900, 118900,
  119900, 119900, 118400, 116900, 116900, 115900, 115400,
];

const MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

const all = [...AMAZON, ...FLIPKART].filter((v): v is number => v !== null);
const MIN = Math.min(...all);
const MAX = Math.max(...all);

const x = (i: number, len: number): number =>
  PAD.left + (i / (len - 1)) * (WIDTH - PAD.left - PAD.right);

const y = (value: number): number => {
  // 6% headroom so the extremes are not pinned to the frame.
  const lo = MIN - (MAX - MIN) * 0.06;
  const hi = MAX + (MAX - MIN) * 0.06;
  return PAD.top + (1 - (value - lo) / (hi - lo)) * (HEIGHT - PAD.top - PAD.bottom);
};

/**
 * Build one path per unbroken run.
 *
 * Returning several `d` strings rather than one is what makes a gap render as
 * a gap — a single path would join the points either side of the null and draw
 * a confident line across a period with no data.
 */
function toSegments(series: Array<number | null>): string[] {
  const segments: string[] = [];
  let current: string[] = [];

  series.forEach((value, index) => {
    if (value === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    const point = `${x(index, series.length).toFixed(1)},${y(value).toFixed(1)}`;
    current.push(current.length === 0 ? `M ${point}` : `L ${point}`);
  });

  if (current.length > 1) segments.push(current.join(' '));
  return segments;
}

const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => MIN + (MAX - MIN) * t);

/**
 * Approximate rendered length of a path, by summing its segment distances.
 *
 * The draw-in animation needs stroke-dasharray to equal the line's length, and
 * getTotalLength() is a DOM call this server component cannot make. Summing
 * straight segments is exact here, because these paths are polylines.
 */
function pathLength(d: string): number {
  const points = [...d.matchAll(/[ML] ([\d.]+),([\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);

  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i - 1] as [number, number];
    const [x2, y2] = points[i] as [number, number];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return Math.ceil(total);
}

export function SamplePriceChart() {
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Example price chart showing Amazon and Flipkart prices for an iPhone 15 Pro falling from about ₹1,35,900 to about ₹1,15,400 over six months, with a short gap in the Amazon line where no price was recorded."
      >
        {/* Solid hairlines, one shade off the surface. Dashed grid reads as a
            threshold or projection when it is only a grid. */}
        {gridLines.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 10}
              y={y(value) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--muted-foreground)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {`₹${Math.round(value / 1000)}k`}
            </text>
          </g>
        ))}

        {MONTHS.map((month, index) => (
          <text
            key={month}
            x={x(index * ((AMAZON.length - 1) / (MONTHS.length - 1)), AMAZON.length)}
            y={HEIGHT - 8}
            textAnchor="middle"
            fontSize="11"
            fill="var(--muted-foreground)"
          >
            {month}
          </text>
        ))}

        {/* Offset by 220ms so these read as two lines being drawn rather than
            one thick one. Flipkart leads because it has no gap, so the eye
            follows an unbroken stroke first. */}
        {toSegments(FLIPKART).map((d, i) => (
          <path
            key={`fk-${i}`}
            d={d}
            fill="none"
            stroke="var(--chart-flipkart)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="chart-line"
            style={
              { '--dash': pathLength(d), animationDelay: `${i * 0.25}s` } as CSSProperties
            }
          />
        ))}

        {toSegments(AMAZON).map((d, i) => (
          <path
            key={`az-${i}`}
            d={d}
            fill="none"
            stroke="var(--chart-amazon)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="chart-line"
            style={
              {
                '--dash': pathLength(d),
                animationDelay: `${0.22 + i * 0.25}s`,
              } as CSSProperties
            }
          />
        ))}
      </svg>
    </figure>
  );
}
