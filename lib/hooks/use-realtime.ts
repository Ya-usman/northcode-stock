'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Sale, Product } from '@/lib/types/database'

// Singleton — évite la création de clients multiples et les conflits WebSocket
const supabase = createClient()

interface RealtimeHandlers {
  onNewSale?: (sale: Sale) => void
  onSaleCancelled?: (sale: Sale) => void
  onProductUpdate?: (product: Product) => void
  onPaymentUpdate?: (payload: any) => void
}

export function useDashboardRealtime(shopId: string | null, handlers: RealtimeHandlers) {
  const channelRef = useRef<any>(null)
  const handlersRef = useRef(handlers)
  // Keep handlers ref current on every render so callbacks never go stale
  handlersRef.current = handlers

  useEffect(() => {
    if (!shopId) return

    const channel = supabase
      .channel(`dashboard-live-${shopId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sales',
          filter: `shop_id=eq.${shopId}`,
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
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          const updated = payload.new as Sale
          if ((updated as any).sale_status === 'cancelled') {
            handlersRef.current.onSaleCancelled?.(updated)
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
          handlersRef.current.onProductUpdate?.(payload.new as Product)
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
          handlersRef.current.onPaymentUpdate?.(payload.new)
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
          onUpdateRef.current(payload.new as Product)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [shopId])
}
