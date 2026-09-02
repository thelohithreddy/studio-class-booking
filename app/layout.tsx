import type { Metadata } from 'next'
import { Fraunces, Inter } from 'next/font/google'

import './globals.css'
import { Providers } from './_components/providers'

// Inter for the interface; Fraunces (a warm editorial serif) for the brand and
// major page titles only — an editorial pairing, not a magazine.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  weight: ['400', '500', '600'],
  style: ['normal'],
})

export const metadata: Metadata = {
  title: 'Cadence — Studio Operations',
  description:
    'Studio operations, simplified. Schedule classes, run the waitlist, and keep memberships current.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-screen bg-canvas text-fg antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
