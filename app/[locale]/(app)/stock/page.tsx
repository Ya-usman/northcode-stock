'use client'

import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import { useTranslations } from 'next-intl'
import {
  CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Layers, ListChecks, Package, PackageMinus, PackageX,
  ShoppingCart, Store, Tag, TrendingDown, Wallet, AlertTriangle, Truck, ClipboardList,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useCurrency } from '@/lib/hooks/use-currency'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { getPageCache, setPageCache } from '@/lib/offline/page-cache'
import { presetPersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { withTimeout } from '@/lib/utils/with-timeout'
import { cn } from '@/lib/utils/cn'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { Skeleton } from '@/components/ui/skeleton'
import { StockTabs } from '@/components/stock/stock-tabs'
import { computeStockKpis, fetchExpiryByProduct, fetchExpiredQtyByProduct, fetchSoldQty30dForShops, readSignalsCache, writeSignalsCache, type StockProductLike } from '@/lib/stock/signals'
import { fetchStockPipeline, type StockPipeline } from '@/lib/stock/pipeline'
import { fetchReservedQtyByProduct } from '@/lib/stock/reservations'
import { PRODUCT_PUBLIC_COLUMNS } from '@/lib/products/columns'
import { SUPPLIER_PUBLIC_COLUMNS } from '@/lib/suppliers/columns'
import { fetchCosts, withCosts } from '@/lib/costs/client'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'

// Vue d'ensemble du module Stock : six chiffres clés cliquables (chacun ouvre
// les produits concernés, filtre appliqué par ?status=) et une zone
// « Priorités stock » qui transforme l'état du stock en actions recommandées
// (produits à réapprovisionner, lots à écouler, ventes lentes, promos à revoir
// ou en cours) : les trois plus importantes, le reste à la demande. Aucune donnée inventée : tout vient des produits, des
// lots et des ventes des 30 derniers jours, par les règles partagées de
// lib/stock/signals. Lit le même cache hors ligne que Produits
// (`stock_<boutiques>`) sans jamais l'écraser (sous-ensemble de colonnes).

type CategoryAlert = { id: string; expiry_alert_days: number | null }
type Tone = 'neutral' | 'blue' | 'red' | 'amber' | 'orange' | 'purple'

const TONE: Record<Tone, { card: string; icon: string; value: string }> = {
  neutral: { card: 'border-border bg-card', icon: 'bg-muted text-muted-foreground', value: '' },
  blue: { card: 'border-stockshop-blue/20 bg-stockshop-blue-muted/40 dark:border-blue-900 dark:bg-blue-950/20', icon: 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-900/40 dark:text-blue-400', value: 'text-stockshop-blue dark:text-blue-400' },
  red: { card: 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20', icon: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400', value: 'text-red-600 dark:text-red-400' },
  amber: { card: 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20', icon: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400', value: 'text-amber-600 dark:text-amber-400' },
  orange: { card: 'border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20', icon: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400', value: 'text-orange-600 dark:text-orange-400' },
  purple: { card: 'border-purple-200 bg-purple-50/50 dark:border-purple-900 dark:bg-purple-950/20', icon: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400', value: 'text-purple-600 dark:text-purple-400' },
}

function KpiCard({ id, label, value, hint, actionLabel, icon: Icon, tone = 'neutral', onClick, className }: {
  /** Repère stable de la carte (data-kpi) */
  id: string
  label: string; value: string | number; hint?: string; icon: ComponentType<{ className?: string }>; tone?: Tone; onClick?: () => void
  /** Ce que la carte ouvre, dit aux lecteurs d'écran seulement : à l'écran, le chevron suffit */
  actionLabel?: string
  /** Emprise dans la grille (ex. col-span-2) */
  className?: string
}) {
  const t = TONE[tone]
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p data-kpi-value className={cn('min-w-0 text-2xl font-bold leading-none tabular-nums', t.value)}>{value}</p>
        <span className={cn('shrink-0 rounded-lg p-1.5', t.icon)}><Icon className="h-5 w-5" /></span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-1">
        <p className="min-w-0 text-sm font-medium">{label}</p>
        {onClick && <ChevronRight data-kpi-chevron aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-stockshop-blue dark:group-hover:text-blue-400" />}
      </div>
      {hint && <p data-kpi-hint className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      {onClick && actionLabel && <span className="sr-only">{actionLabel}</span>}
    </>
  )
  const cls = cn('rounded-xl border px-4 py-3 text-left shadow-sm transition-colors', t.card, className)
  return onClick
    ? <button type="button" data-kpi={id} data-tone={tone} onClick={onClick} className={cn(cls, 'group flex flex-col hover:border-stockshop-blue/40 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stockshop-blue/50 active:bg-muted/40')}>{body}</button>
    : <div data-kpi={id} data-tone={tone} className={cls}>{body}</div>
}

// Un indicateur d'alerte à zéro n'est pas un problème : il garde sa place, sans la couleur d'alerte
const alertTone = (count: number, tone: Tone): Tone => (count > 0 ? tone : 'neutral')
// Sur la Vue d'ensemble : les priorités les plus importantes seulement, le reste à la demande
const PRIORITIES_SHOWN = 3

export default function StockOverviewPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const router = useRouter()
  const { shop, effectiveShopIds, profile, roleInActiveShop, userShops } = useAuth()
  const effectiveRole = roleInActiveShop ?? profile?.role
  const { fmt } = useCurrency()
  const { isOnline } = useOffline()
  const supabase = createClient()
  const cacheKey = `stock_${effectiveShopIds.join(',')}`

  const [products, setProducts] = useState<StockProductLike[]>(() => (getPageCache<{ prods: any[] }>(cacheKey)?.prods || []) as StockProductLike[])
  const [categories, setCategories] = useState<CategoryAlert[]>(() => (getPageCache<{ cats: any[] }>(cacheKey)?.cats || []) as CategoryAlert[])
  const [loading, setLoading] = useState(() => !getPageCache(cacheKey))
  // Signaux : repris du cache local partagé avec Produits, rafraîchis ensuite
  const [expiryByProduct, setExpiryByProduct] = useState<Record<string, string>>(() => readSignalsCache(effectiveShopIds)?.expiryByProduct ?? {})
  const [soldQtyByProduct, setSoldQtyByProduct] = useState<Record<string, number>>(() => readSignalsCache(effectiveShopIds)?.soldQtyByProduct ?? {})
  const [soldQtyLoaded, setSoldQtyLoaded] = useState(() => !!readSignalsCache(effectiveShopIds)?.soldQtyByProduct)
  // Quantité des lots périmés par produit : elle sort du disponible (ruptures et stock bas en tiennent compte)
  const [expiredQtyByProduct, setExpiredQtyByProduct] = useState<Record<string, number>>(() => readSignalsCache(effectiveShopIds)?.expiredQtyByProduct ?? {})
  // Quantité gardée pour des factures en attente à la caisse : elle sort aussi du disponible
  const [reservedQtyByProduct, setReservedQtyByProduct] = useState<Record<string, number>>(() => readSignalsCache(effectiveShopIds)?.reservedQtyByProduct ?? {})
  // Stock à venir (en transit, en commande) : null tant qu'il n'est ni en cache ni chargé
  const [pipeline, setPipeline] = useState<StockPipeline | null>(() => readSignalsCache(effectiveShopIds)?.pipeline ?? null)

  const { canViewCost } = useRolePermissions()
  const [showAllPriorities, setShowAllPriorities] = useState(false)
  // Contexte de boutique : celui du sélecteur de l'en-tête, seulement rappelé ici (sur téléphone, l'en-tête
  // n'en montre que l'icône). Sans objet avec une seule boutique.
  const allShops = effectiveShopIds.length > 1
  const shopContext = userShops.length > 1
    ? (allShops ? t('dashboard.all_shops') : userShops.find(s => s.id === effectiveShopIds[0])?.name ?? shop?.name ?? '')
    : ''
  const [costs, setCosts] = useState<Record<string, number> | null>(null)
  // Coûts demandés au serveur, réponse pas encore arrivée : la carte « Valeur du stock » garde sa place
  // (sinon elle surgit après les autres et décale toute la grille)
  const [costsPending, setCostsPending] = useState(canViewCost)
  useEffect(() => { if (!canViewCost) { setCosts(null); setCostsPending(false) } }, [canViewCost])

  const fetchAll = async () => {
    if (!effectiveShopIds.length) return
    if (!isOnline) { setLoading(false); setCostsPending(false); return }
    try {
      // Même requête que la page Produits (lignes complètes, catégories,
      // fournisseurs) et même cache local : un clic sur une carte ouvre une
      // liste déjà chargée, au lieu de tout recharger derrière un squelette.
      const [prodsRes, catsRes, supsRes] = await withTimeout(Promise.all([
        supabase
          .from('products')
          .select(`${PRODUCT_PUBLIC_COLUMNS}, categories(name, color), suppliers(name)`)
          .in('shop_id', effectiveShopIds)
          .eq('is_active', true)
          .order('name'),
        supabase.from('categories').select('*').in('shop_id', effectiveShopIds).order('name'),
        supabase.from('suppliers').select(SUPPLIER_PUBLIC_COLUMNS).in('shop_id', effectiveShopIds).order('name'),
      ]), 20_000, t('errors.generic'))
      const err = prodsRes.error || catsRes.error || supsRes.error
      if (err) throw err
      setProducts((prodsRes.data || []) as unknown as StockProductLike[])
      // Valeur du stock : les coûts ne sont demandés au serveur qu'avec le droit de les voir (jamais mis en cache)
      if (canViewCost) fetchCosts(effectiveShopIds).then(c => setCosts(c ? c.products : null)).catch(() => setCosts(null)).finally(() => setCostsPending(false))
      else setCosts(null)
      setCategories((catsRes.data || []) as CategoryAlert[])
      setPageCache(cacheKey, { prods: prodsRes.data || [], cats: catsRes.data || [], sups: supsRes.data || [] })
    } catch {
      // on garde l'état connu (cache ou chargement précédent)
      setCostsPending(false)
    } finally {
      setLoading(false)
    }
    // Signaux additifs, chacun tolérant à l'échec : dernier état connu conservé,
    // et mis en cache pour la page Produits
    try {
      const expiry = await fetchExpiryByProduct(supabase, effectiveShopIds)
      setExpiryByProduct(expiry)
      writeSignalsCache(effectiveShopIds, { expiryByProduct: expiry })
    } catch { /* idem */ }
    try {
      const sold = await fetchSoldQty30dForShops(effectiveShopIds)
      setSoldQtyByProduct(sold)
      setSoldQtyLoaded(true)
      writeSignalsCache(effectiveShopIds, { soldQtyByProduct: sold })
    } catch { /* idem */ }
    try {
      const expiredQty = await fetchExpiredQtyByProduct(supabase, effectiveShopIds)
      setExpiredQtyByProduct(expiredQty)
      writeSignalsCache(effectiveShopIds, { expiredQtyByProduct: expiredQty })
    } catch { /* idem */ }
    try {
      const reservedQty = await fetchReservedQtyByProduct(supabase, effectiveShopIds)
      setReservedQtyByProduct(reservedQty)
      writeSignalsCache(effectiveShopIds, { reservedQtyByProduct: reservedQty })
    } catch { /* idem */ }
    try {
      const incoming = await fetchStockPipeline(effectiveShopIds)
      setPipeline(incoming)
      writeSignalsCache(effectiveShopIds, { pipeline: incoming })
    } catch { /* idem */ }
  }

  useEffect(() => { fetchAll() }, [effectiveShopIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  // Routes cibles des cartes préchargées : la navigation n'attend ni le code
  // de la page ni son rendu serveur
  useEffect(() => {
    router.prefetch(`/${locale}/stock/products`)
    router.prefetch(`/${locale}/stock/expiry`)
  }, [router, locale])
  useRefetchOnVisible(() => fetchAll())
  useRefetchOnReconnect(() => fetchAll(), isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

  const kpis = useMemo(() => computeStockKpis(withCosts(products as any[], costs) as StockProductLike[], {
    shopLowStockThreshold: shop?.low_stock_threshold,
    shopExpiryAlertDays: shop?.expiry_alert_days,
    categoryAlertDays: Object.fromEntries(categories.map(c => [c.id, c.expiry_alert_days])),
    expiryByProduct,
    soldQtyByProduct,
    soldQtyLoaded,
    expiredQtyByProduct,
    reservedQtyByProduct,
  }), [products, categories, shop?.low_stock_threshold, shop?.expiry_alert_days, expiryByProduct, soldQtyByProduct, soldQtyLoaded, expiredQtyByProduct, reservedQtyByProduct, costs])

  // Les coûts sont des données financières : pas pour la caisse ni la lecture seule
  // Valeur du stock : règle unique canViewCost (lib/permissions), et seulement une fois les coûts reçus du serveur
  const canSeeValue = canViewCost && costs !== null
  // La carte est à sa place dès le premier affichage pour qui a le droit ; son montant arrive avec la réponse
  const showValueCard = canSeeValue || (canViewCost && costsPending)
  // Le filtre est posé dans le stockage mémorisé de la page cible, lue à son
  // premier rendu : pas de paramètre d'URL, donc la route préchargée s'ouvre
  // immédiatement. Repli ?status= si la boutique n'est pas connue.
  const goToProducts = (status?: string) => {
    const ok = presetPersistedFilters('stock', shop?.id, { statusFilter: status ?? 'all' })
    const href = `/${locale}/stock/products${!ok && status ? `?status=${status}` : ''}`
    startNavigationProgress(href)
    router.push(href)
  }
  const goToLots = (status: string) => {
    const ok = presetPersistedFilters('expiry', shop?.id, { statusFilter: status })
    const href = `/${locale}/stock/expiry${ok ? '' : `?status=${status}`}`
    startNavigationProgress(href)
    router.push(href)
  }
  const reorderCount = kpis.out + kpis.low
  // Stock à venir : une carte par notion que la personne a le droit de voir ; l'en-transit n'a de sens qu'avec plusieurs boutiques
  const showTransit = !!pipeline && pipeline.visible?.inTransit !== false && userShops.length > 1
  const showOnOrder = !!pipeline && pipeline.visible?.onOrder !== false
  const goTo = (href: string) => { startNavigationProgress(href); router.push(href) }

  // Priorités stock : seulement celles qui ont quelque chose à montrer, par ordre d'importance
  // (réapprovisionner, lots périmés ou proches, stock dormant, puis les promotions)
  const priorities = [
    reorderCount > 0 && {
      key: 'reorder', tone: 'amber' as Tone, icon: ShoppingCart,
      title: t('stock_overview.opp_reorder', { count: reorderCount }),
      desc: t('stock_overview.opp_reorder_desc', { out: kpis.out, low: kpis.low }),
      action: t('stock_overview.act_reorder'), onClick: () => goToProducts(kpis.out > 0 ? 'out' : 'low'),
    },
    kpis.expiring > 0 && {
      key: 'expiring', tone: 'orange' as Tone, icon: CalendarClock,
      title: t('stock_overview.opp_expiring', { count: kpis.expiring }),
      desc: t('stock_overview.opp_expiring_desc'),
      action: t('stock_overview.act_lots'), onClick: () => goToLots('attention'),
    },
    kpis.dormant > 0 && {
      key: 'dormant', tone: 'blue' as Tone, icon: TrendingDown,
      title: t('stock_overview.opp_dormant', { count: kpis.dormant }),
      desc: canSeeValue
        ? t('stock_overview.opp_dormant_desc_value', { amount: fmt(kpis.dormantValue) })
        : t('stock_overview.opp_dormant_desc'),
      action: t('stock_overview.act_products'), onClick: () => goToProducts('dormant'),
    },
    kpis.promoStale > 0 && {
      key: 'promo_stale', tone: 'red' as Tone, icon: AlertTriangle,
      title: t('stock_overview.opp_promo_stale', { count: kpis.promoStale }),
      desc: t('stock_overview.opp_promo_stale_desc'),
      action: t('stock_overview.act_products'), onClick: () => goToProducts('promo'),
    },
    kpis.promo > 0 && {
      key: 'promo', tone: 'purple' as Tone, icon: Tag,
      title: t('stock_overview.opp_promo_active', { count: kpis.promo }),
      desc: t('stock_overview.opp_promo_active_desc'),
      action: t('stock_overview.act_view'), onClick: () => goToProducts('promo'),
    },
  ].filter(Boolean) as { key: string; tone: Tone; icon: ComponentType<{ className?: string }>; title: string; desc: string; action: string; onClick: () => void }[]
  const shownPriorities = showAllPriorities ? priorities : priorities.slice(0, PRIORITIES_SHOWN)

  return (
    <div className="space-y-5">
      <StockTabs locale={locale} />

      <div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{t('stock_overview.title')}</h1>
          {shopContext && (
            <p data-testid="overview-shop-context" className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {allShops ? <Layers aria-hidden className="h-3.5 w-3.5 shrink-0" /> : <Store aria-hidden className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{shopContext}</span>
            </p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t('stock_overview.subtitle')}</p>
      </div>

      {loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
        <LoadErrorFallback />
      ) : loading ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : (
        <>
          {/* Chiffres clés : chacun ouvre les produits concernés */}
          {/* Deux rangées : Valeur et Produits (larges, montant long lisible), puis les
              quatre alertes. Sur téléphone : une carte large par ligne, alertes par deux — et de même
              sur tablette en portrait (md), où le menu latéral ne laisse pas la place d'un montant long. */}
          <section aria-label={t('stock_overview.kpis_label')} className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">
            {showValueCard && (
              <KpiCard id="value" className="col-span-2" tone="blue" icon={Wallet} label={t('stock_overview.stock_value')} value={canSeeValue ? fmt(kpis.stockValue) : '…'} hint={t('stock_overview.stock_value_hint')} />
            )}
            <KpiCard id="products" className={showValueCard ? 'col-span-2' : 'col-span-2 sm:col-span-4 md:col-span-2 lg:col-span-4'} icon={Package} label={t('stock_overview.products_count')} value={kpis.total} actionLabel={t('stock_overview.open_products')} onClick={() => goToProducts()} />
            <KpiCard id="out" tone={alertTone(kpis.out, 'red')} icon={PackageX} label={t('stock_overview.kpi_out')} value={kpis.out} actionLabel={t('stock_overview.open_products')} onClick={() => goToProducts('out')} />
            <KpiCard id="low" tone={alertTone(kpis.low, 'amber')} icon={PackageMinus} label={t('stock_overview.kpi_low')} value={kpis.low} actionLabel={t('stock_overview.open_products')} onClick={() => goToProducts('low')} />
            <KpiCard id="expiring" tone={alertTone(kpis.expiring, 'orange')} icon={CalendarClock} label={t('stock_overview.kpi_expiring')} value={kpis.expiring} actionLabel={t('stock_overview.act_lots')} onClick={() => goToLots('attention')} />
            <KpiCard
              id="dormant" tone={alertTone(kpis.dormant, 'blue')} icon={TrendingDown} label={t('stock_overview.kpi_dormant')} value={kpis.dormant}
              hint={canSeeValue && kpis.dormant > 0 ? t('stock_overview.hint_immobilized', { amount: fmt(kpis.dormantValue) }) : undefined}
              actionLabel={t('stock_overview.open_products')}
              onClick={() => goToProducts('dormant')}
            />
          </section>

          {/* Stock à venir : ce qui n'est pas encore en rayon mais arrive (transferts envoyés, commandes envoyées) */}
          {(showTransit || showOnOrder) && pipeline && (
            <section aria-label={t('stock_overview.incoming_label')} className="space-y-2">
              <h2 className="text-sm font-semibold">{t('stock_overview.incoming_label')}</h2>
              <div className="grid grid-cols-2 gap-3">
                {showTransit && (
                  <KpiCard
                    id="in_transit" className={showOnOrder ? undefined : 'col-span-2'} icon={Truck}
                    label={t('stock_overview.kpi_in_transit')} value={pipeline.totals.inTransitUnits}
                    hint={pipeline.totals.inTransitTransfers > 0 ? t('stock_overview.hint_transfers', { count: pipeline.totals.inTransitTransfers }) : t('stock_overview.hint_none_transit')}
                    onClick={() => goTo(`/${locale}/stock/transfers`)}
                  />
                )}
                {showOnOrder && (
                  <KpiCard
                    id="on_order" className={showTransit ? undefined : 'col-span-2'} icon={ClipboardList}
                    label={t('stock_overview.kpi_on_order')} value={pipeline.totals.onOrderUnits}
                    hint={pipeline.totals.onOrderOrders > 0 ? t('stock_overview.hint_orders', { count: pipeline.totals.onOrderOrders }) : t('stock_overview.hint_none_order')}
                    onClick={() => goTo(`/${locale}/suppliers?view=purchase_orders`)}
                  />
                )}
              </div>
            </section>
          )}

          {/* Priorités stock : l'état du stock traduit en actions à faire maintenant */}
          <section data-testid="stock-priorities" aria-label={t('stock_overview.priorities_title')} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex items-center gap-2.5 border-b px-4 py-3">
              <span className="rounded-lg bg-amber-100 p-1.5 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"><ListChecks className="h-4 w-4" /></span>
              <div>
                <h2 className="text-sm font-semibold">{t('stock_overview.priorities_title')}</h2>
                <p className="text-xs text-muted-foreground">{t('stock_overview.priorities_subtitle')}</p>
              </div>
            </div>
            {priorities.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                {t('stock_overview.opp_none')}
              </div>
            ) : (
              <>
                {/* Toute la ligne ouvre les produits (ou les lots) concernés : même geste que les cartes */}
                <ul id="stock-priorities-list" className="divide-y">
                  {shownPriorities.map(o => (
                    <li key={o.key}>
                      <button
                        type="button" data-priority={o.key} onClick={o.onClick}
                        className="group flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none active:bg-muted"
                      >
                        <span className={cn('shrink-0 rounded-lg p-2', TONE[o.tone].icon)}><o.icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{o.title}</span>
                          <span className="block text-xs text-muted-foreground">{o.desc}</span>
                        </span>
                        <span className="sr-only">{o.action}</span>
                        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-stockshop-blue dark:group-hover:text-blue-400" />
                      </button>
                    </li>
                  ))}
                </ul>
                {priorities.length > PRIORITIES_SHOWN && (
                  <button
                    type="button" data-testid="stock-priorities-toggle" aria-expanded={showAllPriorities} aria-controls="stock-priorities-list"
                    onClick={() => setShowAllPriorities(v => !v)}
                    className="flex min-h-[48px] w-full items-center justify-center gap-1.5 border-t px-4 text-sm font-medium text-stockshop-blue transition-colors hover:bg-stockshop-blue-muted/40 focus-visible:bg-stockshop-blue-muted/40 focus-visible:outline-none dark:text-blue-400 dark:hover:bg-blue-950/30"
                  >
                    {showAllPriorities ? t('stock_overview.priorities_show_less') : t('stock_overview.priorities_show_all')}
                    <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', showAllPriorities && 'rotate-180')} />
                  </button>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
