import type { Metadata, Viewport } from 'next';

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
  // One colour, matching the page background. This used to declare a
  // prefers-color-scheme pair, which would now tint mobile browser chrome dark
  // around a page that is always light — the seam is very visible on iOS.
  themeColor: '#f7f5f2',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // No suppressHydrationWarning any more. It existed because next-themes
    // wrote a theme class onto <html> before React hydrated, so server and
    // client legitimately disagreed on this one element. With a single theme
    // nothing writes to <html>, and leaving the suppression in place would
    // silently hide a real hydration mismatch if one ever appeared here.
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
