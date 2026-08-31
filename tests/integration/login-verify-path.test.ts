// Structurally pins the anti-enumeration property that response-equality
// tests cannot see: credential verification RUNS even when the email is
// unknown (against a dummy hash), so both failure paths do the same work.
// Deleting the dummy-hash arm would fail this file while every
// response-level assertion elsewhere kept passing.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth/password', () => ({
  hashPassword: vi.fn(async (plain: string) => `mock-hash:${plain}`),
  verifyPassword: vi.fn(async () => false),
}))

import { POST as loginRoute } from '@app/api/auth/login/route'
import { verifyPassword } from '@/server/auth/password'

import { resolveTestDatabaseUrl, truncateAll } from './helpers/test-db'

const pool = new Pool({ connectionString: resolveTestDatabaseUrl() })

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
  vi.mocked(verifyPassword).mockClear()
})

function attempt(email: string): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: 'localhost',
      'x-forwarded-for': `verify-path-${Math.random()}`,
    },
    body: JSON.stringify({ email, password: 'whatever' }),
  })
}

describe('verification runs on both failure paths', () => {
  it('unknown email: verifyPassword is still called exactly once, against the dummy hash', async () => {
    const response = await loginRoute(attempt(`ghost-${Date.now()}@studio.test`))
    expect(response.status).toBe(401)
    expect(verifyPassword).toHaveBeenCalledTimes(1)
    expect(vi.mocked(verifyPassword).mock.calls[0]![0]).toMatch(/^mock-hash:dummy-/)
  })

  it('known email, wrong password: verifyPassword is called exactly once, against the stored hash', async () => {
    await pool.query(
      `INSERT INTO users (email, name, role, password_hash)
       VALUES ('real-verify@studio.test', 'Real', 'STAFF', 'stored-hash')`,
    )
    const response = await loginRoute(attempt('real-verify@studio.test'))
    expect(response.status).toBe(401)
    expect(verifyPassword).toHaveBeenCalledTimes(1)
    expect(vi.mocked(verifyPassword).mock.calls[0]![0]).toBe('stored-hash')
  })
})
