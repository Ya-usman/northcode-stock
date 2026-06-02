'use client'

import { useEffect, useState } from 'react'
import { WifiOff, RefreshCw, LayoutDashboard, ShoppingCart, Package, BarChart2, Users, Receipt, FileText } from 'lucide-react'

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard',   route: 'dashboard' },
  { icon: ShoppingCart,    label: 'Nouvelle vente', route: 'sales/new' },
  { icon: Package,         label: 'Stock',        route: 'stock' },
  { icon: BarChart2,       label: 'Rapports',     route: 'reports' },
  { icon: Users,           label: 'Clients',      route: 'customers' },
  { icon: Receipt,         label: 'Dépenses',     route: 'expenses' },
  { icon: FileText,        label: 'Notes',        route: 'notes' },
]

function getLocale(): string {
  if (typeof window === 'undefined') return 'fr'
  return window.location.pathname.split('/')[1] || 'fr'
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    setIsOffline(!navigator.onLine)
    const onOnline = () => { setIsOffline(false); reset() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [reset])

  const navigate = (route: string) => {
    const locale = getLocale()
    window.location.href = `/${locale}/${route}`
  }

  if (isOffline) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/40">
          <WifiOff className="h-8 w-8 text-amber-500" />
        </div>

        <div>
          <h2 className="text-lg font-bold text-foreground">Page non disponible hors ligne</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Cette page n'a pas pu être chargée sans connexion. Naviguez vers une page déjà en cache.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
          {NAV_ITEMS.map(({ icon: Icon, label, route }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors active:scale-95"
            >
              <Icon className="h-4 w-4 text-stockshop-blue shrink-0" />
              <span className="truncate">{label}</span>
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
        <h2 className="text-lg font-bold text-foreground">Une erreur s'est produite</h2>
        <p className="text-sm text-muted-foreground mt-1">La page n'a pas pu se charger.</p>
      </div>
      <button
        onClick={reset}
        className="flex items-center gap-2 rounded-xl bg-stockshop-blue text-white px-5 py-2.5 text-sm font-medium hover:bg-blue-700 transition-colors"
      >
        <RefreshCw className="h-4 w-4" />
        Réessayer
      </button>
    </div>
  )
}
