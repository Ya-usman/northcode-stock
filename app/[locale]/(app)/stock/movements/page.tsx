'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Search, Calendar, Package, TrendingUp, ChevronDown, ArrowRight } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils/cn'
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
}

function fmtDate(d: string) {
  return format(new Date(d), "dd MMM yyyy 'à' HH:mm", { locale: fr })
}

function stockColor(qty: number | null) {
  if (qty === null) return { border: 'border-l-border', dot: 'bg-muted-foreground', text: '' }
  if (qty === 0) return { border: 'border-l-red-500', dot: 'bg-red-500', text: 'text-red-600' }
  if (qty <= 5) return { border: 'border-l-amber-400', dot: 'bg-amber-400', text: 'text-amber-500' }
  return { border: 'border-l-green-500', dot: 'bg-green-500', text: '' }
}

export default function StockMovementsPage() {
  const t = useTranslations('movements')
  const { effectiveShopIds } = useAuth()

  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)

  useEffect(() => {
    if (!effectiveShopIds.length) return
    setLoading(true)
    const params = new URLSearchParams({ shop_ids: effectiveShopIds.join(',') })
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to', dateTo)

    fetch(`/api/stock/movements?${params}`)
      .then(r => r.json())
      .then(data => { setMovements(data.movements || []); setLoading(false) })
      .catch(() => setLoading(false))
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
        })
      }
      const p = map.get(name)!
      if (m.product_current_qty != null) p.current_qty = m.product_current_qty
      if (m.type === 'in') {
        if (m.reason === 'Stock initial') p.initial_stock = m.new_qty
        else p.restocks.push(m)
      }
    }

    for (const p of map.values())
      p.restocks.sort((a, b) => b.created_at.localeCompare(a.created_at))

    let list = Array.from(map.values())
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p => p.product_name.toLowerCase().includes(q))
    }
    return list.sort((a, b) => a.product_name.localeCompare(b.product_name))
  }, [movements, search])

  const totalRestocks = movements
    .filter(m => m.type === 'in' && m.reason !== 'Stock initial')
    .reduce((s, m) => s + m.quantity, 0)

  return (
    <div className="space-y-4">

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 p-4 text-white shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="h-3.5 w-3.5 text-white" />
            </div>
            <p className="text-xs font-medium text-white/80">{t('total_restocked')}</p>
          </div>
          <p className="text-2xl font-bold tabular-nums">+{totalRestocks}</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-northcode-blue to-northcode-blue-light p-4 text-white shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <Package className="h-3.5 w-3.5 text-white" />
            </div>
            <p className="text-xs font-medium text-white/80">{t('products_tracked')}</p>
          </div>
          <p className="text-2xl font-bold tabular-nums">{products.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('search_placeholder')} className="pl-9 h-9" />
        </div>
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="h-9 w-[130px] text-xs" />
          <span className="text-muted-foreground text-xs">→</span>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="h-9 w-[130px] text-xs" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{products.length} {t('products_count')}</p>

      {/* Product list */}
      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : products.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {t('no_movements')}
          </div>
        ) : (
          products.map(p => {
            const hasRestocks = p.restocks.length > 0
            const restockTotal = p.restocks.reduce((s, m) => s + m.quantity, 0)
            const colors = stockColor(p.current_qty)
            const isExpanded = expandedProduct === p.product_name

            return (
              <div key={p.product_name}
                className={cn(
                  'rounded-2xl bg-card border-l-4 shadow-sm overflow-hidden',
                  colors.border
                )}>

                {/* Product header */}
                <div className="px-4 pt-4 pb-3 flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <span className="font-semibold text-sm">{p.product_name}</span>
                  {p.product_unit && (
                    <span className="text-[10px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                      {p.product_unit}
                    </span>
                  )}
                </div>

                {/* Three stat columns */}
                <div className="grid grid-cols-3 divide-x divide-border border-t">

                  {/* Stock de base */}
                  <div className="text-center px-3 py-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                      {t('initial_stock')}
                    </p>
                    <p className="text-xl font-bold tabular-nums">
                      {p.initial_stock != null
                        ? p.initial_stock
                        : <span className="text-muted-foreground text-sm">—</span>}
                    </p>
                  </div>

                  {/* Réappro — cliquable, expand inline */}
                  <button
                    disabled={!hasRestocks}
                    onClick={() => hasRestocks && setExpandedProduct(isExpanded ? null : p.product_name)}
                    className={cn(
                      'text-center px-3 py-3 transition-colors',
                      hasRestocks ? 'cursor-pointer hover:bg-muted/40' : 'cursor-default'
                    )}
                  >
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                      {t('restocked')}
                    </p>
                    {hasRestocks ? (
                      <>
                        <div className="inline-flex items-center gap-1 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 px-2.5 py-0.5 rounded-full">
                          <TrendingUp className="h-3 w-3" />
                          <span className="text-base font-bold tabular-nums">+{restockTotal}</span>
                        </div>
                        <div className="flex items-center justify-center gap-1 mt-1">
                          <span className="text-[10px] text-muted-foreground">{p.restocks.length}×</span>
                          <ChevronDown className={cn(
                            'h-3 w-3 text-muted-foreground transition-transform duration-200',
                            isExpanded && 'rotate-180'
                          )} />
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </button>

                  {/* Stock actuel */}
                  <div className="text-center px-3 py-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                      {t('current_stock')}
                    </p>
                    <div className="flex items-center justify-center gap-1.5">
                      {p.current_qty != null && (
                        <span className={cn('h-2 w-2 rounded-full flex-shrink-0', colors.dot)} />
                      )}
                      <p className={cn('text-xl font-bold tabular-nums', colors.text)}>
                        {p.current_qty != null
                          ? p.current_qty
                          : <span className="text-muted-foreground text-sm">—</span>}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Inline restock history */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t bg-muted/20">
                      <div className="p-3 space-y-2">
                        {p.restocks.map(m => (
                          <div key={m.id} className="rounded-xl bg-card border px-3.5 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                {/* Reason + badge */}
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className="text-xs font-semibold text-foreground truncate">
                                    {m.reason || t('restock_history')}
                                  </span>
                                  <Badge variant="success" className="text-[10px] px-1.5 py-0">
                                    {t('type_in')}
                                  </Badge>
                                </div>
                                {/* Date · par */}
                                <p className="text-[11px] text-muted-foreground mb-2">
                                  {fmtDate(m.created_at)}
                                  {m.performed_by_name && (
                                    <> · <span className="font-semibold text-foreground">{m.performed_by_name}</span></>
                                  )}
                                </p>
                                {/* Pills avant → après */}
                                {(m.previous_qty != null || m.new_qty != null) && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="bg-muted text-muted-foreground text-[11px] font-semibold px-2.5 py-0.5 rounded-full tabular-nums">
                                      {m.previous_qty ?? '—'}
                                    </span>
                                    <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                    <span className="bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-400 text-[11px] font-semibold px-2.5 py-0.5 rounded-full tabular-nums">
                                      {m.new_qty ?? '—'}
                                    </span>
                                  </div>
                                )}
                              </div>
                              {/* Quantité */}
                              <p className="text-xl font-bold text-green-600 dark:text-green-400 tabular-nums flex-shrink-0">
                                +{m.quantity}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
