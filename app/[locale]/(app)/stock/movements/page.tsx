'use client'

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Search, Calendar, Package, ArrowRight, X, History, ClipboardCheck } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { normalize } from '@/lib/utils/normalize'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

interface Movement {
  id: string
  type: 'in' | 'out' | 'adjustment' | 'sale'
  quantity: number
  previous_qty: number | null
  new_qty: number | null
  reason: string | null
  notes: string | null
  created_at: string
  product_name: string | null
  product_unit: string | null
  product_current_qty: number | null
  performed_by_name: string | null
}

interface ProductSummary {
  product_name: string
  product_unit: string | null
  current_qty: number | null
  initial_stock: number | null
  restocks: Movement[]
  adjustments: Movement[]
  latest_at: string
}

function fmtDate(d: string) {
  return format(new Date(d), "dd MMM yyyy 'à' HH:mm", { locale: fr })
}

export default function StockMovementsPage() {
  const t = useTranslations('movements')
  const { effectiveShopIds, shop } = useAuth()
  const [{ search, dateFrom, dateTo }, setFilter] = usePersistedFilters(
    'movements', shop?.id, { search: '', dateFrom: '', dateTo: '' }
  )

  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [openProduct, setOpenProduct] = useState<ProductSummary | null>(null)

  useEffect(() => {
    if (!effectiveShopIds.length) return
    const params = new URLSearchParams({ shop_ids: effectiveShopIds.join(',') })
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to', dateTo)

    const cacheKey = `movements_${effectiveShopIds.join(',')}_${dateFrom}_${dateTo}`
    const cached = getPageCache<Movement[]>(cacheKey)
    if (cached) { setMovements(cached); setLoading(false) }
    else setLoading(true)

    fetch(`/api/stock/movements?${params}`)
      .then(r => r.json())
      .then(data => {
        const list = data.movements || []
        setMovements(list)
        setPageCache(cacheKey, list)
        setLoading(false)
      })
      .catch(() => {
        // cache already shown if available
        setLoading(false)
      })
  }, [effectiveShopIds.join(','), dateFrom, dateTo])

  const products = useMemo<ProductSummary[]>(() => {
    const map = new Map<string, ProductSummary>()

    for (const m of movements) {
      const name = m.product_name || '—'
      if (!map.has(name)) {
        map.set(name, {
          product_name: name,
          product_unit: m.product_unit,
          current_qty: m.product_current_qty,
          initial_stock: null,
          restocks: [],
          adjustments: [],
          latest_at: m.created_at,
        })
      }
      const p = map.get(name)!
      if (m.created_at > p.latest_at) p.latest_at = m.created_at
      if (m.product_current_qty != null) p.current_qty = m.product_current_qty
      if (m.type === 'in') {
        if (m.reason === 'Stock initial') p.initial_stock = m.new_qty
        else p.restocks.push(m)
      } else if (m.type === 'adjustment') {
        p.adjustments.push(m)
      }
    }

    for (const p of Array.from(map.values())) {
      p.restocks.sort((a, b) => b.created_at.localeCompare(a.created_at))
      p.adjustments.sort((a, b) => b.created_at.localeCompare(a.created_at))
    }

    let list = Array.from(map.values())
    if (search.trim()) {
      const q = normalize(search)
      list = list.filter(p => normalize(p.product_name).includes(q))
    }
    return list.sort((a, b) => {
      const aDate = a.restocks[0]?.created_at ?? ''
      const bDate = b.restocks[0]?.created_at ?? ''
      if (!aDate && !bDate) return a.product_name.localeCompare(b.product_name)
      if (!aDate) return 1
      if (!bDate) return -1
      return bDate.localeCompare(aDate)
    })
  }, [movements, search])

  const totalRestocks = movements
    .filter(m => m.type === 'in' && m.reason !== 'Stock initial')
    .reduce((s, m) => s + m.quantity, 0)

  return (
    <div className="space-y-4">

      {/* Summary */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="grid grid-cols-2 divide-x">
            <div className="flex flex-col items-center justify-center py-4 px-6">
              <p className="text-xs text-muted-foreground mb-1">{t('total_restocked')}</p>
              <p className="text-2xl font-bold text-green-600">+{totalRestocks}</p>
            </div>
            <div className="flex flex-col items-center justify-center py-4 px-6">
              <p className="text-xs text-muted-foreground mb-1">{t('products_tracked')}</p>
              <p className="text-2xl font-bold">{products.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setFilter({ search: e.target.value })}
            placeholder={t('search_placeholder')} className="pl-9 h-9" />
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input type="date" value={dateFrom} onChange={e => setFilter({ dateFrom: e.target.value })}
            className="h-9 w-[130px] text-xs" />
          <span className="text-muted-foreground text-xs">→</span>
          <Input type="date" value={dateTo} onChange={e => setFilter({ dateTo: e.target.value })}
            className="h-9 w-[130px] text-xs" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{products.length} {t('products_count')}</p>

      {/* Table */}
      {loading ? (
        <div className="space-y-1">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-11" />)}
        </div>
      ) : products.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          {t('no_movements')}
        </div>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">

          {/* Header — desktop */}
          <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_1fr] border-b bg-muted/40">
            <div className="px-4 py-2.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('product')}</span></div>
            <div className="px-4 py-2.5 text-center border-l"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('initial_stock')}</span></div>
            <div className="px-4 py-2.5 text-center border-l"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('restocked')}</span></div>
            <div className="px-4 py-2.5 text-center border-l"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('current_stock')}</span></div>
          </div>

          {/* Header — mobile */}
          <div className="sm:hidden grid grid-cols-4 border-b bg-muted/40">
            <div className="px-2 py-2.5"><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('product')}</span></div>
            <div className="px-2 py-2.5 text-center border-l"><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('initial_stock')}</span></div>
            <div className="px-2 py-2.5 text-center border-l"><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('restocked')}</span></div>
            <div className="px-2 py-2.5 text-center border-l"><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('current_stock')}</span></div>
          </div>

          {/* Rows */}
          <div className="divide-y">
            {products.map(p => {
              const hasRestocks = p.restocks.length > 0
              const hasHistory = hasRestocks || p.adjustments.length > 0
              const restockTotal = p.restocks.reduce((s, m) => s + m.quantity, 0)
              const qty = p.current_qty
              const qtyColor = qty === 0 ? 'text-red-600' : qty != null && qty <= 5 ? 'text-amber-500' : ''

              return (
                <button
                  key={p.product_name}
                  onClick={() => hasHistory && setOpenProduct(p)}
                  className={cn(
                    'w-full transition-colors text-left',
                    hasHistory ? 'hover:bg-muted/20 cursor-pointer' : 'cursor-default'
                  )}
                >
                  {/* Desktop row */}
                  <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_1fr] items-center">
                    <div className="px-4 py-2.5 flex items-center gap-2 min-w-0">
                      <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{p.product_name}</span>
                      {p.product_unit && (
                        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full flex-shrink-0">
                          {p.product_unit}
                        </span>
                      )}
                    </div>
                    <div className="px-4 py-2.5 text-center border-l">
                      <span className="text-sm tabular-nums font-medium">
                        {p.initial_stock != null ? p.initial_stock : <span className="text-muted-foreground">—</span>}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 flex justify-center border-l">
                      {hasRestocks ? (
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-green-600 tabular-nums">
                          +{restockTotal}
                          <span className="text-[10px] font-normal text-muted-foreground">{p.restocks.length}×</span>
                        </div>
                      ) : <span className="text-muted-foreground text-sm">—</span>}
                    </div>
                    <div className="px-4 py-2.5 text-center border-l">
                      <span className={cn('text-sm font-semibold tabular-nums', qtyColor)}>
                        {qty != null ? qty : <span className="text-muted-foreground font-normal">—</span>}
                      </span>
                    </div>
                  </div>

                  {/* Mobile row */}
                  <div className="sm:hidden grid grid-cols-4 items-center">
                    <div className="px-2 py-2.5 min-w-0">
                      <p className="text-xs font-medium truncate">{p.product_name}</p>
                      {p.product_unit && (
                        <span className="text-[10px] text-muted-foreground">{p.product_unit}</span>
                      )}
                    </div>
                    <div className="px-2 py-2.5 text-center border-l">
                      <span className="text-xs tabular-nums font-medium">
                        {p.initial_stock != null ? p.initial_stock : <span className="text-muted-foreground">—</span>}
                      </span>
                    </div>
                    <div className="px-2 py-2.5 flex justify-center border-l">
                      {hasRestocks ? (
                        <div className="flex items-center gap-0.5 text-xs font-semibold text-green-600 tabular-nums">
                          +{restockTotal}
                          <span className="text-[10px] font-normal text-muted-foreground">{p.restocks.length}×</span>
                        </div>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </div>
                    <div className="px-2 py-2.5 text-center border-l">
                      <span className={cn('text-xs font-semibold tabular-nums', qtyColor)}>
                        {qty != null ? qty : <span className="text-muted-foreground font-normal">—</span>}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal historique réappro — portal pour éviter le confinement overflow/sticky */}
      {openProduct && createPortal(
      <AnimatePresence>
        {openProduct && (() => {
          const totalQty = openProduct.restocks.reduce((s, m) => s + m.quantity, 0)
          const timeline = [...openProduct.restocks, ...openProduct.adjustments]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setOpenProduct(null)}
            >
              <motion.div
                initial={{ y: 60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 60, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="bg-background rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                {/* Header gradient */}
                <div
                  className="relative overflow-hidden px-5 pt-5 pb-4 flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #073e8a 0%, #0d52b8 100%)' }}
                >
                  {/* Decorative circles */}
                  <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/5" />
                  <div className="absolute -bottom-4 -left-4 h-16 w-16 rounded-full bg-white/5" />

                  <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/* Icon + label */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                          <History className="h-3.5 w-3.5 text-white" />
                        </div>
                        <span className="text-xs font-semibold text-blue-200 uppercase tracking-wider">
                          {t('restock_history')}
                        </span>
                      </div>
                      {/* Product name */}
                      <h2 className="text-lg font-bold text-white leading-tight truncate">
                        {openProduct.product_name}
                      </h2>
                      {openProduct.product_unit && (
                        <span className="inline-block mt-0.5 text-[10px] bg-white/15 text-blue-100 px-2 py-0.5 rounded-full">
                          {openProduct.product_unit}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setOpenProduct(null)}
                      className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Stats bar */}
                  <div className="relative mt-4 grid grid-cols-3 gap-2">
                    {[
                      { label: 'Réappros', value: openProduct.restocks.length },
                      { label: 'Total ajouté', value: `+${totalQty}` },
                      { label: 'Stock actuel', value: openProduct.current_qty ?? '—' },
                    ].map(s => (
                      <div key={s.label} className="bg-white/10 rounded-xl px-3 py-2 text-center">
                        <p className="text-lg font-bold text-white tabular-nums">{s.value}</p>
                        <p className="text-[10px] text-blue-200 mt-0.5">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Timeline entries */}
                <div className="overflow-y-auto flex-1 px-4 py-4">
                  <div className="relative space-y-0">
                    {timeline.map((m, idx) => {
                      const isAdjustment = m.type === 'adjustment'
                      const isPositive = m.quantity >= 0
                      const dotColor = isAdjustment
                        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500'
                        : 'bg-green-50 dark:bg-green-950/40 border-green-500'
                      const iconColor = isAdjustment ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'
                      const badgeColor = isPositive
                        ? 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800 text-green-600 dark:text-green-400'
                        : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'
                      return (
                        <div key={m.id} className="relative flex gap-3">
                          {/* Timeline line + dot */}
                          <div className="flex flex-col items-center">
                            <div className={cn('h-8 w-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 z-10', dotColor)}>
                              {isAdjustment
                                ? <ClipboardCheck className={cn('h-3.5 w-3.5', iconColor)} />
                                : <Package className={cn('h-3.5 w-3.5', iconColor)} />
                              }
                            </div>
                            {idx < timeline.length - 1 && (
                              <div className="w-0.5 flex-1 bg-border mt-1 mb-1 min-h-[16px]" />
                            )}
                          </div>

                          {/* Card */}
                          <div className={cn('flex-1 min-w-0', idx < timeline.length - 1 ? 'pb-3' : 'pb-0')}>
                            <div className="rounded-xl border bg-card shadow-sm px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  {/* Reason */}
                                  <p className="text-sm font-semibold text-foreground truncate">
                                    {m.reason || (isAdjustment ? t('type_adjustment') : t('restock_history'))}
                                  </p>
                                  {/* Date + performer */}
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {fmtDate(m.created_at)}
                                    {m.performed_by_name && (
                                      <> · <span className="font-medium text-foreground/70">{m.performed_by_name}</span></>
                                    )}
                                  </p>
                                  {/* Before → After */}
                                  {(m.previous_qty != null || m.new_qty != null) && (
                                    <div className="flex items-center gap-1.5 mt-2">
                                      <span className="bg-muted text-muted-foreground text-[11px] font-semibold px-2.5 py-0.5 rounded-full tabular-nums">
                                        {m.previous_qty ?? '—'}
                                      </span>
                                      <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                      <span className="bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 text-[11px] font-semibold px-2.5 py-0.5 rounded-full tabular-nums border border-green-200 dark:border-green-800">
                                        {m.new_qty ?? '—'}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {/* Quantity badge */}
                                <div className={cn('flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full border', badgeColor)}>
                                  <span className="text-sm font-bold tabular-nums leading-none">
                                    {isPositive ? '+' : ''}{m.quantity}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Footer */}
                <div className="px-4 pb-4 pt-2 border-t flex-shrink-0">
                  <Button
                    variant="outline"
                    className="w-full h-11 font-medium"
                    onClick={() => setOpenProduct(null)}
                  >
                    {t('close')}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>,
      document.body
      )}
    </div>
  )
}
