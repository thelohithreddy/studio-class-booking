'use client'

import { useCallback, useEffect, useState } from 'react'

/** Thin client fetch helper: same-origin JSON, throws a readable message. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

/**
 * Loads data on mount and whenever `path` changes; `reload()` re-fetches.
 * State is only ever set from async callbacks or the event-driven reload — no
 * synchronous setState inside the effect body.
 */
export function useResource<T>(path: string): {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => {
    setLoading(true)
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    let active = true
    api<T>(path)
      .then((d) => {
        if (!active) return
        setData(d)
        setError(null)
      })
      .catch((e: Error) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [path, nonce])

  return { data, error, loading, reload }
}

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        {...props}
        className="rounded border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
      />
    </label>
  )
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 ${props.className ?? ''}`}
    />
  )
}

export function Notice({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p
      role="alert"
      className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
    >
      {error}
    </p>
  )
}
