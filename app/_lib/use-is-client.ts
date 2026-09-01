// app/_lib/use-is-client.ts
'use client'

import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}

/**
 * True only after the component has mounted on the client (false during SSR) —
 * the correct guard for client-only portals, without a setState-in-effect.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
}
