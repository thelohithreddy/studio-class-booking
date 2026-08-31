// tests/integration/helpers/test-db.ts
import { execFileSync } from 'node:child_process'
import { Client, Pool } from 'pg'

/**
 * The integration suite runs against its own database, never studio_dev.
 * TEST_DATABASE_URL wins when set (CI points it at the service container);
 * otherwise the developer's DATABASE_URL is taken with its database name
 * forced to `studio_test`. Either way the resolved database name must end in
 * `test` — the harness drops the schema it points at, and a copy-pasted
 * TEST_DATABASE_URL aimed at a real database should die here, loudly, first.
 */
export function resolveTestDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!base) {
    throw new Error(
      'Integration tests need TEST_DATABASE_URL or DATABASE_URL — copy .env.example to .env and run `pnpm db:up`.',
    )
  }

  const url = new URL(base)
  if (!process.env.TEST_DATABASE_URL) {
    url.pathname = '/studio_test'
  }

  const dbName = url.pathname.slice(1)
  if (!dbName.endsWith('test')) {
    throw new Error(
      `Refusing to run integration tests against "${dbName}": the harness drops this database's schema, so its name must end in "test".`,
    )
  }

  return url.toString()
}

/** Creates the test database if it does not exist yet. */
export async function ensureTestDatabase(testUrl: string): Promise<void> {
  const url = new URL(testUrl)
  const dbName = url.pathname.slice(1)

  const maintenance = new URL(testUrl)
  maintenance.pathname = '/postgres'

  const client = new Client({ connectionString: maintenance.toString() })
  await client.connect()
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`)
    }
  } finally {
    await client.end()
  }
}

/**
 * Drops everything and replays all migrations from zero. Doubles as the
 * "migrations apply on a fresh database" test on every suite run.
 */
export async function resetAndMigrate(testUrl: string): Promise<void> {
  const client = new Client({ connectionString: testUrl })
  await client.connect()
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE')
    await client.query('CREATE SCHEMA public')
  } finally {
    await client.end()
  }

  // prisma.config.ts prefers DIRECT_URL over DATABASE_URL, so it must be
  // absent here — absent, not empty: an empty string survives the ?? chain
  // and then reads as "no URL at all".
  const { DIRECT_URL: _dropped, ...baseEnv } = process.env as NodeJS.ProcessEnv & {
    DIRECT_URL?: string
  }

  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    env: { ...baseEnv, DATABASE_URL: testUrl },
    stdio: 'pipe',
  })
}

/**
 * Empties every table between tests. booking_events forbids DELETE and
 * TRUNCATE by trigger (that is the point of it), so this goes through
 * session_replication_role = 'replica', which disables triggers and is
 * superuser-only — available in the dockerised dev/CI Postgres, absent in
 * production, where nothing should ever truncate history.
 */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(`
    DO $$
    BEGIN
      SET LOCAL session_replication_role = 'replica';
      TRUNCATE TABLE
        auth_sessions,
        membership_alert_dismissals,
        booking_events,
        bookings,
        session_instructors,
        class_sessions,
        classes,
        rooms,
        members,
        users
        RESTART IDENTITY CASCADE;
    END
    $$;
  `)
}
