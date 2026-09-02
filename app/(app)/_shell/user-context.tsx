'use client'

import { createContext, useContext } from 'react'

import type { SessionUser } from '@app/_lib/types'

/**
 * The authenticated identity, resolved once server-side by the (app) layout and
 * shared with every client page. This drives which controls render — but it is
 * NEVER the authorization boundary: every API route independently enforces the
 * real permissions server-side, so hiding a control is a convenience, not a gate.
 */
const CurrentUserContext = createContext<SessionUser | null>(null)

export function CurrentUserProvider({
  user,
  children,
}: {
  user: SessionUser
  children: React.ReactNode
}) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser(): SessionUser {
  const user = useContext(CurrentUserContext)
  if (!user) throw new Error('useCurrentUser must be used within CurrentUserProvider')
  return user
}

export function useIsStaff(): boolean {
  return useCurrentUser().role === 'STAFF'
}
