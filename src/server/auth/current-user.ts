// src/server/auth/current-user.ts
import { cache } from 'react'
import { headers } from 'next/headers'

import { getSessionUser, type SessionUser } from '@/server/auth/session'

/**
 * The authenticated user for SERVER COMPONENTS (the (app) layout uses it to
 * build role-aware nav and redirect unauthenticated requests to /login),
 * resolved from the request cookie. Wrapped in React `cache()` so any server
 * components in one request share a single session lookup. API route handlers
 * keep using requireUser(req)/getSessionUser(req) directly with the real Request.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const cookie = (await headers()).get('cookie') ?? ''
  return getSessionUser(new Request('http://internal/', { headers: { cookie } }))
})
