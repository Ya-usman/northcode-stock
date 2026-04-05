'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Search, Filter, FileDown, ChevronDown, ChevronUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import { format, startOfDay, endOfDay, subDays, startOfWeek, startOfMonth } from 'date-fns'
import type { Sale } from '@/lib/types/database'

const statusVariant: Record<string, any> = {
  paid: 'success',
  partial: 'warning',
  pending: 'danger',
}

const methodLabels: Record<string, string> = {
  cash: 'Cash', transfer: 'Transfer', credit: 'Credit', paystack: 'Paystack',
}

export default function SalesHistoryPage() {
  const t = useTranslations()
  const { profile, shop } = useAuth()
  const { fmt: formatNaira } = useCurrency()
  const supabase = createClient()

  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('today')
  const [methodFilter, setMethodFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchSales = async () => {
    if (!shop?.id) return
    setLoading(true)

    const now = new Date()
    let start: Date, end: Date = endOfDay(now)

    switch (dateFilter) {
      case 'today': start = startOfDay(now); break
      case 'week': start = startOfWeek(now); break
      case 'month': start = startOfMonth(now); break
      default: start = subDays(now, 30)
    }

    let query = supabase
      .from('sales')
      .select('*, customers(name, phone), sale_items(product_name, quantity, unit_price, subtotal)')
      .eq('shop_id', shop.id)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false })

    // Cashier sees only their own sales
    if (profile?.role === 'cashier') {
      query = query.eq('cashier_id', profile.id)
    }
    if (methodFilter !== 'all') query = query.eq('payment_method', methodFilter)
    if (statusFilter !== 'all') query = query.eq('payment_status', statusFilter)

    const { data } = await query
    setSales((data || []) as unknown as Sale[])
    setLoading(false)
  }

  useEffect(() => { fetchSales() }, [shop?.id, dateFilter, methodFilter, statusFilter])

  const filtered = sales.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      s.sale_number?.toLowerCase().includes(q) ||
      (s as any).customers?.name?.toLowerCase().includes(q)
    )
  })

  const exportCSV = () => {
    const rows = [
      ['Sale #', 'Date', 'Customer', 'Total', 'Paid', 'Balance', 'Method', 'Status'],
      ...filtered.map(s => [
        s.sale_number,
        format(new Date(s.created_at), 'dd/MM/yyyy HH:mm'),
        (s as any).customers?.name || 'Walk-in',
        s.total,
        s.amount_paid,
        s.balance,
        s.payment_method,
        s.payment_status,
      ]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sales-${dateFilter}-${Date.now()}.csv`
    a.click()
  }

  return (
    <div className="space-y-4">
      {/* Filters row */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search sale # or customer…"
            className="pl-9 h-9"
          />
        </div>
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-[120px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">{t('sales.filter_today')}</SelectItem>
            <SelectItem value="week">{t('sales.filter_week')}</SelectItem>
            <SelectItem value="month">{t('sales.filter_month')}</SelectItem>
            <SelectItem value="custom">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-[120px] h-9">
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Methods</SelectItem>
            <SelectItem value="cash">{t('payment.cash')}</SelectItem>
            <SelectItem value="transfer">{t('payment.transfer')}</SelectItem>
            <SelectItem value="credit">{t('payment.credit')}</SelectItem>
            <SelectItem value="paystack">Paystack</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[110px] h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="paid">{t('status.paid')}</SelectItem>
            <SelectItem value="partial">{t('status.partial')}</SelectItem>
            <SelectItem value="pending">{t('status.pending')}</SelectItem>
          </SelectContent>
        </Select>
        {profile?.role === 'owner' && (
          <Button variant="outline" size="sm" onClick={exportCSV} className="h-9 gap-1">
            <FileDown className="h-3.5 w-3.5" />
            CSV
          </Button>
        )}
      </div>

      {/* Summary row */}
      {profile?.role === 'owner' && (
        <div className="flex gap-4 text-sm flex-wrap">
          <span className="text-muted-foreground">
            {filtered.length} sales ·{' '}
            <span className="font-semibold text-foreground">
              {formatNaira(filtered.reduce((s, sale) => s + Number(sale.total), 0))}
            </span>
          </span>
          <span className="text-red-500">
            Outstanding: {formatNaira(filtered.reduce((s, sale) => s + Number(sale.balance), 0))}
          </span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            {t('sales.no_sales')}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden md:table-cell text-right">Paid</TableHead>
                <TableHead className="hidden md:table-cell text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(sale => (
                <>
                  <TableRow
                    key={sale.id}
                    className="cursor-pointer"
                    onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
                  >
                    <TableCell className="font-mono text-xs font-medium text-northcode-blue">
                      #{sale.sale_number}
                    </TableCell>
                    <TableCell className="text-sm">
                      {(sale as any).customers?.name || 'Walk-in'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                      {format(new Date(sale.created_at), 'dd MMM · HH:mm')}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatNaira(sale.total)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right text-green-600">
                      {formatNaira(sale.amount_paid)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right">
                      {Number(sale.balance) > 0 ? (
                        <span className="text-red-500">{formatNaira(sale.balance)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Badge variant={statusVariant[sale.payment_status]} className="text-[10px] px-1.5">
                          {t(`status.${sale.payment_status}`)}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 hidden sm:inline-flex">
                          {methodLabels[sale.payment_method]}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {expandedId === sale.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </TableCell>
                  </TableRow>

                  {/* Expanded items */}
                  {expandedId === sale.id && (
                    <TableRow key={`${sale.id}-expand`}>
                      <TableCell colSpan={8} className="bg-muted/20 p-0">
                        <div className="p-3 space-y-1">
                          <p className="text-xs font-semibold text-muted-foreground mb-2">ITEMS</p>
                          {(sale as any).sale_items?.map((item: any) => (
                            <div key={item.id} className="flex justify-between text-xs">
                              <span>{item.product_name} × {item.quantity} @ {formatNaira(item.unit_price)}</span>
                              <span className="font-medium">{formatNaira(item.subtotal)}</span>
                            </div>
                          ))}
                          {sale.notes && (
                            <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                              Note: {sale.notes}
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
