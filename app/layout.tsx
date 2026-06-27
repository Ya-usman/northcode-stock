import type { Metadata, Viewport } from 'next'
import './globals.css'
import { SWUpdater } from '@/components/pwa/sw-updater'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://northcode-stock.vercel.app'),
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
  themeColor: '#073e8a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="StockShop" />
        {/* Dark mode anti-flash: runs before first paint, sets html class + background */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme:dark)').matches);if(d){var r=document.documentElement;r.classList.add('dark');r.style.backgroundColor='#091524';r.style.colorScheme='dark'}}catch(e){}})()` }} />
        {/* SW update bootstrap: fires immediately when Chrome parses HTML, before any JS chunk.
            The old SW returns fresh HTML via NetworkFirst when online — so this script always
            runs on online sessions, even when old SW is still serving old JS bundles.
            This breaks the cycle: old SW → old JS → no reg.update() → SW never updates. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if('serviceWorker' in navigator&&navigator.onLine){navigator.serviceWorker.ready.then(function(r){r.update()}).catch(function(){})}}catch(e){}})()` }} />
      </head>
      <body className="bg-background">
        <SWUpdater />
        {children}
      </body>
    </html>
  )
}
