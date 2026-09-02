// tests/unit/db-pool-config.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolvePoolConfig } from '@/lib/db'

// resolvePoolConfig reads two optional operational knobs from the environment;
// snapshot and restore them so cases cannot leak into each other or other files.
let savedMax: string | undefined
let savedCa: string | undefined

beforeEach(() => {
  savedMax = process.env.DATABASE_POOL_MAX
  savedCa = process.env.DATABASE_CA_CERT
  delete process.env.DATABASE_POOL_MAX
  delete process.env.DATABASE_CA_CERT
})
afterEach(() => {
  if (savedMax === undefined) delete process.env.DATABASE_POOL_MAX
  else process.env.DATABASE_POOL_MAX = savedMax
  if (savedCa === undefined) delete process.env.DATABASE_CA_CERT
  else process.env.DATABASE_CA_CERT = savedCa
})

const LOCAL = 'postgresql://studio:studio@localhost:5432/studio_dev?schema=public'
const REMOTE = 'postgresql://user:pass@db.example.com:5432/appdb'

describe('resolvePoolConfig — TLS posture', () => {
  it('local host → TLS disabled (local Postgres speaks plaintext)', () => {
    expect(resolvePoolConfig(LOCAL).ssl).toBe(false)
    expect(resolvePoolConfig('postgresql://u:p@127.0.0.1:5432/x').ssl).toBe(false)
  })

  it('remote host → verified TLS (rejectUnauthorized: true)', () => {
    expect(resolvePoolConfig(REMOTE).ssl).toEqual({ rejectUnauthorized: true })
  })

  it('a URL sslmode=no-verify is STRIPPED and cannot downgrade a remote connection', () => {
    const cfg = resolvePoolConfig(`${REMOTE}?sslmode=no-verify`)
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true })
    expect(String(cfg.connectionString)).not.toMatch(/sslmode/)
  })

  it('a URL sslmode=disable is STRIPPED and cannot force plaintext on a remote connection', () => {
    const cfg = resolvePoolConfig(`${REMOTE}?sslmode=disable`)
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true })
    expect(String(cfg.connectionString)).not.toMatch(/sslmode/)
  })

  it('DATABASE_CA_CERT is trusted as the CA for remote verification', () => {
    process.env.DATABASE_CA_CERT = '-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----'
    expect(resolvePoolConfig(REMOTE).ssl).toEqual({
      rejectUnauthorized: true,
      ca: process.env.DATABASE_CA_CERT,
    })
  })

  it('a blank DATABASE_CA_CERT is ignored (falls back to the system trust store)', () => {
    process.env.DATABASE_CA_CERT = '   '
    expect(resolvePoolConfig(REMOTE).ssl).toEqual({ rejectUnauthorized: true })
  })

  it('a `host=` query param (which pg dials over the authority) forces verified TLS', () => {
    // Authority says localhost, but pg connects to db.example.com — must verify.
    expect(resolvePoolConfig('postgresql://u:p@localhost:5432/db?host=db.example.com').ssl).toEqual(
      { rejectUnauthorized: true },
    )
    // Empty authority + host= param → remote → verified.
    expect(resolvePoolConfig('postgresql:///appdb?host=db.example.com').ssl).toEqual({
      rejectUnauthorized: true,
    })
    // Duplicated host= — pg uses the LAST value, so a leading localhost cannot mask it.
    expect(
      resolvePoolConfig('postgresql://u:p@x/db?host=localhost&host=db.example.com').ssl,
    ).toEqual({ rejectUnauthorized: true })
  })

  it('classifies loopback variants as local regardless of case or IPv6 brackets', () => {
    expect(resolvePoolConfig('postgresql://u:p@LOCALHOST:5432/db').ssl).toBe(false)
    expect(resolvePoolConfig('postgresql://u:p@[::1]:5432/db').ssl).toBe(false)
    // Unix-domain socket path via host= → local (no TLS).
    expect(resolvePoolConfig('postgresql:///db?host=/var/run/postgresql').ssl).toBe(false)
  })
})

describe('resolvePoolConfig — pool sizing', () => {
  it('defaults max to 10 when unset', () => {
    expect(resolvePoolConfig(LOCAL).max).toBe(10)
  })

  it('honours a valid DATABASE_POOL_MAX', () => {
    process.env.DATABASE_POOL_MAX = '3'
    expect(resolvePoolConfig(LOCAL).max).toBe(3)
  })

  it('falls back to 10 for a non-numeric / zero / negative DATABASE_POOL_MAX', () => {
    for (const bad of ['abc', '0', '-5', '']) {
      process.env.DATABASE_POOL_MAX = bad
      expect(resolvePoolConfig(LOCAL).max).toBe(10)
    }
  })

  it('clamps an over-large DATABASE_POOL_MAX to the ceiling (a typo cannot invert the intent)', () => {
    process.env.DATABASE_POOL_MAX = '1000'
    expect(resolvePoolConfig(LOCAL).max).toBe(100)
  })

  it('preserves the database and non-ssl query params in the connection string', () => {
    const cfg = resolvePoolConfig(LOCAL)
    expect(String(cfg.connectionString)).toContain('/studio_dev')
    expect(String(cfg.connectionString)).toContain('schema=public')
  })
})
