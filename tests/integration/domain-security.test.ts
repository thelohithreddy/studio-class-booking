// tests/integration/domain-security.test.ts
//
// Phase-4 attack principles applied to the Phase-5 domain endpoints, direct
// against the handlers. The UI is never involved.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { POST as classCreate, GET as classesList } from '@app/api/classes/route'
import { GET as classGet, PATCH as classPatch } from '@app/api/classes/[id]/route'
import { POST as memberCreate, GET as membersList } from '@app/api/members/route'
import { POST as roomCreate, GET as roomsList } from '@app/api/rooms/route'
import { POST as sessionCreate } from '@app/api/sessions/route'

import { createPrismaClient } from '@/lib/db'
import { createSession } from '@/server/auth/session'
import { hashPassword } from '@/server/auth/password'
import { UserRole } from '@/generated/prisma/enums'

import { resolveTestDatabaseUrl, truncateAll } from './helpers/test-db'

const testUrl = resolveTestDatabaseUrl()
const prisma = createPrismaClient(testUrl)
const pool = new Pool({ connectionString: testUrl })

afterAll(async () => {
  await prisma.$disconnect()
  await pool.end()
})

let seq = 0
let staffCookie: string
let instructorCookie: string

async function cookieFor(role: UserRole): Promise<string> {
  seq += 1
  const u = await prisma.user.create({
    data: {
      email: `dsec-${role}-${seq}@x.test`,
      name: 'U',
      role,
      passwordHash: await hashPassword('x'),
    },
  })
  return `studio_session=${(await createSession(u.id)).token}`
}

beforeEach(async () => {
  await truncateAll(pool)
  staffCookie = await cookieFor(UserRole.STAFF)
  instructorCookie = await cookieFor(UserRole.INSTRUCTOR)
})

function jreq(
  method: string,
  cookie: string | undefined,
  body?: unknown,
  url = 'http://localhost/api/x',
): Request {
  const headers: Record<string, string> = { host: 'localhost' }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const validClass = {
  title: 'C',
  description: 'd',
  discipline: 'y',
  defaultDurationMinutes: 60,
  defaultCapacity: 20,
}

describe('authentication + role enforcement on every new mutation', () => {
  it('unauthenticated → 401', async () => {
    expect((await classCreate(jreq('POST', undefined, validClass))).status).toBe(401)
    expect(
      (
        await memberCreate(
          jreq('POST', undefined, {
            name: 'A',
            email: 'a@x.test',
            membershipExpiresOn: '2027-01-01',
          }),
        )
      ).status,
    ).toBe(401)
    expect((await roomCreate(jreq('POST', undefined, { name: 'R' }))).status).toBe(401)
    expect((await roomsList(jreq('GET', undefined))).status).toBe(401)
  })

  it('instructor → 403 on every staff-only endpoint (classes/members/rooms)', async () => {
    expect((await classCreate(jreq('POST', instructorCookie, validClass))).status).toBe(403)
    expect((await classesList(jreq('GET', instructorCookie))).status).toBe(403)
    expect(
      (
        await memberCreate(
          jreq('POST', instructorCookie, {
            name: 'A',
            email: 'a@x.test',
            membershipExpiresOn: '2027-01-01',
          }),
        )
      ).status,
    ).toBe(403)
    expect((await membersList(jreq('GET', instructorCookie))).status).toBe(403)
    expect((await roomCreate(jreq('POST', instructorCookie, { name: 'R' }))).status).toBe(403)
    expect((await roomsList(jreq('GET', instructorCookie))).status).toBe(403)
  })
})

describe('mass assignment is rejected, not silently accepted', () => {
  it('rejects server-managed fields on a class create (400)', async () => {
    for (const evil of [
      { id: 'x' },
      { createdAt: 'now' },
      { archivedAt: 'now' },
      { updatedAt: 'now' },
    ]) {
      expect(
        (await classCreate(jreq('POST', staffCookie, { ...validClass, ...evil }))).status,
      ).toBe(400)
    }
  })

  it('cannot set bookedCount or endsAt on a session create (400)', async () => {
    const klass = await prisma.class.create({ data: validClass })
    const instructor = await prisma.user.findFirstOrThrow({ where: { role: 'INSTRUCTOR' } })
    const room = await prisma.room.create({ data: { name: `msec-${seq}` } })
    const good = {
      classId: klass.id,
      startsAt: '2026-09-07T10:00:00Z',
      primaryInstructorId: instructor.id,
      roomId: room.id,
    }
    expect(
      (await sessionCreate(jreq('POST', staffCookie, { ...good, bookedCount: 99 }))).status,
    ).toBe(400)
    expect(
      (await sessionCreate(jreq('POST', staffCookie, { ...good, endsAt: '2026-09-07T20:00:00Z' })))
        .status,
    ).toBe(400)
    // The clean one succeeds — proving the rejection above was the extra field.
    expect((await sessionCreate(jreq('POST', staffCookie, good))).status).toBe(201)
  })

  it('a member create cannot smuggle a password/role (400)', async () => {
    const valid = { name: 'A', email: 'a@x.test', membershipExpiresOn: '2027-01-01' }
    expect(
      (await memberCreate(jreq('POST', staffCookie, { ...valid, password: 'x' }))).status,
    ).toBe(400)
    expect(
      (await memberCreate(jreq('POST', staffCookie, { ...valid, role: 'STAFF' }))).status,
    ).toBe(400)
    // And a successful member has no auth columns.
    const ok = await memberCreate(jreq('POST', staffCookie, valid))
    expect(ok.status).toBe(201)
    const rows = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      ['members'],
    )
    expect(rows.rows.map((r) => r.column_name)).not.toContain('password_hash')
  })
})

describe('IDOR / id substitution on the new id routes', () => {
  it('a non-uuid id is 404, never a 500 leak', async () => {
    expect((await classGet(jreq('GET', staffCookie), ctx('not-a-uuid'))).status).toBe(404)
    const res = await classPatch(jreq('PATCH', staffCookie, { title: 'x' }), ctx('%27%20OR%201=1'))
    expect(res.status).toBe(404)
    expect(await res.text()).not.toMatch(/prisma|P2007|syntax/i)
  })

  it('a well-formed but absent id is 404', async () => {
    expect(
      (await classGet(jreq('GET', staffCookie), ctx('00000000-0000-4000-8000-000000000000')))
        .status,
    ).toBe(404)
  })
})

describe('query manipulation and parameter pollution', () => {
  it('a role/instructorId query param does not grant an instructor access', async () => {
    const polluted = new Request('http://localhost/api/classes?role=STAFF&role=INSTRUCTOR', {
      method: 'GET',
      headers: { host: 'localhost', cookie: instructorCookie, 'x-role': 'STAFF' },
    })
    expect((await classesList(polluted)).status).toBe(403)
  })

  it('rejects out-of-range pagination with 400 (never over-fetches, never crashes)', async () => {
    await classCreate(jreq('POST', staffCookie, validClass))
    // page < 1 and pageSize > 100 are rejected at the boundary rather than
    // silently clamped — an over-large page size can never reach the query.
    const badPage = new Request('http://localhost/api/classes?page=-5', {
      method: 'GET',
      headers: { host: 'localhost', cookie: staffCookie },
    })
    expect((await classesList(badPage)).status).toBe(400)
    const badSize = new Request('http://localhost/api/classes?pageSize=99999', {
      method: 'GET',
      headers: { host: 'localhost', cookie: staffCookie },
    })
    expect((await classesList(badSize)).status).toBe(400)

    // A valid request works and reports its bounded page size.
    const ok = await classesList(
      jreq('GET', staffCookie, undefined, 'http://localhost/api/classes?pageSize=50'),
    )
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { pageSize: number }).pageSize).toBe(50)
  })
})

describe('no data leakage', () => {
  it('no endpoint response ever contains a password hash', async () => {
    const klass = await prisma.class.create({ data: validClass })
    const instructor = await prisma.user.findFirstOrThrow({ where: { role: 'INSTRUCTOR' } })
    const room = await prisma.room.create({ data: { name: `leak-${seq}` } })
    const created = await sessionCreate(
      jreq('POST', staffCookie, {
        classId: klass.id,
        startsAt: '2026-09-07T10:00:00Z',
        primaryInstructorId: instructor.id,
        roomId: room.id,
      }),
    )
    const text = await created.text()
    expect(text).not.toMatch(/passwordHash|password_hash/)
    // The instructor's name is present (Goal 5 display), the hash never is.
    expect(text).toContain('primaryInstructor')
  })
})
