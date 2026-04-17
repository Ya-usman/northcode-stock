import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: 'StockShop',
  description: 'Smart inventory management for your boutique',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'StockShop',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: 'StockShop',
    title: 'StockShop — Gestion de stock intelligente',
    description: 'Gérez votre boutique facilement avec StockShop',
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
        <meta name="apple-mobile-web-app-title" content="StockShop" />
      </head>
      <body className="bg-gray-50 dark:bg-gray-950">
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.classList.add('dark')})()` }} />
        {children}
      </body>
    </html>
  )
}
