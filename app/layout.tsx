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
        {/* Dark mode anti-flash: runs before first paint, sets html class + background */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme:dark)').matches);if(d){var r=document.documentElement;r.classList.add('dark');r.style.backgroundColor='#091524';r.style.colorScheme='dark'}}catch(e){}})()` }} />
      </head>
      <body className="bg-background">
        {/* Splash: covers blank page while JS loads.
            Background uses var(--background) so it matches the theme automatically.
            SplashRemover fades it once React mounts; the inline script removes it after
            6s as a safety fallback (in case React hydration is slow or errors). */}
        <div
          id="app-splash"
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16,
            backgroundColor: 'var(--background, #ffffff)',
          }}
        >
          <div style={{ background: '#ffffff', borderRadius: 20, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/logo-tab.png" alt="StockShop" width={64} height={64} />
          </div>
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
          <script dangerouslySetInnerHTML={{ __html: `(function(){var isMobile=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);var s=document.getElementById('app-splash');if(!isMobile&&s){s.remove();return;}setTimeout(function(){if(s){s.style.transition='opacity 0.2s';s.style.opacity='0';setTimeout(function(){s.remove()},220)}},6000)})()` }} />
        </div>
        <SplashRemover />
        {children}
      </body>
    </html>
  )
}
