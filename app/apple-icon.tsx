import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

/** The same ember spark as app/icon.svg, rasterised for iOS home screens. */
export default function AppleIcon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#141018',
        }}
      >
        <svg width="132" height="132" viewBox="0 0 64 64">
          <defs>
            <linearGradient id="ember" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f5b878" />
              <stop offset="1" stopColor="#e8643c" />
            </linearGradient>
          </defs>
          <path
            d="M32 9C33.8 23.5 40.5 30.2 55 32C40.5 33.8 33.8 40.5 32 55C30.2 40.5 23.5 33.8 9 32C23.5 30.2 30.2 23.5 32 9Z"
            fill="url(#ember)"
          />
        </svg>
      </div>
    ),
    size
  )
}
