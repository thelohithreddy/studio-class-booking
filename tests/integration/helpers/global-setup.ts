// tests/integration/helpers/global-setup.ts
//
// Runs once before the integration project: resolves the dedicated test
// database (never studio_dev), creates it if missing, drops its schema and
// replays every migration from zero. Every integration run is therefore also
// a from-scratch migration test.
import { ensureTestDatabase, resetAndMigrate, resolveTestDatabaseUrl } from './test-db'

export default async function globalSetup(): Promise<void> {
  const testUrl = resolveTestDatabaseUrl()
  await ensureTestDatabase(testUrl)
  await resetAndMigrate(testUrl)
}
