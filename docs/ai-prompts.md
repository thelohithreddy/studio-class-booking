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
