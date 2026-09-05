import Link from 'next/link'

import { currentUser } from '@/server/auth/current-user'
import { demoLoginEnabled } from '@/server/auth/demo'
import { DemoEntry } from './_components/landing/demo-entry'
import {
  IconBookings,
  IconChart,
  IconClasses,
  IconMembers,
  IconSessions,
} from './_components/icons'

/**
 * Public product landing at `/` — the evaluator's entry point. Everything here
 * is anonymous-safe: the authenticated studio app lives under the (app) group
 * (still redirect-protected), and this page only links into it. It describes
 * exactly what is implemented, tailors its call-to-action to whether the visitor
 * is already signed in, and (on a demo deployment) offers one-click role entry.
 */

function Logo({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      aria-hidden="true"
    >
      <path d="M6 15V9M10 18V6M14 16V8M18 13v-2" strokeLinecap="round" />
    </svg>
  )
}

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-fg shadow-sm">
        <Logo />
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.05rem] text-fg">Cadence</span>
        <span className="eyebrow mt-px">Studio Operations</span>
      </span>
    </span>
  )
}

const CAPABILITIES: {
  icon: (p: { className?: string }) => React.ReactElement
  title: string
  body: string
}[] = [
  {
    icon: IconClasses,
    title: 'Class catalogue & scheduling',
    body: 'Define classes with default duration and capacity, then schedule sessions into rooms — with room and instructor double-booking prevented at the database.',
  },
  {
    icon: IconBookings,
    title: 'Bookings, capacity & waitlist',
    body: 'Book members up to capacity; the rest join a FIFO waitlist. Cancelling a seat promotes the next waitlisted member automatically and atomically.',
  },
  {
    icon: IconSessions,
    title: 'Attendance & audit timeline',
    body: 'Mark attended or no-show once a session starts. Every booking keeps an immutable, append-only event history you can read end to end.',
  },
  {
    icon: IconMembers,
    title: 'Members & memberships',
    body: 'Manage members and expiry dates. Expired memberships are blocked from new bookings, and staff get alerts for memberships lapsing within seven days.',
  },
  {
    icon: IconSessions,
    title: 'Instructors & recurring series',
    body: 'Assign a primary instructor and co-instructors, and generate a recurring weekly series in one step — conflicts are reported, not silently dropped.',
  },
  {
    icon: IconChart,
    title: 'Operations dashboard & search',
    body: 'A studio-wide dashboard of the day and week, plus server-side search, filtering, sorting and pagination across bookings and sessions.',
  },
]

const STAFF_CAN = [
  'Manage classes, sessions, rooms and members',
  'Create and cancel bookings; the waitlist promotes automatically',
  'Record attendance and export a session roster as CSV',
  'Generate recurring sessions and manage co-instructors',
  'See the studio dashboard and membership-expiry alerts',
]
const INSTRUCTOR_CAN = [
  'See only the sessions they teach (primary or co-instructor)',
  'View each session’s roster for their own classes',
  'Record attendance — attended or no-show — for those sessions',
  'Never see or manage other instructors’ sessions or bookings',
  'No access to class, member, room or studio-wide management',
]

const WORKFLOW = ['Classes', 'Sessions', 'Bookings', 'Attendance', 'Reporting']

const GUARANTEES: { title: string; body: string }[] = [
  {
    title: 'Server-enforced authorization',
    body: 'A single capability table gates every action server-side; instructors are scoped to their own sessions, and out-of-scope IDs return 404, never a leak.',
  },
  {
    title: 'Concurrency-safe booking',
    body: 'Each booking runs in one transaction under a per-session row lock, backed by database capacity and one-active-booking constraints — no overbooking under load.',
  },
  {
    title: 'Immutable booking history',
    body: 'The event timeline is append-only, enforced by database triggers: bookings are cancelled, never deleted, and history can’t be rewritten.',
  },
  {
    title: 'Secure sessions & TLS',
    body: 'Opaque, database-backed sessions in HttpOnly cookies (Argon2id passwords), an origin-checked CSRF guard, and certificate-verified database TLS in production.',
  },
]

export default async function LandingPage() {
  const user = await currentUser()
  const demo = demoLoginEnabled()
  const appHref = user ? (user.role === 'STAFF' ? '/dashboard' : '/sessions') : '/login'
  const primaryLabel = user ? 'Open the app' : 'Sign in'

  return (
    <div className="min-h-screen bg-canvas text-fg">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3.5 sm:px-6">
          <Link
            href="/"
            className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label="Cadence — home"
          >
            <Wordmark />
          </Link>
          <nav className="ml-auto hidden items-center gap-6 md:flex" aria-label="Sections">
            <a href="#capabilities" className="text-sm text-muted transition-colors hover:text-fg">
              Capabilities
            </a>
            <a href="#roles" className="text-sm text-muted transition-colors hover:text-fg">
              Roles
            </a>
            <a href="#workflow" className="text-sm text-muted transition-colors hover:text-fg">
              Workflow
            </a>
          </nav>
          <Link
            href={appHref}
            className="ml-auto inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:ml-0"
          >
            {primaryLabel}
          </Link>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-14 pt-16 sm:px-6 sm:pt-20">
          <div className="max-w-2xl">
            <p className="eyebrow">Studio operations platform</p>
            <h1 className="font-display mt-4 text-[2.4rem] leading-[1.1] tracking-tight text-fg sm:text-[3.1rem]">
              Run your studio’s schedule, bookings, and waitlist with confidence.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              Cadence is the operations back office for a class-based studio — classes and sessions,
              member bookings with an automatic waitlist, attendance, and a live dashboard, with
              staff and instructor roles kept cleanly apart.
            </p>

            <div className="mt-8 flex flex-col gap-6">
              {demo ? (
                <DemoEntry />
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link
                    href={appHref}
                    className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-5 text-sm font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {primaryLabel}
                  </Link>
                  <a
                    href="#capabilities"
                    className="inline-flex h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-5 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    See what it does
                  </a>
                </div>
              )}
              {!user ? (
                <p className="text-sm text-subtle">
                  Already have an account?{' '}
                  <Link
                    href="/login"
                    className="font-medium text-brand-subtle-fg underline-offset-2 hover:underline"
                  >
                    Sign in
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section
          id="capabilities"
          aria-labelledby="capabilities-h"
          className="border-t border-line bg-surface"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <p className="eyebrow">What it does</p>
            <h2
              id="capabilities-h"
              className="font-display mt-3 text-[1.75rem] tracking-tight text-fg"
            >
              Everything a front desk needs, nothing it doesn’t.
            </h2>
            <div className="mt-9 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex flex-col gap-3 bg-surface p-6">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-brand-subtle text-brand-subtle-fg">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="text-[0.95rem] font-semibold text-fg">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Roles */}
        <section id="roles" aria-labelledby="roles-h" className="border-t border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <p className="eyebrow">Two roles, cleanly separated</p>
            <h2 id="roles-h" className="font-display mt-3 text-[1.75rem] tracking-tight text-fg">
              Staff run the studio. Instructors see only their own.
            </h2>
            <div className="mt-9 grid gap-5 lg:grid-cols-2">
              <RoleCard title="Studio staff" tone="brand" items={STAFF_CAN} />
              <RoleCard title="Instructor" tone="neutral" items={INSTRUCTOR_CAN} />
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section
          id="workflow"
          aria-labelledby="workflow-h"
          className="border-t border-line bg-surface"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <p className="eyebrow">The operating loop</p>
            <h2 id="workflow-h" className="font-display mt-3 text-[1.75rem] tracking-tight text-fg">
              From a class on the books to attendance on the record.
            </h2>
            <ol className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-0">
              {WORKFLOW.map((step, i) => (
                <li key={step} className="flex flex-1 items-center gap-3">
                  <div className="flex flex-1 items-center gap-3 rounded-xl border border-line bg-canvas px-4 py-3">
                    <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-fg">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-fg">{step}</span>
                  </div>
                  {i < WORKFLOW.length - 1 ? (
                    <span aria-hidden="true" className="px-1 text-subtle sm:px-2">
                      →
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Trust / engineering */}
        <section aria-labelledby="trust-h" className="border-t border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <p className="eyebrow">Built to be correct</p>
            <h2 id="trust-h" className="font-display mt-3 text-[1.75rem] tracking-tight text-fg">
              The guarantees behind the front desk.
            </h2>
            <div className="mt-9 grid gap-5 sm:grid-cols-2">
              {GUARANTEES.map(({ title, body }) => (
                <div key={title} className="rounded-2xl border border-line bg-surface p-6">
                  <h3 className="text-[0.95rem] font-semibold text-fg">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section aria-labelledby="cta-h" className="border-t border-line bg-surface-2">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6">
            <h2 id="cta-h" className="font-display text-[1.9rem] tracking-tight text-fg">
              Step into the studio.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-muted">
              {demo
                ? 'Try both sides of the product — no account required.'
                : 'Sign in to pick up where the studio left off.'}
            </p>
            <div className="mt-7 flex justify-center">
              {demo ? (
                <DemoEntry />
              ) : (
                <Link
                  href={appHref}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {primaryLabel}
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-fg">
              <Logo className="size-4" />
            </span>
            <span className="text-sm text-muted">
              <span className="font-display text-fg">Cadence</span> — studio operations, simplified.
            </span>
          </div>
          <a
            href="https://github.com/thelohithreddy/studio-class-booking"
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-muted underline-offset-2 hover:text-fg hover:underline sm:ml-auto"
          >
            Source & documentation
          </a>
        </div>
      </footer>
    </div>
  )
}

function RoleCard({
  title,
  tone,
  items,
}: {
  title: string
  tone: 'brand' | 'neutral'
  items: string[]
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-7">
      <div className="flex items-center gap-2.5">
        <span
          className={
            tone === 'brand'
              ? 'inline-flex items-center rounded-full bg-brand-subtle px-2.5 py-0.5 text-xs font-semibold text-brand-subtle-fg'
              : 'tone-neutral inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold'
          }
        >
          {title}
        </span>
      </div>
      <ul className="mt-5 flex flex-col gap-3">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm text-muted">
            <svg
              viewBox="0 0 20 20"
              className="mt-0.5 size-4 shrink-0 text-[var(--tone-success)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
            >
              <path d="M4 10.5l3.5 3.5L16 5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
