// app/api/health/ready/route.ts
import { db } from '@/lib/db'
import { checkDatabaseReady } from '@/lib/health'

/**
 * Readiness probe. Unlike `/api/health` (liveness, DB-free) this verifies the
 * database answers a `SELECT 1`:
 *   200 { status: 'ready' }        — database reachable
 *   503 { status: 'unavailable' }  — database not reachable (or slow past the
 *                                    check's internal timeout)
 *
 * Public and unauthenticated (a probe carries no session), but it returns only
 * a fixed status token — never a connection string, error message, stack, or
 * any database detail. force-dynamic + no-store so a probe result is never
 * cached or prerendered.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  // Any failure — including db() itself throwing on a misconfigured environment
  // — is "not ready" (503), never a 500 that could surface a stack.
  let ready = false
  try {
    ready = await checkDatabaseReady(db())
  } catch {
    ready = false
  }
  return Response.json(
    { status: ready ? 'ready' : 'unavailable' },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
