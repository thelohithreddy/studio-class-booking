// tests/integration/domain-crud.test.ts
//
// Classes, members and rooms CRUD + archive/restore + authorization, driven
// against the real route handlers in-process.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as classesList, POST as classCreate } from '@app/api/classes/route'
import { GET as classGet, PATCH as classPatch } from '@app/api/classes/[id]/route'
import { POST as classArchive } from '@app/api/classes/[id]/archive/route'
import { POST as classRestore } from '@app/api/classes/[id]/restore/route'
import { GET as membersList, POST as memberCreate } from '@app/api/members/route'
import { GET as memberGet, PATCH as memberPatch } from '@app/api/members/[id]/route'
import { GET as roomsList, POST as roomCreate } from '@app/api/rooms/route'
import { PATCH as roomPatch } from '@app/api/rooms/[id]/route'

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

async function makeUser(role: UserRole): Promise<string> {
  seq += 1
  const user = await prisma.user.create({
    data: {
      email: `crud-${role}-${seq}@x.test`,
      name: 'U',
      role,
      passwordHash: await hashPassword('x'),
    },
  })
  const { token } = await createSession(user.id)
  return `studio_session=${token}`
}

beforeEach(async () => {
  await truncateAll(pool)
  staffCookie = await makeUser(UserRole.STAFF)
  instructorCookie = await makeUser(UserRole.INSTRUCTOR)
})

function jreq(method: string, cookie: string | undefined, body?: unknown): Request {
  const headers: Record<string, string> = { host: 'localhost' }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new Request('http://localhost/api/x', {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
function q(path: string, cookie: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: { host: 'localhost', cookie },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

// --- classes -----------------------------------------------------------------

const validClass = {
  title: 'Vinyasa',
  description: 'Flow',
  discipline: 'yoga',
  defaultDurationMinutes: 60,
  defaultCapacity: 20,
}

describe('classes CRUD', () => {
  it('staff creates a class (201) and reads it back', async () => {
    const created = await classCreate(jreq('POST', staffCookie, validClass))
    expect(created.status).toBe(201)
    const { class: klass } = (await created.json()) as { class: { id: string; title: string } }
    expect(klass.title).toBe('Vinyasa')

    const got = await classGet(q(`/api/classes/${klass.id}`, staffCookie), ctx(klass.id))
    expect(got.status).toBe(200)
  })

  it('instructor cannot create, update, archive or restore', async () => {
    expect((await classCreate(jreq('POST', instructorCookie, validClass))).status).toBe(403)
    expect(
      (
        await classPatch(
          jreq('PATCH', instructorCookie, { title: 'x' }),
          ctx('11111111-1111-4111-8111-111111111111'),
        )
      ).status,
    ).toBe(403)
  })

  it('rejects invalid input with 400', async () => {
    expect(
      (await classCreate(jreq('POST', staffCookie, { ...validClass, title: '' }))).status,
    ).toBe(400)
    expect(
      (await classCreate(jreq('POST', staffCookie, { ...validClass, defaultDurationMinutes: 0 })))
        .status,
    ).toBe(400)
    expect(
      (await classCreate(jreq('POST', staffCookie, { ...validClass, defaultCapacity: -1 }))).status,
    ).toBe(400)
    // Mass assignment: a server-managed field is a 400, not silently ignored.
    expect((await classCreate(jreq('POST', staffCookie, { ...validClass, id: 'x' }))).status).toBe(
      400,
    )
  })

  it('updates only the intended fields', async () => {
    const { class: klass } = (await (
      await classCreate(jreq('POST', staffCookie, validClass))
    ).json()) as {
      class: { id: string }
    }
    const patched = await classPatch(
      jreq('PATCH', staffCookie, { title: 'Renamed' }),
      ctx(klass.id),
    )
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { class: { title: string } }).class.title).toBe('Renamed')
  })

  it('archive is non-destructive and idempotent; restore too', async () => {
    const { class: klass } = (await (
      await classCreate(jreq('POST', staffCookie, validClass))
    ).json()) as {
      class: { id: string }
    }
    // Give the class a session so we can prove archive preserves it.
    const instructor = await prisma.user.findFirstOrThrow({ where: { role: 'INSTRUCTOR' } })
    const room = await prisma.room.create({ data: { name: `arch-room-${seq}` } })
    const session = await prisma.classSession.create({
      data: {
        classId: klass.id,
        startsAt: new Date('2026-09-07T10:00:00Z'),
        durationMinutes: 60,
        endsAt: new Date('2026-09-07T11:00:00Z'),
        capacity: 10,
        primaryInstructorId: instructor.id,
        roomId: room.id,
      },
    })

    const archived = await classArchive(jreq('POST', staffCookie, {}), ctx(klass.id))
    expect(archived.status).toBe(200)
    expect(
      ((await archived.json()) as { class: { archivedAt: string | null } }).class.archivedAt,
    ).not.toBeNull()

    // The session still exists — archive did not cascade.
    expect(await prisma.classSession.findUnique({ where: { id: session.id } })).not.toBeNull()

    // Idempotent archive.
    expect((await classArchive(jreq('POST', staffCookie, {}), ctx(klass.id))).status).toBe(200)

    const restored = await classRestore(jreq('POST', staffCookie, {}), ctx(klass.id))
    expect(
      ((await restored.json()) as { class: { archivedAt: string | null } }).class.archivedAt,
    ).toBeNull()
    // Idempotent restore.
    expect((await classRestore(jreq('POST', staffCookie, {}), ctx(klass.id))).status).toBe(200)
  })

  it('default listing excludes archived; includeArchived reveals them', async () => {
    const { class: a } = (await (
      await classCreate(jreq('POST', staffCookie, { ...validClass, title: 'Active' }))
    ).json()) as {
      class: { id: string }
    }
    const { class: b } = (await (
      await classCreate(jreq('POST', staffCookie, { ...validClass, title: 'Archived' }))
    ).json()) as {
      class: { id: string }
    }
    await classArchive(jreq('POST', staffCookie, {}), ctx(b.id))

    const def = (await (await classesList(q('/api/classes', staffCookie))).json()) as {
      classes: Array<{ id: string }>
      total: number
    }
    expect(def.total).toBe(1)
    expect(def.classes.map((c) => c.id)).toEqual([a.id])

    const all = (await (
      await classesList(q('/api/classes?includeArchived=true', staffCookie))
    ).json()) as {
      total: number
    }
    expect(all.total).toBe(2)
    void a
  })
})

// --- members -----------------------------------------------------------------

describe('members CRUD', () => {
  const validMember = {
    name: 'Ada Lovelace',
    email: 'ada@studio.test',
    membershipExpiresOn: '2027-01-01',
  }

  it('staff creates a member (201); instructor is forbidden', async () => {
    expect((await memberCreate(jreq('POST', instructorCookie, validMember))).status).toBe(403)
    const created = await memberCreate(jreq('POST', staffCookie, validMember))
    expect(created.status).toBe(201)
    const { member } = (await created.json()) as { member: { id: string; email: string } }
    expect(member.email).toBe('ada@studio.test')
    // No password/hash ever leaks.
    expect(JSON.stringify(member)).not.toMatch(/password/i)
  })

  it('rejects a duplicate email case-insensitively (409)', async () => {
    await memberCreate(jreq('POST', staffCookie, validMember))
    const dup = await memberCreate(
      jreq('POST', staffCookie, { ...validMember, email: 'ADA@Studio.test' }),
    )
    expect(dup.status).toBe(409)
    expect(await dup.text()).not.toMatch(/prisma|constraint|23505/i)
  })

  it('rejects a malformed email (400)', async () => {
    expect(
      (await memberCreate(jreq('POST', staffCookie, { ...validMember, email: 'nope' }))).status,
    ).toBe(400)
  })

  it('persists an updated expiry date', async () => {
    const { member } = (await (
      await memberCreate(jreq('POST', staffCookie, validMember))
    ).json()) as {
      member: { id: string }
    }
    const patched = await memberPatch(
      jreq('PATCH', staffCookie, { membershipExpiresOn: '2026-09-03' }),
      ctx(member.id),
    )
    expect(patched.status).toBe(200)
    const body = (await patched.json()) as { member: { membershipExpiresOn: string } }
    expect(body.member.membershipExpiresOn).toBe('2026-09-03T00:00:00.000Z')
    // Verify persisted, not just echoed.
    const got = await memberGet(q(`/api/members/${member.id}`, staffCookie), ctx(member.id))
    expect(
      ((await got.json()) as { member: { membershipExpiresOn: string } }).member
        .membershipExpiresOn,
    ).toBe('2026-09-03T00:00:00.000Z')
  })

  it('lists members bounded and searchable (staff only)', async () => {
    await memberCreate(jreq('POST', staffCookie, validMember))
    await memberCreate(
      jreq('POST', staffCookie, {
        ...validMember,
        email: 'grace@studio.test',
        name: 'Grace Hopper',
      }),
    )
    expect((await membersList(q('/api/members', instructorCookie))).status).toBe(403)
    const searched = (await (await membersList(q('/api/members?q=grace', staffCookie))).json()) as {
      members: Array<{ name: string }>
      total: number
    }
    expect(searched.total).toBe(1)
    expect(searched.members[0]!.name).toBe('Grace Hopper')
  })
})

// --- rooms -------------------------------------------------------------------

describe('rooms CRUD', () => {
  it('staff creates a room (201); instructor forbidden', async () => {
    expect((await roomCreate(jreq('POST', instructorCookie, { name: 'Studio A' }))).status).toBe(
      403,
    )
    const created = await roomCreate(jreq('POST', staffCookie, { name: 'Studio A' }))
    expect(created.status).toBe(201)
  })

  it('rejects a duplicate room name case-insensitively (409)', async () => {
    await roomCreate(jreq('POST', staffCookie, { name: 'Studio A' }))
    const dup = await roomCreate(jreq('POST', staffCookie, { name: 'studio a' }))
    expect(dup.status).toBe(409)
  })

  it('rejects a blank name (400)', async () => {
    expect((await roomCreate(jreq('POST', staffCookie, { name: '   ' }))).status).toBe(400)
  })

  it('renames a room and lists deterministically', async () => {
    const { room } = (await (
      await roomCreate(jreq('POST', staffCookie, { name: 'Studio B' }))
    ).json()) as {
      room: { id: string }
    }
    await roomCreate(jreq('POST', staffCookie, { name: 'Studio A' }))
    const renamed = await roomPatch(jreq('PATCH', staffCookie, { name: 'Studio Z' }), ctx(room.id))
    expect(renamed.status).toBe(200)
    const { rooms } = (await (await roomsList(q('/api/rooms', staffCookie))).json()) as {
      rooms: Array<{ name: string }>
    }
    expect(rooms.map((r) => r.name)).toEqual(['Studio A', 'Studio Z'])
  })
})
