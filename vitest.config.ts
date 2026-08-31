import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Resolve the `@/*` aliases straight from tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests (Phase 2 onward) talk to one real Postgres schema, so
    // test files must not run in parallel with each other. Unit tests are
    // cheap enough that serial execution costs nothing noticeable.
    fileParallelism: false,
  },
})
