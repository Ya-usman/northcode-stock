'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowRight, CalendarClock, Package, PackageMinus, PackageX, Tag, TrendingDown, Wallet } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useCurrency } from '@/lib/hooks/use-currency'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { getPageCache } from '@/lib/offline/page-cache'
import { withTimeout } from '@/lib/utils/with-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { Skeleton } from '@/components/ui/skeleton'
import { StockTabs } from '@/components/stock/stock-tabs'
import { computeStockKpis, fetchExpiryByProduct, fetchSoldQty30d, type StockProductLike } from '@/lib/stock/signals'

// Vue d'ensemble du module Stock : l'état du stock en un coup d'œil, chaque
// carte menant aux produits concernés (filtre appliqué par ?status=).
// Les cartes d'alerte vivaient sur la liste des produits ; elles sont ici
// pour ne pas dupliquer l'information entre onglets. Lit le même cache hors
// ligne que Produits (`stock_<boutiques>`) pour s'afficher sans réseau, sans
// jamais l'écraser (la requête ici ne charge qu'un sous-ensemble de colonnes).

type CategoryAlert = { id: string; expiry_alert_days: number | null }

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
  const [expiryByProduct, setExpiryByProduct] = useState<Record<string, string>>({})
  const [soldQtyByProduct, setSoldQtyByProduct] = useState<Record<string, number>>({})
  const [soldQtyLoaded, setSoldQtyLoaded] = useState(false)

  const fetchAll = async () => {
    if (!effectiveShopIds.length) return
    if (!isOnline) { setLoading(false); return }
    try {
      const [prodsRes, catsRes] = await withTimeout(Promise.all([
        supabase
          .from('products')
          .select('id, quantity, low_stock_threshold, buying_price, selling_price, category_id, promo_price, promo_until, promo_start')
          .in('shop_id', effectiveShopIds)
          .eq('is_active', true),
        supabase.from('categories').select('id, expiry_alert_days').in('shop_id', effectiveShopIds),
      ]), 20_000, t('errors.generic'))
      if (prodsRes.error || catsRes.error) throw prodsRes.error || catsRes.error
      setProducts((prodsRes.data || []) as StockProductLike[])
      setCategories((catsRes.data || []) as CategoryAlert[])
    } catch {
      // on garde l'état connu (cache ou chargement précédent)
    } finally {
      setLoading(false)
    }
    // Signaux additifs, chacun tolérant à l'échec : dernier état connu conservé
    try { setExpiryByProduct(await fetchExpiryByProduct(supabase, effectiveShopIds)) } catch { /* idem */ }
    try { setSoldQtyByProduct(await fetchSoldQty30d(supabase, effectiveShopIds)); setSoldQtyLoaded(true) } catch { /* idem */ }
  }

  useEffect(() => { fetchAll() }, [effectiveShopIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
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

  // Le coût du stock est une donnée financière : pas pour la caisse ni la lecture seule
  const canSeeValue = !['cashier', 'viewer'].includes(effectiveRole || '')
  const goToProducts = (status?: string) =>
    router.push(`/${locale}/stock/products${status ? `?status=${status}` : ''}`)

  const alertCards = [
    { key: 'out', count: kpis.out, label: t('products.card_out_of_stock'), icon: PackageX, color: 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20', badge: 'bg-red-100 dark:bg-red-900/40' },
    { key: 'low', count: kpis.low, label: t('products.card_low_stock'), icon: PackageMinus, color: 'text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20', badge: 'bg-amber-100 dark:bg-amber-900/40' },
    { key: 'expiry', count: kpis.expiring, label: t('products.card_expiry'), icon: CalendarClock, color: 'text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-900 bg-orange-50/50 dark:bg-orange-950/20', badge: 'bg-orange-100 dark:bg-orange-900/40' },
    { key: 'dormant', count: kpis.dormant, label: t('products.card_dormant'), icon: TrendingDown, color: 'text-stockshop-blue dark:text-blue-400 border-stockshop-blue/20 dark:border-blue-900 bg-stockshop-blue-muted/50 dark:bg-blue-950/20', badge: 'bg-stockshop-blue-muted dark:bg-blue-900/40' },
    { key: 'promo', count: kpis.promo, label: t('products.promo_badge'), icon: Tag, color: 'text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20', badge: 'bg-purple-100 dark:bg-purple-900/40' },
  ]

  return (
    <div className="space-y-4">
      <StockTabs locale={locale} />

      <div>
        <h1 className="text-lg font-semibold">{t('stock_overview.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('stock_overview.subtitle')}</p>
      </div>

      {loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
        <LoadErrorFallback />
      ) : loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        </div>
      ) : (
        <>
          {/* Chiffres clés */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => goToProducts()}
              className="group rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:border-stockshop-blue/40"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-2xl font-bold leading-none tabular-nums">{kpis.total}</p>
                <span className="rounded-lg bg-muted p-1.5 text-muted-foreground"><Package className="h-5 w-5" /></span>
              </div>
              <p className="mt-1.5 text-sm font-medium">{t('stock_overview.products_count')}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-stockshop-blue dark:group-hover:text-blue-400">
                {t('stock_overview.open_products')} <ArrowRight className="h-3 w-3" />
              </p>
            </button>
            {canSeeValue && (
              <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-2xl font-bold leading-none tabular-nums text-stockshop-blue dark:text-blue-400">{fmt(kpis.stockValue)}</p>
                  <span className="rounded-lg bg-stockshop-blue-muted p-1.5 text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400"><Wallet className="h-5 w-5" /></span>
                </div>
                <p className="mt-1.5 text-sm font-medium">{t('stock_overview.stock_value')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('stock_overview.stock_value_hint')}</p>
              </div>
            )}
          </div>

          {/* Alertes : chaque carte ouvre les produits concernés */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {alertCards.map(card => (
              <button
                key={card.key}
                type="button"
                onClick={() => goToProducts(card.key)}
                className={`rounded-xl border px-4 py-3 text-left transition-all hover:opacity-80 ${card.color}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-2xl font-bold leading-none tabular-nums">{card.count}</p>
                  <span className={`flex-shrink-0 rounded-lg p-1.5 ${card.badge}`}>
                    <card.icon className="h-5 w-5" />
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-medium opacity-90">{card.label}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
