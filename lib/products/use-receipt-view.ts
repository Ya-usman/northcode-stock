'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { receiptView } from '@/lib/products/sale-measures'

// Ligne de vente lisible dans un écran (crédits, historique) : vendue à la mesure, « Riz · boîte » × 3 au prix de la
// boîte, jamais 2 100 g (lib/products/sale-measures receiptView). Ligne sans mesure : inchangée.
export function useReceiptView() {
  const t = useTranslations('measures')
  return useCallback(<T extends Record<string, any>>(it: T): T => receiptView(it, t as unknown as (key: string, values?: Record<string, string | number>) => string), [t])
}
