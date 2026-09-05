import Link from 'next/link'

import { demoLoginEnabled } from '@/server/auth/demo'
import { DemoEntry } from '@app/_components/landing/demo-entry'
import { LoginForm } from './login-form'

/**
 * Sign-in page. Server component so it can read the demo flag and answer the
 * first-time visitor's question — "I don't have an account, how do I get in?" —
 * directly: a demo deployment offers one-click role entry; otherwise it explains
 * that accounts are studio-provisioned (there is no public sign-up) and where
 * evaluator credentials live. No password ever reaches the client. The
 * interactive credentials form is the client LoginForm.
 */
export const dynamic = 'force-dynamic'

const SUBMISSION_URL =
  'https://github.com/thelohithreddy/studio-class-booking/blob/main/SUBMISSION.md'

export default function LoginPage() {
  const demo = demoLoginEnabled()

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[400px]">
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

        <LoginForm />

        {/* First-time visitor path — never a dead end. */}
        <div className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-sm font-semibold text-fg">New to Cadence?</h2>
          {demo ? (
            <>
              <p className="mt-1 text-[0.8125rem] text-muted">
                Explore the product without creating an account — no credentials needed.
              </p>
              <div className="mt-4">
                <DemoEntry />
              </div>
            </>
          ) : (
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
              Cadence accounts are provisioned by studio staff — there is no public sign-up, by
              design. Evaluating? Sign in with the demo accounts in{' '}
              <a
                href={SUBMISSION_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-brand-subtle-fg underline-offset-2 hover:underline"
              >
                SUBMISSION.md
              </a>
              , or enable demo mode for one-click access.
            </p>
          )}
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
