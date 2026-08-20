'use client';

import { ArrowRight, Link2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api-client';
import { useIngestProduct } from '@/hooks/use-products';

/**
 * The dashboard's primary control.
 *
 * The header carries a compact version of the same search for use from
 * anywhere, but on this page it is hidden — two search boxes on one screen
 * leaves a person deciding which is the real one, and the answer is neither.
 * This is the real one.
 *
 * Deliberately a panel rather than a bare input. The dashboard's whole job is
 * "paste a link, get a price history", and an input styled like every other
 * input does not read as the point of the page.
 */
export function DashboardSearch() {
  const router = useRouter();
  const ingest = useIngestProduct();
  const [url, setUrl] = useState('');

  /**
   * Which marketplace the pasted link belongs to, recognised as you type.
   *
   * Purely feedback — the API parses the URL properly and is the authority.
   * This exists so a mistyped or unsupported link is visibly wrong before you
   * submit it, rather than after a round trip.
   */
  const marketplace = /(?:^|\.)amazon\.in/i.test(url)
    ? 'Amazon.in'
    : /(?:^|\.)flipkart\.com/i.test(url)
      ? 'Flipkart'
      : null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || ingest.isPending) return;

    ingest.mutate(trimmed, {
      onSuccess: (product) => {
        setUrl('');
        router.push(`/products/${product.id}`);
      },
    });
  }

  const message = ingest.error instanceof ApiError ? ingest.error.userMessage : null;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-xs)] sm:p-6">
      <label htmlFor="dashboard-search" className="text-sm font-medium">
        Track a product&rsquo;s price
      </label>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste an Amazon.in or Flipkart link. We record today&rsquo;s price
        straight away and keep checking every day.
      </p>

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Link2
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id="dashboard-search"
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              // Clear a previous failure as soon as the input changes. Left
              // standing, the message contradicts what the field now says —
              // "only amazon.in and flipkart.com are supported" sitting under
              // a valid Flipkart URL reads as the app being broken.
              if (ingest.error) ingest.reset();
            }}
            disabled={ingest.isPending}
            placeholder="https://www.flipkart.com/…"
            // Named for what it takes, not for the panel it sits in. The
            // visible label above says why you would use it; the accessible
            // name has to say what belongs in the box.
            aria-label="Product URL"
            aria-describedby={message ? 'dashboard-search-error' : undefined}
            aria-invalid={message ? true : undefined}
            className="h-12 w-full rounded-lg border border-input bg-background pl-10 pr-24 text-sm transition-colors duration-200 placeholder:text-muted-foreground hover:border-muted-foreground/40 focus-visible:border-ring disabled:opacity-60"
          />

          {/* Recognition sits inside the field, where the thing it describes
              is. As a separate line it would push the layout around on every
              keystroke. */}
          {marketplace ? (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {marketplace}
            </span>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={!url.trim() || ingest.isPending}
          className="sheen group inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[var(--shadow-xs)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[var(--shadow-sm)] disabled:pointer-events-none disabled:opacity-50"
        >
          {ingest.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Searching
            </>
          ) : (
            <>
              Search
              <ArrowRight
                className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </>
          )}
        </button>
      </form>

      {message ? (
        <p
          id="dashboard-search-error"
          role="alert"
          className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
