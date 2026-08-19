'use client';

import { useEffect } from 'react';

/**
 * The last boundary — errors thrown by the root layout itself.
 *
 * Why this file exists at all: without it Next synthesises a default, and
 * prerendering that default was failing the production build with
 * "Cannot read properties of null (reading 'useContext')". Supplying the page
 * explicitly removes the synthesised one from the build entirely.
 *
 * It replaces the ROOT LAYOUT when it renders, which is why it declares its
 * own <html> and <body>. Everything the rest of the app leans on is therefore
 * unavailable here — no providers, no query client, no shared components — so
 * this deliberately imports nothing but React. A boundary that can itself
 * throw is not a boundary, and the most likely reason to be rendering this
 * page is that something in that provider tree is broken.
 *
 * Styles are inline for the same reason: if the failure happened before the
 * stylesheet was applied, class names would render as unstyled text.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Root layout error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '1.5rem',
          background: '#f7f5f2',
          color: '#22252b',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: '26rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            PriceTrail could not load
          </h1>

          <p
            style={{
              marginTop: '0.75rem',
              fontSize: '0.875rem',
              lineHeight: 1.6,
              color: '#5b5f68',
            }}
          >
            Something failed before the page could render. Reloading usually
            fixes it; if it does not, the service may be restarting.
          </p>

          <button
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              height: '2.75rem',
              padding: '0 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#1d4ed8',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>

          {/* The digest is what ties this screen to a specific entry in the
              server logs. Without it a report is just "it broke". */}
          {error.digest ? (
            <p
              style={{
                marginTop: '1rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.6875rem',
                color: '#8a8e96',
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
