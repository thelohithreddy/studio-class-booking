// scripts/demo-seed.mjs
//
// Local DEMO enrichment. After `pnpm db:seed` creates the static entities, this
// drives the REAL HTTP API (as staff) to produce a realistic operating dataset:
// booked + waitlisted bookings, a waitlist promotion, attendance (attended /
// no-show), a booking note, a co-instructor, and a recurring series — so the
// product can be evaluated with meaningful data. Nothing is fabricated: every
// row goes through the real booking rules, state machine, and history.
//
// Usage:  pnpm dev  (in one shell)  then  pnpm db:demo
// SAFETY: talks only to http://localhost:3000. Never touches production.
const BASE = process.env.DEMO_BASE || 'http://localhost:3000'
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  console.error(`Refusing to run demo seed against ${BASE} — localhost only.`)
  process.exit(1)
}

let cookie = ''
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const sc = res.headers.get('set-cookie')
  if (sc && sc.includes('studio_session=')) cookie = sc.split(';')[0]
  const ct = res.headers.get('content-type') || ''
  const json = ct.includes('application/json') ? await res.json().catch(() => null) : null
  return { status: res.status, json }
}
const log = (m) => console.log('  ' + m)

async function main() {
  const login = await api('POST', '/api/auth/login', {
    email: process.env.SEED_STAFF_EMAIL || 'staff@studio.test',
    password: process.env.SEED_PASSWORD || 'studio123',
  })
  if (login.status !== 204) {
    console.error('Could not sign in as staff — run `pnpm db:seed` first. Status', login.status)
    process.exit(1)
  }

  const existing = await api('GET', '/api/bookings?pageSize=1')
  if ((existing.json?.total ?? 0) > 0) {
    log('Bookings already exist — demo data is in place. Nothing to do.')
    return
  }

  const members = (await api('GET', '/api/members?pageSize=100')).json.members
  const active = members.filter((m) => new Date(m.membershipExpiresOn) >= new Date())
  const classes = (await api('GET', '/api/classes?pageSize=100')).json.classes
  const rooms = (await api('GET', '/api/rooms')).json.rooms
  const instructors = (await api('GET', '/api/instructors')).json.instructors
  const allSessions = (await api('GET', '/api/sessions?pageSize=100')).json.sessions
  const now = Date.now()
  const past = allSessions.filter((s) => new Date(s.startsAt).getTime() < now)
  const upcoming = allSessions.filter((s) => new Date(s.startsAt).getTime() >= now)

  const book = (sessionId, memberId, note) =>
    api('POST', '/api/bookings', { sessionId, memberId, ...(note ? { note } : {}) })

  // 1) A capacity-2 session that fills, waitlists, then promotes on cancel.
  const startsAt = new Date(now + 3 * 24 * 3600e3 + 5 * 3600e3).toISOString()
  const demoSession = await api('POST', '/api/sessions', {
    classId: classes[0].id,
    roomId: rooms[0].id,
    primaryInstructorId: instructors[0].id,
    startsAt,
    durationMinutes: 60,
    capacity: 2,
  })
  const sid = demoSession.json.session.id
  const b1 = (await book(sid, active[0].id)).json.booking // BOOKED
  await book(sid, active[1].id, 'Regular — prefers the front row.') // BOOKED (fills it)
  const b3 = (await book(sid, active[2].id)).json.booking // WAITLISTED
  await api('POST', `/api/bookings/${b1.id}/cancel`, { note: 'Member called to cancel.' }) // promotes b3
  log(`Waitlist demo: booked 2, waitlisted 1, cancelled 1 → promoted (${b3.status} → booked).`)

  // 2) A few more confirmed bookings on the nearest upcoming sessions.
  let mi = 3
  for (const s of upcoming.slice(0, 3)) {
    for (let k = 0; k < 3 && mi < active.length; k++, mi++) {
      await book(s.id, active[mi].id)
    }
  }
  log('Seeded confirmed bookings across upcoming sessions.')

  // 3) Attendance on a past session: attended + no-show + one left booked.
  if (past[0]) {
    const p = past[0]
    const pb = []
    for (let k = 0; k < 3 && k < active.length; k++) {
      const r = await book(p.id, active[k].id)
      if (r.status === 201) pb.push(r.json.booking.id)
    }
    if (pb[0]) await api('POST', `/api/bookings/${pb[0]}/settle`, { status: 'ATTENDED' })
    if (pb[1]) await api('POST', `/api/bookings/${pb[1]}/settle`, { status: 'NO_SHOW' })
    log('Attendance demo: 1 attended, 1 no-show, 1 left booked on a past session.')
  }

  // 4) Co-instructor on a session an instructor already primaries (non-overlapping).
  const ivySession = allSessions.find((s) => s.primaryInstructor.id === instructors[0].id)
  const other = instructors[1]
  if (ivySession && other) {
    const r = await api('POST', `/api/sessions/${ivySession.id}/co-instructors`, {
      instructorId: other.id,
    })
    if (r.status === 200) log(`Co-instructor demo: added ${other.name} to a session.`)
  }

  // 5) A short recurring series next month.
  const gStart = new Date(now + 30 * 24 * 3600e3).toISOString().slice(0, 10)
  const gEnd = new Date(now + 44 * 24 * 3600e3).toISOString().slice(0, 10)
  const gen = await api('POST', '/api/sessions/generate', {
    classId: classes[1] ? classes[1].id : classes[0].id,
    primaryInstructorId: instructors[1].id,
    roomId: rooms[rooms.length - 1].id,
    startDate: gStart,
    endDate: gEnd,
    weekdays: [2, 4],
    startTime: '19:00',
  })
  if (gen.status === 200) log(`Recurring demo: created ${gen.json.summary.created} sessions.`)

  const totals = await api('GET', '/api/bookings?pageSize=1')
  console.log(`\nDemo data ready — ${totals.json.total} bookings across the studio.`)
}

main().catch((e) => {
  console.error('demo seed failed:', e.message)
  process.exit(1)
})
