import type { Metadata } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: 'Studio Class Booking',
  description: 'Schedule classes, track memberships, and run the waitlist for a studio.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  )
}
