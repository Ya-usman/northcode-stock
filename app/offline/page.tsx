'use client'

import { useEffect } from 'react'
import { WifiOff, ShoppingCart, RefreshCw, LayoutDashboard, Package, BarChart2, Users, Receipt, FileText } from 'lucide-react'

function getLocale(): string {
  if (typeof document === 'undefined') return 'fr'
  return (
    document.cookie.match(/NEXT_LOCALE=([^;]+)/)?.[1] ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('NEXT_LOCALE')) ||
    'fr'
  )
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Tableau de bord', route: 'dashboard' },
  { icon: ShoppingCart,    label: 'Nouvelle vente',  route: 'sales/new' },
  { icon: Package,         label: 'Stock',           route: 'stock' },
  { icon: Users,           label: 'Clients',         route: 'customers' },
  { icon: Receipt,         label: 'Dépenses',        route: 'expenses' },
  { icon: BarChart2,       label: 'Rapports',        route: 'reports' },
  { icon: FileText,        label: 'Notes',           route: 'notes' },
]

export default function OfflinePage() {
  const navigate = (route: string) => {
    const locale = getLocale()
    window.location.href = `/${locale}/${route}`
  }

  // Auto-redirect to dashboard when connection is restored
  useEffect(() => {
    const handleOnline = () => {
      const locale = getLocale()
      window.location.href = `/${locale}/dashboard`
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-8 pb-4">
        <div className="flex items-center justify-center bg-white rounded-xl p-2 shadow-sm">
          <img src="/logo-offline.png" alt="StockShop" width={36} height={36} style={{ display: 'block' }} />
        </div>
        <div>
          <p className="font-bold text-gray-900 dark:text-gray-100 text-base">StockShop</p>
          <div className="flex items-center gap-1.5">
            <WifiOff className="h-3 w-3 text-red-500" />
            <span className="text-xs text-red-500 font-medium">Hors connexion</span>
          </div>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Réessayer
        </button>
      </div>

      {/* Offline notice */}
      <div className="mx-5 mb-6 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
        Pas de connexion. Les pages que vous avez déjà visitées sont disponibles ci-dessous.
      </div>

      {/* Navigation grid */}
      <div className="px-5 grid grid-cols-2 gap-3 flex-1">
        {NAV_ITEMS.map(({ icon: Icon, label, route }) => (
          <button
            key={route}
            onClick={() => navigate(route)}
            className="flex flex-col items-center justify-center gap-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 shadow-sm active:scale-95 transition-transform"
          >
            <div className="h-10 w-10 flex items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40">
              <Icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200 text-center leading-tight">{label}</span>
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-gray-400 py-6">
        Les données affichées proviennent du cache local
      </p>
    </div>
  )
}
