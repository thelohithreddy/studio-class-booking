// app/api/auth/logout/route.ts
import { handleRoute } from '@/lib/api/errors'
import { clearSessionCookie, destroySession, getSessionUser } from '@/server/auth/session'

/**
 * POST /api/auth/logout — idempotent. Deletes the session ROW, not just the
 * cookie: the old token must never authenticate again, from any client.
 */
export const POST = handleRoute(async (req) => {
  const user = await getSessionUser(req)
  await destroySession(req)
  if (user) console.info('auth.logout', { userId: user.id })

  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearSessionCookie() } })
})
