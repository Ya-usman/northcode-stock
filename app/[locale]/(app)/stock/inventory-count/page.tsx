'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ChevronLeft, Search, ClipboardCheck, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useToast } from '@/components/ui/use-toast'
import { useCurrency } from '@/lib/hooks/use-currency'
import { normalize } from '@/lib/utils/normalize'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import type { Product, Category } from '@/lib/types/database'

const supabase = createClient() as any

interface DiffRow {
  product: Product
  theoretical: number
  counted: number
  variance: number
  valueDelta: number
}

export default function InventoryCountPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('inventoryCount')
  const router = useRouter()
  const { shop, profile, roleInActiveShop } = useAuth()
  const { canAccess } = useRolePermissions()
  const { toast } = useToast()
  const { fmt } = useCurrency()

  const role = roleInActiveShop ?? profile?.role
  const isAuthorized =
    ['owner', 'super_admin', 'manager', 'shop_manager', 'stock_manager'].includes(role || '') &&
    canAccess('inventory_count')

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const fetchProducts = useCallback(async () => {
    if (!shop?.id) return
    setLoading(true)
    const [{ data: prods }, { data: cats }] = await Promise.all([
      supabase.from('products').select('*').eq('shop_id', shop.id).eq('is_active', true).order('name'),
      supabase.from('categories').select('*').eq('shop_id', shop.id).order('name'),
    ])
    setProducts((prods || []) as Product[])
    setCategories((cats || []) as Category[])
    setLoading(false)
  }, [shop?.id])

  useEffect(() => { if (isAuthorized) fetchProducts() }, [fetchProducts, isAuthorized])

  const filtered = products.filter(p => {
    if (search) {
      const q = normalize(search)
      if (!normalize(p.name).includes(q) && !normalize(p.sku || '').includes(q)) return false
    }
    if (categoryFilter !== 'all' && p.category_id !== categoryFilter) return false
    return true
  })

  const countedTotal = Object.values(counts).filter(v => v.trim() !== '').length

  const diffs = useMemo<DiffRow[]>(() => {
    return products.reduce<DiffRow[]>((acc, p) => {
      const raw = counts[p.id]
      if (raw === undefined || raw.trim() === '') return acc
      const counted = Number(raw)
      if (!Number.isFinite(counted) || counted < 0 || counted === p.quantity) return acc
      acc.push({
        product: p,
        theoretical: p.quantity,
        counted,
        variance: counted - p.quantity,
        valueDelta: (counted - p.quantity) * Number(p.buying_price || 0),
      })
      return acc
    }, [])
  }, [products, counts])

  const totalValueDelta = diffs.reduce((s, d) => s + d.valueDelta, 0)

  const submit = async () => {
    if (!shop?.id || diffs.length === 0) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/stock/inventory-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id,
          items: diffs.map(d => ({ product_id: d.product.id, counted_qty: d.counted })),
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('error'), variant: 'destructive' }); return }
      toast({ title: t('success_toast', { count: json.data?.adjusted_count ?? diffs.length }), variant: 'success' })
      setConfirmOpen(false)
      setCounts({})
      router.push(`/${locale}/stock`)
    } finally {
      setSubmitting(false)
    }
  }

  if (!isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ClipboardCheck className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <p className="text-muted-foreground text-sm">{t('no_access')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => router.push(`/${locale}/stock`)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('search_placeholder')} className="pl-9 h-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">{t('all_categories')}</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">{t('progress', { counted: countedTotal, total: products.length })}</p>

      {/* List */}
      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">{t('no_products')}</div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(p => {
            const raw = counts[p.id] ?? ''
            const countedQty = raw.trim() === '' ? null : Number(raw)
            const hasDiff = countedQty !== null && Number.isFinite(countedQty) && countedQty !== p.quantity
            return (
              <div key={p.id} className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 ${hasDiff ? 'border-amber-300 dark:border-amber-700' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{t('theoretical_label')}: {p.quantity} {p.unit}</p>
                </div>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={raw}
                  onChange={e => setCounts(prev => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder={String(p.quantity)}
                  className="w-20 h-9 text-center flex-shrink-0"
                />
                {hasDiff && (
                  <span className={`text-xs font-semibold flex-shrink-0 w-12 text-right ${countedQty! > p.quantity ? 'text-green-600' : 'text-red-600'}`}>
                    {countedQty! > p.quantity ? '+' : ''}{countedQty! - p.quantity}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Sticky summary bar */}
      {diffs.length > 0 && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
          <div className="flex items-center gap-3 rounded-2xl bg-card border shadow-xl px-4 py-3">
            <span className="text-sm font-medium flex-1 text-foreground">{t('diffs_count', { count: diffs.length })}</span>
            <Button variant="stockshop" size="sm" onClick={() => setConfirmOpen(true)}>{t('validate_button')}</Button>
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      <PremiumDialog open={confirmOpen} onOpenChange={setConfirmOpen} category={t('title')} title={t('confirm_title')} icon={<ClipboardCheck className="h-4 w-4" />} maxWidth="max-w-lg">
        <PremiumDialogBody>
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700 dark:text-amber-400">{t('confirm_warning')}</p>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1 mt-3">
            {diffs.map(d => (
              <div key={d.product.id} className="flex items-center justify-between text-sm border-b py-1.5 last:border-0">
                <span className="truncate flex-1">{d.product.name}</span>
                <span className="text-muted-foreground text-xs mx-2">{d.theoretical} → {d.counted}</span>
                <span className={`font-semibold text-xs w-16 text-right ${d.variance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {d.variance > 0 ? '+' : ''}{d.variance}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t">
            <span className="text-sm font-semibold">{t('value_impact')}</span>
            <span className={`text-sm font-bold ${totalValueDelta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {totalValueDelta >= 0 ? '+' : ''}{fmt(totalValueDelta)}
            </span>
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter onCancel={() => setConfirmOpen(false)} cancelLabel={t('cancel')}>
          <Button variant="stockshop" onClick={submit} loading={submitting} className="flex-1 h-11 rounded-xl font-semibold">
            {t('confirm_button')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>
    </div>
  )
}
