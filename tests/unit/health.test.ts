// tests/unit/health.test.ts
import { describe, expect, it } from 'vitest'

import { checkDatabaseReady } from '@/lib/health'
import type { Db } from '@/lib/db'

// A minimal stand-in for the PrismaClient: only $queryRaw is exercised. Cast
// through unknown so the test never depends on the full client surface.
function fakeDb(queryRaw: () => Promise<unknown>): Db {
  return { $queryRaw: queryRaw } as unknown as Db
}

describe('checkDatabaseReady', () => {
  it('returns true when SELECT 1 resolves', async () => {
    expect(await checkDatabaseReady(fakeDb(() => Promise.resolve([{ '?column?': 1 }])))).toBe(true)
  })

  it('returns false (never throws) when the query rejects', async () => {
    expect(await checkDatabaseReady(fakeDb(() => Promise.reject(new Error('DB down'))))).toBe(false)
  })

  it('returns false when the query hangs past the timeout', async () => {
    // A query that never settles must not hang the probe.
    expect(
      await checkDatabaseReady(
        fakeDb(() => new Promise(() => {})),
        20,
      ),
    ).toBe(false)
  })
})
