import { redirect } from 'next/navigation'

import { currentUser } from '@/server/auth/current-user'

import { AppShell } from './_shell/app-shell'

/**
 * Server component: resolves the authenticated identity from the request and
 * redirects to /login when there is none. This is UX only — every API route
 * independently enforces its own authentication and authorization, so a direct
 * API call never depends on this layout. currentUser() is request-cached, so the
 * page this layout renders shares the same lookup. The identity is handed to the
 * client shell as a prop (no extra /api/auth/me round-trip on first paint).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  if (!user) redirect('/login')
  return <AppShell user={user}>{children}</AppShell>
}
