import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BellRing,
  CalendarClock,
  LineChart,
  Link2,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react';

import { LiveStats } from '@/components/marketing/live-stats';
import { Reveal } from '@/components/marketing/reveal';
import { SamplePriceChart } from '@/components/marketing/sample-price-chart';

export const metadata: Metadata = {
  title: 'PriceTrail — Amazon & Flipkart price history for Indian shoppers',
  description:
    'Track daily prices across Amazon.in and Flipkart. See 18 months of price history, compare both marketplaces side by side, and tell a real discount from a reset sticker price.',
};

const STEPS = [
  {
    icon: Link2,
    title: 'Paste a product link',
    body: 'Drop in any amazon.in or flipkart.com product URL. We read the product identity — brand, model, storage, capacity — not just the title.',
  },
  {
    icon: ScanSearch,
    title: 'We find it on the other marketplace',
    body: 'A matching engine compares barcodes, model numbers and specifications. A 128 GB phone is never matched to its 256 GB sibling, and a phone is never matched to its own case.',
  },
  {
    icon: CalendarClock,
    title: 'We record the price every day',
    body: 'One observation per product per day, stored permanently. Over weeks and months that becomes the history a single price tag can never show you.',
  },
];

const FEATURES = [
  {
    icon: LineChart,
    title: 'Up to 18 months of history',
    body: 'Seven days, one month, three, six, a year, or eighteen months — on one chart, with zoom and pan.',
  },
  {
    icon: ShieldCheck,
    title: 'Gaps stay gaps',
    body: 'If we could not read a price on a given day, the line breaks. We never interpolate a number we did not observe.',
  },
  {
    icon: BellRing,
    title: 'Both marketplaces, one axis',
    body: 'Amazon and Flipkart plotted on the same scale, so the comparison is honest rather than a trick of two different axes.',
  },
];

const CATEGORIES = [
  'Smartphones',
  'Laptops',
  'Tablets',
  'Headphones & audio',
  'Televisions',
  'Refrigerators',
  'Washing machines',
  'Air conditioners',
];

export default function LandingPage() {
  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Full viewport height minus the sticky header, so the hero owns the
          first screen. dvh not vh: on mobile, vh ignores the browser chrome
          and pushes the CTAs below the fold. */}
      <section className="relative flex min-h-[calc(100dvh-3.5rem)] w-full items-center overflow-hidden px-4 py-16">
        {/* Decorative only. Sits behind content, ignores pointer events, and
            stops entirely under prefers-reduced-motion. */}
        <div
          className="aurora -left-24 -top-16 size-[420px] bg-[var(--chart-flipkart)]"
          aria-hidden="true"
        />
        <div
          className="aurora -right-16 top-24 size-[360px] bg-[var(--chart-amazon)]"
          style={{ animationDelay: '-9s', animationDuration: '32s' }}
          aria-hidden="true"
        />

        <div className="relative mx-auto w-full max-w-7xl">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
          <span className="live-dot size-1.5 rounded-full bg-success" aria-hidden="true" />
          Tracking Amazon.in and Flipkart daily
        </p>

        <h1 className="max-w-4xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          Is that discount real?
        </h1>

        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          A product showing &ldquo;40% off&rdquo; means nothing on its own — the
          sticker price may have been raised last week. PriceTrail records what
          things <em>actually</em> cost, every day, and charts it so you can see
          the difference between a genuine drop and a marketing number.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Search a product
          </Link>
          <Link
            href="/products"
            className="inline-flex h-11 items-center rounded-md border border-border px-6 text-sm font-medium transition-colors hover:bg-accent"
          >
            Browse all products
          </Link>
        </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-7xl px-4 pb-16">
        <Reveal>
        <div className="lift rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-semibold">Apple iPhone 15 Pro (256 GB)</h2>
              <p className="text-xs text-muted-foreground">
                Illustrative example — six months of daily observations
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 rounded-sm"
                  style={{ background: 'var(--chart-amazon)' }}
                  aria-hidden="true"
                />
                Amazon
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 rounded-sm"
                  style={{ background: 'var(--chart-flipkart)' }}
                  aria-hidden="true"
                />
                Flipkart
              </span>
            </div>
          </div>

          <SamplePriceChart />

          <p className="mt-4 text-xs text-muted-foreground">
            The break in the orange line is a day we could not record a price.
            We show it as a gap rather than drawing a straight line through it.
          </p>
        </div>
        </Reveal>
      </section>

      <LiveStats />

      {/* ---------------------------------------------------------------- */}
      <section className="border-t border-border bg-muted/20">
        <div className="mx-auto w-full max-w-7xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, index) => (
              <Reveal key={title} delay={index * 0.1}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg bg-primary/10">
                    <Icon className="size-4 text-primary" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">
                    Step {index + 1}
                  </span>
                </div>
                <h3 className="font-medium">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-7xl px-4 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Built to be trustworthy
        </h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          A price tracker is only worth using if you can believe the chart.
        </p>

        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, index) => (
            <Reveal key={title} delay={index * 0.1} className="lift rounded-xl border border-border p-5">
              <Icon className="mb-3 size-5 text-primary" aria-hidden="true" />
              <h3 className="font-medium">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-7xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">
            What we track
          </h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Electronics and home appliances — categories where prices move
            often, variants matter, and a wrong match would be misleading.
          </p>

          <ul className="mt-6 flex flex-wrap gap-2">
            {CATEGORIES.map((category) => (
              <li
                key={category}
                className="lift rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground"
              >
                {category}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="border-t border-border bg-muted/20">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Know the price before you pay it
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Paste a product link and we start recording its price today. No
            account, no sign-up — search is all there is.
          </p>
          <Link
            href="/dashboard"
            className="mt-7 inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Search a product
          </Link>
        </div>
      </section>
    </>
  );
}
