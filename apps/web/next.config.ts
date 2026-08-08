import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Fail the production build on type errors rather than shipping them.
  // Next's default already does this; stated explicitly so nobody "fixes" a
  // red build by flipping the flag.
  // (Next 16 dropped the `eslint` key from NextConfig — lint config now lives
  // outside next.config, so there is nothing to assert here for ESLint.)
  typescript: { ignoreBuildErrors: false },

  // Marketplace product images are remote. Hosts are allowlisted explicitly —
  // a wildcard would turn our image optimizer into an open proxy that anyone
  // can use to fetch and cache arbitrary URLs at our expense.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'm.media-amazon.com' },
      { protocol: 'https', hostname: 'images-na.ssl-images-amazon.com' },
      { protocol: 'https', hostname: 'rukminim1.flixcart.com' },
      { protocol: 'https', hostname: 'rukminim2.flixcart.com' },
    ],
  },

  // The API sets its own security headers via helmet; these cover the pages
  // Next serves directly.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
