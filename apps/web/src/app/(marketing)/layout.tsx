import Link from 'next/link';
import { TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Public marketing shell.
 *
 * Two pages exist, so the navbar carries no navigation — a link list of one
 * destination is worse than none. Identity on the left, the single action on
 * the right, nothing else. No theme control, because there is one theme.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        Translucent with a blur rather than solid. A solid bar sitting over a
        hero that has its own ambient wash cuts the composition in half; this
        lets the page read as one surface while still separating on scroll.
      */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center px-4">
          <Link
            href="/"
            className="flex items-center gap-2 transition-opacity duration-200 hover:opacity-80"
          >
            <span className="grid size-7 place-items-center rounded-lg bg-primary/10">
              <TrendingUp className="size-4 text-primary" aria-hidden="true" />
            </span>
            <span className="font-semibold tracking-tight">PriceTrail</span>
          </Link>

          <nav className="ml-auto">
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-[var(--shadow-xs)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[var(--shadow-sm)]"
            >
              Search a product
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {/*
        One row, deliberately. A multi-column marketing footer on a two-page
        product is filler; the only thing that genuinely needs saying here is
        what these prices are and are not.
      */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium">PriceTrail</span>
            <span className="text-sm text-muted-foreground">
              · © {new Date().getFullYear()}
            </span>
          </div>

          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
            Prices are observations recorded at a point in time and may differ
            from the marketplace today. Always check the retailer before buying.
            Not affiliated with Amazon or Flipkart.
          </p>
        </div>
      </footer>
    </div>
  );
}
