'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Plus, Search, Edit2, Package, ArrowDown, FileDown, Settings2, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { restockSchema, type RestockFormData, type ProductFormData } from '@/lib/validations/product'
import type { Product, Category, Supplier } from '@/lib/types/database'
import { ProductForm } from '@/components/stock/product-form'


function StockBadge({ quantity, threshold }: { quantity: number; threshold: number }) {
  const t = useTranslations('status')
  if (quantity === 0) return <Badge variant="danger">{t('out_of_stock')}</Badge>
  if (quantity <= threshold) return <Badge variant="warning">{t('low_stock')}</Badge>
  return <Badge variant="success">{t('in_stock')}</Badge>
}

export default function StockPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const { profile, shop } = useAuth()
  const { fmt: formatNaira } = useCurrency()
  const supabase = createClient()
  const { toast } = useToast()

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showRestockModal, setShowRestockModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [restockProduct, setRestockProduct] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)
  const [showCatModal, setShowCatModal] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [savingCat, setSavingCat] = useState(false)

  const restockForm = useForm<RestockFormData>({ resolver: zodResolver(restockSchema) })

  const fetchProducts = async () => {
    if (!shop?.id) return
    const [{ data: prods }, { data: cats }, { data: sups }] = await Promise.all([
      supabase.from('products')
        .select('*, categories(name), suppliers(name)')
        .eq('shop_id', shop.id)
        .order('name'),
      supabase.from('categories').select('*').eq('shop_id', shop.id).order('name'),
      supabase.from('suppliers').select('*').eq('shop_id', shop.id).order('name'),
    ])
    setProducts((prods || []) as unknown as Product[])
    setCategories((cats || []) as Category[])
    setSuppliers((sups || []) as Supplier[])
    setLoading(false)
  }

  useEffect(() => { fetchProducts() }, [shop?.id])

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

  const onAddProduct = async (data: ProductFormData) => {
    if (!shop?.id) { toast({ title: t('toast.no_active_shop'), variant: 'destructive' }); return }
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
          is_active: true,
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('toast.product_added'), variant: 'success' })
      setShowAddModal(false)
      fetchProducts()
    } finally {
      setSaving(false)
    }
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

  const softDelete = async (product: Product) => {
    if (!confirm(t('products.delete_confirm'))) return
    await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: product.id, shop_id: product.shop_id, is_active: false }),
    })
    toast({ title: t('toast.product_deleted') })
    fetchProducts()
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
    if (!confirm(t('confirm.delete_category', { name: '' }))) return
    await fetch(`/api/categories?id=${catId}&shop_id=${shop?.id}`, { method: 'DELETE' })
    if (categoryFilter === catId) setCategoryFilter('all')
    fetchProducts()
  }

  const productFormProps = {
    categories,
    suppliers,
    currency: shop?.currency || '₦',
    isOwner: profile?.role === 'owner',
    saving,
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('products.search_placeholder')} className="pl-9 h-9" />
        </div>
        <div className="flex gap-1">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder={t('products.all_categories')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('products.all_categories')}</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {(profile?.role === 'owner' || profile?.role === 'stock_manager') && (
            <Button variant="outline" size="sm" className="h-9 px-2" onClick={() => setShowCatModal(true)} title={t('products.manage_categories')}>
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[110px] h-9"><SelectValue placeholder={t('status.all')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('status.all')}</SelectItem>
            <SelectItem value="ok">{t('status.in_stock')}</SelectItem>
            <SelectItem value="low">{t('status.low_stock')}</SelectItem>
            <SelectItem value="out">{t('status.out_of_stock')}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportCSV} className="h-9 gap-1">
          <FileDown className="h-3.5 w-3.5" /> CSV
        </Button>
        {(profile?.role === 'owner' || profile?.role === 'stock_manager' || profile?.role === 'cashier') && (
          <Button
            className="h-9 gap-1 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500"
            size="sm"
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="h-4 w-4" />
            {t('actions.add_product')}
          </Button>
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
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((product, idx) => {
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
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{product.name}</p>
                    {product.name_hausa && (
                      <p className="text-xs text-muted-foreground truncate">{product.name_hausa}</p>
                    )}
                  </div>
                  <StockBadge quantity={product.quantity} threshold={threshold} />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold text-blue-600 dark:text-blue-400">{formatNaira(product.selling_price)}</span>
                  {profile?.role === 'owner' && (
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
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setRestockProduct(product)
                        restockForm.reset({ product_id: product.id, quantity: 1 })
                        setShowRestockModal(true)
                      }}
                    >
                      <ArrowDown className="h-3 w-3 mr-1" />
                      {t('actions.restock')}
                    </Button>
                    {(profile?.role === 'owner' || profile?.role === 'stock_manager') && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setEditingProduct(product)}
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Add Product Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('actions.add_product')}</DialogTitle></DialogHeader>
          {showAddModal && (
            <ProductForm
              key="add"
              {...productFormProps}
              onSubmit={onAddProduct}
              onCancel={() => setShowAddModal(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Product Modal */}
      <Dialog open={!!editingProduct} onOpenChange={open => !open && setEditingProduct(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('products.edit_title')}</DialogTitle></DialogHeader>
          {editingProduct && (
          <ProductForm
            key={editingProduct.id}
            {...productFormProps}
            isEdit
            defaultValues={editingProduct ? {
              name: editingProduct.name,
              name_hausa: editingProduct.name_hausa || '',
              category_id: editingProduct.category_id || '',
              supplier_id: editingProduct.supplier_id || '',
              buying_price: editingProduct.buying_price,
              selling_price: editingProduct.selling_price,
              quantity: editingProduct.quantity,
              unit: editingProduct.unit,
              low_stock_threshold: editingProduct.low_stock_threshold || undefined,
            } : undefined}
            onSubmit={onEditProduct}
            onCancel={() => setEditingProduct(null)}
          />
          )}
        </DialogContent>
      </Dialog>

      {/* Categories Modal */}
      <Dialog open={showCatModal} onOpenChange={setShowCatModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('products.manage_categories')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                placeholder={t('categories.add_placeholder')}
                onKeyDown={e => e.key === 'Enter' && addCategory()}
              />
              <Button onClick={addCategory} loading={savingCat} className="bg-blue-600 dark:bg-blue-500 shrink-0">
                <Plus className="h-4 w-4 mr-1" /> {t('categories.add')}
              </Button>
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {categories.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">{t('categories.none')}</p>
              )}
              {categories.map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{c.name}</span>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteCategory(c.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCatModal(false)}>{t('actions.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restock Modal */}
      <Dialog open={showRestockModal} onOpenChange={setShowRestockModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('products.restock_title')}: {restockProduct?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={restockForm.handleSubmit(onRestock)} className="space-y-4">
            <input type="hidden" {...restockForm.register('product_id')} />
            <div className="space-y-1">
              <Label>{t('products.quantity_to_add')} *</Label>
              <Input type="number" min={1} {...restockForm.register('quantity')} />
            </div>
            <div className="space-y-1">
              <Label>{t('products.supplier')}</Label>
              <Select onValueChange={v => restockForm.setValue('supplier_id', v)}>
                <SelectTrigger><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {profile?.role === 'owner' && (
              <div className="space-y-1">
                <Label>{t('products.restock_buying_price')}</Label>
                <Input type="number" {...restockForm.register('buying_price')} placeholder={String(restockProduct?.buying_price)} />
              </div>
            )}
            <div className="space-y-1">
              <Label>{t('products.notes_label')}</Label>
              <Input {...restockForm.register('notes')} placeholder={t('products.notes_placeholder')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowRestockModal(false)}>{t('actions.cancel')}</Button>
              <Button type="submit" loading={saving} className="bg-blue-600 dark:bg-blue-500">{t('actions.restock')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
