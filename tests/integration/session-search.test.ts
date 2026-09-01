// tests/integration/session-search.test.ts
//
// The sessions list's half-open [from, to) date-range filter (Phase 7), scoped
// and index-supported.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as sessionsList } from '@app/api/sessions/route'

import { createPrismaClient } from '@/lib/db'
import { createSession } from '@/server/auth/session'
import { hashPassword } from '@/server/auth/password'

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
let instructorId: string
let instructorCookie: string

async function makeSessionAt(startsAt: string, primaryInstructorId?: string): Promise<string> {
  seq += 1
  // Fresh instructor per session by default so overlapping times never trip the
  // instructor-overlap constraint; the scope test passes the shared instructor.
  const inst =
    primaryInstructorId ??
    (
      await prisma.user.create({
        data: { email: `ss-si-${seq}@x.test`, name: 'I', role: 'INSTRUCTOR', passwordHash: 'x' },
      })
    ).id
  const c = await prisma.class.create({
    data: {
      title: `C${seq}`,
      description: 'd',
      discipline: 'y',
      defaultDurationMinutes: 60,
      defaultCapacity: 10,
    },
  })
  const r = await prisma.room.create({ data: { name: `ss-r-${seq}` } })
  const s = await prisma.classSession.create({
    data: {
      classId: c.id,
      startsAt: new Date(startsAt),
      durationMinutes: 60,
      endsAt: new Date(new Date(startsAt).getTime() + 3600000),
      capacity: 10,
      primaryInstructorId: inst,
      roomId: r.id,
    },
  })
  return s.id
}

beforeEach(async () => {
  await truncateAll(pool)
  seq += 1
  const staff = await prisma.user.create({
    data: {
      email: `ss-s-${seq}@x.test`,
      name: 'S',
      role: 'STAFF',
      passwordHash: await hashPassword('x'),
    },
  })
  staffCookie = `studio_session=${(await createSession(staff.id)).token}`
  const inst = await prisma.user.create({
    data: {
      email: `ss-i-${seq}@x.test`,
      name: 'I',
      role: 'INSTRUCTOR',
      passwordHash: await hashPassword('x'),
    },
  })
  instructorId = inst.id
  instructorCookie = `studio_session=${(await createSession(inst.id)).token}`
})

function req(path: string, cookie: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: { host: 'localhost', cookie },
  })
}
async function list(path: string, cookie = staffCookie) {
  const res = await sessionsList(req(path, cookie))
  return {
    status: res.status,
    body:
      res.status === 200
        ? ((await res.json()) as { sessions: Array<{ id: string }>; total: number })
        : null,
  }
}

describe('sessions date-range filter (half-open [from, to))', () => {
  it('includes from-inclusive and excludes to-exclusive (no end-of-day bug)', async () => {
    const inRange = await makeSessionAt('2026-09-07T10:00:00Z')
    const atFrom = await makeSessionAt('2026-09-01T00:00:00Z') // exactly `from` → included
    const atTo = await makeSessionAt('2026-10-01T00:00:00Z') // exactly `to` → EXCLUDED
    const before = await makeSessionAt('2026-08-31T23:59:00Z') // before `from` → excluded

    const { body } = await list('/api/sessions?from=2026-09-01&to=2026-10-01')
    const ids = body!.sessions.map((s) => s.id)
    expect(ids).toContain(inRange)
    expect(ids).toContain(atFrom)
    expect(ids).not.toContain(atTo)
    expect(ids).not.toContain(before)
    expect(body!.total).toBe(2)
  })

  it('accepts an open-ended range (only from, or only to)', async () => {
    await makeSessionAt('2026-09-07T10:00:00Z')
    await makeSessionAt('2027-01-01T10:00:00Z')
    expect((await list('/api/sessions?from=2026-12-01')).body!.total).toBe(1)
    expect((await list('/api/sessions?to=2026-12-01')).body!.total).toBe(1)
  })

  it('rejects an inverted/empty range (400)', async () => {
    expect((await list('/api/sessions?from=2026-10-01&to=2026-09-01')).status).toBe(400)
    expect((await list('/api/sessions?from=2026-09-01&to=2026-09-01')).status).toBe(400)
  })

  it('rejects a malformed date (400)', async () => {
    expect((await list('/api/sessions?from=not-a-date')).status).toBe(400)
    expect((await list('/api/sessions?from=2026-13-40')).status).toBe(400)
  })

  it('the range stays scoped for instructors (cannot widen)', async () => {
    const mine = await makeSessionAt('2026-09-07T10:00:00Z', instructorId)
    // A session taught by someone else, in the same range.
    const other = await prisma.user.create({
      data: { email: `ss-o-${seq}@x.test`, name: 'O', role: 'INSTRUCTOR', passwordHash: 'x' },
    })
    const c = await prisma.class.create({
      data: {
        title: 'Other',
        description: 'd',
        discipline: 'y',
        defaultDurationMinutes: 60,
        defaultCapacity: 10,
      },
    })
    const r = await prisma.room.create({ data: { name: `ss-ro-${seq}` } })
    await prisma.classSession.create({
      data: {
        classId: c.id,
        startsAt: new Date('2026-09-08T10:00:00Z'),
        durationMinutes: 60,
        endsAt: new Date('2026-09-08T11:00:00Z'),
        capacity: 10,
        primaryInstructorId: other.id,
        roomId: r.id,
      },
    })

    const view = await list('/api/sessions?from=2026-09-01&to=2026-10-01', instructorCookie)
    expect(view.body!.sessions.map((s) => s.id)).toEqual([mine]) // only their own
    expect(view.body!.total).toBe(1)
  })
})
