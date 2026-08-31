// tests/integration/constraints.test.ts
//
// Proves the database-level invariants (docs/schema.md, I3–I12) actually hold
// in a freshly migrated database. Every test names the invariant it pins down;
// if a future migration accidentally drops a hand-written constraint or
// trigger, this suite fails in CI.
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { resolveTestDatabaseUrl, truncateAll } from './helpers/test-db'

const pool = new Pool({ connectionString: resolveTestDatabaseUrl() })

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
})

// --- fixtures ---------------------------------------------------------------

async function insertUser(email: string, role = 'INSTRUCTOR'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, role, password_hash)
     VALUES ($1, $2, $3::"UserRole", 'x') RETURNING id`,
    [email, email.split('@')[0], role],
  )
  return rows[0].id
}

async function insertMember(email: string, expiresOn = '2027-01-01'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO members (name, email, membership_expires_on)
     VALUES ($1, $1, $2) RETURNING id`,
    [email, expiresOn],
  )
  return rows[0].id
}

async function insertRoom(name: string): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO rooms (name) VALUES ($1) RETURNING id`, [name])
  return rows[0].id
}

async function insertClass(title = 'Yoga'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO classes (title, description, discipline, default_duration_minutes, default_capacity)
     VALUES ($1, 'desc', 'yoga', 60, 10) RETURNING id`,
    [title],
  )
  return rows[0].id
}

interface SessionFixture {
  classId?: string
  instructorId?: string
  roomId?: string
  startsAt: string // ISO instant
  durationMinutes?: number
  capacity?: number
}

async function insertSession(f: SessionFixture): Promise<string> {
  const classId = f.classId ?? (await insertClass(`c-${f.startsAt}-${Math.random()}`))
  const instructorId = f.instructorId ?? (await insertUser(`i-${Math.random()}@x.test`))
  const roomId = f.roomId ?? (await insertRoom(`r-${Math.random()}`))
  const duration = f.durationMinutes ?? 60
  const { rows } = await pool.query(
    `INSERT INTO class_sessions
       (class_id, starts_at, duration_minutes, ends_at, capacity, primary_instructor_id, room_id)
     VALUES ($1, $2::timestamptz, $3, $2::timestamptz + make_interval(mins => $3), $4, $5, $6)
     RETURNING id`,
    [classId, f.startsAt, duration, f.capacity ?? 10, instructorId, roomId],
  )
  return rows[0].id
}

async function insertBooking(sessionId: string, memberId: string, status = 'BOOKED') {
  const { rows } = await pool.query(
    `INSERT INTO bookings (session_id, member_id, status)
     VALUES ($1, $2, $3::"BookingStatus") RETURNING id, seq`,
    [sessionId, memberId, status],
  )
  return rows[0]
}

// --- I3/I4: value sanity + ends_at consistency ------------------------------

describe('value CHECKs (I3, I4)', () => {
  it('rejects a class with non-positive default duration', async () => {
    await expect(
      pool.query(
        `INSERT INTO classes (title, description, discipline, default_duration_minutes, default_capacity)
         VALUES ('x', 'x', 'x', 0, 10)`,
      ),
    ).rejects.toThrow(/classes_default_duration_positive/)
  })

  it('rejects a class with negative default capacity', async () => {
    await expect(
      pool.query(
        `INSERT INTO classes (title, description, discipline, default_duration_minutes, default_capacity)
         VALUES ('x', 'x', 'x', 60, -1)`,
      ),
    ).rejects.toThrow(/classes_default_capacity_nonnegative/)
  })

  it('rejects a session with non-positive duration', async () => {
    const classId = await insertClass('dur0')
    const instructorId = await insertUser('dur0@x.test')
    const roomId = await insertRoom('dur0-room')
    await expect(
      pool.query(
        `INSERT INTO class_sessions
           (class_id, starts_at, duration_minutes, ends_at, capacity, primary_instructor_id, room_id)
         VALUES ($1, '2026-09-07T10:00:00Z', 0, '2026-09-07T10:00:00Z', 10, $2, $3)`,
        [classId, instructorId, roomId],
      ),
    ).rejects.toThrow(/class_sessions_duration_positive/)
  })

  it('rejects a session with negative capacity', async () => {
    // Two constraints independently forbid this row: capacity >= 0, and
    // booked_count (0) <= capacity. Postgres reports whichever it checks
    // first — either name proves the invariant.
    await expect(insertSession({ startsAt: '2026-09-07T10:00:00Z', capacity: -1 })).rejects.toThrow(
      /class_sessions_(capacity_nonnegative|booked_count_within_capacity)/,
    )
  })

  it('allows capacity 0 — a session everyone waitlists into is legal', async () => {
    await expect(
      insertSession({ startsAt: '2026-09-07T10:00:00Z', capacity: 0 }),
    ).resolves.toBeTruthy()
  })

  it('rejects a session whose ends_at disagrees with starts_at + duration', async () => {
    const classId = await insertClass()
    const instructorId = await insertUser('i4@x.test')
    const roomId = await insertRoom('i4-room')
    await expect(
      pool.query(
        `INSERT INTO class_sessions
           (class_id, starts_at, duration_minutes, ends_at, capacity, primary_instructor_id, room_id)
         VALUES ($1, '2026-09-07T10:00:00Z', 60, '2026-09-07T12:00:00Z', 10, $2, $3)`,
        [classId, instructorId, roomId],
      ),
    ).rejects.toThrow(/class_sessions_ends_at_consistent/)
  })
})

// --- I13: booked_count bound — the hard overbooking backstop ------------------

describe('booked_count within capacity (I13)', () => {
  it('rejects pushing booked_count past capacity', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T08:00:00Z', capacity: 10 })
    await expect(
      pool.query(`UPDATE class_sessions SET booked_count = 11 WHERE id = $1`, [sessionId]),
    ).rejects.toThrow(/class_sessions_booked_count_within_capacity/)
  })

  it('rejects a negative booked_count', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T08:00:00Z' })
    await expect(
      pool.query(`UPDATE class_sessions SET booked_count = -1 WHERE id = $1`, [sessionId]),
    ).rejects.toThrow(/class_sessions_booked_count_within_capacity/)
  })

  it('rejects shrinking capacity below the current booked count', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T08:00:00Z', capacity: 10 })
    await pool.query(`UPDATE class_sessions SET booked_count = 5 WHERE id = $1`, [sessionId])
    await expect(
      pool.query(`UPDATE class_sessions SET capacity = 3 WHERE id = $1`, [sessionId]),
    ).rejects.toThrow(/class_sessions_booked_count_within_capacity/)
  })
})

// --- I1/I2: case-insensitive uniqueness ---------------------------------------

describe('case-insensitive uniqueness (I1, I2)', () => {
  it('rejects a user email differing only by case', async () => {
    await insertUser('casey@x.test')
    await expect(insertUser('CASEY@x.test')).rejects.toThrow(/users_email_ci_unique/)
  })

  it('rejects a member email differing only by case', async () => {
    await insertMember('member@x.test')
    await expect(insertMember('Member@X.test')).rejects.toThrow(/members_email_ci_unique/)
  })

  it("rejects 'Studio A' and 'studio a' as two rooms", async () => {
    await insertRoom('Studio A')
    await expect(insertRoom('studio a')).rejects.toThrow(/rooms_name_ci_unique/)
  })
})

// --- I5: room exclusivity ----------------------------------------------------

describe('room overlap exclusion (I5)', () => {
  const overlapShapes: Array<[string, string]> = [
    ['identical start', '2026-09-07T10:00:00Z'],
    ['partial overlap', '2026-09-07T10:30:00Z'],
    ['contained inside', '2026-09-07T10:15:00Z'],
  ]

  for (const [shape, secondStart] of overlapShapes) {
    it(`rejects ${shape} in the same room`, async () => {
      const roomId = await insertRoom(`shape-${shape}`)
      await insertSession({ roomId, startsAt: '2026-09-07T10:00:00Z', durationMinutes: 60 })
      await expect(
        insertSession({ roomId, startsAt: secondStart, durationMinutes: 30 }),
      ).rejects.toThrow(/class_sessions_room_no_overlap/)
    })
  }

  it('rejects a containing overlap (second session envelops the first)', async () => {
    const roomId = await insertRoom('containing')
    await insertSession({ roomId, startsAt: '2026-09-07T10:00:00Z', durationMinutes: 30 })
    await expect(
      insertSession({ roomId, startsAt: '2026-09-07T09:30:00Z', durationMinutes: 120 }),
    ).rejects.toThrow(/class_sessions_room_no_overlap/)
  })

  it('allows adjacent sessions — one ends exactly when the next starts', async () => {
    const roomId = await insertRoom('adjacent')
    await insertSession({ roomId, startsAt: '2026-09-07T10:00:00Z', durationMinutes: 60 })
    await expect(
      insertSession({ roomId, startsAt: '2026-09-07T11:00:00Z', durationMinutes: 60 }),
    ).resolves.toBeTruthy()
  })

  it('allows the same time slot in a different room', async () => {
    await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    await expect(insertSession({ startsAt: '2026-09-07T10:00:00Z' })).resolves.toBeTruthy()
  })
})

// --- I6: primary instructor exclusivity --------------------------------------

describe('primary instructor overlap exclusion (I6)', () => {
  it('rejects the same primary instructor in two overlapping sessions', async () => {
    const instructorId = await insertUser('busy@x.test')
    await insertSession({ instructorId, startsAt: '2026-09-07T10:00:00Z', durationMinutes: 60 })
    await expect(
      insertSession({ instructorId, startsAt: '2026-09-07T10:59:00Z', durationMinutes: 60 }),
    ).rejects.toThrow(/class_sessions_primary_instructor_no_overlap/)
  })

  it('allows the same primary instructor back-to-back', async () => {
    const instructorId = await insertUser('backtoback@x.test')
    await insertSession({ instructorId, startsAt: '2026-09-07T10:00:00Z', durationMinutes: 60 })
    await expect(
      insertSession({ instructorId, startsAt: '2026-09-07T11:00:00Z', durationMinutes: 60 }),
    ).resolves.toBeTruthy()
  })
})

// --- I7: one active booking per member per session ---------------------------

describe('partial unique on active bookings (I7)', () => {
  it('rejects a second active booking for the same member and session', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('dup@x.test')
    await insertBooking(sessionId, memberId, 'BOOKED')
    await expect(insertBooking(sessionId, memberId, 'WAITLISTED')).rejects.toThrow(
      /bookings_one_active_per_member_session/,
    )
  })

  it('allows rebooking after a cancellation', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('rebook@x.test')
    const first = await insertBooking(sessionId, memberId, 'BOOKED')
    await pool.query(`UPDATE bookings SET status = 'CANCELLED' WHERE id = $1`, [first.id])
    await expect(insertBooking(sessionId, memberId, 'BOOKED')).resolves.toBeTruthy()
  })
})

// --- I8: booking_events is append-only ---------------------------------------

describe('booking_events immutability (I8)', () => {
  async function seedEvent() {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember(`ev-${Math.random()}@x.test`)
    const staffId = await insertUser(`staff-${Math.random()}@x.test`, 'STAFF')
    const booking = await insertBooking(sessionId, memberId)
    const { rows } = await pool.query(
      `INSERT INTO booking_events (booking_id, type, to_status, actor_user_id)
       VALUES ($1, 'CREATED', 'BOOKED', $2) RETURNING id`,
      [booking.id, staffId],
    )
    return rows[0].id
  }

  it('rejects UPDATE', async () => {
    const id = await seedEvent()
    await expect(
      pool.query(`UPDATE booking_events SET note = 'rewritten' WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/)
  })

  it('rejects DELETE', async () => {
    const id = await seedEvent()
    await expect(pool.query(`DELETE FROM booking_events WHERE id = $1`, [id])).rejects.toThrow(
      /append-only/,
    )
  })

  it('rejects TRUNCATE', async () => {
    await seedEvent()
    await expect(pool.query(`TRUNCATE booking_events`)).rejects.toThrow(/append-only/)
  })

  it('rejects truncating bookings and events together (trigger, not just the FK)', async () => {
    await seedEvent()
    // Truncating the pair sidesteps the FK objection, so only the triggers
    // stand between this statement and the entire Goal 9 timeline vanishing.
    await expect(pool.query(`TRUNCATE bookings, booking_events`)).rejects.toThrow(
      /never deleted|append-only/,
    )
  })
})

// --- I9: booking identity is frozen ------------------------------------------

describe('booking identity freeze (I9)', () => {
  it('allows a status change', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('freeze-ok@x.test')
    const booking = await insertBooking(sessionId, memberId)
    await expect(
      pool.query(`UPDATE bookings SET status = 'CANCELLED' WHERE id = $1`, [booking.id]),
    ).resolves.toBeTruthy()
  })

  it('rejects moving a booking to a different member', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('freeze-a@x.test')
    const otherId = await insertMember('freeze-b@x.test')
    const booking = await insertBooking(sessionId, memberId)
    await expect(
      pool.query(`UPDATE bookings SET member_id = $2 WHERE id = $1`, [booking.id, otherId]),
    ).rejects.toThrow(/immutable/)
  })

  it('rejects rewriting the primary key', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('freeze-id@x.test')
    const booking = await insertBooking(sessionId, memberId)
    await expect(
      pool.query(`UPDATE bookings SET id = gen_random_uuid() WHERE id = $1`, [booking.id]),
    ).rejects.toThrow(/immutable/)
  })

  it('rejects deleting a booking even when it has no events yet', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('nodelete@x.test')
    const booking = await insertBooking(sessionId, memberId)
    await expect(pool.query(`DELETE FROM bookings WHERE id = $1`, [booking.id])).rejects.toThrow(
      /never deleted/,
    )
  })

  it('rejects rewriting the waitlist position (seq)', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('freeze-seq@x.test')
    const booking = await insertBooking(sessionId, memberId)
    await expect(
      pool.query(`UPDATE bookings SET seq = seq + 1000 WHERE id = $1`, [booking.id]),
    ).rejects.toThrow(/immutable/)
  })

  it('rejects moving a booking to a different session', async () => {
    const sessionA = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const sessionB = await insertSession({ startsAt: '2026-09-07T12:00:00Z' })
    const memberId = await insertMember('freeze-sess@x.test')
    const booking = await insertBooking(sessionA, memberId)
    await expect(
      pool.query(`UPDATE bookings SET session_id = $2 WHERE id = $1`, [booking.id, sessionB]),
    ).rejects.toThrow(/immutable/)
  })

  it('rejects rewriting the booked-at time', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('freeze-c@x.test')
    const booking = await insertBooking(sessionId, memberId)
    await expect(
      pool.query(`UPDATE bookings SET created_at = now() WHERE id = $1`, [booking.id]),
    ).rejects.toThrow(/immutable/)
  })
})

// --- I10: event shape --------------------------------------------------------

describe('event shape CHECK (I10)', () => {
  it('rejects a CREATED event carrying a from_status', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('shape@x.test')
    const staffId = await insertUser('shape-staff@x.test', 'STAFF')
    const booking = await insertBooking(sessionId, memberId)
    await expect(
      pool.query(
        `INSERT INTO booking_events (booking_id, type, from_status, to_status, actor_user_id)
         VALUES ($1, 'CREATED', 'BOOKED', 'BOOKED', $2)`,
        [booking.id, staffId],
      ),
    ).rejects.toThrow(/booking_events_shape_matches_type/)
  })

  it('rejects a STATUS_CHANGED event missing its from_status', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('shape3@x.test')
    const staffId = await insertUser('shape3-staff@x.test', 'STAFF')
    const booking = await insertBooking(sessionId, memberId)
    await expect(
      pool.query(
        `INSERT INTO booking_events (booking_id, type, to_status, actor_user_id)
         VALUES ($1, 'STATUS_CHANGED', 'CANCELLED', $2)`,
        [booking.id, staffId],
      ),
    ).rejects.toThrow(/booking_events_shape_matches_type/)
  })

  it('accepts a well-formed STATUS_CHANGED event', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('shape4@x.test')
    const staffId = await insertUser('shape4-staff@x.test', 'STAFF')
    const booking = await insertBooking(sessionId, memberId)
    await expect(
      pool.query(
        `INSERT INTO booking_events (booking_id, type, from_status, to_status, note, actor_user_id)
         VALUES ($1, 'STATUS_CHANGED', 'BOOKED', 'CANCELLED', 'member called in', $2)`,
        [booking.id, staffId],
      ),
    ).resolves.toBeTruthy()
  })

  it('rejects a NOTE_ADDED event without a note', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('shape2@x.test')
    const staffId = await insertUser('shape2-staff@x.test', 'STAFF')
    const booking = await insertBooking(sessionId, memberId)
    await expect(
      pool.query(
        `INSERT INTO booking_events (booking_id, type, actor_user_id) VALUES ($1, 'NOTE_ADDED', $2)`,
        [booking.id, staffId],
      ),
    ).rejects.toThrow(/booking_events_shape_matches_type/)
  })
})

// --- I11: history is unreachable by deletion ---------------------------------

describe('RESTRICT protects history (I11)', () => {
  it('refuses to delete a session that has bookings', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('restrict@x.test')
    await insertBooking(sessionId, memberId)
    await expect(
      pool.query(`DELETE FROM class_sessions WHERE id = $1`, [sessionId]),
    ).rejects.toThrow(/foreign key|violates/)
  })

  it('refuses to delete a member that has bookings', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const memberId = await insertMember('restrict2@x.test')
    await insertBooking(sessionId, memberId)
    await expect(pool.query(`DELETE FROM members WHERE id = $1`, [memberId])).rejects.toThrow(
      /foreign key|violates/,
    )
  })

  it('refuses to delete a member that has alert dismissals', async () => {
    const memberId = await insertMember('restrict3@x.test', '2026-09-03')
    const staffId = await insertUser('restrict3-staff@x.test', 'STAFF')
    await pool.query(
      `INSERT INTO membership_alert_dismissals (member_id, membership_expires_on, dismissed_by_id)
       VALUES ($1, '2026-09-03', $2)`,
      [memberId, staffId],
    )
    await expect(pool.query(`DELETE FROM members WHERE id = $1`, [memberId])).rejects.toThrow(
      /foreign key|violates/,
    )
  })

  it('refuses to delete a user with a live auth session', async () => {
    const userId = await insertUser('session-holder@x.test', 'STAFF')
    await pool.query(
      `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
       VALUES ($2, $1, now() + interval '1 day')`,
      [userId, 'a'.repeat(64)],
    )
    await expect(pool.query(`DELETE FROM users WHERE id = $1`, [userId])).rejects.toThrow(
      /foreign key|violates/,
    )
  })

  it('sanctions exactly one ON DELETE CASCADE in the whole schema', async () => {
    // docs/schema.md's rule, pinned: only session_instructors.session_id may
    // cascade. A future FK quietly shipping with CASCADE fails here.
    const { rows } = await pool.query(`
      SELECT conname FROM pg_constraint
      WHERE contype = 'f' AND confdeltype = 'c'
      ORDER BY conname
    `)
    expect(rows.map((r) => r.conname)).toEqual(['session_instructors_session_id_fkey'])
  })

  it('allows deleting a session with no bookings (cascades co-instructor links)', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const coId = await insertUser('co@x.test')
    await pool.query(
      `INSERT INTO session_instructors (session_id, instructor_id) VALUES ($1, $2)`,
      [sessionId, coId],
    )
    await expect(
      pool.query(`DELETE FROM class_sessions WHERE id = $1`, [sessionId]),
    ).resolves.toBeTruthy()
    const links = await pool.query(
      `SELECT count(*)::int AS n FROM session_instructors WHERE session_id = $1`,
      [sessionId],
    )
    expect(links.rows[0].n).toBe(0)
  })
})

// --- I12: dismissal idempotence ----------------------------------------------

describe('alert dismissal uniqueness (I12)', () => {
  it('rejects dismissing the same member+expiry pair twice', async () => {
    const memberId = await insertMember('alert@x.test', '2026-09-03')
    const staffId = await insertUser('alert-staff@x.test', 'STAFF')
    await pool.query(
      `INSERT INTO membership_alert_dismissals (member_id, membership_expires_on, dismissed_by_id)
       VALUES ($1, '2026-09-03', $2)`,
      [memberId, staffId],
    )
    await expect(
      pool.query(
        `INSERT INTO membership_alert_dismissals (member_id, membership_expires_on, dismissed_by_id)
         VALUES ($1, '2026-09-03', $2)`,
        [memberId, staffId],
      ),
    ).rejects.toThrow(/unique|duplicate/i)
  })

  it('allows a new dismissal after the expiry date changes', async () => {
    const memberId = await insertMember('alert2@x.test', '2026-09-03')
    const staffId = await insertUser('alert2-staff@x.test', 'STAFF')
    await pool.query(
      `INSERT INTO membership_alert_dismissals (member_id, membership_expires_on, dismissed_by_id)
       VALUES ($1, '2026-09-03', $2)`,
      [memberId, staffId],
    )
    await expect(
      pool.query(
        `INSERT INTO membership_alert_dismissals (member_id, membership_expires_on, dismissed_by_id)
         VALUES ($1, '2026-12-24', $2)`,
        [memberId, staffId],
      ),
    ).resolves.toBeTruthy()
  })
})

// --- waitlist ordering foundation --------------------------------------------

describe('booking seq (waitlist order foundation)', () => {
  it('assigns strictly increasing seq in insert order', async () => {
    const sessionId = await insertSession({ startsAt: '2026-09-07T10:00:00Z' })
    const seqs: number[] = []
    for (let i = 0; i < 3; i++) {
      const memberId = await insertMember(`seq-${i}@x.test`)
      const b = await insertBooking(sessionId, memberId, 'WAITLISTED')
      seqs.push(b.seq)
    }
    expect(seqs[0]).toBeLessThan(seqs[1]!)
    expect(seqs[1]).toBeLessThan(seqs[2]!)
  })
})
