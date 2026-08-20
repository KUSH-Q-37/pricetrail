import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CalendarClock, LineChart, Link2, ShieldCheck } from 'lucide-react';

import { HeroPriceCard } from '@/components/marketing/hero-price-card';
import { Reveal } from '@/components/marketing/reveal';

export const metadata: Metadata = {
  title: 'PriceTrail — Amazon & Flipkart price history for Indian shoppers',
  description:
    'Track daily prices across Amazon.in and Flipkart. See up to 15 months of real price history and tell a genuine discount from a reset sticker price.',
};

/**
 * Three steps, numbered rather than iconed.
 *
 * The numbers carry the sequence, which is the only thing this section has to
 * say. Icons here would be decoration standing in for meaning — there is no
 * icon that distinguishes "we record it daily" from "we find it on the other
 * marketplace".
 */
const STEPS = [
  {
    n: '01',
    title: 'Paste a product URL',
    body: 'Any amazon.in or flipkart.com link. We read the product identity — brand, model, storage, capacity — not just the title.',
  },
  {
    n: '02',
    title: 'PriceTrail records it daily',
    body: 'One observation per product per day, kept permanently. Searching is the whole setup; there is nothing else to switch on.',
  },
  {
    n: '03',
    title: 'See the real trend',
    body: 'Watch what a product actually cost over time, and judge today’s discount against the price it was really selling at.',
  },
];

const VALUES = [
  {
    icon: CalendarClock,
    title: 'Daily price tracking',
    body: 'Know what a product actually cost over time, not just what the tag says today.',
  },
  {
    icon: LineChart,
    title: 'Up to 15 months of history',
    body: 'Seven days to fifteen months on one chart, with zoom and pan.',
  },
  {
    icon: ShieldCheck,
    title: 'Gaps stay gaps',
    body: 'If a price could not be read on a given day, the line breaks. We never invent a number we did not observe.',
  },
];

export default function LandingPage() {
  return (
    <>
      {/* ================================================================= */}
      {/* HERO                                                              */}
      {/* ================================================================= */}
      {/*
        No longer full-viewport-height. Forcing the hero to own the entire
        first screen pushed everything else below the fold and left a wide
        empty band under the copy, so the page read as unfinished rather than
        spacious. Generous padding gives the same calm without the vacuum, and
        letting the next section peek in at the bottom is what invites a
        scroll.
      */}
      <section className="relative overflow-hidden px-4 pb-20 pt-16 sm:pt-24">
        <div className="ambient ambient--drift" aria-hidden="true" />
        <div className="grid-texture" aria-hidden="true" />

        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-16">
          {/* --- the argument -------------------------------------------- */}
          <div>
            <p
              className="stagger-in mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm"
              style={{ '--stagger': '0ms' } as CSSProperties}
            >
              <span className="live-dot size-1.5 rounded-full bg-success" aria-hidden="true" />
              Tracking Amazon.in &amp; Flipkart daily
            </p>

            {/* Two lines, staggered in reading order. The question lands, then
                the word that sharpens it. */}
            <h1 className="text-[2.75rem] font-semibold leading-[1.03] tracking-[-0.03em] sm:text-6xl">
              <span
                className="stagger-in block"
                style={{ '--stagger': '90ms' } as CSSProperties}
              >
                Is that discount
              </span>
              <span
                className="stagger-in block text-primary"
                style={{ '--stagger': '220ms' } as CSSProperties}
              >
                real?
              </span>
            </h1>

            {/* Capped near 62 characters per line. Longer measures are where a
                reader loses their place returning to the next line. */}
            <p
              className="stagger-in mt-6 max-w-[34rem] text-lg leading-relaxed text-muted-foreground"
              style={{ '--stagger': '340ms' } as CSSProperties}
            >
              A product showing &ldquo;40% off&rdquo; means nothing on its own — the
              sticker price may have been raised last week. PriceTrail records what
              things <em className="not-italic text-foreground">actually</em> cost,
              every day, so you can tell a genuine drop from a marketing number.
            </p>

            <div
              className="stagger-in mt-9 flex flex-wrap items-center gap-4"
              style={{ '--stagger': '460ms' } as CSSProperties}
            >
              <Link
                href="/dashboard"
                className="sheen group inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[var(--shadow-sm)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[var(--shadow-md)]"
              >
                Search a product
                <ArrowRight
                  className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>

              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Link2 className="size-3.5" aria-hidden="true" />
                No account needed
              </span>
            </div>
          </div>

          {/* --- the same argument, as a picture -------------------------- */}
          <div className="relative">
            <HeroPriceCard />
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* HOW IT WORKS                                                      */}
      {/* ================================================================= */}
      <section className="border-t border-border bg-card/40">
        <div className="mx-auto w-full max-w-7xl px-4 py-16">
          <h2 className="text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">
            How PriceTrail works
          </h2>

          {/* One-pixel gaps filled by the container's background. Three
              bordered cards side by side double the line at every join; this
              produces a single crisp rule instead. */}
          <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
            {STEPS.map(({ n, title, body }, index) => (
              <Reveal key={n} delay={index * 0.08} className="bg-card p-6">
                <span className="text-xs font-medium tabular-price text-primary">{n}</span>
                <h3 className="mt-3 font-medium">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* VALUE                                                             */}
      {/* ================================================================= */}
      <section className="mx-auto w-full max-w-7xl px-4 py-16">
        <div className="grid gap-8 sm:grid-cols-3">
          {VALUES.map(({ icon: Icon, title, body }, index) => (
            <Reveal key={title} delay={index * 0.08}>
              <Icon className="size-5 text-primary" aria-hidden="true" />
              <h3 className="mt-3 font-medium">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </Reveal>
          ))}
        </div>
      </section>


      {/* ================================================================= */}
      {/* CLOSE                                                             */}
      {/* ================================================================= */}
      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Know the price before you pay it
          </h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Paste a product link and we start recording its price today.
          </p>
          <Link
            href="/dashboard"
            className="sheen group mt-8 inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[var(--shadow-sm)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[var(--shadow-md)]"
          >
            Search a product
            <ArrowRight
              className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>
      </section>
    </>
  );
}
