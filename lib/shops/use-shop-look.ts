'use client'

import { useCallback } from 'react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { shopShortLabel } from '@/lib/shops/short-name'

export interface ShopLook {
  /** Nom court (choisi, sinon règle automatique, sinon nom complet) */
  label: string
  /** Nom complet (info-bulle, documents) */
  full: string
  /** Objet pour ShopMark / ShopDot (couleur, initiales) */
  shop: { id: string; name: string; short_name?: string | null; entity_name?: string | null; color?: string | null }
}

// Apparence d'une boutique à partir de son identifiant (31 oct. 2026, migration 191) : nom court + couleur, pris
// dans les boutiques de la personne. Boutique hors de sa liste (autre boutique de l'entreprise) : nom fourni par
// le serveur, couleur stable tirée de l'identifiant.
export function useShopLook(): (id: string | null | undefined, fallbackName?: string | null) => ShopLook {
  const { userShops } = useAuthContext()
  return useCallback((id, fallbackName) => {
    const s = id ? userShops.find(x => x.id === id) : undefined
    if (s) return { label: shopShortLabel(s), full: s.name, shop: s as ShopLook['shop'] }
    const name = fallbackName ?? ''
    return { label: name, full: name, shop: { id: id ?? '', name } }
  }, [userShops])
}
