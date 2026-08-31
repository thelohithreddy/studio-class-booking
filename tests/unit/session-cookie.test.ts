// Pins the PRODUCTION defaults of the session cookie — name prefix and
// Secure — which the integration suite (running as NODE_ENV=test) can never
// see. A fresh module registry per test lets env()'s cache re-read the
// stubbed environment.
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function importSessionWith(nodeEnv: string) {
  vi.stubEnv('NODE_ENV', nodeEnv)
  vi.stubEnv('DATABASE_URL', 'postgresql://stub:stub@localhost:5432/stub')
  vi.resetModules()
  return import('@/server/auth/session')
}

describe('session cookie environment defaults', () => {
  it('production: __Host- prefixed name and Secure by default', async () => {
    const session = await importSessionWith('production')
    expect(session.sessionCookieName()).toBe('__Host-studio_session')
    const cookie = session.serializeSessionCookie('tok', 60)
    expect(cookie.startsWith('__Host-studio_session=tok')).toBe(true)
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Path=/')
  })

  it('development: unprefixed and not Secure, so http://localhost works', async () => {
    const session = await importSessionWith('development')
    expect(session.sessionCookieName()).toBe('studio_session')
    const cookie = session.serializeSessionCookie('tok', 60)
    expect(cookie).not.toContain('Secure')
  })
})
