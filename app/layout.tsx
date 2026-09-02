import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

import './globals.css'
import { Providers } from './_components/providers'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Cadence — Studio Operations',
  description:
    'Studio operations, simplified. Schedule classes, run the waitlist, and keep memberships current.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-canvas text-fg antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
