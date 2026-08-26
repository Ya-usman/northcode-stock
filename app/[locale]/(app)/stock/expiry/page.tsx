'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { Search, FileDown, FileText, Table2, AlertTriangle, Edit2, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useToast } from '@/components/ui/use-toast'
import { useCurrency } from '@/lib/hooks/use-currency'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { withTimeout } from '@/lib/utils/with-timeout'
import { getExpiryAlertDays } from '@/lib/utils/expiry'
import { generateReportPDFBlob } from '@/lib/utils/pdf'
import { printPDFNative, downloadOrShareCSV } from '@/lib/utils/native-share'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { StockTabs } from '@/components/stock/stock-tabs'
import type { Category } from '@/lib/types/database'

type ExpiryBatch = {
  id: string
  product_id: string
  quantity: number
  buying_price: number | null
  expiry_date: string
  received_at: string
  products: {
    name: string
    name_hausa: string | null
    unit: string | null
    category_id: string | null
    categories: { name: string; color: string | null; expiry_alert_days: number | null } | null
  } | null
}

const REASON_CODES = ['correction', 'damage', 'loss', 'theft', 'expiry', 'other'] as const

export default function ExpiryPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const { shop, effectiveShopIds, profile, roleInActiveShop } = useAuth()
  const effectiveRole = roleInActiveShop ?? profile?.role
  const { canAccess } = useRolePermissions()
  const canWriteStock = effectiveRole === 'cashier' || canAccess('stock')
  const { fmt: formatNaira } = useCurrency()
  const supabase = createClient()
  const { toast } = useToast()
  const { isOnline } = useOffline()

  const [batches, setBatches] = useState<ExpiryBatch[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [{ search, categoryFilter, statusFilter }, setFilter] = usePersistedFilters(
    'expiry', shop?.id, { search: '', categoryFilter: 'all', statusFilter: 'all' }
  )
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [adjustBatch, setAdjustBatch] = useState<ExpiryBatch | null>(null)
  const [adjustQuantity, setAdjustQuantity] = useState('')
  const [adjustReason, setAdjustReason] = useState('correction')
  const [savingAdjust, setSavingAdjust] = useState(false)
  const [deleteBatchConfirm, setDeleteBatchConfirm] = useState<ExpiryBatch | null>(null)
  const [deleteBatchReason, setDeleteBatchReason] = useState('correction')
  const [deletingBatch, setDeletingBatch] = useState(false)

  const fetchData = async () => {
    if (effectiveShopIds.length === 0) return
    try {
      const [batchesRes, categoriesRes] = await withTimeout(Promise.all([
        supabase
          .from('product_batches')
          .select('id, product_id, quantity, buying_price, expiry_date, received_at, products(name, name_hausa, unit, category_id, categories(name, color, expiry_alert_days))')
          .in('shop_id', effectiveShopIds)
          .gt('quantity', 0)
          .not('expiry_date', 'is', null)
          .order('expiry_date', { ascending: true }),
        supabase.from('categories').select('*').in('shop_id', effectiveShopIds).order('name'),
      ]), 20_000, t('errors.generic'))
      if (batchesRes.error) throw batchesRes.error
      setBatches((batchesRes.data || []) as unknown as ExpiryBatch[])
      setCategories((categoriesRes.data || []) as Category[])
    } catch (err: any) {
      toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [effectiveShopIds.join(',')])
  useRefetchOnVisible(() => fetchData())
  useRefetchOnReconnect(() => fetchData(), isOnline)

  const submitAdjustQuantity = async () => {
    if (!adjustBatch || !shop?.id || adjustQuantity === '') return
    setSavingAdjust(true)
    try {
      const res = await withTimeout(fetch('/api/product-batches/adjust', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: adjustBatch.id, shop_id: shop.id, new_quantity: Number(adjustQuantity), reason_code: adjustReason }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('errors.generic'), variant: 'destructive' }); return }
      toast({ title: t('products.batch_quantity_adjusted_toast'), variant: 'success' })
      setAdjustBatch(null)
      fetchData()
    } catch (err: any) {
      toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
    } finally {
      setSavingAdjust(false)
    }
  }

  const submitDeleteBatch = async () => {
    if (!deleteBatchConfirm || !shop?.id) return
    setDeletingBatch(true)
    try {
      const res = await withTimeout(fetch('/api/product-batches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteBatchConfirm.id, shop_id: shop.id, reason_code: deleteBatchReason }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('errors.generic'), variant: 'destructive' }); return }
      toast({ title: t('products.batch_deleted_toast'), variant: 'success' })
      setDeleteBatchConfirm(null)
      fetchData()
    } catch (err: any) {
      toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
    } finally {
      setDeletingBatch(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const shopAlertDays = shop?.expiry_alert_days ?? 14

  function statusOf(b: ExpiryBatch): 'expired' | 'expiring' | 'ok' {
    if (b.expiry_date < today) return 'expired'
    const alertDays = getExpiryAlertDays(b.products?.categories?.expiry_alert_days, shopAlertDays)
    const cutoff = new Date(Date.now() + alertDays * 86_400_000).toISOString().slice(0, 10)
    return b.expiry_date <= cutoff ? 'expiring' : 'ok'
  }

  const filtered = batches.filter(b => {
    if (search && !b.products?.name?.toLowerCase().includes(search.toLowerCase())) return false
    if (categoryFilter !== 'all' && b.products?.category_id !== categoryFilter) return false
    const status = statusOf(b)
    if (statusFilter !== 'all' && status !== statusFilter) return false
    return true
  })

  const totalAtRisk = filtered.reduce((sum, b) => sum + b.quantity * (b.buying_price || 0), 0)

  const statusBadge = (status: 'expired' | 'expiring' | 'ok') => {
    if (status === 'expired') return <Badge variant="danger">{t('expiry.status_expired')}</Badge>
    if (status === 'expiring') return <Badge variant="warning">{t('expiry.status_expiring')}</Badge>
    return <Badge variant="success">{t('expiry.status_ok')}</Badge>
  }

  const exportRows = () => filtered.map(b => {
    const status = statusOf(b)
    const statusLabel = status === 'expired' ? t('expiry.status_expired') : status === 'expiring' ? t('expiry.status_expiring') : t('expiry.status_ok')
    return [
      b.products?.name || '—',
      b.products?.categories?.name || '—',
      String(b.quantity),
      formatNaira(b.quantity * (b.buying_price || 0)),
      format(new Date(b.received_at), 'dd/MM/yyyy'),
      format(new Date(b.expiry_date), 'dd/MM/yyyy'),
      statusLabel,
    ]
  })

  const exportPDF = async () => {
    if (!shop) return
    setExporting(true)
    setExportMenuOpen(false)
    try {
      const result = await generateReportPDFBlob({
        shopName: shop.name,
        dateRange: format(new Date(), 'dd/MM/yyyy'),
        sections: [{
          title: t('expiry.title'),
          headers: [
            t('expiry.col_product'), t('expiry.col_category'), t('expiry.col_quantity'),
            t('expiry.col_value'), t('expiry.col_received'), t('expiry.col_expiry'), t('expiry.col_status'),
          ],
          rows: exportRows(),
        }],
      })
      printPDFNative(result.blob, `Peremptions-${shop.name.replace(/\s+/g, '-')}-${Date.now()}.pdf`)
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  const exportCSV = async () => {
    setExportMenuOpen(false)
    const header = [
      t('expiry.col_product'), t('expiry.col_category'), t('expiry.col_quantity'),
      t('expiry.col_value'), t('expiry.col_received'), t('expiry.col_expiry'), t('expiry.col_status'),
    ]
    const rows = exportRows().map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`))
    const csv = [header, ...rows].map(r => r.join(';')).join('\n')
    try {
      await downloadOrShareCSV(csv, `Peremptions-${shop?.name.replace(/\s+/g, '-')}-${Date.now()}.csv`)
    } catch {
      toast({ title: t('errors.generic'), variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <StockTabs locale={locale} />

      <div>
        <h1 className="text-lg font-semibold">{t('expiry.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('expiry.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('expiry.search_placeholder')} className="pl-9 h-9" />
        </div>
        <div className="flex flex-col gap-0.5">
          <Label className="text-[10px] font-normal text-muted-foreground px-0.5">{t('products.category')}</Label>
          <Select value={categoryFilter} onValueChange={v => setFilter({ categoryFilter: v })}>
            <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder={t('expiry.all_categories')} /></SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value="all">{t('expiry.all_categories')}</SelectItem>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-1.5">
                    {c.color && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />}
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-0.5">
          <Label className="text-[10px] font-normal text-muted-foreground px-0.5">{t('products.status_label')}</Label>
          <Select value={statusFilter} onValueChange={v => setFilter({ statusFilter: v })}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder={t('expiry.status_all')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('expiry.status_all')}</SelectItem>
              <SelectItem value="expired">{t('expiry.status_expired')}</SelectItem>
              <SelectItem value="expiring">{t('expiry.status_expiring')}</SelectItem>
              <SelectItem value="ok">{t('expiry.status_ok')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {filtered.length > 0 && (
          <div className="relative flex-shrink-0">
            <Button
              variant="outline" size="icon" className="h-9 w-9"
              loading={exporting}
              onClick={() => setExportMenuOpen(v => !v)}
              aria-label={t('actions.export_pdf')}
            >
              <FileDown className="h-4 w-4" />
            </Button>
            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-0 top-10 z-50 w-44 rounded-xl border bg-background shadow-lg p-1 flex flex-col gap-0.5">
                  <button onClick={exportPDF} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left">
                    <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />
                    <span>{t('actions.export_pdf')}</span>
                  </button>
                  <button onClick={exportCSV} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left">
                    <Table2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                    <span>{t('actions.export_csv')}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-40" />
          {t('expiry.no_batches')}
        </div>
      ) : (
        <>
          <div className="rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="text-left font-medium px-3 py-2">{t('expiry.col_product')}</th>
                  <th className="text-left font-medium px-3 py-2">{t('expiry.col_category')}</th>
                  <th className="text-right font-medium px-3 py-2">{t('expiry.col_quantity')}</th>
                  <th className="text-right font-medium px-3 py-2">{t('expiry.col_value')}</th>
                  <th className="text-left font-medium px-3 py-2">{t('expiry.col_received')}</th>
                  <th className="text-left font-medium px-3 py-2">{t('expiry.col_expiry')}</th>
                  <th className="text-left font-medium px-3 py-2">{t('expiry.col_status')}</th>
                  {canWriteStock && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const status = statusOf(b)
                  return (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{b.products?.name || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {b.products?.categories ? (
                          <span className="flex items-center gap-1.5">
                            {b.products.categories.color && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: b.products.categories.color }} />}
                            {b.products.categories.name}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{b.quantity} {b.products?.unit}</td>
                      <td className="px-3 py-2 text-right">{formatNaira(b.quantity * (b.buying_price || 0))}</td>
                      <td className="px-3 py-2 text-muted-foreground">{format(new Date(b.received_at), 'dd MMM yyyy')}</td>
                      <td className="px-3 py-2">{format(new Date(b.expiry_date), 'dd MMM yyyy')}</td>
                      <td className="px-3 py-2">{statusBadge(status)}</td>
                      {canWriteStock && (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-stockshop-blue"
                              title={t('products.adjust_quantity_action')}
                              onClick={() => { setAdjustBatch(b); setAdjustQuantity(String(b.quantity)); setAdjustReason('correction') }}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-600"
                              title={t('products.delete_batch_action')}
                              onClick={() => { setDeleteBatchConfirm(b); setDeleteBatchReason('correction') }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
            <span className="text-sm font-medium">{t('expiry.total_at_risk')}</span>
            <span className="text-sm font-bold text-orange-600">{formatNaira(totalAtRisk)}</span>
          </div>
        </>
      )}

      <PremiumDialog
        open={!!adjustBatch}
        onOpenChange={open => { if (!open) setAdjustBatch(null) }}
        category={t('nav.stock')}
        title={t('products.adjust_quantity_action')}
        icon={<Edit2 className="h-4 w-4" />}
      >
        {adjustBatch && (
          <>
            <PremiumDialogBody>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>{t('products.new_quantity_label')}</Label>
                  <Input type="number" min={0} value={adjustQuantity} onChange={e => setAdjustQuantity(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('products.adjustment_reason')}</Label>
                  <select
                    value={adjustReason}
                    onChange={e => setAdjustReason(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {REASON_CODES.map(code => (
                      <option key={code} value={code}>{t(`products.${code}` as any)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </PremiumDialogBody>
            <PremiumDialogFooter onCancel={() => setAdjustBatch(null)} cancelLabel={t('actions.cancel')}>
              <Button variant="stockshop" className="flex-1 h-11 rounded-xl font-semibold" onClick={submitAdjustQuantity} loading={savingAdjust} disabled={adjustQuantity === ''}>
                {t('actions.save')}
              </Button>
            </PremiumDialogFooter>
          </>
        )}
      </PremiumDialog>

      <PremiumDialog
        open={!!deleteBatchConfirm}
        onOpenChange={open => { if (!open) setDeleteBatchConfirm(null) }}
        category={t('nav.stock')}
        title={t('products.delete_batch_action')}
        icon={<Trash2 className="h-4 w-4" />}
      >
        {deleteBatchConfirm && (
          <>
            <PremiumDialogBody>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t('products.delete_batch_confirm')}</p>
                <div className="space-y-1.5">
                  <Label>{t('products.adjustment_reason')}</Label>
                  <select
                    value={deleteBatchReason}
                    onChange={e => setDeleteBatchReason(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {REASON_CODES.map(code => (
                      <option key={code} value={code}>{t(`products.${code}` as any)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </PremiumDialogBody>
            <PremiumDialogFooter onCancel={() => setDeleteBatchConfirm(null)} cancelLabel={t('actions.cancel')}>
              <Button variant="destructive" className="flex-1 h-11 rounded-xl font-semibold" onClick={submitDeleteBatch} loading={deletingBatch}>
                {t('products.delete_batch_action')}
              </Button>
            </PremiumDialogFooter>
          </>
        )}
      </PremiumDialog>
    </div>
  )
}
