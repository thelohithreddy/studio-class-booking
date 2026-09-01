// src/server/domain/ids.ts
import { z } from 'zod'

import { ApiError } from '@/lib/api/errors'

const uuid = z.string().uuid()

/**
 * Validates a path/id parameter as a uuid, throwing the entity's 404 when it
 * is malformed. A non-uuid cannot name a row, and validating it here keeps
 * Prisma's invalid-uuid error (P2007 on the pg adapter) from surfacing as a
 * generic 500 — an absent and a malformed id look identical to the client.
 */
export function parseIdOr404(id: string, notFoundMessage: string): string {
  const parsed = uuid.safeParse(id)
  if (!parsed.success) throw new ApiError(404, 'not_found', notFoundMessage)
  return parsed.data
}
