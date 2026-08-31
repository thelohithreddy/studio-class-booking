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
