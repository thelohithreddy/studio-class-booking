// src/server/auth/session.ts
import { createHash, randomBytes } from 'node:crypto'

import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { ApiError } from '@/lib/api/errors'
import type { UserRole } from '@/generated/prisma/enums'

/**
 * DB-backed opaque-token sessions.
 *
 * The browser holds a 32-byte random token (base64url) in an HttpOnly cookie;
 * the database stores only its SHA-256. A leaked database therefore yields no
 * usable credentials, and SHA-256 (not Argon2) is the right hash here: the
 * token carries 256 bits of entropy — there is no dictionary to grind, and a
 * slow hash would only tax every authenticated request.
 *
 * Expiry is absolute: SESSION_TTL from creation, no idle timeout, no sliding
 * renewal. Logout deletes the row — "row exists and is unexpired" is the one
 * and only definition of a valid session.
 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_SESSIONS_PER_USER = 10

/**
 * __Host- in production is browser-enforced armor: the browser refuses the
 * cookie unless it is Secure, Path=/, without Domain — so nothing planted
 * from a sibling/sub-domain can shadow the session under this name. Dev
 * stays unprefixed because __Host- requires Secure and dev runs plain http.
 */
export function sessionCookieName(): string {
  return env().NODE_ENV === 'production' ? '__Host-studio_session' : 'studio_session'
}

export interface SessionUser {
  id: string
  email: string
  name: string
  role: UserRole
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function serializeSessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean = env().NODE_ENV === 'production',
): string {
  const attributes = [
    `${sessionCookieName()}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

export function clearSessionCookie(): string {
  return serializeSessionCookie('', 0)
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === sessionCookieName()) {
      const value = rest.join('=')
      return value.length > 0 ? value : null
    }
  }
  return null
}

/**
 * Mints a session for a verified user. Also the housekeeping moment: expired
 * rows for this user are deleted, and the live-session count is soft-capped
 * (oldest first) so the table cannot grow without bound.
 */
export async function createSession(userId: string): Promise<{ token: string; cookie: string }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await db().authSession.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  })

  const live = await db().authSession.findMany({
    where: { userId },
    // id tiebreaker: concurrent logins share a created_at millisecond, and a
    // soft cap should still evict deterministically.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  const excess = live.slice(MAX_SESSIONS_PER_USER - 1)
  if (excess.length > 0) {
    await db().authSession.deleteMany({ where: { id: { in: excess.map((s) => s.id) } } })
  }

  await db().authSession.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  })

  return { token, cookie: serializeSessionCookie(token, SESSION_TTL_MS / 1000) }
}

/** The single authoritative request → identity resolution. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = readSessionToken(req)
  if (!token) return null

  const session = await db().authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    // Narrow select: neither tokenHash nor any other session internals ever
    // materialize into the object graph handlers work with.
    select: {
      id: true,
      expiresAt: true,
      user: { select: { id: true, email: true, name: true, role: true } },
    },
  })
  if (!session) return null
  if (session.expiresAt.getTime() <= Date.now()) {
    await db()
      .authSession.delete({ where: { id: session.id } })
      .catch(() => undefined)
    return null
  }

  return session.user
}

/** getSessionUser, but 401 when there is no valid session. */
export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await getSessionUser(req)
  if (!user) throw new ApiError(401, 'unauthenticated', 'Authentication required.')
  return user
}

/** Server-side logout: the row dies, so the token can never authenticate again. */
export async function destroySession(req: Request): Promise<void> {
  const token = readSessionToken(req)
  if (!token) return
  await db().authSession.deleteMany({ where: { tokenHash: hashToken(token) } })
}
