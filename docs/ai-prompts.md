# AI prompts

How AI was used: the work runs as Claude Code sessions, roughly one per phase of docs/plan.md. The
model does the typing; every generated file is read, and everything it produces is verified by the
same gate CI runs (`format:check`, `lint`, `typecheck`, `test`, `build`) plus a manual smoke test
before it is committed. Prompts below are the ones actually issued, in order, grouped by intent.
Corrections are logged inline — including the ones where the generated output was wrong.

## Phase 1 — scaffolding the toolchain

### Prompt

> Set up the project skeleton for the class-booking assignment: pnpm, Next.js App Router,
> TypeScript strict, Prisma on Postgres, Tailwind, Vitest, ESLint + Prettier, docker-compose for a
> local database, and a GitHub Actions workflow that runs the whole verification chain. Latest
> versions of everything.

(Issued across two sessions; the second session was opened with "continue" and picked up from the
half-finished scaffold.)

### What came back

The full skeleton: package manifest with pinned deps, directory layout, `.env.example`, Prisma
datasource block, then in the second session the config files, app shell, health endpoint, env
validation, unit tests and CI workflow.

### What was wrong, and what was done about it

"Latest versions of everything" was the mistake in the prompt, and it produced a scaffold that
could not lint or typecheck itself:

- **`typescript@7.0.2` + `eslint@10.9.1` are mutually unusable in a Next project today.**
  typescript-eslint's peer range is `<6.1.0`, so `eslint-config-next` crashed at load; separately,
  ESLint 10 removed `context.getFilename()` which `eslint-plugin-react` still calls. Fixed by
  checking the actual peer ranges in `node_modules` and pinning `typescript@5.9.3` +
  `eslint@9.39.5` (docs/decisions.md #2 and #3). The lesson recorded for later phases: pin to the
  newest versions that are compatible _with each other_, not the newest versions absolutely.
- **The Prisma schema used `url = env("DATABASE_URL")`, which Prisma 7 rejects** — connection URLs
  moved to `prisma.config.ts` and the runtime needs a driver adapter. `prisma validate` caught it;
  fixed with `prisma.config.ts` + `@prisma/adapter-pg` (decisions.md #4).
- **The first `prisma.config.ts` used Prisma's `env()` helper, which throws on unset variables** —
  it broke `prisma generate` on hosts with no `DIRECT_URL`. Replaced with a plain `process.env`
  read that omits the datasource block when nothing is set.
- **The generated Vitest config used `test.poolOptions`, removed in Vitest 4**, and a
  `vite-tsconfig-paths` plugin Vite now covers natively (`resolve.tsconfigPaths`). Both flagged by
  deprecation warnings on the first test run; config rewritten, plugin dropped.
- **`pnpm-workspace.yaml` was left with literal placeholder text** ("set this to true or false")
  in the build-allowlist. Replaced with real values for the three packages that need postinstall
  scripts.

Everything above was caught by running the toolchain, not by reading the diff — which is why the
verification chain gate exists.

## Phase 2 — schema and migration, with an adversarial review loop

### Prompt

> PHASE 2 — CORE DATABASE + DOMAIN MODEL. Audit the repository first. Design the complete
> relational model required by ALL future phases (users, members, classes, rooms, sessions,
> session_instructors, bookings, booking_events, membership alert/dismissal representation)
> with explicit invariants, database-vs-application rules, constraint/index/migration/test
> strategy, risks and alternatives — then implement, verify against a real database, inspect
> the generated SQL, and stop. Do not assume Prisma supports a PostgreSQL feature; verify it.

(Condensed from a much longer phase-execution protocol prompt that also mandated: never
blindly code, review as a hostile senior engineer, never fake verification.)

### What came back

A full design document (entities, invariants I1–I13, the DB/app rule line, index and
constraint strategy, migration and integration-test strategy, risks, rejected alternatives) —
then, before implementation, a 13-agent adversarial review: two probers running the risky
Prisma 7/Postgres 17 assumptions against real scratch databases, four hostile reviewers
(database, concurrency, assignment coverage, security), and a skeptic re-verification of
every non-minor finding.

### What was wrong, and what was done about it

The design the model produced first was wrong in ways the review caught **before commit**:

- **It claimed a database-level capacity backstop was impossible** ("COUNT is not
  CHECK-expressible") and left overbooking protection to the app lock alone. A review agent
  disproved this empirically — a denormalised `booked_count` with
  `CHECK (booked_count <= capacity)` made two lock-bypassing concurrent last-seat bookings
  fail correctly. Adopted; recorded as the reversal in decisions.md #10.
- **The planned cancel flow promoted from the waitlist unconditionally** — promoting even
  when the cancelled booking was WAITLISTED (the brief says only a Booked cancellation
  promotes) and even into a session whose capacity had been shrunk. The promotion condition
  is now explicit in the design and docs.
- **Uniqueness was byte-case-sensitive** — 'Studio A' and 'studio a' would have been two
  rooms, silently splitting overlap detection. Replaced with `lower()` unique indexes in SQL.
- **The app-only co-instructor conflict check was shown racy** (two transactions committed a
  double-booked instructor in the probe). The sessions phase now specifies per-instructor
  advisory locks; the design doc's "impossible to constrain across the join table" wording
  was also corrected to "possible but rejected for complexity".
- One finding was **refuted** by the skeptic pass and rejected: a proposed
  status-vs-ledger constraint trigger (the only actor able to attempt the attack can also
  drop the trigger; divergence is already tamper-evident) — kept as a doc clarification only.

Implementation then surfaced two more real bugs that reading had missed, both caught by the
test run: the harness passed `DIRECT_URL: ''` to the Prisma CLI (an empty string survives the
`??` fallback chain and then reads as "no URL"), and `@updatedAt` emits **no database
default**, so every raw-SQL fixture insert died on NOT NULL until `updated_at` got
`@default(now())` too.

A second hostile-review pass over the finished (still uncommitted) diff caught more, all
verified before fixing: the db singleton's `: PrismaClient` annotation silently **erased the
`omit` from the type system** (`user.passwordHash` typechecked as `string` while absent at
runtime — proven with a probe file that compiled when it should not have); `env()` ran at
module import, which would have made `next build` require a DATABASE_URL the moment any
route imports the db (made lazy); the pooling comment repeated Phase-1 folklore —
node-postgres ignores `pgbouncer=true&connection_limit=1` (pool max stayed 10 in a live
probe), so the comment and .env.example now say what is actually true; dismissals carried a
CASCADE the reviewed design had not sanctioned (now RESTRICT, pinned by a test); the
"every constraint is integration-tested" claim had four untested constraint/trigger arms
(tests added — including a TRUNCATE test constructed non-vacuously, since a naive
`TRUNCATE bookings` fails on an FK even without the trigger under test); and two of my
earlier sed-style doc edits had **silently not applied** because Prettier had reformatted
the target text — the "amendment recorded in plan.md" claim was false until re-done and
re-grepped. That last one is the sharpest lesson of the phase: verify that an edit landed,
not that a script exited zero.

## Phase 3 — authentication, with the same review loop

### Prompt

> PHASE 3 — AUTHENTICATION + SESSION SECURITY. Audit everything first. Evaluate session
> architectures (server-side sessions, signed cookies, JWT, third-party) and choose the
> simplest production-grade approach with documented trade-offs. Argon2id or bcrypt. No user
> enumeration. Server-side logout invalidation. Analyze CSRF, CORS, headers, rate limiting,
> fixation, expiration — decisions, not hand-waving. Twenty minimum tests plus attack tests.
> Establish getCurrentUser() for Phase 4. Stop after Phase 3.

(Condensed; the full phase protocol also mandated hostile security review and evidence for
every claim.)

### What came back

A design doc (DB-backed opaque-token sessions — which reversed the Phase 1 signed-cookie
assumption and deleted SESSION_COOKIE_SECRET from the env inventory — Argon2id, origin-check
CSRF model, in-memory rate limiting with honest limits), then a 13-agent panel: two probers
running the runtime assumptions hands-on, three hostile lenses, skeptic verification of every
non-minor finding. Then implementation, 93/93 tests, a real-HTTP smoke of the whole flow, and
a second hostile review of the finished diff.

### What was wrong, and what was done about it

The design the model wrote first had real defects the panel caught before implementation:

- **Login left a stranded valid session on account switch.** "Login always overwrites any
  cookie present" was browser-side only: the previous account's session row stayed valid for
  up to 7 days with nobody holding its cookie — routine on a shared front-desk machine.
  Login now destroys whatever session the request presented; a test pins it.
- **The written flow rate-limited the RAW email before normalizing it**, so case variants of
  one address would each get fresh attempt windows. The implementation normalizes inside the
  zod schema through the same `normalizeEmail` every writer must use; a test drives 11
  case/whitespace variants into one 429.
- **The limiter design was an unbounded map keyed on attacker-chosen strings** (an
  unauthenticated OOM on a 512MB instance), and naive capped eviction would have let a
  key-flood flush a victim's bucket and reset their counter. The implementation bounds the
  map and spares limited buckets from eviction (absolute only until every bucket in the map
  is simultaneously limited, which costs an attacker ~100k Argon2-priced attempts per
  window); both behaviors unit-tested with mutation-killing assertions.
- **Probers killed two CI-only traps before they happened:** importing @node-rs/argon2's
  `Algorithm` const enum fails `next build` under verbatimModuleSyntax while vitest passes
  (the boundary file relies on the argon2id default; the PHC-prefix unit test pins it), and
  vitest comma-joins multiple Set-Cookie headers (responses here set exactly one; asserted
  accordingly).
- **"Documented" was claimed eight times with no doc deliverable named.** The compliance
  lens forced the docs list this phase actually shipped (architecture.md's request path,
  schema.md's auth_sessions, decisions #13/#14, plan row 3 rewording, this entry).
- One trade-off was made deliberately against a reviewer's suggestion and recorded instead
  of adopted: a full per-email bucket still blocks even a correct password (15-minute
  self-healing lockout under sustained attack) — the alternative, verifying through a full
  bucket, would have let a brute-forcer keep guessing at full speed and learn from 204s.

## Phase 4 — server-side authorization

### Prompt

> PHASE 4 — SERVER-SIDE AUTHORIZATION (RBAC + resource authorization). The UI is not a
> security boundary; assume the reviewer attacks the API directly. Central role authorization,
> resource-level scoping (instructor sees only sessions where primary or co-instructor), IDOR
> defense, mass-assignment protection, fail-closed, deliberate 401/403/404 semantics. Do not
> implement business workflows — establish the authorization architecture and prove it. 29
> mandatory attack tests plus property-based invariants. Stop after Phase 4.

### What came back

A design doc (capability table + scope-as-query-fragment + composable guards + guarded 501
stubs for every future mutation), then the adversarial panel: a hands-on Next 16/Prisma
prober and three hostile lenses (pentester, authz-code, phase-compliance) with skeptic
verification.

### What was wrong, and what was done about it

- **The reused `handleRoute` was single-argument** and could not pass a dynamic route's
  `[id]` to the guards — every id-addressed IDOR protection depended on it. Two lenses raised
  it independently; fixed by making `handleRoute` generic over `ctx` (the returned wrapper
  keeps `ctx` optional so Phase-3 single-arg routes and tests are untouched). The skeptic
  verifiers then _refuted_ the finding as already-fixed, because they ran against the
  working tree after the edit — a nice demonstration that the loop tracks the live code.
- **The prober found the tsconfig `.next` exclude was silently shadowing the
  `.next/types/**` route validators**, so a wrong dynamic-route signature (missing `Promise`,
  mismatched param key) built and type-checked clean — the exact safety net the design
  claimed. Narrowing the exclude turned it back on; verified by temporarily breaking a route
  to `RouteContext<'wrongkey'>` and watching `tsc` reject it against Next's generated
  validator (TS2344).
- **The design cited P2023 for an invalid-uuid Prisma error; it is actually P2007** on the
  pg adapter (7.10). The mitigation (zod-validate the uuid → 404 before Prisma) works either
  way; the doc comment was corrected for honesty.
- **`bookingScopeWhere` didn't exist yet** — the design claimed the count-non-leak property
  was structural but had only one scope builder. Added `bookingScopeWhere = { session:
sessionScopeWhere(user) }`, derived (not hand-copied) from the session rule, so Goal 6's
  future booking search inherits non-leaking counts by construction.
- Judgment call recorded rather than deferred: the panel asked whether attendance export /
  dashboard should be resource-scoped for instructors. Decided permanently staff-only
  (decisions.md #17) with the migration path documented — the honest reading of Goals 7/8.

## Phase 5 — domain CRUD (classes, members, rooms, sessions)

### Prompt

> PHASE 5 — CLASSES + MEMBERS + ROOMS + SESSIONS. First real business-domain phase. CRUD with
> session default inheritance and overrides, conflict validation (room + primary instructor,
> half-open intervals), archive/restore, staff-only mutations, instructor read scope. Reuse
> the existing auth/authz/error/test architecture. Do NOT implement booking/waitlist/etc.
> Full conflict-interval matrix, concurrency test, authorization attack tests. Stop after
> Phase 5.

### What came back

A design doc, then the adversarial panel (a Prisma/PG runtime prober plus domain-architect,
pentester and phase-compliance lenses with verification), then implementation and a hostile
diff review.

### What was wrong, and what was done about it

- **The error-translation design assumed the wrong Prisma shape.** It keyed on the raw
  SQLSTATE (`err.code === '23505'`). A review lens ran the real constraints and found Prisma
  over the pg adapter throws `P2002`/`P2003`/`P2039` — with exclusion AND check both as
  `P2039` and the SQLSTATE only nested at `cause.code`. The dedicated prober happened to
  return a stub, so I captured every real error shape directly against the database
  (`P2002` with `cause.constraint.index`, `P2039` with `cause.code` 23P01 vs 23514, the
  exclusion constraint name only in `cause.message`) and rewrote `db-errors.ts` and its unit
  test to the real shapes — plus a test asserting no constraint name or row detail leaks
  into any response (decisions.md #18). The lesson: when an agent's probe returns nothing
  usable, verify the fact yourself rather than trusting the design's assumption.
- **PATCH /sessions had asymmetric validation** — three reviewers flagged that a staff user
  could assign a STAFF (non-instructor) user as a session's primary instructor on edit, since
  there is no DB backstop for the instructor-role rule (the FK only proves existence). My
  implementation already re-validated on change; I added the explicit 422 test the panel
  demanded.
- **Goal 5's instructor "my sessions" list returned bare UUIDs** — the scoped read had no
  class/room/instructor names, and the name-resolving endpoints are staff-only. Enriched the
  scoped read and list with SAFE display relations (class title/discipline, room name,
  instructor name) while keeping all member/booking data out.
- **Malformed path uuids would 500** (Prisma P2007) on the new id routes — added
  `parseIdOr404` so they 404 identically to an absent row, and uuid-validated the `?classId`
  filter (else a non-uuid 500s).
- **`z.string().datetime()` silently rejects numeric-offset instants** — the design already
  used `{ offset: true }`; the probe confirmed it was necessary.
- **The hostile diff review (re-run after the machine slept mid-review) surfaced a verified
  major** two lenses reproduced independently: member `membershipExpiresOn` used a shape-only
  regex, so `2026-02-30` was silently stored as `2026-03-02` (corrupting the field Goals 4
  and 10 depend on) and `2026-13-40` threw a raw 500. Fixed with `z.iso.date()` (real
  calendar validation) plus unit and integration tests. The review also bounded the sessions
  list (the one unbounded list endpoint), made session delete idempotent (double delete → 404,
  not a P2025 500), tightened PATCH to validate the resolved instructor role rather than only a
  changed one, and wired the list routes through the previously-dead `listQuerySchema`
  (out-of-range pagination is now a clean 400).

## Phase 6 — booking engine (state machine + concurrency)

### Prompt

> PHASE 6 — BOOKING LIFECYCLE + CAPACITY + WAITLIST + PROMOTION + CANCELLATION + SETTLEMENT +
> CONCURRENCY SAFETY. Assume simultaneous requests, double-clicks, retries. The 40-concurrent
> test (capacity 10 → 10 BOOKED / 30 WAITLISTED, never 11) is the most important part. Prove
> the concurrency strategy before implementing. One authoritative state machine. Immutable
> history. Actor from the authenticated user, never the body. Do NOT implement recurring/CSV/
> dashboard/alerts. Stop after Phase 6.

### What came back

A design (per-session FOR UPDATE anchor, state-machine module, capacity invariant), proven up
front by a throwaway concurrency probe, then the adversarial panel (a hands-on concurrency
prober + three lenses + verification), implementation, and a hostile diff review.

### What was wrong, and what was done about it

- **The blocker — reproduced destructively by the prober.** The design's cancel/settle flow, as
  written, decided the transition from the booking status read BEFORE taking the session lock.
  The prober implemented it verbatim and produced, deterministically: two concurrent cancels of
  one BOOKED booking → two active bookings on a capacity-1 session (overbooking), a drifted
  counter, two promotion events (double promotion), duplicate CANCELLED events on the
  append-only ledger, and a settle-racing-cancel that wrote a self-contradicting timeline
  (event N+1's from_status ≠ event N's to_status — a Goal 9 violation). Both DB backstops
  missed it (the CHECK passed at 1≤1; the partial-unique saw different members). The fix — which
  the implementation already carries and the prober verified independently — is to re-read the
  booking's status AFTER acquiring the session lock and branch on that; TEST D/E prove it
  against real Postgres. This is the phase's sharpest lesson: a row lock only protects decisions
  made from reads taken _after_ it is held.
- Smaller review items, all applied: added a standalone NOTE_ADDED endpoint so Goal 9's "notes
  staff leave" have a path without a status change; wrapped cancel/settle in `withDbErrors` so
  an escaped constraint is a clean 409/422; corrected the design's claim that the booked_count
  CHECK escape is a 409 (it is a 422); reconciled the Phase-2 schema comment ("count of BOOKED")
  with the actual capacity rule (BOOKED+ATTENDED+NO_SHOW); documented the boundary choices
  (settlement on startsAt, promotion without expiry re-check) as decisions rather than
  accidents. The prober confirmed the default tx timeout/pool have 20–60× margin, so the
  explicit `maxWait/timeout` are headroom, not a fix.

## Phase 7 — search, filtering, pagination (Goal 6)

### Prompt

> PHASE 7 — PRODUCTION SEARCH + FILTERING + PAGINATION. This is NOT "add a search box":
> database-level filtering + resource authorization + deterministic sorting + bounded
> pagination + correct scoped counts + safe search + no data leakage. Authorization scope
> applied BEFORE filtering/counting/sorting/pagination. Instructor never gets global booking
> access; filters must not widen scope. Allowlist sort fields + direction. Parameterize all
> search values; handle wildcard semantics deliberately. Branch → PR → merge. Stop after Phase 7.

### What came back

The Goal-6 bookings list (scoped text search over member name/email, class/session/status
filters, bookedAt/status/session sort, pagination + scoped total) plus a sessions date-range
filter — designed, proven by a hands-on query probe, reviewed by a 3-lens panel with
verification, then implemented.

### What was wrong, and what was done about it

- **The panel's "major" was a real judgment call that the verifier correctly reversed.** A lens
  flagged that searching member _email_ for instructors (who can't see emails) is an inference
  oracle, and proposed role-gating the email clause. The adversarial verifier refuted it: Goal 6
  literally mandates "text search over member name **and** email" for _the viewer_ (instructors
  included), so gating email would **violate the assignment**. The loop stopped me from shipping
  a Goal-6-breaking "fix"; the behaviour is kept and the scope-contained oracle documented
  (decisions.md #25). A good reminder that an adversarial finding is a hypothesis, not a verdict.
- **The sessions date range used UTC-day boundaries while the rest of the server uses
  STUDIO_TIMEZONE.** Fixed: `from`/`to` now convert to midnight in the studio timezone
  (DST-correct via an Intl offset), consistent with how membership expiry is judged; a DST
  boundary test pins it.
- Belt-and-suspenders: the sort key→orderBy map falls back to the bookedAt order if a future
  key is ever unmapped, so pagination can never silently lose its unique `id` tiebreaker (and
  the cross-page shuffle it prevents).
- Two test-fixture bugs surfaced by _running_ (not reading): shared-instructor sessions at
  overlapping times tripped the Phase-2 instructor-overlap constraint — fixed by a fresh
  instructor per fixture session. The query mechanics themselves (literal wildcards, the
  scope∩filter intersection, half-open date boundaries, index-only plans) were all proven by a
  throwaway probe before the routes were written.

## Phase 8 — co-instructors + recurring generation (Goals 5 & 7-recurring)

### Prompt

> PHASE 8 — PRODUCTION CO-INSTRUCTORS + RECURRING SESSIONS. Implement ONLY: co-instructor
> management + authorization + conflict protection; recurring weekly generation + conflict
> handling + atomicity/failure safety; tests; docs. Do NOT build CSV, dashboard, alerts, UI, or
> deploy. Design the concurrency strategy BEFORE writing CRUD. Do not reflexively pick advisory
> locks just because Phase 2 mentioned them. The conflict domain is INSTRUCTOR + TIME in ANY
> capacity (primary or co), half-open intervals. Recurring must PARTIAL-generate with a
> created/skipped report (Goal 7), be DST-correct, and bounded. Extend updateSession to re-check
> all instructors. Feature branch → PR → merge. Stop after Phase 8.

### What came back

The design was written and probed first (the instructor row-lock serialization, the overlap
query, deadlock-free sorted locks, and the DST time helper were each proven by a throwaway
probe), then run through a 3-lens adversarial DESIGN panel with skeptic verification, folded in,
implemented, and finally run through a second 3-lens panel over the actual IMPLEMENTATION diff.
Delivered: co-instructor add/remove/list, the extended `updateSession`, recurring generation with
a partial report, the `scheduling.ts` lock/overlap spine, `studioDateTimeToUtc`, and 44 tests
(341 total). No migration.

### What was wrong, and what was done about it

- **The design panel found three real defects before a line of production code was written — the
  highest-value review of the project.** (1) `createSession` was left on the Phase-5 primary+room
  check, so creating a session whose primary is already a _co_ of an overlapping session slipped
  through with no race at all — a single-threaded correctness bug the design's own "no path is
  unsafe" claim contradicted. (2) A co-add and a concurrent time-edit of the _same_ session took
  disjoint locks and could double-book the added co — the subtle reason being that the child
  INSERT's `FOR KEY SHARE` on the parent row does not conflict with the time-edit's
  `FOR NO KEY UPDATE` of non-key columns, so no shared lock existed. (3) `updateSession` was an
  unlocked read-modify-write → a lost update. All three were closed by one change: a uniform
  **session → user** lock order (lock the session row `FOR UPDATE` first, then instructor user
  rows sorted), recorded as decisions.md #28 — which explicitly _reverses_ the Phase-2 note (and
  Decision 21) that reserved advisory locks for this.
- **The panel's DoS "major" was refuted — constructively.** A lens argued the recurring
  occurrence cap could be defeated by a huge date range forcing per-day enumeration + Intl calls
  before the cap check. The verifier refuted it (the count is closed-form arithmetic — measured
  0.058 ms for a 2.9M-day payload), but the constructive half was adopted anyway: the count is
  computed arithmetically and the cap enforced _before_ any date is materialized, plus a cheap
  raw-span gate. A test asserts the 100-century payload is rejected in < 2 s.
- **All three lenses flagged that the DST helper was only proven for 18:00 London** (far from the
  ~01:00 transition), with no policy for a nonexistent/ambiguous wall time. Rebuilt as a two-pass
  fixed-point resolver, exact for every real class time (including transition-adjacent), with an
  explicit, unit-tested gap→forward / fold→standard-time policy across two zones and both
  directions (decisions.md #30).
- **A pg deprecation surfaced only by _running_ the tests, not reading the diff.** Returning a
  nested-relation `select` from inside an interactive transaction pipelines on its single held
  connection ("client is already executing a query" — removed in pg@9). Fixed by returning the
  id from the transaction and reading the display projection after commit — which also matches
  the pre-Phase-8 pattern. Caught because the existing booking-concurrency suite was warning-free
  and the new suites were not.
- Applied minors: implement recurring on the existing guarded `/api/sessions/generate` stub
  rather than a new `/recurring` path (no orphaned stub); `updateSession` locks _exactly_ the
  instructors it re-checks; the idempotency-dedup wording corrected (the application overlap
  check is the dedup, not the exclusion constraints).

## Phase 9 — secure CSV attendance export (Goal 7, second half)

### Prompt

> PHASE 9 — PRODUCTION-GRADE SECURE CSV EXPORT / REPORTING. Implement ONLY the CSV export. Treat it
> as a SECURITY-SENSITIVE DATA EXFILTRATION BOUNDARY — a CSV endpoint must not become an
> authorization bypass. Determine the EXACT requirement from the assignment; do not invent fields.
> Scope the dataset BEFORE filtering/serialization; reuse existing authorization. Handle CSV
> injection (= + - @), RFC-4180 escaping (comma/quote/newline), Unicode, a deterministic header +
> column order, a safe filename, bounded size, no N+1. Do NOT build the dashboard, alerts, or
> deployment. Feature branch → PR → CI → merge. Stop after Phase 9.

### What came back

The audit pinned the exact requirement to Goal 7's one sentence: "export a session's attendance —
every booking with its member and final status — as a CSV file." So a single staff-only per-session
export (Decision 17), one row per booking, columns = member + final status — NOT a general bookings
CSV and not invented fields. Designed as a contract, run through a 3-lens adversarial panel
(exfiltration / CSV-correctness / assignment-fidelity, with verification), implemented, then
diff-reviewed. Delivered an internal RFC-4180 serializer with an OWASP formula-injection guard and a
UTF-8 BOM, a scope-before-serialize export domain, and 32 tests (374 total).

### What was wrong, and what was done about it

- **The panel's one "major" was refuted — the doc lagged the code.** Two lenses flagged that the
  design doc's "missing session → 404" was unreachable via the flow it wrote (a bare
  `booking.findMany` would 200-empty a nonexistent session). The verifier refuted it: the actual
  implementation already does a `classSession.findUnique` existence check before the booking query,
  so a missing session 404s. The doc was under-specified; the code was correct. Tightened the doc.
- **The CSV-injection guard was hardened for the leading-whitespace vector.** A first cut prefixed
  the apostrophe only when the FIRST character was a formula trigger; but Excel trims leading
  spaces/tabs before evaluating, so ` =cmd` would still execute. The guard now neutralizes a trigger
  that follows optional leading spaces/tabs (and a leading control char) — unit-tested with ` =1+1`
  and `\t=cmd`.
- **A BOM test failed for the right reason.** Asserting the BOM via `res.text()` failed because the
  Fetch `Response.text()` decodes UTF-8 with `ignoreBOM:false` and strips the leading BOM; the test
  now asserts the raw bytes (EF BB BF) from `arrayBuffer()`. A good reminder that the platform, not
  a bug, was eating the BOM — caught by running the real HTTP path.
- Applied minors: `X-Content-Type-Options: nosniff` on the download (the body carries member text);
  the filename proven to be built only from a server-derived date + the validated uuid (no
  user-controlled byte reaches Content-Disposition). Kept with rationale (both confirmed as
  boundary-crossing-free by the panel): Member Email (staff-only; staff already have full
  member-email access) and canonical status tokens (consistent with the JSON API).

## Phase 10 — operational dashboard (Goal 8)

### Prompt

> PHASE 10 — PRODUCTION-GRADE OPERATIONAL DASHBOARD. Implement ONLY Goal 8. Read the assignment;
> extract the EXACT Goal 8 requirements; build a requirement→data→authorization→aggregation→UI→test
> matrix. Authorization applied BEFORE aggregation; never fetch global data then hide it; aggregate
> in the DB, not React. Reuse policy.ts/scope.ts/guards.ts. Determine staff vs instructor access
> from the assignment. Define each metric (source, states, scope, date boundary, timezone, empty,
> zero-denominator). Reuse studio-timezone + half-open date semantics. No speculative index/cache/
> realtime. Accessible, responsive, minimal client JS. Non-vacuous tests with an independent oracle.
> Feature branch → PR → CI → merge. Stop after Phase 10.

### What came back

The exact requirement is Goal 8's three sentences (sessions today / bookings made today / no-shows
this week / members currently waitlisted; bookings by status and by class; attendance per week over
the last eight weeks). Determined STAFF-ONLY studio-wide (decisions.md #17 + the /api/dashboard stub)
and NO parameters (a fixed landing view). Designed a metric matrix, ran a 3-lens adversarial panel,
implemented `getDashboard` (seven concurrent DB aggregations) + `GET /api/dashboard` + the staff
landing page + accessible view, and added 17 tests (393 total).

### What was wrong, and what was done about it

- **The design panel found a real blocker and a real major before implementation.** BLOCKER: the
  three raw `$queryRaw` counts return Postgres `bigint`, which @prisma/adapter-pg surfaces as JS
  `BigInt` — so `Response.json`/`JSON.stringify` throws on EVERY call (empty DB included, since
  `count(distinct)` returns `0n`), and the by-status/by-class consistency check compares
  `number === bigint` and fails. Fixed with `::int` casts on every raw count. MAJOR: the
  `width_bucket` per-week query, run unbounded, buckets every ATTENDED booking older than 8 weeks
  into bucket 0 and scans all history; fixed with `WHERE starts_at >= w[0] AND < w[8]` (only buckets
  1..8, index-bounded) and a `bucket → weeks[bucket-1]` map. Both were caught on the design, not in
  production.
- **A definition was sharpened.** "members currently waitlisted" now filters to UPCOMING sessions
  (`starts_at >= now`), because Decision 24 guarantees a member waitlisted onto a passed session
  keeps a dangling WAITLISTED row — counting those would inflate "currently waitlisted" with members
  who are no longer waiting. Documented with the alternative.
- **A rendering bug surfaced only by running the production build.** The first cut made `/` a Server
  Component that server-renders the dashboard — but Next 16 statically prerendered and cached it
  (`s-maxage=31536000`, identical for every cookie), because a Server Component that calls
  `redirect()` at build (no cookies → non-staff → redirect) is captured as a static redirect, which
  `force-dynamic`, `await connection()`, and a direct `await cookies()` all failed to prevent
  (verified against `next start`). Switched `/` to the same client-page + API pattern every other
  page uses — a data-free static shell that fetches `GET /api/dashboard` per request — with the
  authorization unchanged and server-side (the route's capability guard). A reminder that "prefer
  server components" meets framework reality, and that only a real build/runtime check caught it.
- **Determinism + a11y minors applied:** a `class_id` final tiebreaker for by-class (Class.title is
  not unique); a request-cached `currentUser()` for the layout's session lookup; the decorative chart
  marked `aria-hidden` with the data table as the accessible source; an "as of <studio-local>"
  caption and an explicit all-zero-chart note; and the UI bar-scaling guarded so an all-zero chart
  never yields NaN. EXPLAIN ANALYZE (real, ~1500 bookings, <1 ms) confirmed no new index is warranted.

## Phase 11 — membership expiry alerts (Goal 10)

### Prompt

> PHASE 11 — PRODUCTION-GRADE MEMBERSHIP EXPIRY ALERTS. Implement ONLY Goal 10. Read the assignment;
> extract the exact requirement. PRESERVE the existing membership_alert_dismissals design (dismissal
> keyed to the dismissed expiry value — extension re-eligibilises). Determine exact alert semantics
> (who, threshold, inclusive?, expired?, timezone, lifecycle, dismissal, idempotency, concurrency).
> Dynamic vs persisted; no unnecessary background job. Reuse the studio-timezone date-only semantics.
> Staff-only server-side; IDOR/mass-assignment/param-pollution/SQLi safe. Accessible, responsive.
> Non-vacuous tests with an independent oracle. Feature branch → PR → CI → merge. Stop after Phase 11.

### What came back

The exact requirement is Goal 10's sentence (expired-or-within-7-days members in an alerts area + a
nav count badge; staff dismiss; extend-then-eligible reappears). Confirmed the Phase-2 schema
(Decision 11: expiry-keyed unique dismissal) is exactly sufficient — dynamic computation, no new
table, no migration, no background job. Designed a metric matrix, ran a 3-lens adversarial panel,
implemented `listMembershipAlerts`/`dismissMembershipAlert` + the two routes + the client UI, and
added 14 tests (407 total).

### What was wrong, and what was done about it

- **The design panel caught a real MAJOR before implementation shipped.** The dismiss recorded a
  dismissal for the member's CURRENT expiry unconditionally. A concrete, malice-free race — staff A's
  /alerts page renders a member; staff B extends that member to a far-future date (design accepts the
  stale page); staff A clicks Dismiss → the server records a dismissal for the far-future value — then
  ~a year later, when that value enters the 7-day window, the GET's `NOT EXISTS` on `(member, value)`
  excludes it and the alert NEVER returns, violating Goal 10. Fixed by making the dismiss a graceful
  no-op unless the member's current expiry is within the window, preserving Decision 11's invariant
  that a dismissal row only ever exists for an actually-alerted value. A test pins it (dismiss a
  far-future member → nothing recorded → it still alerts when shortened into the window).
- **An instructor visiting /alerts crashed** (the staff-only AlertsProvider was absent, so
  `useAlerts()` threw). Made the hook null-safe and the page redirect a provider-less visitor to
  /sessions — matching the dashboard's non-staff behaviour. The DATA is protected server-side by the
  API regardless.
- **Confirmed correct (not changed):** the today+7-INCLUSIVE eligibility (the standard "within N
  days" reading, avoiding the gap where an expiring-today member shows in no alert — pinned by
  boundary tests today-1/today/today+6/today+7/today+8); the urgency copy is pluralised ("1 day" not
  "1 days"); each dismiss button has a distinct accessible name. EXPLAIN ANALYZE (~1.2 ms at 2000
  members) confirmed no new index is warranted.
