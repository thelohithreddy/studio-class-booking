// app/_lib/types.ts
//
// Client-side mirror of the API's wire contracts (verified against every route
// handler). These describe exactly what the browser receives — field names,
// nullability, and the wrapping envelope — so pages are written against the real
// server shapes rather than guesses. Kept as plain TypeScript unions (no runtime
// import of the generated Prisma client into the browser bundle).

export type UserRole = 'STAFF' | 'INSTRUCTOR'
export type BookingStatus = 'BOOKED' | 'WAITLISTED' | 'CANCELLED' | 'ATTENDED' | 'NO_SHOW'
export type BookingEventType = 'CREATED' | 'STATUS_CHANGED' | 'NOTE_ADDED'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: UserRole
}

/** The shared pagination envelope: { <key>: T[], total, page, pageSize }. */
export interface Paginated {
  total: number
  page: number
  pageSize: number
}

// ── Classes ────────────────────────────────────────────────────────────────
export interface ClassDTO {
  id: string
  title: string
  description: string
  discipline: string
  defaultDurationMinutes: number
  defaultCapacity: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}
export type ClassDetail = ClassDTO & { _count: { sessions: number } }
export interface ClassListResponse extends Paginated {
  classes: ClassDTO[]
}

// ── Sessions ───────────────────────────────────────────────────────────────
export interface SessionDisplayRelations {
  class: { title: string; discipline: string }
  room: { name: string }
  primaryInstructor: { id: string; name: string }
}
export interface SessionListItem extends SessionDisplayRelations {
  id: string
  classId: string
  startsAt: string
  endsAt: string
  capacity: number
  bookedCount: number
  roomId: string
  primaryInstructorId: string
}
export interface SessionDetail extends SessionDisplayRelations {
  id: string
  classId: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  capacity: number
  bookedCount: number
  primaryInstructorId: string
  roomId: string
}
export interface SessionListResponse extends Paginated {
  sessions: SessionListItem[]
}

export interface CoInstructorRoster {
  primary: { id: string; name: string }
  coInstructors: Array<{ id: string; name: string }>
}
export interface RosterResponse {
  instructors: CoInstructorRoster
}

export interface GenerateResult {
  created: Array<{ id: string; startsAt: string }>
  skipped: Array<{ date: string; reason: 'instructor' | 'room' }>
  summary: { requested: number; created: number; skipped: number }
}

// ── Bookings ───────────────────────────────────────────────────────────────
export interface BookingListItem {
  id: string
  seq: number
  sessionId: string
  memberId: string
  status: BookingStatus
  createdAt: string
  updatedAt: string
  member: { id: string; name: string }
  session: { id: string; startsAt: string; class: { title: string } }
}
export interface BookingEvent {
  id: string
  type: BookingEventType
  fromStatus: BookingStatus | null
  toStatus: BookingStatus | null
  note: string | null
  createdAt: string
  actor: { id: string; name: string }
}
export interface BookingDetail {
  id: string
  seq: number
  sessionId: string
  memberId: string
  status: BookingStatus
  createdAt: string
  updatedAt: string
  member: { id: string; name: string }
  session: { id: string; startsAt: string; class: { title: string } }
  events: BookingEvent[]
}
/** The compact booking returned by create/cancel/settle/notes (no relations). */
export interface BookingMutationResult {
  id: string
  seq: number
  sessionId: string
  memberId: string
  status: BookingStatus
  createdAt: string
  updatedAt: string
}
export interface BookingListResponse extends Paginated {
  bookings: BookingListItem[]
}

// ── Members ────────────────────────────────────────────────────────────────
export interface Member {
  id: string
  name: string
  email: string
  /** ISO-8601 datetime at UTC midnight — read as a calendar date via formatMembershipDate. */
  membershipExpiresOn: string
  createdAt: string
  updatedAt: string
}
export interface MemberListResponse extends Paginated {
  members: Member[]
}
/** From GET /api/members/alerts — note membershipExpiresOn is a bare YYYY-MM-DD here. */
export interface MembershipAlert {
  memberId: string
  name: string
  membershipExpiresOn: string
  daysRemaining: number
}
export interface MembershipAlertsResponse {
  alerts: MembershipAlert[]
  count: number
}

// ── Rooms ──────────────────────────────────────────────────────────────────
export interface Room {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}
export interface RoomListResponse {
  rooms: Room[]
}

// ── Instructors (new minimal picker endpoint) ───────────────────────────────
export interface Instructor {
  id: string
  name: string
  email: string
}
export interface InstructorListResponse {
  instructors: Instructor[]
}

// ── Wrapped single-entity responses ─────────────────────────────────────────
export interface ClassResponse {
  class: ClassDTO
}
export interface ClassDetailResponse {
  class: ClassDetail
}
export interface SessionResponse {
  session: SessionDetail
}
export interface MemberResponse {
  member: Member
}
export interface RoomResponse {
  room: Room
}
export interface BookingResponse {
  booking: BookingMutationResult
}
export interface BookingDetailResponse {
  booking: BookingDetail
}
export interface MeResponse {
  user: SessionUser
}
