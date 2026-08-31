// tests/integration/auth.test.ts
//
// The authentication stack tested end-to-end, in-process: route handlers are
// plain (Request) => Response functions, so every test drives the real code
// path — validation, origin guard, rate limiting, Argon2 verification,
// session rows in the real database — with no server to spawn.
//
// Duplicate-email coverage lives with the DB constraint that owns it
// (tests/integration/constraints.test.ts, case-insensitive unique indexes) —
// Phase 3 ships no endpoint that writes an email.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { POST as loginRoute } from '@app/api/auth/login/route'
import { POST as logoutRoute } from '@app/api/auth/logout/route'
import { GET as meRoute } from '@app/api/auth/me/route'
import { hashPassword } from '@/server/auth/password'
import { normalizeEmail } from '@/lib/email'
import { serializeSessionCookie, sessionCookieName } from '@/server/auth/session'
import { createPrismaClient } from '@/lib/db'
import { UserRole } from '@/generated/prisma/enums'

import { resolveTestDatabaseUrl, truncateAll } from './helpers/test-db'

const testUrl = resolveTestDatabaseUrl()
const prisma = createPrismaClient(testUrl)
const pool = new Pool({ connectionString: testUrl })

const PASSWORD = 'plié-relevé-9-tendu'
let counter = 0
// The login route's rate-limit buckets are module state shared by every test
// in this worker. Each request gets a unique synthetic client IP so only the
// per-email buckets (which tests control via unique emails) ever trip.
let ipCounter = 0

afterAll(async () => {
  await prisma.$disconnect()
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
})

async function createUser(overrides: { email?: string; role?: UserRole } = {}) {
  counter += 1
  const email = normalizeEmail(overrides.email ?? `user${counter}@studio.test`)
  return prisma.user.create({
    data: {
      email,
      name: 'Test User',
      role: overrides.role ?? UserRole.STAFF,
      passwordHash: await hashPassword(PASSWORD),
    },
  })
}

function loginRequest(body: unknown, headers: Record<string, string> = {}): Request {
  ipCounter += 1
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: 'localhost',
      'x-forwarded-for': `test-ip-${ipCounter}`,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function login(email: string, password = PASSWORD): Promise<Response> {
  return loginRoute(loginRequest({ email, password }))
}

function cookieOf(response: Response): string {
  const header = response.headers.get('set-cookie')
  expect(header).toBeTruthy()
  return header!.split(';')[0]!
}

function meRequest(cookie?: string): Request {
  return new Request('http://localhost/api/auth/me', {
    method: 'GET',
    headers: cookie ? { cookie } : {},
  })
}

function logoutRequest(cookie?: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { host: 'localhost', ...(cookie ? { cookie } : {}), ...headers },
  })
}

// --- login -------------------------------------------------------------------

describe('login', () => {
  it('succeeds with valid credentials: 204, cookie set, session row stored hashed', async () => {
    const user = await createUser()
    const response = await login(user.email)
    expect(response.status).toBe(204)

    const setCookie = response.headers.get('set-cookie')!
    expect(setCookie).toContain(`${sessionCookieName()}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('Max-Age=604800')
    // NODE_ENV=test — Secure must come from the environment, not be hardcoded.
    expect(setCookie).not.toContain('Secure')

    const rawToken = setCookie.split(';')[0]!.split('=').slice(1).join('=')
    const rows = await pool.query('SELECT token_hash, user_id FROM auth_sessions')
    expect(rows.rowCount).toBe(1)
    expect(rows.rows[0].user_id).toBe(user.id)
    // The DB must hold a hash, never the usable token.
    expect(rows.rows[0].token_hash).not.toBe(rawToken)
    expect(rows.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is never cacheable — login, logout and failures all carry no-store', async () => {
    const user = await createUser()
    const success = await login(user.email)
    expect(success.headers.get('cache-control')).toBe('no-store')
    const failure = await login(user.email, 'wrong')
    expect(failure.headers.get('cache-control')).toBe('no-store')
    const out = await logoutRoute(logoutRequest())
    expect(out.headers.get('cache-control')).toBe('no-store')
  })

  it('serializer emits Secure exactly when asked (prod default pinned in tests/unit/session-cookie.test.ts)', () => {
    expect(serializeSessionCookie('t', 60, true)).toContain('Secure')
    expect(serializeSessionCookie('t', 60, false)).not.toContain('Secure')
  })

  it('normalizes email: mixed case and whitespace still log in', async () => {
    const user = await createUser({ email: 'casey@studio.test' })
    const response = await loginRoute(
      loginRequest({ email: '  CASEY@Studio.Test ', password: PASSWORD }),
    )
    expect(response.status).toBe(204)
    const rows = await pool.query('SELECT user_id FROM auth_sessions')
    expect(rows.rows[0].user_id).toBe(user.id)
  })

  it('returns identical 401s for wrong password and unknown email (no enumeration)', async () => {
    const user = await createUser()
    const wrongPassword = await login(user.email, 'wrong-password')
    const unknownEmail = await login('ghost@studio.test')

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(await wrongPassword.text()).toBe(await unknownEmail.text())
    expect(wrongPassword.headers.get('set-cookie')).toBeNull()
    expect(unknownEmail.headers.get('set-cookie')).toBeNull()
  })

  it('rejects malformed input with 400: missing fields, junk JSON, unknown keys', async () => {
    expect((await loginRoute(loginRequest({ email: 'a@b.test' }))).status).toBe(400)
    expect((await loginRoute(loginRequest('not json'))).status).toBe(400)
    expect((await loginRoute(loginRequest({}))).status).toBe(400)
    // .strict(): mass-assignment style extra keys are rejected, not ignored.
    expect(
      (
        await loginRoute(
          loginRequest({ email: 'a@b.test', password: 'x', role: 'STAFF', isAdmin: true }),
        )
      ).status,
    ).toBe(400)
  })

  it('rejects an oversized declared body with 413 before parsing', async () => {
    // In-process Requests don't auto-set Content-Length the way real HTTP
    // clients do — declare it, since the declared length is what the early
    // gate reads (chunked bodies are the fronting proxy's problem).
    const big = JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(70 * 1024) })
    const response = await loginRoute(loginRequest(big, { 'content-length': String(big.length) }))
    expect(response.status).toBe(413)
  })

  it('rejects oversized credentials with 400 before any hashing work', async () => {
    expect(
      (await loginRoute(loginRequest({ email: `${'a'.repeat(300)}@b.test`, password: 'x' })))
        .status,
    ).toBe(400)
    expect(
      (await loginRoute(loginRequest({ email: 'a@b.test', password: 'x'.repeat(300) }))).status,
    ).toBe(400)
  })

  it('parameterizes SQL-injection payloads that reach the query layer', async () => {
    await createUser()
    // "x'--@b.test" survives email validation (apostrophes are legal in the
    // local part), so this payload genuinely reaches the Prisma lookup — a
    // vulnerable string-built query would break or match; parameterized SQL
    // treats it as a value and finds nobody.
    const reached = await loginRoute(
      loginRequest({ email: "x'--@b.test", password: "' OR '1'='1" }),
    )
    expect(reached.status).toBe(401)
    // The cruder classic dies earlier, at validation.
    const rejected = await loginRoute(
      loginRequest({ email: "x'; DROP TABLE users; --@b.test", password: 'x' }),
    )
    expect(rejected.status).toBe(400)
    const users = await pool.query('SELECT count(*)::int AS n FROM users')
    expect(users.rows[0].n).toBe(1)
  })

  it('rate limits per client IP across many emails (multi-hop XFF, leftmost entry)', async () => {
    const ip = `shared-ip-${Date.now()}`
    let last: Response | null = null
    for (let i = 0; i < 31; i++) {
      last = await loginRoute(
        loginRequest(
          { email: `ip-probe-${i}-${Date.now()}@x.test`, password: 'wrong' },
          { 'x-forwarded-for': `${ip}, 10.0.0.1, 10.0.0.2` },
        ),
      )
    }
    expect(last!.status).toBe(429)
  })

  it('does not pool requests lacking x-forwarded-for into one shared bucket', async () => {
    // A proxyless deployment must not let 30 anonymous failures lock the
    // login endpoint for everyone — absent XFF simply skips the IP arm.
    let last: Response | null = null
    for (let i = 0; i < 31; i++) {
      last = await loginRoute(
        loginRequest(
          { email: `no-xff-${i}-${Date.now()}@x.test`, password: 'wrong' },
          { 'x-forwarded-for': '' },
        ),
      )
    }
    expect(last!.status).toBe(401)
  })

  it('rate limits case/whitespace variants of one email as a single bucket', async () => {
    const base = `Variant-${Date.now()}@Studio.Test`
    const variants = [base, base.toLowerCase(), base.toUpperCase(), `  ${base} `]
    let last: Response | null = null
    for (let i = 0; i < 11; i++) {
      last = await login(variants[i % variants.length]!, 'wrong')
    }
    expect(last!.status).toBe(429)
  })

  it('rate limits repeated failures per email and recovers on success elsewhere', async () => {
    const user = await createUser()
    const email = `bruteforce-${Date.now()}@studio.test`
    let last: Response | null = null
    for (let i = 0; i < 11; i++) {
      last = await login(email, 'wrong')
    }
    expect(last!.status).toBe(429)
    // A different account is unaffected (per-key buckets).
    expect((await login(user.email)).status).toBe(204)
  })
})

// --- identity (/me) ----------------------------------------------------------

describe('authenticated identity', () => {
  it('resolves the correct user and never exposes the password hash', async () => {
    const user = await createUser({ role: UserRole.INSTRUCTOR })
    const cookie = cookieOf(await login(user.email))

    const response = await meRoute(meRequest(cookie))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')

    const body = (await response.json()) as { user: Record<string, unknown> }
    expect(body.user).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'INSTRUCTOR',
    })
    expect(JSON.stringify(body)).not.toContain('passwordHash')
    expect(JSON.stringify(body)).not.toContain('password_hash')
  })

  it('rejects a request with no cookie', async () => {
    expect((await meRoute(meRequest())).status).toBe(401)
  })

  it('rejects a random forged token', async () => {
    expect((await meRoute(meRequest(`${sessionCookieName()}=${'A'.repeat(43)}`))).status).toBe(401)
  })

  it('rejects a tampered token (one character flipped)', async () => {
    const user = await createUser()
    const cookie = cookieOf(await login(user.email))
    const [name, value] = cookie.split('=') as [string, string]
    const flipped = value.slice(0, -1) + (value.endsWith('A') ? 'B' : 'A')
    expect((await meRoute(meRequest(`${name}=${flipped}`))).status).toBe(401)
  })

  it('rejects malformed cookies and userId-substitution junk', async () => {
    const user = await createUser()
    expect((await meRoute(meRequest('garbage'))).status).toBe(401)
    expect((await meRoute(meRequest(`${sessionCookieName()}=`))).status).toBe(401)
    expect((await meRoute(meRequest(`userId=${user.id}; role=STAFF`))).status).toBe(401)
  })

  it('rejects an expired session and prunes its row', async () => {
    const user = await createUser()
    const cookie = cookieOf(await login(user.email))
    await pool.query(`UPDATE auth_sessions SET expires_at = now() - interval '1 minute'`)

    expect((await meRoute(meRequest(cookie))).status).toBe(401)
    const rows = await pool.query('SELECT count(*)::int AS n FROM auth_sessions')
    expect(rows.rows[0].n).toBe(0)
  })

  it('rejects a session whose row was deleted server-side (revocation)', async () => {
    const user = await createUser()
    const cookie = cookieOf(await login(user.email))
    await pool.query('DELETE FROM auth_sessions')
    expect((await meRoute(meRequest(cookie))).status).toBe(401)
  })
})

// --- logout ------------------------------------------------------------------

describe('logout', () => {
  it('deletes the session row; the old cookie never authenticates again', async () => {
    const user = await createUser()
    const cookie = cookieOf(await login(user.email))
    expect((await meRoute(meRequest(cookie))).status).toBe(200)

    const response = await logoutRoute(logoutRequest(cookie))
    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')

    const rows = await pool.query('SELECT count(*)::int AS n FROM auth_sessions')
    expect(rows.rows[0].n).toBe(0)
    // Replay of the logged-out cookie.
    expect((await meRoute(meRequest(cookie))).status).toBe(401)
  })

  it('is idempotent and safe without a session', async () => {
    expect((await logoutRoute(logoutRequest())).status).toBe(204)
  })

  it('only kills the presented session, not the user’s other sessions', async () => {
    const user = await createUser()
    const first = cookieOf(await login(user.email))
    const second = cookieOf(await login(user.email))

    await logoutRoute(logoutRequest(first))
    expect((await meRoute(meRequest(first))).status).toBe(401)
    expect((await meRoute(meRequest(second))).status).toBe(200)
  })
})

// --- CSRF origin guard -------------------------------------------------------

describe('origin guard (CSRF)', () => {
  it('rejects cross-origin login and logout attempts', async () => {
    const user = await createUser()
    const crossLogin = await loginRoute(
      loginRequest({ email: user.email, password: PASSWORD }, { origin: 'https://evil.example' }),
    )
    expect(crossLogin.status).toBe(403)

    const cookie = cookieOf(await login(user.email))
    const crossLogout = await logoutRoute(logoutRequest(cookie, { origin: 'https://evil.example' }))
    expect(crossLogout.status).toBe(403)
    // The session survived the forged logout.
    expect((await meRoute(meRequest(cookie))).status).toBe(200)
  })

  it('allows same-origin requests with a matching Origin header', async () => {
    const user = await createUser()
    const response = await loginRoute(
      loginRequest({ email: user.email, password: PASSWORD }, { origin: 'http://localhost' }),
    )
    expect(response.status).toBe(204)
  })

  it("rejects the literal 'null' origin", async () => {
    const user = await createUser()
    const response = await loginRoute(
      loginRequest({ email: user.email, password: PASSWORD }, { origin: 'null' }),
    )
    expect(response.status).toBe(403)
  })
})

// --- fixation / account switch ----------------------------------------------

describe('login with a session already present', () => {
  it('never adopts a presented token: a fresh one is minted every login', async () => {
    const user = await createUser()
    const attackerChosen = `${sessionCookieName()}=${'F'.repeat(43)}`
    const response = await loginRoute(
      loginRequest({ email: user.email, password: PASSWORD }, { cookie: attackerChosen }),
    )
    expect(response.status).toBe(204)
    const minted = cookieOf(response)
    expect(minted).not.toContain('F'.repeat(43))
    // The attacker-chosen value still resolves to nothing.
    expect((await meRoute(meRequest(attackerChosen))).status).toBe(401)
  })

  it('kills the previous session on account switch (shared front-desk machine)', async () => {
    const alice = await createUser({ email: 'alice@studio.test' })
    const bob = await createUser({ email: 'bob@studio.test' })

    const aliceCookie = cookieOf(await login(alice.email))
    const response = await loginRoute(
      loginRequest({ email: bob.email, password: PASSWORD }, { cookie: aliceCookie }),
    )
    expect(response.status).toBe(204)

    // Alice's orphaned session is gone, not lingering for 7 days.
    expect((await meRoute(meRequest(aliceCookie))).status).toBe(401)
    const rows = await pool.query('SELECT count(*)::int AS n FROM auth_sessions')
    expect(rows.rows[0].n).toBe(1)
  })
})

// --- session hygiene ---------------------------------------------------------

describe('session hygiene', () => {
  it('caps live sessions per user, evicting the oldest', async () => {
    const user = await createUser()
    const cookies: string[] = []
    for (let i = 0; i < 11; i++) {
      cookies.push(cookieOf(await login(user.email)))
    }
    const rows = await pool.query('SELECT count(*)::int AS n FROM auth_sessions')
    expect(rows.rows[0].n).toBe(10)
    expect((await meRoute(meRequest(cookies[0]!))).status).toBe(401)
    expect((await meRoute(meRequest(cookies[10]!))).status).toBe(200)
  })

  it('sweeps a user’s expired sessions at login', async () => {
    const user = await createUser()
    await login(user.email)
    await pool.query(`UPDATE auth_sessions SET expires_at = now() - interval '1 day'`)
    await login(user.email)
    const rows = await pool.query('SELECT count(*)::int AS n FROM auth_sessions')
    expect(rows.rows[0].n).toBe(1)
  })

  it('errors from the database surface as generic 500s, not internals', async () => {
    const user = await createUser()
    const cookie = cookieOf(await login(user.email))
    await pool.query('ALTER TABLE auth_sessions RENAME TO auth_sessions_broken')
    try {
      const response = await meRoute(meRequest(cookie))
      expect(response.status).toBe(500)
      const body = await response.text()
      expect(body).toBe(
        JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }),
      )
      expect(body).not.toMatch(/prisma|postgres|relation|auth_sessions/i)
    } finally {
      await pool.query('ALTER TABLE auth_sessions_broken RENAME TO auth_sessions')
    }
  })
})
