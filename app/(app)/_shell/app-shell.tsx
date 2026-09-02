'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'

import { cn } from '@app/_lib/cn'
import { apiSend } from '@app/_lib/api'
import { useAlerts } from '@app/_lib/use-alerts'
import type { SessionUser } from '@app/_lib/types'
import { Avatar } from '@app/_components/ui'
import { useDialogA11y } from '@app/_components/ui/overlay'
import { CurrentUserProvider } from './user-context'
import {
  IconAlerts,
  IconBookings,
  IconClasses,
  IconDashboard,
  IconLogout,
  IconMembers,
  IconMenu,
  IconRooms,
  IconSessions,
  IconX,
} from '@app/_components/icons'

interface NavItem {
  href: string
  label: string
  icon: (p: { className?: string }) => React.ReactElement
}

const STAFF_NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: IconDashboard },
  { href: '/sessions', label: 'Sessions', icon: IconSessions },
  { href: '/bookings', label: 'Bookings', icon: IconBookings },
  { href: '/classes', label: 'Classes', icon: IconClasses },
  { href: '/members', label: 'Members', icon: IconMembers },
  { href: '/rooms', label: 'Rooms', icon: IconRooms },
]
const INSTRUCTOR_NAV: NavItem[] = [{ href: '/sessions', label: 'My sessions', icon: IconSessions }]

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function BrandMark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-fg shadow-sm">
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          aria-hidden="true"
        >
          <path d="M6 15V9M10 18V6M14 16V8M18 13v-2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[0.95rem] font-semibold tracking-tight text-fg">Cadence</span>
        <span className="eyebrow mt-px">Studio Operations</span>
      </span>
    </span>
  )
}

function AlertsNavBadge({ staff }: { staff: boolean }) {
  const alerts = useAlerts(staff)
  const count = alerts.data?.count ?? 0
  if (!staff) return null
  return count > 0 ? (
    <>
      <span
        className="tabular ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--tone-danger)] px-1.5 text-[0.7rem] font-semibold text-white"
        aria-hidden="true"
      >
        {count}
      </span>
      <span className="sr-only">
        {' '}
        ({count} pending {count === 1 ? 'alert' : 'alerts'})
      </span>
    </>
  ) : null
}

function NavLinks({
  items,
  pathname,
  staff,
  onNavigate,
}: {
  items: NavItem[]
  pathname: string
  staff: boolean
  onNavigate?: () => void
}) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Primary">
      {items.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <Icon className={cn('size-5 shrink-0', active ? 'text-brand' : 'text-subtle')} />
            <span className="truncate">{item.label}</span>
          </Link>
        )
      })}
      {staff ? (
        <Link
          href="/alerts"
          onClick={onNavigate}
          aria-current={isActive(pathname, '/alerts') ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isActive(pathname, '/alerts')
              ? 'bg-surface-2 text-fg'
              : 'text-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          <IconAlerts
            className={cn(
              'size-5 shrink-0',
              isActive(pathname, '/alerts') ? 'text-brand' : 'text-subtle',
            )}
          />
          <span className="truncate">Alerts</span>
          <AlertsNavBadge staff={staff} />
        </Link>
      ) : null}
    </nav>
  )
}

function UserCard({
  user,
  onSignOut,
  signingOut,
}: {
  user: SessionUser
  onSignOut: () => void
  signingOut: boolean
}) {
  return (
    <div className="flex items-center gap-3 border-t border-line px-2 pt-3">
      <Avatar name={user.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{user.name}</p>
        <p className="truncate text-xs text-muted">
          {user.role === 'STAFF' ? 'Studio staff' : 'Instructor'}
        </p>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        aria-label="Sign out"
        title="Sign out"
        className="rounded-md p-2 text-subtle hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
      >
        <IconLogout className="size-5" />
      </button>
    </div>
  )
}

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const staff = user.role === 'STAFF'
  const items = staff ? STAFF_NAV : INSTRUCTOR_NAV

  const queryClient = useQueryClient()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close the mobile drawer whenever the route changes (derived from render, not
  // an effect). Nav links also close it directly via onNavigate.
  const [lastPath, setLastPath] = useState(pathname)
  if (pathname !== lastPath) {
    setLastPath(pathname)
    setMobileOpen(false)
  }

  // The mobile nav is a modal drawer: trap focus, lock scroll, Escape-to-close,
  // and return focus to the trigger — the same guarantees as any dialog.
  useDialogA11y(mobileOpen, () => setMobileOpen(false), panelRef)

  async function signOut() {
    setSigningOut(true)
    try {
      await apiSend('/api/auth/logout', 'POST')
    } catch {
      // Logout is idempotent server-side; proceed to the login page regardless.
    }
    // Drop all cached query data so the next user on a shared machine never sees
    // the previous user's studio data from cache. The server also re-scopes.
    queryClient.clear()
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <div className="px-2 pb-5">
          <Link
            href="/"
            className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <BrandMark />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks items={items} pathname={pathname} staff={staff} />
        </div>
        <UserCard user={user} onSignOut={signOut} signingOut={signingOut} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <IconMenu className="size-6" />
        </button>
        <BrandMark />
        <div className="ml-auto">
          <Avatar name={user.name} />
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="anim-overlay-in absolute inset-0 bg-[var(--overlay)]"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="anim-drawer-in absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-line bg-surface px-3 py-4 shadow-lg"
          >
            <div className="flex items-center justify-between px-2 pb-5">
              <BrandMark />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-2 text-subtle hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <IconX className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavLinks
                items={items}
                pathname={pathname}
                staff={staff}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
            <UserCard user={user} onSignOut={signOut} signingOut={signingOut} />
          </div>
        </div>
      ) : null}

      {/* Main content */}
      <div className="lg:pl-60">
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          <CurrentUserProvider user={user}>{children}</CurrentUserProvider>
        </main>
      </div>
    </div>
  )
}
