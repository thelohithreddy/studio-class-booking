// src/server/reporting/dashboard.ts
import type { Db } from '@/lib/db'
import { env } from '@/lib/env'
import { Prisma } from '@/generated/prisma/client'
import type { BookingStatus } from '@/generated/prisma/enums'
import { studioDateToUtc, studioToday } from '@/server/domain/membership'
import type { DashboardDto } from '@/lib/dashboard-dto'

// Re-exported so callers/tests keep importing the wire contract + UI helper from
// the reporting module; the definitions live in the client-safe @/lib module.
export type { DashboardDto } from '@/lib/dashboard-dto'
export { barHeightPercent } from '@/lib/dashboard-dto'

/**
 * Goal 8: the studio operational dashboard. This is a STUDIO-WIDE, STAFF-ONLY
 * report (decisions.md #17). Its single entry point is GET /api/dashboard, which
 * gates on requireCapability('dashboard:studio') BEFORE calling this — so every
 * caller is STAFF and the studio-wide scope is correct by construction (the
 * landing page is a thin client view that fetches that route; it does no
 * authorization of its own). There is deliberately NO scope predicate and NO
 * scope fragment (sessionScopeWhere(staff) is empty): an instructor dashboard,
 * if ever required, would be a SEPARATE scope-filtered query, never this one.
 * These aggregations MUST stay behind that capability guard.
 *
 * Every metric is computed by a bounded DB AGGREGATION (COUNT / GROUP BY) — no
 * domain rows are loaded into JS and reduced. The seven queries are independent
 * reads run concurrently; the result is a snapshot "as of generatedAt" (per-query
 * consistency is acceptable for an operational dashboard). All day/week windows
 * are studio-local, half-open [start, end), DST-correct via the shared helpers.
 */

const STATUS_ORDER: readonly BookingStatus[] = [
  'BOOKED',
  'WAITLISTED',
  'CANCELLED',
  'ATTENDED',
  'NO_SHOW',
]

export interface DashboardWindows {
  todayStart: Date
  tomorrowStart: Date
  weekStart: Date
  weekEnd: Date
  /** 9 UTC instants w[0..8]: the studio-local Monday boundaries of the last 8 weeks (w[7] = this week's Monday, w[8] = next Monday). */
  weekBoundaries: Date[]
  /** 8 studio-local Monday dates (YYYY-MM-DD), oldest → newest — one label per chart bucket. */
  weekStartLabels: string[]
}

/** A calendar date (YYYY-MM-DD) shifted by whole days, in pure UTC-calendar
 * arithmetic (UTC has no DST, so the shift never drifts); the timezone
 * conversion happens per-date via studioDateToUtc. */
function isoDatePlusDays(isoDate: string, days: number): string {
  const ms = new Date(`${isoDate}T00:00:00.000Z`).getTime() + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The studio-local day and week windows for `now`, as UTC instants. Weeks are
 * ISO (Monday-start), studio-local. The SAME boundary array feeds both "this
 * week" (w[7]..w[8]) and the 8-week chart (buckets [w[i], w[i+1])), so they can
 * never disagree. Pure and deterministic (given `now`) — unit-tested.
 */
export function computeWindows(now: Date): DashboardWindows {
  const todayLocal = studioToday(now) // UTC-midnight Date representing the studio-local date
  const todayIso = todayLocal.toISOString().slice(0, 10)
  const todayStart = studioDateToUtc(todayIso)
  const tomorrowStart = studioDateToUtc(isoDatePlusDays(todayIso, 1))

  // Monday of the current studio-local week. getUTCDay() on the UTC-midnight
  // local-date Date gives the local weekday (0=Sun … 6=Sat).
  const daysSinceMonday = (todayLocal.getUTCDay() + 6) % 7
  const mondayIso = isoDatePlusDays(todayIso, -daysSinceMonday)

  const weekBoundaries: Date[] = []
  const weekStartLabels: string[] = []
  for (let j = 0; j <= 8; j += 1) {
    const label = isoDatePlusDays(mondayIso, (j - 7) * 7)
    weekBoundaries.push(studioDateToUtc(label))
    if (j <= 7) weekStartLabels.push(label)
  }

  return {
    todayStart,
    tomorrowStart,
    weekStart: weekBoundaries[7]!,
    weekEnd: weekBoundaries[8]!,
    weekBoundaries,
    weekStartLabels,
  }
}

export async function getDashboard(db: Db, now: Date = new Date()): Promise<DashboardDto> {
  const w = computeWindows(now)
  const thresholds = w.weekBoundaries.map((d) => d.getTime() / 1000) // epoch seconds

  const [
    sessionsToday,
    bookingsMadeToday,
    noShowsThisWeek,
    waitlistedRows,
    byStatusRows,
    byClassRows,
    attendanceRows,
  ] = await Promise.all([
    // 1. Sessions scheduled today (any class; sessions have no archived state).
    db.classSession.count({ where: { startsAt: { gte: w.todayStart, lt: w.tomorrowStart } } }),
    // 2. Bookings whose row was created today (any current status).
    db.booking.count({ where: { createdAt: { gte: w.todayStart, lt: w.tomorrowStart } } }),
    // 3. No-shows for sessions occurring this week.
    db.booking.count({
      where: { status: 'NO_SHOW', session: { startsAt: { gte: w.weekStart, lt: w.weekEnd } } },
    }),
    // 4. Distinct members currently waitlisted for an UPCOMING session. Filtering
    //    to starts_at >= now excludes orphaned WAITLISTED rows on already-passed
    //    sessions (decisions.md #24 guarantees those persist unpromoted), so the
    //    number reflects members actually waiting for a spot. ::int → JS number
    //    (a raw bigint would surface as BigInt and break JSON serialization).
    db.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT b.member_id)::int AS n
      FROM bookings b JOIN class_sessions s ON s.id = b.session_id
      WHERE b.status = 'WAITLISTED' AND s.starts_at >= ${now}`,
    // 5. All bookings grouped by status (all-time; no period stated).
    db.booking.groupBy({ by: ['status'], _count: { _all: true } }),
    // 6. All bookings grouped by the session's class (all-time). class_id is the
    //    final tiebreaker so the order is total even when two classes share a
    //    title (Class.title is not unique).
    db.$queryRaw<{ class_id: string; title: string; n: number }[]>`
      SELECT s.class_id, c.title, count(*)::int AS n
      FROM bookings b
        JOIN class_sessions s ON s.id = b.session_id
        JOIN classes c ON c.id = s.class_id
      GROUP BY s.class_id, c.title
      ORDER BY count(*) DESC, c.title ASC, s.class_id ASC`,
    // 7. ATTENDED bookings per studio-local week over the last 8 weeks. Bounded to
    //    [w0, w8) so width_bucket only ever yields buckets 1..8 (an unbounded
    //    query would drop everything older than 8 weeks into bucket 0 and scan
    //    all history). Reconciled into the fixed 8 buckets (0-filled) in JS.
    db.$queryRaw<{ bucket: number; n: number }[]>(Prisma.sql`
      SELECT width_bucket(extract(epoch FROM s.starts_at), ARRAY[${Prisma.join(thresholds)}]::float8[]) AS bucket,
             count(*)::int AS n
      FROM bookings b JOIN class_sessions s ON s.id = b.session_id
      WHERE b.status = 'ATTENDED'
        AND s.starts_at >= ${w.weekBoundaries[0]} AND s.starts_at < ${w.weekBoundaries[8]}
      GROUP BY bucket`),
  ])

  const byStatusCount = new Map(byStatusRows.map((r) => [r.status, r._count._all]))
  const bookingsByStatus = STATUS_ORDER.map((status) => ({
    status,
    count: byStatusCount.get(status) ?? 0,
  }))

  const bucketCount = new Map(attendanceRows.map((r) => [r.bucket, r.n]))
  const attendanceByWeek = w.weekStartLabels.map((weekStart, i) => ({
    weekStart,
    attended: bucketCount.get(i + 1) ?? 0, // bucket i+1 covers [w[i], w[i+1])
  }))

  return {
    generatedAt: now.toISOString(),
    timezone: env().STUDIO_TIMEZONE,
    headline: {
      sessionsToday,
      bookingsMadeToday,
      noShowsThisWeek,
      membersWaitlisted: waitlistedRows[0]?.n ?? 0,
    },
    bookingsByStatus,
    bookingsByClass: byClassRows.map((r) => ({
      classId: r.class_id,
      classTitle: r.title,
      count: r.n,
    })),
    attendanceByWeek,
  }
}
