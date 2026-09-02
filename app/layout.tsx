import type { Metadata } from 'next'

import './globals.css'
import { Providers } from './_components/providers'

export const metadata: Metadata = {
  title: 'Cadence — Studio Operations',
  description: 'Schedule classes, run the waitlist, and track memberships for your studio.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-fg antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
