import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The dev-tools badge defaults to bottom-left, which is exactly where the
  // sidebar's Account item sits. Dev only — it never ships.
  devIndicators: { position: 'top-right' },
}

export default nextConfig
