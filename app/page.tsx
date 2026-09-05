import Link from 'next/link'

import { currentUser } from '@/server/auth/current-user'
import { demoLoginEnabled } from '@/server/auth/demo'
import { DemoEntry } from './_components/landing/demo-entry'
import { ProductPreview } from './_components/landing/product-preview'
import { BookingStory } from './_components/landing/booking-story'
import {
  IconBookings,
  IconChart,
  IconClasses,
  IconMembers,
  IconCheck,
  IconSessions,
} from './_components/icons'

/**
 * Public product landing at `/` — the evaluator's entry point. Anonymous-safe:
 * the authenticated studio app lives under the (app) group (still
 * redirect-protected) and this page only links into it. It tailors its CTA to
 * whether the visitor is signed in and, on a demo deployment, offers one-click
 * role entry. Everything shown is implemented functionality.
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
        <span className="eyebrow mt-px text-muted">Studio Operations</span>
      </span>
    </span>
  )
}

const STAFF_CAN = [
  'Classes, sessions, rooms & members',
  'Create & cancel bookings',
  'Record attendance & export CSV',
  'Recurring series & co-instructors',
  'Studio dashboard & membership alerts',
]
const INSTRUCTOR_CAN = [
  'Only the sessions they teach',
  'Their own session rosters',
  'Record attendance for those sessions',
]
const INSTRUCTOR_CANNOT = [
  'Classes, members & rooms',
  'Bookings, cancels & CSV',
  'The studio dashboard',
]

const WORKFLOW: {
  icon: (p: { className?: string }) => React.ReactElement
  label: string
  detail: string
}[] = [
  { icon: IconClasses, label: 'Classes', detail: 'Define the catalogue' },
  { icon: IconSessions, label: 'Sessions', detail: 'Schedule into rooms' },
  { icon: IconBookings, label: 'Bookings', detail: 'Members & waitlist' },
  { icon: IconCheck, label: 'Attendance', detail: 'Who showed up' },
  { icon: IconChart, label: 'Reporting', detail: 'Dashboard & CSV' },
]

const GUARANTEES: { title: string; body: string }[] = [
  {
    title: 'Server-enforced authorization',
    body: 'One capability table gates every action; instructors are scoped to their own sessions.',
  },
  {
    title: 'Concurrency-safe booking',
    body: 'A per-session lock plus DB constraints — no overbooking, even under a rush on the last seat.',
  },
  {
    title: 'Immutable history',
    body: 'The booking timeline is append-only, enforced by database triggers.',
  },
  {
    title: 'Secure sessions & TLS',
    body: 'Opaque DB-backed sessions, Argon2id, origin-checked CSRF, certificate-verified database TLS.',
  },
]

export default async function LandingPage() {
  const user = await currentUser()
  const demo = demoLoginEnabled()
  const appHref = user ? (user.role === 'STAFF' ? '/dashboard' : '/sessions') : '/login'

  return (
    <div className="min-h-screen bg-canvas text-fg">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3.5 sm:px-6">
          <Link
            href="/"
            aria-label="Cadence — home"
            className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Wordmark />
          </Link>
          <nav className="ml-auto hidden items-center gap-7 md:flex" aria-label="Sections">
            <a href="#product" className="text-sm text-muted transition-colors hover:text-fg">
              Product
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
            {user ? 'Open the app' : 'Sign in'}
          </Link>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="border-b border-line">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-20">
            <div className="max-w-xl">
              <p className="eyebrow text-muted">Studio operations platform</p>
              <h1 className="font-display mt-4 text-[2.5rem] leading-[1.05] tracking-tight text-fg sm:text-[3.25rem]">
                The operating system for a busy studio.
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-muted">
                Cadence runs the front desk end to end — schedule classes and sessions, book members
                with an automatic waitlist, record attendance, and watch the numbers move on a live
                dashboard. Staff and instructors, cleanly separated.
              </p>

              <div className="mt-8">
                {user ? (
                  <Link
                    href={appHref}
                    className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Open the app
                  </Link>
                ) : demo ? (
                  <div className="flex flex-col gap-4">
                    <DemoEntry />
                    <p className="text-sm text-muted">
                      Already have an account?{' '}
                      <Link
                        href="/login"
                        className="font-medium text-brand-subtle-fg underline-offset-2 hover:underline"
                      >
                        Sign in
                      </Link>
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Link
                        href="/login"
                        className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        Sign in
                      </Link>
                      <a
                        href="#product"
                        className="inline-flex h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-6 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        See it in action
                      </a>
                    </div>
                    <p className="text-sm text-muted">
                      No public sign-up — accounts are studio-provisioned. Evaluating? Demo access
                      can be enabled, or use the credentials in{' '}
                      <a
                        href="https://github.com/thelohithreddy/studio-class-booking/blob/main/SUBMISSION.md"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium text-brand-subtle-fg underline-offset-2 hover:underline"
                      >
                        SUBMISSION.md
                      </a>
                      .
                    </p>
                  </div>
                )}
              </div>

              <ul className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
                {['Concurrency-safe booking', 'Immutable history', 'Server-side authorization'].map(
                  (t) => (
                    <li key={t} className="inline-flex items-center gap-1.5">
                      <Check className="size-3.5 text-[var(--tone-success)]" />
                      {t}
                    </li>
                  ),
                )}
              </ul>
            </div>

            <div className="lg:pl-4" id="product">
              <ProductPreview />
            </div>
          </div>
        </section>

        {/* Booking / waitlist story */}
        <section aria-labelledby="story-h" className="border-b border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <div className="max-w-2xl">
              <p className="eyebrow text-muted">The hard part, handled</p>
              <h2 id="story-h" className="font-display mt-3 text-[1.9rem] tracking-tight text-fg">
                A freed seat never sits empty.
              </h2>
              <p className="mt-3 text-muted">
                Capacity, waitlist, and promotion are one atomic, concurrency-safe transaction — no
                double-booking, no seat left unfilled when someone cancels.
              </p>
            </div>
            <div className="mt-9">
              <BookingStory />
            </div>
          </div>
        </section>

        {/* Roles + security boundary */}
        <section id="roles" aria-labelledby="roles-h" className="border-b border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <div className="max-w-2xl">
              <p className="eyebrow text-muted">Two roles</p>
              <h2 id="roles-h" className="font-display mt-3 text-[1.9rem] tracking-tight text-fg">
                Staff run the studio. Instructors see only their own.
              </h2>
            </div>
            <div className="mt-9 grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-line bg-canvas p-7">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-fg">
                    <IconMembers className="size-4" />
                  </span>
                  <h3 className="text-[0.95rem] font-semibold text-fg">Studio staff</h3>
                  <span className="ml-auto inline-flex items-center rounded-full bg-brand-subtle px-2.5 py-0.5 text-[0.65rem] font-semibold text-brand-subtle-fg">
                    Full access
                  </span>
                </div>
                <ul className="mt-5 flex flex-col gap-2.5">
                  {STAFF_CAN.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted">
                      <Check className="mt-0.5 size-4 shrink-0 text-[var(--tone-success)]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-line bg-canvas p-7">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-muted">
                    <IconSessions className="size-4" />
                  </span>
                  <h3 className="text-[0.95rem] font-semibold text-fg">Instructor</h3>
                  <span className="ml-auto inline-flex items-center rounded-full border border-line-strong px-2.5 py-0.5 text-[0.65rem] font-semibold text-muted">
                    Scoped
                  </span>
                </div>
                <ul className="mt-5 flex flex-col gap-2.5">
                  {INSTRUCTOR_CAN.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted">
                      <Check className="mt-0.5 size-4 shrink-0 text-[var(--tone-success)]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 border-t border-line pt-4">
                  <p className="eyebrow mb-2.5 text-muted">Enforced server-side — never sees</p>
                  <ul className="flex flex-col gap-2">
                    {INSTRUCTOR_CANNOT.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2.5 text-[0.8125rem] text-muted"
                      >
                        <Lock className="mt-0.5 size-3.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section id="workflow" aria-labelledby="workflow-h" className="border-b border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <div className="max-w-2xl">
              <p className="eyebrow text-muted">The operating loop</p>
              <h2
                id="workflow-h"
                className="font-display mt-3 text-[1.9rem] tracking-tight text-fg"
              >
                From a class on the books to attendance on the record.
              </h2>
            </div>
            <ol className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-2">
              {WORKFLOW.map((step, i) => (
                <li key={step.label} className="relative">
                  <div className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-subtle text-brand-subtle-fg">
                        <step.icon className="size-4" />
                      </span>
                      <span className="tabular text-xs font-semibold text-muted">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <div>
                      <p className="text-[0.9rem] font-semibold text-fg">{step.label}</p>
                      <p className="mt-0.5 text-[0.8125rem] text-muted">{step.detail}</p>
                    </div>
                  </div>
                  {i < WORKFLOW.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-1/2 -right-2 z-10 hidden -translate-y-1/2 text-muted lg:block"
                    >
                      →
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Engineering trust */}
        <section aria-labelledby="trust-h" className="border-b border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="eyebrow text-muted">Built to be correct</p>
                <h2 id="trust-h" className="font-display mt-3 text-[1.9rem] tracking-tight text-fg">
                  The guarantees behind the front desk.
                </h2>
              </div>
              <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
                {GUARANTEES.map(({ title, body }) => (
                  <div key={title}>
                    <dt className="flex items-center gap-2 text-[0.9rem] font-semibold text-fg">
                      <Check className="size-4 text-[var(--tone-success)]" />
                      {title}
                    </dt>
                    <dd className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">{body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section aria-labelledby="cta-h" className="bg-surface-2">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 text-center sm:px-6">
            <h2 id="cta-h" className="font-display text-[2.1rem] tracking-tight text-fg">
              See Cadence in action.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-muted">
              {user
                ? 'Pick up where the studio left off.'
                : demo
                  ? 'Step into the product as either role — no account required.'
                  : 'Sign in to step into the studio.'}
            </p>
            <div className="mt-8 flex flex-col items-center gap-4">
              {user ? (
                <Link
                  href={appHref}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Open the app
                </Link>
              ) : demo ? (
                <>
                  <DemoEntry />
                  <p className="text-sm text-muted">
                    Already have an account?{' '}
                    <Link
                      href="/login"
                      className="font-medium text-brand-subtle-fg hover:underline"
                    >
                      Sign in
                    </Link>
                  </p>
                </>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-6 text-sm font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Sign in
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
            Source &amp; documentation
          </a>
        </div>
      </footer>
    </div>
  )
}

function Check({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path d="M4 10.5l3.5 3.5L16 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Lock({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" strokeLinecap="round" />
    </svg>
  )
}
