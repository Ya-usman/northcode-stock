'use client'

import { useState, useEffect, useMemo } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { normalize } from '@/lib/utils/normalize'
import { useTranslations } from 'next-intl'
import { Search, Plus, Edit2, Trash2, Phone, MapPin, Package, Store, ChevronDown, ChevronRight, X, ArrowRightLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { useCurrency } from '@/lib/hooks/use-currency'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { supplierSchema, type SupplierFormData } from '@/lib/validations/customer'
import type { Supplier, Product } from '@/lib/types/database'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'

function SupplierCard({ supplier, products, productCount, expandedId, setExpandedId, canManage, setEditingSupplier, form, setShowModal, deleteSupplier, t, fmt }: any) {
  const isExpanded = expandedId === supplier.id
  const supplierProducts = products.filter((p: any) => p.supplier_id === supplier.id)
  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpandedId(isExpanded ? null : supplier.id)}
      >
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm">{supplier.name}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {supplier.phone && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" />{supplier.phone}
              </span>
            )}
            {supplier.city && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />{supplier.city}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Package className="h-3 w-3" />{t('suppliers.products_count', { count: productCount })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canManage && (
            <>
              <span
                role="button"
                className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent transition-colors"
                onClick={(e: any) => { e.stopPropagation(); setEditingSupplier(supplier); form.reset({ name: supplier.name, phone: supplier.phone || '', city: supplier.city || '' }); setShowModal(true) }}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </span>
              <span
                role="button"
                className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                onClick={(e: any) => { e.stopPropagation(); deleteSupplier(supplier) }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            </>
          )}
          {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {isExpanded && (
        <div className="border-t bg-muted/10">
          {supplierProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">{t('suppliers.no_products_for_supplier')}</p>
          ) : (
            <div className="divide-y divide-border/50">
              {supplierProducts.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-xs text-muted-foreground">{p.quantity} {p.unit}</span>
                    <span className="text-sm font-semibold text-stockshop-blue dark:text-blue-400">
                      {fmt(p.selling_price)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SuppliersPage() {
  const t = useTranslations()
  const { profile, shop, roleInActiveShop, effectiveShopIds, userShops } = useAuth()
  const { isOnline } = useOffline()
  const { fmt } = useCurrency()
  const isMultiShop = effectiveShopIds.length > 1
  const supabase = createClient() as any
  const { toast } = useToast()

  const effectiveRole = roleInActiveShop ?? profile?.role
  const canManage = ['owner', 'manager', 'shop_manager', 'stock_manager', 'super_admin'].includes(effectiveRole || '')

  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    const c = getPageCache<{ suppliers: Supplier[]; products: Product[] }>(`suppliers_${effectiveShopIds.join(',')}`)
    return c?.suppliers || []
  })
  const [products, setProducts] = useState<Product[]>(() => {
    const c = getPageCache<{ suppliers: Supplier[]; products: Product[] }>(`suppliers_${effectiveShopIds.join(',')}`)
    return c?.products || []
  })
  const [loading, setLoading] = useState(() => !getPageCache(`suppliers_${effectiveShopIds.join(',')}`))
  const [{ search }, setFilter] = usePersistedFilters('suppliers', shop?.id, { search: '' })
  const [showModal, setShowModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Comparateur de prix par produit ─────────────────────────────────────
  const [view, setView] = useState<'suppliers' | 'by_product'>('suppliers')
  const [productSearch, setProductSearch] = useState('')
  const [productPrices, setProductPrices] = useState<{ id: string; product_id: string; supplier_id: string; price: number }[]>([])
  const [addPriceProduct, setAddPriceProduct] = useState<Product | null>(null)
  const [addPriceSupplierId, setAddPriceSupplierId] = useState('')
  const [addPriceValue, setAddPriceValue] = useState('')
  const [savingPrice, setSavingPrice] = useState(false)

  const form = useForm<SupplierFormData>({ resolver: zodResolver(supplierSchema) })

  const fetchSuppliers = async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `suppliers_${effectiveShopIds.join(',')}`
    const cached = getPageCache<{ suppliers: Supplier[]; products: Product[] }>(cacheKey)
    if (cached) { setSuppliers(cached.suppliers); setProducts(cached.products); setLoading(false) }
    try {
      const [{ data: supplierData }, { data: productData }] = await Promise.all([
        supabase.from('suppliers').select('*').in('shop_id', effectiveShopIds).order('name'),
        supabase.from('products').select('id, name, selling_price, buying_price, quantity, unit, supplier_id, shop_id').in('shop_id', effectiveShopIds).eq('is_active', true),
      ])
      const fetchedSuppliers = (supplierData || []) as Supplier[]
      const fetchedProducts = (productData || []) as unknown as Product[]
      setSuppliers(fetchedSuppliers)
      setProducts(fetchedProducts)
      setPageCache(cacheKey, { suppliers: fetchedSuppliers, products: fetchedProducts })
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  const fetchProductPrices = async () => {
    if (!shop?.id) return
    try {
      const res = await fetch(`/api/product-supplier-prices?shop_id=${shop.id}`)
      if (!res.ok) return
      const json = await res.json()
      setProductPrices(json.data || [])
    } catch {
      // silencieux — comparaison purement informative
    }
  }

  useEffect(() => { fetchSuppliers(); fetchProductPrices() }, [effectiveShopIds.join(',')])

  // Refresh when the user comes back to this tab — catches suppliers/prices
  // added or edited by other team members while this page sat in the background.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') { fetchSuppliers(); fetchProductPrices() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [effectiveShopIds.join(',')])
  useRefetchOnReconnect(() => { fetchSuppliers(); fetchProductPrices() }, isOnline)

  const productCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of products) {
      if ((p as any).supplier_id) counts[(p as any).supplier_id] = (counts[(p as any).supplier_id] || 0) + 1
    }
    return counts
  }, [products])

  const filtered = suppliers.filter(s => {
    if (!search) return true
    const q = normalize(search)
    return normalize(s.name).includes(q) || normalize(s.city ?? '').includes(q)
  })

  const withTimeout = (p: Promise<any>, ms = 15_000) =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connexion trop lente — réessayez.')), ms))])

  const onSubmit = async (data: SupplierFormData) => {
    setSaving(true)
    try {
      const res = await withTimeout(fetch('/api/suppliers', {
        method: editingSupplier ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, id: editingSupplier?.id, shop_id: shop!.id }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: editingSupplier ? t('toast.supplier_updated') : t('toast.supplier_added'), variant: 'success' })
      setShowModal(false)
      setEditingSupplier(null)
      form.reset({ name: '', phone: '', city: '' })
      fetchSuppliers()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const deleteSupplier = async (s: Supplier) => {
    if (productCounts[s.id] > 0) {
      toast({ title: t('toast.supplier_has_products', { name: s.name, count: productCounts[s.id] }), variant: 'destructive' })
      return
    }
    if (!confirm(t('confirm.delete_supplier'))) return
    const res = await fetch(`/api/suppliers?id=${s.id}&shop_id=${s.shop_id}`, { method: 'DELETE' })
    if (!res.ok) { const json = await res.json().catch(() => ({})); toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
    toast({ title: t('toast.supplier_deleted') })
    fetchSuppliers()
  }

  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? '—'

  const filteredProducts = productSearch.trim()
    ? products.filter(p => normalize(p.name).includes(normalize(productSearch)))
    : []

  const openAddPrice = (product: Product) => {
    setAddPriceProduct(product)
    setAddPriceSupplierId('')
    setAddPriceValue('')
  }

  const submitAddPrice = async () => {
    if (!addPriceProduct || !addPriceSupplierId || !shop?.id) return
    setSavingPrice(true)
    try {
      const res = await fetch('/api/product-supplier-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: addPriceProduct.shop_id,
          product_id: addPriceProduct.id,
          supplier_id: addPriceSupplierId,
          price: Number(addPriceValue),
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      setAddPriceProduct(null)
      fetchProductPrices()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setSavingPrice(false)
    }
  }

  const deletePrice = async (entryId: string) => {
    if (!shop?.id) return
    const res = await fetch(`/api/product-supplier-prices?id=${entryId}&shop_id=${shop.id}`, { method: 'DELETE' })
    if (!res.ok) { const json = await res.json().catch(() => ({})); toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
    fetchProductPrices()
  }

  const usePrice = async (product: Product, supplierId: string, price: number) => {
    const res = await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: product.id, shop_id: product.shop_id, supplier_id: supplierId, buying_price: price }),
    })
    const json = await res.json()
    if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
    toast({ title: t('toast.supplier_updated'), variant: 'success' })
    fetchSuppliers()
  }

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        <button
          onClick={() => setView('suppliers')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${view === 'suppliers' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {t('suppliers.tab_suppliers')}
        </button>
        <button
          onClick={() => setView('by_product')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'by_product' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" /> {t('suppliers.tab_by_product')}
        </button>
      </div>

      {view === 'suppliers' && (
      <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('suppliers.search_placeholder')} className="pl-9 h-9" />
        </div>
        {canManage && (
          <Button
            variant="stockshop"
            className="h-9 gap-1"
            size="sm"
            onClick={() => { form.reset({ name: '', phone: '', city: '' }); setEditingSupplier(null); setShowModal(true) }}
          >
            <Plus className="h-4 w-4" />
            {t('suppliers.add_supplier')}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
          {t('suppliers.no_suppliers')}
        </div>
      ) : isMultiShop ? (
        <div className="space-y-4">
          {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
            const shopSuppliers = filtered.filter(s => s.shop_id === shopEntry.id)
            if (!shopSuppliers.length) return null
            return (
              <div key={shopEntry.id} className="space-y-2">
                <div className="flex items-center gap-2 pt-1">
                  <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {shopSuppliers.map(supplier => (
                  <SupplierCard key={supplier.id} supplier={supplier} products={products} productCount={productCounts[supplier.id] || 0}
                    expandedId={expandedId} setExpandedId={setExpandedId} canManage={canManage}
                    setEditingSupplier={setEditingSupplier} form={form} setShowModal={setShowModal} deleteSupplier={deleteSupplier} t={t} fmt={fmt} />
                ))}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(supplier => (
            <SupplierCard key={supplier.id} supplier={supplier} products={products} productCount={productCounts[supplier.id] || 0}
              expandedId={expandedId} setExpandedId={setExpandedId} canManage={canManage}
              setEditingSupplier={setEditingSupplier} form={form} setShowModal={setShowModal} deleteSupplier={deleteSupplier} t={t} fmt={fmt} />
          ))}
        </div>
      )}
      </>
      )}

      {view === 'by_product' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder={t('suppliers.search_product_placeholder')} className="pl-9 h-9" />
          </div>

          {!productSearch.trim() ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm text-center px-6">
              {t('suppliers.search_product_hint')}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
              {t('suppliers.no_suppliers')}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredProducts.map(p => {
                const entries = productPrices.filter(e => e.product_id === p.id)
                const currentSupplierId = (p as any).supplier_id as string | null
                const rows = [
                  ...(currentSupplierId ? [{ supplierId: currentSupplierId, price: Number((p as any).buying_price || 0), isCurrent: true, entryId: null as string | null }] : []),
                  ...entries.filter(e => e.supplier_id !== currentSupplierId).map(e => ({ supplierId: e.supplier_id, price: e.price, isCurrent: false, entryId: e.id })),
                ].sort((a, b) => a.price - b.price)

                return (
                  <div key={p.id} className="rounded-lg border bg-card shadow-sm p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm truncate">{p.name}</p>
                      {canManage && (
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs shrink-0" onClick={() => openAddPrice(p)}>
                          <Plus className="h-3 w-3" />{t('suppliers.add_price')}
                        </Button>
                      )}
                    </div>
                    {rows.length === 0 ? (
                      <p className="text-xs text-muted-foreground mt-2">{t('suppliers.no_prices_for_product')}</p>
                    ) : (
                      <div className="mt-2 divide-y divide-border/50">
                        {rows.map(row => (
                          <div key={row.supplierId} className="flex items-center justify-between py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm truncate">{supplierName(row.supplierId)}</span>
                              {row.isCurrent && (
                                <span className="text-[10px] font-medium rounded-full bg-blue-50 dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400 px-2 py-0.5 shrink-0">
                                  {t('suppliers.current_price_label')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="text-sm font-semibold">{fmt(row.price)}</span>
                              {!row.isCurrent && canManage && (
                                <>
                                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => usePrice(p, row.supplierId, row.price)}>
                                    {t('suppliers.use_this_price')}
                                  </Button>
                                  <button
                                    className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                                    onClick={() => row.entryId && deletePrice(row.entryId)}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <PremiumDialog
        open={showModal}
        onOpenChange={open => { if (!open) { setShowModal(false); setEditingSupplier(null); form.reset({ name: '', phone: '', city: '' }) } }}
        category={t('nav.suppliers')}
        title={editingSupplier ? t('suppliers.edit_title') : t('suppliers.add_supplier')}
        icon={<Package className="h-4 w-4" />}
      >
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <PremiumDialogBody>
            <div className="space-y-1.5">
              <Label>{t('suppliers.name')} *</Label>
              <Input {...form.register('name')} placeholder={t('suppliers.name_placeholder')} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('suppliers.phone')}</Label>
              <Input {...form.register('phone')} placeholder="08012345678" type="tel" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('suppliers.city')}</Label>
              <Input {...form.register('city')} placeholder={t('suppliers.city_placeholder')} />
            </div>
          </PremiumDialogBody>
          <PremiumDialogFooter
            onCancel={() => setShowModal(false)}
            cancelLabel={t('actions.cancel')}
          >
            <Button variant="stockshop" type="submit" loading={saving} className="flex-1 h-11 rounded-xl font-semibold">
              {t('actions.save')}
            </Button>
          </PremiumDialogFooter>
        </form>
      </PremiumDialog>

      <PremiumDialog
        open={!!addPriceProduct}
        onOpenChange={open => { if (!open) setAddPriceProduct(null) }}
        category={t('nav.suppliers')}
        title={t('suppliers.add_price')}
        icon={<ArrowRightLeft className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          <p className="text-sm font-medium truncate">{addPriceProduct?.name}</p>
          <div className="space-y-1.5 mt-3">
            <Label>{t('nav.suppliers')} *</Label>
            <Select value={addPriceSupplierId} onValueChange={setAddPriceSupplierId}>
              <SelectTrigger><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
              <SelectContent>
                {suppliers
                  .filter(s => s.shop_id === addPriceProduct?.shop_id && s.id !== (addPriceProduct as any)?.supplier_id)
                  .map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 mt-3">
            <Label>{t('suppliers.price_label')} *</Label>
            <Input type="number" min={0} inputMode="numeric" value={addPriceValue} onChange={e => setAddPriceValue(e.target.value)} placeholder="0" />
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter onCancel={() => setAddPriceProduct(null)} cancelLabel={t('actions.cancel')}>
          <Button
            variant="stockshop"
            onClick={submitAddPrice}
            loading={savingPrice}
            disabled={!addPriceSupplierId || !addPriceValue || Number(addPriceValue) <= 0}
            className="flex-1 h-11 rounded-xl font-semibold"
          >
            {t('actions.save')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>
    </div>
  )
}
