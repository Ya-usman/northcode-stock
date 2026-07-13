'use client'

import { useState, useEffect } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { normalize } from '@/lib/utils/normalize'
import { useTranslations } from 'next-intl'
import { Search, Plus, Edit2, Trash2, Phone, MapPin, Package, Store } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { supplierSchema, type SupplierFormData } from '@/lib/validations/customer'
import type { Supplier } from '@/lib/types/database'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'

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
  const { isOnline } = useOffline()
  const isMultiShop = effectiveShopIds.length > 1
  const supabase = createClient() as any
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [productCounts, setProductCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [{ search }, setFilter] = usePersistedFilters('suppliers', shop?.id, { search: '' })
  const [showModal, setShowModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [saving, setSaving] = useState(false)

  const form = useForm<SupplierFormData>({ resolver: zodResolver(supplierSchema) })

  const fetchSuppliers = async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `suppliers_${effectiveShopIds.join(',')}`
    const cached = getPageCache<Supplier[]>(cacheKey)
    if (cached) { setSuppliers(cached); setLoading(false) }
    try {
      const { data } = await supabase.from('suppliers').select('*').in('shop_id', effectiveShopIds).order('name')
      setSuppliers((data || []) as Supplier[])
      setPageCache(cacheKey, data || [])
      if (data?.length) {
        const { data: products } = await supabase
          .from('products').select('supplier_id').in('shop_id', effectiveShopIds).eq('is_active', true)
        const counts: Record<string, number> = {}
        products?.forEach((p: any) => {
          if (p.supplier_id) counts[p.supplier_id] = (counts[p.supplier_id] || 0) + 1
        })
        setProductCounts(counts)
      }
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSuppliers() }, [effectiveShopIds.join(',')])

  // Refresh when the user comes back to this tab — catches suppliers added
  // or edited by other team members while this page sat in the background.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchSuppliers() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [effectiveShopIds.join(',')])
  useRefetchOnReconnect(fetchSuppliers, isOnline)

  const filtered = suppliers.filter(s => {
    if (!search) return true
    const q = normalize(search)
    return normalize(s.name).includes(q) || normalize(s.city ?? '').includes(q)
  })

  const withTimeout = (p: Promise<any>, ms = 15_000) =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connexion trop lente — réessayez.')), ms))])

  const onSubmit = async (data: SupplierFormData) => {
    setSaving(true)
    supabase.auth.getSession().catch(() => {})
    try {
      if (editingSupplier) {
        const { error } = await withTimeout(supabase.from('suppliers').update(data).eq('id', editingSupplier.id))
        if (error) { toast({ title: error.message, variant: 'destructive' }); return }
        toast({ title: t('toast.supplier_updated'), variant: 'success' })
      } else {
        const { error } = await withTimeout(supabase.from('suppliers').insert({ ...data, shop_id: shop!.id }))
        if (error) { toast({ title: error.message, variant: 'destructive' }); return }
        toast({ title: t('toast.supplier_added'), variant: 'success' })
      }
      setShowModal(false)
      setEditingSupplier(null)
      form.reset({ name: '', phone: '', city: '' })
      fetchSuppliers()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
      setTimeout(() => fetchSuppliers(), 3_000)
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
    await supabase.from('suppliers').delete().eq('id', s.id)
    toast({ title: t('toast.supplier_deleted') })
    fetchSuppliers()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('suppliers.search_placeholder')} className="pl-9 h-9" />
        </div>
        <Button
          variant="stockshop"
          className="h-9 gap-1"
          size="sm"
          onClick={() => { form.reset({ name: '', phone: '', city: '' }); setEditingSupplier(null); setShowModal(true) }}
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
                  <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
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
    </div>
  )
}
