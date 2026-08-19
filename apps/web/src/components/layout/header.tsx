'use client';

import { Loader2, Menu, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { ThemeToggle } from '@/components/layout/theme-toggle';
import { ApiStatusPill } from '@/components/layout/api-status-pill';
import { ApiError } from '@/lib/api-client';
import { useIngestProduct } from '@/hooks/use-products';
import { useUiStore } from '@/stores/ui-store';

/**
 * The search box is the application.
 *
 * It used to be decorative — an input carrying a "Phase 6 wires this up" note
 * that did nothing when you pressed Enter, which is worse than not being there
 * at all, because it looks like the primary control. It is now the real entry
 * point: paste a URL, land on that product's price history.
 *
 * Deliberately no suggestion dropdown and no recent-searches list. Showing
 * what has been looked up would turn the box into a directory of everyone's
 * browsing, and with no accounts there is nothing to scope that to.
 */
export function Header() {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const router = useRouter();
  const ingest = useIngestProduct();
  const [url, setUrl] = useState('');

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

  // The parser's messages name the actual problem ("we support amazon.in and
  // flipkart.com"), so they are shown verbatim rather than replaced by a
  // generic failure.
  const message = ingest.error instanceof ApiError ? ingest.error.userMessage : null;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-sm">
      <button
        onClick={toggleSidebar}
        aria-label="Open navigation"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <form onSubmit={onSubmit} className="relative min-w-0 max-w-md flex-1">
        {ingest.isPending ? (
          <Loader2
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        )}

        <input
          type="search"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={ingest.isPending}
          placeholder="Paste an Amazon or Flipkart product URL…"
          aria-label="Paste an Amazon or Flipkart product URL"
          aria-describedby={message ? 'header-search-error' : undefined}
          aria-invalid={message ? true : undefined}
          className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:border-ring disabled:opacity-60"
        />

        {message ? (
          // role="alert" so it is announced, and anchored to the input rather
          // than floating elsewhere, so a keyboard user meets it in order.
          <p
            id="header-search-error"
            role="alert"
            className="absolute left-0 top-full mt-1 w-full rounded-md border border-destructive/40 bg-card px-2 py-1 text-xs text-destructive shadow-sm"
          >
            {message}
          </p>
        ) : null}
      </form>

      <div className="ml-auto flex items-center gap-2">
        <ApiStatusPill />
        <ThemeToggle />
      </div>
    </header>
  );
}
