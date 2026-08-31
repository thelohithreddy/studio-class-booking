# Plan

Maintained as the work happens, one section per phase. The retrospective questions at the bottom
get their final answers at submission time; estimates and actuals are recorded per phase as each
one closes.

## Phases

The ten goals cluster naturally: everything depends on the schema, the booking lifecycle is the
riskiest single piece, and the dashboard/exports read whatever the earlier phases wrote. So the
order is infrastructure → data model → auth → lifecycle → the read-heavy features → polish.

| #   | Phase                                                                      | Covers goals           | Estimate | Actual |
| --- | -------------------------------------------------------------------------- | ---------------------- | -------- | ------ |
| 1   | Scaffold: toolchain, CI, health endpoint, local Postgres                   | —                      | 1h       | ~1.5h  |
| 2   | Schema + migrations + seed skeleton, integration-test harness              | 2, 3 (data), 9 (shape) | 2h       |        |
| 3   | Auth: sessions, roles, server-side enforcement                             | 1                      | 1.5h     |        |
| 4   | Booking lifecycle: book/waitlist/cancel/promote/settle, immutable timeline | 4, 9                   | 2.5h     |        |
| 5   | Classes, sessions, co-instructors UI + instructor visibility               | 2, 3, 5                | 1.5h     |        |
| 6   | Bookings list (server search/filter/sort/pagination)                       | 6                      | 1.5h     |        |
| 7   | Recurring generation + CSV export + seed data                              | 7                      | 1.5h     |        |
| 8   | Dashboard + membership alerts                                              | 8, 10                  | 1.5h     |        |
| 9   | Deploy, demo data, SUBMISSION.md                                           | —                      | 1h       |        |

Sum of estimates is ~14h against a 12h budget, which is the honest way round: phases 5–8 each have
an obvious "smaller but still correct" version to fall back to, the lifecycle in phase 4 does not.

## Phase log

### Phase 1 — scaffold (done)

Estimated 1h, took ~1.5h. The overrun was version archaeology, not construction: the initially
pinned TypeScript 7 and ESLint 10 turned out to be unusable together with the rest of the toolchain
(see decisions 2 and 3 in docs/decisions.md), and Prisma 7 moved connection URLs out of the schema
file entirely. Delivered: pnpm + strict TS + ESLint/Prettier/Vitest wiring, Next app shell with a
`/api/health` liveness probe, boot-time env validation, Prisma 7 datasource + CLI config, dockerised
local Postgres, and a CI workflow running format/lint/typecheck/test/build.

## Retrospective (filled at submission)

- What order did you build in, and why that order? — see table above; final commentary at the end.
- What did you estimate versus what it actually took? — running in the table.
- What did you cut when you ran short? — recorded when it happens.
