import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Geist_Mono } from 'next/font/google'
import './globals.css'
import { THEME_SCRIPT } from '@/lib/theme'

const raelaGrotesque = localFont({
  variable: '--font-raela',
  display: 'swap',
  src: [
    { path: '../branding/fonts/RaelaGrotesqueThin-ovpea.ttf', weight: '100', style: 'normal' },
    { path: '../branding/fonts/RaelaGrotesqueExtraLight-4nYxx.ttf', weight: '200', style: 'normal' },
    { path: '../branding/fonts/RaelaGrotesqueLight-0v1ER.ttf', weight: '300', style: 'normal' },
    { path: '../branding/fonts/RaelaGrotesqueRegular-e9476.ttf', weight: '400', style: 'normal' },
    { path: '../branding/fonts/RaelaGrotesqueMedium-WprDE.ttf', weight: '500', style: 'normal' },
    { path: '../branding/fonts/RaelaGrotesqueSemiBold-aY5KR.ttf', weight: '600', style: 'normal' },
    { path: '../branding/fonts/RaelaGrotesqueBold-E4Omn.ttf', weight: '700', style: 'normal' },
    { path: '../branding/fonts/RaelaGrotesqueExtraBold-OGgW4.ttf', weight: '800', style: 'normal' },
    { path: '../branding/fonts/RaelaGrotesqueBlack-Zp21m.ttf', weight: '900', style: 'normal' },
  ],
})

const kineksRound = localFont({
  variable: '--font-kineks',
  display: 'swap',
  src: [
    { path: '../branding/fonts/KineksRoundLight-KVe8X.otf', weight: '300', style: 'normal' },
    { path: '../branding/fonts/KineksRoundRegular-vnPJ9.otf', weight: '400', style: 'normal' },
    { path: '../branding/fonts/KineksRoundMedium-2vyGo.otf', weight: '500', style: 'normal' },
    { path: '../branding/fonts/KineksRoundSemiBold-woLx6.otf', weight: '600', style: 'normal' },
    { path: '../branding/fonts/KineksRoundBold-MAlrP.otf', weight: '700', style: 'normal' },
  ],
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
  themeColor: '#141018',
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
      className={`${raelaGrotesque.variable} ${kineksRound.variable} ${geistMono.variable}`}
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
