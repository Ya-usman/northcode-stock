'use client'

// Stock › Réapprovisionnement (étape 12, décisions du 30 oct. 2026). Les produits à commander, regroupés par
// fournisseur (habituel par défaut), avec une quantité suggérée modifiable ; les alternatives « moins cher » et
// « plus rapide » sont PROPOSÉES, jamais appliquées d'office. « Créer les bons » (barre fixe en bas) ouvre le panneau
// « Vérifier les commandes » : récapitulatif exact, puis un BROUILLON par fournisseur (/api/purchase-orders), relu et
// envoyé ensuite dans Fournisseurs. Règle de calcul : lib/stock/replenishment.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, ClipboardList, Info, Minus, MoreHorizontal, Plus, RotateCcw, Truck, Wallet, X, Zap } from 'lucide-react'
import { useShopScope } from '@/lib/shops/use-shop-scope'
import { useFilterScope } from '@/lib/filters/use-filter-scope'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useOffline } from '@/lib/offline/use-offline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
import { formatCurrency } from '@/lib/utils/currency'
import { formatLocaleDate } from '@/lib/i18n/date-format'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { cn } from '@/lib/utils/cn'
import {
  REPLENISH_HORIZONS, bestOffers, cheapestChoice, expectedDeliveryDate, normalizeHorizon, suggestedQty,
  type ReplenishFacts, type SupplierOffer,
} from '@/lib/stock/replenishment'
import type { ReplenishItem, ReplenishSupplier } from '@/lib/stock/replenishment-load'
import { ReplenishmentReviewDrawer, type ReviewOrder } from './replenishment-review-drawer'

interface ShopInfo { id: string; name: string; currency: string | null; today: string; can_order: boolean; can_view_cost: boolean }
interface Payload { lead_time_supported: boolean; shops: ShopInfo[]; suppliers: ReplenishSupplier[]; items: ReplenishItem[] }

const NO_SUPPLIER = ''
const factsOf = (it: ReplenishItem): ReplenishFacts => ({
  available: it.available, onOrder: 0, inTransit: 0, drafted: 0, threshold: it.threshold, sold30: it.sold30,
})

export function ReplenishmentTab() {
  const t = useTranslations('replenishment')
  const tRoot = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const focusProduct = searchParams.get('product')
  const unitLabel = useUnitLabel()
  const { isOnline } = useOffline()
  const scope = useShopScope()
  const scopeKey = scope.shopIds.join(',')
  const filterScope = useFilterScope()
  const [saved, setSaved] = usePersistedFilters('replenishment', filterScope, { horizon: 30 as number }, { keepPerScope: true })
  const horizon = normalizeHorizon(saved.horizon)

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  // Panneau de vérification : instantané EXACT de ce qui sera créé (quantités figées à l'ouverture)
  const [review, setReview] = useState<ReviewOrder[] | null>(null)
  // Produits commandés : quittent la liste en douceur à la fermeture du panneau, avant le rechargement
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const focusRef = useRef<HTMLLIElement | null>(null)

  const load = useCallback(async () => {
    if (!scopeKey) return
    setLoading(true); setFailed(false)
    try {
      const res = await fetch(`/api/stock/replenishment?shop_ids=${scopeKey}${focusProduct ? `&include=${focusProduct}` : ''}`)
      if (!res.ok) throw new Error(String(res.status))
      const json: Payload = await res.json()
      setData(json)
      setQty({}); setChoice({}); setRemoved(new Set()); setLeaving(new Set())
    } catch { setFailed(true) } finally { setLoading(false) }
  }, [scopeKey, focusProduct])
  useEffect(() => { load() }, [load])

  // Produit demandé (bouton « Commander ») : amené en vue une fois chargé
  useEffect(() => {
    if (!focusProduct || loading || !focusRef.current) return
    focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusProduct, loading])

  const shopById = useMemo(() => Object.fromEntries((data?.shops || []).map(s => [s.id, s])), [data])
  const supplierById = useMemo(() => Object.fromEntries((data?.suppliers || []).map(s => [s.id, s])), [data])
  const leadOf = useCallback((id: string | null | undefined) => (id ? supplierById[id]?.lead_days ?? null : null), [supplierById])
  const offersOf = useCallback((it: ReplenishItem): SupplierOffer[] =>
    it.offers.map(o => ({ supplierId: o.supplier_id, price: o.price, priceAt: o.price_at, leadDays: leadOf(o.supplier_id) })), [leadOf])

  const supplierOf = (it: ReplenishItem) => (it.product_id in choice ? choice[it.product_id] : it.supplier_id ?? NO_SUPPLIER)
  const suggestionOf = (it: ReplenishItem, supplierId: string) => suggestedQty({ ...factsOf(it), available: it.projected }, { horizon, leadDays: leadOf(supplierId) })
  const qtyOf = (it: ReplenishItem) => qty[it.product_id] ?? suggestionOf(it, supplierOf(it))
  const priceOf = (it: ReplenishItem, supplierId: string) => it.offers.find(o => o.supplier_id === supplierId)?.price ?? null

  const active = (data?.items || []).filter(it => !removed.has(it.product_id))
  // Groupes : boutique → fournisseur choisi (sans fournisseur en dernier)
  const groups = useMemo(() => {
    const out: { key: string; shopId: string; supplierId: string; items: ReplenishItem[] }[] = []
    const index: Record<string, number> = {}
    for (const it of active) {
      const sid = supplierOf(it)
      const key = `${it.shop_id}|${sid}`
      if (!(key in index)) { index[key] = out.length; out.push({ key, shopId: it.shop_id, supplierId: sid, items: [] }) }
      out[index[key]].items.push(it)
    }
    const shopOrder = (data?.shops || []).map(s => s.id)
    return out.sort((a, b) => shopOrder.indexOf(a.shopId) - shopOrder.indexOf(b.shopId)
      || (a.supplierId === NO_SUPPLIER ? 1 : 0) - (b.supplierId === NO_SUPPLIER ? 1 : 0)
      || (supplierById[a.supplierId]?.name || '').localeCompare(supplierById[b.supplierId]?.name || ''))
  }, [active, choice, data, supplierById]) // eslint-disable-line react-hooks/exhaustive-deps

  const orderable = groups.filter(g => g.supplierId !== NO_SUPPLIER && shopById[g.shopId]?.can_order && g.items.some(it => qtyOf(it) > 0))
  const anyCanOrder = (data?.shops || []).some(s => s.can_order)
  const canSeeCost = (data?.shops || []).some(s => s.can_view_cost)
  const cheapest = useMemo(() => cheapestChoice(active.map(it => ({ key: it.product_id, supplierId: supplierOf(it) || null, offers: offersOf(it) }))), [active, choice, offersOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const cheaperAvailable = active.some(it => (cheapest[it.product_id] ?? null) !== (supplierOf(it) || null))
  const multiShop = (data?.shops || []).length > 1

  const applyCheapest = () => {
    const moved = active.filter(it => { const c = cheapest[it.product_id]; return !!c && c !== supplierOf(it) })
    if (!moved.length) return
    setChoice(prev => ({ ...prev, ...Object.fromEntries(moved.map(it => [it.product_id, cheapest[it.product_id] as string])) }))
    // Quantités recalculées avec le délai du nouveau fournisseur
    setQty(q => { const n = { ...q }; for (const it of moved) delete n[it.product_id]; return n })
  }
  const pick = (it: ReplenishItem, supplierId: string) => {
    setChoice(prev => ({ ...prev, [it.product_id]: supplierId }))
    setQty(q => { const n = { ...q }; delete n[it.product_id]; return n })
  }
  const setLineQty = (it: ReplenishItem, v: number) => setQty(q => ({ ...q, [it.product_id]: Math.max(0, Math.min(999_999, Math.floor(v) || 0)) }))

  const openReview = (keys: string[]) => {
    const orders: ReviewOrder[] = []
    for (const key of keys) {
      const g = groups.find(x => x.key === key)
      const shop = g && shopById[g.shopId]
      if (!g || !shop || g.supplierId === NO_SUPPLIER) continue
      const lines = g.items.filter(it => qtyOf(it) > 0)
      if (!lines.length) continue
      orders.push({
        key, shopId: g.shopId, shopName: multiShop ? shop.name : null, supplierId: g.supplierId,
        supplierName: supplierById[g.supplierId]?.name ?? '', currency: shop.currency || 'XAF', canViewCost: shop.can_view_cost,
        expected: expectedDeliveryDate(shop.today, leadOf(g.supplierId)),
        lines: lines.map(it => ({ productId: it.product_id, name: it.name, unit: it.unit, qty: qtyOf(it), price: shop.can_view_cost ? priceOf(it, g.supplierId) : null })),
        status: 'pending',
      })
    }
    if (orders.length) setReview(orders)
  }
  // Un brouillon par fournisseur, l'un après l'autre (état visible par fournisseur) ; les échecs restent réessayables
  const runCreate = async () => {
    if (!review) return
    let current = review
    const patch = (key: string, p: Partial<ReviewOrder>) => { current = current.map(o => (o.key === key ? { ...o, ...p } : o)); setReview(current) }
    for (const o of review.filter(x => x.status === 'pending' || x.status === 'error')) {
      patch(o.key, { status: 'creating', error: null })
      try {
        const res = await fetch('/api/purchase-orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop_id: o.shopId, supplier_id: o.supplierId, notes: t('po_note'), expected_delivery_date: o.expected,
            items: o.lines.map(l => ({ product_id: l.productId, product_name: l.name, unit: l.unit, quantity_ordered: l.qty, unit_price: l.price })),
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.ok) patch(o.key, { status: 'done', reference: json?.data?.reference ?? null })
        else patch(o.key, { status: 'error', error: json?.error || null })
      } catch { patch(o.key, { status: 'error', error: null }) }
    }
  }
  const closeReview = (then?: () => void) => {
    const done = (review || []).filter(o => o.status === 'done')
    setReview(null)
    if (!done.length) { then?.(); return }
    // Les produits commandés quittent la liste (effet de sortie des panneaux), puis la liste est relue
    setLeaving(new Set(done.flatMap(o => o.lines.map(l => l.productId))))
    window.setTimeout(() => { if (then) then(); else load() }, 320)
  }
  const removeGroup = (key: string) => {
    const g = groups.find(x => x.key === key)
    if (g) setRemoved(prev => { const nx = new Set(prev); for (const it of g.items) nx.add(it.product_id); return nx })
  }
  const orderableUnits = orderable.reduce((s, g) => s + g.items.filter(it => qtyOf(it) > 0).length, 0)
  const barTotal = (() => {
    const shops = Array.from(new Set(orderable.map(g => g.shopId)))
    const cur = Array.from(new Set(shops.map(id => shopById[id]?.currency || 'XAF')))
    if (!orderable.length || cur.length !== 1 || !shops.every(id => shopById[id]?.can_view_cost)) return null
    const sum = orderable.reduce((s, g) => s + g.items.reduce((x, it) => x + (priceOf(it, g.supplierId) ?? 0) * qtyOf(it), 0), 0)
    return sum > 0 ? formatCurrency(sum, cur[0]) : null
  })()

  const fmtNum = (n: number, digits = 0) => n.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: digits })
  const money = (n: number, shopId: string) => formatCurrency(n, shopById[shopId]?.currency || 'XAF')
  const leadText = (s: ReplenishSupplier | undefined) => !s || s.lead_days == null ? null
    : s.lead_source === 'observed' ? t('lead_observed', { days: s.lead_days }) : t('lead_declared', { days: s.lead_days })

  if (!isOnline && !data) {
    return <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">{t('offline')}</div>
  }

  return (
    <div className={cn('space-y-4', anyCanOrder && !!active.length && 'pb-36 sm:pb-24')} data-testid="replenishment">
      {/* Horizon + actions */}
      <div className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('horizon_label')}</p>
            <div className="mt-2 inline-flex rounded-lg border bg-muted/40 p-1" role="radiogroup" aria-label={t('horizon_label')}>
              {REPLENISH_HORIZONS.map(h => (
                <button key={h} type="button" role="radio" aria-checked={horizon === h} onClick={() => { setSaved({ horizon: h }); setQty({}) }}
                  className={cn('h-9 min-w-[64px] rounded-md px-3 text-sm font-medium transition-colors', horizon === h ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                  data-testid={`replenishment-horizon-${h}`}>
                  {t('horizon_days', { days: h })}
                </button>
              ))}
            </div>
          </div>
          {!!active.length && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {canSeeCost && cheaperAvailable && (
                <Button variant="outline" className="h-11 gap-2" onClick={applyCheapest} data-testid="replenishment-cheapest-all">
                  <Wallet className="h-4 w-4 shrink-0" />{t('all_cheapest')}
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t('rule_hint')}
        </p>
      </div>

      {data && !anyCanOrder && !!active.length && (
        <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="replenishment-readonly">{t('read_only')}</p>
      )}

      {loading && !data ? (
        <div className="space-y-3">{[0, 1].map(i => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}</div>
      ) : failed && !data ? (
        <div className="rounded-xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">{t('load_error')}</p>
          <Button variant="outline" className="mt-3 h-11" onClick={load}>{tRoot('actions.retry')}</Button>
        </div>
      ) : !active.length ? (
        <div className="flex flex-col items-center rounded-xl border bg-card px-6 py-12 text-center" data-testid="replenishment-empty">
          <CheckCircle2 className="mb-3 h-10 w-10 text-green-600" />
          <p className="font-semibold">{t('empty_title')}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t('empty_desc')}</p>
          {removed.size > 0 && <Button variant="outline" className="mt-4 h-11 gap-2" onClick={() => setRemoved(new Set())}><RotateCcw className="h-4 w-4" />{t('restore_removed', { count: removed.size })}</Button>}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="replenishment-count">{t('count', { count: active.length, suppliers: groups.filter(g => g.supplierId !== NO_SUPPLIER).length })}</p>
          {groups.map((g, gi) => {
            const shop = shopById[g.shopId]
            const sup = supplierById[g.supplierId]
            const total = shop?.can_view_cost ? g.items.reduce((s, it) => s + (priceOf(it, g.supplierId) ?? 0) * qtyOf(it), 0) : 0
            const newShop = multiShop && (gi === 0 || groups[gi - 1].shopId !== g.shopId)
            return (
              <div key={g.key} className="space-y-2">
                {newShop && <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{shop?.name}</p>}
                <section className="overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="replenishment-group">
                  <header className="flex items-start justify-between gap-2 border-b bg-muted/30 p-3 sm:items-center sm:p-4">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold">
                        <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{sup?.name ?? t('no_supplier')}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[t('lines', { count: g.items.length }), leadText(sup), total > 0 ? t('estimated_total', { amount: money(total, g.shopId) }) : null].filter(Boolean).join(' · ')}
                      </p>
                      {g.supplierId === NO_SUPPLIER && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('no_supplier_hint')}</p>}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="-mr-1 h-11 w-11 shrink-0" aria-label={t('group_more', { supplier: sup?.name ?? t('no_supplier') })} data-testid="replenishment-group-more">
                          <MoreHorizontal className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {g.supplierId !== NO_SUPPLIER && shop?.can_order && (
                          <DropdownMenuItem disabled={!g.items.some(it => qtyOf(it) > 0)} onClick={() => openReview([g.key])} data-testid="replenishment-create-one">
                            <ClipboardList className="mr-2 h-4 w-4" />{t('menu_create_one')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => removeGroup(g.key)} data-testid="replenishment-remove-group">
                          <X className="mr-2 h-4 w-4" />{t('menu_remove_group')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </header>
                  <ul className="divide-y">
                    {g.items.map(it => {
                      const sid = supplierOf(it)
                      const q = qtyOf(it)
                      const sugg = suggestionOf(it, sid)
                      const offers = offersOf(it)
                      const { cheaper, faster } = bestOffers(offers, sid || null)
                      const usual = it.supplier_id
                      const switched = (it.product_id in choice) && choice[it.product_id] !== (usual ?? NO_SUPPLIER)
                      const reasonCls = it.reason === 'out' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                        : it.reason === 'low' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                          : 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400'
                      const facts = [
                        t('fact_available', { n: fmtNum(it.available) }),
                        it.on_order ? t('fact_on_order', { n: fmtNum(it.on_order) }) : null,
                        it.drafted ? t('fact_drafted', { n: fmtNum(it.drafted) }) : null,
                        it.in_transit ? t('fact_in_transit', { n: fmtNum(it.in_transit) }) : null,
                      ].filter(Boolean).join(' · ')
                      const rate = it.daily != null ? t('sales_rate', { n: fmtNum(it.daily, 1) }) : t('sales_low')
                      return (
                        <li key={it.product_id} ref={it.product_id === focusProduct ? focusRef : undefined}
                          className={cn('p-3 sm:p-4', it.product_id === focusProduct && 'bg-stockshop-blue-muted/50 dark:bg-blue-950/20',
                            leaving.has(it.product_id) && 'pointer-events-none animate-out fade-out-0 slide-out-to-right-4 fill-mode-forwards duration-300')} data-testid="replenishment-line">
                          <div className="flex items-start gap-3">
                            <ProductThumbnail src={it.image_url} alt="" className="h-12 w-12" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="font-medium leading-tight">{it.name}</p>
                                <button type="button" className="-m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label={t('remove_line', { name: it.name })}
                                  onClick={() => setRemoved(prev => new Set(prev).add(it.product_id))} data-testid="replenishment-remove"><X className="h-4 w-4" /></button>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                {it.reason && <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', reasonCls)}>{t(`reason_${it.reason}`)}</span>}
                                {it.requested && !it.reason && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{t('reason_requested')}</span>}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">{facts}</p>
                              <p className="text-xs text-muted-foreground">{rate}</p>
                            </div>
                          </div>

                          {g.supplierId === NO_SUPPLIER && shop?.can_order && (
                            <div className="mt-3">
                              <Select value={sid || undefined} onValueChange={v => pick(it, v)}>
                                <SelectTrigger className="h-11" data-testid="replenishment-pick-supplier"><SelectValue placeholder={t('pick_supplier')} /></SelectTrigger>
                                <SelectContent>{(data?.suppliers || []).filter(s => s.shop_id === it.shop_id).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                          )}

                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="min-w-0 text-xs text-muted-foreground">
                              {q !== sugg
                                ? <button type="button" className="inline-flex items-center gap-1 font-medium text-stockshop-blue hover:underline dark:text-blue-400" onClick={() => setQty(p => { const n = { ...p }; delete n[it.product_id]; return n })}>
                                    <RotateCcw className="h-3 w-3" />{t('suggested_reset', { n: fmtNum(sugg) })}</button>
                                : <span>{t('suggested', { n: fmtNum(sugg) })}{it.unit ? ` ${unitLabel(it.unit, sugg)}` : ''}</span>}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Button type="button" variant="outline" size="icon" className="h-11 w-11" disabled={!shop?.can_order || q <= 0} onClick={() => setLineQty(it, q - 1)} aria-label={t('decrease', { name: it.name })}><Minus className="h-4 w-4" /></Button>
                              <Input type="number" inputMode="numeric" min={0} value={q} disabled={!shop?.can_order} onChange={e => setLineQty(it, Number(e.target.value))}
                                className="h-11 w-20 text-center text-base font-bold tabular-nums" aria-label={t('qty_label', { name: it.name })} data-testid="replenishment-qty" />
                              <Button type="button" variant="outline" size="icon" className="h-11 w-11" disabled={!shop?.can_order} onClick={() => setLineQty(it, q + 1)} aria-label={t('increase', { name: it.name })}><Plus className="h-4 w-4" /></Button>
                            </div>
                          </div>

                          {(cheaper || faster || switched) && (
                            <div className="mt-3 space-y-1.5">
                              {cheaper && (
                                <OfferRow icon={<Wallet className="h-4 w-4 shrink-0" />} testId="replenishment-cheaper"
                                  text={t('offer_cheaper', { supplier: supplierById[cheaper.supplierId]?.name ?? '', price: money(cheaper.price as number, it.shop_id), date: cheaper.priceAt ? formatLocaleDate(cheaper.priceAt, locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '' })}
                                  action={shop?.can_order ? t('choose') : null} onAction={() => pick(it, cheaper.supplierId)} />
                              )}
                              {faster && (
                                <OfferRow icon={<Zap className="h-4 w-4 shrink-0" />} testId="replenishment-faster"
                                  text={t('offer_faster', { supplier: supplierById[faster.supplierId]?.name ?? '', days: faster.leadDays as number })}
                                  action={shop?.can_order ? t('choose') : null} onAction={() => pick(it, faster.supplierId)} />
                              )}
                              {switched && (
                                <OfferRow icon={<RotateCcw className="h-4 w-4 shrink-0" />} testId="replenishment-back-usual"
                                  text={usual && supplierById[usual] ? t('usual_supplier', { supplier: supplierById[usual].name }) : t('usual_none')}
                                  action={t('back_usual')} onAction={() => pick(it, usual ?? NO_SUPPLIER)} />
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              </div>
            )
          })}
          {removed.size > 0 && (
            <Button variant="ghost" className="h-11 gap-2" onClick={() => setRemoved(new Set())} data-testid="replenishment-restore"><RotateCcw className="h-4 w-4" />{t('restore_removed', { count: removed.size })}</Button>
          )}
        </>
      )}

      {/* Action principale : toujours au pouce, comme la réception des transferts */}
      {anyCanOrder && !!active.length && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-30 border-t bg-card/95 px-4 py-3 backdrop-blur sm:bottom-0 sm:left-64" data-testid="replenishment-bar">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{t('bar_summary', { count: orderableUnits, suppliers: orderable.length })}</p>
              {barTotal && <p className="truncate text-xs text-muted-foreground">{t('estimated_total', { amount: barTotal })}</p>}
            </div>
            <Button variant="stockshop" className="h-12 shrink-0 gap-2 px-5" disabled={!orderable.length || !!review} onClick={() => openReview(orderable.map(g => g.key))} data-testid="replenishment-create-all">
              <ClipboardList className="h-4 w-4 shrink-0" />{t('create_all', { count: orderable.length })}
            </Button>
          </div>
        </div>
      )}

      <ReplenishmentReviewDrawer
        orders={review}
        onCreate={runCreate}
        onClose={() => closeReview()}
        onSeeOrders={() => closeReview(() => router.push(`/${locale}/suppliers?view=purchase_orders`))}
      />
    </div>
  )
}

function OfferRow({ icon, text, action, onAction, testId }: { icon: React.ReactNode; text: string; action: string | null; onAction: () => void; testId: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm" data-testid={testId}>
      <span className="flex min-w-0 items-start gap-2 text-foreground/90">{icon}<span className="min-w-0">{text}</span></span>
      {action && <Button type="button" variant="ghost" className="h-9 shrink-0 px-2 font-semibold text-stockshop-blue dark:text-blue-400" onClick={onAction}>{action}</Button>}
    </div>
  )
}
