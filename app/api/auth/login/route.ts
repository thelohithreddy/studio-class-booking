// app/api/auth/login/route.ts
import { z } from 'zod'

import { db } from '@/lib/db'
import { handleRoute, jsonError } from '@/lib/api/errors'
import { normalizeEmail } from '@/lib/email'
import { hashPassword, verifyPassword } from '@/server/auth/password'
import { createRateLimiter } from '@/server/auth/rate-limit'
import { createSession, destroySession } from '@/server/auth/session'

/**
 * POST /api/auth/login
 *
 * Every failure — unknown email, wrong password, malformed-but-parseable
 * input — returns the same generic 401. Verification runs even when the user
 * does not exist (against a dummy hash), so both failure causes share one
 * code path and comparable timing.
 */
const loginSchema = z
  .object({
    // Normalized through the same function every email writer must use, so
    // the rate-limit bucket, the lookup and the stored value can never drift.
    email: z.string().max(254).transform(normalizeEmail).pipe(z.email().max(254)),
    password: z.string().min(1).max(200),
  })
  .strict()

// Failed-attempt buckets: per normalized email and per client IP. Module
// scope = per server process; see rate-limit.ts for why that is proportionate.
const emailLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 })
const ipLimiter = createRateLimiter({ limit: 30, windowMs: 15 * 60 * 1000 })

// Hashed once at startup: the "user not found" arm verifies against this so
// its timing tracks the real-verification arm.
const dummyHashPromise = hashPassword(`dummy-${Date.now()}`)

function clientIp(req: Request): string | null {
  // Behind the deploy target's proxy the leftmost x-forwarded-for entry is
  // the client. Spoofable in principle — which is why the email bucket, not
  // this one, is the primary control. No header → no IP arm at all: a shared
  // fallback bucket would let 30 failures 429 every user of a proxyless
  // deployment at once.
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first ? first : null
}

export const POST = handleRoute(async (req) => {
  const body = loginSchema.parse(await req.json().catch(() => ({})))
  const ip = clientIp(req)

  if (emailLimiter.isLimited(body.email) || (ip !== null && ipLimiter.isLimited(ip))) {
    return jsonError(429, 'too_many_attempts', 'Too many attempts. Try again later.')
  }

  const user = await db().user.findFirst({
    where: { email: body.email },
    omit: { passwordHash: false }, // the one sanctioned opt-in (see src/lib/db.ts)
  })

  const hash = user?.passwordHash ?? (await dummyHashPromise)
  const valid = await verifyPassword(hash, body.password)

  if (!user || !valid) {
    emailLimiter.recordFailure(body.email)
    if (ip !== null) ipLimiter.recordFailure(ip)
    return jsonError(401, 'invalid_credentials', 'Invalid email or password.')
  }

  emailLimiter.reset(body.email)
  // Account switch on a shared machine: whatever session this browser was
  // holding is dead the moment someone else logs in on it — otherwise that
  // row would stay valid for days with nobody holding its cookie.
  await destroySession(req)
  const { cookie } = await createSession(user.id)
  console.info('auth.login', { userId: user.id })

  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie } })
})
