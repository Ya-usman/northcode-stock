'use client'

import { useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { cacheProducts, cacheCustomers, cacheExpenses, cacheCategories } from './db'
import { setPageCache } from './page-cache'

const DATA_TTL  = 60 * 60 * 1000   // données IndexedDB : refresh toutes les heures
const PAGES_TTL = 20 * 60 * 1000   // pages SW : re-fetch toutes les 20 min

// Routes critiques : préchargées en priorité, séquentiellement.
const CRITICAL_ROUTES = [
  'dashboard',
  'sales/new',
  'stock',
  'customers',
]

// Routes secondaires : préchargées après, en parallèle.
const SECONDARY_ROUTES = [
  'expenses',
  'sales/history',
  'payments',
  'reports',
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
// On utilise r.url (URL absolue) comme clé de cache pour correspondre exactement
// à ce que Workbox/le SW stocke lors des vraies navigations.
async function prefetchPage(url: string): Promise<void> {
  const [htmlCache, rscCache] = await Promise.all([
    caches.open('next-pages'),
    caches.open('next-rsc'),
  ])
  const results = await Promise.allSettled([
    fetch(url, { cache: 'no-store' }).then(r => {
      if (r.ok) htmlCache.put(r.url, r)
      return r.ok
    }),
    fetch(url, {
      cache: 'no-store',
      headers: { RSC: '1', 'Next-Router-Prefetch': '1' },
    }).then(r => {
      if (r.ok) rscCache.put(r.url, r)
      return r.ok
    }),
  ])
  // Marquer la route comme disponible hors ligne si au moins un cache a réussi
  const ok = results.some(r => r.status === 'fulfilled' && r.value === true)
  if (ok) {
    try {
      // Extraire le slug de route depuis l'URL (ex: /fr/sales/new → sales/new)
      const slug = url.replace(/^\/[a-z]{2}\//, '')
      localStorage.setItem(`pc_route_${slug}`, String(Date.now()))
    } catch {}
  }
}

async function prefetchAllPages(locale: string): Promise<void> {
  if (!('caches' in window)) return
  // Critiques d'abord, une par une pour garantir leur présence en cache
  for (const r of CRITICAL_ROUTES) {
    await prefetchPage(`/${locale}/${r}`).catch(() => {})
  }
  // Secondaires en parallèle, erreurs silencieuses
  await Promise.allSettled(
    SECONDARY_ROUTES.map(r => prefetchPage(`/${locale}/${r}`))
  )
}

export function useOfflinePreload() {
  const { shop, effectiveShopIds } = useAuth()
  const shopId = shop?.id
  const dataRunning = useRef(false)
  const pagesRunning = useRef(false)
  const lastLocale = useRef('')

  // Précharge toutes les pages SW.
  // Stable ref (useCallback deps vides) — appelé depuis l'effect, l'interval ET le visibilitychange.
  const prefetchPages = useCallback(async (force = false) => {
    if (pagesRunning.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    if (typeof window === 'undefined' || !('caches' in window)) return

    const locale = getLocale()
    const pagesKey = `pc_pages_${locale}`
    if (!force && !shouldRun(pagesKey, PAGES_TTL)) return

    pagesRunning.current = true
    try {
      await prefetchAllPages(locale)

      // Précharger aussi les pages fallback offline (indispensable pour setCatchHandler)
      const htmlCache = await caches.open('next-pages')
      await Promise.allSettled([
        fetch('/offline', { cache: 'no-store' })
          .then(r => { if (r.ok) htmlCache.put('/offline', r) }),
        fetch(`/${locale}/offline`, { cache: 'no-store' })
          .then(r => { if (r.ok) htmlCache.put(`/${locale}/offline`, r) }),
      ])

      markDone(pagesKey)
      // Notifier l'UI que le cache hors ligne est prêt (une seule fois par session)
      if (typeof window !== 'undefined'
          && !sessionStorage.getItem('offline_ready_notified')) {
        sessionStorage.setItem('offline_ready_notified', '1')
        window.dispatchEvent(new CustomEvent('offline-cache-ready'))
      }
    } catch {
      // Silencieux — hors ligne ou réseau indisponible
    } finally {
      pagesRunning.current = false
    }
  }, [])

  useEffect(() => {
    if (!shopId || !effectiveShopIds.length) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    const supabase = createClient() as any
    const locale = getLocale()
    const newLocale = lastLocale.current !== locale
    lastLocale.current = locale

    async function preload() {
      try {
        // ── 1. Données IndexedDB (produits, clients, dépenses, catégories) ──
        const dataKey = `pc_data_${shopId}`
        if (!dataRunning.current && shouldRun(dataKey, DATA_TTL)) {
          dataRunning.current = true
          try {
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

            // Alimenter le page-cache de la page Stock pour qu'elle affiche
            // les produits hors ligne sans jamais avoir été ouverte en ligne.
            // La page Stock lit pc_stock_* via getPageCache() comme fallback.
            try {
              setPageCache(`stock_${shopIds.join(',')}`, {
                prods: products || [],
                cats: categories || [],
                sups: [],
              })
            } catch {}
          } finally {
            dataRunning.current = false
          }
        }

        // ── 2. Cache SW : pages HTML + payloads RSC ──────────────────────────
        await prefetchPages(newLocale) // force si changement de locale
      } catch {
        // Silencieux
      }
    }

    // Premier lancement : démarrer immédiatement pour peupler le cache SW avant
    // que l'utilisateur ne navigue. Lancements suivants : délai de 1s.
    const isFirstRun = !localStorage.getItem(`pc_pages_${getLocale()}`)
    const timer = setTimeout(preload, isFirstRun ? 0 : 1000)

    // Re-précharger les pages toutes les 20 min dans la même session
    const interval = setInterval(() => prefetchPages(), PAGES_TTL)

    // Re-précharger quand l'utilisateur revient sur l'onglet / l'app
    const onVisibility = () => {
      if (document.visibilityState === 'visible') prefetchPages()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearTimeout(timer)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, prefetchPages])
}
