'use client'

import { useEffect, useRef } from 'react'
import { withoutProductCost } from '@/lib/products/columns'
import { createClient } from '@/lib/supabase/client'
import type { Sale, Product } from '@/lib/types/database'

// Singleton — évite la création de clients multiples et les conflits WebSocket
const supabase = createClient()

interface RealtimeHandlers {
  onNewSale?: (sale: Sale) => void
  onSaleCancelled?: (sale: Sale) => void
  /** Toute autre modification d'une vente (paiement reçu, remboursement, correction) */
  onSaleUpdated?: (sale: Sale) => void
  onProductUpdate?: (product: Product) => void
}

// Filtre temps réel sur les boutiques affichées : une boutique = égalité, plusieurs = liste (100 au plus, limite du
// filtre « in » du temps réel)
function shopFilter(ids: string[]) {
  const list = ids.slice(0, 100)
  return list.length === 1 ? `shop_id=eq.${list[0]}` : `shop_id=in.(${list.join(',')})`
}

/**
 * Tableau de bord en direct : ventes des boutiques affichées (`saleShopIds`, « Toutes » comprise), alertes de stock de
 * la boutique active. Plus d'écoute de la table des paiements (7 nov. 2026, état des lieux de la montée en charge) : elle
 * n'a pas de colonne boutique, donc chaque paiement de TOUTE la plateforme était confronté aux règles d'accès de chaque
 * tableau de bord ouvert. Un paiement modifie toujours sa vente (création ou remboursement) : écouter les ventes suffit.
 */
export function useDashboardRealtime(shopId: string | null, handlers: RealtimeHandlers, saleShopIds: string[] = []) {
  const channelRef = useRef<any>(null)
  const handlersRef = useRef(handlers)
  // Keep handlers ref current on every render so callbacks never go stale
  handlersRef.current = handlers
  const salesKey = saleShopIds.slice().sort().join(',')

  useEffect(() => {
    if (!shopId) return
    const salesFilter = shopFilter(salesKey ? salesKey.split(',') : [shopId])

    const channel = supabase
      .channel(`dashboard-live-${shopId}-${salesKey.length}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sales',
          filter: salesFilter,
        },
        (payload) => {
          handlersRef.current.onNewSale?.(payload.new as Sale)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sales',
          filter: salesFilter,
        },
        (payload) => {
          const updated = payload.new as Sale
          if ((updated as any).sale_status === 'cancelled') {
            handlersRef.current.onSaleCancelled?.(updated)
          } else {
            handlersRef.current.onSaleUpdated?.(updated)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'products',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          handlersRef.current.onProductUpdate?.(withoutProductCost(payload.new as Product))
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [shopId, salesKey])
}

export function useStockRealtime(shopId: string | null, onUpdate: (product: Product) => void) {
  const onUpdateRef = useRef(onUpdate)
  // Keep the callback ref current on every render so it never goes stale,
  // without resubscribing the channel when the caller passes a new inline function.
  onUpdateRef.current = onUpdate

  useEffect(() => {
    if (!shopId) return

    const channel = supabase
      .channel(`stock-live-${shopId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'products',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          // Le prix d'achat n'entre jamais par ce canal : les écrans qui y ont droit le demandent à /api/costs
          onUpdateRef.current(withoutProductCost(payload.new as Product))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [shopId])
}
