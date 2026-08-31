import type { NextConfig } from 'next'

/**
 * Baseline security headers. The CSP is deliberately minimal, and its safety
 * rests on one invariant: NO default-src/script-src/style-src is present, so
 * Next's inline runtime scripts stay unrestricted. base-uri, form-action and
 * frame-ancestors never consult default-src; object-src and connect-src
 * would fall back to it if it existed — which is exactly why it must not be
 * added here without doing the script-src/nonce work (the frontend phase's
 * job). HSTS applies only to production builds so localhost dev over http
 * stays usable.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value:
      "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'",
  },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
]

const nextConfig: NextConfig = {
  // Type errors fail the build. They are also checked separately in CI, but a
  // deploy that skips them is a deploy that ships them. (Next 16 no longer
  // runs ESLint during builds at all — CI owns linting.)
  typescript: { ignoreBuildErrors: false },

  // Native/Node-only packages kept external to the server bundle. @node-rs/
  // argon2 is already on Next 16's built-in externals list (see decisions.md
  // #14) — pinned here anyway so the guarantee survives a Next upgrade.
  serverExternalPackages: ['@prisma/adapter-pg', 'pg', '@node-rs/argon2'],

  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
