'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Sale, Product } from '@/lib/types/database'

interface RealtimeHandlers {
  onNewSale?: (sale: Sale) => void
  onProductUpdate?: (product: Product) => void
  onPaymentUpdate?: (payload: any) => void
}

export function useDashboardRealtime(shopId: string | null, handlers: RealtimeHandlers) {
  const supabase = createClient()
  const channelRef = useRef<any>(null)

  useEffect(() => {
    if (!shopId) return

    const channel = supabase
      .channel('dashboard-live')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sales',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          handlers.onNewSale?.(payload.new as Sale)
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
          handlers.onProductUpdate?.(payload.new as Product)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'payments',
        },
        (payload) => {
          handlers.onPaymentUpdate?.(payload.new)
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [shopId])
}

export function useStockRealtime(shopId: string | null, onUpdate: (product: Product) => void) {
  const supabase = createClient()

  useEffect(() => {
    if (!shopId) return

    const channel = supabase
      .channel('stock-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'products',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          onUpdate(payload.new as Product)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [shopId, onUpdate])
}
