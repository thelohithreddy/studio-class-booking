import Link from 'next/link'
import { redirect } from 'next/navigation'

import { currentUser } from '@/server/auth/current-user'

/**
 * Server component: resolves the authenticated identity from the request and
 * redirects to /login when there is none. This is UX only — every API route
 * independently enforces its own authentication and authorization; a direct
 * API call never depends on this layout. currentUser() is request-cached, so
 * the page this layout renders shares the same lookup.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  if (!user) redirect('/login')

  const staffLinks: Array<[string, string]> =
    user.role === 'STAFF'
      ? [
          ['/', 'Dashboard'],
          ['/classes', 'Classes'],
          ['/members', 'Members'],
          ['/rooms', 'Rooms'],
          ['/sessions', 'Sessions'],
        ]
      : [['/sessions', 'My sessions']]

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-slate-800">
        <nav className="flex items-center gap-4 text-sm">
          <span className="font-semibold">Studio</span>
          {staffLinks.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="text-slate-600 hover:underline dark:text-slate-400"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>
            {user.name} · {user.role}
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="hover:underline" formAction="/api/auth/logout">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-6">{children}</main>
    </div>
  )
}
