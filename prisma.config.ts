import { defineConfig } from 'prisma/config'

/**
 * Prisma CLI configuration (Prisma 7).
 *
 * Only the CLI reads this file — migrate, db push, studio. The application
 * itself never does: it builds PrismaClient from a driver adapter over the
 * same environment variable (see src/lib/db.ts once Phase 2 lands).
 *
 * `DIRECT_URL` matters in production. The runtime endpoint is a transaction
 * pooler, and DDL through one is unreliable, so migrations deliberately take
 * the direct connection when it is set. Locally only DATABASE_URL exists and
 * the two collapse to the same Postgres.
 *
 * The URL is optional here on purpose: `prisma generate` runs in CI and on
 * build hosts with no database configured at all, and must not fail there.
 * Commands that genuinely need a connection (migrate, studio) get Prisma's
 * own "no datasource URL" error, which names the missing variable.
 */
// Blank counts as absent: a created-but-empty DIRECT_URL in a deploy
// dashboard must fall through to DATABASE_URL, not erase the datasource.
function pick(value: string | undefined): string | undefined {
  return value && value.trim() !== '' ? value : undefined
}

const migrationUrl = pick(process.env.DIRECT_URL) ?? pick(process.env.DATABASE_URL)

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
})
