'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Search, Calendar, X, Package, ChevronRight } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  initial_stock: number | null       // new_qty of the "Stock initial" movement
  restocks: Movement[]               // type=in, excluding initial stock
  all_in_movements: Movement[]       // all type=in (for modal)
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

  // Build per-product summary
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
          all_in_movements: [],
        })
      }
      const p = map.get(name)!

      // Keep current_qty up to date (same for all rows of this product)
      if (m.product_current_qty != null) p.current_qty = m.product_current_qty

      if (m.type === 'in') {
        p.all_in_movements.push(m)
        if (m.reason === 'Stock initial') {
          p.initial_stock = m.new_qty
        } else {
          p.restocks.push(m)
        }
      }
    }

    // Sort restocks newest first
    for (const p of map.values()) {
      p.all_in_movements.sort((a, b) => b.created_at.localeCompare(a.created_at))
      p.restocks.sort((a, b) => b.created_at.localeCompare(a.created_at))
    }

    let list = Array.from(map.values())

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p => p.product_name.toLowerCase().includes(q))
    }

    return list.sort((a, b) => a.product_name.localeCompare(b.product_name))
  }, [movements, search])

  const totalRestocks = movements.filter(m => m.type === 'in' && m.reason !== 'Stock initial')
    .reduce((s, m) => s + m.quantity, 0)

  return (
    <div className="space-y-4">

      {/* Summary card */}
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
            const restockTotal = p.restocks.reduce((s, m) => s + m.quantity, 0)
            const hasRestocks = p.restocks.length > 0
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

                  {/* Three columns */}
                  <div className="grid grid-cols-3 divide-x divide-border">
                    {/* Stock de base */}
                    <div className="text-center pr-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                        {t('initial_stock')}
                      </p>
                      <p className="text-xl font-bold tabular-nums">
                        {p.initial_stock != null
                          ? p.initial_stock
                          : <span className="text-muted-foreground text-sm">—</span>}
                      </p>
                    </div>

                    {/* Réapprovisionnement (cliquable) */}
                    <button
                      disabled={!hasRestocks}
                      onClick={() => hasRestocks && setOpenProduct(p)}
                      className={`text-center px-3 transition-colors rounded-sm ${hasRestocks ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default'}`}
                    >
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                        {t('restocked')}
                      </p>
                      <div className="flex items-center justify-center gap-1">
                        <p className={`text-xl font-bold tabular-nums ${hasRestocks ? 'text-green-600' : ''}`}>
                          {hasRestocks ? `+${restockTotal}` : <span className="text-muted-foreground text-sm">—</span>}
                        </p>
                        {hasRestocks && <ChevronRight className="h-3.5 w-3.5 text-green-500" />}
                      </div>
                      {hasRestocks && (
                        <p className="text-[10px] text-muted-foreground">{p.restocks.length} fois</p>
                      )}
                    </button>

                    {/* Stock actuel */}
                    <div className="text-center pl-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                        {t('current_stock')}
                      </p>
                      <p className={`text-xl font-bold tabular-nums ${
                        p.current_qty != null
                          ? p.current_qty === 0 ? 'text-red-600' : p.current_qty <= 5 ? 'text-amber-500' : 'text-foreground'
                          : ''
                      }`}>
                        {p.current_qty != null
                          ? p.current_qty
                          : <span className="text-muted-foreground text-sm">—</span>}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* Restock history modal */}
      {openProduct && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4 bg-black/50"
          onClick={() => setOpenProduct(null)}>
          <div className="bg-background rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b">
              <div>
                <h2 className="font-bold text-lg leading-tight">
                  {openProduct.product_name}
                  {openProduct.product_unit && (
                    <span className="text-muted-foreground font-normal text-base"> ({openProduct.product_unit})</span>
                  )}
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t('restock_history')} · {openProduct.restocks.length} {t('operations')}
                </p>
              </div>
              <button onClick={() => setOpenProduct(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Restock entries */}
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {openProduct.restocks.map(m => (
                <div key={m.id} className="rounded-xl border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.reason || '—'}</p>
                      {m.notes && <p className="text-xs text-muted-foreground truncate">{m.notes}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        {m.performed_by_name && <span>👤 {m.performed_by_name} · </span>}
                        🕐 {fmtDate(m.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 divide-x divide-border text-center">
                      <div className="pr-3">
                        <p className="text-[9px] uppercase text-muted-foreground font-medium">{t('stock_before')}</p>
                        <p className="text-sm font-semibold tabular-nums">
                          {m.previous_qty != null ? m.previous_qty : <span className="text-muted-foreground">—</span>}
                        </p>
                      </div>
                      <div className="px-3">
                        <p className="text-[9px] uppercase text-muted-foreground font-medium">{t('stock_after')}</p>
                        <p className="text-sm font-semibold tabular-nums text-green-600">
                          {m.new_qty != null ? m.new_qty : <span className="text-muted-foreground">—</span>}
                        </p>
                      </div>
                      <div className="pl-3">
                        <p className="text-[9px] uppercase text-muted-foreground font-medium">{t('qty_change')}</p>
                        <p className="text-sm font-bold tabular-nums text-green-600">+{m.quantity}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-4 border-t">
              <Button variant="outline" className="w-full" onClick={() => setOpenProduct(null)}>
                {t('close')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
