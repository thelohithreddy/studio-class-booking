# Schema

PostgreSQL 17, Prisma 7 (`prisma/schema.prisma` + migrations; the first migration's tail is
hand-written SQL for what the Prisma DSL cannot express). Eleven tables — nine domain tables,
`auth_sessions`, plus Prisma's `_prisma_migrations`. All ids are `uuid` with a database-side `gen_random_uuid()` default (raw
SQL and seeds get ids for free; v4 = unguessable, no enumeration). All timestamps are
`timestamptz(6)`; `updated_at` additionally has a `now()` DB default because Prisma's
`@updatedAt` is client-maintained and raw-SQL inserts must not need to know that.

## Tables

### users — staff and instructor accounts

| column                  | type            | notes                                                                                                                                                                                                |
| ----------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                      | uuid PK         | `gen_random_uuid()`                                                                                                                                                                                  |
| email                   | text            | unique **case-insensitively**: `users_email_ci_unique ON (lower(email))`                                                                                                                             |
| name                    | text            |                                                                                                                                                                                                      |
| role                    | `UserRole` enum | `STAFF` \| `INSTRUCTOR`                                                                                                                                                                              |
| password_hash           | text NOT NULL   | set at creation; auth logic lands in Phase 3. The Prisma client is constructed with a **global `omit`** so the hash never leaves the DB by default — the credential check opts back in on one query. |
| created_at / updated_at | timestamptz     |                                                                                                                                                                                                      |

Members are deliberately **not** users: they have no login (member self-service is an unbuilt
stretch goal), and merging them would couple membership lifecycle to accounts for zero required
value. Policy: both roles are assignable as (co-)instructors — owners teach; the INSTRUCTOR
_role_ gates visibility, not teachability.

### members

| column                  | type              | notes                                                                                                                                                                                 |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                      | uuid PK           |                                                                                                                                                                                       |
| name                    | text              | searched (Goal 6)                                                                                                                                                                     |
| email                   | text              | unique case-insensitively (`members_email_ci_unique`)                                                                                                                                 |
| membership_expires_on   | **date** NOT NULL | calendar-date granularity per the brief. `@db.Date` truncates to the UTC calendar day, so the app always builds these values as UTC midnight (rule A10). Indexed for the alerts scan. |
| created_at / updated_at | timestamptz       |                                                                                                                                                                                       |

### rooms

`id`, `name` (unique case-insensitively — `'Studio A'` vs `'studio a'` must be ONE room or
overlap detection silently splits), `created_at`, `updated_at`. Rooms are an entity rather
than a string on sessions precisely so conflict detection cannot be typo-defeated.

### classes

| column                   | type             | notes                                                                                                                              |
| ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| id                       | uuid PK          |                                                                                                                                    |
| title, description       | text             |                                                                                                                                    |
| discipline               | text             | free text — the studio defines its own disciplines                                                                                 |
| default_duration_minutes | int              | CHECK > 0                                                                                                                          |
| default_capacity         | int              | CHECK >= 0 (capacity 0 is legal: everyone waitlists)                                                                               |
| archived_at              | timestamptz NULL | null = active; a timestamp records _when_. Archiving hides from default views only — sessions/bookings/history untouched (Goal 2). |
| created_at / updated_at  | timestamptz      |                                                                                                                                    |

### class_sessions

| column                  | type                        | notes                                                                 |
| ----------------------- | --------------------------- | --------------------------------------------------------------------- |
| id                      | uuid PK                     |                                                                       |
| class_id                | uuid FK → classes, RESTRICT |                                                                       |
| starts_at               | timestamptz                 | one instant; the UI decomposes date/start-time in the studio timezone |
| duration_minutes        | int                         | CHECK > 0; copied from class default at creation, overridable         |
| ends_at                 | timestamptz                 | **stored, not generated** — see Denormalisation                       |
| capacity                | int                         | CHECK >= 0; copied from class default, overridable                    |
| booked_count            | int default 0               | **the overbooking backstop** — see Denormalisation                    |
| primary_instructor_id   | uuid FK → users, RESTRICT   | exactly one primary                                                   |
| room_id                 | uuid FK → rooms, RESTRICT   |                                                                       |
| created_at / updated_at | timestamptz                 |                                                                       |

Two **GiST exclusion constraints** (via `btree_gist`), both on
`tstzrange(starts_at, ends_at, '[)')`:

- `class_sessions_room_no_overlap` — `room_id WITH =` : a room hosts one session at a time.
- `class_sessions_primary_instructor_no_overlap` — `primary_instructor_id WITH =`.

Half-open `[)` ranges make back-to-back sessions legal while every overlap shape (same start,
partial, containing, contained) collides — exactly Goal 7's conflict matrix. The constraints
double as the concurrency backstop for recurring generation: a race that slips past the app's
pre-check loses here loudly. DST: instants + minute durations mean a class crossing a DST
switch is still N real minutes; "same wall-clock time each week" is recomputed per occurrence
by the recurring generator (Phase 7).

`class_sessions_booked_count_within_capacity` — `CHECK (booked_count >= 0 AND booked_count <=
capacity)`. Side effect adopted as policy: capacity cannot be edited below the current booked
count — the CHECK rejects it; staff cancel bookings first.

### session_instructors — co-instructors (many-to-many)

PK `(session_id, instructor_id)`; `session_id` FK **CASCADE** (links are structural, they die
with the session), `instructor_id` FK RESTRICT; reverse index on `instructor_id` for "sessions
where I co-teach" and the instructor-scope predicate. App rule: the primary instructor may not
also appear here for the same session (a CHECK cannot see across tables).

**Overlap policy (explicit, Goal 5):** an instructor may not be in two time-overlapping
sessions in ANY capacity. The DB enforces primary-vs-primary; the join-table cases are checked
by the service inside the same transaction, serialised by `pg_advisory_xact_lock` per
instructor id (sorted when several) — an app-only check alone was shown racy in review. The
fully-DB alternative (denormalising the session's time range into the join rows,
trigger-synced) is possible but rejected for its sync complexity at this scale; it is the
documented escalation path.

### bookings

| column     | type                               | notes                                                |
| ---------- | ---------------------------------- | ---------------------------------------------------- |
| id         | uuid PK                            |                                                      |
| seq        | int, SERIAL, unique                | deterministic order — see below                      |
| session_id | uuid FK → class_sessions, RESTRICT |                                                      |
| member_id  | uuid FK → members, RESTRICT        |                                                      |
| status     | `BookingStatus` enum               | BOOKED / WAITLISTED / CANCELLED / ATTENDED / NO_SHOW |
| created_at | timestamptz                        | the "booked at" time                                 |
| updated_at | timestamptz                        |                                                      |

- `bookings_one_active_per_member_session` — **partial unique index** on
  `(member_id, session_id) WHERE status IN ('BOOKED','WAITLISTED')`: one active booking per
  member per session; rebooking after cancellation stays legal. (Partial indexes are not
  expressible in the Prisma DSL — hand SQL.)
- **"Earliest waitlisted" means `min(seq)`**, not `min(created_at)`: `created_at` is the
  transaction-start timestamp and can collide — or even invert against lock-grant order —
  under concurrency. `seq` values are internal (global counters leak volume/order — a
  German-tank problem) and are never serialised into API responses; waitlist position is
  derived server-side when a UI needs it.
- Triggers: `bookings_identity_frozen` (BEFORE UPDATE — `id`, `member_id`, `session_id`,
  `seq`, `created_at` are immutable; status may change) and `bookings_no_delete` /
  `bookings_no_truncate` — bookings are **cancelled, never deleted**; a deleted booking would
  vacate its Goal 9 timeline slot.
- Indexes: `(session_id, status, seq)` (capacity count + earliest-waitlisted scan under the
  session lock), `(member_id)`, `(status, created_at)`, `(created_at)` (Goal 6 list sorts).

### booking_events — the append-only timeline (Goal 9)

| column                  | type                                                  | notes                                                                                                                  |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| id                      | uuid PK                                               |                                                                                                                        |
| seq                     | int, SERIAL, unique                                   | totally orders a booking's timeline; same-transaction events share `created_at`                                        |
| booking_id              | uuid FK → bookings, RESTRICT, **ON UPDATE NO ACTION** | pinned so immutability never silently depends on a cascade                                                             |
| type                    | `BookingEventType` enum                               | CREATED / STATUS_CHANGED / NOTE_ADDED                                                                                  |
| from_status / to_status | enum NULL                                             | shape enforced by CHECK — see below                                                                                    |
| note                    | text NULL                                             | staff notes are timeline events, not a separate mutable table                                                          |
| actor_user_id           | uuid FK → users, RESTRICT, NOT NULL                   | always the authenticated human cause; an automatic promotion is attributed to the user whose cancellation triggered it |
| created_at              | timestamptz                                           | no `updated_at` — nothing updates                                                                                      |

`booking_events_shape_matches_type` — CHECK: CREATED has only `to_status`; STATUS_CHANGED has
both; NOTE_ADDED has neither and requires `note`.

**Immutability**: `BEFORE UPDATE OR DELETE` row trigger + `BEFORE TRUNCATE` statement trigger
raise exceptions — verified to also catch a cascaded TRUNCATE from a referencing table, and to
block Prisma's own `.update()`/`.delete()`. Index `(booking_id, seq)` serves timeline reads.

### auth_sessions (Phase 3)

| column     | type                      | notes                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id         | uuid PK                   |                                                                                                                                                                                                                                                                                          |
| token_hash | text UNIQUE               | SHA-256 of the 32-byte random cookie token — the raw token never touches the database, so a DB read yields no usable credential. SHA-256 (not Argon2) is correct here: 256 bits of entropy means there is no dictionary to grind, and a slow hash would tax every authenticated request. |
| user_id    | uuid FK → users, RESTRICT | keeps the one-sanctioned-CASCADE rule; user deletion is not a feature                                                                                                                                                                                                                    |
| created_at | timestamptz               |                                                                                                                                                                                                                                                                                          |
| expires_at | timestamptz               | absolute expiry (7 days), indexed lookups happen via token_hash; `(user_id)` indexed for per-user sweeps                                                                                                                                                                                 |

Ephemeral credentials, not history: no immutability machinery, and DELETE is the
invalidation mechanism (logout, expiry pruning, the 10-per-user soft cap, account-switch on
login). "Row exists and is unexpired" is the entire definition of a valid session — there is
deliberately no `revoked_at` second source of truth.

### membership_alert_dismissals (Goal 10)

An alert is **derived**, never stored: members where `membership_expires_on <= today + 7 days`
(or past). A dismissal records `(member_id, membership_expires_on)` — the exact expiry value
silenced — plus `dismissed_by_id` and `dismissed_at`. The alert shows iff no dismissal row
matches the member's _current_ expiry value: change the expiry and the pair no longer matches,
so the alert returns when the new date enters the window — exactly the required lifecycle,
idempotent (unique pair), no cron. Accepted edge: reverting to a previously-dismissed exact
date stays dismissed (that deadline was already acknowledged). Both FKs RESTRICT — this
schema sanctions exactly one CASCADE (co-instructor links); a dismissal carries staff audit
attribution and fails loudly rather than vanishing with a member row.

## Relationships

One-to-many: class→sessions, room→sessions, user→sessions (as primary), session→bookings,
member→bookings, booking→events, user→events (as actor), member→dismissals, user→dismissals.
Many-to-many: session↔user via `session_instructors` (co-instructors) — the only join table.

Referential actions are RESTRICT everywhere; the one deliberate exception is
`session_instructors.session_id` (CASCADE — the links are structural and die with their
session). Consequence, on purpose: a
session with any booking history is **permanently undeletable** (Goal 9 outranks Goal 3's
unqualified "deleted"; the API will explain in its 409). Corner acknowledged: such a session
also occupies its room/instructor slot forever unless its times are edited; if a
"cancelled session" feature is ever needed, the additive fix is partial exclusion constraints
(`WHERE cancelled_at IS NULL`).

## Database rules vs application rules — where the line is and why

**Database** owns what must survive _any_ code path, including concurrency bugs and raw SQL:
referential integrity, (case-insensitive) uniqueness, value sanity CHECKs, physical-world
exclusivity (room/instructor overlap), the active-booking uniqueness, the `booked_count`
bound, and history immutability. **Application** owns what needs cross-table context, business
context (actor, role, reason), or friendly errors: the booking state machine, waitlist
promotion (promote `min(seq)` only when the cancelled booking was BOOKED and
`booked_count < capacity` after the cancel), the expired-membership gate, co-instructor
conflicts, authorization scopes, archive visibility, settlement timing. The pattern
throughout: _the app pre-checks to produce a nice error; the DB makes the race lose loudly
rather than corrupt._ Booking mutations will run in a READ COMMITTED transaction that locks
the session row (the `booked_count` UPDATE itself takes the lock) — correctness of
count-after-lock depends on READ COMMITTED's per-statement snapshots, so the booking service
must not raise the isolation level.

**Honest limits.** The append-only triggers stop every application path; they do not stop the
table _owner_, who can drop/disable triggers or ALTER the table — and on managed free tiers
the app user owns the schema. So: protection against every application bug, not against a
hostile DBA. `bookings.status` itself is app-trusted state; the ledger makes an out-of-band
flip tamper-_evident_ (status vs the last event's `to_status`), not impossible. Integration
tests reset state via `session_replication_role = 'replica'` — the GUC exists on every
Postgres; the superuser needed to set it exists only in the dockerised dev/CI database.
Member PII erasure is deliberately out of scope: members with bookings are undeletable and
notes are immutable by requirement (Goal 9); a real deployment would need a documented
tombstone/redaction design (member _rows_ are updatable — only the event ledger is frozen).

## Deliberate denormalisation

1. **`class_sessions.ends_at`** — derivable from `starts_at + duration_minutes`, stored
   anyway: exclusion-constraint index expressions must be IMMUTABLE and `timestamptz +
interval` is only STABLE. A CHECK ties the three columns together, so the denormalisation
   cannot drift. Buys DB-level overlap enforcement.
2. **`class_sessions.booked_count`** — derivable from `count(*) WHERE status='BOOKED'`,
   stored anyway: a COUNT cannot be CHECK-constrained, a counter can. The service maintains
   it inside the locked transaction (equality with the real count is app-maintained and
   auditable); the DB hard-bounds it at `capacity`, so an 11th booking on a 10-seat session
   fails at the database even if app locking ever breaks.
3. **`duration_minutes` / `capacity` copied from class defaults** onto each session — the
   brief requires per-session overrides; copying at creation makes later class-default edits
   non-retroactive, which is the least surprising behaviour for already-scheduled sessions.

## At 100x the data

A studio at 100x is ~10M bookings/year, ~100k sessions, ~50k members — still small for
Postgres. What degrades first, in order: (1) the Goal 6 booking list's `ILIKE '%q%'` name/
email search (unindexable as written) — first fix is a `pg_trgm` GIN index, already compatible
with this schema; (2) the dashboard's 8-week aggregates scanning `bookings` by time window —
fix is a nightly rollup table, additive; (3) the global `seq` SERIALs are int (~2.1bn) —
six orders of magnitude of headroom at studio scale, a deliberate simplicity trade against
BigInt JSON friction; (4) the GiST exclusion indexes grow with future sessions but lookups
stay range-bounded. The booking hot path itself (per-session row lock + `(session_id, status,
seq)` index) is size-independent per session and does not degrade with global table growth.

## Domain CRUD uses this schema unchanged (Phase 5)

Phase 5 (classes/members/rooms/sessions management) added NO tables or columns — it is the
first phase to _write_ the entities Phase 2 modelled, through validated services. Lifecycle
rules it enforces on top of the existing schema:

- **Classes** archive by setting `archived_at` (idempotent); default listings filter it out.
  Archiving is non-destructive — the RESTRICT foreign keys already forbid deleting a class's
  sessions or bookings, so archiving only flips the flag.
- **Members** have no lifecycle state and no deletion: a member a booking references is
  RESTRICT-protected (historical integrity), and the brief needs none. Expiry is a
  `@db.Date` written as UTC midnight, validated with `z.iso.date()` (a real calendar date —
  `2026-02-30` is a 400, not a silent roll-over to March 2), because Goals 4 and 10 compute
  booking eligibility and alerts from this exact value.
- **Rooms** likewise have no archive/retire state and no deletion — they exist as
  conflict-detection entities; a referenced room is RESTRICT-protected.
- **Sessions** copy `duration_minutes`/`capacity` from the class defaults at creation (a
  later class-default edit is non-retroactive); `ends_at` is computed as
  `starts_at + duration` to satisfy the Phase-2 CHECK. Room and primary-instructor overlap
  is pre-checked in the application (friendly 409) and backstopped by the Phase-2 GiST
  exclusion constraints (race-safe). A session hard-deletes only with no bookings; a booked
  session's RESTRICT FK makes it permanently undeletable (translated to 409); delete is
  idempotent (a lost double-delete race is a 404, not a 500). The one create-path invariant
  with no DB backstop is "no new session on an archived class" — an app read-then-write with
  a tiny archive-between-check-and-insert window; accepted because the brief only requires
  archiving to be non-destructive (existing sessions survive), and a stray session on a
  just-archived class is harmless and staff-removable (decisions.md #20).

**Prisma constraint-error surface (verified empirically, decisions.md #18):** over the pg
driver adapter, Prisma throws `P2002` (unique, `cause.constraint.index`), `P2003` (FK),
`P2007` (invalid uuid), and `P2039` for **both** exclusion (`cause.code` 23P01) and check
(23514) violations — the raw SQLSTATE never appears top-level. `src/lib/api/db-errors.ts`
keys on the Prisma code, splits P2039 by the nested SQLSTATE, and classifies room-vs-
instructor overlap from the constraint name in `cause.message` while returning only fixed
messages (no PG text ever reaches the client).

## Authorization uses this schema unchanged (Phase 4)

Phase 4 added no tables or columns: server-side authorization reads what Phase 2 already
modelled. `users.role` gates management verbs; `class_sessions.primary_instructor_id` plus the
`session_instructors(session_id, instructor_id)` join express an instructor's visible scope
(`primary OR co-instructor`), and that scope compiles to a single query with an EXISTS
semi-join over the `session_instructors(instructor_id)` index and the
`class_sessions(primary_instructor_id, …)` index — both from Phase 2. The same `WHERE`
fragment feeds reads, collections and counts, so a scoped total cannot report rows the viewer
may not see. See docs/architecture.md for the guard/policy/scope architecture.

## Prisma-specific facts this schema relies on (verified hands-on)

- Prisma 7 diffing **ignores** the hand-written objects (extension, CHECKs, exclusions,
  partial index, triggers): a no-change `migrate dev --create-only` generates an _empty_
  migration. Protocol regardless: every future migration is generated `--create-only` and
  reviewed; the integration suite re-proves every invariant after a from-scratch
  `migrate deploy`, so an accidental drop fails CI.
- The `prisma-client` generator emits `@ts-nocheck`'d TypeScript into `src/generated/prisma/`
  (gitignored, regenerated in CI); import from `@/generated/prisma/client`, extensionless.
- `@db.Date` values truncate on the **UTC** calendar day → rule A10: build date values as UTC
  midnight everywhere.
- `@updatedAt` is client-side only → `updated_at` also carries a `now()` DB default.
