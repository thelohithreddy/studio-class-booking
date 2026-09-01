# Plan

Maintained as the work happens, one section per phase. The retrospective questions at the bottom
get their final answers at submission time; estimates and actuals are recorded per phase as each
one closes.

## Phases

The ten goals cluster naturally: everything depends on the schema, the booking lifecycle is the
riskiest single piece, and the dashboard/exports read whatever the earlier phases wrote. So the
order is infrastructure → data model → auth → lifecycle → the read-heavy features → polish.

| #   | Phase                                                                                                                                                                 | Covers goals                               | Estimate | Actual |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------- | ------ |
| 1   | Scaffold: toolchain, CI, health endpoint, local Postgres                                                                                                              | —                                          | 1h       | ~1.5h  |
| 2   | Schema + migrations + seed skeleton, integration-test harness                                                                                                         | 2, 3 (data), 9 (shape)                     | 2h       |        |
| 3   | Auth: identity + session security (Goal 1 partial — authentication only; enforcement is centralized in Phase 4 and consumed by later phases)                          | 1                                          | 1.5h     | ~2h    |
| 4   | Server-side authorization: RBAC capability table, resource scope, guards, IDOR/mass-assignment defenses, attack suite                                                 | 1 (enforcement), 5 (visibility foundation) | 1.5h     | ~2.5h  |
| 5   | Domain CRUD: classes, members, rooms, sessions (defaults/overrides, conflict validation, archive/restore, staff-only mutations, instructor read scope)                | 2, 3, 5 (visibility)                       | 1.5h     | ~3h    |
| 6   | Booking lifecycle: book/waitlist/cancel/promote/settle, immutable timeline; named deliverable: the 40-concurrent-bookings race test (capacity 10 → exactly 10 BOOKED) | 4, 9                                       | 2.5h     |        |
| 7   | Co-instructor management + bookings list (server search/filter/sort/pagination)                                                                                       | 5 (mutation), 6                            | 1.5h     |        |
| 8   | Recurring generation + CSV export + seed data                                                                                                                         | 7                                          | 1.5h     |        |
| 9   | Dashboard + membership alerts                                                                                                                                         | 8, 10                                      | 1.5h     |        |
| 10  | Deploy, demo data, SUBMISSION.md                                                                                                                                      | —                                          | 1h       |        |

Two deliberate reorderings from the original plan, both to build foundations before the
features that depend on them: authorization was pulled forward into its own phase (Phase 4),
and domain CRUD (Phase 5) now precedes the booking lifecycle (Phase 6) — bookings reference
sessions, members and classes, which must exist first. Sum of estimates is ~15h against a 12h
budget: the feature phases each have an obvious "smaller but still correct" fallback, the
lifecycle in phase 6 does not.

## Phase log

### Phase 1 — scaffold (done)

Estimated 1h, took ~1.5h. The overrun was version archaeology, not construction: the initially
pinned TypeScript 7 and ESLint 10 turned out to be unusable together with the rest of the toolchain
(see decisions 2 and 3 in docs/decisions.md), and Prisma 7 moved connection URLs out of the schema
file entirely. Delivered: pnpm + strict TS + ESLint/Prettier/Vitest wiring, Next app shell with a
`/api/health` liveness probe, boot-time env validation, Prisma 7 datasource + CLI config, dockerised
local Postgres, and a CI workflow running format/lint/typecheck/test/build.

### Phase 2 — schema + migrations + integration harness (done)

Estimated 2h, took ~2.5h — the extra time went into an adversarial design review that paid
for itself. Process: full design doc (entities, invariants I1–I13, DB-vs-app rule line,
index/constraint/migration/test strategy, risks, alternatives) → a 13-agent review panel:
two hands-on probers verified every risky Prisma 7/PG 17 assumption against scratch
databases (the STABLE-operator CHECK, exclusion constraints through migrate dev, the
drift/DROP question, generated-client strictness, adapter API, @db.Date UTC semantics)
and four hostile reviewers (DB, concurrency, assignment coverage, security) produced 22
findings, each non-minor one adversarially re-verified. Five verified majors changed the
design before a line was committed — most importantly reversing my "capacity backstop is
not DB-expressible" claim (decisions.md #10), adding case-insensitive uniqueness at the
DB, fixing an unconditional-promotion bug in the planned cancel flow, and shipping the
global password-hash omit now rather than in the auth phase. Delivered: 9-table schema,
one migration (Prisma DDL + hand-written SQL tail: btree_gist, CHECKs, two exclusion
constraints, partial unique index, five triggers), PrismaClient singleton, integration
harness (own database, from-scratch migrate on every run), 41 integration tests proving
every DB invariant, CI Postgres service. Two real bugs were caught by running, not
reading: an empty-string DIRECT_URL that defeated a `??` chain, and `@updatedAt` having
no DB default (raw-SQL inserts failed NOT NULL). Cut from this phase: the seed skeleton —
seeding without auth users worth seeding is scaffolding for its own sake; it moves to
Phase 7 alongside demo data, where it has real content.

### Phase 3 — authentication + session security (done)

Estimated 1.5h, took ~2h. Same shape as Phase 2: full design doc → adversarial panel (two
hands-on probers + three review lenses + skeptic verification, 13 agents) → implement →
hostile diff review. The panel changed real things before implementation: login now destroys
whatever session the browser presented (shift-change on a shared front-desk machine no longer
strands a valid session nobody holds), rate-limit eviction can't be used to flush a victim's
bucket, all auth responses carry no-store, and a minimal fallback-safe CSP + production HSTS
shipped now instead of "later". The probers killed two would-be CI failures before they
happened: @node-rs/argon2's `Algorithm` const enum breaks `next build` under
verbatimModuleSyntax (import avoided), and vitest comma-joins multiple Set-Cookie headers
(single-cookie responses only, asserted via .get()). Delivered: auth_sessions migration,
password/rate-limit/session/error-taxonomy modules, login/logout/me routes + minimal login
page, 40 new tests (93 total), full-flow smoke test over real HTTP. Deferred with rationale:
RBAC (Phase 4 consumes SessionUser.role), demo users (Phase 7 seed), script-src CSP
(frontend phase).

### Phase 4 — server-side authorization (done)

Estimated 1.5h, took ~2.5h. Same protocol: design doc → adversarial panel (a hands-on Next
16/Prisma prober + three review lenses + skeptic verification) → implement → hostile diff
review. The panel moved real things before code: the capability/scope/guard split held up,
but the reused handleRoute was single-argument and could not thread a dynamic route's id to
the guards — fixed by making it generic over ctx (two lenses raised this independently). The
prober earned its keep twice: it proved the scoped OR-query is one SQL statement with an
EXISTS semi-join (no N+1) and that the count under the same fragment cannot leak, and it
found that the tsconfig `.next` exclude was silently shadowing the `.next/types/**` route
validators — so a wrong dynamic-route signature built clean. Narrowing the exclude turned
that safety net back on (verified: a mismatched param key now fails the build). Also hardened
beyond the brief: bookingScopeWhere is derived from sessionScopeWhere so Goal 6's future
scoped count is non-leaking by construction, not convention. Delivered: no migration (the
schema already carried role, primary_instructor_id, session_instructors and the indexes), the
three authorization modules, 3 read endpoints (a scoped session list + scoped session read +
a staff-only members read) and 15 guarded 501 handlers across 13 route files, and 40 new tests
(143 total) covering the full attack matrix — IDOR 404-equality, relationship revocation,
count non-leak, malformed-uuid-not-500, role/param tampering, and a property sweep asserting
each instructor's visible set equals their DB-derived related set.

### Phase 5 — domain CRUD: classes, members, rooms, sessions (done)

Estimated 1.5h, took ~3h — the biggest phase so far (first real business logic). Same
protocol: design doc → adversarial panel (a Prisma/PG runtime prober + three lenses +
verification) → implement → hostile diff review. The panel and my own probe changed real
things before commit. The load-bearing discovery: Prisma over the pg adapter does NOT expose
raw SQLSTATEs — unique is P2002, FK P2003, but exclusion and check BOTH arrive as P2039 with
the SQLSTATE nested at cause.code and the constraint name only in cause.message. The design's
SQLSTATE-keyed error translator was wrong; I captured every real error shape against the
database and rewrote db-errors.ts + its unit test to match, with a test that no constraint
name or row detail leaks. Also fixed before commit: PATCH /sessions re-validates the
instructor role on change (no DB backstop for that rule — the app check is the only guard);
malformed path uuids 404 instead of 500 (parseIdOr404); the scoped session read gained SAFE
display relations (class title, room name, instructor name — never member PII) so Goal 5's
"my sessions" is names not UUIDs; ?classId is uuid-validated. Delivered: db-error translation,
zod schemas, interval + id helpers, four domain services, ~16 routes (filling Phase-4 stubs +
new class archive/restore, rooms, id reads), the room:manage capability, minimal functional
staff/instructor UI, and 85 new tests (228 total) — full conflict matrix (room+instructor ×
5 interval shapes), 8-way concurrency, delete lifecycle, defaults/overrides, and a domain
attack suite. No migration (the schema already carried every field). Deferred, documented and
still guarded 501: booking lifecycle, waitlist, attendance, recurring, CSV, dashboard, alerts,
co-instructor mutation.

### Phase 6 — booking engine: state machine + capacity + waitlist + concurrency (done)

Estimated 2.5h, took ~3.5h — the concurrency-critical phase. Followed the protocol with extra
weight on PROVING the concurrency strategy before implementing: a throwaway probe confirmed
`$transaction` + `SELECT … FOR UPDATE` blocks a competing tx and gives 10 BOOKED / 30
WAITLISTED under 40 concurrent, BEFORE any route was written. Then design doc → adversarial
panel (a hands-on concurrency prober + three lenses + verification) → implement → hostile diff
review. The panel found ONE blocker, reproduced destructively by the prober: deciding a
cancel/settle from the booking status read BEFORE the session lock lets two concurrent
same-booking operations overbook, double-promote and break the immutable ledger. The
implementation re-reads the status AFTER the lock (the prober verified this exact fix yields
clean results), proven by the concurrency suite's TEST D/E. The prober also confirmed:
READ COMMITTED default, no deadlocks, the lock is load-bearing (removing it overbooks), the
Intl-based membership check is correct across +14/−11 zones, forced-failure rollback works,
and 40/80 concurrent finish in 87/128ms with default settings. Delivered: the state-machine
module, membership validity (studio-timezone), the booking service (four locked transactions +
promotion + standalone-note for Goal 9), five routes, STUDIO_TIMEZONE env, and 39 new tests
(268 total) — the full concurrency matrix (TEST A–F + rollback), lifecycle, state machine and
membership. No migration (Phase 2 carried everything). Deferred, still guarded 501: the rich
bookings search (Phase 7), recurring, CSV, dashboard, alerts, co-instructor mutation.

### Phase 7 — search, filtering, pagination (Goal 6) (done)

Estimated 1.5h, took ~2.5h. Used the branch → PR → merge workflow (phase-7-search). Protocol:
audit → design → hands-on query probe → adversarial panel (3 lenses + verification) →
implement → hostile self-review. The probe proved the risky mechanics UP FRONT: escapeLike
makes LIKE metacharacters literal (q="%" matches only a member with a literal %, not all), the
scope∩classId intersection returns empty for a class the instructor doesn't teach (cannot
widen), the half-open [from,to) range excludes the `to` boundary, and EXPLAIN shows index
scans with no sequential scans. The panel's one "major" — that searching member email for
instructors is an inference oracle — was REFUTED by the verifier: Goal 6 mandates "text search
over name and email" for the viewer, so role-gating email would violate the goal; kept and
documented as a scope-contained accepted limitation (decisions.md #25). Applied minors: the
sessions date range now uses studio-timezone midnight boundaries (DST-correct, consistent with
membership) rather than UTC; a belt-and-suspenders orderBy fallback so a future sort key can't
silently drop the pagination tiebreaker; the list param typed from the schema. Delivered: the
full Goal-6 bookings list (scoped text search over member name/email, class/session/status
filters, bookedAt/status/session sort, pagination + scoped total), a sessions date-range
filter, escapeLike + studioDateToUtc helpers, and 28 new tests (297 total) — scope+count,
filter intersection, literal-wildcard + SQLi payloads, deterministic cross-page ordering,
pagination bounds, data minimization, and DST boundaries. No migration. Deferred, still guarded
501: co-instructor mutation, recurring, CSV, dashboard, alerts.

### Phase 8 — co-instructors + recurring generation (done)

Branch `phase-8-coinstructors-recurring`. Scope: Goal 5 (co-instructor management) + the
recurring half of Goal 7 — CSV stays deferred. (Reordering: the original table put co-instructors
in Phase 7 and recurring in Phase 8; Phase 7 spent its budget on Goal 6, so both landed here.)
Protocol as before: audit → design (concurrency strategy decided BEFORE code) → hands-on probes →
adversarial DESIGN panel (3 lenses + skeptic verification) → implement → adversarial DIFF panel.

The design panel earned its keep — it found three real defects in the first design and refuted a
fourth: (F1) `createSession` was left on the Phase-5 primary+room check, so creating a session
whose primary is already a _co_ of an overlapping session slipped through with no race — a
single-threaded bug; (F2) a co-add and a concurrent time-edit of the same session took disjoint
locks and could double-book the added co (the child INSERT's `FOR KEY SHARE` does not conflict
with the time-edit's `FOR NO KEY UPDATE`); (F3) `updateSession` was an unlocked read-modify-write
→ a lost update. The unifying fix is a uniform **session→user** lock order (decisions.md #28): every
schedule mutation locks the session row `FOR UPDATE` first (create has none, so it locks the primary
user row), then the affected instructor user rows in sorted-uuid order. The refuted finding — a
recurring occurrence-count DoS — was closed constructively by computing the count arithmetically
before enumerating (a 100-century payload is rejected in µs). The DST minors became a two-pass
timezone resolver with an explicit, tested gap/fold policy (decisions.md #30).

Delivered: co-instructor add/remove/list (staff-only mutation, scoped read, full any-capacity
conflict matrix), the extended `updateSession` (re-checks the primary AND every co under the new
lock order), recurring generation with a PARTIAL created/skipped report (decisions.md #29), the
`scheduling.ts` lock/overlap spine, `studioDateTimeToUtc`, and 44 new tests (341 total): the DST
resolver (11 unit), co-instructor CRUD/authz/matrix/edit-path (16), the concurrency matrix incl.
the F2 race and a crossed-lock deadlock test (7), and recurring boundaries/skips/idempotency/cap/
concurrency (10). No migration — `session_instructors` (Phase 2) carried everything. Deferred,
still guarded 501: CSV export, dashboard, alerts.

### Phase 9 — CSV attendance export (Goal 7, second half) (done)

Branch `phase-9-csv-export`. The one deferred half of Goal 7 (the recurring half shipped in Phase
8): "export a session's attendance — every booking with its member and final status — as a CSV
file." Protocol: audit → extract the EXACT requirement from the brief (one staff-only per-session
export, one row per booking, columns = member + final status — not a general bookings CSV, and not
invented fields) → design/contract doc → adversarial design panel (exfiltration, CSV-correctness,
assignment-fidelity lenses + verification) → implement → hostile diff review.

Treated as a data-exfiltration boundary. The design panel's one "major" — that the design doc's
"missing session → 404" was unreachable via the flow it wrote — was REFUTED by the verifier because
the implementation already does an explicit `classSession.findUnique` existence check before the
booking query (the doc was under-specified, the code correct); the doc was tightened. Applied
minors: `X-Content-Type-Options: nosniff` on the download; the CSV-injection guard was hardened to
catch a formula trigger hidden behind leading spaces/tabs (Excel trims before evaluating, so ` =cmd`
is still dangerous); the filename proven to be built only from a server-derived date + the validated
uuid. Kept with rationale: Member Email (staff-only export, staff already have full member-email
access, email is the stable identity for an attendance record) and the canonical status tokens
(consistent with the JSON API).

Delivered: the internal RFC 4180 serializer + OWASP formula-injection guard + UTF-8 BOM
(`src/server/reporting/csv.ts`), the scoped export domain (`attendance.ts`), the implemented
`GET /api/sessions/[id]/attendance` route, and 32 new tests (374 total): 19 serializer unit tests
(escaping, Unicode, formula injection, round-trip via the real `csv-parse` parser) and 13 HTTP
integration tests (staff 200 + headers/BOM/nosniff, instructor 403, unauth 401, missing/malformed
404, empty header-only export, every-status coverage, no co-instructor row fan-out, cross-session
isolation, filename safety, data minimization, and a constant-query no-N+1 check). One dev-only
dependency (`csv-parse`, the round-trip test oracle — never shipped). No migration, no new index.
Deferred, still guarded 501: dashboard (Goal 8), membership alerts (Goal 10); deployment remains.

### Phase 10 — operational dashboard (Goal 8) (done)

Branch `phase-10-dashboard`. Goal 8: "A dashboard. A landing view shows headline numbers — sessions
today, bookings made today, no-shows this week, and members currently waitlisted. It also breaks
bookings down by status and by class, and charts attendance per week over the last eight weeks."
Protocol: audit → extract the exact requirement + a metric-by-metric matrix → design doc → adversarial
design panel (authz-leakage / metrics-SQL / UI-a11y lenses + verification) → implement → hostile diff
review. Staff-only, studio-wide, NO parameters (decisions.md #17/#32).

The design panel earned its keep: it found a BLOCKER (raw `$queryRaw` counts return `bigint`, which
@prisma/adapter-pg surfaces as JS `BigInt` → `JSON.stringify` throws on every call, empty DB included)
and a MAJOR (the `width_bucket` chart query, unbounded, dumps all attendance older than 8 weeks into
bucket 0 and scans full history) — both fixed before implementation landed (`::int` casts; a
`WHERE starts_at >= w0 AND < w8` bound). Applied minors: `membersWaitlisted` filters to upcoming
sessions (the "currently" reading, avoiding the Decision-24 orphaned-waitlist inflation); by-class
gets a `class_id` tiebreaker (Class.title is not unique); the page adds an explicit `!user` →
/login branch and `force-dynamic`; a request-cached `currentUser()` collapses the layout+page session
lookup; and the a11y chart became `aria-hidden` decoration over an accessible data table, with an
"as of" studio-local caption and an explicit all-zero-chart note.

Delivered: `getDashboard(db, now)` (seven concurrent DB aggregations), `GET /api/dashboard`, the
the staff landing page (a thin client view over the server-authorized API — see below) + accessible
view, `currentUser()`, and 17 new tests (393 total):
5 unit (boundary math + the bar-scaling zero-division guard) and 12 integration — every metric
asserted against a known fixture with hand-computed expectations AND independent direct-SQL oracles,
half-open day/week boundaries, distinct-member + upcoming-only waitlist, the bounded 8-week chart,
the sum(byStatus)==sum(byClass)==total consistency invariant, staff-only auth (401/403/200),
parameter-pollution safety, empty state (+ clean JSON serialization), tiebreak determinism, and a
constant-query no-N+1 check. EXPLAIN ANALYZE reviewed (<1 ms at ~1500 bookings). A rendering finding
surfaced only by running the production build: a Server-Component landing that redirects at build
was statically prerendered and cached by Next 16 (`s-maxage`, identical for every cookie) even with
`force-dynamic`/`connection()`/`cookies()` — so `/` is the same client-page + API pattern every
other page uses (data-free static shell, per-request fetch), with authorization enforced server-side
by `/api/dashboard` (decisions.md #32). No schema change, no new index, no caching/realtime. Deferred,
still guarded 501: membership alerts (Goal 10); deployment.

## Retrospective (filled at submission)

- What order did you build in, and why that order? — see table above; final commentary at the end.
- What did you estimate versus what it actually took? — running in the table.
- What did you cut when you ran short? — recorded when it happens.
