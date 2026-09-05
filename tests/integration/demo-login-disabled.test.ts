// tests/integration/demo-login-disabled.test.ts
//
// The default, security-critical posture: with ALLOW_DEMO_LOGIN unset, the demo
// entry endpoint is indistinguishable from a route that does not exist (404),
// so it can never be a credential-free way into a real studio deployment.
// (Deliberately its own file with a fresh env() cache. Clear the flag before any
// env() read in case a sibling file set it in this worker's process.env.)
delete process.env.ALLOW_DEMO_LOGIN

import { describe, expect, it } from 'vitest'

import { POST as demoLogin } from '@app/api/auth/demo/route'

function req(): Request {
  return new Request('http://localhost/api/auth/demo', {
    method: 'POST',
    headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'STAFF' }),
  })
}

describe('POST /api/auth/demo — disabled by default', () => {
  it('returns 404 when ALLOW_DEMO_LOGIN is not set', async () => {
    const res = await demoLogin(req())
    expect(res.status).toBe(404)
  })
})
