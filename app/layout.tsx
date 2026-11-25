import type { Metadata, Viewport } from 'next'
import { Alfa_Slab_One, Archivo, Archivo_Narrow, Geist_Mono } from 'next/font/google'
import './globals.css'
import { THEME_SCRIPT } from '@/lib/theme'

// Matchbook type. latin-ext on all three, so Romanian (ă, ș, ț) renders in
// the real face rather than a fallback.
const alfaSlab = Alfa_Slab_One({
  variable: '--font-alfa-slab',
  weight: '400',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
})

const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
})

const archivoNarrow = Archivo_Narrow({
  variable: '--font-archivo-narrow',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
})

// Metadata, counts and timestamps — the quiet machine voice under the idea.
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Kindling',
  description: 'MCP server for capturing and surfacing sparks of thought',
}

export const viewport: Viewport = {
  themeColor: '#120d0b',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // THEME_SCRIPT sets data-theme before hydration, so the attribute is
    // expected to differ from the server render.
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${alfaSlab.variable} ${archivo.variable} ${archivoNarrow.variable} ${geistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/*
          The dashboard shell server-renders a capture box, tabs and a sort
          control, then says "Loading your sparks…" forever if JS never runs.
          Everything looks operable and nothing is — the worst version of a
          broken page, because it does not announce itself. Say so instead.
        */}
        <noscript>
          <p
            style={{
              margin: 0,
              padding: '0.75rem 1rem',
              background: 'var(--color-surface)',
              color: 'var(--color-fg)',
              fontSize: '0.875rem',
              textAlign: 'center',
            }}
          >
            Kindling needs JavaScript to load your sparks. The page below will not
            finish loading without it.
          </p>
        </noscript>
        {children}
      </body>
    </html>
  )
}
