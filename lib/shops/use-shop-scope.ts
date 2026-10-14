'use client'

import { useCallback, useMemo } from 'react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { shortShopName } from '@/lib/shops/short-name'
import { useShopPicker, type ShopPickOptions } from '@/components/shops/shop-picker'
import type { Shop } from '@/lib/types/database'

// ── Contexte boutique d'une page ─────────────────────────────────────────────
// Une seule source de vérité : le sélecteur de l'en-tête (une boutique, ou « Toutes les boutiques »).
// La « boutique active » interne (auth-context `shop`) n'est JAMAIS utilisée ici : en « Toutes les
// boutiques », elle reste une boutique cachée, et aucune donnée ne doit y être écrite en silence.
// companyView : la page est volontairement indépendante du sélecteur (Équipe, Boutiques…).

export type ShopScopeMode = 'all_shops' | 'single_shop' | 'company'

export interface ShopScope {
  mode: ShopScopeMode
  /** Le compte a plusieurs boutiques (sinon aucun indicateur n'est utile) */
  multiShop: boolean
  isAllShops: boolean
  isCompanyView: boolean
  /** Boutique du contexte quand l'en-tête en désigne UNE ; null en « Toutes les boutiques » */
  shopId: string | null
  shopName: string | null
  /** « Marché Soleil Akwa » → « Akwa » (règle stricte, lib/shops/short-name) */
  shortName: string | null
  /** Boutiques couvertes par la page (en-tête) */
  shopIds: string[]
  businessId: string | null
  businessName: string | null
  /**
   * Boutique où une action va ÉCRIRE : celle de l'en-tête si elle en désigne une ; en « Toutes les
   * boutiques », la personne la choisit explicitement (null si elle annule). eligible : boutiques où
   * l'action est permise. Jamais de boutique cachée ou précédente.
   */
  requireOneShop: (options?: { title?: string; description?: string; eligible?: (shop: Shop) => boolean }) => Promise<Shop | null>
}

export function useShopScope({ companyView = false }: { companyView?: boolean } = {}): ShopScope {
  const { userShops, effectiveShopIds } = useAuthContext()
  const pick = useShopPicker()
  const multiShop = userShops.length > 1
  const scopedShop = effectiveShopIds.length === 1 ? userShops.find(s => s.id === effectiveShopIds[0]) ?? null : null
  const business = scopedShop ?? userShops[0] ?? null

  const requireOneShop = useCallback<ShopScope['requireOneShop']>(async (options = {}) => {
    const eligible = options.eligible ?? (() => true)
    if (scopedShop) return eligible(scopedShop) ? scopedShop : null
    const pickOptions: ShopPickOptions = { title: options.title, description: options.description, shops: userShops.filter(eligible) }
    return pick(pickOptions)
  }, [scopedShop, userShops, pick])

  return useMemo<ShopScope>(() => ({
    mode: companyView ? 'company' : scopedShop ? 'single_shop' : 'all_shops',
    multiShop,
    isAllShops: !companyView && !scopedShop,
    isCompanyView: companyView,
    shopId: scopedShop?.id ?? null,
    shopName: scopedShop?.name ?? null,
    shortName: scopedShop ? shortShopName(scopedShop.name, scopedShop.entity_name) : null,
    shopIds: effectiveShopIds,
    businessId: business?.entity_id ?? null,
    businessName: business?.entity_name ?? null,
    requireOneShop,
  }), [companyView, scopedShop, multiShop, effectiveShopIds, business, requireOneShop])
}
