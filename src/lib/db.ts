import { PrismaPg } from '@prisma/adapter-pg'
import type { PoolConfig } from 'pg'

import { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/lib/env'

// A local dev/test Postgres (the docker-compose `db`) speaks plaintext — TLS is
// neither available nor wanted there. Every OTHER host is remote/production and
// must present a certificate we verify. Matching is done on the EFFECTIVE host
// pg will dial (see resolvePoolConfig), normalised: IPv6 brackets stripped, case
// folded, unix-socket paths (leading `/`) treated as local, empty host (pg's
// localhost default) treated as local.
function isLocalDbHost(host: string): boolean {
  if (host.startsWith('/')) return true // unix-domain socket
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    normalized === '' ||
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1'
  )
}

// A defensive ceiling so an operator typo (DATABASE_POOL_MAX=1000) cannot invert
// the intent of the setting and storm Postgres with connections.
const MAX_POOL_CEILING = 100

/**
 * Resolves the pg pool configuration from a connection string, with a
 * DETERMINISTIC TLS posture that does NOT depend on the URL's `sslmode`.
 *
 * Why not trust the URL: node-postgres lets a connection-string `sslmode`
 * OVERRIDE an explicit `ssl` config object (connection-parameters.js does
 * `Object.assign({}, config, parse(connectionString))`), and `sslmode=no-verify`
 * parses to `{ rejectUnauthorized: false }`. So a single stray query param in a
 * deploy dashboard could silently downgrade production DB traffic to encrypted-
 * but-unverified (MITM-able). We neutralize that: strip every ssl* param from
 * the URL and decide TLS HERE.
 *   - local host (docker dev/test) → ssl:false (local Postgres has no TLS)
 *   - any remote host             → verified TLS: rejectUnauthorized:true,
 *                                    optionally against a provider CA supplied
 *                                    out-of-band via DATABASE_CA_CERT.
 * Fail-closed: a remote server whose certificate does not verify aborts the
 * connection rather than being trusted. There is no code path to `no-verify`.
 * The host is the EFFECTIVE host pg will dial — a `host=` query param (which pg
 * honours OVER the URL authority) is respected here too, so it cannot smuggle a
 * remote connection past this decision. (Intentionally unsupported, so they
 * cannot silently weaken TLS: client-certificate/mutual-TLS via sslcert/sslkey,
 * and verify-ca-without-hostname — use DATABASE_CA_CERT for a private root.)
 *
 * Pool sizing: node-postgres does NOT read `connection_limit`/`pgbouncer` URL
 * params (those were the classic Prisma engine's). We set an explicit, bounded
 * `max` — pg's own default (10) unless DATABASE_POOL_MAX overrides it, clamped to
 * MAX_POOL_CEILING — so a deploy behind a Supabase-class transaction pooler can
 * pin a small per-instance ceiling (e.g. DATABASE_POOL_MAX=3) and never storm
 * Postgres with connections.
 */
export function resolvePoolConfig(connectionString: string): PoolConfig {
  const url = new URL(connectionString)
  for (const param of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'sslnegotiation']) {
    url.searchParams.delete(param)
  }

  // pg dials the `host=` query param when present, otherwise the URL authority
  // (pg-connection-string copies query params into config ahead of the authority
  // fallback). Classify on that SAME host so neither a `host=` param nor an empty
  // authority can route a remote connection around the TLS decision. pg assigns
  // config.host from each `host=` in order, so the LAST one wins — take the last
  // (not URLSearchParams.get(), which returns the first) to match pg exactly.
  const hostValues = url.searchParams.getAll('host')
  const hostParam = hostValues.length > 0 ? hostValues[hostValues.length - 1]!.trim() : ''
  const effectiveHost = hostParam !== '' ? hostParam : url.hostname

  const ca = process.env.DATABASE_CA_CERT?.trim()
  const ssl: PoolConfig['ssl'] = isLocalDbHost(effectiveHost)
    ? false
    : { rejectUnauthorized: true, ...(ca ? { ca } : {}) }

  const requestedMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? '', 10)
  const max =
    Number.isInteger(requestedMax) && requestedMax > 0
      ? Math.min(requestedMax, MAX_POOL_CEILING)
      : 10

  return { connectionString: url.toString(), ssl, max }
}

/**
 * Builds a PrismaClient over the pg driver adapter (Prisma 7: the schema file
 * carries no URL; migrations use DIRECT_URL via prisma.config.ts). TLS and pool
 * sizing come from resolvePoolConfig above.
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
  const adapter = new PrismaPg(resolvePoolConfig(connectionString))
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
