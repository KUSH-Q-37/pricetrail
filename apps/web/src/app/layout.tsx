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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0d12' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required exactly here: next-themes writes the
    // resolved theme class onto <html> in a blocking inline script before React
    // hydrates, so the server markup and the client DOM legitimately differ on
    // this one element. Scoped to <html>, it hides nothing else.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
