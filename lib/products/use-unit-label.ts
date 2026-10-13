'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { PRODUCT_UNITS } from '@/lib/import/products-import'

// Libellé d'une unité de produit dans la langue de l'écran, accordé à la
// quantité (« 1 paquet », « 28 paquets » ; « 1 piece », « 3 pieces »).
// La base enregistre une clé technique (piece, pack, bag…) : elle ne doit
// jamais être affichée telle quelle. Une unité hors liste (ancienne saisie
// libre) est rendue inchangée.
export function useUnitLabel() {
  const t = useTranslations('unit_labels')
  return useCallback((unit: string | null | undefined, count: number | string | null | undefined = 1): string => {
    if (!unit) return ''
    if (!(PRODUCT_UNITS as readonly string[]).includes(unit)) return unit
    const n = Number(count)
    return t(unit as any, { count: Number.isFinite(n) ? Math.abs(n) : 1 })
  }, [t])
}
