import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#0A2F6E',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
        }}
      >
        <div style={{ color: 'white', fontSize: 18, fontWeight: 900, letterSpacing: -1 }}>
          NC
        </div>
      </div>
    ),
    { ...size }
  )
}
