'use client'

import { useState, useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Search, Calendar, Package, ArrowRight, X, History } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
  latest_at: string
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
  const [openProduct, setOpenProduct] = useState<ProductSummary | null>(null)

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
          latest_at: m.created_at,
        })
      }
      const p = map.get(name)!
      if (m.created_at > p.latest_at) p.latest_at = m.created_at
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
              const qty = p.current_qty
              const qtyColor = qty === 0 ? 'text-red-600' : qty != null && qty <= 5 ? 'text-amber-500' : ''

              return (
                <button
                  key={p.product_name}
                  onClick={() => hasRestocks && setOpenProduct(p)}
                  className={cn(
                    'w-full grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 items-center transition-colors text-left',
                    hasRestocks ? 'hover:bg-muted/20 cursor-pointer' : 'cursor-default'
                  )}
                >
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

                  {/* Réappro */}
                  <div className="w-28 flex justify-center">
                    {hasRestocks ? (
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-green-600 tabular-nums">
                        +{restockTotal}
                        <span className="text-[10px] font-normal text-muted-foreground">{p.restocks.length}×</span>
                        <History className="h-3 w-3 text-muted-foreground" />
                      </div>
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
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal historique réappro */}
      <AnimatePresence>
        {openProduct && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4 bg-black/50"
            onClick={() => setOpenProduct(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-background rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-xl"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-5 border-b flex items-start justify-between">
                <div>
                  <h2 className="font-bold text-lg">{t('restock_history')}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-sm text-muted-foreground">{openProduct.product_name}</p>
                    {openProduct.product_unit && (
                      <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                        {openProduct.product_unit}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setOpenProduct(null)} className="text-muted-foreground hover:text-foreground p-1">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Entries */}
              <div className="overflow-y-auto flex-1 p-4 space-y-3">
                {openProduct.restocks.map(m => (
                  <div key={m.id} className="rounded-xl border bg-card px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-semibold truncate">
                            {m.reason || t('restock_history')}
                          </span>
                          <Badge variant="success" className="text-[10px] px-1.5 py-0">
                            {t('type_in')}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
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
                      <p className="text-xl font-bold text-green-600 tabular-nums flex-shrink-0">
                        +{m.quantity}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="p-4 border-t">
                <Button variant="outline" className="w-full h-11 text-base" onClick={() => setOpenProduct(null)}>
                  {t('close')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
