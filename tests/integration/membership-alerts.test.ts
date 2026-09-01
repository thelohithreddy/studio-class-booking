// tests/integration/membership-alerts.test.ts
//
// Membership expiry alerts (Goal 10) end to end: eligibility boundaries, the
// expiry-keyed dismissal lifecycle (dismiss / extend-reappears / shorten-appears
// / re-set-stays-dismissed), idempotency, concurrency, authorization, mass
// assignment, and no-N+1 — with hand-computed expectations AND an independent
// direct-SQL oracle. STUDIO_TIMEZONE is UTC in tests.
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as alertsList } from '@app/api/members/alerts/route'
import { POST as alertDismiss } from '@app/api/members/[id]/alert-dismiss/route'

import { PrismaClient } from '@/generated/prisma/client'
import { createPrismaClient } from '@/lib/db'
import { createSession as createAuthSession } from '@/server/auth/session'
import { hashPassword } from '@/server/auth/password'
import { dismissMembershipAlert, listMembershipAlerts } from '@/server/domain/alerts'
import type { SessionUser } from '@/server/auth/session'
import type { MembershipAlertsDto } from '@/lib/alerts-dto'

import { resolveTestDatabaseUrl, truncateAll } from './helpers/test-db'

const testUrl = resolveTestDatabaseUrl()
const prisma = createPrismaClient(testUrl)
const pool = new Pool({ connectionString: testUrl })

afterAll(async () => {
  await prisma.$disconnect()
  await pool.end()
})

// Fixed "now": Wed 2026-09-16 12:00 UTC → today 2026-09-16, cutoff (today+7) 2026-09-23.
const NOW = new Date('2026-09-16T12:00:00Z')

let seq = 0
let staffUser: SessionUser
let staffCookie: string
let instructorCookie: string

async function mkMember(name: string, expiresOn: string): Promise<string> {
  seq += 1
  return (
    await prisma.member.create({
      data: {
        name,
        email: `ma-m-${seq}@x.test`,
        membershipExpiresOn: new Date(`${expiresOn}T00:00:00Z`),
      },
    })
  ).id
}
async function setExpiry(memberId: string, expiresOn: string) {
  await prisma.member.update({
    where: { id: memberId },
    data: { membershipExpiresOn: new Date(`${expiresOn}T00:00:00Z`) },
  })
}
async function dismissalRowCount(memberId: string): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int n FROM membership_alert_dismissals WHERE member_id=$1`,
    [memberId],
  )
  return r.rows[0].n
}

beforeEach(async () => {
  await truncateAll(pool)
  seq += 1
  const staff = await prisma.user.create({
    data: {
      email: `ma-s-${seq}@x.test`,
      name: 'S',
      role: 'STAFF',
      passwordHash: await hashPassword('x'),
    },
  })
  staffUser = { id: staff.id, email: staff.email, name: staff.name, role: 'STAFF' }
  staffCookie = `studio_session=${(await createAuthSession(staff.id)).token}`
  const inst = await prisma.user.create({
    data: { email: `ma-i-${seq}@x.test`, name: 'I', role: 'INSTRUCTOR', passwordHash: 'x' },
  })
  instructorCookie = `studio_session=${(await createAuthSession(inst.id)).token}`
})

describe('membership-alert eligibility (date-only, studio-local)', () => {
  it('alerts iff expiry <= today+7 (expired + today + up to the 7th day), ordered by expiry', async () => {
    const expiredOld = await mkMember('Expired Old', '2026-09-01') // -15
    const expiredYest = await mkMember('Expired Yesterday', '2026-09-15') // -1
    const today = await mkMember('Today', '2026-09-16') // 0
    const day6 = await mkMember('Day Six', '2026-09-22') // +6
    const day7 = await mkMember('Day Seven', '2026-09-23') // +7 (boundary IN)
    await mkMember('Day Eight', '2026-09-24') // +8 (boundary OUT)
    await mkMember('Far Future', '2027-01-01') // OUT

    const { alerts, count } = await listMembershipAlerts(prisma, NOW)
    expect(alerts.map((a) => a.memberId)).toEqual([expiredOld, expiredYest, today, day6, day7])
    expect(count).toBe(5)
    expect(alerts.map((a) => a.daysRemaining)).toEqual([-15, -1, 0, 6, 7]) // date-only, exact
    expect(alerts[0]!.membershipExpiresOn).toBe('2026-09-01')

    // Independent oracle (different phrasing than the implementation).
    const r = await pool.query(
      `SELECT count(*)::int n FROM members m WHERE m.membership_expires_on <= '2026-09-23'::date
         AND NOT EXISTS (SELECT 1 FROM membership_alert_dismissals d WHERE d.member_id=m.id AND d.membership_expires_on=m.membership_expires_on)`,
    )
    expect(count).toBe(r.rows[0].n)
  })

  it('data-minimized: exposes only memberId, name, expiry (date string), daysRemaining', async () => {
    await mkMember('Alice', '2026-09-20')
    const { alerts } = await listMembershipAlerts(prisma, NOW)
    expect(Object.keys(alerts[0]!).sort()).toEqual([
      'daysRemaining',
      'memberId',
      'membershipExpiresOn',
      'name',
    ])
  })
})

describe('dismissal lifecycle (expiry-keyed — Decision 11)', () => {
  it('dismiss hides the alert; extending to a new eligible value makes it reappear', async () => {
    const m = await mkMember('Bob', '2026-09-22') // eligible
    expect((await listMembershipAlerts(prisma, NOW)).count).toBe(1)

    await dismissMembershipAlert(prisma, staffUser, m, NOW)
    expect((await listMembershipAlerts(prisma, NOW)).count).toBe(0) // hidden

    // Extend to a LATER but still-eligible date (a different value) → reappears.
    await setExpiry(m, '2026-09-23')
    const after = await listMembershipAlerts(prisma, NOW)
    expect(after.alerts.map((a) => a.memberId)).toEqual([m])
    expect(after.alerts[0]!.daysRemaining).toBe(7)
  })

  it('re-setting to the previously-dismissed EXACT date stays dismissed (accepted edge)', async () => {
    const m = await mkMember('Carol', '2026-09-22')
    await dismissMembershipAlert(prisma, staffUser, m, NOW)
    await setExpiry(m, '2026-12-31') // far future — not eligible, not shown
    await setExpiry(m, '2026-09-22') // back to the dismissed value
    expect((await listMembershipAlerts(prisma, NOW)).count).toBe(0) // still dismissed
  })

  it('shortening a far-future membership into the window makes it appear', async () => {
    const m = await mkMember('Dave', '2027-06-01') // not eligible
    expect((await listMembershipAlerts(prisma, NOW)).count).toBe(0)
    await setExpiry(m, '2026-09-20') // now within the window, no dismissal for it
    expect((await listMembershipAlerts(prisma, NOW)).alerts.map((a) => a.memberId)).toEqual([m])
  })

  it('dismissing a member whose current expiry is BEYOND the window records nothing (so it still returns later)', async () => {
    const m = await mkMember('Grace', '2027-06-01') // far future — not eligible
    await dismissMembershipAlert(prisma, staffUser, m, NOW) // graceful no-op
    expect(await dismissalRowCount(m)).toBe(0) // NOTHING recorded — no pre-suppression
    // The far-future date later falling within the window must still alert.
    await setExpiry(m, '2026-09-22')
    expect((await listMembershipAlerts(prisma, NOW)).count).toBe(1)
  })

  it('a member at the today+7 boundary is both listed AND dismissable (guard matches the list)', async () => {
    const m = await mkMember('Hank', '2026-09-23') // today+7 — the inclusive boundary
    expect((await listMembershipAlerts(prisma, NOW)).alerts.map((a) => a.memberId)).toContain(m)
    await dismissMembershipAlert(prisma, staffUser, m, NOW) // must RECORD (not a no-op)
    expect(await dismissalRowCount(m)).toBe(1)
    expect((await listMembershipAlerts(prisma, NOW)).alerts.map((a) => a.memberId)).not.toContain(m)
  })

  it('dismiss is idempotent — a repeat leaves exactly one dismissal row', async () => {
    const m = await mkMember('Eve', '2026-09-20')
    await dismissMembershipAlert(prisma, staffUser, m, NOW)
    await dismissMembershipAlert(prisma, staffUser, m, NOW)
    expect(await dismissalRowCount(m)).toBe(1)
    expect((await listMembershipAlerts(prisma, NOW)).count).toBe(0)
  })

  it('concurrent dismissals leave exactly one row (no duplicate, no error)', async () => {
    const m = await mkMember('Frank', '2026-09-20')
    await Promise.all([
      dismissMembershipAlert(prisma, staffUser, m, NOW),
      dismissMembershipAlert(prisma, staffUser, m, NOW),
      dismissMembershipAlert(prisma, staffUser, m, NOW),
    ])
    expect(await dismissalRowCount(m)).toBe(1)
  })
})

describe('membership alerts — HTTP authorization + safety', () => {
  const getReq = (cookie?: string, qs = '') =>
    new Request(`http://localhost/api/members/alerts${qs}`, {
      method: 'GET',
      headers: { host: 'localhost', ...(cookie ? { cookie } : {}) },
    })
  const dismissReq = (id: string, cookie?: string, body?: unknown) =>
    new Request(`http://localhost/api/members/${id}/alert-dismiss`, {
      method: 'POST',
      headers: {
        host: 'localhost',
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  it('GET alerts: 401 unauth · 403 instructor · 200 staff', async () => {
    // The route uses the REAL now, so seed a member expiring within 7 days of it.
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    await mkMember('G', soon)
    expect((await alertsList(getReq())).status).toBe(401)
    expect((await alertsList(getReq(instructorCookie))).status).toBe(403)
    const ok = await alertsList(getReq(staffCookie))
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as MembershipAlertsDto).alerts.length).toBeGreaterThanOrEqual(1)
  })

  it('GET alerts ignores hostile/unexpected query params (no filter surface)', async () => {
    await mkMember('H', '2026-09-20')
    const clean = (await (await alertsList(getReq(staffCookie))).json()) as MembershipAlertsDto
    const polluted = (await (
      await alertsList(
        getReq(
          staffCookie,
          `?memberId=x&expiresOn=2099-01-01&q=${encodeURIComponent("' OR 1=1--")}`,
        ),
      )
    ).json()) as MembershipAlertsDto
    expect(polluted.count).toBe(clean.count)
  })

  it('POST dismiss: 401 unauth · 403 instructor · 204 staff · 404 missing member', async () => {
    const m = await mkMember('I', '2026-09-20')
    expect((await alertDismiss(dismissReq(m), ctx(m))).status).toBe(401)
    expect((await alertDismiss(dismissReq(m, instructorCookie), ctx(m))).status).toBe(403)
    expect((await alertDismiss(dismissReq(m, staffCookie), ctx(m))).status).toBe(204)
    const ghost = '00000000-0000-4000-8000-000000000000'
    expect((await alertDismiss(dismissReq(ghost, staffCookie), ctx(ghost))).status).toBe(404)
  })

  it('POST dismiss rejects mass-assignment and a malformed id (400 / 404, never 500)', async () => {
    const m = await mkMember('J', '2026-09-20')
    // Smuggled fields → 400 (strict body); the expiry/actor never come from the client.
    expect(
      (
        await alertDismiss(
          dismissReq(m, staffCookie, { membershipExpiresOn: '2099-01-01' }),
          ctx(m),
        )
      ).status,
    ).toBe(400)
    expect(
      (await alertDismiss(dismissReq(m, staffCookie, { dismissedById: 'x' }), ctx(m))).status,
    ).toBe(400)
    const bad = "not-a-uuid'; DROP TABLE members;--"
    expect((await alertDismiss(dismissReq(bad, staffCookie, {}), ctx(bad))).status).toBe(404)
    expect(await prisma.member.count()).toBeGreaterThanOrEqual(1) // table intact
  })

  it('records the staff actor from the session, never the request body', async () => {
    // Eligible relative to the route's REAL now (the dismiss guard uses it).
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    const m = await mkMember('K', soon)
    await alertDismiss(
      dismissReq(m, staffCookie, { dismissedById: '11111111-1111-4111-8111-111111111111' }),
      ctx(m),
    )
    // The 400 above means nothing was inserted for the smuggled body; a clean dismiss records the real actor.
    await alertDismiss(dismissReq(m, staffCookie, {}), ctx(m))
    const r = await pool.query(
      `SELECT dismissed_by_id FROM membership_alert_dismissals WHERE member_id=$1`,
      [m],
    )
    expect(r.rows[0].dismissed_by_id).toBe(staffUser.id)
  })
})

describe('membership alerts — no N+1', () => {
  it('issues the same number of queries for 1 and for 20 eligible members', async () => {
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
    await mkMember('one', '2026-09-20')
    const a = makeLogged()
    await listMembershipAlerts(a.client as never, NOW)
    await a.client.$disconnect()

    for (let i = 0; i < 20; i += 1) await mkMember(`m${i}`, '2026-09-21')
    const b = makeLogged()
    await listMembershipAlerts(b.client as never, NOW)
    await b.client.$disconnect()

    expect(a.count()).toBeGreaterThan(0)
    expect(b.count()).toBe(a.count()) // one query regardless of member count
  })
})
