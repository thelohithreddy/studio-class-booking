'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@app/_components/ui/button'
import { TextInput } from '@app/_components/ui/form'
import { Callout } from '@app/_components/ui/feedback'

/**
 * Sign-in. A successful login is HTTP 204 (identity arrives only as the session
 * cookie), so we push to the dashboard and let the (app) layout resolve the
 * user. Error copy is deliberately generic for credentials (no account
 * enumeration) and specific for rate-limiting and connectivity.
 */
export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)

    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    }).catch(() => null)

    if (response?.ok) {
      router.replace('/')
      router.refresh()
      return
    }

    setPending(false)
    if (response === null) {
      setError('Could not reach the server — check your connection and try again.')
    } else if (response.status === 429) {
      setError('Too many attempts. Please wait a few minutes and try again.')
    } else if (response.status === 400 || response.status === 401) {
      setError('That email and password don’t match. Please try again.')
    } else {
      setError('Something went wrong. Please try again.')
    }
  }

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
          <p className="max-w-60 text-[0.8125rem] text-muted">Studio operations, simplified.</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-7 shadow-sm">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-fg">Sign in</h2>
            <p className="mt-0.5 text-[0.8125rem] text-muted">
              Welcome back — sign in to continue.
            </p>
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <TextInput
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@studio.com"
              required
              autoFocus
            />
            <TextInput
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
            {error ? (
              <Callout tone="danger" role="alert">
                {error}
              </Callout>
            ) : null}
            <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-subtle">
          Access is managed by your studio administrator.
        </p>
      </div>
    </main>
  )
}
