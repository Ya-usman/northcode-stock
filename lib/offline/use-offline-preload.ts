'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { cacheProducts, cacheCustomers } from './db'

const DATA_TTL  = 60 * 60 * 1000       // re-cache data every hour
const PAGES_TTL =  6 * 60 * 60 * 1000  // re-cache pages every 6h

// All navigable app routes (relative to /{locale}/)
const APP_ROUTES = [
  'dashboard',
  'sales/new',
  'sales/history',
  'stock',
  'stock/movements',
  'customers',
  'suppliers',
  'payments',
  'reports',
  'categories',
  'team',
  'settings',
  'expenses',
  'help',
  'notes',
]

// Absolute routes pre-cached regardless of locale (offline fallback page)
const ABSOLUTE_ROUTES = ['/offline']

function getLocale(): string {
  if (typeof window === 'undefined') return 'fr'
  return window.location.pathname.split('/')[1] || 'fr'
}

function shouldRun(key: string, ttl: number): boolean {
  try {
    const ts = localStorage.getItem(key)
    return !ts || Date.now() - Number(ts) > ttl
  } catch { return true }
}

function markDone(key: string): void {
  try { localStorage.setItem(key, String(Date.now())) } catch {}
}

// Pre-fetch a page as both HTML (hard-nav) and RSC payload (client-nav).
// Both responses go through the service worker which stores them in cache.
async function prefetchPage(url: string): Promise<void> {
  const htmlCache = await caches.open('next-pages')
  const rscCache  = await caches.open('next-rsc')

  await Promise.allSettled([
    fetch(url).then(r => { if (r.ok) htmlCache.put(url, r) }),
    fetch(url, { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } })
      .then(r => { if (r.ok) rscCache.put(url, r) }),
  ])
}

// Pre-fetch all routes in batches of 3 to avoid saturating the connection
async function prefetchAllPages(locale: string): Promise<void> {
  if (!('caches' in window)) return
  const batch = 3
  for (let i = 0; i < APP_ROUTES.length; i += batch) {
    await Promise.allSettled(
      APP_ROUTES.slice(i, i + batch).map(r => prefetchPage(`/${locale}/${r}`))
    )
  }
}

export function useOfflinePreload() {
  const { shop, effectiveShopIds } = useAuth()
  const shopId = shop?.id
  const runningRef = useRef(false)

  useEffect(() => {
    if (!shopId || !effectiveShopIds.length) return
    if (runningRef.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    runningRef.current = true
    const supabase = createClient() as any
    const locale    = getLocale()
    const dataKey   = `pc_data_${shopId}`
    const pagesKey  = `pc_pages_${locale}`

    async function preload() {
      try {
        // ── 1. Cache products + customers in IndexedDB (for offline sales) ──
        if (shouldRun(dataKey, DATA_TTL)) {
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
          markDone(dataKey)
        }

        // ── 2. Pre-fetch all page HTML + RSC payloads into SW cache ──────────
        if (shouldRun(pagesKey, PAGES_TTL)) {
          await prefetchAllPages(locale)
          // Also cache absolute routes (offline fallback page)
          const htmlCache = await caches.open('next-pages')
          await Promise.allSettled(
            ABSOLUTE_ROUTES.map(url =>
              fetch(url).then(r => { if (r.ok) htmlCache.put(url, r) })
            )
          )
          markDone(pagesKey)
        }
      } catch {
        // Silent — offline or fetch failed
      } finally {
        runningRef.current = false
      }
    }

    // Small delay so the initial page render is not competing with pre-fetches
    const timer = setTimeout(preload, 3000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])
}
