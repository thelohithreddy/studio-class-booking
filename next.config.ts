import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Type errors fail the build. They are also checked separately in CI, but a
  // deploy that skips them is a deploy that ships them. (Next 16 no longer
  // runs ESLint during builds at all — CI owns linting.)
  typescript: { ignoreBuildErrors: false },

  // `pg` and the Prisma engine are Node-only. Keeping them external stops the
  // bundler from trying to trace their native bits into the server bundle.
  serverExternalPackages: ['@prisma/adapter-pg', 'pg'],
}

export default nextConfig
