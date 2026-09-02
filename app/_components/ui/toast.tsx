// app/_components/ui/toast.tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@app/_lib/cn'
import { useIsClient } from '@app/_lib/use-is-client'
import type { Tone } from '@app/_lib/status'

interface ToastInput {
  title: string
  description?: string
  tone?: Tone
  duration?: number
}
interface ToastItem extends Required<Omit<ToastInput, 'duration'>> {
  id: number
}

interface ToastApi {
  toast: (input: ToastInput) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

function ToastIcon({ tone }: { tone: Tone }) {
  const common = 'size-4 shrink-0'
  if (tone === 'success')
    return (
      <svg
        viewBox="0 0 20 20"
        className={common}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="m5 10 3.5 3.5L15 6.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (tone === 'danger' || tone === 'warning')
    return (
      <svg
        viewBox="0 0 20 20"
        className={common}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M10 6.5v4M10 14h.01" strokeLinecap="round" />
        <circle cx="10" cy="10" r="7.5" />
      </svg>
    )
  return (
    <svg viewBox="0 0 20 20" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 9v4.5M10 6.5h.01" strokeLinecap="round" />
      <circle cx="10" cy="10" r="7.5" />
    </svg>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const mounted = useIsClient()
  const nextId = useRef(1)
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current[id]
    if (timer) {
      clearTimeout(timer)
      delete timers.current[id]
    }
  }, [])

  const toast = useCallback(
    ({ title, description = '', tone = 'neutral', duration = 5000 }: ToastInput) => {
      const id = nextId.current++
      setItems((prev) => [...prev, { id, title, description, tone }])
      timers.current[id] = setTimeout(() => dismiss(id), duration)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, tone: 'success' }),
      error: (title, description) => toast({ title, description, tone: 'danger' }),
    }),
    [toast],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted
        ? createPortal(
            <div
              className="pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
              aria-live="polite"
              aria-atomic="false"
            >
              {items.map((t) => (
                <div
                  key={t.id}
                  role={t.tone === 'danger' ? 'alert' : 'status'}
                  className={cn(
                    'anim-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-surface px-4 py-3 shadow-lg',
                  )}
                >
                  <span className="mt-0.5" style={{ color: `var(--tone-${t.tone})` }}>
                    <ToastIcon tone={t.tone} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-fg">{t.title}</p>
                    {t.description ? (
                      <p className="mt-0.5 text-sm text-muted">{t.description}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(t.id)}
                    aria-label="Dismiss notification"
                    className="-mr-1 rounded p-1 text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  )
}

/** Toast API. Safe no-op fallback if used outside a provider (never throws). */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  return ctx ?? { toast: () => {}, success: () => {}, error: () => {} }
}
