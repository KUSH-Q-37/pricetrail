import Link from 'next/link';
import { TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/layout/theme-toggle';

/**
 * Public marketing shell.
 *
 * A separate route group from (dashboard) so it renders WITHOUT RequireAuth —
 * every byte here is readable by a signed-out visitor. That is the point: a
 * product whose only public page is a login form gives a reviewer, a search
 * crawler, or a curious visitor nothing to evaluate.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <TrendingUp className="size-5 text-primary" aria-hidden="true" />
            <span className="font-semibold tracking-tight">PriceTrail</span>
          </Link>

          <nav className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 text-sm text-muted-foreground">
          <p>
            PriceTrail tracks publicly listed prices on Amazon.in and
            Flipkart.com. Prices shown are observations recorded at a point in
            time and may differ from the current price on the marketplace.
            Always check the retailer before purchasing.
          </p>
          <p className="mt-3">
            © {new Date().getFullYear()} PriceTrail · Not affiliated with
            Amazon or Flipkart.
          </p>
        </div>
      </footer>
    </div>
  );
}
