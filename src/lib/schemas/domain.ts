// src/lib/schemas/domain.ts
import { z } from 'zod'

import { normalizeEmail } from '@/lib/email'

/**
 * Boundary validation for every domain write. Each schema is `.strict()` — an
 * unexpected key (id, createdAt, bookedCount, endsAt, archivedAt, role, …) is
 * a 400, not a silently-ignored field — and server-managed values are never
 * accepted here; the services set them.
 *
 * Bounds are generous but finite: they stop obviously-bad or abusive input
 * (empty titles, day-plus durations, gigabyte strings) without encoding studio
 * policy the brief doesn't state.
 */
const title = z.string().trim().min(1).max(200)
const description = z.string().max(2000)
const discipline = z.string().trim().min(1).max(80)
const durationMinutes = z.number().int().min(1).max(1440) // 1 min .. 24 h
const capacity = z.number().int().min(0).max(100_000)
const name = z.string().trim().min(1).max(200)
const roomName = z.string().trim().min(1).max(120)

// An ISO-8601 instant with an explicit offset (Z or ±hh:mm) — never an
// ambiguous local timestamp. The exact validator is pinned by the runtime
// probe; datetime({ offset: true }) accepts both Z and numeric offsets.
const instant = z.string().datetime({ offset: true })

// A calendar date (YYYY-MM-DD). Stored as UTC midnight (rule A10).
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')

const email = z.string().max(254).transform(normalizeEmail).pipe(z.string().email().max(254))

// --- Class ------------------------------------------------------------------

export const createClassSchema = z
  .object({
    title,
    description,
    discipline,
    defaultDurationMinutes: durationMinutes,
    defaultCapacity: capacity,
  })
  .strict()

export const updateClassSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    discipline: discipline.optional(),
    defaultDurationMinutes: durationMinutes.optional(),
    defaultCapacity: capacity.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// --- Member -----------------------------------------------------------------

export const createMemberSchema = z
  .object({ name, email, membershipExpiresOn: calendarDate })
  .strict()

export const updateMemberSchema = z
  .object({
    name: name.optional(),
    email: email.optional(),
    membershipExpiresOn: calendarDate.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// --- Room -------------------------------------------------------------------

export const createRoomSchema = z.object({ name: roomName }).strict()
export const updateRoomSchema = z.object({ name: roomName }).strict()

// --- Session ----------------------------------------------------------------

export const createSessionSchema = z
  .object({
    classId: z.string().uuid(),
    startsAt: instant,
    durationMinutes: durationMinutes.optional(), // omitted → inherit class default
    capacity: capacity.optional(), // omitted → inherit class default
    primaryInstructorId: z.string().uuid(),
    roomId: z.string().uuid(),
  })
  .strict()

export const updateSessionSchema = z
  .object({
    startsAt: instant.optional(),
    durationMinutes: durationMinutes.optional(),
    capacity: capacity.optional(),
    primaryInstructorId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    // classId is intentionally NOT updatable in Phase 5 (moving a session
    // between classes reopens default-inheritance semantics; out of scope).
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// --- List / query params ----------------------------------------------------

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
})

export type CreateClassInput = z.infer<typeof createClassSchema>
export type UpdateClassInput = z.infer<typeof updateClassSchema>
export type CreateMemberInput = z.infer<typeof createMemberSchema>
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>
export type CreateRoomInput = z.infer<typeof createRoomSchema>
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>
export type CreateSessionInput = z.infer<typeof createSessionSchema>
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>
