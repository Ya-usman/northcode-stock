'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Search, Calendar, Package } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
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


export default function StockMovementsPage() {
  const t = useTranslations('movements')
  const { effectiveShopIds } = useAuth()

  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

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
        })
      }
      const p = map.get(name)!

      // Keep current_qty up to date (same for all rows of this product)
      if (m.product_current_qty != null) p.current_qty = m.product_current_qty

      if (m.type === 'in') {
        if (m.reason === 'Stock initial') {
          p.initial_stock = m.new_qty
        } else {
          p.restocks.push(m)
        }
      }
    }

    // Sort restocks newest first
    for (const p of map.values()) {
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

                    {/* Réapprovisionnement */}
                    <div className="text-center px-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                        {t('restocked')}
                      </p>
                      {hasRestocks ? (
                        <div className="space-y-0.5">
                          {p.restocks.map(m => (
                            <p key={m.id} className="text-xs tabular-nums text-green-600 leading-tight">
                              +{m.quantity} <span className="text-muted-foreground font-normal">{format(new Date(m.created_at), 'dd/MM', { locale: fr })}</span>
                            </p>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </div>

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

    </div>
  )
}
