'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@app/_components/ui/button'
import { TextInput } from '@app/_components/ui/form'
import { Callout } from '@app/_components/ui/feedback'

/**
 * The sign-in form. A successful login is HTTP 204 (identity arrives only as the
 * session cookie), so we push to the dashboard and let the (app) layout resolve
 * the user. Error copy is deliberately generic for credentials (no account
 * enumeration) and specific for rate-limiting and connectivity.
 */
export function LoginForm() {
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
      // push (not replace) so the browser Back / two-finger swipe still works
      // after entering the app; /login redirects an authenticated visitor onward,
      // so Back lands in the app rather than on a stale form. The (app) layout
      // resolves the user and bounces instructors to their scoped home.
      router.push('/dashboard')
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
    <div className="rounded-2xl border border-line bg-surface p-7 shadow-sm">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-fg">Sign in</h2>
        <p className="mt-0.5 text-[0.8125rem] text-muted">Welcome back — sign in to continue.</p>
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
  )
}
