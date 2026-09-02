// src/lib/health.ts
import type { Db } from '@/lib/db'

/**
 * Readiness (not liveness) check: the cheapest possible database round-trip.
 *
 * `/api/health` answers "is the process up" and deliberately never touches the
 * database (a DB blip must not trigger a restart loop). This is the OTHER half
 * — "can the process actually serve traffic" — used by a readiness probe.
 *
 * It resolves to a boolean and NEVER throws: any failure (DB down, pool
 * exhausted, host unreachable) is caught and reported as "not ready", and the
 * check is bounded by its own timeout so a hung connection can never hang the
 * probe. No error detail escapes — the caller turns the boolean into a bare
 * 200/503 with no diagnostics.
 */
const DEFAULT_TIMEOUT_MS = 4000

export async function checkDatabaseReady(
  db: Db,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    const ping = db.$queryRaw`SELECT 1`.then(() => true).catch(() => false)
    return await Promise.race([ping, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
