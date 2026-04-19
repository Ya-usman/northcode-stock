'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowDownCircle, ArrowUpCircle, RefreshCw, MinusCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { format } from 'date-fns'
import type { StockMovement } from '@/lib/types/database'

const typeConfig = {
  in: { icon: ArrowDownCircle, color: 'text-green-500', label: 'Stock In', variant: 'success' as const },
  out: { icon: ArrowUpCircle, color: 'text-red-500', label: 'Stock Out', variant: 'danger' as const },
  adjustment: { icon: RefreshCw, color: 'text-blue-500', label: 'Adjustment', variant: 'info' as const },
  sale: { icon: MinusCircle, color: 'text-amber-500', label: 'Sale', variant: 'warning' as const },
}

export default function StockMovementsPage() {
  const t = useTranslations('movements')
  const { shop } = useAuth()
  const supabase = createClient()

  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => {
    if (!shop?.id) return
    const load = async () => {
      let query = supabase
        .from('stock_movements')
        .select('*, products(name, unit), profiles(full_name)')
        .eq('shop_id', shop.id)
        .order('created_at', { ascending: false })
        .limit(200)

      if (typeFilter !== 'all') query = query.eq('type', typeFilter)

      const { data } = await query
      setMovements((data || []) as unknown as StockMovement[])
      setLoading(false)
    }
    load()
  }, [shop?.id, typeFilter])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="in">{t('type_in')}</SelectItem>
            <SelectItem value="out">{t('type_out')}</SelectItem>
            <SelectItem value="adjustment">{t('type_adjustment')}</SelectItem>
            <SelectItem value="sale">{t('type_sale')}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{movements.length} entries</span>
      </div>

      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : movements.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">{t('no_movements')}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="hidden sm:table-cell">Reason</TableHead>
                <TableHead className="hidden md:table-cell">{t('performed_by')}</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map(m => {
                const config = typeConfig[m.type] || typeConfig.adjustment
                const Icon = config.icon
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                        <Badge variant={config.variant} className="text-[10px] px-1.5">{config.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {(m as any).products?.name || '—'}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      <span className={m.type === 'in' ? 'text-green-600' : 'text-red-600'}>
                        {m.type === 'in' ? '+' : '-'}{m.quantity}
                      </span>
                      {' '}<span className="text-xs text-muted-foreground">{(m as any).products?.unit}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground max-w-[160px] truncate">
                      {m.reason || m.notes || '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs">
                      {(m as any).profiles?.full_name || '—'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground text-right">
                      {format(new Date(m.created_at), 'dd MMM · HH:mm')}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
