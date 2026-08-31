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
