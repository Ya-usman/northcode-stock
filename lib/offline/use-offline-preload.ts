'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { cacheProducts, cacheCustomers, cacheExpenses, cacheCategories } from './db'

const DATA_TTL  = 1 * 60 * 60 * 1000   // rafraîchir les données IndexedDB toutes les heures
const PAGES_TTL = 4 * 60 * 60 * 1000   // rafraîchir le cache des pages toutes les 4h

// Toutes les routes navigables (relative à /{locale}/)
// IMPORTANT : toute route accessible via la nav doit être listée ici —
// une route absente du cache SW déclenche l'erreur Android native hors ligne.
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
  'shops',
  'billing',
  'settings',
  'expenses',
  'help',
  'notes',
]

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

// Précharge une page : HTML (navigation dure) + payload RSC (navigation client).
// Stocke directement dans le cache SW pour que StaleWhileRevalidate serve
// instantanément même hors ligne.
async function prefetchPage(url: string): Promise<void> {
  const [htmlCache, rscCache] = await Promise.all([
    caches.open('next-pages'),
    caches.open('next-rsc'),
  ])
  await Promise.allSettled([
    fetch(url, { cache: 'no-store' }).then(r => {
      if (r.ok) htmlCache.put(url, r)
    }),
    fetch(url, {
      cache: 'no-store',
      headers: { RSC: '1', 'Next-Router-Prefetch': '1' },
    }).then(r => {
      if (r.ok) rscCache.put(url, r)
    }),
  ])
}

// Précharge toutes les routes en parallèle.
// Avec StaleWhileRevalidate côté SW, chaque navigation ultérieure
// est servie depuis ce cache — zéro attente réseau.
async function prefetchAllPages(locale: string): Promise<void> {
  if (!('caches' in window)) return
  await Promise.allSettled(
    APP_ROUTES.map(r => prefetchPage(`/${locale}/${r}`))
  )
}

export function useOfflinePreload() {
  const { shop, effectiveShopIds } = useAuth()
  const shopId = shop?.id
  const runningRef  = useRef(false)
  const lastLocale  = useRef('')

  useEffect(() => {
    if (!shopId || !effectiveShopIds.length) return
    if (runningRef.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    runningRef.current = true
    const supabase   = createClient() as any
    const locale     = getLocale()
    const dataKey    = `pc_data_${shopId}`
    const pagesKey   = `pc_pages_${locale}`
    const newLocale  = lastLocale.current !== locale
    lastLocale.current = locale

    async function preload() {
      try {
        // ── 1. Données IndexedDB (produits, clients, dépenses, catégories) ──
        if (shouldRun(dataKey, DATA_TTL)) {
          const shopIds = effectiveShopIds
          const [
            { data: products },
            { data: customers },
            { data: expenses },
            { data: categories },
          ] = await Promise.all([
            supabase
              .from('products')
              .select('id, shop_id, name, sku, selling_price, buying_price, quantity, category_id, is_active, tax_rate')
              .in('shop_id', shopIds).eq('is_active', true).order('name'),
            supabase
              .from('customers')
              .select('id, shop_id, name, phone, total_debt')
              .in('shop_id', shopIds).order('name'),
            supabase
              .from('expenses')
              .select('id, shop_id, amount, description, date, category, payment_method, is_recurring')
              .in('shop_id', shopIds).eq('is_recurring', false)
              .order('date', { ascending: false }).limit(200),
            supabase
              .from('categories')
              .select('id, shop_id, name, name_hausa')
              .in('shop_id', shopIds).order('name'),
          ])

          for (const sid of shopIds) {
            if (products?.length) {
              const batch = products.filter((p: any) => p.shop_id === sid)
              if (batch.length) await cacheProducts(sid, batch)
            }
            if (customers?.length) {
              const batch = customers.filter((c: any) => c.shop_id === sid)
              if (batch.length) await cacheCustomers(sid, batch)
            }
            if (expenses?.length) {
              const batch = expenses.filter((e: any) => e.shop_id === sid)
              if (batch.length) await cacheExpenses(sid, batch)
            }
            if (categories?.length) {
              const batch = categories.filter((c: any) => c.shop_id === sid)
              if (batch.length) await cacheCategories(sid, batch)
            }
          }
          markDone(dataKey)
        }

        // ── 2. Cache SW : pages HTML + payloads RSC ──────────────────────────
        if (shouldRun(pagesKey, PAGES_TTL) || newLocale) {
          await prefetchAllPages(locale)

          // Précharger aussi les pages offline (fallback SW)
          const htmlCache = await caches.open('next-pages')
          await Promise.allSettled([
            fetch('/offline', { cache: 'no-store' })
              .then(r => { if (r.ok) htmlCache.put('/offline', r) }),
            fetch(`/${locale}/offline`, { cache: 'no-store' })
              .then(r => { if (r.ok) htmlCache.put(`/${locale}/offline`, r) }),
          ])
          markDone(pagesKey)
        }
      } catch {
        // Silencieux — hors ligne ou réseau indisponible
      } finally {
        runningRef.current = false
      }
    }

    // Délai court pour ne pas concurrencer le rendu initial de la page
    const timer = setTimeout(preload, 1000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])
}
