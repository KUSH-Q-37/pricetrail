import type { Metadata, Viewport } from 'next';

import { ACCENT_SCRIPT } from '@/lib/accent';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PriceTrail — Amazon & Flipkart price history',
    template: '%s · PriceTrail',
  },
  description:
    'Track daily prices across Amazon and Flipkart, verify products match, and compare price history over time.',
};

export const viewport: Viewport = {
  /*
   * The PRE-HYDRATION default only.
   *
   * A static export can branch on `prefers-color-scheme` — the OS preference —
   * but not on the theme this user actually picked, which is not knowable until
   * the head script has run. These two values keep the browser chrome roughly
   * right for the first frame; <ThemeChrome> then syncs them to the real
   * computed background and drops the media constraint.
   *
   * Values match --background for `light` and `dark` in globals.css. `midnight`
   * has no entry because there is no media query that could select it.
   */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f5f2' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1d21' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * `suppressHydrationWarning` is back, and for the original reason: two
     * scripts write to <html> before React hydrates — next-themes sets
     * `data-theme`, and ACCENT_SCRIPT below sets `data-accent` — so the server
     * markup and the first client render legitimately disagree on this one
     * element.
     *
     * It is scoped to <html> alone and does not cascade, so a genuine mismatch
     * anywhere inside the app still reports normally.
     */
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Render-blocking on purpose, and placed in <head> so it executes before
          the first paint rather than after it. next-themes injects its own
          equivalent for `data-theme`; this is the matching half for the accent.

          `dangerouslySetInnerHTML` is the only way to emit an inline script
          from a server component. The content is a module constant built from
          a hard-coded list — no user input reaches it — so there is nothing
          here for an injection to ride in on.
        */}
        <script dangerouslySetInnerHTML={{ __html: ACCENT_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
