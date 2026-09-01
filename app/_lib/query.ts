// app/_lib/query.ts
//
// The React Query data layer. Centralizes query keys, a typed query wrapper, and
// a mutation wrapper that invalidates affected keys on success — so a booking,
// cancel, edit, or dismiss never leaves a stale list on screen. Server state is
// authoritative: mutations refetch rather than optimistically guessing a result
// the server decides (e.g. Booked vs Waitlisted).

'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query'

import { apiGet } from './api'

/** Query-key factory — every key is derived here so invalidation stays honest. */
export const qk = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  classes: (params?: unknown) => ['classes', params ?? {}] as const,
  class: (id: string) => ['class', id] as const,
  sessions: (params?: unknown) => ['sessions', params ?? {}] as const,
  session: (id: string) => ['session', id] as const,
  roster: (sessionId: string) => ['roster', sessionId] as const,
  bookings: (params?: unknown) => ['bookings', params ?? {}] as const,
  booking: (id: string) => ['booking', id] as const,
  members: (params?: unknown) => ['members', params ?? {}] as const,
  member: (id: string) => ['member', id] as const,
  alerts: ['alerts'] as const,
  rooms: ['rooms'] as const,
  instructors: ['instructors'] as const,
}

/** GET a resource into the cache. Thin wrapper so pages don't repeat queryFn. */
export function useApiQuery<T>(
  key: QueryKey,
  path: string,
  options?: Omit<UseQueryOptions<T, Error, T, QueryKey>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<T, Error, T, QueryKey>({
    queryKey: key,
    queryFn: () => apiGet<T>(path),
    ...options,
  })
}

/**
 * A mutation that invalidates the given key prefixes on success (so the lists,
 * detail panels, and badges they feed refetch from the server). `invalidate`
 * accepts key prefixes: ['bookings'] invalidates every ['bookings', ...params].
 */
export function useApiMutation<TData, TVars>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'> & {
    invalidate?: QueryKey[]
  },
) {
  const qc = useQueryClient()
  const { invalidate, onSuccess, ...rest } = options ?? {}
  return useMutation<TData, Error, TVars>({
    mutationFn,
    ...rest,
    onSuccess: (...args) => {
      invalidate?.forEach((key) => void qc.invalidateQueries({ queryKey: key }))
      onSuccess?.(...(args as Parameters<NonNullable<typeof onSuccess>>))
    },
  })
}

/** Imperative invalidate for flows that touch several resources at once. */
export function useInvalidate() {
  const qc = useQueryClient()
  return (keys: QueryKey[]) => keys.forEach((key) => void qc.invalidateQueries({ queryKey: key }))
}
