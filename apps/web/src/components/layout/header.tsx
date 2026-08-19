'use client';

import { Menu, Search } from 'lucide-react';

import { ThemeToggle } from '@/components/layout/theme-toggle';
import { ApiStatusPill } from '@/components/layout/api-status-pill';
import { useUiStore } from '@/stores/ui-store';

export function Header() {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-sm">
      <button
        onClick={toggleSidebar}
        aria-label="Open navigation"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <div className="relative min-w-0 flex-1 max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          // Phase 6 wires this to the ingest-or-search endpoint.
          placeholder="Search products or paste a product URL…"
          aria-label="Search products or paste a product URL"
          className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:border-ring"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <ApiStatusPill />
        <ThemeToggle />
      </div>
    </header>
  );
}
