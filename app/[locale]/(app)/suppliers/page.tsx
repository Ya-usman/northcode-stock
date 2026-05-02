'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Search, Plus, Edit2, Trash2, Phone, MapPin, Package, Store } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { supplierSchema, type SupplierFormData } from '@/lib/validations/customer'
import type { Supplier } from '@/lib/types/database'

function SupplierCard({ supplier, productCounts, setEditingSupplier, form, setShowModal, deleteSupplier, t }: any) {
  return (
    <div className="rounded-lg border bg-card shadow-sm p-4">
      <div className="flex items-center justify-between gap-3">
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
              <Package className="h-3 w-3" />{t('suppliers.products_count', { count: productCounts[supplier.id] || 0 })}
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent transition-colors"
            onClick={() => { setEditingSupplier(supplier); form.reset({ name: supplier.name, phone: supplier.phone || '', city: supplier.city || '' }); setShowModal(true) }}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
            onClick={() => deleteSupplier(supplier)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SuppliersPage() {
  const t = useTranslations()
  const { profile, shop, effectiveShopIds, userShops } = useAuth()
  const isMultiShop = effectiveShopIds.length > 1
  const supabase = createClient()
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [productCounts, setProductCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [saving, setSaving] = useState(false)

  const form = useForm<SupplierFormData>({ resolver: zodResolver(supplierSchema) })

  const fetchSuppliers = async () => {
    if (!effectiveShopIds.length) return
    const { data } = await supabase.from('suppliers').select('*').in('shop_id', effectiveShopIds).order('name')
    setSuppliers((data || []) as Supplier[])

    if (data?.length) {
      const { data: products } = await supabase
        .from('products').select('supplier_id').in('shop_id', effectiveShopIds).eq('is_active', true)
      const counts: Record<string, number> = {}
      products?.forEach(p => {
        if (p.supplier_id) counts[p.supplier_id] = (counts[p.supplier_id] || 0) + 1
      })
      setProductCounts(counts)
    }
    setLoading(false)
  }

  useEffect(() => { fetchSuppliers() }, [effectiveShopIds.join(',')])

  const filtered = suppliers.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) || s.city?.toLowerCase().includes(q)
  })

  const onSubmit = async (data: SupplierFormData) => {
    setSaving(true)
    if (editingSupplier) {
      const { error } = await supabase.from('suppliers').update(data).eq('id', editingSupplier.id)
      if (error) { toast({ title: error.message, variant: 'destructive' }) }
      else { toast({ title: t('toast.supplier_updated'), variant: 'success' }) }
    } else {
      const { error } = await supabase.from('suppliers').insert({ ...data, shop_id: shop!.id })
      if (error) { toast({ title: error.message, variant: 'destructive' }) }
      else { toast({ title: t('toast.supplier_added'), variant: 'success' }) }
    }
    setSaving(false)
    setShowModal(false)
    setEditingSupplier(null)
    form.reset()
    fetchSuppliers()
  }

  const deleteSupplier = async (s: Supplier) => {
    if (productCounts[s.id] > 0) {
      toast({ title: t('toast.supplier_has_products', { name: s.name, count: productCounts[s.id] }), variant: 'destructive' })
      return
    }
    if (!confirm(t('confirm.delete_supplier'))) return
    await supabase.from('suppliers').delete().eq('id', s.id)
    toast({ title: t('toast.supplier_deleted') })
    fetchSuppliers()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('suppliers.search_placeholder')} className="pl-9 h-9" />
        </div>
        <Button
          className="h-9 gap-1 bg-northcode-blue hover:bg-northcode-blue-light dark:bg-blue-500"
          size="sm"
          onClick={() => { form.reset(); setEditingSupplier(null); setShowModal(true) }}
        >
          <Plus className="h-4 w-4" />
          {t('suppliers.add_supplier')}
        </Button>
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
                  <Store className="h-3.5 w-3.5 text-northcode-blue dark:text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-northcode-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {shopSuppliers.map(supplier => <SupplierCard key={supplier.id} supplier={supplier} productCounts={productCounts} setEditingSupplier={setEditingSupplier} form={form} setShowModal={setShowModal} deleteSupplier={deleteSupplier} t={t} />)}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(supplier => <SupplierCard key={supplier.id} supplier={supplier} productCounts={productCounts} setEditingSupplier={setEditingSupplier} form={form} setShowModal={setShowModal} deleteSupplier={deleteSupplier} t={t} />)}
        </div>
      )}

      <Dialog open={showModal} onOpenChange={open => { if (!open) { setShowModal(false); setEditingSupplier(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSupplier ? t('suppliers.edit_title') : t('suppliers.add_supplier')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>{t('suppliers.name')} *</Label>
              <Input {...form.register('name')} placeholder={t('suppliers.name_placeholder')} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>{t('suppliers.phone')}</Label>
              <Input {...form.register('phone')} placeholder="08012345678" type="tel" />
            </div>
            <div className="space-y-1">
              <Label>{t('suppliers.city')}</Label>
              <Input {...form.register('city')} placeholder={t('suppliers.city_placeholder')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>{t('actions.cancel')}</Button>
              <Button type="submit" loading={saving} className="bg-blue-600 dark:bg-blue-500">{t('actions.save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
