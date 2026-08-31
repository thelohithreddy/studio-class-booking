// src/lib/api/errors.ts
import { ZodError } from 'zod'

/**
 * The API's error taxonomy. Every route handler goes through handleRoute, so
 * every error a client can see is one of exactly three shapes:
 *
 *   thrown ApiError            → its status,  { error: { code, message } }
 *   ZodError (validation)      → 400,         { error: { code: 'invalid_request', message } }
 *   anything else              → 500,         { error: { code: 'internal', message } }
 *
 * The 500 arm logs the real cause server-side and reveals nothing about it in
 * the response — no stack, no Prisma error code, no SQL fragment.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * CSRF guard: browsers attach an Origin header to cross-site requests. If one
 * is present and its host disagrees with the Host the request arrived at, the
 * request came from another site riding this browser's cookies — reject it
 * before any other work (including before authentication, which also covers
 * login CSRF). An absent Origin means a non-browser client (curl, tests,
 * server-to-server), which carries no ambient cookies to ride.
 *
 * Second layer: the session cookie itself is SameSite=Lax.
 * Revisit trigger (documented in docs/architecture.md): any cross-origin
 * client or third-party embedding.
 */
function violatesOriginPolicy(req: Request): boolean {
  if (!MUTATING_METHODS.has(req.method)) return false

  const origin = req.headers.get('origin')
  if (origin === null) return false
  if (origin === 'null') return true // opaque origins (sandboxed iframes, file://) are never ours

  const host = req.headers.get('host')
  if (host === null) return true

  try {
    return new URL(origin).host !== host
  } catch {
    return true // malformed Origin — not a browser we trust
  }
}

type RouteHandler = (req: Request) => Promise<Response> | Response

/**
 * Mutating requests get an early size gate: `req.json()` buffers the whole
 * body before zod ever sees it, and app-route handlers have no built-in body
 * limit. Managed proxies cap bodies anyway; this covers the bare `next start`
 * topology. 64KB is generous for every JSON body this API will ever accept.
 * (Absent Content-Length — chunked encoding — passes; the fronting proxy is
 * the guard there, per docs/architecture.md.)
 */
const MAX_BODY_BYTES = 64 * 1024

/** Wraps a route handler with the origin guard, size gate and error taxonomy. */
export function handleRoute(handler: RouteHandler): RouteHandler {
  return async (req) => {
    if (violatesOriginPolicy(req)) {
      return jsonError(403, 'origin_mismatch', 'Cross-origin request rejected.')
    }

    if (MUTATING_METHODS.has(req.method)) {
      const declared = Number(req.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return jsonError(413, 'payload_too_large', 'Request body too large.')
      }
    }

    try {
      const response = await handler(req)
      // API responses are identity-keyed and must never be cached — not by the
      // browser bfcache (shared front-desk machines), not by intermediaries.
      if (!response.headers.has('Cache-Control')) {
        response.headers.set('Cache-Control', 'no-store')
      }
      return response
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.status, error.code, error.message)
      }
      if (error instanceof ZodError) {
        return jsonError(400, 'invalid_request', 'Request validation failed.')
      }
      // Scrubbed on purpose: a raw Prisma error can carry query details, and
      // auth-route errors must not put submitted emails into log aggregation.
      const cause = error as { name?: string; code?: string; message?: string }
      console.error('unhandled route error', {
        name: cause?.name ?? 'unknown',
        code: cause?.code,
        message: cause?.message,
      })
      return jsonError(500, 'internal', 'Something went wrong.')
    }
  }
}
