'use client'

import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import { useTranslations } from 'next-intl'
import {
  ArrowRight, CalendarClock, CheckCircle2, Lightbulb, Package, PackageMinus, PackageX,
  ShoppingCart, Tag, TrendingDown, Wallet, AlertTriangle,
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
import { computeStockKpis, fetchExpiryByProduct, fetchSoldQty30d, readSignalsCache, writeSignalsCache, type StockProductLike } from '@/lib/stock/signals'

// Vue d'ensemble du module Stock : six chiffres clés cliquables (chacun ouvre
// les produits concernés, filtre appliqué par ?status=) et une zone
// « Opportunités » qui transforme l'état du stock en actions recommandées
// (promos en cours ou à revoir, ventes lentes, lots à écouler, produits à
// réapprovisionner). Aucune donnée inventée : tout vient des produits, des
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

function KpiCard({ label, value, hint, icon: Icon, tone = 'neutral', onClick, className }: {
  label: string; value: string | number; hint?: string; icon: ComponentType<{ className?: string }>; tone?: Tone; onClick?: () => void
  /** Emprise dans la grille (ex. col-span-2) */
  className?: string
}) {
  const t = TONE[tone]
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={cn('min-w-0 text-2xl font-bold leading-none tabular-nums', t.value)}>{value}</p>
        <span className={cn('shrink-0 rounded-lg p-1.5', t.icon)}><Icon className="h-5 w-5" /></span>
      </div>
      <p className="mt-2 text-sm font-medium">{label}</p>
      {hint && (
        <p className={cn('mt-0.5 flex items-center gap-1 text-xs text-muted-foreground', onClick && 'group-hover:text-foreground')}>
          {hint}{onClick && <ArrowRight className="h-3 w-3" />}
        </p>
      )}
    </>
  )
  const cls = cn('rounded-xl border px-4 py-3 text-left shadow-sm transition-colors', t.card, className)
  return onClick
    ? <button type="button" onClick={onClick} className={cn(cls, 'group hover:border-stockshop-blue/40')}>{body}</button>
    : <div className={cls}>{body}</div>
}

export default function StockOverviewPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const router = useRouter()
  const { shop, effectiveShopIds, profile, roleInActiveShop } = useAuth()
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

  const fetchAll = async () => {
    if (!effectiveShopIds.length) return
    if (!isOnline) { setLoading(false); return }
    try {
      // Même requête que la page Produits (lignes complètes, catégories,
      // fournisseurs) et même cache local : un clic sur une carte ouvre une
      // liste déjà chargée, au lieu de tout recharger derrière un squelette.
      const [prodsRes, catsRes, supsRes] = await withTimeout(Promise.all([
        supabase
          .from('products')
          .select('*, categories(name, color), suppliers(name)')
          .in('shop_id', effectiveShopIds)
          .eq('is_active', true)
          .order('name'),
        supabase.from('categories').select('*').in('shop_id', effectiveShopIds).order('name'),
        supabase.from('suppliers').select('*').in('shop_id', effectiveShopIds).order('name'),
      ]), 20_000, t('errors.generic'))
      const err = prodsRes.error || catsRes.error || supsRes.error
      if (err) throw err
      setProducts((prodsRes.data || []) as StockProductLike[])
      setCategories((catsRes.data || []) as CategoryAlert[])
      setPageCache(cacheKey, { prods: prodsRes.data || [], cats: catsRes.data || [], sups: supsRes.data || [] })
    } catch {
      // on garde l'état connu (cache ou chargement précédent)
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
      const sold = await fetchSoldQty30d(supabase, effectiveShopIds)
      setSoldQtyByProduct(sold)
      setSoldQtyLoaded(true)
      writeSignalsCache(effectiveShopIds, { soldQtyByProduct: sold })
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

  const kpis = useMemo(() => computeStockKpis(products, {
    shopLowStockThreshold: shop?.low_stock_threshold,
    shopExpiryAlertDays: shop?.expiry_alert_days,
    categoryAlertDays: Object.fromEntries(categories.map(c => [c.id, c.expiry_alert_days])),
    expiryByProduct,
    soldQtyByProduct,
    soldQtyLoaded,
  }), [products, categories, shop?.low_stock_threshold, shop?.expiry_alert_days, expiryByProduct, soldQtyByProduct, soldQtyLoaded])

  // Les coûts sont des données financières : pas pour la caisse ni la lecture seule
  const canSeeValue = !['cashier', 'viewer'].includes(effectiveRole || '')
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

  // Opportunités : seulement celles qui ont quelque chose à montrer
  const opportunities = [
    kpis.promoStale > 0 && {
      key: 'promo_stale', tone: 'red' as Tone, icon: AlertTriangle,
      title: t('stock_overview.opp_promo_stale', { count: kpis.promoStale }),
      desc: t('stock_overview.opp_promo_stale_desc'),
      action: t('stock_overview.act_products'), onClick: () => goToProducts('promo'),
    },
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
      action: t('stock_overview.act_lots'), onClick: () => goToLots('expiring'),
    },
    kpis.dormant > 0 && {
      key: 'dormant', tone: 'blue' as Tone, icon: TrendingDown,
      title: t('stock_overview.opp_dormant', { count: kpis.dormant }),
      desc: canSeeValue
        ? t('stock_overview.opp_dormant_desc_value', { amount: fmt(kpis.dormantValue) })
        : t('stock_overview.opp_dormant_desc'),
      action: t('stock_overview.act_products'), onClick: () => goToProducts('dormant'),
    },
    kpis.promo > 0 && {
      key: 'promo', tone: 'purple' as Tone, icon: Tag,
      title: t('stock_overview.opp_promo_active', { count: kpis.promo }),
      desc: t('stock_overview.opp_promo_active_desc'),
      action: t('stock_overview.act_view'), onClick: () => goToProducts('promo'),
    },
  ].filter(Boolean) as { key: string; tone: Tone; icon: ComponentType<{ className?: string }>; title: string; desc: string; action: string; onClick: () => void }[]

  return (
    <div className="space-y-5">
      <StockTabs locale={locale} />

      <div>
        <h1 className="text-lg font-semibold">{t('stock_overview.title')}</h1>
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
              quatre alertes. Sur téléphone : une carte large par ligne, alertes par deux. */}
          <section aria-label={t('stock_overview.kpis_label')} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {canSeeValue && (
              <KpiCard className="col-span-2" tone="blue" icon={Wallet} label={t('stock_overview.stock_value')} value={fmt(kpis.stockValue)} hint={t('stock_overview.stock_value_hint')} />
            )}
            <KpiCard className={canSeeValue ? 'col-span-2' : 'col-span-2 sm:col-span-4'} icon={Package} label={t('stock_overview.products_count')} value={kpis.total} hint={t('stock_overview.open_products')} onClick={() => goToProducts()} />
            <KpiCard tone="red" icon={PackageX} label={t('stock_overview.kpi_out')} value={kpis.out} hint={t('stock_overview.open_products')} onClick={() => goToProducts('out')} />
            <KpiCard tone="amber" icon={PackageMinus} label={t('stock_overview.kpi_low')} value={kpis.low} hint={t('stock_overview.open_products')} onClick={() => goToProducts('low')} />
            <KpiCard tone="orange" icon={CalendarClock} label={t('stock_overview.kpi_expiring')} value={kpis.expiring} hint={t('stock_overview.open_products')} onClick={() => goToProducts('expiry')} />
            <KpiCard
              tone="blue" icon={TrendingDown} label={t('stock_overview.kpi_dormant')} value={kpis.dormant}
              hint={canSeeValue && kpis.dormant > 0 ? t('stock_overview.hint_immobilized', { amount: fmt(kpis.dormantValue) }) : t('stock_overview.open_products')}
              onClick={() => goToProducts('dormant')}
            />
          </section>

          {/* Opportunités : l'état du stock traduit en actions */}
          <section aria-label={t('stock_overview.opportunities_title')} className="rounded-xl border bg-card shadow-sm">
            <div className="flex items-center gap-2.5 border-b px-4 py-3">
              <span className="rounded-lg bg-amber-100 p-1.5 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"><Lightbulb className="h-4 w-4" /></span>
              <div>
                <h2 className="text-sm font-semibold">{t('stock_overview.opportunities_title')}</h2>
                <p className="text-xs text-muted-foreground">{t('stock_overview.opportunities_subtitle')}</p>
              </div>
            </div>
            {opportunities.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                {t('stock_overview.opp_none')}
              </div>
            ) : (
              <ul className="divide-y">
                {opportunities.map(o => (
                  <li key={o.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                    <span className={cn('hidden shrink-0 rounded-lg p-2 sm:block', TONE[o.tone].icon)}><o.icon className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{o.title}</p>
                      <p className="text-xs text-muted-foreground">{o.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={o.onClick}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border bg-background px-3 text-sm font-medium transition-colors hover:border-stockshop-blue/40 hover:text-stockshop-blue dark:hover:text-blue-400"
                    >
                      {o.action} <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
