'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Trash2, Tag, Search, RotateCcw, ChevronDown, ChevronRight, Package, Store, AlertTriangle, Edit2, Check } from 'lucide-react'
import { CATEGORY_COLORS } from '@/lib/constants/category-colors'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useCurrency } from '@/lib/hooks/use-currency'
import { normalize } from '@/lib/utils/normalize'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { cn } from '@/lib/utils/cn'
import type { Category, Product } from '@/lib/types/database'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { withTimeout } from '@/lib/utils/with-timeout'

function ColorPicker({ value, onChange }: { value: string | null; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORY_COLORS.map(color => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className="h-8 w-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
          style={{ backgroundColor: color }}
          aria-label={color}
        >
          {value === color && <Check className="h-4 w-4 text-white" />}
        </button>
      ))}
    </div>
  )
}

function CategoryCard({ cat, products, expandedId, setExpandedId, canEdit, deleteCategory, openEdit, t, fmt }: any) {
  const catProducts = products.filter((p: any) => p.category_id === cat.id)
  const isExpanded = expandedId === cat.id
  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpandedId(isExpanded ? null : cat.id)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn('h-8 w-8 rounded-md flex items-center justify-center shrink-0', !cat.color && 'bg-blue-50 dark:bg-blue-950/30')}
            style={cat.color ? { backgroundColor: `${cat.color}20` } : undefined}
          >
            <Tag className={cn('h-4 w-4', !cat.color && 'text-stockshop-blue dark:text-blue-400')} style={cat.color ? { color: cat.color } : undefined} />
          </div>
          <span className="font-medium text-sm truncate">{cat.name}</span>
          <Badge variant="secondary" className="text-xs shrink-0">{catProducts.length}</Badge>
        </div>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {canEdit && (
            <>
              <span
                role="button"
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e: any) => { e.stopPropagation(); openEdit(cat) }}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </span>
              <span
                role="button"
                className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                onClick={(e: any) => { e.stopPropagation(); deleteCategory(cat) }}
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
          {catProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">{t('categories.no_products_in_cat')}</p>
          ) : (
            <div className="divide-y divide-border/50">
              {catProducts.map((p: any) => (
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

function UncategorizedCard({ products, shopId, expandedId, setExpandedId, t, fmt }: any) {
  const key = `__none__${shopId}`
  const isExpanded = expandedId === key
  return (
    <div className="rounded-lg border border-dashed bg-card shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpandedId(isExpanded ? null : key)}
      >
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-blue-50/50 dark:bg-blue-950/20 flex items-center justify-center shrink-0">
            <Tag className="h-4 w-4 text-stockshop-blue/60 dark:text-blue-400/60" />
          </div>
          <span className="font-medium text-sm text-muted-foreground">{t('categories.uncategorized')}</span>
          <Badge variant="outline" className="text-xs">{products.length}</Badge>
        </div>
        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {isExpanded && (
        <div className="border-t bg-muted/10 divide-y divide-border/50">
          {products.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm truncate">{p.name}</span>
              </div>
              <span className="text-sm font-semibold text-stockshop-blue dark:text-blue-400 shrink-0 ml-2">
                {fmt(p.selling_price)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CategoriesPage() {
  const t = useTranslations()
  const { shop, profile, roleInActiveShop, effectiveShopIds, userShops } = useAuthContext()
  const { fmt } = useCurrency()
  const { isOnline } = useOffline()
  const isMultiShop = effectiveShopIds.length > 1
  const supabase = createClient()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const [categories, setCategories] = useState<Category[]>(() => {
    const c = getPageCache<{ categories: Category[]; products: Product[] }>(`categories_${effectiveShopIds.join(',')}`)
    return c?.categories || []
  })
  const [products, setProducts] = useState<Product[]>(() => {
    const c = getPageCache<{ categories: Category[]; products: Product[] }>(`categories_${effectiveShopIds.join(',')}`)
    return c?.products || []
  })
  const [loading, setLoading] = useState(() =>
    !getPageCache(`categories_${effectiveShopIds.join(',')}`)
  )
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<string | null>(null)
  const [newAlertDays, setNewAlertDays] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteCat, setConfirmDeleteCat] = useState<Category | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<string | null>(null)
  const [editAlertDays, setEditAlertDays] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const fetchData = async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `categories_${effectiveShopIds.join(',')}`
    const cached = getPageCache<any>(cacheKey)
    if (cached) { setCategories(cached.categories); setProducts(cached.products); setLoading(false) }
    try {
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave `loading` stuck true forever.
      const [catData, prodData] = await withTimeout(Promise.all([
        supabase.from('categories').select('*').in('shop_id', effectiveShopIds).order('name'),
        supabase.from('products').select('id, name, selling_price, quantity, unit, category_id, shop_id').in('shop_id', effectiveShopIds).eq('is_active', true).order('name'),
      ]), 20_000, 'Chargement des catégories trop lent — réessayez.')
      // A transient auth/RLS hiccup can resolve with data: null instead of
      // throwing — check explicitly so the catch below preserves the cache
      // already on screen instead of zeroing it out.
      if (catData.error || prodData.error) throw catData.error || prodData.error
      const fetchedCategories = (catData.data || []) as Category[]
      const fetchedProducts = (prodData.data || []) as unknown as Product[]
      setCategories(fetchedCategories)
      setProducts(fetchedProducts)
      setPageCache(cacheKey, { categories: fetchedCategories, products: fetchedProducts })
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [effectiveShopIds.join(',')])

  // Refresh when the user comes back to this tab — catches categories/products
  // added or edited by other team members while this page sat in the background.
  useRefetchOnVisible(fetchData)
  useRefetchOnReconnect(fetchData, isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

  const openDialog = () => {
    setNewName('')
    setNewColor(CATEGORY_COLORS[0])
    setNewAlertDays('')
    setDialogOpen(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const addCategory = async () => {
    if (!shop?.id || !newName.trim()) return
    setSaving(true)
    try {
      const res = await withTimeout(fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id, name: newName.trim(), color: newColor, expiry_alert_days: newAlertDays ? Number(newAlertDays) : null }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      setDialogOpen(false)
      setNewName('')
      fetchData()
      toast({ title: t('categories.added'), variant: 'success' })
    } catch (err: any) {
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (cat: Category) => {
    setEditingCat(cat)
    setEditName(cat.name)
    setEditColor(cat.color || CATEGORY_COLORS[0])
    setEditAlertDays(cat.expiry_alert_days != null ? String(cat.expiry_alert_days) : '')
  }

  const saveEdit = async () => {
    if (!editingCat || !shop?.id || !editName.trim()) return
    setEditSaving(true)
    try {
      const res = await withTimeout(fetch('/api/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingCat.id, shop_id: shop.id, name: editName.trim(), color: editColor, expiry_alert_days: editAlertDays ? Number(editAlertDays) : null }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      setEditingCat(null)
      fetchData()
      toast({ title: t('categories.updated'), variant: 'success' })
    } catch (err: any) {
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
    } finally {
      setEditSaving(false)
    }
  }

  const deleteCategory = async (cat: Category) => {
    setDeleting(true)
    try {
      const res = await withTimeout(fetch(`/api/categories?id=${cat.id}&shop_id=${shop?.id}`, { method: 'DELETE' }))
      if (!res.ok) { toast({ title: t('categories.delete_error'), variant: 'destructive' }); return }
      setConfirmDeleteCat(null)
      fetchData()
      toast({ title: t('categories.deleted') })
    } catch (err: any) {
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const restoreDefaults = async () => {
    if (!shop?.id) return
    setSeeding(true)
    try {
      const res = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      await fetchData()
      toast({
        title: t('categories.restored'),
        description: `${json.categoriesCreated} catégorie(s) ajoutée(s) · ${json.productsAssigned} produit(s) mis à jour`,
        variant: 'success',
      })
    } catch {
      toast({ title: t('toast.error'), variant: 'destructive' })
    } finally {
      setSeeding(false)
    }
  }

  const effectiveRole = roleInActiveShop ?? profile?.role
  const canEdit = effectiveRole === 'owner' || effectiveRole === 'stock_manager' || effectiveRole === 'super_admin'
  const filtered = categories.filter(c => normalize(c.name).includes(normalize(search)))

  // Products without any category
  const uncategorized = products.filter(p => !p.category_id)

  return (
    <div className="space-y-4">

      {/* Search + Add row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('categories.search_placeholder')}
            className="pl-9 h-9"
          />
        </div>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={restoreDefaults}
              loading={seeding}
              className="gap-1.5 h-9 px-3 text-sm text-muted-foreground"
              title={t('categories.restore_hint')}
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">{t('categories.restore')}</span>
            </Button>
            <Button variant="stockshop" onClick={openDialog} className="gap-1.5 h-9 px-3 text-sm">
              <Plus className="h-4 w-4" />
              {t('categories.add')}
            </Button>
          </div>
        )}
      </div>

      {/* Category list with products */}
      <div className="space-y-2">
        {loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
          <LoadErrorFallback />
        ) : loading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Tag className="h-10 w-10 mb-3 opacity-30 text-stockshop-blue dark:text-blue-400" />
            <p className="text-sm">{search ? t('categories.no_results') : t('categories.none')}</p>
            {canEdit && !search && <p className="text-xs mt-1">{t('categories.add_hint')}</p>}
          </div>
        ) : isMultiShop ? (
          userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
            const shopCats = filtered.filter(c => c.shop_id === shopEntry.id)
            const shopUncategorized = !search ? products.filter(p => p.shop_id === shopEntry.id && !p.category_id) : []
            if (shopCats.length === 0 && shopUncategorized.length === 0) return null
            return (
              <div key={shopEntry.id} className="space-y-2">
                {/* Shop section header */}
                <div className="flex items-center gap-2 pt-2">
                  <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {shopCats.map(cat => <CategoryCard key={cat.id} cat={cat} products={products} expandedId={expandedId} setExpandedId={setExpandedId} canEdit={canEdit} deleteCategory={setConfirmDeleteCat} openEdit={openEdit} t={t} fmt={fmt} />)}
                {shopUncategorized.length > 0 && <UncategorizedCard products={shopUncategorized} shopId={shopEntry.id} expandedId={expandedId} setExpandedId={setExpandedId} t={t} fmt={fmt} />}
              </div>
            )
          })
        ) : (
          <>
            {filtered.map(cat => <CategoryCard key={cat.id} cat={cat} products={products} expandedId={expandedId} setExpandedId={setExpandedId} canEdit={canEdit} deleteCategory={setConfirmDeleteCat} openEdit={openEdit} t={t} fmt={fmt} />)}
            {!search && uncategorized.length > 0 && <UncategorizedCard products={uncategorized} shopId={shop?.id || ''} expandedId={expandedId} setExpandedId={setExpandedId} t={t} fmt={fmt} />}
          </>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('categories.count', { count: filtered.length })} · {products.length} {t('categories.products_total')}
        </p>
      )}

      {/* Add category dialog */}
      <PremiumDialog
        open={dialogOpen}
        onOpenChange={open => { setDialogOpen(open); if (!open) setNewName('') }}
        category={t('nav.categories')}
        title={t('categories.add_dialog_title')}
        icon={<Tag className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">{t('categories.add_dialog_label')}</Label>
            <Input
              id="cat-name"
              ref={inputRef}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t('categories.add_placeholder')}
              onKeyDown={e => e.key === 'Enter' && addCategory()}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('categories.color_label')}</Label>
            <ColorPicker value={newColor} onChange={setNewColor} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-alert-days">{t('categories.expiry_alert_days_label')}</Label>
            <Input
              id="cat-alert-days"
              type="number"
              min={1}
              value={newAlertDays}
              onChange={e => setNewAlertDays(e.target.value)}
              placeholder={t('categories.expiry_alert_days_placeholder', { days: shop?.expiry_alert_days ?? 14 })}
            />
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setDialogOpen(false)}
          cancelLabel={t('actions.cancel')}
          onConfirm={addCategory}
          confirmLabel={t('categories.add')}
          confirmDisabled={!newName.trim()}
          confirmLoading={saving}
        />
      </PremiumDialog>

      {/* Edit category dialog */}
      <PremiumDialog
        open={!!editingCat}
        onOpenChange={open => { if (!open) setEditingCat(null) }}
        category={t('nav.categories')}
        title={t('categories.edit_dialog_title')}
        icon={<Edit2 className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          <div className="space-y-1.5">
            <Label htmlFor="cat-edit-name">{t('categories.add_dialog_label')}</Label>
            <Input
              id="cat-edit-name"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder={t('categories.add_placeholder')}
              onKeyDown={e => e.key === 'Enter' && saveEdit()}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('categories.color_label')}</Label>
            <ColorPicker value={editColor} onChange={setEditColor} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-edit-alert-days">{t('categories.expiry_alert_days_label')}</Label>
            <Input
              id="cat-edit-alert-days"
              type="number"
              min={1}
              value={editAlertDays}
              onChange={e => setEditAlertDays(e.target.value)}
              placeholder={t('categories.expiry_alert_days_placeholder', { days: shop?.expiry_alert_days ?? 14 })}
            />
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setEditingCat(null)}
          cancelLabel={t('actions.cancel')}
          onConfirm={saveEdit}
          confirmLabel={t('actions.save')}
          confirmDisabled={!editName.trim()}
          confirmLoading={editSaving}
        />
      </PremiumDialog>

      {/* Delete category confirmation dialog */}
      <PremiumDialog
        open={!!confirmDeleteCat}
        onOpenChange={open => { if (!open) setConfirmDeleteCat(null) }}
        category={t('nav.categories')}
        title={confirmDeleteCat?.name || ''}
        icon={<Trash2 className="h-4 w-4 text-destructive" />}
      >
        <PremiumDialogBody>
          <div className="flex items-start gap-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-400">{t('categories.delete_confirm', { name: confirmDeleteCat?.name || '' })}</p>
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setConfirmDeleteCat(null)}
          cancelLabel={t('actions.cancel')}
          onConfirm={() => confirmDeleteCat && deleteCategory(confirmDeleteCat)}
          confirmLabel={t('actions.delete') || 'Supprimer'}
          confirmDestructive
          confirmLoading={deleting}
        />
      </PremiumDialog>
    </div>
  )
}
