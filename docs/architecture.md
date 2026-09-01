# Architecture

## Moving pieces and where they run

One deployable: a Next.js (App Router) application serving both the UI and the API as route
handlers, talking to PostgreSQL through Prisma 7 over a `pg` driver-adapter pool. No separate
API server, no CORS, no queues, no cache tier — a studio booking tool does not need them, and
every extra runtime is another thing to deploy, secure and explain.

| Piece                                         | Runs                                                   | Notes                                                                     |
| --------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| Next.js app (pages + `/api/*` route handlers) | Node server (Render-class host)                        | one process, one deploy                                                   |
| PostgreSQL 17                                 | managed Postgres (Supabase-class) / dockerised locally | schema + invariants in `docs/schema.md`                                   |
| Prisma client                                 | inside the app process                                 | generated at build, lazy singleton (`src/lib/db.ts`)                      |
| CI (GitHub Actions)                           | GitHub                                                 | format → lint → typecheck → tests (unit + integration vs real PG) → build |

Request-handling conventions, established Phase 3 and binding for every later phase:

- **Every API route is wrapped in `handleRoute`** (`src/lib/api/errors.ts`): origin guard for
  mutating methods → handler → error taxonomy (`ApiError` → its status; zod → 400; anything
  else → generic 500 that logs a scrubbed cause and reveals nothing) → default
  `Cache-Control: no-store`.
- **No GET handler ever mutates state.** The CSRF model depends on this invariant.
- **`/api/health` stays outside the stack** — public, DB-free, so deploy probes cannot be
  broken by auth or taxonomy changes.
- Identity comes only from `getSessionUser(req)` / `requireUser(req)`
  (`src/server/auth/session.ts`) — no route parses cookies itself.

## The representative request path: logging in, then acting

```
Browser (login form, /login)
  → POST /api/auth/login  {email, password}
      handleRoute: Origin header (if present) must match Host — else 403   [CSRF, incl. login CSRF]
      zod: shape, lengths; email → normalizeEmail() (trim+lowercase)       [same fn every writer uses]
      rate limit: per-email + per-IP failure buckets → 429                 [in-memory, documented limits]
      user lookup (Prisma; passwordHash opted back in for this one query)
      Argon2id verify — against the real hash, or a dummy hash when the
        user doesn't exist, so both failures share one path and timing     [anti-enumeration]
      on success: any session presented with the request is destroyed      [shared-machine account switch]
        → 32-byte random token minted, SHA-256 OF IT stored in
          auth_sessions with absolute expiry; expired rows swept; live
          sessions soft-capped at 10 (oldest evicted)
      ← 204 + Set-Cookie: studio_session=<token>; HttpOnly; SameSite=Lax;
          Path=/; Max-Age=7d; Secure (production)
Browser (any later request)
  → cookie → sha256(token) → indexed auth_sessions lookup joining users
      (narrow select: {id,email,name,role} — the hash and the token hash
      never materialize) → SessionUser | 401
Logout: POST /api/auth/logout → DELETE the session row + expire the cookie
      — the old token can never authenticate again, from any client.
```

## Authorization (Phase 4)

Authentication answers _who_; authorization answers _may they_. Every protected request runs
the same pipeline: `handleRoute` (origin guard, size gate) → **authenticate** (`requireUser`, 401) → **authorize** (role and/or resource, 403/404) → validate → service → DB → response.
The server is the sole authority — the UI never gates anything a direct API call could reach.

Three composable, fail-closed pieces (they throw `ApiError`, never return a decision; an
unexpected throw becomes a generic 500, never an allow), all in `src/server/authorization/`:

- **`policy.ts` — capabilities.** A single declarative table maps each management verb
  (`class:manage`, `session:manage`, `member:manage`, `booking:manage`,
  `coinstructor:manage`, `recurring:generate`, `attendance:export`, `dashboard:studio`,
  `alert:dismiss`) to the roles that hold it. Every entry is `['STAFF']` today — Goal 1
  denies instructors every management verb — and making each denial an explicit, greppable
  row is the point: adding a future instructor verb is a visible, reviewed edit, not an
  absent check. `can(user, capability)` is pure and fails closed (unknown capability → `[]`
  → no).
- **`scope.ts` — resource scope as a query fragment.** `sessionScopeWhere(user)` returns a
  Prisma `WHERE`: staff get `{}` (all), an instructor gets
  `primaryInstructorId = me OR EXISTS(session_instructors where instructor = me)` — Goal 5's
  visibility rule, one query with an EXISTS semi-join (no N+1), riding the Phase-2 indexes.
  The _same_ fragment feeds single reads, the collection **and its count**, so a scoped
  total can never report rows the viewer may not see. `bookingScopeWhere` is _derived_ from
  it (a booking is visible iff its session is), so Goal 6's future search inherits the
  property structurally rather than by a hand-copied predicate that could drift.
- **`guards.ts` — request composition.** `requireCapability(req, cap)` → 401 or 403.
  `requireSessionView(req, id)` → 401, or **404** when the session is out of the caller's
  scope _or_ the id is malformed — deliberately identical to a missing row so an instructor
  cannot confirm another's session exists by its id, and byte-identical in body (tested).
  The authorization predicate is _in_ the query, so an unauthorized row is never fetched.

**Error semantics.** 401 unauthenticated · 403 authenticated-but-role-forbidden (capability
endpoints — the endpoint category is already public in the app's JS, so hiding it buys
nothing; the body never names the capability or role) · 404 for an ID-addressed resource the
caller lacks a relationship to (existence-hiding). Never a Prisma error, stack, SQL, or
which-check-failed detail.

**Mass-assignment / tampering rule.** Role and identity come _only_ from the server-resolved
`SessionUser` — never a body/query/header field. Every request body parses through a zod
`.strict()` schema and Prisma writes map fields explicitly (never `data: req.json()`). The
future-mutation stubs parse nothing at all, and each carries the binding rule as a comment so
the stub→feature transition can't smuggle in a spread.

**Reads never over-fetch.** Instructor-reachable session reads pin an explicit Prisma
`select` of scalar session fields only — no member/booking relation includes — so member PII
can never ride along inside an otherwise-authorized payload.

Phase 4 ships the guards for every future endpoint but no business logic: the authorized
actor of a not-yet-built mutation gets a 501, so every *un*authorized actor is already denied
by the real production guard, and the attack suite keeps guarding the door when a later phase
fills in the 501.

**Transaction coupling (forward design, not shipped this phase).** Read authorization needs
no transaction. Booking mutations (Phase 5) must re-authorize _inside_ the locked transaction
that adjusts capacity (Phase-2 design M); instructor-assignment conflict checks take a
per-instructor advisory lock in-transaction; the `booked_count` CHECK is the DB backstop. A
future scoped CSV export must authorize the requested session _before_ streaming, so
`/api/sessions/[id]/attendance` can never become an exfiltration endpoint.

## Domain layer (Phase 5)

The management surface for the four scheduling entities follows the established pipeline with
a domain-service layer between the routes and Prisma:

```
route (thin)  →  handleRoute (origin, size, taxonomy, no-store)
              →  requireCapability / requireSessionView  (authorize)
              →  zod .strict() parse                     (validate the body)
              →  src/server/domain/{classes,members,rooms,sessions}  (business rules)
              →  Prisma  →  Postgres
```

- **Services** (`src/server/domain/*`) hold every business rule — default inheritance,
  reference validation, conflict pre-checks, lifecycle transitions — and take the Prisma
  client plus already-validated input. Routes stay thin (parse → guard → call → respond).
- **Validation** (`src/lib/schemas/domain.ts`) is one zod `.strict()` schema per write:
  unknown or server-managed keys (`id`, `bookedCount`, `endsAt`, `archivedAt`, `createdAt`,
  a member `password`/`role`) are a 400, never silently dropped. Path ids are uuid-validated
  (`parseIdOr404`) so a malformed id is a 404, not a Prisma-500.
- **Database-error translation** (`src/lib/api/db-errors.ts`) turns a constraint violation
  into a clean 409/422 — the application pre-checks for a friendly error, and the Phase-2
  constraints (unique, GiST overlap exclusion, the `booked_count` CHECK, RESTRICT FKs) are
  the race-safe backstop. No raw Postgres text, SQLSTATE, constraint name or row data ever
  reaches the client.

**Time and conflict semantics.** A session's `startsAt` is an instant (ISO-8601 with an
offset, stored UTC); `endsAt = startsAt + durationMinutes`. Overlap is half-open `[start,
end)`: adjacent sessions are allowed; same-start, partial, contained and containing overlaps
conflict — for both the room and the primary instructor. The Phase-2 GiST exclusion
constraints enforce this at the database (so two concurrent creates for the same slot can
never both land — verified with an 8-way concurrent test); the service's interval pre-check
provides the friendly 409 in the common case. Studio-timezone display decomposition remains a
frontend-phase concern (`STUDIO_TIMEZONE` reserved).

**Error taxonomy** (extends Phase 3/4): 400 request shape/bounds · 401 unauthenticated · 403
role-forbidden · 404 absent/hidden/malformed-id resource · 409 domain conflict (duplicate
name/email, room/instructor overlap, scheduling on an archived class, deleting a booked
session) · 422 shape-valid-but-domain-invalid (a non-instructor as primary instructor,
capacity below the booked count).

**Deferred (guarded 501 stubs, not built this phase):** booking lifecycle, waitlist and
promotion, attendance/no-show, recurring generation, CSV export, dashboard, membership
alerts, and co-instructor mutation. Co-instructor scheduling conflicts specifically still
need per-instructor advisory locks (Phase-2 documented risk) — Phase 5 does not claim to
solve them.

## Booking engine (Phase 6)

The booking lifecycle is the system's concurrency-critical core. Its correctness rests on one
mechanism: **every booking mutation runs in an interactive transaction whose first statement
is `SELECT … FROM class_sessions WHERE id = $1 FOR UPDATE`**, taking the session row lock.
All booking operations for a given session are thereby serialized; different sessions never
contend. Under the lock the capacity decision, the counter update, the status change and the
timeline event are one atomic unit.

**State machine** (`src/server/domain/booking-state.ts`, the single authority): create →
BOOKED (seat) | WAITLISTED (full); BOOKED → CANCELLED | ATTENDED | NO_SHOW; WAITLISTED →
CANCELLED | BOOKED (promotion, internal). Every other move is a 422 `invalid_transition`. No
route or service duplicates transition logic.

**Capacity** (`booked_count`): counts the capacity-consuming states — BOOKED, ATTENDED,
NO_SHOW. WAITLISTED and CANCELLED do not consume; settling a BOOKED booking leaves the count
unchanged. Invariant: `booked_count = count(status ∈ {BOOKED, ATTENDED, NO_SHOW})`, maintained
under the lock and hard-bounded by the Phase-2 CHECK `booked_count ≤ capacity`.

**The four transactions:**

- _Create_ — lock session → validate member + membership (valid iff expiry ≥ studio-today) →
  duplicate-active pre-check → decide BOOKED/WAITLISTED from the live count → insert →
  counter+1 if BOOKED → CREATED event.
- _Cancel_ — lock session → **re-read the booking status under the lock** → assert →
  CANCELLED + event; if it was BOOKED, counter−1 and promote the earliest waitlisted (min seq)
  into the freed seat (+1, its own event). Exactly one promotion per freed seat because the
  lock serializes.
- _Settle_ — lock session → assert `now ≥ startsAt` → re-read status under the lock →
  BOOKED→ATTENDED/NO_SHOW + event (no counter change).
- _Note_ — append an immutable NOTE_ADDED event (Goal 9), no status/counter change, no lock
  needed (it changes nothing raced-upon).

The **re-read of the booking's status _after_ acquiring the lock** is load-bearing: deciding a
cancel/settle from the pre-lock read would let two concurrent operations on the same booking
both proceed (overbooking, double promotion, a self-contradicting timeline). Every mutation is
wrapped in `withDbErrors`, so an escaped constraint (the CHECK, or the partial-unique) becomes
a clean 422/409, never a raw error. The actor on every event is the authenticated
`SessionUser` — never a body field.

**Isolation & backstops:** the transactions run at the default READ COMMITTED — correct
because the lock, not the snapshot, serializes (a probe confirmed that _removing_ the lock
overbooks). The Phase-2 constraints (`booked_count ≤ capacity`; one active booking per
member+session) are the race-safe defense-in-depth. Single-lock-anchor ⇒ no deadlocks (each
booking transaction locks exactly one session row and never a second). Transaction options are
explicit (`maxWait 10s / timeout 15s`) as headroom for production bursts beyond the tested
scale; connection-pool sizing is a deploy-phase concern.

**Authorization:** create/cancel/settle/note are `booking:manage` (staff only — instructors
403); reads (`GET /api/bookings`, `/api/bookings/[id]`) use `bookingScopeWhere` so an
instructor sees bookings for the sessions they teach and 404s the rest (no existence leak).
The `/api/bookings/[id]` read returns the booking and its immutable timeline.

**Deferred (still guarded 501):** the rich bookings search/filter/sort (Goal 6, Phase 7),
recurring generation, CSV, dashboard, alerts, co-instructor mutation. The bookings list here
is minimal (scoped, paginated, optional session/status filter).

## Search, filtering & pagination (Phase 7)

Goal 6's "Finding bookings" — one scoped bookings list — plus a date-range filter on the
sessions list. The pipeline treats search as an authorization boundary:

```
authenticate → authorize SCOPE (first) → apply filters → COUNT (same predicate) → sort → paginate
```

- **Scope first, count under the same predicate.** `listBookings` builds one
  `where = AND[ bookingScopeWhere(user), ...filters ]` and passes the _identical_ `where` to
  both `findMany` and `count`. The scope is the first AND term, so it applies before filtering
  and before counting — a filter can only _intersect_ the scope (never widen it), and a total
  can never include an out-of-scope row. For an instructor, `bookingScopeWhere` restricts to
  the sessions they teach; a `classId` filter (`{ session: { classId } }`) is ANDed with the
  scope's `{ session: … }`, so the booking's session must satisfy both — the filter cannot
  reach another instructor's sessions (proven: a class they don't teach returns an empty list,
  not a widened one).
- **Text search** over member name and email (Goal 6), case-insensitive, treated as a literal
  substring: `escapeLike` prefixes the LIKE escape before `% _ \`, so a search for "50%"
  finds the member literally named "50%", not everything. Prisma parameterizes the value, so
  there is no injection surface (SQLi payloads return safe empty results with tables intact).
- **Sorting** by a fixed allowlisted key (`bookedAt` | `status` | `session`) × direction
  (`asc` | `desc`) — no user column or direction string ever reaches SQL; a fixed map builds
  the Prisma `orderBy`, always ending in the unique `id` tiebreaker so rows never shuffle
  across pages. An invalid sort/dir is a 400.
- **Pagination**: OFFSET/LIMIT (page 1..∞, pageSize 1..100), chosen over keyset because Goal 6
  wants "the total number of matches" (a page-numbered UI) and the datasets are studio-scale.
  Trade-off documented: under concurrent inserts a row can shift across page boundaries
  between requests (no snapshot promise). Response is the project convention
  `{ bookings, total, page, pageSize }`.
- **Data minimization**: the list returns booking scalars + member `{id, name}` + session
  `{id, startsAt, class{title}}` — never a password hash, member email, staff note or the
  event timeline. The member text search _filters_ on email but never _returns_ it; email
  search is Goal-6-mandated for the viewer and stays scope-contained (decisions.md #25).
- **Indexes**: existing Phase-2 indexes cover every sort/filter (`bookings(status, created_at)`,
  `(created_at)`, `(session_id, status, seq)`; `class_sessions(class_id, starts_at)`,
  `(starts_at)`). No new index — EXPLAIN confirms index scans, no sequential scans on the
  scoped path. The only unindexed part is the member name/email ILIKE substring; at studio
  scale it is negligible and a `pg_trgm` GIN index is the documented 100x path (decisions.md
  #26), not added speculatively now.
- **Sessions date range**: half-open `[from, to)` on `starts_at` — `from` inclusive, `to`
  exclusive (no end-of-day bug). `from`/`to` are calendar dates interpreted as midnight in
  `STUDIO_TIMEZONE` (DST-correct, consistent with membership expiry), ANDed under the scope.

## Co-instructors & recurring generation (Phase 8)

Goal 5 (co-instructors) and the recurring half of Goal 7. Both hang off one new spine,
`src/server/domain/scheduling.ts`, whose job is the correctness the exclusion constraints
cannot express.

- **The conflict domain is the whole instructor.** An instructor may not be in two
  time-overlapping sessions in _any_ capacity — primary or co. The room and primary-vs-primary
  axes are GiST exclusion constraints (Phase 2, race-safe), but a co-instructor's schedule spans
  `class_sessions ⋈ session_instructors`, which no single-table constraint can cover. One
  predicate is the single source of truth: `instructorHasOverlap` — `EXISTS a class_session S,
half-open `starts_at < end AND ends_at > start`, excluding self, where `S.primary_instructor_id
  = I OR EXISTS session_instructors(S, I)`. One index-backed query.
- **Race-safety is a uniform lock order: session row → instructor user rows (sorted uuid).**
  Every schedule mutation runs in a transaction that first takes `SELECT … FROM class_sessions
WHERE id=$1 FOR UPDATE` (when the session already exists), re-reads the interval under it, then
  locks the affected instructors' _user rows_ `FOR UPDATE` in ascending-uuid order, then checks,
  then writes. `createSession` (no row yet) locks only the primary user row. This closes three
  defects the design review found: create missing the primary-vs-co axis; a co-add racing a
  same-session time-edit into a double-book (their locks were disjoint and `FOR KEY SHARE` /
  `FOR NO KEY UPDATE` do not conflict); and an unlocked `updateSession` read-modify-write losing
  an edit. Deadlock-free by construction: the booking engine locks _only_ the session row and
  never a user row, scheduling locks session-then-users, no op holds two session rows, users are
  always sorted (decisions.md #28). A crossed-order multi-instructor test and the co-add-vs-edit
  race test both pass across trials.
- **Endpoints.** `POST`/`DELETE /api/sessions/[id]/co-instructors` (staff only,
  `coinstructor:manage`; `{instructorId}` in a `.strict()` body; add is idempotent, remove is
  404-when-absent, both return the roster) and `GET` (scoped via `requireSessionView` — an
  instructor sees only sessions they teach, 404 otherwise; roster is `id + name`, never email).
  `updateSession` (`PATCH /api/sessions/[id]`) now re-checks the primary AND every co under the
  new lock order. Mutations return their display projection from a read _after_ the transaction
  commits (a nested-relation select inside an interactive transaction pipelines on its single
  held pg connection — display data, not a raced-upon invariant).
- **Recurring generation** — `POST /api/sessions/generate` (staff only, `recurring:generate`).
  A weekly wall-clock pattern (class/instructor/room/start-time over a weekday set and date
  range) yields a PARTIAL `{created, skipped, summary}` report (Goal 7): each occurrence is its
  own transaction; a conflict (instructor or room) skips just that occurrence, an unexpected
  error aborts. The occurrence count is checked arithmetically _before_ any date is materialized
  (an absurd range is rejected in µs), and re-running is naturally idempotent (every slot skips)
  — decisions.md #29. Occurrence instants are wall-clock-preserving across DST via a two-pass
  timezone resolver (`studioDateTimeToUtc`, decisions.md #30). No migration —
  `session_instructors` (Phase 2) already carried the shape and indexes.

## CSV attendance export (Phase 9)

Goal 7's second half: "export a session's attendance — every booking with its member and final
status — as a CSV file." A single staff-only endpoint, treated as a data-exfiltration boundary.

- **`GET /api/sessions/[id]/attendance`** — STAFF only (`attendance:export`, Decision 17). The
  capability guard runs FIRST, so an instructor (even the session's own primary) and an
  unauthenticated caller are stopped with 403/401 before the session is resolved or any row is
  read. There are **no query parameters**: the export is always "every booking of this session",
  which structurally removes the filter-widening / status / date / SQLi-via-filter surfaces — the
  only input is the path id (validated uuid; a missing/malformed id is a 404, existence-hiding).
- **The dataset is scoped before serialization.** `exportSessionAttendanceCsv` (src/server/domain/
  attendance.ts) does `classSession.findUnique` (404 if absent) then
  `booking.findMany({ where: { sessionId }, orderBy: { seq: 'asc' }, select: { status,
member: { name, email } } })` — the `where: { sessionId }` is the boundary the Phase-4 stub
  comment demanded; it can never read another session's or global bookings. One row per booking,
  every status, `seq` order (unique → deterministic). Members are not users (Decision 7), so no
  credential column is even selectable; only Name, Email, Status are exported.
- **CSV is generated safely.** An internal RFC 4180 serializer (src/server/reporting/csv.ts) quotes
  commas/quotes/newlines, doubles embedded quotes, and applies an OWASP formula-injection guard
  (a leading `= + - @` or control char — after any spaces Excel would trim — is apostrophe-prefixed
  so a hostile member name can never execute as a spreadsheet formula). The body carries a UTF-8 BOM
  for Excel Unicode, `Content-Type: text/csv; charset=utf-8`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`, and `Content-Disposition: attachment; filename="attendance-<date>-
<uuid>.csv"` — a filename built only from server-derived safe bytes (no user text reaches the
  header). Bounded in-memory (a per-session export is small; a `MAX_EXPORT_ROWS` cap → 413 is the
  defensive backstop). Correctness is round-trip-tested with a real parser; no schema change, no new
  index (the export rides `bookings(session_id, status, seq)`). Full rationale in decisions.md #31.

## Operational dashboard (Phase 10)

Goal 8's studio landing view. Staff-only, studio-wide, no parameters.

- **One domain function, one guarded entry.** `getDashboard(db, now)` (src/server/reporting/dashboard.ts)
  computes the whole DTO with SEVEN concurrent, bounded DB aggregations (no domain rows are loaded
  into JS). Its single caller is `GET /api/dashboard`, which gates on
  `requireCapability('dashboard:studio')` before any query runs — an instructor is 403'd and never
  reaches a studio-wide number. The landing page `app/(app)/page.tsx` is a thin client view that
  fetches that route (redirecting a 403'd instructor to /sessions); it performs no authorization of
  its own. There are NO query parameters, so the filter-widening / parameter-pollution /
  SQLi-via-filter surfaces do not exist.
- **All metrics are studio-local, half-open, DST-correct.** JS computes every day/week window as a
  UTC instant via the existing helpers (studioToday, studioDateToUtc); one 9-boundary array feeds
  both "this week" and the 8-week chart so they cannot disagree. Raw counts are cast `::int` (a bare
  `bigint` would surface as a JS `BigInt` and break JSON serialization); the `width_bucket` chart is
  bounded to the 8-week window so it stays index-bounded and never buckets older history. Metric
  definitions, the boundary math, and the EXPLAIN/index review are in decisions.md #32.
- **UI.** The dashboard is the staff landing route `/`, a thin `'use client'` view that fetches
  `GET /api/dashboard` — the same client-page + API pattern every other page uses. (A Server
  Component that called `getDashboard` directly was tried first, but Next 16 statically prerendered
  and cached that route because a build-time `redirect()` in a Server Component is captured as a
  static redirect, which `force-dynamic`/`connection()`/`cookies()` did not prevent; the client
  page renders a data-free shell and fetches per request. Authorization is unchanged and server-side
  — the route's capability guard, no chart library, no state.) DTO is data-minimized (counts + class
  titles + timezone only). Accessible: `<dl>` stat cards, `<table>`s with captions/`th scope`, and a
  decorative `aria-hidden` bar chart whose accessible source is the adjacent data table; explicit
  empty states; an "as of <studio-local time>" caption; responsive grid + scrollable tables. No new
  index, no migration, no caching/realtime. Full rationale in decisions.md #32.

## Membership expiry alerts (Phase 11)

Goal 10: staff see members whose membership is expired or expiring within seven days, dismiss them,
and a nav badge shows the count.

- **Dynamic, never persisted.** `listMembershipAlerts` (src/server/domain/alerts.ts) runs ONE
  bounded, parameterized query: members WHERE `membership_expires_on <= studioToday+7` AND no
  dismissal row matches the member's OWN current expiry (a correlated NOT EXISTS, which Prisma can't
  express — hence raw SQL). Alerts are computed from current expiry + current date + dismissal state,
  so date rollover and member edits are reflected on the next read with NO cron/worker/queue. Date-
  only comparison (`@db.Date`), no timezone off-by-one. EXPLAIN: index scan on
  `members(membership_expires_on)` + a merge anti-join for the dismissal exclusion, ~1.2 ms at 2000
  members; no N+1, no new index (decisions.md #33).
- **Expiry-keyed dismissal (Decision 11), dismiss-only-if-eligible.** `POST /api/members/[id]/
alert-dismiss` records `(member_id, current_expiry, staff_actor)` — the expiry from the DB
  (server-authoritative), the actor from the SessionUser, an empty `.strict()` body (mass-assignment
  safe). It is a **no-op when the member's current expiry is beyond the window**, so a dismissal row
  can only exist for a value that was actually alerted — otherwise a far-future date, once dismissed,
  would never re-alert when it later enters the window (Goal 10's "the alert returns"). Idempotent +
  concurrency-safe via `@@unique` + `skipDuplicates`.
- **Staff-only, no params.** `GET /api/members/alerts` gates on `member:manage`, the dismiss on
  `alert:dismiss`; instructor → 403, unauth → 401, missing member → 404. No query parameters → no
  filter/injection surface. `no-store` — the expiring-soon set is date/identity-sensitive.
- **UI (client, staff-only).** An `AlertsProvider` (mounted by the layout for staff) fetches the
  alerts once and feeds both the nav count badge and the `/alerts` list, so a dismiss reloads both.
  Dismiss is failure-safe and server-authoritative (never optimistically hides); urgency is TEXT not
  colour; the badge has screen-reader text; a non-staff visitor to /alerts is redirected to /sessions.

## Authentication decisions (short form — full entries in docs/decisions.md #13/#14)

- **DB-backed opaque-token sessions**, not signed cookies / JWT / Auth.js / Supabase Auth:
  server-side revocation and logout-invalidates-really are hard requirements; opaque random
  tokens also eliminate the signing secret entirely (SESSION_COOKIE_SECRET was removed from
  the env inventory — a recorded reversal of the Phase 1 assumption).
- **Argon2id** (`@node-rs/argon2`, OWASP m=19456 KiB/t=2/p=1) behind a one-file boundary.
- **Expiry: absolute 7 days, no idle timeout, no renewal.** Honest trade-off, not a claimed
  optimum: an idle timeout is implementable with ~1 write per session per interval (not per
  request) and would suit shared terminals better; it was cut for simplicity, logout is the
  shared-terminal remedy, and account-switch on login kills the previous session. Revisit
  trigger: any real shared-kiosk deployment.
- **Fixation:** no pre-auth sessions exist, tokens are only minted server-side after
  verification, and login destroys whatever session the browser presented — there is nothing
  an attacker can fix. Pinned by tests, not just asserted.
- **Rate limiting:** per-process in-memory failure buckets (bounded map; limited buckets survive
  eviction unless every bucket in the 10k-entry map is simultaneously limited — a state only
  ~100k Argon2-priced failures in one window can arrange). Limits: 10/15min per email,
  30/15min per IP. The IP comes from the leftmost X-Forwarded-For entry and the deploy
  therefore ASSUMES a fronting proxy that sets/overwrites XFF (Render/Vercel do); it is
  spoofable in both directions (bypass, and locking someone else's IP for a window —
  availability only, never auth), so the IP bucket is advisory defense-in-depth and the
  deploy phase should re-key it to the platform's trusted client-IP header — and a request with no XFF at
  all skips the IP arm entirely rather than pooling everyone into one shared bucket a
  proxyless misconfiguration would let 30 failures lock for all users. The email bucket is
  the real control and Argon2 cost is the floor.
  Accepted, documented trade-offs: a single-instance deploy makes per-process effective;
  a sustained attacker can hold a known email's bucket full (15-min self-healing lockout) —
  chosen over letting correct passwords through a full bucket, which would neuter
  brute-force protection entirely. Escalation path: DB-backed counters + CAPTCHA/backoff.
- **CSRF:** origin check on all mutating API requests (runs before auth — covers login CSRF,
  where SameSite gives nothing) + SameSite=Lax cookies + the no-mutating-GET invariant.
  Revisit trigger: any cross-origin client or third-party embedding.
- **CORS:** none, deliberately — same-origin app; absent CORS headers are the policy.
- **Headers:** nosniff, DENY framing, referrer + permissions policies, HSTS (production
  builds only), and a minimal fallback-safe CSP (`base-uri`/`object-src`/`frame-ancestors`/
  `form-action`/`connect-src` — none of these cascade into script/style, so Next's inline
  runtime is untouched). Full `script-src` + nonce CSP is deferred to the frontend phase;
  `__Host-` cookie prefix is documented-not-adopted (hosts sit on the Public Suffix List;
  revisit on a custom domain).

## What is deliberately not built

- Member-facing anything (members have no accounts — self-service booking is an unbuilt
  stretch goal; merging members into users was rejected in decisions.md #7).
- Member-facing authentication (members are not users — decisions.md #7).
- Distributed rate limiting, refresh tokens, "remember me", password reset, MFA, admin
  session-revocation UI: each is real product surface with no goal behind it in the brief.
- A second service, an event bus, Redis: nothing here has the fan-out to justify them.
