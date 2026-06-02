'use client'

import { useState, useEffect } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Plus, Search, Edit2, Package, ArrowDown, FileDown, Settings2, Trash2, Store, RotateCcw, Archive, ChevronDown, ChevronUp, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { restockSchema, type RestockFormData, type ProductFormData } from '@/lib/validations/product'
import type { Product, Category, Supplier } from '@/lib/types/database'
import { ProductForm } from '@/components/stock/product-form'
import { ImportProductsModal } from '@/components/stock/import-products-modal'
import { BulkAddModal } from '@/components/stock/bulk-add-modal'
import { setPageCache, getPageCache, getPageCacheAge } from '@/lib/offline/page-cache'
import { CacheBanner } from '@/components/layout/cache-banner'
import { savePendingMovement, updateCachedProductQuantity } from '@/lib/offline/db'
import { registerBackgroundSync } from '@/lib/offline/sync'


function StockBadge({ quantity, threshold }: { quantity: number; threshold: number }) {
  const t = useTranslations('status')
  if (quantity === 0) return <Badge variant="danger">{t('out_of_stock')}</Badge>
  if (quantity <= threshold) return <Badge variant="warning">{t('low_stock')}</Badge>
  return <Badge variant="success">{t('in_stock')}</Badge>
}

export default function StockPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const { profile, shop, roleInActiveShop, effectiveShopIds, userShops } = useAuth()
  const effectiveRole = roleInActiveShop ?? profile?.role
  const isMultiShop = effectiveShopIds.length > 1
  const { fmt: formatNaira, symbol: currencySymbol } = useCurrency()
  const supabase = createClient()
  const { toast } = useToast()

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(true)
  const [cacheAge, setCacheAge] = useState<number | null>(null)
  const [{ search, categoryFilter, statusFilter, showArchived }, setFilter] = usePersistedFilters(
    'stock', shop?.id, { search: '', categoryFilter: 'all', statusFilter: 'all', showArchived: false }
  )
  const [showAddModal, setShowAddModal] = useState(false)
  const [addFormKey, setAddFormKey] = useState(0)
  const [sessionAddCount, setSessionAddCount] = useState(0)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [showRestockModal, setShowRestockModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [restockProduct, setRestockProduct] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)
  const [showCatModal, setShowCatModal] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [savingCat, setSavingCat] = useState(false)
  const [archivedProducts, setArchivedProducts] = useState<Product[]>([])
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState<Product | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [archiveConfirmProduct, setArchiveConfirmProduct] = useState<Product | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [deleteCatConfirmId, setDeleteCatConfirmId] = useState<string | null>(null)

  const restockForm = useForm<RestockFormData>({ resolver: zodResolver(restockSchema) })

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const fetchProducts = async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `stock_${effectiveShopIds.join(',')}`
    const cached = getPageCache<{ prods: any[]; cats: any[]; sups: any[] }>(cacheKey)
    if (cached) {
      setProducts(cached.prods as unknown as Product[])
      setCategories(cached.cats as Category[])
      setSuppliers(cached.sups as Supplier[])
      setCacheAge(getPageCacheAge(cacheKey))
      setLoading(false)
    }
    if (!navigator.onLine) return
    try {
      const [{ data: prods }, { data: archived }, { data: cats }, { data: sups }] = await Promise.all([
        supabase.from('products')
          .select('*, categories(name), suppliers(name)')
          .in('shop_id', effectiveShopIds)
          .eq('is_active', true)
          .order('name'),
        supabase.from('products')
          .select('*, categories(name), suppliers(name)')
          .in('shop_id', effectiveShopIds)
          .eq('is_active', false)
          .order('name'),
        supabase.from('categories').select('*').in('shop_id', effectiveShopIds).order('name'),
        supabase.from('suppliers').select('*').in('shop_id', effectiveShopIds).order('name'),
      ])
      setProducts((prods || []) as unknown as Product[])
      setArchivedProducts((archived || []) as unknown as Product[])
      setCategories((cats || []) as Category[])
      setSuppliers((sups || []) as Supplier[])
      setPageCache(cacheKey, { prods: prods || [], cats: cats || [], sups: sups || [] })
      setCacheAge(null)
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProducts() }, [effectiveShopIds.join(',')])

  const filtered = products
    .filter(p => {
      if (search) {
        const q = search.toLowerCase()
        if (!p.name.toLowerCase().includes(q) &&
          !p.name_hausa?.toLowerCase().includes(q)) return false
      }
      if (categoryFilter !== 'all' && p.category_id !== categoryFilter) return false
      const threshold = p.low_stock_threshold || shop?.low_stock_threshold || 10
      if (statusFilter === 'out' && p.quantity !== 0) return false
      if (statusFilter === 'low' && (p.quantity === 0 || p.quantity > threshold)) return false
      if (statusFilter === 'ok' && p.quantity <= threshold) return false
      return true
    })

  const saveProduct = async (data: ProductFormData) => {
    if (!shop?.id) { toast({ title: t('toast.no_active_shop'), variant: 'destructive' }); return false }
    setSaving(true)
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id,
          name: data.name,
          name_hausa: data.name_hausa || null,
          category_id: data.category_id || null,
          supplier_id: data.supplier_id || null,
          buying_price: data.buying_price ?? 0,
          selling_price: data.selling_price,
          quantity: data.quantity,
          unit: data.unit || 'piece',
          low_stock_threshold: data.low_stock_threshold || null,
          sku: data.sku || null,
          image_url: data.image_url || null,
          is_active: true,
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return false }
      fetchProducts()
      return true
    } finally {
      setSaving(false)
    }
  }

  const onAddProduct = async (data: ProductFormData) => {
    const ok = await saveProduct(data)
    if (!ok) return
    toast({ title: t('toast.product_added'), variant: 'success' })
    setShowAddModal(false)
    setSessionAddCount(0)
  }

  const onSaveAndAdd = async (data: ProductFormData) => {
    const ok = await saveProduct(data)
    if (!ok) return
    setSessionAddCount(c => c + 1)
    setAddFormKey(k => k + 1)
    toast({ title: t('toast.product_added'), variant: 'success' })
  }

  const onEditProduct = async (data: ProductFormData) => {
    if (!editingProduct) return
    setSaving(true)
    try {
      const res = await fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingProduct.id,
          shop_id: editingProduct.shop_id,
          name: data.name,
          name_hausa: data.name_hausa || null,
          category_id: data.category_id || null,
          supplier_id: data.supplier_id || null,
          buying_price: data.buying_price ?? 0,
          selling_price: data.selling_price,
          unit: data.unit || 'piece',
          low_stock_threshold: data.low_stock_threshold || null,
          sku: data.sku || null,
          image_url: data.image_url || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('toast.product_updated'), variant: 'success' })
      setEditingProduct(null)
      fetchProducts()
    } finally {
      setSaving(false)
    }
  }

  const onRestock = async (data: RestockFormData) => {
    if (!restockProduct || !shop?.id) return
    setSaving(true)

    // Offline path — save to IndexedDB and update local cache optimistically
    if (!navigator.onLine) {
      const localId = `mv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await savePendingMovement({
        local_id: localId,
        shop_id: shop.id,
        product_id: restockProduct.id,
        product_name: restockProduct.name,
        current_quantity: restockProduct.quantity,
        quantity_to_add: data.quantity,
        supplier_name: suppliers.find(s => s.id === data.supplier_id)?.name || null,
        buying_price: data.buying_price || null,
        notes: data.notes || null,
        performed_by: profile!.id,
        created_at: new Date().toISOString(),
        synced: false,
      })
      await updateCachedProductQuantity(restockProduct.id, data.quantity)
      registerBackgroundSync()
      setSaving(false)
      toast({ title: t('toast.restock_done', { qty: data.quantity, name: restockProduct.name }), variant: 'success' })
      setShowRestockModal(false)
      restockForm.reset()
      // Update UI locally — no network call
      setProducts(prev => prev.map(p =>
        p.id === restockProduct.id ? { ...p, quantity: p.quantity + data.quantity } : p
      ))
      return
    }

    const res = await fetch('/api/products', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: restockProduct.id,
        shop_id: shop.id,
        current_quantity: restockProduct.quantity,
        quantity_to_add: data.quantity,
        supplier_name: suppliers.find(s => s.id === data.supplier_id)?.name || null,
        buying_price: data.buying_price || null,
        notes: data.notes || null,
        performed_by: profile!.id,
      }),
    })
    setSaving(false)
    const json = await res.json()
    if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
    toast({ title: t('toast.restock_done', { qty: data.quantity, name: restockProduct.name }), variant: 'success' })
    setShowRestockModal(false)
    restockForm.reset()
    fetchProducts()
  }

  const archiveProduct = async () => {
    if (!archiveConfirmProduct) return
    setArchiving(true)
    await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: archiveConfirmProduct.id, shop_id: archiveConfirmProduct.shop_id, is_active: false }),
    })
    setArchiving(false)
    setArchiveConfirmProduct(null)
    toast({ title: t('toast.product_archived') })
    fetchProducts()
  }

  const restoreProduct = async (product: Product) => {
    await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: product.id, shop_id: product.shop_id, is_active: true }),
    })
    toast({ title: t('toast.product_restored'), variant: 'success' })
    fetchProducts()
  }

  const permanentlyDelete = async () => {
    if (!deleteConfirmProduct) return
    if (deleteConfirmText.trim().toLowerCase() !== deleteConfirmProduct.name.trim().toLowerCase()) return
    setDeleting(true)
    const res = await fetch(`/api/products?id=${deleteConfirmProduct.id}&shop_id=${deleteConfirmProduct.shop_id}`, { method: 'DELETE' })
    setDeleting(false)
    if (!res.ok) {
      const json = await res.json()
      toast({ title: json.error || t('toast.error'), variant: 'destructive' })
    } else {
      toast({ title: t('toast.product_deleted'), variant: 'success' })
      setDeleteConfirmProduct(null)
      setDeleteConfirmText('')
      fetchProducts()
    }
  }

  const exportCSV = () => {
    const rows = [
      ['Name', 'Hausa Name', 'Category', 'Buying Price', 'Selling Price', 'Quantity', 'Unit', 'Status'],
      ...filtered.map(p => {
        const threshold = p.low_stock_threshold || shop?.low_stock_threshold || 10
        const status = p.quantity === 0 ? 'Out of Stock' : p.quantity <= threshold ? 'Low Stock' : 'In Stock'
        return [p.name, p.name_hausa || '', (p as any).categories?.name || '', p.buying_price, p.selling_price, p.quantity, p.unit, status]
      })
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `stock-${Date.now()}.csv`
    a.click()
  }

  const addCategory = async () => {
    if (!shop?.id || !newCatName.trim()) return
    setSavingCat(true)
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: shop.id, name: newCatName.trim() }),
    })
    setSavingCat(false)
    const json = await res.json()
    if (!res.ok) { toast({ title: json.error || t('errors.generic'), variant: 'destructive' }); return }
    setNewCatName('')
    fetchProducts()
  }

  const deleteCategory = async (catId: string) => {
    await fetch(`/api/categories?id=${catId}&shop_id=${shop?.id}`, { method: 'DELETE' })
    if (categoryFilter === catId) setFilter({ categoryFilter: 'all' })
    setDeleteCatConfirmId(null)
    fetchProducts()
  }

  const renderProductCard = (product: Product, idx: number) => {
    const threshold = product.low_stock_threshold || shop?.low_stock_threshold || 10
    return (
      <motion.div
        key={product.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.02 }}
        className="rounded-lg border bg-card shadow-sm p-4 space-y-2"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            {product.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.image_url}
                alt={product.name}
                loading="lazy"
                decoding="async"
                className="h-10 w-10 rounded-lg object-cover border border-border shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm truncate">{product.name}</p>
              {product.name_hausa && (
                <p className="text-xs text-muted-foreground truncate">{product.name_hausa}</p>
              )}
              {product.sku && (
                <p className="text-[10px] font-mono text-muted-foreground truncate">{product.sku}</p>
              )}
            </div>
          </div>
          <StockBadge quantity={product.quantity} threshold={threshold} />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-bold text-stockshop-blue dark:text-blue-400">{formatNaira(product.selling_price)}</span>
          {(effectiveRole === 'owner' || effectiveRole === 'super_admin') && (
            <span className="text-xs text-muted-foreground">{t('products.cost_label')}: {formatNaira(product.buying_price)}</span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">
            <span className={`font-bold ${product.quantity === 0 ? 'text-red-500' : product.quantity <= threshold ? 'text-amber-500' : 'text-green-600'}`}>
              {product.quantity}
            </span>{' '}
            <span className="text-muted-foreground text-xs">{product.unit}s</span>
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline" size="sm" className="h-7 px-2 text-xs"
              disabled={saving}
              onClick={() => { setEditingProduct(null); setShowAddModal(false); setRestockProduct(product); restockForm.reset({ product_id: product.id, quantity: 1 }); setShowRestockModal(true) }}
            >
              <ArrowDown className="h-3 w-3 mr-1" />
              {t('actions.restock')}
            </Button>
            {(effectiveRole === 'owner' || effectiveRole === 'stock_manager' || effectiveRole === 'super_admin') && (
              <Button variant="outline" size="sm" className="h-7 px-2" disabled={saving} onClick={() => { setShowAddModal(false); setShowRestockModal(false); setEditingProduct(product) }}>
                <Edit2 className="h-3 w-3" />
              </Button>
            )}
            {(effectiveRole === 'owner' || effectiveRole === 'super_admin') && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-amber-600" disabled={saving} title={t('products.archive_label')} onClick={() => setArchiveConfirmProduct(product)}>
                <Archive className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    )
  }

  const productFormProps = {
    categories: categories.filter((c: any) => !shop?.id || c.shop_id === shop.id),
    suppliers: suppliers.filter((s: any) => !shop?.id || s.shop_id === shop.id),
    currency: currencySymbol,
    isOwner: effectiveRole === 'owner' || effectiveRole === 'super_admin',
    shopId: shop?.id,
    saving,
  }

  return (
    <div className="space-y-4">
      <CacheBanner ageMs={cacheAge} isOnline={isOnline} />
      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('products.search_placeholder')} className="pl-9 h-9" />
        </div>
        <div className="flex gap-1">
          <Select value={categoryFilter} onValueChange={v => setFilter({ categoryFilter: v })}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder={t('products.all_categories')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('products.all_categories')}</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {(effectiveRole === 'owner' || effectiveRole === 'stock_manager' || effectiveRole === 'super_admin') && (
            <Button variant="outline" size="sm" className="h-9 px-2" onClick={() => setShowCatModal(true)} title={t('products.manage_categories')}>
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Select value={statusFilter} onValueChange={v => setFilter({ statusFilter: v })}>
          <SelectTrigger className="w-[110px] h-9"><SelectValue placeholder={t('status.all')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('status.all')}</SelectItem>
            <SelectItem value="ok">{t('status.in_stock')}</SelectItem>
            <SelectItem value="low">{t('status.low_stock')}</SelectItem>
            <SelectItem value="out">{t('status.out_of_stock')}</SelectItem>
          </SelectContent>
        </Select>
        {(effectiveRole === 'owner' || effectiveRole === 'stock_manager' || effectiveRole === 'cashier' || effectiveRole === 'super_admin') && (
          <>
            <Button size="sm" className="h-9 gap-1 bg-stockshop-blue hover:bg-stockshop-blue-light text-white" onClick={() => setShowBulkModal(true)}>
              <Plus className="h-3.5 w-3.5" /> Ajout rapide
            </Button>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={exportCSV} className="h-9 gap-1">
                <FileDown className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setShowImportModal(true)}>
                <Upload className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>
            <Button
              className="h-9 gap-1 bg-stockshop-blue hover:bg-stockshop-blue-light"
              size="sm"
              disabled={saving}
              onClick={() => { setEditingProduct(null); setShowRestockModal(false); setSessionAddCount(0); setAddFormKey(k => k + 1); setShowAddModal(true) }}
            >
              <Plus className="h-4 w-4" />
              {t('actions.add_product')}
            </Button>
          </>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{t('products.stats_count', { count: filtered.length })}</span>
        <span className="text-amber-600">{t('products.stats_low', { count: filtered.filter(p => p.quantity > 0 && p.quantity <= (p.low_stock_threshold || shop?.low_stock_threshold || 10)).length })}</span>
        <span className="text-red-500">{t('products.stats_out', { count: filtered.filter(p => p.quantity === 0).length })}</span>
      </div>

      {/* Product grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center text-muted-foreground">
          <Package className="h-12 w-12 mb-3 opacity-30" />
          <p>{t('products.no_products')}</p>
          <p className="text-sm mt-1">{t('products.add_first')}</p>
        </div>
      ) : isMultiShop ? (
        <div className="space-y-4">
          {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
            const shopProducts = filtered.filter(p => p.shop_id === shopEntry.id)
            if (!shopProducts.length) return null
            return (
              <div key={shopEntry.id} className="space-y-2">
                <div className="flex items-center gap-2 pt-1">
                  <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {shopProducts.map((product, idx) => renderProductCard(product, idx))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((product, idx) => renderProductCard(product, idx))}
        </div>
      )}

      {/* Archived products section — owner only */}
      {(effectiveRole === 'owner' || effectiveRole === 'super_admin') && archivedProducts.length > 0 && (
        <div className="border border-dashed rounded-xl p-3 space-y-2">
          <button
            onClick={() => setFilter({ showArchived: !showArchived })}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <Archive className="h-4 w-4" />
            {t('products.archived_section', { count: archivedProducts.length })}
            {showArchived ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
          </button>
          {showArchived && (
            <div className="space-y-1.5 pt-1">
              {archivedProducts.map(product => (
                <div key={product.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-muted-foreground truncate">{product.name}</p>
                    {product.name_hausa && <p className="text-xs text-muted-foreground/60 truncate">{product.name_hausa}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline" size="sm" className="h-7 gap-1 text-xs text-green-700 border-green-200 hover:bg-green-50 dark:text-green-400 dark:border-green-800"
                      onClick={() => restoreProduct(product)}
                    >
                      <RotateCcw className="h-3 w-3" />
                      {t('products.restore')}
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="h-7 gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => { setDeleteConfirmProduct(product); setDeleteConfirmText('') }}
                    >
                      <Trash2 className="h-3 w-3" />
                      {t('products.delete_permanent')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bulk Add Modal */}
      {shop?.id && (
        <BulkAddModal
          open={showBulkModal}
          onClose={() => setShowBulkModal(false)}
          shopId={shop.id}
          currency={currencySymbol}
          isOwner={effectiveRole === 'owner' || effectiveRole === 'super_admin'}
          onSaved={(count) => { fetchProducts() }}
        />
      )}

      {/* Import Products Modal */}
      {shop?.id && (
        <ImportProductsModal
          open={showImportModal}
          onClose={() => setShowImportModal(false)}
          shopId={shop.id}
          onImported={(count) => { setShowImportModal(false); fetchProducts(); }}
        />
      )}

      {/* Add Product Modal */}
      <PremiumDialog open={showAddModal} onOpenChange={open => { if (!open) { setShowAddModal(false); setSessionAddCount(0) } }} category={t('nav.stock')} title={t('actions.add_product')} icon={<Package className="h-4 w-4" />} maxWidth="max-w-lg">
        {showAddModal && <ProductForm key={addFormKey} {...productFormProps} sessionCount={sessionAddCount} onSubmit={onAddProduct} onSaveAndAdd={onSaveAndAdd} onCancel={() => { setShowAddModal(false); setSessionAddCount(0) }} />}
      </PremiumDialog>

      {/* Edit Product Modal */}
      <PremiumDialog open={!!editingProduct} onOpenChange={open => !open && setEditingProduct(null)} category={t('nav.stock')} title={t('products.edit_title')} icon={<Edit2 className="h-4 w-4" />} maxWidth="max-w-lg">
        {editingProduct && (
          <ProductForm key={editingProduct.id} {...productFormProps} isEdit
            defaultValues={{ name: editingProduct.name, name_hausa: editingProduct.name_hausa || '', category_id: editingProduct.category_id || '', supplier_id: editingProduct.supplier_id || '', buying_price: editingProduct.buying_price, selling_price: editingProduct.selling_price, quantity: editingProduct.quantity, unit: editingProduct.unit, low_stock_threshold: editingProduct.low_stock_threshold || undefined, sku: editingProduct.sku || '', image_url: editingProduct.image_url || '' }}
            onSubmit={onEditProduct} onCancel={() => setEditingProduct(null)}
          />
        )}
      </PremiumDialog>

      {/* Categories Modal */}
      <PremiumDialog open={showCatModal} onOpenChange={setShowCatModal} category={t('nav.stock')} title={t('products.manage_categories')} icon={<Settings2 className="h-4 w-4" />}>
        <PremiumDialogBody>
          <div className="flex gap-2">
            <Input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder={t('categories.add_placeholder')} onKeyDown={e => e.key === 'Enter' && addCategory()} />
            <Button onClick={addCategory} loading={savingCat} className="bg-stockshop-blue shrink-0 rounded-xl">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {categories.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{t('categories.none')}</p>}
            {categories.map(c => (
              <div key={c.id} className="rounded-lg border bg-muted/30 text-sm overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2">
                  <span>{c.name}</span>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteCatConfirmId(deleteCatConfirmId === c.id ? null : c.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {deleteCatConfirmId === c.id && (
                  <div className="px-3 pb-2 flex items-center justify-between gap-2 border-t border-border/50 pt-2">
                    <p className="text-xs text-muted-foreground">Supprimer « {c.name} » ?</p>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => deleteCategory(c.id)}>Oui</Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => setDeleteCatConfirmId(null)}>Non</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter onCancel={() => setShowCatModal(false)} cancelLabel={t('actions.close')} />
      </PremiumDialog>

      {/* Archive confirmation dialog */}
      <PremiumDialog
        open={!!archiveConfirmProduct}
        onOpenChange={open => { if (!open) setArchiveConfirmProduct(null) }}
        category={t('products.archive_label')}
        title={archiveConfirmProduct?.name || ''}
        icon={<Archive className="h-4 w-4 text-amber-500" />}
        maxWidth="max-w-md"
      >
        <PremiumDialogBody>
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 shadow-inner p-3 text-sm text-amber-700 dark:text-amber-400">
            <p>{t('products.archive_confirm')}</p>
          </div>
        </PremiumDialogBody>
        <div className="px-5 pb-5 flex justify-center gap-3">
          <Button
            variant="ghost"
            className="flex-1 h-11 rounded-xl text-foreground/70 hover:text-foreground hover:bg-foreground/8 border border-border"
            onClick={() => setArchiveConfirmProduct(null)}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            onClick={archiveProduct}
            loading={archiving}
            className="flex-1 h-11 rounded-xl px-6 font-semibold bg-amber-500 hover:bg-amber-600 text-white min-w-[140px]"
          >
            {!archiving && <Archive className="h-4 w-4 mr-2" />}
            {t('products.archive_label') || 'Archiver'}
          </Button>
        </div>
      </PremiumDialog>

      {/* Permanent delete confirmation dialog */}
      <PremiumDialog
        open={!!deleteConfirmProduct}
        onOpenChange={open => { if (!open) { setDeleteConfirmProduct(null); setDeleteConfirmText('') } }}
        category={t('products.delete_permanent')}
        title={deleteConfirmProduct?.name || ''}
        icon={<Trash2 className="h-4 w-4 text-destructive" />}
      >
        <PremiumDialogBody>
          <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400 space-y-1">
            <p className="font-semibold">{t('products.delete_warning_title')}</p>
            <p>{t('products.delete_warning_body')}</p>
          </div>
          <div className="space-y-1.5 mt-3">
            <Label>{t('products.delete_confirm_label', { name: deleteConfirmProduct?.name || '' })}</Label>
            <Input
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={deleteConfirmProduct?.name || ''}
              className="border-destructive/40 focus:border-destructive"
            />
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter onCancel={() => { setDeleteConfirmProduct(null); setDeleteConfirmText('') }} cancelLabel={t('actions.cancel')}>
          <Button
            onClick={permanentlyDelete}
            loading={deleting}
            disabled={deleting || deleteConfirmText.trim().toLowerCase() !== (deleteConfirmProduct?.name || '').trim().toLowerCase()}
            className="flex-1 h-11 rounded-xl font-semibold bg-destructive hover:bg-destructive/90"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t('products.delete_permanent')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>

      {/* Restock Modal */}
      <PremiumDialog open={showRestockModal} onOpenChange={setShowRestockModal} category={t('products.restock_title')} title={restockProduct?.name || ''} icon={<ArrowDown className="h-4 w-4" />}>
        <form onSubmit={restockForm.handleSubmit(onRestock)}>
          <PremiumDialogBody>
            <input type="hidden" {...restockForm.register('product_id')} />
            <div className="space-y-1.5">
              <Label>{t('products.quantity_to_add')} *</Label>
              <Input type="number" min={1} {...restockForm.register('quantity')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('products.supplier')}</Label>
              <Select onValueChange={v => restockForm.setValue('supplier_id', v)}>
                <SelectTrigger><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {(effectiveRole === 'owner' || effectiveRole === 'super_admin') && (
              <div className="space-y-1.5">
                <Label>{t('products.restock_buying_price')}</Label>
                <Input type="number" {...restockForm.register('buying_price')} placeholder={String(restockProduct?.buying_price)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t('products.notes_label')}</Label>
              <Input {...restockForm.register('notes')} placeholder={t('products.notes_placeholder')} />
            </div>
          </PremiumDialogBody>
          <PremiumDialogFooter onCancel={() => setShowRestockModal(false)} cancelLabel={t('actions.cancel')}>
            <Button type="submit" loading={saving} className="flex-1 h-11 rounded-xl font-semibold bg-stockshop-blue hover:bg-stockshop-blue-light">{t('actions.restock')}</Button>
          </PremiumDialogFooter>
        </form>
      </PremiumDialog>
    </div>
  )
}
