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

// --- Co-instructors (Goal 5) ------------------------------------------------

// Add/remove take an instructor id only; the session id is the path parameter.
// .strict() so no client can smuggle role/primary/session internals into the body.
export const coInstructorSchema = z.object({ instructorId: z.string().uuid() }).strict()

// --- Recurring generation (Goal 7) ------------------------------------------

const weekday = z.number().int().min(0).max(6) // 0 = Sunday … 6 = Saturday
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:MM (24-hour)')

export const generateRecurringSchema = z
  .object({
    classId: z.string().uuid(),
    primaryInstructorId: z.string().uuid(),
    roomId: z.string().uuid(),
    // z.iso.date() (not the format-only calendarDate) so an impossible date like
    // 2027-02-30 is a clean 400, never a silent rollover to March 2.
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    weekdays: z.array(weekday).min(1).max(7),
    startTime: clockTime,
    durationMinutes: durationMinutes.optional(), // omitted → inherit class default
    capacity: capacity.optional(), // omitted → inherit class default
  })
  .strict()
  .refine((v) => v.startDate <= v.endDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })
  .refine((v) => new Set(v.weekdays).size === v.weekdays.length, {
    message: 'weekdays must be unique',
    path: ['weekdays'],
  })

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
export type CoInstructorInput = z.infer<typeof coInstructorSchema>
export type GenerateRecurringInput = z.infer<typeof generateRecurringSchema>
// Appended to src/lib/schemas/domain.ts

const note = z.string().trim().max(1000)

export const createBookingSchema = z
  .object({ sessionId: z.string().uuid(), memberId: z.string().uuid(), note: note.optional() })
  .strict()

export const cancelBookingSchema = z.object({ note: note.optional() }).strict()

// A standalone note requires actual text (a NOTE_ADDED event has note NOT NULL).
export const addNoteSchema = z.object({ note: note.min(1) }).strict()

export const settleBookingSchema = z
  .object({ status: z.enum(['ATTENDED', 'NO_SHOW']), note: note.optional() })
  .strict()

// Goal 6: filters (class/session/status), text search (member name/email, via
// the shared `q`), and allowlisted sort — never a raw column/direction.
export const bookingListQuerySchema = listQuerySchema.extend({
  classId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  status: z.enum(['BOOKED', 'WAITLISTED', 'CANCELLED', 'ATTENDED', 'NO_SHOW']).optional(),
  sort: z.enum(['bookedAt', 'status', 'session']).default('bookedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
})

// A half-open [from, to) date range for the sessions list — `from` inclusive,
// `to` exclusive (avoids end-of-day boundary bugs). Calendar dates at UTC.
export const sessionListQuerySchema = listQuerySchema
  .extend({
    classId: z.string().uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((v) => !(v.from && v.to) || v.from < v.to, {
    message: 'The date range is empty: `to` must be after `from`.',
  })

export type BookingListQuery = z.infer<typeof bookingListQuerySchema>

export type CreateBookingInput = z.infer<typeof createBookingSchema>
