'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Search, Calendar, Package, ChevronDown, ArrowRight } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
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
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 flex justify-between items-center">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('total_restocked')}</p>
            <p className="text-2xl font-bold text-green-600">+{totalRestocks}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-1">{t('products_tracked')}</p>
            <p className="text-2xl font-bold">{products.length}</p>
          </div>
        </CardContent>
      </Card>

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

          {/* Header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 border-b bg-muted/40">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('product')}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-24 text-center">
              {t('initial_stock')}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-28 text-center">
              {t('restocked')}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-24 text-right">
              {t('current_stock')}
            </span>
          </div>

          {/* Rows */}
          <div className="divide-y">
            {products.map(p => {
              const hasRestocks = p.restocks.length > 0
              const restockTotal = p.restocks.reduce((s, m) => s + m.quantity, 0)
              const isExpanded = expandedProduct === p.product_name
              const qty = p.current_qty
              const qtyColor = qty === 0 ? 'text-red-600' : qty != null && qty <= 5 ? 'text-amber-500' : ''

              return (
                <div key={p.product_name}>
                  {/* Main row */}
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 items-center hover:bg-muted/20 transition-colors">

                    {/* Product name */}
                    <div className="flex items-center gap-2 min-w-0">
                      <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{p.product_name}</span>
                      {p.product_unit && (
                        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full flex-shrink-0">
                          {p.product_unit}
                        </span>
                      )}
                    </div>

                    {/* Stock de base */}
                    <div className="w-24 text-center">
                      <span className="text-sm tabular-nums font-medium">
                        {p.initial_stock != null
                          ? p.initial_stock
                          : <span className="text-muted-foreground">—</span>}
                      </span>
                    </div>

                    {/* Réappro — cliquable */}
                    <div className="w-28 flex justify-center">
                      {hasRestocks ? (
                        <button
                          onClick={() => setExpandedProduct(isExpanded ? null : p.product_name)}
                          className="flex flex-col items-center gap-0.5 hover:opacity-70 transition-opacity"
                        >
                          <div className="flex items-center gap-1 text-sm font-semibold text-green-600 tabular-nums">
                            +{restockTotal}
                            <span className="text-[10px] font-normal text-muted-foreground">{p.restocks.length}×</span>
                            <ChevronDown className={cn(
                              'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                              isExpanded && 'rotate-180'
                            )} />
                          </div>
                          {p.restocks[0].previous_qty != null && p.restocks[0].new_qty != null && (
                            <div className="flex items-center gap-1">
                              <span className="bg-muted text-muted-foreground text-[10px] font-medium px-1.5 py-0 rounded-full tabular-nums">
                                {p.restocks[0].previous_qty}
                              </span>
                              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
                              <span className="bg-muted text-foreground text-[10px] font-medium px-1.5 py-0 rounded-full tabular-nums border border-border">
                                {p.restocks[0].new_qty}
                              </span>
                            </div>
                          )}
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </div>

                    {/* Stock actuel */}
                    <div className="w-24 text-right">
                      <span className={cn('text-sm font-semibold tabular-nums', qtyColor)}>
                        {qty != null ? qty : <span className="text-muted-foreground font-normal">—</span>}
                      </span>
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
                        className="overflow-hidden border-t bg-muted/20"
                      >
                        <div className="px-4 py-3 space-y-2">
                          {p.restocks.map(m => (
                            <div key={m.id} className="flex items-start justify-between gap-4 rounded-lg bg-card border px-3.5 py-2.5">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                  <span className="text-xs font-semibold truncate">
                                    {m.reason || t('restock_history')}
                                  </span>
                                  <Badge variant="success" className="text-[10px] px-1.5 py-0">
                                    {t('type_in')}
                                  </Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground mb-1.5">
                                  {fmtDate(m.created_at)}
                                  {m.performed_by_name && (
                                    <> · <span className="font-semibold text-foreground">{m.performed_by_name}</span></>
                                  )}
                                </p>
                                {(m.previous_qty != null || m.new_qty != null) && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="bg-muted text-muted-foreground text-[11px] font-semibold px-2.5 py-0.5 rounded-full tabular-nums">
                                      {m.previous_qty ?? '—'}
                                    </span>
                                    <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                    <span className="bg-muted text-foreground text-[11px] font-semibold px-2.5 py-0.5 rounded-full tabular-nums border border-border">
                                      {m.new_qty ?? '—'}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <p className="text-base font-bold text-green-600 tabular-nums flex-shrink-0">
                                +{m.quantity}
                              </p>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
