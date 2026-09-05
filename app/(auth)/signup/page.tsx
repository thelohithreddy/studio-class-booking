import Link from 'next/link'
import { redirect } from 'next/navigation'

import { currentUser } from '@/server/auth/current-user'
import { demoLoginEnabled } from '@/server/auth/demo'
import { DemoEntry } from '@app/_components/landing/demo-entry'

/**
 * Account-access page (controlled onboarding). Cadence has exactly two login
 * roles — studio STAFF and INSTRUCTOR — and both carry real scheduling and
 * member access, so accounts are provisioned by studio administration rather
 * than self-served. There is deliberately no public sign-up endpoint: a public
 * form could only ever create a privileged account, which would be a security
 * regression. This page makes that model explicit and hands the visitor the
 * paths that actually work — evaluate via the demo, or sign in with a
 * provisioned account. No form, no data collection, never a dead end. Server
 * component so it reflects the live demo flag.
 */
export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  // An already-signed-in visitor (e.g. swiping Back) goes straight to the app.
  const user = await currentUser()
  if (user) redirect(user.role === 'STAFF' ? '/dashboard' : '/sessions')

  const demo = demoLoginEnabled()

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[440px]">
        {/* Brand lockup */}
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-[14px] bg-brand text-brand-fg shadow-sm">
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
            >
              <path d="M6 15V9M10 18V6M14 16V8M18 13v-2" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h1 className="font-display text-[1.75rem] tracking-tight text-fg">Cadence</h1>
            <p className="eyebrow mt-1 text-muted">Studio Operations</p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-7 shadow-sm">
          <h2 className="text-base font-semibold text-fg">Requesting access</h2>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
            Cadence has two roles — studio staff and instructors — and both carry real scheduling
            and member access. Accounts are provisioned by your studio administrator, so there is no
            public sign-up, by design. If you need an account, ask the studio to add you.
          </p>

          {demo ? (
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-sm font-semibold text-fg">Just evaluating?</h3>
              <p className="mt-1 text-[0.8125rem] text-muted">
                Step into a pre-configured studio as either role — no account needed.
              </p>
              <div className="mt-4">
                <DemoEntry />
              </div>
            </div>
          ) : null}

          <div className="mt-6 border-t border-line pt-5">
            <p className="text-[0.8125rem] text-muted">
              Already have an account?{' '}
              <Link
                href="/login"
                className="font-medium text-brand-subtle-fg underline-offset-2 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-xs">
          <Link
            href="/"
            className="text-brand-subtle-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            ← Back to Cadence
          </Link>
        </p>
      </div>
    </main>
  )
}
