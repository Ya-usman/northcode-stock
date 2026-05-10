'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Search, Calendar, Package, X, ArrowRight } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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

      {/* Product list */}
      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : products.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {t('no_movements')}
          </div>
        ) : (
          products.map(p => {
            const hasRestocks = p.restocks.length > 0
            const restockTotal = p.restocks.reduce((s, m) => s + m.quantity, 0)
            return (
              <Card key={p.product_name} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  {/* Product name */}
                  <div className="flex items-center gap-2 mb-3">
                    <Package className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="font-semibold text-sm">
                      {p.product_name}
                      {p.product_unit && (
                        <span className="text-muted-foreground font-normal"> ({p.product_unit})</span>
                      )}
                    </span>
                  </div>

                  {/* Three stat columns */}
                  <div className="grid grid-cols-3 divide-x divide-border">
                    <div className="text-center pr-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">{t('initial_stock')}</p>
                      <p className="text-xl font-bold tabular-nums">
                        {p.initial_stock != null ? p.initial_stock : <span className="text-muted-foreground text-sm">—</span>}
                      </p>
                    </div>

                    {/* Réappro cliquable */}
                    <button
                      disabled={!hasRestocks}
                      onClick={() => hasRestocks && setOpenProduct(p)}
                      className={`text-center px-3 rounded-sm transition-colors ${hasRestocks ? 'cursor-pointer hover:bg-muted/50 active:bg-muted' : 'cursor-default'}`}
                    >
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">{t('restocked')}</p>
                      <p className={`text-xl font-bold tabular-nums ${hasRestocks ? 'text-green-600 underline underline-offset-2 decoration-dotted' : ''}`}>
                        {hasRestocks ? `+${restockTotal}` : <span className="text-muted-foreground text-sm">—</span>}
                      </p>
                      {hasRestocks && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{p.restocks.length}×</p>
                      )}
                    </button>

                    <div className="text-center pl-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">{t('current_stock')}</p>
                      <p className={`text-xl font-bold tabular-nums ${
                        p.current_qty != null
                          ? p.current_qty === 0 ? 'text-red-600' : p.current_qty <= 5 ? 'text-amber-500' : ''
                          : ''
                      }`}>
                        {p.current_qty != null ? p.current_qty : <span className="text-muted-foreground text-sm">—</span>}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* Modal historique réappro */}
      {openProduct && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4 bg-black/50"
          onClick={() => setOpenProduct(null)}>
          <div className="bg-background rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="p-5 border-b">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold text-lg">{t('restock_history')}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {openProduct.product_name}
                    {openProduct.product_unit && ` (${openProduct.product_unit})`}
                  </p>
                </div>
                <button onClick={() => setOpenProduct(null)} className="text-muted-foreground hover:text-foreground p-1">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Entries */}
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {openProduct.restocks.map((m, idx) => (
                <div key={m.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Reason + badge */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-semibold text-primary">
                          {m.reason || t('restock_history')}
                        </span>
                        <Badge variant="success" className="text-[10px] px-1.5">{t('type_in')}</Badge>
                      </div>
                      {/* Date · par */}
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(m.created_at)}
                        {m.performed_by_name && (
                          <> · {t('performed_by')} <span className="font-semibold text-foreground">{m.performed_by_name}</span></>
                        )}
                      </p>
                      {/* Stock avant → après */}
                      {(m.previous_qty != null || m.new_qty != null) && (
                        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                          <span className="tabular-nums">{m.previous_qty ?? '—'}</span>
                          <ArrowRight className="h-3 w-3" />
                          <span className="tabular-nums font-semibold text-green-600">{m.new_qty ?? '—'}</span>
                          <span className="text-muted-foreground">({t('stock_before')} → {t('stock_after')})</span>
                        </div>
                      )}
                    </div>
                    {/* Quantité */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-2xl font-bold text-green-600 tabular-nums">+{m.quantity}</p>
                    </div>
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
          </div>
        </div>
      )}
    </div>
  )
}
