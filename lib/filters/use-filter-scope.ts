'use client'

import { useMemo } from 'react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { filterScopeKey } from '@/lib/filters/multi-select'

/**
 * Clé de mémoire des filtres pour le contexte réel de l'en-tête : la boutique
 * choisie, ou « Toutes les boutiques » de ce compte. À passer à
 * usePersistedFilters / presetPersistedFilters à la place de la boutique active.
 */
export function useFilterScope(): string | null {
  const { dashboardShopFilter, userShops } = useAuthContext()
  const ids = userShops.map(s => s.id).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => filterScopeKey(dashboardShopFilter, userShops.map(s => s.id)), [dashboardShopFilter, ids])
}
