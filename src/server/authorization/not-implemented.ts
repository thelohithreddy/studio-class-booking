// src/server/authorization/not-implemented.ts
import { jsonError } from '@/lib/api/errors'

/**
 * Phase 4 ships the authorization guards for every future mutating endpoint
 * but none of the business logic behind them. An endpoint whose guard has
 * already run — i.e. an AUTHORIZED caller — gets a 501 here. The point is that
 * every UNauthorized caller is already stopped by the real production guard,
 * so when a later phase replaces this 501 with the actual work, the Phase-4
 * attack suite is still guarding the door.
 */
export function notImplemented(feature: string): Response {
  return jsonError(501, 'not_implemented', `${feature} is not implemented yet.`)
}
