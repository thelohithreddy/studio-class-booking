'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * One-click evaluator entry. Posts a role to /api/auth/demo (which mints a
 * session for the pre-seeded demo account server-side — no password ever
 * touches the client) and routes to that role's home. Rendered only when the
 * deployment enabled demo access; the server decides that, this is UX.
 */
type Role = 'STAFF' | 'INSTRUCTOR'

export function DemoEntry() {
  const router = useRouter()
  const [pending, setPending] = useState<Role | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function enter(role: Role) {
    setPending(role)
    setError(null)
    const res = await fetch('/api/auth/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }).catch(() => null)

    if (res?.ok) {
      router.replace(role === 'STAFF' ? '/dashboard' : '/sessions')
      router.refresh()
      return
    }
    setPending(null)
    setError('Demo access is unavailable right now — please use Sign in instead.')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => enter('STAFF')}
          disabled={pending !== null}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
        >
          {pending === 'STAFF' ? 'Signing in…' : 'Explore as staff'}
        </button>
        <button
          type="button"
          onClick={() => enter('INSTRUCTOR')}
          disabled={pending !== null}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-5 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
        >
          {pending === 'INSTRUCTOR' ? 'Signing in…' : 'Explore as instructor'}
        </button>
      </div>
      <p className="text-xs text-subtle">
        No credentials needed — demo entry signs you into a sample studio account.
      </p>
      {error ? (
        <p role="alert" className="text-xs font-medium text-[var(--tone-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
