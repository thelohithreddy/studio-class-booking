// tests/integration/production-hardening.test.ts
//
// Phase 18 production-hardening behaviours that need a real database:
//   - the readiness probe answers 200 against a reachable DB, with a safe body
//   - the liveness probe stays DB-free and public
//   - members/classes search treats LIKE metacharacters (%/_) as literals
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as ready } from '@app/api/health/ready/route'
import { GET as live } from '@app/api/health/route'
import { GET as membersList } from '@app/api/members/route'
import { GET as classesList } from '@app/api/classes/route'

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

let staffCookie: string
let seq = 0

async function makeStaff(): Promise<string> {
  seq += 1
  const user = await prisma.user.create({
    data: {
      email: `ph-staff-${seq}@x.test`,
      name: 'S',
      role: UserRole.STAFF,
      passwordHash: await hashPassword('x'),
    },
  })
  return `studio_session=${(await createSession(user.id)).token}`
}

function get(path: string, cookie: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: { host: 'localhost', cookie },
  })
}

beforeEach(async () => {
  await truncateAll(pool)
  staffCookie = await makeStaff()
})

describe('health / readiness', () => {
  it('GET /api/health/ready → 200 { status: ready } against a reachable DB', async () => {
    const res = await ready()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('readiness needs no authentication and its body leaks nothing sensitive', async () => {
    const res = await ready()
    expect(res.status).toBe(200) // called with no cookie at all
    const text = await res.text()
    expect(text).not.toMatch(/postgres|password|@|5432|connection|studio_test|prisma/i)
  })

  it('GET /api/health (liveness) stays 200 and DB-free', async () => {
    const res = await live()
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ok')
  })
})

describe('members search escapes LIKE metacharacters', () => {
  beforeEach(async () => {
    await prisma.member.createMany({
      data: [
        { name: '50% Member', email: 'a@x.test', membershipExpiresOn: new Date('2027-01-01') },
        { name: '500 Club', email: 'b@x.test', membershipExpiresOn: new Date('2027-01-01') },
        { name: 'a_b Person', email: 'c@x.test', membershipExpiresOn: new Date('2027-01-01') },
        { name: 'axb Person', email: 'd@x.test', membershipExpiresOn: new Date('2027-01-01') },
      ],
    })
  })

  it('a "%" query matches the literal percent, not everything', async () => {
    const res = await membersList(get('/api/members?q=50%25', staffCookie))
    const body = (await res.json()) as { members: Array<{ name: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.members[0]!.name).toBe('50% Member')
  })

  it('a "_" query matches the literal underscore, not any single character', async () => {
    const res = await membersList(get('/api/members?q=a_b', staffCookie))
    const body = (await res.json()) as { members: Array<{ name: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.members[0]!.name).toBe('a_b Person')
  })
})

describe('classes search escapes LIKE metacharacters', () => {
  beforeEach(async () => {
    await prisma.class.createMany({
      data: [
        {
          title: '50% Off',
          description: 'd',
          discipline: 'x',
          defaultDurationMinutes: 60,
          defaultCapacity: 10,
        },
        {
          title: '500 Level',
          description: 'd',
          discipline: 'x',
          defaultDurationMinutes: 60,
          defaultCapacity: 10,
        },
        {
          title: 'a_b Flow',
          description: 'd',
          discipline: 'x',
          defaultDurationMinutes: 60,
          defaultCapacity: 10,
        },
        {
          title: 'axb Flow',
          description: 'd',
          discipline: 'x',
          defaultDurationMinutes: 60,
          defaultCapacity: 10,
        },
      ],
    })
  })

  it('a "%" query matches the literal percent, not everything', async () => {
    const res = await classesList(get('/api/classes?q=50%25', staffCookie))
    const body = (await res.json()) as { classes: Array<{ title: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.classes[0]!.title).toBe('50% Off')
  })

  it('a "_" query matches the literal underscore, not any single character', async () => {
    const res = await classesList(get('/api/classes?q=a_b', staffCookie))
    const body = (await res.json()) as { classes: Array<{ title: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.classes[0]!.title).toBe('a_b Flow')
  })
})
