// src/lib/api/db-errors.ts
import { ApiError } from '@/lib/api/errors'

/**
 * Translates a database constraint violation into a safe domain ApiError.
 *
 * The Phase-2 schema is the final backstop for invariants the application also
 * pre-checks (uniqueness, room/instructor overlap, the booked_count bound,
 * referential integrity). When a race — or a bug — slips past the pre-check,
 * the constraint fires; this maps the failure to a clean 409/422 and NEVER
 * lets the raw Postgres error, SQL, row data, or constraint text reach the
 * client.
 *
 * The error shapes are pinned to what Prisma 7 over @prisma/adapter-pg
 * actually throws (verified empirically — see tests/unit/db-errors.test.ts and
 * the integration tests that trigger real violations):
 *   - unique      → code 'P2002', meta.driverAdapterError.cause.constraint.index
 *   - foreign key → code 'P2003', …cause.constraint.index
 *   - exclusion   → code 'P2039', …cause.code === '23P01' (no structured
 *                   constraint name — only cause.message carries it)
 *   - check       → code 'P2039', …cause.code === '23514'
 * Exclusion and check share the Prisma code 'P2039', so they are split by the
 * nested SQLSTATE. Room-vs-instructor overlap is classified by substring-
 * matching the constraint name out of cause.message — but ONLY a fixed,
 * pre-written message is ever returned; no PG-supplied text is interpolated.
 */
interface PrismaLikeError {
  code?: string
  meta?: {
    driverAdapterError?: {
      cause?: { code?: string; message?: string; constraint?: { index?: string } | string }
    }
  }
}

function inspect(error: unknown) {
  const e = error as PrismaLikeError
  const prismaCode = e?.code
  const cause = e?.meta?.driverAdapterError?.cause
  const sqlstate = cause?.code
  const constraintIndex =
    typeof cause?.constraint === 'string' ? cause.constraint : cause?.constraint?.index
  // Used ONLY to classify (substring match) — never returned to the client.
  const causeMessage = cause?.message ?? ''
  return { prismaCode, sqlstate, constraintIndex, causeMessage }
}

export interface DbErrorContext {
  /** Message for a unique / FK conflict (409). */
  conflict?: string
  /** Message for a CHECK violation (422). */
  check?: string
}

export function translateDbError(error: unknown, context: DbErrorContext = {}): ApiError | null {
  const { prismaCode, sqlstate, causeMessage } = inspect(error)

  switch (prismaCode) {
    case 'P2002': // unique_violation (23505)
      return new ApiError(409, 'conflict', context.conflict ?? 'That value is already in use.')

    case 'P2003': // foreign_key_violation (23503)
      return new ApiError(
        409,
        'conflict',
        context.conflict ?? 'A referenced record is missing or in use.',
      )

    case 'P2039': {
      // Exclusion (overlap) and CHECK both surface as P2039 — split on SQLSTATE.
      if (sqlstate === '23P01') {
        if (causeMessage.includes('room_no_overlap')) {
          return new ApiError(409, 'room_conflict', 'That room is already booked for this time.')
        }
        if (causeMessage.includes('instructor_no_overlap')) {
          return new ApiError(
            409,
            'instructor_conflict',
            'That instructor already has a session at this time.',
          )
        }
        return new ApiError(409, 'conflict', 'That time slot is no longer available.')
      }
      if (sqlstate === '23514') {
        return new ApiError(
          422,
          'invalid',
          context.check ?? 'A value is outside its allowed range.',
        )
      }
      return null
    }

    default:
      return null // not a recognized constraint violation — handled generically upstream
  }
}

/**
 * Runs a database write and translates any constraint violation. Non-constraint
 * errors propagate unchanged (handleRoute scrubs them into a generic 500).
 */
export async function withDbErrors<T>(
  write: () => Promise<T>,
  context: DbErrorContext = {},
): Promise<T> {
  try {
    return await write()
  } catch (error) {
    const translated = translateDbError(error, context)
    if (translated) throw translated
    throw error
  }
}
