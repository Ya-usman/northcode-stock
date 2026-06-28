'use client'

import { useEffect, useState } from 'react'
import {
  WifiOff, RefreshCw, ShoppingCart, LayoutDashboard,
  Package, Users, Receipt, BarChart2, Clock, Banknote,
} from 'lucide-react'
import { getTotalPendingCount } from '@/lib/offline/db'

function getLocale(): string {
  if (typeof document === 'undefined') return 'fr'
  return (
    document.cookie.match(/NEXT_LOCALE=([^;]+)/)?.[1] ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('NEXT_LOCALE')) ||
    'fr'
  )
}

function getLastSyncTime(): Date | null {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('pc_data_'))
    if (!keys.length) return null
    const timestamps = keys.map(k => Number(localStorage.getItem(k))).filter(Boolean)
    if (!timestamps.length) return null
    return new Date(Math.max(...timestamps))
  } catch { return null }
}

function formatSyncTime(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  if (minutes < 1) return 'à l\'instant'
  if (minutes < 60) return `il y a ${minutes} min`
  if (hours < 24) {
    return `aujourd'hui à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
  }
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

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

const GRID_ITEMS = [
  { icon: LayoutDashboard, label: 'Tableau de bord', route: 'dashboard' },
  { icon: Package,         label: 'Stock',           route: 'stock' },
  { icon: Users,           label: 'Clients',         route: 'customers' },
  { icon: Banknote,        label: 'Dette',            route: 'payments' },
  { icon: Receipt,         label: 'Dépenses',         route: 'expenses' },
  { icon: BarChart2,       label: 'Rapports',         route: 'reports' },
]

export default function OfflinePage() {
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    setLastSync(getLastSyncTime())
    getTotalPendingCount().then(setPendingCount).catch(() => {})
  }, [])

  useEffect(() => {
    const handleOnline = () => {
      checkRealConnectivity().then(online => {
        if (online) window.location.href = `/${getLocale()}/dashboard`
      })
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  const navigate = (route: string) => {
    window.location.href = `/${getLocale()}/${route}`
  }

  const retry = async () => {
    setRetrying(true)
    const online = await checkRealConnectivity()
    if (online) {
      window.location.href = `/${getLocale()}/dashboard`
    } else {
      setRetrying(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-8 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <img src="/logo-icon-t.png" alt="StockShop" className="h-8 w-8 dark:brightness-0 dark:invert" />
            <p className="font-bold text-gray-900 dark:text-gray-100 text-base leading-tight">StockShop</p>
          </div>
          <div className="flex items-center gap-1.5 mt-1 ml-0.5">
            <WifiOff className="h-3 w-3 text-red-500" />
            <span className="text-xs text-red-500 font-medium">Hors connexion</span>
          </div>
        </div>
        <button
          onClick={retry}
          disabled={retrying}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? 'Vérification…' : 'Réessayer'}
        </button>
      </div>

      {/* Status bar */}
      <div className="mx-5 mt-2 mb-5 rounded-xl border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
        {lastSync && (
          <div className="flex items-center gap-2.5 px-4 py-2.5">
            <Clock className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Données synchronisées <span className="font-medium text-gray-700 dark:text-gray-200">{formatSyncTime(lastSync)}</span>
            </span>
          </div>
        )}
        {pendingCount > 0 && (
          <div className="flex items-center gap-2.5 px-4 py-2.5">
            <div className="h-2 w-2 rounded-full bg-amber-500 flex-shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              {pendingCount} {pendingCount > 1 ? 'opérations en attente' : 'opération en attente'} de synchronisation
            </span>
          </div>
        )}
        {!lastSync && pendingCount === 0 && (
          <div className="flex items-center gap-2.5 px-4 py-2.5">
            <div className="h-2 w-2 rounded-full bg-gray-300 flex-shrink-0" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Connectez-vous en ligne pour charger les données
            </span>
          </div>
        )}
      </div>

      {/* Primary CTA — Nouvelle vente */}
      <div className="px-5 mb-3">
        <button
          onClick={() => navigate('sales/new')}
          className="w-full flex items-center gap-4 rounded-2xl bg-[#073e8a] hover:bg-[#0a4fa8] active:scale-[0.98] transition-all px-5 py-4 shadow-md"
        >
          <div className="h-12 w-12 flex items-center justify-center rounded-xl bg-white/15 flex-shrink-0">
            <ShoppingCart className="h-6 w-6 text-white" />
          </div>
          <div className="text-left">
            <p className="font-bold text-white text-base leading-tight">Nouvelle vente</p>
            <p className="text-blue-200 text-xs mt-0.5">Enregistrée localement si hors ligne</p>
          </div>
        </button>
      </div>

      {/* Grid */}
      <div className="px-5 grid grid-cols-2 gap-3 flex-1">
        {GRID_ITEMS.map(({ icon: Icon, label, route }) => (
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
