'use client'

import { AlertTriangle, XCircle } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { useTranslations } from 'next-intl'
import type { Product } from '@/lib/types/database'

interface StockAlertsProps {
  lowStockProducts: Product[]
  outOfStockProducts: Product[]
}

export function StockAlerts({ lowStockProducts, outOfStockProducts }: StockAlertsProps) {
  const t = useTranslations()

  if (lowStockProducts.length === 0 && outOfStockProducts.length === 0) return null

  return (
    <div className="space-y-2">
      {outOfStockProducts.length > 0 && (
        <Alert variant="destructive" className="py-3">
          <XCircle className="h-4 w-4" />
          <AlertTitle className="text-sm">
            {t('dashboard.out_of_stock_warning', { count: outOfStockProducts.length })}
          </AlertTitle>
          <AlertDescription className="text-xs mt-1">
            {outOfStockProducts.slice(0, 5).map(p => p.name).join(', ')}
            {outOfStockProducts.length > 5 && ` ${t('dashboard.more_items', { count: outOfStockProducts.length - 5 })}`}
          </AlertDescription>
        </Alert>
      )}

      {lowStockProducts.length > 0 && (
        <Alert variant="warning" className="py-3">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-sm">
            {t('dashboard.low_stock_warning', { count: lowStockProducts.length })}
          </AlertTitle>
          <AlertDescription className="text-xs mt-1">
            {lowStockProducts.slice(0, 5).map(p => `${p.name} (${t('dashboard.qty_left', { qty: p.quantity })})`).join(', ')}
            {lowStockProducts.length > 5 && ` ${t('dashboard.more_items', { count: lowStockProducts.length - 5 })}`}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
