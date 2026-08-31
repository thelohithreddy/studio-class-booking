// tests/integration/helpers/setup-env.ts
//
// Runs in each worker before any test file imports application modules.
// Route handlers reach the database through the lazy db() singleton, which
// reads env().DATABASE_URL on first use — pointing it here at the dedicated
// test database is what lets integration tests invoke handlers in-process
// without ever touching studio_dev.
import { resolveTestDatabaseUrl } from './test-db'

process.env.DATABASE_URL = resolveTestDatabaseUrl()
