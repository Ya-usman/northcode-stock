'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Archive, ArrowDown, ChevronRight, Edit2, Unlock, Package, ShoppingCart, Tag, WifiOff } from 'lucide-react'
import type { Product } from '@/lib/types/database'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/use-toast'
import { OfflineLink } from '@/components/ui/offline-link'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
import { STATUS_CHIP, type ProductStatus } from '@/components/stock/product-table'
import { ProductBatchesList, type ProductBatchesListProps } from '@/components/stock/product-batches-list'
import { MovementList, type MovementLike } from '@/components/stock/movement-list'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { dateLocaleTag } from '@/lib/i18n/date-format'
import { withTimeout } from '@/lib/utils/with-timeout'
import { useOffline } from '@/lib/offline/use-offline'
import { localToday, type CoverageInfo, type StockQuantities } from '@/lib/stock/signals'
import { cn } from '@/lib/utils/cn'

// Fiche détail d'un produit (étape 6 de la refonte Stock) : panneau latéral
// sur ordinateur et tablette, plein écran sur téléphone. Consultation avant
// tout — les chiffres viennent de /api/stock/product-detail, qui applique les
// règles communes (lib/stock/signals) ; ce composant affiche, il ne recalcule
// rien. Les actions du pied sont celles de la liste (mêmes fenêtres, mêmes
// routes). Les sections à venir (valorisation, variantes, conditionnements,
// emplacements) s'ajouteront comme de nouvelles <DrawerSection>.

export type ProductDetailSection = 'top' | 'batches'

interface Reservation {
  id: string
  source_ref: string
  label: string | null
  quantity: number
  created_at: string
  expires_at: string
  created_by_name: string | null
}

interface ProductDetail {
  status: ProductStatus
  quantities: StockQuantities
  reservations: Reservation[]
  sales: { sold30d: number; coverage: CoverageInfo }
  purchase: null | {
    buying_price: number
    stock_value: number
    supplier: { id: string; name: string } | null
    batch_costs: Record<string, number>
    supplier_prices: { supplier_id: string; supplier_name: string | null; price: number; updated_at: string | null }[]
  }
  permissions: { cost: boolean; release: boolean }
}

export interface ProductDetailDrawerProps {
  product: Product | null
  onClose: () => void
  /** Section à montrer à l'ouverture : haut de la fiche, ou directement les lots (icône « Lots ») */
  section: ProductDetailSection
  /** Change quand la page a modifié le produit (réassort, lot corrigé…) : la fiche se recharge */
  refreshKey: number
  /** Quantités telles que la liste les connaît (même fonction de calcul) : affichées si le serveur est injoignable */
  fallbackQuantities?: StockQuantities | null
  /** Statut connu de la liste, affiché tout de suite ; remplacé par celui du serveur dès qu'il arrive */
  status: ProductStatus
  statusLabels: Record<ProductStatus, string>
  promoActive: boolean
  /** Promotion recommandée pour ce produit (péremption proche, ventes lentes) : sa raison, déjà traduite ; absente = rien n'est affiché */
  promoSuggestion?: string | null
  formatPrice: (n: number) => string
  batches: Omit<ProductBatchesListProps, 'product' | 'costs' | 'formatPrice'>
  /** Actions du pied, déjà filtrées selon les droits (absente = non proposée) */
  actions: {
    onRestock?: (p: Product) => void
    onEdit?: (p: Product) => void
    onPromo?: (p: Product) => void
    onOrder?: (p: Product) => void
    onArchive?: (p: Product) => void
  }
  /** Une réservation a été libérée : la liste doit relire ses chiffres */
  onChanged: () => void
}

const TILE = 'rounded-xl border border-border bg-card px-3 py-2.5'

export function ProductDetailDrawer({
  product, onClose, section, refreshKey, fallbackQuantities, status: listStatus, statusLabels, promoActive, promoSuggestion, formatPrice, batches, actions, onChanged,
}: ProductDetailDrawerProps) {
  const t = useTranslations()
  const td = useTranslations('product_detail')
  const locale = useLocale()
  const unitLabel = useUnitLabel()
  const { isOnline } = useOffline()

  const [detail, setDetail] = useState<ProductDetail | null>(null)
  const [movements, setMovements] = useState<MovementLike[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [toRelease, setToRelease] = useState<Reservation | null>(null)
  const [releasing, setReleasing] = useState(false)
  const batchesRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)
  const productId = product?.id, shopId = product?.shop_id

  const load = useCallback(async () => {
    if (!productId || !shopId) return
    const request = ++requestRef.current
    setLoading(true)
    setFailed(false)
    try {
      const [d, m] = await Promise.all([
        withTimeout(fetch(`/api/stock/product-detail?shop_id=${shopId}&product_id=${productId}&today=${localToday()}`), 20_000).then(async r => { if (!r.ok) throw new Error(String(r.status)); return r.json() }),
        // Les mouvements ne doivent pas faire échouer la fiche : en cas d'échec, la section le dit
        withTimeout(fetch(`/api/stock/movements?shop_ids=${shopId}&product_id=${productId}&limit=10`), 20_000).then(r => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (request !== requestRef.current) return
      setDetail(d)
      setMovements(m ? m.movements || [] : null)
    } catch {
      if (request === requestRef.current) setFailed(true)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [productId, shopId])

  // Nouveau produit : on repart d'une fiche vide (jamais les chiffres du produit précédent)
  useEffect(() => { setDetail(null); setMovements(null); setToRelease(null) }, [productId])
  useEffect(() => { if (productId) load() }, [productId, refreshKey, load])

  // Icône « Lots » : la fiche s'ouvre sur la section Lots, et y reste une fois les chiffres chargés
  const scrolledFor = useRef<string | null>(null)
  useEffect(() => {
    if (!productId) { scrolledFor.current = null; return }
    if (section !== 'batches') return
    const key = `${productId}:${detail ? 'loaded' : 'opening'}`
    if (scrolledFor.current === key || scrolledFor.current === `${productId}:loaded`) return
    scrolledFor.current = key
    const id = setTimeout(() => batchesRef.current?.scrollIntoView({ block: 'start' }), detail ? 0 : 350)
    return () => clearTimeout(id)
  }, [productId, section, detail])

  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(dateLocaleTag(locale), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  const confirmRelease = async () => {
    if (!toRelease || !product) return
    setReleasing(true)
    try {
      const res = await withTimeout(fetch(`/api/stock/reservations?shop_id=${product.shop_id}&source_ref=${encodeURIComponent(toRelease.source_ref)}&product_id=${product.id}`, { method: 'DELETE' }), 20_000)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      const done = (json.released || []).length > 0
      toast(done
        ? { title: td('release_done', { count: toRelease.quantity, name: product.name }), variant: 'success' }
        : { title: td('release_gone') })
      setToRelease(null)
      onChanged()
      load()
    } catch (err: any) {
      toast({ title: err?.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setReleasing(false)
    }
  }

  // Hors connexion : les dernières quantités connues de la liste, annoncées comme telles
  const offlineValues = failed && !detail && !!fallbackQuantities
  const q = detail?.quantities ?? (offlineValues ? fallbackQuantities! : undefined)
  const status = detail?.status ?? listStatus
  const unit = (n: number) => unitLabel(product?.unit || 'piece', n)
  const invoiceName = (r: Reservation) => r.label || td('reservation_unnamed')
  const coverageText = (c: CoverageInfo): string => {
    switch (c.kind) {
      case 'out': return td('coverage_out')
      case 'no_sales': return td('coverage_no_sales')
      case 'over_year': return td('coverage_over_year')
      case 'days': return c.days === 0 ? td('coverage_under_day') : td('coverage_days', { count: c.days })
      default: return '—'
    }
  }
  const incoming = (v: number | null) => (v === null ? '—' : v > 0 ? `+${v}` : '0')
  const footer = product && (actions.onRestock || actions.onEdit || actions.onPromo || actions.onOrder || actions.onArchive) ? (
    <div className="flex flex-wrap gap-2" data-testid="product-detail-actions">
      {actions.onRestock && <Button variant="stockshop" size="sm" className="h-10 gap-1.5" onClick={() => actions.onRestock!(product)}><ArrowDown className="h-4 w-4" />{t('actions.restock')}</Button>}
      {actions.onOrder && <Button variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => actions.onOrder!(product)}><ShoppingCart className="h-4 w-4" />{t('actions.order')}</Button>}
      {actions.onEdit && <Button variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => actions.onEdit!(product)}><Edit2 className="h-4 w-4" />{t('actions.edit')}</Button>}
      {actions.onPromo && <Button variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => actions.onPromo!(product)}><Tag className="h-4 w-4" />{t('products.promo_action')}</Button>}
      {actions.onArchive && <Button variant="ghost" size="sm" className="h-10 gap-1.5 text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400" onClick={() => actions.onArchive!(product)}><Archive className="h-4 w-4" />{td('archive')}</Button>}
    </div>
  ) : undefined

  return (
    <>
      <DetailDrawer
        open={!!product}
        onOpenChange={open => { if (!open) onClose() }}
        category={td('category')}
        title={product?.name || ''}
        icon={<Package className="h-4 w-4" />}
        width="lg"
        testId="product-detail"
        actions={footer}
        meta={product && (
          <div className="flex items-center gap-3">
            <ProductThumbnail src={product.image_url} alt={product.name} className="h-14 w-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_CHIP[status])} data-status={status}>{statusLabels[status]}</span>
                {product.categories?.name && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    {product.categories.color && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: product.categories.color }} aria-hidden="true" />}
                    {product.categories.name}
                  </span>
                )}
              </div>
              {product.sku && <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{product.sku}</p>}
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
                {promoActive && product.promo_price ? (
                  <>
                    <span className="font-bold text-stockshop-blue dark:text-blue-400">{formatPrice(product.promo_price)}</span>
                    <span className="text-xs text-muted-foreground line-through">{formatPrice(product.selling_price)}</span>
                    <span className="rounded-full bg-stockshop-blue-muted px-1.5 py-0.5 text-[10px] font-semibold text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400">{t('products.promo_badge')}</span>
                  </>
                ) : (
                  <span className="font-bold text-stockshop-blue dark:text-blue-400">{formatPrice(product.selling_price)}</span>
                )}
              </p>
            </div>
          </div>
        )}
      >
        {product && (
          <div className="space-y-4">
            {failed && !detail && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200" data-testid="product-detail-error">
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p>{offlineValues ? td('offline_values') : td('load_failed')}</p>
                  <Button variant="outline" size="sm" className="mt-2 h-8" onClick={load}>{td('retry')}</Button>
                </div>
              </div>
            )}

            {/* Recommandation : la liste des produits reste simple, la suggestion de promotion vit ici */}
            {promoSuggestion && !promoActive && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200" data-testid="product-detail-promo-suggestion">
                <Tag className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{td('promo_suggested')}</p>
                  <p className="text-xs">{promoSuggestion}</p>
                </div>
                {actions.onPromo && <Button variant="outline" size="sm" className="h-8 shrink-0 border-amber-300 bg-transparent dark:border-amber-700" onClick={() => actions.onPromo!(product)}>{t('products.promo_action')}</Button>}
              </div>
            )}

            {/* ── Quantités ─────────────────────────────────────────────── */}
            <DrawerSection title={td('quantities')} description={td('quantities_rule')}>
              {!q ? (
                loading ? <div className="grid grid-cols-2 gap-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div> : <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2" data-testid="product-detail-quantities">
                    <div className={cn(TILE, 'col-span-2 border-stockshop-blue/30 bg-stockshop-blue-muted/60 dark:border-blue-800 dark:bg-blue-950/25')} data-qty="available">
                      <p className="text-xs font-medium text-muted-foreground">{t('products.col_available')}</p>
                      <p className="mt-0.5 flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold tabular-nums text-foreground">{q.available}</span>
                        <span className="text-sm text-muted-foreground">{unit(q.available)}</span>
                      </p>
                    </div>
                    <div className={TILE} data-qty="physical">
                      <p className="text-xs font-medium text-muted-foreground">{t('products.col_physical')}</p>
                      <p className="mt-0.5 text-xl font-bold tabular-nums">{q.physical}</p>
                    </div>
                    <div className={TILE} data-qty="expired">
                      <p className="text-xs font-medium text-muted-foreground">{td('expired')}</p>
                      <p className={cn('mt-0.5 text-xl font-bold tabular-nums', q.expired > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{q.expired}</p>
                    </div>
                    <div className={TILE} data-qty="reserved">
                      <p className="text-xs font-medium text-muted-foreground">{t('products.col_reserved')}</p>
                      <p className={cn('mt-0.5 text-xl font-bold tabular-nums', q.reserved > 0 ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground')}>{q.reserved}</p>
                    </div>
                    <div className={TILE} data-qty="incoming">
                      <p className="flex justify-between gap-2 text-xs font-medium text-muted-foreground" title={t('products.in_transit_hint')}>
                        <span>{t('products.col_in_transit')}</span><span className="font-bold tabular-nums text-foreground" data-qty="inTransit">{incoming(q.inTransit)}</span>
                      </p>
                      <p className="mt-1.5 flex justify-between gap-2 text-xs font-medium text-muted-foreground" title={t('products.on_order_hint')}>
                        <span>{t('products.col_on_order')}</span><span className="font-bold tabular-nums text-foreground" data-qty="onOrder">{incoming(q.onOrder)}</span>
                      </p>
                    </div>
                  </div>
                  {(q.inTransit === null || q.onOrder === null) && <p className="text-xs text-muted-foreground">{td('incoming_hidden')}</p>}
                </>
              )}
            </DrawerSection>

            {/* ── Réservations ──────────────────────────────────────────── */}
            <DrawerSection title={td('reservations')} description={td('reservations_hint')}>
              {!detail ? (
                loading ? <Skeleton className="h-12" /> : <p className="text-sm text-muted-foreground">—</p>
              ) : detail.reservations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{td('reservations_none')}</p>
              ) : (
                <ul className="divide-y divide-border" data-testid="product-detail-reservations">
                  {detail.reservations.map(r => (
                    <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{invoiceName(r)}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-semibold text-stockshop-blue dark:text-blue-400">{r.quantity} {unit(r.quantity)}</span>
                          {r.created_by_name && <> · {r.created_by_name}</>}
                          {' · '}{td('reserved_until', { date: fmtDateTime(r.expires_at) })}
                        </p>
                      </div>
                      {detail.permissions.release && (
                        <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5" onClick={() => setToRelease(r)}>
                          <Unlock className="h-3.5 w-3.5" />{td('release')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </DrawerSection>

            {/* ── Lots ──────────────────────────────────────────────────── */}
            <div ref={batchesRef} className="scroll-mt-2" data-testid="product-detail-batches">
              <DrawerSection title={t('products.batches_title')} description={t('products.batches_hint')}>
                <ProductBatchesList product={product} costs={detail?.permissions.cost ? detail.purchase?.batch_costs ?? null : null} formatPrice={formatPrice} {...batches} />
              </DrawerSection>
            </div>

            {/* ── Ventes et couverture ──────────────────────────────────── */}
            <DrawerSection title={td('sales')}>
              {!detail ? (
                loading ? <Skeleton className="h-12" /> : <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <div className="grid grid-cols-2 gap-2" data-testid="product-detail-sales">
                  <div className={TILE}>
                    <p className="text-xs font-medium text-muted-foreground">{td('sold_30d')}</p>
                    <p className="mt-0.5 flex items-baseline gap-1.5"><span className="text-xl font-bold tabular-nums">{detail.sales.sold30d}</span><span className="text-xs text-muted-foreground">{unit(detail.sales.sold30d)}</span></p>
                  </div>
                  <div className={TILE} title={t('products.coverage_hint')}>
                    <p className="text-xs font-medium text-muted-foreground">{td('coverage')}</p>
                    <p className={cn('mt-0.5 text-sm font-bold', detail.sales.coverage.kind === 'days' && detail.sales.coverage.days <= 7 && 'text-amber-600 dark:text-amber-400')} data-coverage={detail.sales.coverage.kind}>{coverageText(detail.sales.coverage)}</p>
                    {detail.sales.coverage.kind === 'days' && detail.sales.coverage.lowVolume && <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{td('coverage_low_volume')}</p>}
                  </div>
                </div>
              )}
            </DrawerSection>

            {/* ── Derniers mouvements ───────────────────────────────────── */}
            <DrawerSection title={td('movements')}>
              {movements === null ? (
                loading ? <Skeleton className="h-20" /> : <p className="text-sm text-muted-foreground">{detail ? td('movements_failed') : '—'}</p>
              ) : movements.length === 0 ? (
                <p className="text-sm text-muted-foreground">{td('movements_none')}</p>
              ) : (
                <>
                  <MovementList movements={movements} />
                  <OfflineLink
                    isOnline={isOnline}
                    href={`/${locale}/stock/movements?product=${product.id}&all=1`}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-stockshop-blue hover:underline dark:text-blue-400"
                    data-testid="product-detail-all-movements"
                  >
                    {td('movements_all')}<ChevronRight className="h-4 w-4" />
                  </OfflineLink>
                </>
              )}
            </DrawerSection>

            {/* ── Achat : uniquement pour qui a le droit de voir les prix d'achat (le serveur n'envoie rien sinon) ── */}
            {detail?.permissions.cost && detail.purchase && (
              <DrawerSection title={td('purchase')} description={td('purchase_hint')}>
                <div className="grid grid-cols-2 gap-2" data-testid="product-detail-purchase">
                  <div className={TILE}>
                    <p className="text-xs font-medium text-muted-foreground">{t('products.cost_label')}</p>
                    <p className="mt-0.5 text-base font-bold tabular-nums">{formatPrice(detail.purchase.buying_price)}</p>
                  </div>
                  <div className={TILE}>
                    <p className="text-xs font-medium text-muted-foreground">{t('products.col_stock_value')}</p>
                    <p className="mt-0.5 text-base font-bold tabular-nums">{formatPrice(detail.purchase.stock_value)}</p>
                  </div>
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">{t('products.col_supplier')} : </span>
                  <span className="font-semibold">{detail.purchase.supplier?.name || td('supplier_none')}</span>
                </p>
                {detail.purchase.supplier_prices.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{td('supplier_prices')}</p>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {detail.purchase.supplier_prices.map((sp, i) => (
                        <li key={sp.supplier_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate">{sp.supplier_name || '—'}</span>
                          <span className={cn('shrink-0 font-semibold tabular-nums', i === 0 && 'text-green-600 dark:text-green-400')}>{formatPrice(sp.price)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </DrawerSection>
            )}
          </div>
        )}
      </DetailDrawer>

      {/* Libération d'une réservation : toujours confirmée, quantité et facture nommées, inscrite au journal */}
      <ConfirmModal
        open={!!toRelease}
        onOpenChange={open => { if (!open && !releasing) setToRelease(null) }}
        title={td('release_title')}
        icon={<Unlock className="h-4 w-4" />}
        tone="warning"
        loading={releasing}
        confirmLabel={toRelease ? td('release_confirm', { count: toRelease.quantity }) : undefined}
        onConfirm={confirmRelease}
        description={toRelease && product ? td('release_desc', { count: toRelease.quantity, unit: unit(toRelease.quantity), name: product.name, invoice: invoiceName(toRelease) }) : undefined}
      >
        {toRelease && (
          <ul className="space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="release-summary">
            {toRelease.created_by_name && <li>{td('release_by', { name: toRelease.created_by_name })}</li>}
            <li>{td('reserved_until', { date: fmtDateTime(toRelease.expires_at) })}</li>
            <li>{td('release_keep_invoice')}</li>
            <li>{td('release_logged')}</li>
          </ul>
        )}
      </ConfirmModal>
    </>
  )
}
