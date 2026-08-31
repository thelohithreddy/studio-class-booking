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
| 5   | Booking lifecycle: book/waitlist/cancel/promote/settle, immutable timeline; named deliverable: the 40-concurrent-bookings race test (capacity 10 → exactly 10 BOOKED) | 4, 9                                       | 2.5h     |        |
| 6   | Classes, sessions, co-instructors UI + instructor visibility                                                                                                          | 2, 3, 5                                    | 1.5h     |        |
| 7   | Bookings list (server search/filter/sort/pagination)                                                                                                                  | 6                                          | 1.5h     |        |
| 8   | Recurring generation + CSV export + seed data                                                                                                                         | 7                                          | 1.5h     |        |
| 9   | Dashboard + membership alerts                                                                                                                                         | 8, 10                                      | 1.5h     |        |
| 10  | Deploy, demo data, SUBMISSION.md                                                                                                                                      | —                                          | 1h       |        |

Authorization was pulled forward into its own phase (originally folded into the feature phases)
because the execution protocol treats it as a security foundation the feature phases build on —
the safer order. Sum of estimates is ~15h against a 12h budget: the feature phases each have an
obvious "smaller but still correct" fallback, the lifecycle in phase 5 does not.

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

## Retrospective (filled at submission)

- What order did you build in, and why that order? — see table above; final commentary at the end.
- What did you estimate versus what it actually took? — running in the table.
- What did you cut when you ran short? — recorded when it happens.
