'use client'

import { useEffect, useRef, useState } from 'react'
import { WifiOff, RefreshCw, LayoutDashboard, ShoppingCart, Package, BarChart2, Users, Receipt, FileText } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

const NAV_ITEMS = [
  { icon: LayoutDashboard, key: 'dashboard' as const,  route: 'dashboard' },
  { icon: ShoppingCart,    key: 'new_sale' as const,    route: 'sales/new' },
  { icon: Package,         key: 'stock' as const,       route: 'stock' },
  { icon: BarChart2,       key: 'reports' as const,     route: 'reports' },
  { icon: Users,           key: 'customers' as const,   route: 'customers' },
  { icon: Receipt,         key: 'expenses' as const,    route: 'expenses' },
  { icon: FileText,        key: 'notes' as const,       route: 'notes' },
]

function getLocale(): string {
  if (typeof window === 'undefined') return 'fr'
  return window.location.pathname.split('/')[1] || 'fr'
}

// Vérifie la connectivité réelle via un HEAD request (navigator.onLine
// est non fiable sur Android Capacitor WebView).
async function checkRealConnectivity(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  const t = useTranslations()
  const [isOffline, setIsOffline] = useState(false)
  const checkedRef = useRef(false)

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true

    // Vérification réelle (pas navigator.onLine qui ment sur Android)
    checkRealConnectivity().then(online => {
      setIsOffline(!online)
    })

    // Quand le réseau revient : re-vérifier puis reset l'erreur
    const handleOnline = () => {
      checkRealConnectivity().then(online => {
        if (online) { setIsOffline(false); reset() }
      })
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [reset])

  // Navigation client-side (jamais window.location.href — évite l'erreur Android native)
  const navigate = (route: string) => {
    const locale = getLocale()
    router.push(`/${locale}/${route}`)
  }

  if (isOffline) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/40">
          <WifiOff className="h-8 w-8 text-amber-500" />
        </div>

        <div>
          <h2 className="text-lg font-bold text-foreground">{t('error_page.offline_title')}</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            {t('error_page.offline_body')}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
          {NAV_ITEMS.map(({ icon: Icon, key, route }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors active:scale-95"
            >
              <Icon className="h-4 w-4 text-stockshop-blue shrink-0" />
              <span className="truncate">{t(`nav.${key}`)}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
        <RefreshCw className="h-7 w-7 text-red-500" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-foreground">{t('error_page.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('error_page.body')}</p>
      </div>
      <button
        onClick={reset}
        className="flex items-center gap-2 rounded-xl bg-stockshop-blue text-white px-5 py-2.5 text-sm font-medium hover:bg-blue-700 transition-colors"
      >
        <RefreshCw className="h-4 w-4" />
        {t('error_page.try_again')}
      </button>
    </div>
  )
}
