'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowDownCircle, ArrowUpCircle, RefreshCw, MinusCircle, Search, Calendar } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { useCurrency } from '@/lib/hooks/use-currency'
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

export default function StockMovementsPage() {
  const t = useTranslations('movements')
  const { effectiveShopIds } = useAuth()
  const { fmt } = useCurrency()

  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

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

  const filtered = useMemo(() => {
    if (!search.trim()) return movements
    const q = search.toLowerCase()
    return movements.filter(m =>
      m.product_name?.toLowerCase().includes(q) ||
      m.performed_by_name?.toLowerCase().includes(q) ||
      m.reason?.toLowerCase().includes(q)
    )
  }, [movements, search])

  const typeConfig: Record<string, { icon: any; color: string; variant: any; label: string }> = {
    in:         { icon: ArrowDownCircle, color: 'text-green-500',  variant: 'success',  label: t('type_in') },
    out:        { icon: ArrowUpCircle,   color: 'text-red-500',    variant: 'danger',   label: t('type_out') },
    adjustment: { icon: RefreshCw,       color: 'text-blue-500',   variant: 'info',     label: t('type_adjustment') },
    sale:       { icon: MinusCircle,     color: 'text-amber-500',  variant: 'warning',  label: t('type_sale') },
  }

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

      <p className="text-xs text-muted-foreground">{filtered.length} {t('entries')}</p>

      {/* List */}
      <div className="space-y-2">
        {loading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {t('no_movements')}
          </div>
        ) : (
          filtered.map(m => {
            const cfg = typeConfig[m.type] || typeConfig.adjustment
            const Icon = cfg.icon
            const isIn = m.type === 'in'
            return (
              <Card key={m.id} className="border-0 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`mt-0.5 flex-shrink-0 ${cfg.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm truncate">
                            {m.product_name || '—'}
                            {m.product_unit && <span className="text-muted-foreground font-normal"> ({m.product_unit})</span>}
                          </span>
                          <Badge variant={cfg.variant} className="text-[10px] px-1.5 flex-shrink-0">
                            {cfg.label}
                          </Badge>
                        </div>
                        {(m.reason || m.notes) && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {m.reason || m.notes}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
                          {m.performed_by_name && (
                            <span>👤 {m.performed_by_name}</span>
                          )}
                          <span>🕐 {format(new Date(m.created_at), "dd MMM yyyy 'à' HH:mm", { locale: fr })}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`text-lg font-bold ${isIn ? 'text-green-600' : 'text-red-600'}`}>
                        {isIn ? '+' : '-'}{m.quantity}
                      </span>
                      {m.previous_qty != null && m.new_qty != null && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {m.previous_qty} → {m.new_qty}
                        </p>
                      )}
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
