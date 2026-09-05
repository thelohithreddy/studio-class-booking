// app/api/auth/demo/route.ts
import { z } from 'zod'

import { db } from '@/lib/db'
import { ApiError, handleRoute } from '@/lib/api/errors'
import { createSession, destroySession } from '@/server/auth/session'
import { DEMO_ACCOUNT_EMAILS, demoLoginEnabled } from '@/server/auth/demo'

/**
 * POST /api/auth/demo — one-click evaluator entry (see src/server/auth/demo.ts).
 * Signs the visitor in as a FIXED, pre-seeded demo account for the requested
 * role, so an evaluator can experience both STAFF and INSTRUCTOR without a
 * password. Disabled (404) unless ALLOW_DEMO_LOGIN is set — never a bypass on a
 * real studio. The email is server-fixed by role, never taken from the request;
 * no account is created; the session is the same opaque DB-backed session as a
 * password login, and the CSRF origin guard (handleRoute) still applies.
 */
const demoSchema = z.object({ role: z.enum(['STAFF', 'INSTRUCTOR']) }).strict()

export const POST = handleRoute(async (req) => {
  if (!demoLoginEnabled()) throw new ApiError(404, 'not_found', 'Not found.')

  const { role } = demoSchema.parse(await req.json().catch(() => ({})))
  const email = DEMO_ACCOUNT_EMAILS[role]

  const user = await db().user.findFirst({ where: { email }, select: { id: true } })
  if (!user) throw new ApiError(404, 'not_found', 'The demo account is not available.')

  await destroySession(req)
  const { cookie } = await createSession(user.id)
  console.info('auth.demo', { role })

  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie } })
})
