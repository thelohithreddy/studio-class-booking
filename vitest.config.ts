import { defineConfig } from 'vitest/config'

// Vitest does not load .env on its own. Node 26 can, natively; already-set
// variables win, and CI (which has real env vars and no .env file) skips this.
try {
  process.loadEnvFile()
} catch {
  // no .env — fine, the environment must already be configured
}

export default defineConfig({
  resolve: {
    // Resolve the `@/*` aliases straight from tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    // Two projects so `pnpm test:unit` never needs a database, while
    // `pnpm test` proves the schema against real Postgres.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/helpers/global-setup.ts'],
          // All integration files share one schema; never run them in parallel.
          fileParallelism: false,
        },
      },
    ],
  },
})
