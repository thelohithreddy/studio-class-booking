// scripts/seed-dev.mjs
//
// Local development seed. Populates a LOCAL Postgres (docker-compose `db`,
// database studio_dev) with a staff login, instructors, rooms, classes, members
// (with alert-worthy expiries) and a spread of sessions, so the app is usable
// the moment you sign in. Bookings are intentionally left out — create those
// through the UI to exercise the real booking / waitlist / attendance flow.
//
// Usage:  pnpm db:seed        (targets DATABASE_URL, defaulting to local docker)
//
// SAFETY: refuses to run against a non-local host unless ALLOW_SEED=true, so it
// can never accidentally write to a managed/production database.
import pg from 'pg'
import { hash } from '@node-rs/argon2'

const { Client } = pg

const DEFAULT_LOCAL = 'postgresql://studio:studio@localhost:5432/studio_dev?schema=public'
const url = process.env.DATABASE_URL || DEFAULT_LOCAL

const host = new URL(url).hostname
const isLocal = host === 'localhost' || host === '127.0.0.1'
if (!isLocal && process.env.ALLOW_SEED !== 'true') {
  console.error(
    `Refusing to seed a non-local database (${host}). This is a development seed.\n` +
      `If you really mean to, set ALLOW_SEED=true — but never seed production.`,
  )
  process.exit(1)
}

// Matches src/server/auth/password.ts (OWASP argon2id minimums).
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }
const PASSWORD = process.env.SEED_PASSWORD || 'studio123'

const db = new Client({ connectionString: url })

function isoDatePlusDays(days) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function at(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 3_600_000)
}

async function main() {
  await db.connect()

  const { rows: existing } = await db.query('select count(*)::int as n from users')
  if (existing[0].n > 0) {
    console.log('Users already exist — skipping seed (nothing changed).')
    console.log('Existing staff login (if seeded by this script): staff@studio.test / ' + PASSWORD)
    return
  }

  const passwordHash = await hash(PASSWORD, ARGON2_OPTIONS)

  async function addUser(email, name, role) {
    const { rows } = await db.query(
      'insert into users(email, name, role, password_hash) values ($1,$2,$3::"UserRole",$4) returning id',
      [email, name, role, passwordHash],
    )
    return rows[0].id
  }
  async function addRoom(name) {
    const { rows } = await db.query('insert into rooms(name) values ($1) returning id', [name])
    return rows[0].id
  }
  async function addClass(title, description, discipline, duration, capacity) {
    const { rows } = await db.query(
      'insert into classes(title, description, discipline, default_duration_minutes, default_capacity) values ($1,$2,$3,$4,$5) returning id',
      [title, description, discipline, duration, capacity],
    )
    return rows[0].id
  }
  async function addMember(name, email, expiresOnDays) {
    await db.query(
      'insert into members(name, email, membership_expires_on) values ($1,$2,$3::date)',
      [name, email, isoDatePlusDays(expiresOnDays)],
    )
  }
  async function addSession(classId, instructorId, roomId, startsAt, durationMinutes, capacity) {
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000)
    await db.query(
      `insert into class_sessions(class_id, starts_at, duration_minutes, ends_at, capacity, primary_instructor_id, room_id)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [classId, startsAt, durationMinutes, endsAt, capacity, instructorId, roomId],
    )
  }

  // Users
  await addUser('staff@studio.test', 'Alex Morgan', 'STAFF')
  const ivy = await addUser('ivy@studio.test', 'Ivy Chen', 'INSTRUCTOR')
  const leo = await addUser('leo@studio.test', 'Leo Park', 'INSTRUCTOR')

  // Rooms
  const studioA = await addRoom('Studio A')
  const studioB = await addRoom('Studio B')

  // Classes
  const vinyasa = await addClass('Vinyasa Flow', 'A dynamic, breath-led yoga flow.', 'Yoga', 60, 12)
  const hiit = await addClass(
    'HIIT Circuit',
    'High-intensity interval training.',
    'Fitness',
    45,
    16,
  )
  const pilates = await addClass('Reformer Pilates', 'Low-impact reformer work.', 'Pilates', 50, 8)

  // Members — a spread of statuses so the alerts area is populated on first login.
  await addMember('Jordan Lee', 'jordan@example.com', 200)
  await addMember('Priya Nair', 'priya@example.com', 120)
  await addMember('Sam Okafor', 'sam@example.com', 90)
  await addMember('Mina Haddad', 'mina@example.com', 45)
  await addMember('Tom Becker', 'tom@example.com', 30)
  await addMember('Rosa Vidal', 'rosa@example.com', 6) // expiring soon
  await addMember('Kenji Ito', 'kenji@example.com', 3) // expiring soon
  await addMember('Dana Frost', 'dana@example.com', -10) // expired

  // Sessions — all at distinct times so no room/instructor overlap is violated.
  await addSession(vinyasa, ivy, studioA, at(-20), 60, 12) // yesterday (past → attendance demo)
  await addSession(hiit, leo, studioB, at(3), 45, 16) // later today
  await addSession(pilates, ivy, studioA, at(6), 50, 8) // later today
  await addSession(vinyasa, leo, studioA, at(27), 60, 12) // tomorrow
  await addSession(hiit, ivy, studioB, at(30), 45, 16) // tomorrow
  await addSession(pilates, leo, studioA, at(51), 50, 8) // in ~2 days

  const counts = await db.query(
    'select (select count(*) from users) users, (select count(*) from classes) classes, (select count(*) from class_sessions) sessions, (select count(*) from members) members',
  )
  console.log('Seeded:', counts.rows[0])
  console.log('')
  console.log('Sign in at http://localhost:3000/login')
  console.log(`  Staff:      staff@studio.test  /  ${PASSWORD}`)
  console.log(`  Instructor: ivy@studio.test    /  ${PASSWORD}`)
}

main()
  .catch((e) => {
    console.error('Seed failed:', e.message)
    process.exitCode = 1
  })
  .finally(() => db.end())
