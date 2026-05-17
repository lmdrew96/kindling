import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kindling',
  description: 'MCP server for capturing and surfacing sparks of thought',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
