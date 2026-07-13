'use client'

import { useState, useEffect, useRef } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { normalize } from '@/lib/utils/normalize'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Plus, Search, Edit2, Package, ArrowDown, FileDown, Settings2, Trash2, Store, RotateCcw, Archive, Upload, CheckSquare, Square, AlertTriangle, History } from 'lucide-react'
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
import { createRestockSchema, type RestockFormData, type ProductFormData } from '@/lib/validations/product'
import type { Product, Category, Supplier } from '@/lib/types/database'
import { ProductForm } from '@/components/stock/product-form'
import { ImportProductsModal } from '@/components/stock/import-products-modal'
import { BulkAddModal } from '@/components/stock/bulk-add-modal'
import { setPageCache, getPageCache, getPageCacheAge } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'

import { savePendingMovement, updateCachedProductQuantity } from '@/lib/offline/db'
import { registerBackgroundSync } from '@/lib/offline/sync'
import { downloadOrShareCSV } from '@/lib/utils/native-share'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useStockRealtime } from '@/lib/hooks/use-realtime'
import { StockTabs } from '@/components/stock/stock-tabs'


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
  const { canAccess } = useRolePermissions()
  const isMultiShop = effectiveShopIds.length > 1
  const { fmt: formatNaira, symbol: currencySymbol } = useCurrency()
  const supabase = createClient()
  const { toast } = useToast()

  // Lazy initializers: read localStorage cache synchronously on mount so the
  // first render shows cached data instead of a skeleton flash.
  const [products, setProducts] = useState<Product[]>(() => {
    const c = getPageCache<{ prods: any[] }>(`stock_${effectiveShopIds.join(',')}`)
    return (c?.prods || []) as Product[]
  })
  const [categories, setCategories] = useState<Category[]>(() => {
    const c = getPageCache<{ cats: any[] }>(`stock_${effectiveShopIds.join(',')}`)
    return (c?.cats || []) as Category[]
  })
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    const c = getPageCache<{ sups: any[] }>(`stock_${effectiveShopIds.join(',')}`)
    return (c?.sups || []) as Supplier[]
  })
  const [loading, setLoading] = useState(() =>
    !getPageCache(`stock_${effectiveShopIds.join(',')}`)
  )
  const { isOnline } = useOffline()
  const [{ search, categoryFilter, statusFilter }, setFilter] = usePersistedFilters(
    'stock', shop?.id, { search: '', categoryFilter: 'all', statusFilter: 'all' }
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

  // ── Suppression en masse ────────────────────────────────────────────────
  const canDeleteProducts = canAccess('delete_products')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteDialog, setBulkDeleteDialog] = useState(false)
  const [bulkDeleteAll, setBulkDeleteAll] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteText, setBulkDeleteText] = useState('')

  // ── Journal de suppressions ─────────────────────────────────────────────
  const [view, setView] = useState<'products' | 'archived' | 'journal'>('products')
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [loadingJournal, setLoadingJournal] = useState(false)
  const [journalDateFrom, setJournalDateFrom] = useState('')
  const [journalDateTo, setJournalDateTo] = useState('')
  const [journalSearch, setJournalSearch] = useState('')
  const [archiveDateFrom, setArchiveDateFrom] = useState('')
  const [archiveDateTo, setArchiveDateTo] = useState('')
  const [archiveSearch, setArchiveSearch] = useState('')

  const restockForm = useForm<RestockFormData>({ resolver: zodResolver(createRestockSchema({ restock_min_qty: t('errors.restock_min_qty') })) })


  // Réinitialiser la sélection quand on change de boutique
  useEffect(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [shop?.id])

  const fetchProducts = async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `stock_${effectiveShopIds.join(',')}`
    const cached = getPageCache<{ prods: any[]; cats: any[]; sups: any[] }>(cacheKey)
    if (cached) {
      setProducts(cached.prods as unknown as Product[])
      setCategories(cached.cats as Category[])
      setSuppliers(cached.sups as Supplier[])
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
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProducts() }, [effectiveShopIds.join(',')])

  // Refresh when the user comes back to this tab — catches stock changes
  // made by other team members while this page sat in the background.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchProducts() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [effectiveShopIds.join(',')])
  useRefetchOnReconnect(fetchProducts, isOnline)

  // Live stock updates (quantity, price, archive status) for the active shop.
  // Realtime payloads are raw rows without the categories(name)/suppliers(name)
  // joins from the initial fetch, so we merge onto the existing record instead
  // of replacing it outright — keeps joined display fields intact.
  useStockRealtime(shop?.id || null, (product) => {
    const isActive = (product as any).is_active !== false
    const upsert = (list: Product[]) => {
      const idx = list.findIndex(p => p.id === product.id)
      if (idx === -1) return [...list, product as Product]
      const next = [...list]
      next[idx] = { ...next[idx], ...product }
      return next
    }
    setProducts(prev => isActive ? upsert(prev) : prev.filter(p => p.id !== product.id))
    setArchivedProducts(prev => isActive ? prev.filter(p => p.id !== product.id) : upsert(prev))
  })

  const filtered = products
    .filter(p => {
      if (search) {
        const q = normalize(search)
        if (!normalize(p.name).includes(q)) return false
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
        supplier_id: data.supplier_id || null,
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
        supplier_id: data.supplier_id || null,
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
    const res = await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: archiveConfirmProduct.id, shop_id: archiveConfirmProduct.shop_id, is_active: false }),
    })
    const json = await res.json()
    setArchiving(false)
    setArchiveConfirmProduct(null)
    if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
    toast({ title: t('toast.product_archived') })
    fetchProducts()
    if (view === 'journal') fetchAuditLogs()
  }

  const restoreProduct = async (product: Product) => {
    const res = await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: product.id, shop_id: product.shop_id, is_active: true }),
    })
    const json = await res.json()
    if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
    toast({ title: t('toast.product_restored'), variant: 'success' })
    fetchProducts()
    if (view === 'journal') fetchAuditLogs()
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

  const exportCSV = async () => {
    const rows = [
      [
        t('products.name'), t('products.category'),
        t('products.buying_price'), t('products.selling_price'),
        t('products.quantity'), t('products.unit'), t('products.pdf_col_status'),
      ],
      ...filtered.map(p => {
        const threshold = p.low_stock_threshold || shop?.low_stock_threshold || 10
        const status = p.quantity === 0
          ? t('status.out_of_stock')
          : p.quantity <= threshold ? t('status.low_stock') : t('status.in_stock')
        return [
          `"${(p.name || '').replace(/"/g, '""')}"`,
          `"${((p as any).categories?.name || '').replace(/"/g, '""')}"`,
          p.buying_price, p.selling_price, p.quantity, p.unit,
          `"${status}"`,
        ]
      })
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    await downloadOrShareCSV(csv, `${t('actions.csv_stock')}-${shop?.name?.replace(/\s+/g, '-') || 'export'}-${Date.now()}.csv`)
  }

  const catInputRef = useRef<HTMLInputElement>(null)

  const addCategory = async () => {
    if (!shop?.id) { toast({ title: t('toast.no_active_shop'), variant: 'destructive' }); return }
    if (!newCatName.trim()) return
    setSavingCat(true)
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: shop.id, name: newCatName.trim() }),
    })
    setSavingCat(false)
    const json = await res.json()
    if (!res.ok) { toast({ title: json.error || t('errors.generic'), variant: 'destructive' }); return }
    toast({ title: t('categories.added'), variant: 'success' })
    setNewCatName('')
    fetchProducts()
    setTimeout(() => catInputRef.current?.focus(), 50)
  }

  const deleteCategory = async (catId: string) => {
    await fetch(`/api/categories?id=${catId}&shop_id=${shop?.id}`, { method: 'DELETE' })
    if (categoryFilter === catId) setFilter({ categoryFilter: 'all' })
    setDeleteCatConfirmId(null)
    fetchProducts()
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(p => p.id)))
    }
  }

  const bulkDelete = async () => {
    if (!shop?.id) return
    const isAll = bulkDeleteAll
    if (isAll && bulkDeleteText.trim().toUpperCase() !== 'SUPPRIMER') return
    setBulkDeleting(true)
    const payload = isAll
      ? { shop_id: shop.id, all: true }
      : { shop_id: shop.id, ids: Array.from(selectedIds) }
    const res = await fetch('/api/products', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBulkDeleting(false)
    const json = await res.json()
    if (!res.ok) {
      toast({ title: json.error || t('toast.error'), variant: 'destructive' })
      return
    }
    const count = json.deleted ?? selectedIds.size
    toast({
      title: isAll ? 'Tous les produits ont été supprimés' : `${count} produit${count > 1 ? 's' : ''} supprimé${count > 1 ? 's' : ''}`,
      variant: 'success',
    })
    setBulkDeleteDialog(false)
    setBulkDeleteAll(false)
    setBulkDeleteText('')
    setSelectedIds(new Set())
    setSelectionMode(false)
    fetchProducts()
  }

  const fetchAuditLogs = async () => {
    if (!shop?.id) return
    setLoadingJournal(true)
    let query = (supabase as any)
      .from('audit_logs')
      .select('*')
      .eq('shop_id', shop.id)
      .in('action', ['delete_product', 'bulk_delete_products', 'delete_all_products', 'create_product', 'update_product', 'archive_product', 'restore_product'])
      .order('created_at', { ascending: false })
      .limit(100)
    if (journalDateFrom) query = query.gte('created_at', `${journalDateFrom}T00:00:00`)
    if (journalDateTo) query = query.lte('created_at', `${journalDateTo}T23:59:59`)
    const { data } = await query
    setAuditLogs(data || [])
    setLoadingJournal(false)
  }

  useEffect(() => { if (view === 'journal') fetchAuditLogs() }, [view, journalDateFrom, journalDateTo])

  // Refresh the Journal when the user comes back to this tab or regains
  // connectivity — same treatment as the rest of the page.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && view === 'journal') fetchAuditLogs() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [view])
  useRefetchOnReconnect(() => { if (view === 'journal') fetchAuditLogs() }, isOnline)

  const renderProductCard = (product: Product, idx: number) => {
    const threshold = product.low_stock_threshold || shop?.low_stock_threshold || 10
    const isSelected = selectedIds.has(product.id)
    return (
      <motion.div
        key={product.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.02 }}
        className={`rounded-lg border bg-card shadow-sm p-4 space-y-2 transition-colors ${
          selectionMode ? 'cursor-pointer select-none' : ''
        } ${isSelected ? 'border-blue-400 dark:border-blue-500 bg-blue-50/60 dark:bg-blue-950/25' : ''}`}
        onClick={selectionMode ? () => setSelectedIds(prev => {
          const next = new Set(prev)
          next.has(product.id) ? next.delete(product.id) : next.add(product.id)
          return next
        }) : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            {selectionMode && (
              <div className="flex-shrink-0 mt-0.5">
                {isSelected
                  ? <CheckSquare className="h-5 w-5 text-blue-500" />
                  : <Square className="h-5 w-5 text-muted-foreground/50" />
                }
              </div>
            )}
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
        {!selectionMode && (
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
        )}
        {selectionMode && (
          <div className="flex items-center justify-between">
            <span className="text-sm">
              <span className={`font-bold ${product.quantity === 0 ? 'text-red-500' : product.quantity <= threshold ? 'text-amber-500' : 'text-green-600'}`}>
                {product.quantity}
              </span>{' '}
              <span className="text-muted-foreground text-xs">{product.unit}s</span>
            </span>
          </div>
        )}
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
      {/* Stock / Mouvements / Inventaire physique */}
      <StockTabs locale={locale} />

      {/* View toggle */}
      {(effectiveRole === 'owner' || effectiveRole === 'super_admin') && (
        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
          <button
            onClick={() => setView('products')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${view === 'products' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t('products.tab_products')}
          </button>
          <button
            onClick={() => setView('archived')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'archived' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Archive className="h-3.5 w-3.5" /> {t('products.tab_archived')}
            {archivedProducts.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-xs">{archivedProducts.length}</span>
            )}
          </button>
          <button
            onClick={() => setView('journal')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'journal' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <History className="h-3.5 w-3.5" /> {t('products.tab_journal')}
          </button>
        </div>
      )}

      {view === 'products' && (
      <>
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('products.search_placeholder')} className="pl-9 h-9" />
        </div>
        <div className="flex flex-col gap-0.5">
          <Label className="text-[10px] font-normal text-muted-foreground px-0.5">{t('products.category')}</Label>
          <div className="flex gap-1">
            <Select value={categoryFilter} onValueChange={v => setFilter({ categoryFilter: v })}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder={t('products.all_categories')} /></SelectTrigger>
              <SelectContent className="max-h-80">
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
        </div>
        <div className="flex flex-col gap-0.5">
          <Label className="text-[10px] font-normal text-muted-foreground px-0.5">{t('products.status_label')}</Label>
          <Select value={statusFilter} onValueChange={v => setFilter({ statusFilter: v })}>
            <SelectTrigger className="w-[110px] h-9"><SelectValue placeholder={t('status.all')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('status.all')}</SelectItem>
              <SelectItem value="ok">{t('status.in_stock')}</SelectItem>
              <SelectItem value="low">{t('status.low_stock')}</SelectItem>
              <SelectItem value="out">{t('status.out_of_stock')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(effectiveRole === 'owner' || effectiveRole === 'stock_manager' || effectiveRole === 'cashier' || effectiveRole === 'super_admin') && (
          <>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={exportCSV} className="h-9 gap-1">
                <FileDown className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setShowImportModal(true)}>
                <Upload className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>
            <div className="flex gap-1">
              <Button variant="stockshop" size="sm" className="h-9 gap-1" onClick={() => setShowBulkModal(true)}>
                <Plus className="h-3.5 w-3.5" /> Ajout rapide
              </Button>
              <Button
                variant="stockshop"
                className="h-9 gap-1"
                size="sm"
                disabled={saving}
                onClick={() => { setEditingProduct(null); setShowRestockModal(false); setSessionAddCount(0); setAddFormKey(k => k + 1); setShowAddModal(true) }}
              >
                <Plus className="h-4 w-4" />
                {t('actions.add_product')}
              </Button>
            </div>
          </>
        )}
        {canDeleteProducts && (
          <Button
            variant={selectionMode ? 'destructive' : 'outline'}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => {
              if (selectionMode) { setSelectionMode(false); setSelectedIds(new Set()) }
              else setSelectionMode(true)
            }}
          >
            {selectionMode ? <><Square className="h-3.5 w-3.5" /> Annuler</> : <><Trash2 className="h-3.5 w-3.5" /> Supprimer produit(s)</>}
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{t('products.stats_count', { count: filtered.length })}</span>
        <span className="text-amber-600">{t('products.stats_low', { count: filtered.filter(p => p.quantity > 0 && p.quantity <= (p.low_stock_threshold || shop?.low_stock_threshold || 10)).length })}</span>
        <span className="text-red-500">{t('products.stats_out', { count: filtered.filter(p => p.quantity === 0).length })}</span>
      </div>

      {/* Barre de sélection */}
      {selectionMode && (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-3 py-2">
          <button
            className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-400 hover:text-blue-800 transition-colors"
            onClick={toggleSelectAll}
          >
            {selectedIds.size > 0 && selectedIds.size === filtered.length
              ? <CheckSquare className="h-4 w-4" />
              : <Square className="h-4 w-4" />
            }
            {selectedIds.size > 0 && selectedIds.size === filtered.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            <span className="text-xs font-normal text-blue-500">({filtered.length})</span>
          </button>
          {(effectiveRole === 'owner' || effectiveRole === 'super_admin') && products.length > 0 && (
            <button
              onClick={() => { setBulkDeleteAll(true); setBulkDeleteText(''); setBulkDeleteDialog(true) }}
              className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Supprimer tous les produits ({products.length})
            </button>
          )}
        </div>
      )}

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

      </>
      )}

      {/* Produits archivés — owner only */}
      {view === 'archived' && (effectiveRole === 'owner' || effectiveRole === 'super_admin') && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={archiveSearch} onChange={e => setArchiveSearch(e.target.value)} placeholder={t('products.search_placeholder')} className="pl-8 h-8 text-xs" />
            </div>
            <Input type="date" value={archiveDateFrom} max={archiveDateTo || undefined} onChange={e => setArchiveDateFrom(e.target.value)} className="h-8 w-[140px] text-xs" />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="date" value={archiveDateTo} min={archiveDateFrom || undefined} onChange={e => setArchiveDateTo(e.target.value)} className="h-8 w-[140px] text-xs" />
            {(archiveDateFrom || archiveDateTo || archiveSearch) && (
              <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => { setArchiveDateFrom(''); setArchiveDateTo(''); setArchiveSearch('') }}>
                Réinitialiser
              </button>
            )}
          </div>
          {(() => {
            const filteredArchived = archivedProducts.filter(p => {
              const d = (p as any).updated_at?.slice(0, 10)
              if (archiveDateFrom && d < archiveDateFrom) return false
              if (archiveDateTo && d > archiveDateTo) return false
              if (archiveSearch && !normalize(p.name).includes(normalize(archiveSearch))) return false
              return true
            })
            if (filteredArchived.length === 0) {
              return <p className="text-xs text-muted-foreground text-center py-3">{t('products.archived_empty')}</p>
            }
            return filteredArchived.map(product => (
              <div key={product.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground truncate">{product.name}</p>
                  {(product as any).updated_at && (
                    <p className="text-[11px] text-muted-foreground/70">
                      Archivé le {new Date((product as any).updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
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
            ))
          })()}
        </div>
      )}

      {/* Journal — suppressions et modifications de prix — owner only */}
      {view === 'journal' && (effectiveRole === 'owner' || effectiveRole === 'super_admin') && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={journalSearch} onChange={e => setJournalSearch(e.target.value)} placeholder={t('products.search_placeholder')} className="pl-8 h-8 text-xs" />
            </div>
            <Input type="date" value={journalDateFrom} max={journalDateTo || undefined} onChange={e => setJournalDateFrom(e.target.value)} className="h-8 w-[140px] text-xs" />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="date" value={journalDateTo} min={journalDateFrom || undefined} onChange={e => setJournalDateTo(e.target.value)} className="h-8 w-[140px] text-xs" />
            {(journalDateFrom || journalDateTo || journalSearch) && (
              <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => { setJournalDateFrom(''); setJournalDateTo(''); setJournalSearch('') }}>
                Réinitialiser
              </button>
            )}
          </div>
          {loadingJournal ? (
            <p className="text-xs text-muted-foreground text-center py-3">Chargement...</p>
          ) : (() => {
            const filteredLogs = journalSearch.trim()
              ? auditLogs.filter((log: any) => {
                  const meta = log.metadata || {}
                  const names = [meta.product_name, ...((meta.products_snapshot || []) as any[]).map(p => p.name)].filter(Boolean)
                  return names.some(n => normalize(n).includes(normalize(journalSearch)))
                })
              : auditLogs
            if (filteredLogs.length === 0) {
              return <p className="text-xs text-muted-foreground text-center py-3">Aucune activité enregistrée.</p>
            }
            return filteredLogs.map((log: any) => {
              const meta = log.metadata || {}
              const actor = meta.actor_name || log.actor_email || '—'
              const when = new Date(log.created_at).toLocaleString('fr-FR', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })
              let label = ''
              let detail = ''
              let Icon = Trash2
              let iconColor = 'text-red-400'
              if (log.action === 'delete_product') {
                label = 'Produit supprimé'
                detail = meta.product_name || log.target_id || '—'
              } else if (log.action === 'bulk_delete_products') {
                label = 'Suppression en masse'
                const names = (meta.products_snapshot || []).map((p: any) => p.name).join(', ')
                detail = `${meta.count} produit${meta.count > 1 ? 's' : ''}${names ? ` · ${names}` : ''}`
              } else if (log.action === 'create_product') {
                Icon = Plus
                iconColor = 'text-green-500'
                label = meta.product_name || 'Produit créé'
                detail = `${formatNaira(meta.selling_price)} · ${meta.quantity} unité${meta.quantity > 1 ? 's' : ''}`
              } else if (log.action === 'update_product') {
                Icon = Edit2
                iconColor = 'text-blue-400'
                label = meta.product_name || 'Produit modifié'
                const changes = meta.changes || {}
                const parts: string[] = []
                if (changes.name) parts.push(`Nom: "${changes.name.from}" → "${changes.name.to}"`)
                if (changes.selling_price) parts.push(`Prix vente: ${changes.selling_price.from} → ${changes.selling_price.to} ${currencySymbol}`)
                if (changes.buying_price) parts.push(`Prix achat: ${changes.buying_price.from} → ${changes.buying_price.to} ${currencySymbol}`)
                if (changes.low_stock_threshold) parts.push(`Seuil d'alerte: ${changes.low_stock_threshold.from ?? '—'} → ${changes.low_stock_threshold.to ?? '—'}`)
                if (changes.sku) parts.push(`SKU: ${changes.sku.from || '—'} → ${changes.sku.to || '—'}`)
                if (changes.category_id) parts.push(`Catégorie: ${changes.category_id.from || '—'} → ${changes.category_id.to || '—'}`)
                if (changes.supplier_id) parts.push(`Fournisseur: ${changes.supplier_id.from || '—'} → ${changes.supplier_id.to || '—'}`)
                detail = parts.join(' · ')
              } else if (log.action === 'archive_product') {
                Icon = Archive
                iconColor = 'text-amber-500'
                label = 'Produit archivé'
                detail = meta.product_name || log.target_id || '—'
              } else if (log.action === 'restore_product') {
                Icon = RotateCcw
                iconColor = 'text-green-500'
                label = 'Produit restauré'
                detail = meta.product_name || log.target_id || '—'
              } else {
                label = 'Tous les produits supprimés'
                detail = `${meta.count} produit${meta.count > 1 ? 's' : ''}`
              }
              return (
                <div key={log.id} className="flex items-start gap-2.5 rounded-lg bg-muted/40 border px-3 py-2.5 text-xs">
                  <Icon className={`h-3.5 w-3.5 ${iconColor} flex-shrink-0 mt-0.5`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground/80">{label}</p>
                    <p className="text-muted-foreground truncate">{detail}</p>
                    <p className="text-muted-foreground/70 mt-0.5">{actor} · {when}</p>
                  </div>
                </div>
              )
            })
          })()}
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
            defaultValues={{ name: editingProduct.name, category_id: editingProduct.category_id || '', supplier_id: editingProduct.supplier_id || '', buying_price: editingProduct.buying_price, selling_price: editingProduct.selling_price, quantity: editingProduct.quantity, unit: editingProduct.unit, low_stock_threshold: editingProduct.low_stock_threshold || undefined, sku: editingProduct.sku || '', image_url: editingProduct.image_url || '' }}
            onSubmit={onEditProduct} onCancel={() => setEditingProduct(null)}
          />
        )}
      </PremiumDialog>

      {/* Categories Modal */}
      <PremiumDialog open={showCatModal} onOpenChange={setShowCatModal} category={t('nav.stock')} title={t('products.manage_categories')} icon={<Settings2 className="h-4 w-4" />}>
        <PremiumDialogBody>
          <div className="flex gap-2">
            <Input
              ref={catInputRef}
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              placeholder={t('categories.add_placeholder')}
              onKeyDown={e => e.key === 'Enter' && addCategory()}
              autoFocus
            />
            <Button
              onClick={addCategory}
              loading={savingCat}
              disabled={!newCatName.trim() || savingCat}
              variant="stockshop"
              className="shrink-0 rounded-xl"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {categories.filter(c => c.shop_id === shop?.id).length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{t('categories.none')}</p>}
            {categories.filter(c => c.shop_id === shop?.id).map(c => (
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

      {/* Dialog de confirmation — suppression en masse */}
      <PremiumDialog
        open={bulkDeleteDialog}
        onOpenChange={open => { if (!open) { setBulkDeleteDialog(false); setBulkDeleteAll(false); setBulkDeleteText('') } }}
        category="Suppression définitive"
        title={bulkDeleteAll ? `Supprimer tous les produits` : `Supprimer ${selectedIds.size} produit${selectedIds.size > 1 ? 's' : ''}`}
        icon={<Trash2 className="h-4 w-4 text-destructive" />}
      >
        <PremiumDialogBody>
          <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700 dark:text-red-400">
                <p className="font-semibold mb-1">
                  {bulkDeleteAll
                    ? `${products.length} produit${products.length > 1 ? 's' : ''} seront supprimés définitivement.`
                    : `${selectedIds.size} produit${selectedIds.size > 1 ? 's' : ''} sélectionné${selectedIds.size > 1 ? 's seront supprimés' : ' sera supprimé'} définitivement.`
                  }
                </p>
                <ul className="text-xs space-y-1 text-red-600 dark:text-red-400">
                  <li>• Les données de ventes associées sont conservées.</li>
                  <li>• Cette action est irréversible.</li>
                </ul>
              </div>
            </div>
          </div>
          {bulkDeleteAll && (
            <div className="space-y-1.5 mt-2">
              <Label className="text-sm">Tapez <span className="font-mono font-bold">SUPPRIMER</span> pour confirmer</Label>
              <Input
                value={bulkDeleteText}
                onChange={e => setBulkDeleteText(e.target.value)}
                placeholder="SUPPRIMER"
                className="border-destructive/40 focus:border-destructive font-mono"
              />
            </div>
          )}
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => { setBulkDeleteDialog(false); setBulkDeleteAll(false); setBulkDeleteText('') }}
          cancelLabel={t('actions.cancel')}
        >
          <Button
            onClick={bulkDelete}
            loading={bulkDeleting}
            disabled={bulkDeleting || (bulkDeleteAll && bulkDeleteText.trim().toUpperCase() !== 'SUPPRIMER')}
            className="flex-1 h-11 rounded-xl font-semibold bg-destructive hover:bg-destructive/90"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {bulkDeleteAll ? 'Tout supprimer' : `Supprimer ${selectedIds.size} produit${selectedIds.size > 1 ? 's' : ''}`}
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
            <Button variant="stockshop" type="submit" loading={saving} className="flex-1 h-11 rounded-xl font-semibold">{t('actions.restock')}</Button>
          </PremiumDialogFooter>
        </form>
      </PremiumDialog>
      {/* Barre flottante de sélection */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
          <div className="flex items-center gap-2 rounded-2xl bg-card border shadow-xl px-4 py-3">
            <span className="text-sm font-medium flex-1 text-foreground">
              {selectedIds.size} sélectionné{selectedIds.size > 1 ? 's' : ''}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setSelectedIds(new Set())}
            >
              Vider
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-destructive hover:bg-destructive/90 text-white text-xs"
              onClick={() => { setBulkDeleteAll(false); setBulkDeleteDialog(true) }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Supprimer
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
