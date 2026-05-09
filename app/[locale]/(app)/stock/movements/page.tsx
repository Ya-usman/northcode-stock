'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowDownCircle, ArrowUpCircle, RefreshCw, MinusCircle, Search, Calendar, ChevronRight, X } from 'lucide-react'
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
  performed_by_name: string | null
}

interface GroupKey {
  product_name: string | null
  product_unit: string | null
  type: Movement['type']
}

interface MovementGroup extends GroupKey {
  key: string
  total_qty: number
  count: number
  last_date: string
  items: Movement[]
}

const TYPE_CONFIG: Record<string, { icon: any; color: string; variant: any; label_key: string; sign: '+' | '-' }> = {
  in:         { icon: ArrowDownCircle, color: 'text-green-500',  variant: 'success', label_key: 'type_in',         sign: '+' },
  out:        { icon: ArrowUpCircle,   color: 'text-red-500',    variant: 'danger',  label_key: 'type_out',        sign: '-' },
  adjustment: { icon: RefreshCw,       color: 'text-blue-500',   variant: 'info',    label_key: 'type_adjustment', sign: '+' },
  sale:       { icon: MinusCircle,     color: 'text-amber-500',  variant: 'warning', label_key: 'type_sale',       sign: '-' },
}

function fmtDate(d: string) {
  return format(new Date(d), "dd MMM yyyy 'à' HH:mm", { locale: fr })
}

export default function StockMovementsPage() {
  const t = useTranslations('movements')
  const { effectiveShopIds } = useAuth()

  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [openGroup, setOpenGroup] = useState<MovementGroup | null>(null)

  useEffect(() => {
    if (!effectiveShopIds.length) return
    setLoading(true)
    const params = new URLSearchParams({ shop_ids: effectiveShopIds.join(',') })
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)

    fetch(`/api/stock/movements?${params}`)
      .then(r => r.json())
      .then(data => { setMovements(data.movements || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [effectiveShopIds.join(','), typeFilter, dateFrom, dateTo])

  // Filter then group by product × type
  const groups = useMemo<MovementGroup[]>(() => {
    let list = movements
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        m.product_name?.toLowerCase().includes(q) ||
        m.performed_by_name?.toLowerCase().includes(q) ||
        m.reason?.toLowerCase().includes(q)
      )
    }

    const map = new Map<string, MovementGroup>()
    for (const m of list) {
      const key = `${m.product_name ?? ''}||${m.type}`
      if (!map.has(key)) {
        map.set(key, {
          key,
          product_name: m.product_name,
          product_unit: m.product_unit,
          type: m.type,
          total_qty: 0,
          count: 0,
          last_date: m.created_at,
          items: [],
        })
      }
      const g = map.get(key)!
      g.total_qty += m.quantity
      g.count += 1
      if (m.created_at > g.last_date) g.last_date = m.created_at
      g.items.push(m)
    }

    // Sort items within each group newest first
    for (const g of map.values()) {
      g.items.sort((a, b) => b.created_at.localeCompare(a.created_at))
    }

    return Array.from(map.values()).sort((a, b) => b.last_date.localeCompare(a.last_date))
  }, [movements, search])

  const totalRestocks = movements.filter(m => m.type === 'in').reduce((s, m) => s + m.quantity, 0)
  const totalSales    = movements.filter(m => m.type === 'sale').reduce((s, m) => s + m.quantity, 0)

  return (
    <div className="space-y-4">

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">{t('total_restocked')}</p>
            <p className="text-2xl font-bold text-green-600">+{totalRestocks}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">{t('total_sold')}</p>
            <p className="text-2xl font-bold text-amber-600">-{totalSales}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('search_placeholder')} className="pl-9 h-9" />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder={t('all_types')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('all_types')}</SelectItem>
            <SelectItem value="in">{t('type_in')}</SelectItem>
            <SelectItem value="sale">{t('type_sale')}</SelectItem>
            <SelectItem value="adjustment">{t('type_adjustment')}</SelectItem>
            <SelectItem value="out">{t('type_out')}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="h-9 w-[130px] text-xs" />
          <span className="text-muted-foreground text-xs">→</span>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="h-9 w-[130px] text-xs" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{groups.length} {t('entries')}</p>

      {/* Grouped list */}
      <div className="space-y-2">
        {loading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : groups.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {t('no_movements')}
          </div>
        ) : (
          groups.map(g => {
            const cfg = TYPE_CONFIG[g.type] || TYPE_CONFIG.adjustment
            const Icon = cfg.icon
            const isIn = g.type === 'in'
            return (
              <Card key={g.key} className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setOpenGroup(g)}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`flex-shrink-0 ${cfg.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm truncate">
                            {g.product_name || '—'}
                            {g.product_unit && <span className="text-muted-foreground font-normal"> ({g.product_unit})</span>}
                          </span>
                          <Badge variant={cfg.variant} className="text-[10px] px-1.5 flex-shrink-0">
                            {t(cfg.label_key)}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {g.count} {t('operations')} · {t('last')}: {fmtDate(g.last_date)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-medium">{t('qty_change')}</p>
                        <p className={`text-lg font-bold tabular-nums ${isIn ? 'text-green-600' : 'text-red-600'}`}>
                          {cfg.sign}{g.total_qty}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* Detail modal */}
      {openGroup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4 bg-black/50"
          onClick={() => setOpenGroup(null)}>
          <div className="bg-background rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b">
              <div>
                <h2 className="font-bold text-lg leading-tight">
                  {openGroup.product_name || '—'}
                  {openGroup.product_unit && <span className="text-muted-foreground font-normal text-base"> ({openGroup.product_unit})</span>}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={(TYPE_CONFIG[openGroup.type] || TYPE_CONFIG.adjustment).variant} className="text-xs">
                    {t((TYPE_CONFIG[openGroup.type] || TYPE_CONFIG.adjustment).label_key)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{openGroup.count} {t('operations')}</span>
                </div>
              </div>
              <button onClick={() => setOpenGroup(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* List of individual movements */}
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {openGroup.items.map((m, idx) => {
                const isIn = m.type === 'in'
                return (
                  <div key={m.id} className="rounded-xl border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {(m.reason || m.notes) && (
                          <p className="text-sm font-medium truncate">{m.reason || m.notes}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
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
                          <p className={`text-sm font-semibold tabular-nums ${m.new_qty != null ? (isIn ? 'text-green-600' : 'text-red-600') : ''}`}>
                            {m.new_qty != null ? m.new_qty : <span className="text-muted-foreground">—</span>}
                          </p>
                        </div>
                        <div className="pl-3">
                          <p className="text-[9px] uppercase text-muted-foreground font-medium">{t('qty_change')}</p>
                          <p className={`text-sm font-bold tabular-nums ${isIn ? 'text-green-600' : 'text-red-600'}`}>
                            {isIn ? '+' : '-'}{m.quantity}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="p-4 border-t">
              <Button variant="outline" className="w-full" onClick={() => setOpenGroup(null)}>
                {t('close')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
