// tests/integration/dashboard.test.ts
//
// The Goal-8 dashboard end to end: a KNOWN fixture with hand-computed expected
// values (never computed by calling getDashboard itself), each key metric also
// cross-checked against an INDEPENDENT direct SQL "domain truth" query, plus the
// authorization boundary (staff-only), half-open date boundaries, distinct
// waitlist, the 8-week bounded chart, empty state, a constant-query (no N+1)
// check, and parameter-pollution safety. STUDIO_TIMEZONE is UTC in tests.
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as dashboardRoute } from '@app/api/dashboard/route'

import { PrismaClient } from '@/generated/prisma/client'
import type { BookingStatus } from '@/generated/prisma/enums'
import { createPrismaClient } from '@/lib/db'
import { createSession as createAuthSession } from '@/server/auth/session'
import { hashPassword } from '@/server/auth/password'
import { getDashboard, type DashboardDto } from '@/server/reporting/dashboard'

import { resolveTestDatabaseUrl, truncateAll } from './helpers/test-db'

const testUrl = resolveTestDatabaseUrl()
const prisma = createPrismaClient(testUrl)
const pool = new Pool({ connectionString: testUrl })

afterAll(async () => {
  await prisma.$disconnect()
  await pool.end()
})

// A fixed "now": Wednesday 2026-09-16 12:00 UTC.
//   today       = [2026-09-16, 2026-09-17)
//   this week   = [2026-09-14 (Mon), 2026-09-21)
//   8-week chart window = [2026-07-27, 2026-09-21)
const NOW = new Date('2026-09-16T12:00:00Z')

let seq = 0
let staffCookie: string
let instructorCookie: string

async function mkClass(title: string): Promise<string> {
  seq += 1
  return (
    await prisma.class.create({
      data: {
        title,
        description: 'd',
        discipline: 'y',
        defaultDurationMinutes: 60,
        defaultCapacity: 50,
      },
    })
  ).id
}
async function mkSession(classId: string, startsAt: string): Promise<string> {
  seq += 1
  const inst = await prisma.user.create({
    data: { email: `db-i-${seq}@x.test`, name: `I${seq}`, role: 'INSTRUCTOR', passwordHash: 'x' },
  })
  const room = await prisma.room.create({ data: { name: `db-r-${seq}` } })
  const start = new Date(startsAt)
  return (
    await prisma.classSession.create({
      data: {
        classId,
        startsAt: start,
        durationMinutes: 60,
        endsAt: new Date(start.getTime() + 3_600_000),
        capacity: 50,
        primaryInstructorId: inst.id,
        roomId: room.id,
      },
    })
  ).id
}
async function mkMember(): Promise<string> {
  seq += 1
  return (
    await prisma.member.create({
      data: {
        name: `M${seq}`,
        email: `db-m-${seq}@x.test`,
        membershipExpiresOn: new Date('2027-12-01T00:00:00Z'),
      },
    })
  ).id
}
async function mkBooking(
  sessionId: string,
  memberId: string,
  status: BookingStatus,
  createdAt?: string,
): Promise<void> {
  await prisma.booking.create({
    data: { sessionId, memberId, status, ...(createdAt ? { createdAt: new Date(createdAt) } : {}) },
  })
}

/**
 * Seeds the known scenario. Expected values are derived from THIS definition by
 * hand (in the assertions), not from getDashboard.
 */
async function seedScenario() {
  const yoga = await mkClass('Yoga') // class A
  const pilates = await mkClass('Pilates') // class B

  // Sessions (class, startsAt). Boundaries are deliberate.
  const sA1 = await mkSession(yoga, '2026-09-16T00:00:00Z') // today (todayStart boundary, incl); this week
  const sA2 = await mkSession(yoga, '2026-09-16T10:00:00Z') // today; this week
  const sB1 = await mkSession(pilates, '2026-09-15T10:00:00Z') // this week, not today; PAST (< now)
  const sB2 = await mkSession(pilates, '2026-09-17T00:00:00Z') // tomorrowStart → NOT today; this week; upcoming
  const sA3 = await mkSession(yoga, '2026-09-09T10:00:00Z') // week bucket 2026-09-07..14
  const sOld = await mkSession(yoga, '2026-06-01T10:00:00Z') // > 8 weeks ago
  const sWkStart = await mkSession(yoga, '2026-09-14T00:00:00Z') // weekStart boundary (incl in this week)
  const sWkEnd = await mkSession(yoga, '2026-09-21T00:00:00Z') // weekEnd boundary (EXCLUDED from this week)
  const sFut1 = await mkSession(pilates, '2026-09-18T10:00:00Z') // upcoming
  const sFut2 = await mkSession(pilates, '2026-09-19T10:00:00Z') // upcoming

  const m: string[] = []
  for (let i = 0; i < 24; i += 1) m.push(await mkMember())
  const M10 = m[10]! // used twice (distinct-member waitlist)

  // created-today boundary: at todayStart (incl) and within today (incl); yesterday and tomorrowStart excluded.
  await mkBooking(sA1, m[0]!, 'BOOKED', '2026-09-16T00:00:00Z') // made today (boundary)
  await mkBooking(sA2, m[1]!, 'ATTENDED', '2026-09-16T09:00:00Z') // made today; current-week attendance
  await mkBooking(sB1, m[2]!, 'BOOKED', '2026-09-15T09:00:00Z') // made yesterday
  await mkBooking(sB2, m[3]!, 'BOOKED', '2026-09-17T00:00:00Z') // made at tomorrowStart (excluded)

  // no-shows: sessions in/out of this week + both week boundaries.
  await mkBooking(sA1, m[4]!, 'NO_SHOW') // sA1 this week → counts
  await mkBooking(sB1, m[5]!, 'NO_SHOW') // sB1 this week → counts
  await mkBooking(sA3, m[6]!, 'NO_SHOW') // last week → no
  await mkBooking(sOld, m[7]!, 'NO_SHOW') // old → no
  await mkBooking(sWkStart, m[8]!, 'NO_SHOW') // weekStart boundary → counts
  await mkBooking(sWkEnd, m[9]!, 'NO_SHOW') // weekEnd boundary → EXCLUDED

  // waitlist: distinct members on UPCOMING sessions; a past-session waitlist is excluded.
  await mkBooking(sFut1, M10, 'WAITLISTED') // M10 upcoming
  await mkBooking(sFut2, M10, 'WAITLISTED') // M10 again (distinct → 1)
  await mkBooking(sFut1, m[11]!, 'WAITLISTED') // M11 upcoming
  await mkBooking(sB1, m[12]!, 'WAITLISTED') // sB1 past → excluded

  // attendance per week: current week ×2, week-1 ×1, and one older-than-8-weeks (must NOT leak).
  await mkBooking(sA1, m[20]!, 'ATTENDED') // current week (2nd; b for sA2 above is the 1st)
  await mkBooking(sA3, m[21]!, 'ATTENDED') // week 2026-09-07..14
  await mkBooking(sOld, m[22]!, 'ATTENDED') // > 8 weeks ago → excluded from chart
}

beforeEach(async () => {
  await truncateAll(pool)
  seq += 1
  const staff = await prisma.user.create({
    data: {
      email: `db-s-${seq}@x.test`,
      name: 'S',
      role: 'STAFF',
      passwordHash: await hashPassword('x'),
    },
  })
  staffCookie = `studio_session=${(await createAuthSession(staff.id)).token}`
  const inst = await prisma.user.create({
    data: { email: `db-inst-${seq}@x.test`, name: 'I', role: 'INSTRUCTOR', passwordHash: 'x' },
  })
  instructorCookie = `studio_session=${(await createAuthSession(inst.id)).token}`
})

/** Independent "domain truth" counts via direct SQL (not via getDashboard). */
async function truth(sql: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query(sql, params)
  return Number(r.rows[0].n)
}

describe('dashboard metrics — exact values vs a known fixture + independent SQL', () => {
  it('computes every headline number correctly (with half-open boundaries)', async () => {
    await seedScenario()
    const d = await getDashboard(prisma, NOW)

    expect(d.headline.sessionsToday).toBe(2)
    expect(d.headline.bookingsMadeToday).toBe(2)
    expect(d.headline.noShowsThisWeek).toBe(3)
    expect(d.headline.membersWaitlisted).toBe(2)

    // Independent cross-checks (different SQL phrasing than the implementation).
    expect(d.headline.sessionsToday).toBe(
      await truth(
        `SELECT count(*) n FROM class_sessions WHERE starts_at >= $1 AND starts_at < $2`,
        ['2026-09-16T00:00:00Z', '2026-09-17T00:00:00Z'],
      ),
    )
    expect(d.headline.noShowsThisWeek).toBe(
      await truth(
        `SELECT count(*) n FROM bookings b JOIN class_sessions s ON s.id=b.session_id
         WHERE b.status='NO_SHOW' AND s.starts_at >= $1 AND s.starts_at < $2`,
        ['2026-09-14T00:00:00Z', '2026-09-21T00:00:00Z'],
      ),
    )
    expect(d.headline.membersWaitlisted).toBe(
      await truth(
        `SELECT count(DISTINCT b.member_id) n FROM bookings b JOIN class_sessions s ON s.id=b.session_id
         WHERE b.status='WAITLISTED' AND s.starts_at >= $1`,
        [NOW.toISOString()],
      ),
    )
  })

  it('breaks bookings down by status (all five, explicit zeros, fixed order)', async () => {
    await seedScenario()
    const d = await getDashboard(prisma, NOW)
    expect(d.bookingsByStatus).toEqual([
      { status: 'BOOKED', count: 3 },
      { status: 'WAITLISTED', count: 4 },
      { status: 'CANCELLED', count: 0 }, // a status with zero bookings still appears
      { status: 'ATTENDED', count: 4 },
      { status: 'NO_SHOW', count: 6 },
    ])
  })

  it('breaks bookings down by class (ordered by count desc)', async () => {
    await seedScenario()
    const d = await getDashboard(prisma, NOW)
    expect(d.bookingsByClass).toEqual([
      { classId: expect.any(String), classTitle: 'Yoga', count: 10 },
      { classId: expect.any(String), classTitle: 'Pilates', count: 7 },
    ])
  })

  it('charts attendance per week over the last 8 weeks (bounded; nothing older leaks)', async () => {
    await seedScenario()
    const d = await getDashboard(prisma, NOW)
    expect(d.attendanceByWeek).toHaveLength(8)
    // Current week (2026-09-14) = 2 attended; week 2026-09-07 = 1; all others 0.
    const byWeek = Object.fromEntries(d.attendanceByWeek.map((w) => [w.weekStart, w.attended]))
    expect(byWeek['2026-09-14']).toBe(2)
    expect(byWeek['2026-09-07']).toBe(1)
    expect(d.attendanceByWeek.reduce((s, w) => s + w.attended, 0)).toBe(3) // the old ATTENDED is excluded
    // Labels are the 8 studio-local Mondays, oldest → newest.
    expect(d.attendanceByWeek[0]!.weekStart).toBe('2026-07-27')
    expect(d.attendanceByWeek[7]!.weekStart).toBe('2026-09-14')
  })

  it('is internally consistent: sum(byStatus) == sum(byClass) == total bookings', async () => {
    await seedScenario()
    const d = await getDashboard(prisma, NOW)
    const total = await truth(`SELECT count(*) n FROM bookings`)
    expect(d.bookingsByStatus.reduce((s, r) => s + r.count, 0)).toBe(total)
    expect(d.bookingsByClass.reduce((s, r) => s + r.count, 0)).toBe(total)
    expect(total).toBe(17)
    // Every count is a JS number (no BigInt leaked from raw SQL).
    expect(typeof d.headline.membersWaitlisted).toBe('number')
    expect(d.bookingsByClass.every((r) => typeof r.count === 'number')).toBe(true)
  })

  it('by-class ordering is deterministic even when two classes share a title', async () => {
    const z1 = await mkClass('Zumba')
    const z2 = await mkClass('Zumba')
    const s1 = await mkSession(z1, '2026-09-16T08:00:00Z')
    const s2 = await mkSession(z2, '2026-09-16T09:00:00Z')
    await mkBooking(s1, await mkMember(), 'BOOKED')
    await mkBooking(s2, await mkMember(), 'BOOKED')
    const a = await getDashboard(prisma, NOW)
    const b = await getDashboard(prisma, NOW)
    expect(a.bookingsByClass.map((r) => r.classId)).toEqual(b.bookingsByClass.map((r) => r.classId))
  })
})

describe('dashboard — empty state', () => {
  it('returns all-zero metrics, 8 zero weeks, and serializes cleanly (no BigInt)', async () => {
    const d = await getDashboard(prisma, NOW)
    expect(d.headline).toEqual({
      sessionsToday: 0,
      bookingsMadeToday: 0,
      noShowsThisWeek: 0,
      membersWaitlisted: 0,
    })
    expect(d.bookingsByStatus.map((r) => r.count)).toEqual([0, 0, 0, 0, 0])
    expect(d.bookingsByClass).toEqual([])
    expect(d.attendanceByWeek).toHaveLength(8)
    expect(d.attendanceByWeek.every((w) => w.attended === 0)).toBe(true)
    expect(() => JSON.stringify(d)).not.toThrow() // BigInt would throw here
  })
})

describe('dashboard — authorization (staff-only) and parameter safety', () => {
  const req = (cookie?: string, qs = '') =>
    new Request(`http://localhost/api/dashboard${qs}`, {
      method: 'GET',
      headers: { host: 'localhost', ...(cookie ? { cookie } : {}) },
    })

  it('unauthenticated → 401', async () => {
    expect((await dashboardRoute(req())).status).toBe(401)
  })

  it('an instructor → 403 (no studio-wide data reaches a scoped role)', async () => {
    const res = await dashboardRoute(req(instructorCookie))
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden')
  })

  it('staff → 200 with the DTO shape (route uses real now; values are shape-checked)', async () => {
    await seedScenario()
    const res = await dashboardRoute(req(staffCookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as DashboardDto
    // Shape + all-time (time-invariant) totals — exact time-boxed values are
    // proven at the domain level with a fixed `now` above.
    expect(Object.values(body.headline).every((v) => typeof v === 'number')).toBe(true)
    expect(body.bookingsByStatus).toHaveLength(5)
    expect(body.bookingsByStatus.reduce((s, r) => s + r.count, 0)).toBe(17)
    expect(body.bookingsByClass.reduce((s, r) => s + r.count, 0)).toBe(17)
    expect(body.attendanceByWeek).toHaveLength(8)
  })

  it('ignores unexpected/hostile query parameters (no filter surface, no injection)', async () => {
    await seedScenario()
    const clean = (await (await dashboardRoute(req(staffCookie))).json()) as DashboardDto
    const polluted = (await (
      await dashboardRoute(
        req(staffCookie, `?classId=x&status=${encodeURIComponent("' OR 1=1--")}&foo=bar&foo=baz`),
      )
    ).json()) as DashboardDto
    // Params have no effect: identical result, and the tables still stand.
    expect(polluted.headline).toEqual(clean.headline)
    expect(await truth(`SELECT count(*) n FROM bookings`)).toBe(17)
  })
})

describe('dashboard — no N+1 (constant query count vs dataset size)', () => {
  it('issues the same number of queries for a small and a large fixture', async () => {
    const makeLogged = () => {
      const client = new PrismaClient({
        adapter: new PrismaPg({ connectionString: testUrl }),
        log: [{ level: 'query', emit: 'event' }],
      })
      let count = 0
      client.$on('query', () => {
        count += 1
      })
      return { client, count: () => count }
    }

    // Small dataset.
    const c = await mkClass('C')
    const s = await mkSession(c, '2026-09-16T08:00:00Z')
    await mkBooking(s, await mkMember(), 'ATTENDED')
    const a = makeLogged()
    await getDashboard(a.client as never, NOW)
    await a.client.$disconnect()

    // Larger dataset (more classes/sessions/bookings).
    for (let i = 0; i < 6; i += 1) {
      const ci = await mkClass(`C${i}`)
      const si = await mkSession(ci, `2026-09-16T${10 + i}:00:00Z`)
      for (let j = 0; j < 4; j += 1) await mkBooking(si, await mkMember(), 'BOOKED')
    }
    const b = makeLogged()
    await getDashboard(b.client as never, NOW)
    await b.client.$disconnect()

    expect(a.count()).toBeGreaterThan(0)
    expect(b.count()).toBe(a.count()) // constant → aggregation, not per-row N+1
  })
})
