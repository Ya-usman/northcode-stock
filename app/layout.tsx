import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'NorthCode Stock Manager',
  description: 'Smart inventory management for Northern Nigeria boutiques',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'NC Stock',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: 'NorthCode Stock',
    title: 'NorthCode Stock Manager',
    description: 'Smart inventory for Northern Nigeria',
  },
}

export const viewport: Viewport = {
  themeColor: '#0A2F6E',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="NC Stock" />
      </head>
      <body>{children}</body>
    </html>
  )
}
