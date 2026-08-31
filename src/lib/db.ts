import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/lib/env'

/**
 * Builds a PrismaClient over the pg driver adapter (Prisma 7: the schema file
 * carries no URL; migrations use DIRECT_URL via prisma.config.ts).
 *
 * Pool sizing note: node-postgres does NOT read `connection_limit` or
 * `pgbouncer` URL parameters — those belonged to the classic Prisma engine.
 * The pool defaults to 10 connections; when production runs behind a
 * transaction pooler, the deploy phase sets an explicit `max` here instead of
 * pretending a URL flag does it.
 *
 * `omit.user.passwordHash` is global on purpose: users are joined into almost
 * every read path (session instructor, timeline actor, dismissed-by) and
 * Prisma's default select returns every scalar. The hash never leaves the
 * database by default; the Phase 3 credential check opts back in explicitly
 * with `omit: { passwordHash: false }` on that one query.
 *
 * The return type is deliberately inferred — annotating it as `PrismaClient`
 * would erase the omit from the type system and let `user.passwordHash`
 * typecheck while being absent at runtime.
 */
export function createPrismaClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({
    adapter,
    omit: { user: { passwordHash: true } },
  })
}

export type Db = ReturnType<typeof createPrismaClient>

/**
 * The application's PrismaClient, created lazily on first use — importing
 * this module must not require a configured DATABASE_URL, or `next build`
 * would need a database the moment any route imports it. (Mirrors the lazy
 * `env()` accessor for the same reason.)
 *
 * The global cache exists for Next.js dev mode, where hot reload re-evaluates
 * modules — without it every reload would leak a connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: Db }

let cached: Db | undefined

export function db(): Db {
  cached ??= globalForPrisma.prisma ?? createPrismaClient(env().DATABASE_URL)
  if (env().NODE_ENV !== 'production') {
    globalForPrisma.prisma = cached
  }
  return cached
}
