# Submission — Cadence (Studio Operations)

## Links

- **GitHub repository:** https://github.com/thelohithreddy/studio-class-booking
- **Live application:** https://studio-class-booking.onrender.com

## Notes for the reviewer

- The host is Render's free tier, which **sleeps when idle** — the very first request after a quiet
  period can take up to ~1 minute to wake. A slow first load is the container starting, not a broken
  deployment.
- Open the live URL and you land on a **public product page**, not a login wall. From there, one click
  puts you inside the product as either role — **no credentials to copy**.

## How to evaluate (both roles, no credentials)

On the home page, use the demo entry:

- **“Explore as staff”** → signs you in as a studio-staff account and opens the operations dashboard.
- **“Explore as instructor”** → signs you in as an instructor and opens their scoped “My sessions”.

Each button signs you into a pre-seeded sample account server-side; **no password is ever shown or
required**. Sign out (top-left of the sidebar / user menu) to switch roles. The underlying demo
accounts are `staff@studio.test` (staff) and `ivy@studio.test` (instructor) if you prefer the normal
Sign-in form.

## Recommended evaluation journey

**As staff (the full studio):**

1. **Dashboard** — today’s sessions, bookings made today, no-shows this week, members waitlisted,
   plus an 8-week attendance chart and membership alerts.
2. **Classes** — create/edit a class; archive and restore it (archived classes can’t take new
   sessions).
3. **Sessions** — schedule a session (room/instructor conflicts are refused); add a co-instructor;
   generate a **recurring** weekly series and see which occurrences were created vs skipped.
4. **Bookings** — book members onto a session; fill it past capacity to see the **waitlist**; cancel
   a booked seat and watch the earliest waitlisted member **promote automatically**. Try booking an
   expired member (blocked) and the same member twice (blocked).
5. **Attendance** — after a session’s start time, mark **attended / no-show**; open a booking to read
   its **immutable event timeline**; export the roster as **CSV**.
6. **Members & alerts** — edit a membership expiry; dismiss a membership alert and confirm it stays
   dismissed until the date changes.
7. **Search** — filter/sort/paginate bookings and sessions (all server-side).

**As instructor (scoped):**

1. See **only** the sessions you teach (primary or co-instructor).
2. Open one of your sessions and **record attendance**.
3. Confirm you **cannot** reach the dashboard, other instructors’ sessions, members, rooms, classes,
   booking creation/cancellation, CSV export, or co-instructor management — the UI hides them and the
   API returns 403/404.

## Stack

| Layer    | What I used                                      | Why                                                                                          |
| -------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Frontend | Next.js 16 (App Router, RSC) + Tailwind v4       | One full-stack app; server components for auth-aware rendering.                              |
| Backend  | Next.js route handlers + Prisma 7 (`adapter-pg`) | Same deployable serves UI and API; typed data access.                                        |
| Database | PostgreSQL (Supabase), verify-full TLS           | GiST exclusion + partial-unique constraints and append-only triggers enforce the invariants. |
| Hosting  | Render (single web service)                      | Long-running Node; same-origin API keeps the `__Host-` cookie + CSRF model intact.           |

## Goal checklist

| #   | Goal                                           | Status | Notes                                                                                                                       |
| --- | ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Accounts & roles (staff/instructor)            | Done   | DB-backed opaque sessions, Argon2id, server-side RBAC; instructors record attendance on their own sessions.                 |
| 2   | Classes (create/edit/archive/restore)          | Done   | Archive is non-destructive; archived classes can’t take new sessions.                                                       |
| 3   | Sessions & scheduling                          | Done   | Room + primary-instructor overlap prevented by DB exclusion constraints; co-instructor overlap by the service under a lock. |
| 4   | Bookings, capacity, membership, waitlist       | Done   | Concurrency-safe under a per-session lock; expired/duplicate bookings refused; waitlist promotion on cancel.                |
| 5   | Instructor view (own sessions)                 | Done   | Scoped queries; out-of-scope IDs return 404 (no existence leak).                                                            |
| 6   | Finding bookings (search/filter/sort/paginate) | Done   | All server-side; scope applied before filtering and counting.                                                               |
| 7   | Attendance CSV + recurring generation          | Done   | CSV is staff-only, RFC-4180 + formula-injection-safe; recurring is partial-with-report.                                     |
| 8   | Studio dashboard                               | Done   | Bounded aggregations; staff-only.                                                                                           |
| 9   | Booking history / audit timeline               | Done   | Append-only `booking_events`, immutable by DB triggers.                                                                     |
| 10  | Membership alerts                              | Done   | Derived (expired or within 7 days), dismissable, re-appears when the expiry date changes.                                   |

## Engineering highlights

- **Concurrency-safe booking** proven by tests that fire real concurrent requests against Postgres
  (40 concurrent bookings on a 10-seat session → exactly 10 booked / 30 waitlisted; one promotion per
  freed seat).
- **Authorization travels into the query** (`bookingScopeWhere`/`sessionScopeWhere`), so counts and
  lists can’t leak out-of-scope rows and out-of-scope IDs are indistinguishable from missing ones.
- **Invariants in the database, not just the app:** capacity CHECK, GiST exclusion constraints,
  partial-unique active booking, and append-only history triggers.
- **Production TLS is enforced in code** (certificate-verified, immune to a URL `sslmode` downgrade),
  with a readiness probe and a bounded pool.
- **480+ tests** across unit, integration (real Postgres) and component layers; CI runs the full gate.

Architecture, decisions, schema and the prompt log are in [`docs/`](docs/).

## Reflection

_How much time did you actually spend?_ <!-- to complete -->

_What would you do next, with another 12 hours?_ <!-- to complete -->

_What are you least happy with in this codebase, and why?_ <!-- to complete -->
