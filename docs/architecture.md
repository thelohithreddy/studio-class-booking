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
- RBAC/resource authorization — Phase 4+, consuming `SessionUser.role` per route.
- Distributed rate limiting, refresh tokens, "remember me", password reset, MFA, admin
  session-revocation UI: each is real product surface with no goal behind it in the brief.
- A second service, an event bus, Redis: nothing here has the fan-out to justify them.
