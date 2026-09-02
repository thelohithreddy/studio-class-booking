// app/_components/providers.tsx
'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ApiError } from '@app/_lib/api'
import { ConfirmProvider } from './ui/confirm'
import { ToastProvider } from './ui/toast'

/**
 * App-wide client providers: React Query (data layer), toasts, and the
 * confirmation dialog. The QueryClient is created once per browser session via
 * useState so it survives re-renders but never leaks between requests on the
 * server.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Never retry auth/permission/validation failures — only transient ones.
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                return false
              }
              return failureCount < 2
            },
          },
          mutations: { retry: false },
        },
      }),
  )

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
