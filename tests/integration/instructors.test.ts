// tests/integration/instructors.test.ts
//
// The instructor directory (GET /api/instructors) that powers the name-based
// pickers. Verifies the STAFF-only gate, that it returns ONLY instructor-role
// users, its projection (id/name/email — never passwordHash), and its order.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as listInstructorsRoute } from '@app/api/instructors/route'

import { createPrismaClient } from '@/lib/db'
import { createSession as createAuthSession } from '@/server/auth/session'
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

async function makeUser(role: 'STAFF' | 'INSTRUCTOR', name: string): Promise<string> {
  seq += 1
  const u = await prisma.user.create({
    data: {
      email: `instr-${seq}@x.test`,
      name,
      role,
      passwordHash: await hashPassword('x'),
    },
  })
  return u.id
}

async function cookieFor(userId: string): Promise<string> {
  return `studio_session=${(await createAuthSession(userId)).token}`
}

function req(cookie?: string): Request {
  return new Request('http://localhost/api/instructors', {
    method: 'GET',
    headers: { host: 'localhost', ...(cookie ? { cookie } : {}) },
  })
}

interface InstructorRow {
  id: string
  name: string
  email: string
}

beforeEach(async () => {
  await truncateAll(pool)
  seq = 0
})

describe('GET /api/instructors', () => {
  it('401 without a session', async () => {
    const res = await listInstructorsRoute(req())
    expect(res.status).toBe(401)
  })

  it('403 for an instructor (staff-only directory)', async () => {
    const instructorId = await makeUser('INSTRUCTOR', 'Ivy')
    const res = await listInstructorsRoute(req(await cookieFor(instructorId)))
    expect(res.status).toBe(403)
  })

  it('staff gets only instructor-role users, name-sorted, id/name/email only', async () => {
    await makeUser('STAFF', 'Front Desk')
    await makeUser('INSTRUCTOR', 'Zoe')
    await makeUser('INSTRUCTOR', 'Amara')
    const staffId = await makeUser('STAFF', 'Manager')

    const res = await listInstructorsRoute(req(await cookieFor(staffId)))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { instructors: InstructorRow[] }

    // Only instructors — neither staff user appears.
    expect(body.instructors.map((i) => i.name)).toEqual(['Amara', 'Zoe'])
    // Projection is exactly id/name/email — no passwordHash, role, or timestamps.
    for (const row of body.instructors) {
      expect(Object.keys(row).sort()).toEqual(['email', 'id', 'name'])
    }
  })
})
