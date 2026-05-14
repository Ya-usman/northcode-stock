'use client'

import { WifiOff, ShoppingCart, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useParams } from 'next/navigation'

export default function OfflinePage() {
  const router = useRouter()
  const params = useParams()
  const locale = params?.locale as string || 'fr'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 p-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40 mb-6">
        <WifiOff className="h-10 w-10 text-red-500 dark:text-red-400" />
      </div>

      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        Mode hors-ligne
      </h1>
      <p className="text-muted-foreground max-w-sm mb-8">
        Cette page n&apos;est pas disponible hors-ligne. La page de vente reste entièrement accessible.
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={() => router.push(`/${locale}/sales/new`)}
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-3 transition-colors"
        >
          <ShoppingCart className="h-4 w-4" />
          Aller à la vente
        </button>

        <button
          onClick={() => router.back()}
          className="flex items-center justify-center gap-2 w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium px-4 py-3 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Page précédente
        </button>
      </div>

      <p className="text-xs text-muted-foreground mt-8">StockShop Manager</p>
    </div>
  )
}
