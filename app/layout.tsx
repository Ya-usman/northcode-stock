import type { Metadata, Viewport } from 'next'
import './globals.css'
import { SplashRemover } from '@/components/splash-remover'

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
        <link rel="icon" type="image/png" href="/logo-tab.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="StockShop" />
        {/* Blocking script — runs before first paint, eliminates dark mode flash + sets splash bg. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme:dark)').matches);var bg=d?'#091524':'#ffffff';if(d){var r=document.documentElement;r.classList.add('dark');r.style.backgroundColor=bg;r.style.colorScheme='dark'}document.addEventListener('DOMContentLoaded',function(){var s=document.getElementById('app-splash');if(s)s.style.backgroundColor=bg})}catch(e){}})()` }} />
      </head>
      <body className="bg-background">
        {/* Splash: covers blank page while JS loads. SplashRemover fades it out once React mounts. */}
        <div
          id="app-splash"
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16,
            backgroundColor: '#ffffff',
          }}
        >
          <img src="/logo-icon.png" alt="StockShop" width={80} height={80} style={{ borderRadius: 20 }} />
          <div style={{
            width: 40, height: 4, borderRadius: 2, overflow: 'hidden',
            backgroundColor: 'rgba(128,128,128,0.2)',
          }}>
            <div style={{
              height: '100%', width: '40%', borderRadius: 2,
              backgroundColor: '#073e8a',
              animation: 'splashBar 1.2s ease-in-out infinite',
            }} />
          </div>
          <style>{`@keyframes splashBar{0%{transform:translateX(-100%)}50%{transform:translateX(150%)}100%{transform:translateX(150%)}}`}</style>
        </div>
        <SplashRemover />
        {children}
      </body>
    </html>
  )
}
