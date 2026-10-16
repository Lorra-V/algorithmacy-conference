import { htmlRewrites } from './scripts/static-site.mjs';

const traced = ['./studio/index.html', './images/speakers/**/*', './lib/portal/studio-engineers.json'];

/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  allowedDevOrigins: ['127.0.0.1'],
  // API clients and Stripe post to paths without a trailing slash.
  // Pages keep their historical slash URLs; this stops Next from redirecting /api/*.
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ['firebase-admin', 'stripe', 'qrcode'],
  outputFileTracingIncludes: {
    '/api/portal/[[...route]]': traced,
    '/api/studio-mcp': traced,
  },
  async rewrites() {
    return {
      beforeFiles: [
        ...htmlRewrites(process.cwd()),
        { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth-metadata?doc=as' },
        { source: '/.well-known/oauth-authorization-server/:path*', destination: '/api/oauth-metadata?doc=as' },
        { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth-metadata?doc=resource' },
        { source: '/.well-known/oauth-protected-resource/:path*', destination: '/api/oauth-metadata?doc=resource' },
      ],
    };
  },
};

export default nextConfig;
