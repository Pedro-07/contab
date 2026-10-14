import type { NextConfig } from 'next';

const config: NextConfig = {
  // Os pacotes do monorepo são TypeScript sem build próprio.
  transpilePackages: [
    '@contab/adapters',
    '@contab/auth',
    '@contab/config',
    '@contab/core',
    '@contab/db',
    '@contab/domain',
  ],
  // pg, pg-boss e pino rodam só no servidor, sem empacotar.
  serverExternalPackages: ['pg', 'pg-boss', 'pino'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
