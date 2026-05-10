'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Search, Calendar, Package, TrendingUp, ChevronDown, ArrowRight } from 'lucide-react'
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

function stockTextColor(qty: number | null) {
  if (qty === null) return ''
  if (qty === 0) return 'text-red-600'
  if (qty <= 5) return 'text-amber-500'
  return ''
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
    <div className="space-y-4 max-w-2xl mx-auto">

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

      {/* Product list */}
      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : products.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {t('no_movements')}
          </div>
        ) : (
          products.map(p => {
            const hasRestocks = p.restocks.length > 0
            const restockTotal = p.restocks.reduce((s, m) => s + m.quantity, 0)
            const isExpanded = expandedProduct === p.product_name

            return (
              <Card key={p.product_name} className="border-0 shadow-sm overflow-hidden">

                {/* Product header */}
                <div className="flex items-center gap-2 px-4 pt-3 pb-0">
                  <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="font-semibold text-sm">{p.product_name}</span>
                  {p.product_unit && (
                    <span className="text-[10px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                      {p.product_unit}
                    </span>
                  )}
                </div>

                {/* Three stat columns */}
                <div className="grid grid-cols-3 divide-x divide-border mt-2">

                  {/* Stock de base */}
                  <div className="text-center px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                      {t('initial_stock')}
                    </p>
                    <p className="text-lg font-bold tabular-nums">
                      {p.initial_stock != null
                        ? p.initial_stock
                        : <span className="text-muted-foreground text-sm">—</span>}
                    </p>
                  </div>

                  {/* Réappro — cliquable */}
                  <button
                    disabled={!hasRestocks}
                    onClick={() => hasRestocks && setExpandedProduct(isExpanded ? null : p.product_name)}
                    className={cn(
                      'text-center px-3 py-2 transition-colors',
                      hasRestocks ? 'cursor-pointer hover:bg-muted/40' : 'cursor-default'
                    )}
                  >
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                      {t('restocked')}
                    </p>
                    {hasRestocks ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-lg font-bold tabular-nums text-green-600">+{restockTotal}</span>
                        <div className="flex items-center gap-0.5">
                          <span className="text-[10px] text-muted-foreground">{p.restocks.length}×</span>
                          <ChevronDown className={cn(
                            'h-3 w-3 text-muted-foreground transition-transform duration-200',
                            isExpanded && 'rotate-180'
                          )} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </button>

                  {/* Stock actuel */}
                  <div className="text-center px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                      {t('current_stock')}
                    </p>
                    <p className={cn('text-lg font-bold tabular-nums', stockTextColor(p.current_qty))}>
                      {p.current_qty != null
                        ? p.current_qty
                        : <span className="text-muted-foreground text-sm">—</span>}
                    </p>
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
                          <div key={m.id} className="rounded-xl bg-card border px-3.5 py-2.5">
                            <div className="flex items-start justify-between gap-3">
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
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
