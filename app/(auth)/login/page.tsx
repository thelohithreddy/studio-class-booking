import Link from 'next/link'

import { demoLoginEnabled } from '@/server/auth/demo'
import { DemoEntry } from '@app/_components/landing/demo-entry'
import { LoginForm } from './login-form'

/**
 * Sign-in page. Server component so it can read the demo flag and, on a demo
 * deployment, offer one-click role entry beneath the credentials form (no
 * password ever reaches the client — see /api/auth/demo). The interactive form
 * itself is the client LoginForm.
 */
// Rendered per request so the demo flag reflects the runtime environment (a
// statically prerendered page would freeze ALLOW_DEMO_LOGIN at build time).
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const demo = demoLoginEnabled()

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[380px]">
        {/* Brand lockup */}
        <div className="mb-9 flex flex-col items-center gap-4 text-center">
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
            <p className="eyebrow mt-1">Studio Operations</p>
          </div>
          <p className="max-w-60 text-[0.8125rem] text-muted">Welcome back to Cadence.</p>
        </div>

        <LoginForm />

        {demo ? (
          <div className="mt-6">
            <div className="flex items-center gap-3 text-xs text-subtle">
              <span className="h-px flex-1 bg-line" />
              <span>or explore instantly</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="mt-4">
              <DemoEntry />
            </div>
          </div>
        ) : null}

        <p className="mt-6 text-center text-xs text-subtle">
          Access is managed by your studio administrator.
        </p>
        <p className="mt-2 text-center text-xs">
          <Link
            href="/"
            className="text-brand-subtle-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            ← What is Cadence?
          </Link>
        </p>
      </div>
    </main>
  )
}
