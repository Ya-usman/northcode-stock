'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { cacheProducts, cacheCustomers } from './db'

const TTL = 60 * 60 * 1000 // 1 hour between pre-loads

function shouldPreload(shopId: string): boolean {
  try {
    const ts = localStorage.getItem(`pc_preload_${shopId}`)
    return !ts || Date.now() - Number(ts) > TTL
  } catch { return true }
}

function markPreloaded(shopId: string): void {
  try { localStorage.setItem(`pc_preload_${shopId}`, String(Date.now())) } catch {}
}

export function useOfflinePreload() {
  const { shop, effectiveShopIds } = useAuth()
  const shopId = shop?.id
  const runningRef = useRef(false)

  useEffect(() => {
    if (!shopId || !effectiveShopIds.length) return
    if (runningRef.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    if (!shouldPreload(shopId)) return

    runningRef.current = true
    const supabase = createClient() as any

    async function preload() {
      try {
        const shopIds = effectiveShopIds
        const [{ data: products }, { data: customers }] = await Promise.all([
          supabase
            .from('products')
            .select('id, shop_id, name, sku, selling_price, buying_price, quantity, category_id, is_active, tax_rate')
            .in('shop_id', shopIds)
            .eq('is_active', true)
            .order('name'),
          supabase
            .from('customers')
            .select('id, shop_id, name, phone, total_debt')
            .in('shop_id', shopIds)
            .order('name'),
        ])

        if (products?.length) {
          for (const sid of shopIds) {
            const batch = products.filter((p: any) => p.shop_id === sid)
            if (batch.length) await cacheProducts(sid, batch)
          }
        }

        if (customers?.length) {
          for (const sid of shopIds) {
            const batch = customers.filter((c: any) => c.shop_id === sid)
            if (batch.length) await cacheCustomers(sid, batch)
          }
        }

        markPreloaded(shopId)
      } catch {
        // Silent failure — user is offline or not yet authenticated
      } finally {
        runningRef.current = false
      }
    }

    preload()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])
}
