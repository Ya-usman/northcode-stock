'use client'

import { useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { cacheProducts, cacheCustomers } from './db'

const DATA_TTL  = 60 * 60 * 1000   // données IndexedDB : refresh toutes les heures
const PAGES_TTL = 20 * 60 * 1000   // pages SW : re-fetch toutes les 20 min

// ── Préchargement des images produit ──────────────────────────────────────
// Même cache que la règle Workbox CacheFirst de next.config.js
// (`supabase-storage`) : une fois une image mise ici, un <img src=...>
// hors-ligne la trouve directement via le Service Worker, sans rien changer
// côté rendu. Préchargement EXPLICITE et déterministe (toutes les images des
// produits actifs des boutiques de l'utilisateur), pas une dépendance au
// hasard de ce qui a été scrollé à l'écran en ligne — voir la discussion du
// 2026-10-03 : le cache LRU seul (maxEntries/maxAgeSeconds) n'est qu'un
// filet de sécurité, jamais une garantie de couverture complète.
const IMAGE_CACHE_NAME = 'supabase-storage'
const IMAGE_CONCURRENCY = 6
// Ne lance aucun nouveau téléchargement d'image au-delà de 85% du quota de
// stockage du navigateur — dégradation propre sur un appareil déjà plein,
// plutôt qu'un échec silencieux ou un navigateur qui se met à purger
// lui-même d'autres caches (pages, données).
const STORAGE_SAFETY_RATIO = 0.85

async function hasStorageHeadroom(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return true
    const { usage, quota } = await navigator.storage.estimate()
    if (!quota) return true
    return (usage ?? 0) / quota < STORAGE_SAFETY_RATIO
  } catch { return true }
}

// Précharge une liste d'URLs d'images produit dans le cache SW, par lots
// (jamais tout d'un coup — ne pas saturer une connexion 3G pendant que le
// vendeur travaille), en sautant celles déjà en cache (un re-passage horaire
// ne retélécharge donc que les images réellement nouvelles).
async function prefetchProductImages(urls: Array<string | null | undefined>): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return
  const unique = Array.from(new Set(urls.filter((u): u is string => !!u)))
  if (unique.length === 0) return
  if (!(await hasStorageHeadroom())) return

  const cache = await caches.open(IMAGE_CACHE_NAME)
  const missing: string[] = []
  for (const url of unique) {
    if (!(await cache.match(url))) missing.push(url)
  }
  if (missing.length === 0) return

  for (let i = 0; i < missing.length; i += IMAGE_CONCURRENCY) {
    if (!(await hasStorageHeadroom())) break // re-vérifie entre chaque lot
    const batch = missing.slice(i, i + IMAGE_CONCURRENCY)
    await Promise.allSettled(
      batch.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-store' })
          if (res.ok) await cache.put(url, res)
        } catch {
          // Image indisponible pour l'instant — pas bloquant, retentée au
          // prochain passage (pas marquée "faite" individuellement).
        }
      }),
    )
  }
}

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
  'categories',
  'stock/movements',
  'suppliers',
  'team',
  'caisse',
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

export function useOfflinePreload(isOnline: boolean) {
  const { shop, effectiveShopIds } = useAuth()
  const shopId = shop?.id
  const dataRunning = useRef(false)
  const pagesRunning = useRef(false)
  const lastLocale = useRef('')
  // isOnline comes from useOffline() (verified via a real request) — kept in a
  // ref so prefetchPages/the main effect below can read the current value
  // without navigator.onLine's unreliability, while prefetchPages itself
  // stays a stable callback (empty deps — called from the effect, the
  // interval, AND the visibilitychange listener).
  const isOnlineRef = useRef(isOnline)
  useEffect(() => { isOnlineRef.current = isOnline }, [isOnline])

  // Précharge toutes les pages SW.
  // Stable ref (useCallback deps vides) — appelé depuis l'effect, l'interval ET le visibilitychange.
  const prefetchPages = useCallback(async (force = false) => {
    if (pagesRunning.current) return
    if (!isOnlineRef.current) return
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
    } catch {
      // Silencieux — hors ligne ou réseau indisponible
    } finally {
      pagesRunning.current = false
    }
  }, [])

  useEffect(() => {
    if (!shopId || !effectiveShopIds.length) return
    if (!isOnline) return

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
            ] = await Promise.all([
              supabase
                .from('products')
                .select('id, shop_id, name, sku, selling_price, buying_price, quantity, category_id, is_active, image_url')
                .in('shop_id', shopIds).eq('is_active', true).order('name'),
              supabase
                .from('customers')
                .select('id, shop_id, name, phone, total_debt')
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
            }

            // ── Images produit : couverture déterministe de TOUT le
            // catalogue actif des boutiques de l'utilisateur, pas seulement
            // ce qui a été vu à l'écran. Ne bloque pas la suite si ça échoue
            // (pas de réseau pour une image, quota plein…) — silencieux,
            // retente au prochain passage.
            if (products?.length) {
              await prefetchProductImages(products.map((p: any) => p.image_url)).catch(() => {})
            }

            markDone(dataKey)
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
  }, [shopId, prefetchPages, isOnline])
}
