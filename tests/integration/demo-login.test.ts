// tests/integration/demo-login.test.ts
//
// One-click evaluator entry (POST /api/auth/demo) WHEN ENABLED. Proves it mints
// a real session for the fixed pre-seeded demo account of the requested role,
// and cannot be steered to an arbitrary account or ridden cross-origin.
//
// Set the flag before anything imports env() — env() caches on first read, and
// vitest isolates module state per file, so this file is "enabled" throughout.
process.env.ALLOW_DEMO_LOGIN = 'true'

import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { POST as demoLogin } from '@app/api/auth/demo/route'

import { createPrismaClient } from '@/lib/db'
import { getSessionUser } from '@/server/auth/session'
import { hashPassword } from '@/server/auth/password'
import { UserRole } from '@/generated/prisma/enums'

import { resolveTestDatabaseUrl, truncateAll } from './helpers/test-db'

const testUrl = resolveTestDatabaseUrl()
const prisma = createPrismaClient(testUrl)
const pool = new Pool({ connectionString: testUrl })

afterAll(async () => {
  await prisma.$disconnect()
  await pool.end()
  delete process.env.ALLOW_DEMO_LOGIN
})

function req(
  body: unknown,
  {
    origin = 'http://localhost',
    host = 'localhost',
  }: { origin?: string | null; host?: string } = {},
): Request {
  const headers: Record<string, string> = { host, 'content-type': 'application/json' }
  if (origin) headers.origin = origin
  return new Request('http://localhost/api/auth/demo', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function seedDemoAccounts() {
  await prisma.user.create({
    data: {
      email: 'staff@studio.test',
      name: 'Alex Morgan',
      role: UserRole.STAFF,
      passwordHash: await hashPassword('x'),
    },
  })
  await prisma.user.create({
    data: {
      email: 'ivy@studio.test',
      name: 'Ivy Chen',
      role: UserRole.INSTRUCTOR,
      passwordHash: await hashPassword('x'),
    },
  })
}

function sessionUserFromResponse(res: Response) {
  const token = /studio_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]
  return getSessionUser(
    new Request('http://localhost/', { headers: { cookie: `studio_session=${token}` } }),
  )
}

beforeEach(async () => {
  await truncateAll(pool)
})

describe('POST /api/auth/demo — enabled', () => {
  it('STAFF → 204 and the session is the seeded staff demo account', async () => {
    await seedDemoAccounts()
    const res = await demoLogin(req({ role: 'STAFF' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('set-cookie')).toMatch(/studio_session=/)
    const user = await sessionUserFromResponse(res)
    expect(user?.role).toBe('STAFF')
    expect(user?.email).toBe('staff@studio.test')
  })

  it('INSTRUCTOR → 204 and the session is the seeded instructor demo account', async () => {
    await seedDemoAccounts()
    const res = await demoLogin(req({ role: 'INSTRUCTOR' }))
    expect(res.status).toBe(204)
    const user = await sessionUserFromResponse(res)
    expect(user?.role).toBe('INSTRUCTOR')
    expect(user?.email).toBe('ivy@studio.test')
  })

  it('rejects an unknown role (400)', async () => {
    await seedDemoAccounts()
    expect((await demoLogin(req({ role: 'ADMIN' }))).status).toBe(400)
  })

  it('cannot be steered to an arbitrary account — an extra email field is rejected (400)', async () => {
    await seedDemoAccounts()
    expect((await demoLogin(req({ role: 'STAFF', email: 'attacker@evil.test' }))).status).toBe(400)
  })

  it('404 when the demo account has not been seeded', async () => {
    expect((await demoLogin(req({ role: 'STAFF' }))).status).toBe(404)
  })

  it('rejects a cross-origin request (CSRF origin guard → 403)', async () => {
    await seedDemoAccounts()
    const res = await demoLogin(req({ role: 'STAFF' }, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
  })
})
