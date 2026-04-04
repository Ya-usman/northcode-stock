'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Plus, Search, Edit2, Package, ArrowDown, Sliders, FileDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/use-auth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNaira } from '@/lib/utils/currency'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { productSchema, type ProductFormData, restockSchema, type RestockFormData } from '@/lib/validations/product'
import type { Product, Category, Supplier } from '@/lib/types/database'

function StockBadge({ quantity, threshold }: { quantity: number; threshold: number }) {
  const t = useTranslations('status')
  if (quantity === 0) return <Badge variant="danger">{t('out_of_stock')}</Badge>
  if (quantity <= threshold) return <Badge variant="warning">{t('low_stock')}</Badge>
  return <Badge variant="success">{t('in_stock')}</Badge>
}

export default function StockPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const { profile, shop } = useAuth()
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

  const productForm = useForm<ProductFormData>({ resolver: zodResolver(productSchema) })
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
        if (!p.name.toLowerCase().includes(q) && !p.sku?.toLowerCase().includes(q) &&
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
    setSaving(true)
    const { error } = await supabase.from('products').insert({
      shop_id: shop!.id,
      name: data.name,
      name_hausa: data.name_hausa || null,
      sku: data.sku || null,
      category_id: data.category_id || null,
      supplier_id: data.supplier_id || null,
      buying_price: data.buying_price,
      selling_price: data.selling_price,
      quantity: data.quantity,
      unit: data.unit || 'piece',
      low_stock_threshold: data.low_stock_threshold || null,
      is_active: true,
    })
    setSaving(false)
    if (error) { toast({ title: error.message, variant: 'destructive' }); return }
    toast({ title: 'Product added!', variant: 'success' })
    setShowAddModal(false)
    productForm.reset()
    fetchProducts()
  }

  const onEditProduct = async (data: ProductFormData) => {
    if (!editingProduct) return
    setSaving(true)
    const { error } = await supabase.from('products').update({
      name: data.name,
      name_hausa: data.name_hausa || null,
      sku: data.sku || null,
      category_id: data.category_id || null,
      supplier_id: data.supplier_id || null,
      buying_price: data.buying_price,
      selling_price: data.selling_price,
      unit: data.unit || 'piece',
      low_stock_threshold: data.low_stock_threshold || null,
    }).eq('id', editingProduct.id)
    setSaving(false)
    if (error) { toast({ title: error.message, variant: 'destructive' }); return }
    toast({ title: 'Product updated!', variant: 'success' })
    setEditingProduct(null)
    fetchProducts()
  }

  const onRestock = async (data: RestockFormData) => {
    if (!restockProduct) return
    setSaving(true)
    const { error: updateError } = await supabase.from('products')
      .update({ quantity: restockProduct.quantity + data.quantity })
      .eq('id', restockProduct.id)
    if (updateError) { setSaving(false); toast({ title: updateError.message, variant: 'destructive' }); return }

    await supabase.from('stock_movements').insert({
      shop_id: shop!.id,
      product_id: restockProduct.id,
      type: 'in',
      quantity: data.quantity,
      reason: `Restock from ${suppliers.find(s => s.id === data.supplier_id)?.name || 'supplier'}`,
      notes: data.notes || null,
      performed_by: profile!.id,
    })
    setSaving(false)
    toast({ title: `Added ${data.quantity} units to ${restockProduct.name}`, variant: 'success' })
    setShowRestockModal(false)
    restockForm.reset()
    fetchProducts()
  }

  const softDelete = async (product: Product) => {
    if (!confirm(t('products.delete_confirm'))) return
    await supabase.from('products').update({ is_active: false }).eq('id', product.id)
    toast({ title: 'Product removed' })
    fetchProducts()
  }

  const exportCSV = () => {
    const rows = [
      ['Name', 'Hausa Name', 'SKU', 'Category', 'Buying Price', 'Selling Price', 'Quantity', 'Unit', 'Status'],
      ...filtered.map(p => {
        const threshold = p.low_stock_threshold || shop?.low_stock_threshold || 10
        const status = p.quantity === 0 ? 'Out of Stock' : p.quantity <= threshold ? 'Low Stock' : 'In Stock'
        return [p.name, p.name_hausa || '', p.sku || '', (p as any).categories?.name || '', p.buying_price, p.selling_price, p.quantity, p.unit, status]
      })
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `stock-${Date.now()}.csv`
    a.click()
  }

  const ProductForm = ({ onSubmit, isEdit }: { onSubmit: (d: ProductFormData) => void; isEdit?: boolean }) => (
    <form onSubmit={productForm.handleSubmit(onSubmit)} className="space-y-3 overflow-y-auto max-h-[70vh]">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <Label>{t('products.name')} *</Label>
          <Input {...productForm.register('name')} placeholder="Product name" />
          {productForm.formState.errors.name && <p className="text-xs text-destructive">{productForm.formState.errors.name.message}</p>}
        </div>
        <div className="col-span-2 space-y-1">
          <Label>{t('products.name_hausa')}</Label>
          <Input {...productForm.register('name_hausa')} placeholder="Sunan Hausa (optional)" />
        </div>
        <div className="space-y-1">
          <Label>{t('products.sku')}</Label>
          <Input {...productForm.register('sku')} placeholder="e.g. RICE-50KG" />
        </div>
        <div className="space-y-1">
          <Label>{t('products.unit')}</Label>
          <Select onValueChange={v => productForm.setValue('unit', v)} defaultValue={editingProduct?.unit || 'piece'}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['piece', 'kg', 'g', 'litre', 'ml', 'pack', 'carton', 'dozen', 'bag', 'bottle', 'tin', 'box'].map(u => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t('products.category')}</Label>
          <Select onValueChange={v => productForm.setValue('category_id', v)} defaultValue={editingProduct?.category_id || ''}>
            <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t('products.supplier')}</Label>
          <Select onValueChange={v => productForm.setValue('supplier_id', v)} defaultValue={editingProduct?.supplier_id || ''}>
            <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
            <SelectContent>
              {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {profile?.role === 'owner' && (
          <div className="space-y-1">
            <Label>{t('products.buying_price')}</Label>
            <Input type="number" {...productForm.register('buying_price')} placeholder="0" />
            {productForm.formState.errors.buying_price && <p className="text-xs text-destructive">{productForm.formState.errors.buying_price.message}</p>}
          </div>
        )}
        <div className="space-y-1">
          <Label>{t('products.selling_price')}</Label>
          <Input type="number" {...productForm.register('selling_price')} placeholder="0" />
          {productForm.formState.errors.selling_price && <p className="text-xs text-destructive">{productForm.formState.errors.selling_price.message}</p>}
        </div>
        {!isEdit && (
          <div className="space-y-1">
            <Label>{t('products.quantity')}</Label>
            <Input type="number" {...productForm.register('quantity')} placeholder="0" />
          </div>
        )}
        <div className="space-y-1">
          <Label>{t('products.low_stock_threshold')}</Label>
          <Input type="number" {...productForm.register('low_stock_threshold')} placeholder={String(shop?.low_stock_threshold || 10)} />
        </div>
      </div>
      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" onClick={() => { setShowAddModal(false); setEditingProduct(null) }}>
          {t('actions.cancel')}
        </Button>
        <Button type="submit" loading={saving} className="bg-northcode-blue">
          {t('actions.save')}
        </Button>
      </DialogFooter>
    </form>
  )

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('products.search_placeholder')} className="pl-9 h-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[110px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="ok">In Stock</SelectItem>
            <SelectItem value="low">Low Stock</SelectItem>
            <SelectItem value="out">Out of Stock</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportCSV} className="h-9 gap-1">
          <FileDown className="h-3.5 w-3.5" /> CSV
        </Button>
        {(profile?.role === 'owner' || profile?.role === 'stock_manager') && (
          <Button
            className="h-9 gap-1 bg-northcode-blue hover:bg-northcode-blue-light"
            size="sm"
            onClick={() => { productForm.reset(); setShowAddModal(true) }}
          >
            <Plus className="h-4 w-4" />
            {t('actions.add_product')}
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{filtered.length} products</span>
        <span className="text-amber-600">{filtered.filter(p => p.quantity > 0 && p.quantity <= (p.low_stock_threshold || shop?.low_stock_threshold || 10)).length} low</span>
        <span className="text-red-500">{filtered.filter(p => p.quantity === 0).length} out of stock</span>
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
                className="rounded-lg border bg-white shadow-sm p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{product.name}</p>
                    {product.name_hausa && (
                      <p className="text-xs text-muted-foreground truncate">{product.name_hausa}</p>
                    )}
                    {product.sku && (
                      <p className="text-[10px] font-mono text-muted-foreground">{product.sku}</p>
                    )}
                  </div>
                  <StockBadge quantity={product.quantity} threshold={threshold} />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold text-northcode-blue">{formatNaira(product.selling_price)}</span>
                  {profile?.role === 'owner' && (
                    <span className="text-xs text-muted-foreground">Cost: {formatNaira(product.buying_price)}</span>
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
                        onClick={() => {
                          setEditingProduct(product)
                          productForm.reset({
                            name: product.name,
                            name_hausa: product.name_hausa || '',
                            sku: product.sku || '',
                            category_id: product.category_id || '',
                            supplier_id: product.supplier_id || '',
                            buying_price: product.buying_price,
                            selling_price: product.selling_price,
                            quantity: product.quantity,
                            unit: product.unit,
                            low_stock_threshold: product.low_stock_threshold || undefined,
                          })
                        }}
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
          <ProductForm onSubmit={onAddProduct} />
        </DialogContent>
      </Dialog>

      {/* Edit Product Modal */}
      <Dialog open={!!editingProduct} onOpenChange={open => !open && setEditingProduct(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('actions.edit')} Product</DialogTitle></DialogHeader>
          <ProductForm onSubmit={onEditProduct} isEdit />
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
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {profile?.role === 'owner' && (
              <div className="space-y-1">
                <Label>Buying Price (this batch)</Label>
                <Input type="number" {...restockForm.register('buying_price')} placeholder={String(restockProduct?.buying_price)} />
              </div>
            )}
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input {...restockForm.register('notes')} placeholder="Optional notes…" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowRestockModal(false)}>{t('actions.cancel')}</Button>
              <Button type="submit" loading={saving} className="bg-northcode-blue">{t('actions.restock')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
