// tests/unit/health-route.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the db singleton so we can drive the readiness route's FAILURE envelope
// (the success path is covered against a real DB in the integration suite).
const dbMock = vi.fn()
vi.mock('@/lib/db', () => ({ db: () => dbMock() }))

// Imported AFTER the mock is registered (vitest hoists vi.mock above imports).
const { GET } = await import('@app/api/health/ready/route')

afterEach(() => {
  dbMock.mockReset()
})

describe('GET /api/health/ready — failure envelope', () => {
  it('returns 503 with a safe body (no DB detail) when the query rejects', async () => {
    // An error whose message contains secrets — none of it may reach the client.
    dbMock.mockReturnValue({
      $queryRaw: () =>
        Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432 password=hunter2')),
    })
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'unavailable' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 503 (never a 500) when db() itself throws', async () => {
    dbMock.mockImplementation(() => {
      throw new Error('invalid DATABASE_URL password=hunter2')
    })
    const res = await GET()
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(text).toBe('{"status":"unavailable"}')
    expect(text).not.toMatch(/password|hunter2|ECONNREFUSED|5432/i)
  })
})
