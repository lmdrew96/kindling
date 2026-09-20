import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'

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

export const metadata: Metadata = {
  title: 'Kindling',
  description: 'MCP server for capturing and surfacing sparks of thought',
}

export const viewport: Viewport = {
  themeColor: '#0A3D46',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${raelaGrotesque.variable} ${kineksRound.variable}`}>
      <body>{children}</body>
    </html>
  )
}
