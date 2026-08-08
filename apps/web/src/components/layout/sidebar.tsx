'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { LayoutDashboard, LineChart, Package, Settings, TrendingUp, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

const navigation = [
  { href: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/products', label: 'Products', Icon: Package },
  { href: '/compare', label: 'Compare', Icon: LineChart },
  { href: '/settings', label: 'Settings', Icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Main">
      {navigation.map(({ href, label, Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {active ? (
              // layoutId lets the highlight slide between items instead of
              // popping — one shared element, animated by Framer Motion.
              <motion.span
                layoutId="sidebar-active"
                className="absolute inset-0 rounded-lg bg-accent"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            ) : null}
            <Icon className="relative size-4 shrink-0" aria-hidden="true" />
            <span className="relative">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-border px-5">
      <TrendingUp className="size-5 text-primary" aria-hidden="true" />
      <span className="font-semibold tracking-tight">PriceTrail</span>
    </div>
  );
}

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useUiStore();
  const pathname = usePathname();

  // Close the drawer on navigation, otherwise it covers the page the user
  // just asked for.
  useEffect(() => setSidebarOpen(false), [pathname, setSidebarOpen]);

  // Escape closes it, which users expect from any overlay.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen, setSidebarOpen]);

  return (
    <>
      {/* Desktop: always present, part of the grid rather than an overlay. */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
        <Brand />
        <NavLinks />
      </aside>

      {/* Mobile: overlay drawer. */}
      <AnimatePresence>
        {sidebarOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
              className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
            >
              <div className="flex h-14 items-center justify-between border-b border-border px-5">
                <div className="flex items-center gap-2">
                  <TrendingUp className="size-5 text-primary" aria-hidden="true" />
                  <span className="font-semibold tracking-tight">PriceTrail</span>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Close navigation"
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <NavLinks onNavigate={() => setSidebarOpen(false)} />
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
