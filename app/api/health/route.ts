import { NextResponse } from 'next/server'

/**
 * Liveness probe.
 *
 * Deliberately does not touch the database: this answers "is the process
 * serving requests", which is what a host's health check needs to decide
 * whether to restart or route traffic. A database round-trip here would turn
 * a transient Postgres blip into a restart loop. Database readiness gets its
 * own check once there is a schema to check against.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ status: 'ok', time: new Date().toISOString() })
}
