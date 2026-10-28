import type { Metadata } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import Script from 'next/script'

import './globals.css'
import { Providers } from './_components/providers'

// P voice agent (decisions.md #36). The key is public by design, a publishable key that
// only works on the sites allowed in P's dashboard. The file must load from P's own
// address: the widget sends all its requests back to wherever it was loaded from, so it
// can't be bundled or self-hosted. Changing this origin means changing connect-src in
// next.config.ts too, or the widget loads and then can't reach its server.
const P_WIDGET_SRC = 'https://p-api-bz2d.onrender.com/v1/widget.js'
const P_WIDGET_KEY = 'pk_live_QUwoqZ2J60s82srX-1VEJAqY'

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
        {/* In the root layout so every page has it, and it survives client-side
            navigation instead of reloading per route. afterInteractive keeps it off the
            critical path: it loads once the page is usable. */}
        <Script src={P_WIDGET_SRC} data-key={P_WIDGET_KEY} strategy="afterInteractive" />
      </body>
    </html>
  )
}
