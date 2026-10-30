'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Calendar, Package, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { ShopScopeBadge } from '@/components/shops/shop-scope-badge'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { withTimeout } from '@/lib/utils/with-timeout'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils/cn'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { MovementList } from '@/components/stock/movement-list'
import { MovementDetailDrawer, type MovementRow } from '@/components/stock/movement-detail-drawer'
import { ProductSheetViewer } from '@/components/stock/product-sheet-viewer'
import { MOVEMENT_SEARCH_MIN, sanitizeMovementSearch } from '@/lib/stock/movement-label'

// Onglet Mouvements : UNE liste, du plus récent au plus ancien, de tout ce qui
// a fait bouger le stock (entrées, ventes, ajustements, transferts). Par
// défaut : tout. Au-dessus : le type (pastilles), une recherche unique
// (produit, référence, employé) et la période. Toucher une ligne ouvre le
// détail de CE mouvement dans le panneau commun ; rien n'est rechargé, on
// retrouve la liste où on l'a laissée. Le filtre « un produit » arrive de la
// fiche produit (« Tout voir ») : une pastille le rappelle et le retire, sans
// toucher aux autres filtres.

interface Movement extends MovementRow {
  product_current_qty: number | null
}

const KINDS = ['all', 'in', 'sale', 'adjustment', 'transfer'] as const
type Kind = typeof KINDS[number]
const MAX_ROWS = 500

export default function StockMovementsPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('movements')
  const tNav = useTranslations('nav')
  const unitLabel = useUnitLabel()
  const router = useRouter()
  const { effectiveShopIds, shop, userShops } = useAuth()
  const { canAccess } = useRolePermissions()
  // Même droit que l'onglet : sans lui, l'adresse tapée à la main ne charge et n'affiche rien
  const canSee = canAccess('movements')
  const { isOnline } = useOffline()
  const [{ search, dateFrom, dateTo, kind: storedKind }, setFilter] = usePersistedFilters(
    'movements', shop?.id, { search: '', dateFrom: '', dateTo: '', kind: 'all' as string }
  )
  const kind: Kind = (KINDS as readonly string[]).includes(storedKind) ? storedKind as Kind : 'all'

  // Filtre « un seul produit », porté par l'adresse (?product=…) : c'est le même écran, déjà filtré.
  // Il n'est pas mémorisé avec les autres filtres : retiré, on revient à tous les mouvements.
  const searchParams = useSearchParams()
  const productParam = searchParams.get('product')
  const productFilter = productParam && /^[0-9a-f-]{36}$/i.test(productParam) ? productParam : null
  const [productName, setProductName] = useState<string | null>(null)

  // Recherche : envoyée au serveur une fois la frappe posée (elle porte sur tout l'historique, pas seulement
  // sur les lignes déjà chargées)
  const [typed, setTyped] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => setTyped(search), 300)
    return () => clearTimeout(id)
  }, [search])
  const cleaned = sanitizeMovementSearch(typed)
  const q = cleaned.length >= MOVEMENT_SEARCH_MIN ? cleaned : ''

  // « Tout voir » de la fiche produit : TOUS les mouvements de ce produit — les filtres laissés ici la dernière
  // fois (type, dates, recherche) sont remis à zéro, puis l'adresse ne garde que le produit.
  const fromSheet = searchParams.get('all') === '1'
  useEffect(() => {
    if (!fromSheet || !productFilter) return
    setFilter({ kind: 'all', dateFrom: '', dateTo: '', search: '' })
    setTyped('')
    router.replace(`/${locale}/stock/movements?product=${productFilter}`)
  }, [fromSheet, productFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const shopKey = effectiveShopIds.join(',')
  // Les filtres en cours, sous la forme envoyée au serveur
  const query = useMemo(() => {
    const params = new URLSearchParams({ shop_ids: shopKey })
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to', dateTo)
    if (kind !== 'all') params.set('kind', kind)
    if (productFilter) params.set('product_id', productFilter)
    if (q) params.set('q', q)
    return params.toString()
  }, [shopKey, dateFrom, dateTo, kind, productFilter, q])
  // La liste est rangée AVEC les filtres qui l'ont produite : dès qu'un filtre change, l'ancienne liste n'est
  // plus affichée (sinon, un instant, le résumé d'un produit porterait sur tous les produits).
  const [loaded, setLoaded] = useState<{ query: string; list: Movement[] } | null>(null)
  const movements = loaded && loaded.query === query ? loaded.list : null
  const queryRef = useRef(query)
  queryRef.current = query

  const fetchMovements = useCallback(() => {
    if (!shopKey || !canSee) return
    // Une recherche n'est pas gardée sur l'appareil : chaque mot tapé y laisserait une liste
    const cacheKey = q ? null : `movements_v2_${query}`
    const cached = cacheKey ? getPageCache<Movement[]>(cacheKey) : null
    if (cached) setLoaded(prev => (prev?.query === query ? prev : { query, list: cached }))

    // Bounded so a stale connection/session after the app sat backgrounded a
    // while can never leave the list loading forever.
    withTimeout(fetch(`/api/stock/movements?${query}`), 20_000, 'Chargement des mouvements trop lent — réessayez.')
      .then(r => r.json())
      .then(data => {
        const list: Movement[] = data.movements || []
        if (cacheKey) setPageCache(cacheKey, list)
        // Réponse arrivée après un changement de filtre : gardée en cache, pas affichée
        if (queryRef.current === query) setLoaded({ query, list })
      })
      .catch(() => { if (queryRef.current === query) setLoaded(prev => (prev?.query === query ? prev : { query, list: [] })) })
  }, [shopKey, query, q, canSee])

  useEffect(() => { fetchMovements() }, [fetchMovements])
  // Refresh when the user comes back to this tab — catches restocks/
  // adjustments made by other team members in the meantime.
  useRefetchOnVisible(fetchMovements)
  useRefetchOnReconnect(fetchMovements, isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

  // Nom du produit filtré, pour la pastille (même sans aucun mouvement sur la période)
  useEffect(() => {
    setProductName(null)
    if (!productFilter) return
    let alive = true
    ;(createClient() as any).from('products').select('name').eq('id', productFilter).maybeSingle()
      .then(({ data }: any) => { if (alive && data?.name) setProductName(data.name) })
    return () => { alive = false }
  }, [productFilter])

  // Résumé du produit filtré (l'ancien tableau par produit) : stock de base, réapprovisionné, stock actuel.
  // Pas pendant une recherche : il ne porterait que sur les lignes trouvées.
  const summary = useMemo(() => {
    if (!productFilter || !movements || q) return null
    let initial: number | null = null, restocked = 0, restocks = 0, current: number | null = null, unit: string | null = null
    for (const m of movements) {
      if (m.product_current_qty != null) current = m.product_current_qty
      if (m.product_unit) unit = m.product_unit
      if (m.type !== 'in') continue
      if (m.reason === 'Stock initial') initial = m.new_qty
      else if (/^Restock|^Réception /.test(m.reason || '')) { restocked += Number(m.quantity) || 0; restocks++ }
    }
    return { initial, restocked, restocks, current, unit }
  }, [productFilter, movements, q])

  // Détail d'un mouvement, et fiche du produit ouverte depuis ce détail : deux panneaux au-dessus de la liste,
  // qui reste telle quelle dessous (filtres, recherche, position)
  const [selected, setSelected] = useState<Movement | null>(null)
  const [sheetProductId, setSheetProductId] = useState<string | null>(null)
  // « Tout voir » de la fiche : l'écran se filtre sur le produit, les panneaux se referment
  useEffect(() => { setSelected(null); setSheetProductId(null) }, [productFilter])

  // Pastilles de type : défilement horizontal sur petit écran, bord estompé du côté où il reste des pastilles,
  // pastille choisie ramenée entièrement en vue
  const pillsRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })
  const updateFade = useCallback(() => {
    const el = pillsRef.current
    if (!el) return
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setFade(prev => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])
  useEffect(() => {
    updateFade()
    window.addEventListener('resize', updateFade)
    return () => window.removeEventListener('resize', updateFade)
  }, [updateFade])
  useEffect(() => {
    const el = pillsRef.current
    const active = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!el || !active) return
    const left = active.offsetLeft - 28, right = active.offsetLeft + active.offsetWidth + 28
    if (left < el.scrollLeft) el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
    else if (right > el.scrollLeft + el.clientWidth) el.scrollTo({ left: right - el.clientWidth, behavior: 'smooth' })
  }, [kind])

  const clearProduct = () => router.replace(`/${locale}/stock/movements`)
  const chipName = productName || movements?.find(m => m.product_name)?.product_name || t('product')
  const kindLabel: Record<Kind, string> = { all: t('kind_all'), in: t('kind_in'), sale: t('kind_sale'), adjustment: t('kind_adjustment'), transfer: t('kind_transfer') }
  // Une boutique précise : son nom n'est pas répété sur chaque ligne ; « Toutes les boutiques » : il l'est
  const severalShops = effectiveShopIds.length > 1
  const shopName = useCallback((id: string) => userShops.find(s => s.id === id)?.name, [userShops])
  const mask = fade.left || fade.right
    ? `linear-gradient(to right, ${fade.left ? 'transparent 0, #000 28px' : '#000 0'}, ${fade.right ? '#000 calc(100% - 28px), transparent 100%' : '#000 100%'})`
    : undefined

  if (!canSee) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center" data-testid="movements-no-access">
        <p className="text-sm text-muted-foreground">{tNav('no_access')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Type de mouvement : « Tous » par défaut, un toucher pour filtrer */}
      <div
        ref={pillsRef}
        onScroll={updateFade}
        role="group"
        aria-label={t('kind_label')}
        data-testid="movements-kinds"
        className="relative -my-1.5 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        <div className="flex w-max gap-1.5">
          {KINDS.map(k => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setFilter({ kind: k })}
              data-kind={k}
              className={cn(
                // Zone tactile de 48 px de haut (la pastille en fait 40) sans épaissir la barre
                'relative h-10 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors before:absolute before:inset-x-0 before:-inset-y-[5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:px-3.5',
                kind === k
                  ? 'border-stockshop-blue bg-stockshop-blue text-white dark:border-blue-500 dark:bg-blue-500'
                  : 'border-border bg-card text-foreground hover:bg-muted',
              )}
            >
              {kindLabel[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={e => setFilter({ search: e.target.value })}
            placeholder={t('search_placeholder')}
            aria-label={t('search_placeholder')}
            className="h-10 pl-9 sm:h-9"
            data-testid="movements-search"
          />
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <Input type="date" value={dateFrom} onChange={e => setFilter({ dateFrom: e.target.value })} className="h-10 w-[130px] text-xs sm:h-9" aria-label={t('date_from')} />
          <span className="text-xs text-muted-foreground">→</span>
          <Input type="date" value={dateTo} onChange={e => setFilter({ dateTo: e.target.value })} className="h-10 w-[130px] text-xs sm:h-9" aria-label={t('date_to')} />
        </div>
      </div>

      {productFilter && (
        // Filtre produit : toujours visible, retiré d'un toucher — le type, la période et la recherche restent
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-stockshop-blue/30 bg-stockshop-blue-muted py-1 pl-3 pr-1 text-sm text-stockshop-blue dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300" data-testid="movements-product-filter">
          <Package className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{t('product')} : <strong className="font-semibold">{chipName}</strong></span>
          <button
            type="button"
            onClick={clearProduct}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-stockshop-blue/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-blue-900/50"
            aria-label={t('filter_product_remove')}
            title={t('filter_product_remove')}
          >
            <X className="h-4 w-4" />
          </button>
        </span>
      )}

      {summary && (
        <dl className="grid grid-cols-3 divide-x rounded-xl border bg-card text-center shadow-sm" data-testid="movements-product-summary">
          <div className="px-2 py-3">
            <dt className="text-xs text-muted-foreground">{t('initial_stock')}</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums">{summary.initial ?? '—'}</dd>
          </div>
          <div className="px-2 py-3">
            <dt className="text-xs text-muted-foreground">{t('restocked')}</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-green-600 dark:text-green-400">
              {summary.restocks ? <>+{summary.restocked} <span className="text-[11px] font-normal text-muted-foreground">{summary.restocks}×</span></> : '—'}
            </dd>
          </div>
          <div className="px-2 py-3">
            <dt className="text-xs text-muted-foreground">{t('current_stock')}</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums">
              {summary.current ?? '—'}{summary.current != null && summary.unit && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{unitLabel(summary.unit, summary.current)}</span>}
            </dd>
          </div>
        </dl>
      )}

      {movements === null && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
        <LoadErrorFallback />
      ) : movements === null ? (
        <div className="space-y-1">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="movements-count">
            <ShopScopeBadge />
            {t('product_movements_count', { count: movements.length })}
            {movements.length >= MAX_ROWS && <> · {t('latest_shown', { count: MAX_ROWS })}</>}
          </p>
          {movements.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">{q ? t('no_search_results') : t('no_movements')}</div>
          ) : (
            <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
              <MovementList
                movements={movements}
                showProduct={!productFilter}
                groupByDay
                onOpen={setSelected}
                shopName={severalShops ? shopName : undefined}
              />
            </div>
          )}
        </>
      )}

      <MovementDetailDrawer
        movement={selected}
        onClose={() => setSelected(null)}
        showShop={userShops.length > 1}
        onViewProduct={canAccess('stock') ? setSheetProductId : undefined}
      />
      <ProductSheetViewer productId={sheetProductId} onClose={() => setSheetProductId(null)} />
    </div>
  )
}
