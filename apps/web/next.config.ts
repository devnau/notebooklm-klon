import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Für das Docker-Image: minimaler Server-Bundle ohne Dev-Dependencies.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,

  // `@nlm/shared` liegt als TS-Quelle im Monorepo und wird von Next mitkompiliert.
  transpilePackages: ['@nlm/shared'],

  experimental: {
    // Server Actions bekommen Uploads bis zur Größe aus MAX_UPLOAD_BYTES.
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },

  // Basale Header auch im Dev-Betrieb; in Produktion setzt Caddy zusätzlich CSP/HSTS.
  headers: () =>
    Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]),
};

export default nextConfig;
